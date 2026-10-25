import { useEffect, useMemo, useState } from 'preact/hooks';
import { DIFFICULTY, GOVS } from '../game/defs';
import { fmt } from '../game/format';
import { newGame } from '../game/newGame';
import { allSlots, setActiveSlot, trashInfo, writeSlot } from '../game/save';
import { blocName, blocOf, SCENARIO_KEYS, SCENARIOS } from '../game/scenarios';
import { getGame, setGame } from '../game/state';
import type { Difficulty, GameState, Scenario } from '../game/types';
import { COUNTRY_DEFS, REGIONS, REGION_OF, isWater } from '../game/world';
import type { MapView } from '../map/MapView';
import { Card, Flag, Seg, Tabs } from './common';
import { PanelFrame, trackTab } from './PanelFrame';
import { PanelHero } from './PanelHero';
import { AudioSettings } from './AudioSettings';
import { defaultTarget, SaveSlots } from './Saves';
import { useHotkeys } from './Controls';
import { MailButton } from './Mail';
import { Banners, Modals, ProposalCard, QuestButton, Toasts } from './Modals';
import { ArmyPanel } from './panels/ArmyPanel';
import { BuildPanel } from './panels/BuildPanel';
import { DiploPanel } from './panels/DiploPanel';
import { LodgePanel } from './panels/LodgePanel';
import { SpyPanel } from './panels/SpyPanel';
import { UNPanel } from './panels/UNPanel';
import { MarketPanel } from './panels/MarketPanel';
import { PolicyPanel } from './panels/PolicyPanel';
import { StatsPanel } from './panels/StatsPanel';
import { TileSheet } from './TileSheet';
import { BottomNav, PausedBadge, TopBar } from './TopBar';
import { prefs, setUI, ui, useStore, type ArmyTab } from './store';

/** Выбор страны тапом по карте на стартовом экране. */
let startPick: ((ci: number) => void) | null = null;

export function App({ map }: { map: MapView }) {
  useStore();
  useHotkeys(map);
  useEffect(() => {
    map.onTap = (tile) => {
      if (!getGame()) {
        const o = isWater(tile) ? -1 : REGIONS[REGION_OF[tile]].origOwner;
        if (o >= 0) startPick?.(o);
        return;
      }
      map.select(tile);
      setUI({ tile, tab: 'map', modal: null });
    };
  }, []);
  useEffect(() => {
    if (ui.tile < 0 && map.selectedTile >= 0) map.select(-1);
  });
  map.fancy = prefs.fx;
  const g = getGame();
  map.setActive(!g || ui.tab === 'map');
  if (!g) return <StartScreen map={map} />;
  trackTab(ui.tab);
  return (
    <>
      <TopBar />
      <PausedBadge />
      {ui.tab !== 'map' && (
        <PanelFrame tab={ui.tab} key={ui.tab}>
          {ui.tab === 'policy' && <PolicyPanel />}
          {ui.tab === 'build' && <BuildPanel map={map} />}
          {ui.tab === 'army' && <WarAndPeace map={map} />}
          {ui.tab === 'market' && <MarketPanel />}
          {ui.tab === 'stats' && <StatsPanel />}
        </PanelFrame>
      )}
      {ui.tab === 'map' && ui.tile >= 0 && <TileSheet map={map} />}
      <QuestButton />
      <MailButton />
      <ProposalCard />
      <BottomNav />
      <Toasts />
      <Banners />
      <Modals map={map} />
    </>
  );
}

/** Армия, дипломатия, разведка, ложи и ООН — одна вкладка: война и мир в одном месте. */
function WarAndPeace({ map }: { map: MapView }) {
  const g = getGame()!;
  const n = g.proposals.length;
  const tab = ui.armyTab;
  // по чужой резолюции ещё не проголосовали — подсказка на вкладке ООН
  const votes = g.assembly.res.filter((r) => r.passed === undefined && r.by !== g.player && !r.myVote).length;
  return (
    <>
      <PanelHero kind="army" />
      <Tabs<ArmyTab>
        compact
        value={tab}
        onChange={(v) => setUI({ armyTab: v })}
        options={[
          { v: 'army', label: '⚔️ Армия' },
          { v: 'diplo', label: n ? `🤝 Дипломатия (${n})` : '🤝 Дипломатия' },
          { v: 'spy', label: '🕵️ Разведка' },
          { v: 'lodge', label: g.order ? `${g.order.emblem} Ложи` : '👁️ Ложи' },
          { v: 'un', label: votes ? `🌐 ООН (${votes})` : '🌐 ООН' },
        ]}
      />
      {tab === 'army' && <ArmyPanel map={map} />}
      {tab === 'diplo' && <DiploPanel map={map} />}
      {tab === 'spy' && <SpyPanel />}
      {tab === 'lodge' && <LodgePanel />}
      {tab === 'un' && <UNPanel />}
    </>
  );
}

/** fresh — новая партия: записываем её в слот сразу (прежнее содержимое слота — в корзину). */
function begin(map: MapView, g: GameState, slot: number, fresh: boolean) {
  if (fresh) writeSlot(slot, g);
  else setActiveSlot(slot);
  setGame(g);
  map.setGame(g);
  map.focusTile(REGIONS[g.countries[g.player].capital].center, 1.4, prefs.fx);
  setUI({ tab: 'map', tile: -1, modal: null, paused: false });
}

/** Где на экране показывать выбранную страну: справа от меню на ПК, сверху — на телефоне. */
function previewArea() {
  const w = window.innerWidth, h = window.innerHeight;
  return w >= 900 ? { x: 520, y: 0, w: w - 520, h } : { x: 0, y: 0, w, h: h * 0.42 };
}

// шкалы показателей страны: логарифм — чтобы и Австралия, и Китай были видны
const logScale = (vals: number[]) => {
  const lo = Math.log(Math.min(...vals)), hi = Math.log(Math.max(...vals));
  return (v: number) => 0.12 + 0.88 * ((Math.log(v) - lo) / (hi - lo || 1));
};
const POP = logScale(COUNTRY_DEFS.map((c) => c.pop));
const ECON = logScale(COUNTRY_DEFS.map((c) => c.pop * c.gdp));
const ARMY = logScale(COUNTRY_DEFS.map((c) => c.army * c.weapons));
const EDU = (() => {
  const v = COUNTRY_DEFS.map((c) => c.edu);
  const lo = Math.min(...v), hi = Math.max(...v);
  return (x: number) => 0.12 + 0.88 * ((x - lo) / (hi - lo || 1));
})();

const DIFF_HINT: Record<Difficulty, string> = {
  easy: 'Боты спокойнее и слабее — можно спокойно учиться.',
  normal: 'Честный мир: боты играют по тем же правилам.',
  hard: 'Боты сильнее и чаще нападают. Для опытных правителей.',
};

const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  x: (i * 47) % 100,
  d: ((i * 37) % 100) / 10,
  s: 2 + ((i * 13) % 4),
  t: 9 + ((i * 29) % 8),
}));

function StartScreen({ map }: { map: MapView }) {
  const sorted = useMemo(() => COUNTRY_DEFS.map((c, i) => ({ c, i })).sort((a, b) => a.c.name.localeCompare(b.c.name, 'ru')), []);
  const [sel, setSel] = useState(COUNTRY_DEFS.findIndex((c) => c.id === 'ru'));
  const [diff, setDiff] = useState<Difficulty>('normal');
  const [scenario, setScenario] = useState<Scenario>('classic');
  const [leaving, setLeaving] = useState(false);
  const [slots, setSlots] = useState(allSlots);
  const [target, setTarget] = useState(() => defaultTarget(slots));
  const showSaves = slots.some((s) => s.raw) || !!trashInfo();
  const occupied = !!slots.find((s) => s.slot === target)?.raw;
  useEffect(() => {
    startPick = setSel;
    return () => { startPick = null; };
  }, []);
  useEffect(() => {
    map.preview(sel, previewArea());
  }, [sel]);
  const d = COUNTRY_DEFS[sel];
  const regions = REGIONS.filter((r) => r.origOwner === sel).length;
  const go = (g: GameState, slot: number, fresh: boolean) => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => begin(map, g, slot, fresh), prefs.fx ? 450 : 0);
  };
  const stats: [string, string, number, string][] = [
    ['👥', 'Население', POP(d.pop), fmt(d.pop * 1e6)],
    ['💰', 'Экономика', ECON(d.pop * d.gdp), `${fmt(d.pop * d.gdp * 1e9)} $`],
    ['⚔️', 'Армия', ARMY(d.army * d.weapons), fmt(d.army * 1000)],
    ['🎓', 'Образование', EDU(d.edu), `×${d.edu.toFixed(2)}`],
  ];
  return (
    <div class={`start ${leaving ? 'out' : ''}`}>
      <div class="start-particles" aria-hidden="true">
        {PARTICLES.map((p, i) => (
          <i key={i} style={{ left: `${p.x}%`, width: `${p.s}px`, height: `${p.s}px`, animationDelay: `-${p.d}s`, animationDuration: `${p.t}s` }} />
        ))}
      </div>
      <div class="start-inner">
        <div class="hero">
          <div class="crown">👑</div>
          <div class="logo">ДЕРЖАВА</div>
          <div class="tagline">Возьмите страну в свои руки. Мир не будет ждать.</div>
        </div>
        {showSaves && (
          <SaveSlots slots={slots} target={target} setTarget={setTarget} onPlay={(g, k) => go(g, k, false)} refresh={() => setSlots(allSlots())} />
        )}
        <Card title="🌍 Новая игра" sub="выберите страну">
          <div class="country-grid">
            {sorted.map(({ c, i }) => (
              <button key={c.id} class={`country-btn ${sel === i ? 'on' : ''}`} style={{ '--c': c.color }} onClick={() => setSel(i)}>
                <Flag id={i} />
                <span class="n">{c.name}</span>
              </button>
            ))}
          </div>
          <div class="small muted pick-hint">🖱️ Или нажмите на страну прямо на карте</div>
        </Card>
        <div class="card country-card" style={{ '--c': d.color }}>
          <div class="cc-head" key={sel}>
            <span class="cc-seal">{d.name[0]}</span>
            <div class="grow">
              <div class="cc-name">{d.name}</div>
              <div class="small muted">🏛️ {d.cities[0][0]} · {GOVS[d.gov].icon} {GOVS[d.gov].name} · {regions} регионов</div>
            </div>
          </div>
          <div class="cc-stats">
            {stats.map(([ic, label, v, txt]) => (
              <div class="cc-stat" key={label}>
                <span class="cc-l">{ic} {label}</span>
                <span class="cc-bar"><i style={{ width: `${Math.round(v * 100)}%` }} /></span>
                <span class="cc-v">{txt}</span>
              </div>
            ))}
          </div>
          <div class="sep" />
          <div class="small muted" style={{ marginBottom: '6px' }}>Сложность ботов</div>
          <Seg value={diff} onChange={setDiff} options={(Object.keys(DIFFICULTY) as Difficulty[]).map((k) => ({ v: k, label: DIFFICULTY[k].name }))} />
          <div class="small muted diff-hint" key={diff}>{DIFF_HINT[diff]}</div>
          <div class="small muted" style={{ margin: '10px 0 6px' }}>Сценарий</div>
          <Seg value={scenario} onChange={setScenario} options={SCENARIO_KEYS.map((k) => ({ v: k, label: `${SCENARIOS[k].icon} ${SCENARIOS[k].short}` }))} />
          <div class="small muted diff-hint" key={scenario}>
            {SCENARIOS[scenario].desc}{scenario === 'coldwar' && ` ${d.name}: ${blocName(blocOf(sel)).toLowerCase()}.`}
          </div>
          <button class="btn block shine start-go" onClick={() => go(newGame(sel, diff, Date.now(), scenario), target, true)}>
            👑 Принять власть
          </button>
          {showSaves && (
            <div class="small muted" style={{ marginTop: '6px', textAlign: 'center' }}>
              Запишется в слот {target}{occupied ? ' — прежнее сохранение уйдёт в корзину' : ''}.
            </div>
          )}
        </div>
        <Card title="📖 Как играть" fold="start-howto">
          <div class="small col" style={{ gap: '4px' }}>
            <div>⏱️ 1 секунда = 1 день. Свернули игру — время стоит. Кнопка ›× в верхней панели ускоряет время до ×3.</div>
            <div>🗺️ Нажмите на клетку своей страны, чтобы построить завод, университет и другое. Двойной тап — приблизить.</div>
            <div>📜 Налоги, бюджет и наука — во вкладке «Политика».</div>
            <div>🟢 Зелёная точка на вкладке — там можно что-то сделать прямо сейчас.</div>
            <div>🤝 Заключайте договоры с другими странами — торговля сразу добавит дохода. Или ⚔️ воюйте за их земли.</div>
            <div>☢️ Изучите ветку «Атом» в науке — с ядерной бомбой на вас побоятся нападать (вкладка «Армия»).</div>
            <div>🗳️ В демократии и республике бывают выборы, 🏦 деньги можно занять под процент («Политика»), 🕵️ разведка — во вкладке «Армия».</div>
            <div>📋 Выполняйте задания (кнопка на карте) — за них дают награды.</div>
            <div>❔ Нажмите «?» у любой карточки — там подсказка.</div>
            <div>⌨️ На ПК: пробел — пауза, 1–6 — вкладки, WASD — карта, Esc — меню.</div>
            <div>📐 Основайте свою масонскую ложу и 🌐 вносите резолюции в ООН — «Армия → Ложи» и «Армия → ООН».</div>
            <div>⚠️ Первые полтора года (≈9 минут на скорости ×1) боты не нападают — успейте окрепнуть.</div>
          </div>
        </Card>
        <Card title="🎵 Звук" fold="start-sound">
          <AudioSettings />
        </Card>
      </div>
    </div>
  );
}
