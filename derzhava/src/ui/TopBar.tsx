import { useEffect, useRef, useState } from 'preact/hooks';
import { availableTechs, buildCost, enemiesOf, techCost } from '../game/actions';
import { BUILDING_TYPES } from '../game/defs';
import { STATS } from '../game/economy';
import { isFree } from '../game/elections';
import type { GameState } from '../game/types';
import { fmt, fmtDate, fmtRate } from '../game/format';
import { getGame, headlines, type Headline } from '../game/state';
import { Flag, setText } from './common';
import { cycleSpeed, prefs, setUI, ui, useStore, type Tab } from './store';
import { COUNTRY_DEFS } from '../game/world';

export function TopBar() {
  useStore();
  const g = getGame()!;
  const c = g.countries[g.player];
  const s = STATS[g.player];
  const bar = useRef<HTMLDivElement>(null);
  const vBrains = useRef<HTMLSpanElement>(null);
  const vMoney = useRef<HTMLSpanElement>(null);
  const vPop = useRef<HTMLSpanElement>(null);

  // плавный счётчик между тиками
  useEffect(() => {
    let id = 0;
    const loop = () => {
      id = requestAnimationFrame(loop);
      const gm = getGame();
      if (!gm) return;
      const cc = gm.countries[gm.player];
      const ss = STATS[gm.player];
      const f = ui.paused || gm.gameOver ? 0 : ui.frac;
      setText(vBrains.current, fmt(cc.brains + ss.brainsRate * f));
      setText(vMoney.current, fmt(cc.money + ss.moneyRate * f));
      setText(vPop.current, fmt(ss.civPop + ss.popRate * f));
    };
    loop();
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!bar.current) return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--top-h', `${bar.current!.offsetHeight}px`);
    });
    ro.observe(bar.current);
    return () => ro.disconnect();
  }, []);

  const stabClass = c.stability >= 60 ? 'up' : c.stability < 35 ? 'down' : '';
  const wars = enemiesOf(g, g.player).length;
  return (
    <div class="topbar" ref={bar}>
      <div class="res-row">
        <button class="res brains" data-res="brains" onClick={() => setUI({ modal: { kind: 'details', res: 'brains' } })}>
          <div class="lbl">🧠 Интеллект</div>
          <div class="val"><span ref={vBrains}>{fmt(c.brains)}</span></div>
          <div class={`rate ${s.brainsRate >= 0 ? 'up' : 'down'}`}>{fmtRate(s.brainsRate)}</div>
        </button>
        <button class="res money" data-res="money" onClick={() => setUI({ modal: { kind: 'details', res: 'money' } })}>
          <div class="lbl">💰 Деньги</div>
          <div class={`val ${c.money < 0 ? 'down' : ''}`}><span ref={vMoney}>{fmt(c.money)}</span></div>
          <div class={`rate ${s.moneyRate >= 0 ? 'up' : 'down'}`}>{fmtRate(s.moneyRate)}</div>
        </button>
        <button class="res pop" data-res="pop" onClick={() => setUI({ modal: { kind: 'details', res: 'pop' } })}>
          <div class="lbl">👥 Население</div>
          <div class="val"><span ref={vPop}>{fmt(s.civPop)}</span></div>
          <div class={`rate ${s.popRate >= 0 ? 'up' : 'down'}`}>{fmtRate(s.popRate)}</div>
        </button>
      </div>
      <div class="status-row">
        <span class="st-country" title={COUNTRY_DEFS[g.player].name}><Flag id={g.player} /><b>{COUNTRY_DEFS[g.player].name}</b></span>
        <button class="st-chip" onClick={() => setUI({ modal: { kind: 'details', res: 'stab' } })} title="Стабильность">
          ⚖️ <b class={stabClass}>{c.stability.toFixed(0)}%</b>
          <i class="st-meter"><i class={stabClass} style={{ width: `${c.stability}%` }} /></i>
        </button>
        <button class={`st-chip ${wars > 0 ? 'war' : ''}`} onClick={() => setUI({ tab: 'army' as Tab })} title={wars > 0 ? 'Идёт война' : 'Военная мощь'}>
          {wars > 0 ? '🔥' : '⚔️'} <b>{fmt(s.power)}</b>
        </button>
        {g.elections.campaign && isFree(c.gov) && (
          <button class={`st-chip ${g.elections.approval >= 50 ? '' : 'war'}`} onClick={() => setUI({ tab: 'policy' as Tab, policyTab: 'power' })} title="Выборы: рейтинг власти">
            🗳️ <b>{Math.round(g.elections.approval)}%</b>
          </button>
        )}
        <span class="grow" />
        <div class="time-ctl">
          <button class={ui.paused ? 'on' : ''} onClick={() => setUI({ paused: !ui.paused })} aria-label="Пауза" title="Пауза (пробел)">
            {ui.paused ? '▶' : '⏸'}
          </button>
          <button class={`speed s${prefs.speed}`} onClick={cycleSpeed} aria-label="Скорость" title="Скорость времени (+ / −)">
            <span class="chevrons">{'›'.repeat(prefs.speed)}</span>×{prefs.speed}
          </button>
        </div>
        <button class="pause-btn" onClick={() => setUI({ modal: { kind: 'menu' } })} aria-label="Меню" title="Меню (Esc)">☰</button>
      </div>
      <NewsTicker />
    </div>
  );
}

/** Бегущая строка мировых новостей: каждая держится несколько секунд, нажатие — вся лента. */
function NewsTicker() {
  const g = getGame()!;
  const [cur, setCur] = useState<Headline | null>(null);
  const shown = useRef(0);
  useEffect(() => {
    let since = 0;
    const id = setInterval(() => {
      const pending = headlines.filter((h) => h.id > shown.current);
      if (!pending.length || performance.now() - since < 4500) return;
      // если новостей накопилось много — показываем свежие
      const next = pending.length > 3 ? pending[pending.length - 3] : pending[0];
      shown.current = next.id;
      since = performance.now();
      setCur(next);
    }, 400);
    return () => clearInterval(id);
  }, []);
  const text = cur?.text ?? g.log.find((l) => l.world)?.text ?? 'В мире пока спокойно…';
  return (
    <button class={`ticker ${cur?.kind ?? ''}`} onClick={() => setUI({ modal: { kind: 'news' } })}>
      <span class="tk-label">📰</span>
      <span class="tk-text" key={cur?.id ?? 0}>{text}</span>
      <span class="tk-date">{fmtDate(g.day)}</span>
    </button>
  );
}

const TABS: { id: Tab; ic: string; label: string }[] = [
  { id: 'map', ic: '🗺️', label: 'Карта' },
  { id: 'policy', ic: '📜', label: 'Политика' },
  { id: 'build', ic: '🏗️', label: 'Стройка' },
  { id: 'army', ic: '⚔️', label: 'Армия' },
  { id: 'market', ic: '🏪', label: 'Рынок' },
  { id: 'stats', ic: '📊', label: 'Статистика' },
];

/** Можно что-то полезное сделать прямо сейчас: свободное место стройки и деньги на него, доступная технология. */
function hints(g: GameState): Partial<Record<Tab, boolean>> {
  const me = g.player;
  const c = g.countries[me];
  const s = STATS[me];
  if (!s) return {};
  const cap = c.capital;
  const canBuild = s.constructing < s.slots && BUILDING_TYPES.some((t) => c.money >= buildCost(g, me, t, 1, cap));
  const canResearch = availableTechs(g, me).some((t) => c.brains >= techCost(g, me, t.id));
  return { build: canBuild, policy: canResearch };
}

export function BottomNav() {
  useStore();
  const g = getGame()!;
  const badges: Partial<Record<Tab, number>> = {
    army: g.proposals.length + g.battles.filter((b) => b.att === g.player || b.def === g.player).length + g.rebels.filter((r) => r.country === g.player).length,
    market: STATS[g.player]?.hunger > 0 ? 1 : 0,
  };
  const dots = hints(g);
  return (
    <nav class="nav">
      {TABS.map((t, i) => (
        <button
          key={t.id} class={ui.tab === t.id ? 'active' : ''} title={`${t.label} (${i + 1})`} aria-label={t.label}
          onClick={() => setUI({
            tab: t.id, tile: t.id === 'map' ? ui.tile : -1,
            ...(t.id === 'policy' && dots.policy && ui.tab !== 'policy' ? { policyTab: 'science' as const } : {}),
            // пришли предложения от стран — сразу открываем дипломатию
            ...(t.id === 'army' && g.proposals.length && ui.tab !== 'army' ? { armyTab: 'diplo' as const } : {}),
          })}
        >
          <span class="ic">{t.ic}</span>
          {badges[t.id] ? <span class="badge">{badges[t.id]}</span> : dots[t.id] ? <span class="badge dot" /> : null}
        </button>
      ))}
    </nav>
  );
}

/** Плашка «Пауза» под верхней панелью. */
export function PausedBadge() {
  useStore();
  const g = getGame();
  const on = !!g && ui.paused && !g.gameOver;
  // на паузе карта приглушается
  useEffect(() => {
    document.documentElement.classList.toggle('is-paused', on);
    return () => document.documentElement.classList.remove('is-paused');
  }, [on]);
  if (!on) return null;
  return (
    <button class="paused-badge" onClick={() => setUI({ paused: false })}>
      ⏸ Пауза <span class="muted">— нажмите, чтобы продолжить</span>
    </button>
  );
}
