import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { SG_EVENT } from '../game/assembly';
import { STATS } from '../game/economy';
import { resolveEvent } from '../game/events';
import { isSessionEvent } from '../game/session';
import { fmt, fmtDate } from '../game/format';
import { claimQuest, questIcon, questProgress, questText, SKIP_COOLDOWN, skipQuest } from '../game/quests';
import { activeSlot, deleteSave, saveGame } from '../game/save';
import { banners, deals, dismissToast, emit, getGame, setGame, toast, toasts, type Deal } from '../game/state';
import { COUNTRY_DEFS, REGIONS } from '../game/world';
import type { MapView } from '../map/MapView';
import { AudioSettings } from './AudioSettings';
import { InstallApp } from './InstallApp';
import { MailModal } from './Mail';
import { downloadGame } from './Saves';
import { Bar, CountUp, Effects, KV, More, Rate, relColor } from './common';
import { AttackDialog } from './panels/ArmyPanel';
import { CountryDialog, ProposalRow } from './panels/DiploPanel';
import { IncomeTable, StabilityBreakdown } from './panels/PolicyPanel';
import { cycleSpeed, prefs, report, setPrefs, setUI, ui, useStore } from './store';

const EVENT_TAG: Record<string, string> = {
  event: '📜 Событие', demand: '📢 Голос народа', un: '🌐 Совет Безопасности ООН', lodge: '👁️ Тайная ложа', election: '🗳️ Выборы', debt: '🏦 Финансы',
  session: '🌐 Генассамблея ООН · чрезвычайная сессия', sg: '🌐 Генеральная Ассамблея ООН',
};
/** Подпись окна: у ООН их три — Совбез, выборы Генсека и чрезвычайная сессия. */
const tagOf = (ev: { id: string; kind?: string }) =>
  EVENT_TAG[isSessionEvent(ev.id) ? 'session' : ev.id === SG_EVENT ? 'sg' : ev.kind ?? 'event'];

export function Modals({ map }: { map: MapView }) {
  useStore();
  const g = getGame();
  if (!g) return null;
  if (g.gameOver) return <GameOver map={map} />;
  if (g.event) {
    const ev = g.event;
    return (
      <div class="modal-bg">
        <div class={`modal ev-modal ${ev.kind ?? 'event'}`} key={`${ev.id}-${ev.title}`}>
          <div class="ev-head" aria-hidden="true">
            <i class="ev-rays" />
            <span class="ev-medal"><span>{ev.icon}</span></span>
          </div>
          <div class="demand-tag">{tagOf(ev)}</div>
          <h2>{ev.title}</h2>
          <p class="ev-text">{ev.text}</p>
          {ev.options.map((o, i) => (
            <button key={i} class="btn ev-opt" style={{ animationDelay: `${0.12 + i * 0.07}s` }} onClick={() => { resolveEvent(g, i); emit(); }}>
              <span class="ev-label"><b class="ev-n">{i + 1}</b>{o.label}</span>
              <Effects hint={o.hint} />
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (deals.length) return <DealModal key={deals[0].id} d={deals[0]} />;
  const m = ui.modal;
  if (!m) return null;
  if (m.kind === 'mail') return <MailModal id={m.id} quick={m.quick} />;
  const close = () => setUI({ modal: null });
  let body: ComponentChildren = null;
  if (m.kind === 'country') body = <CountryDialog id={m.id} />;
  else if (m.kind === 'attack') body = <AttackDialog rid={m.rid} />;
  else if (m.kind === 'details') body = <Details res={m.res} />;
  else if (m.kind === 'menu') body = <Menu map={map} />;
  else if (m.kind === 'quests') body = <QuestsDialog />;
  else if (m.kind === 'news') body = <NewsDialog />;
  else if (m.kind === 'confirm') {
    body = (
      <>
        <h2>{m.title}</h2>
        <p>{m.text}</p>
        <div class="grid2">
          <button class="btn ghost" onClick={close}>Отмена</button>
          <button class={`btn ${m.danger ? 'danger' : ''}`} onClick={() => { close(); m.ok(); emit(); }}>{m.okText ?? 'Да'}</button>
        </div>
      </>
    );
  }
  return (
    <div class="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="modal">{body}</div>
    </div>
  );
}

function Details({ res }: { res: 'money' | 'brains' | 'pop' | 'stab' }) {
  const g = getGame()!;
  const c = g.countries[g.player];
  const s = STATS[g.player];
  const close = () => setUI({ modal: null });
  return (
    <>
      {res === 'money' && (
        <>
          <div class="m-ic">💰</div>
          <h2>Казна: {fmt(c.money)}</h2>
          <div class="card"><IncomeTable /></div>
        </>
      )}
      {res === 'brains' && (
        <>
          <div class="m-ic">🧠</div>
          <h2>Интеллект: {fmt(c.brains)}</h2>
          <div class="card">
            <KV rows={[
              ['От населения и образования', <Rate v={s.brainsBase} />],
              ['От университетов', <Rate v={s.brainsUni} />],
              [`От учёных (${fmt(c.scientists)})`, <Rate v={s.brainsSci} />],
              [<b>Итого</b>, <Rate v={s.brainsRate} />],
            ]} />
          </div>
        </>
      )}
      {res === 'pop' && (
        <>
          <div class="m-ic">👥</div>
          <h2>Население: {fmt(s.civPop)}</h2>
          <div class="card">
            <KV rows={[
              ['Прирост', <Rate v={s.popRate} />],
              ['Предел', fmt(s.popCap)],
              ['🌾 Еды хватает', s.hunger > 0 ? <b class="down">голод {Math.round(s.hunger * 100)}%</b> : `${Math.floor(c.food / Math.max(1, s.foodCons))} дн.`],
            ]} />
            <More>
              <KV rows={[
                ['Рост в год', `${s.growthYear.toFixed(2)}%`],
                ['В армии', fmt(c.soldiers)],
                ['Регионов', s.regions.length],
                ['🧑‍🔬 Учёных', fmt(c.scientists)],
                ['💎 Миллиардеров', Math.round(c.billionaires)],
                ['🏢 Мировых компаний', s.companies],
              ]} />
            </More>
          </div>
        </>
      )}
      {res === 'stab' && (
        <>
          <div class="m-ic">⚖️</div>
          <h2>Стабильность</h2>
          <div class="card"><StabilityBreakdown /></div>
        </>
      )}
      <button class="btn ghost block" onClick={close}>Закрыть</button>
    </>
  );
}

function Menu({ map }: { map: MapView }) {
  const g = getGame()!;
  const save = () => {
    if (saveGame(g)) toast(`💾 Игра сохранена (слот ${activeSlot()})`, 'good');
    else toast('Не удалось сохранить: хранилище браузера переполнено или недоступно. Скачайте сохранение файлом', 'bad');
  };
  return (
    <>
      <div class="m-ic">👑</div>
      <h2>{COUNTRY_DEFS[g.player].name}</h2>
      <p class="small muted">{fmtDate(g.day)} · день {g.day}</p>
      <div class="col">
        <button class="btn block" onClick={() => setUI({ modal: null })}>▶ Продолжить</button>
        <button class="btn ghost block" onClick={() => { save(); setUI({ modal: null }); }}>💾 Сохранить · слот {activeSlot()}</button>
        <button class="btn ghost block" onClick={() => downloadGame(g)}>⬇ Скачать сохранение файлом</button>
        <button class="btn ghost block" onClick={() => { setUI({ modal: null, tab: 'map' }); map.focusTile(REGIONS[g.countries[g.player].capital].center, 1.5); }}>🏛️ К столице</button>
        <button class="btn ghost block" onClick={() => { save(); setUI({ modal: null, tab: 'map', tile: -1 }); map.setGame(null); setGame(null); }}>🏠 Главное меню — новая игра или другой слот</button>
      </div>
      <div class="card" style={{ marginTop: '12px' }}>
        <div class="row between audio-row">
          <span>⏩ Скорость времени</span>
          <button class="toggle on" onClick={cycleSpeed}>×{prefs.speed}</button>
        </div>
        <div class="row between audio-row">
          <span>✨ Анимации и эффекты</span>
          <button class={`toggle ${prefs.fx ? 'on' : ''}`} aria-pressed={prefs.fx} onClick={() => setPrefs({ fx: !prefs.fx })}>{prefs.fx ? 'Вкл' : 'Выкл'}</button>
        </div>
        <div class="small muted">На слабом телефоне выключите эффекты — игра станет плавнее.</div>
      </div>
      <div class="card"><AudioSettings /></div>
      <InstallApp />
      <div class="small muted" style={{ marginTop: '10px', textAlign: 'center', opacity: 0.7 }}>Иконки: game-icons.net (Lorc, Delapouite и др.), CC BY 3.0</div>
    </>
  );
}

function QuestsDialog() {
  const g = getGame()!;
  const wait = (g.counters.questSkip ?? -999) + SKIP_COOLDOWN - g.day;
  return (
    <>
      <div class="m-ic">📋</div>
      <h2>Задания</h2>
      {g.quests.length === 0 && <p class="small muted">Новых заданий пока нет — загляните чуть позже.</p>}
      {g.quests.map((q) => (
        <div class={`quest ${q.done ? 'done' : ''}`} key={q.id}>
          <span class="big-ic">{questIcon(q)}</span>
          <div class="grow">
            <b>{questText(g, q)}</b>
            <div class="small muted">Награда: 💰 {fmt(q.reward.money)}{q.reward.brains > 0 ? ` · 🧠 ${fmt(q.reward.brains)}` : ''}</div>
            <div style={{ marginTop: '4px' }}><Bar value={questProgress(g, q)} color={q.done ? 'green' : undefined} /></div>
          </div>
          {q.done ? (
            <button class="btn sm green" onClick={() => { claimQuest(g, q.id); emit(); }}>🎁 Забрать</button>
          ) : (
            <button class="btn sm ghost" disabled={wait > 0} aria-label="Заменить задание" onClick={() => report(skipQuest(g, q.id))}>🔄</button>
          )}
        </div>
      ))}
      <p class="small muted" style={{ marginTop: '8px' }}>
        🔄 — заменить задание другим {wait > 0 ? `(можно через ${Math.ceil(wait)} дн.)` : '(раз в 60 дней)'} · выполнено всего: {g.counters.quests ?? 0}
      </p>
      <button class="btn ghost block" onClick={() => setUI({ modal: null })}>Закрыть</button>
    </>
  );
}

function NewsDialog() {
  const g = getGame()!;
  const items = g.log.filter((l) => l.world).slice(0, 50);
  return (
    <>
      <div class="m-ic">📰</div>
      <h2>Мировые новости</h2>
      <div class="card">
        {items.length === 0 && <div class="small muted">Пока в мире спокойно.</div>}
        {items.map((l, i) => (
          <div class="small" key={i} style={{ marginBottom: '5px' }}>
            <span class="muted">{fmtDate(l.day)}</span> <span class={l.kind === 'bad' ? 'down' : l.kind === 'good' ? 'up' : ''}>{l.text}</span>
          </div>
        ))}
      </div>
      <button class="btn ghost block" onClick={() => setUI({ modal: null })}>Закрыть</button>
    </>
  );
}

export function QuestButton() {
  useStore();
  const g = getGame();
  if (!g || ui.tab !== 'map' || g.gameOver) return null;
  const done = g.quests.filter((q) => q.done).length;
  const best = g.quests.reduce((m, q) => Math.max(m, q.done ? 1 : questProgress(g, q)), 0);
  return (
    <button class={`quest-fab ${done ? 'ready' : ''}`} onClick={() => setUI({ modal: { kind: 'quests' } })} title="Задания (J)">
      <span class="qi">📋</span>
      <span class="ql">Задания</span>
      <span class="qbar"><i style={{ width: `${Math.round(best * 100)}%` }} /></span>
      {done > 0 && <span class="badge">{done}</span>}
    </button>
  );
}

function GameOver({ map }: { map: MapView }) {
  const g = getGame()!;
  return (
    <div class="modal-bg">
      <div class="modal gameover">
        <div class="m-ic">💀</div>
        <h2>Держава пала</h2>
        <p>{COUNTRY_DEFS[g.player].name} потеряла все земли. Вы правили {g.day} дней.</p>
        <button class="btn ghost block" style={{ marginBottom: '8px' }} onClick={() => downloadGame(g)}>⬇ Скачать партию на память</button>
        <button class="btn block" onClick={() => { deleteSave(); setUI({ modal: null, tab: 'map', tile: -1 }); map.setGame(null); setGame(null); }}>Начать заново</button>
      </div>
    </div>
  );
}

export function Toasts() {
  useStore();
  return (
    <div class="toasts">
      {toasts.map((t) => (
        <div key={t.id} class={`toast ${t.kind} ${t.leaving ? 'leaving' : ''}`} onClick={() => dismissToast(t.id)}>{t.text}</div>
      ))}
    </div>
  );
}

/** Баннер важного события: держится несколько секунд, нажатие — убрать. */
export function Banners() {
  useStore();
  const b = banners[0];
  useEffect(() => {
    if (!b) return;
    const t = setTimeout(() => {
      if (banners[0] === b) {
        banners.shift();
        emit();
      }
    }, 3600);
    return () => clearTimeout(t);
  }, [b?.id]);
  if (!b || getGame()?.event) return null;
  const close = () => {
    if (banners[0] === b) banners.shift();
    emit();
  };
  return (
    <div class={`banner ${b.kind}`} key={b.id} onClick={close} role="status">
      <div class="bn-rays" aria-hidden="true" />
      <div class="bn-ic">{b.icon}</div>
      <div class="bn-body">
        <div class="bn-title">{b.title}</div>
        <div class="bn-text">{b.text}</div>
      </div>
    </div>
  );
}

export function ProposalCard() {
  useStore();
  const g = getGame()!;
  if (!g.proposals.length || ui.tile >= 0 || ui.tab !== 'map') return null;
  return (
    <div class="proposal">
      <ProposalRow id={g.proposals[0].id} />
    </div>
  );
}

const DEAL_INFO: Record<Deal['kind'], { icon: string; title: string; ribbon: string }> = {
  trade: { icon: '🤝', title: 'Торговый договор', ribbon: 'Договор подписан' },
  pact: { icon: '📜', title: 'Пакт о ненападении', ribbon: 'Договор подписан' },
  alliance: { icon: '🛡️', title: 'Военный союз', ribbon: 'Союз заключён' },
  peace: { icon: '🕊️', title: 'Мирный договор', ribbon: 'Мир заключён' },
};

const CONFETTI = Array.from({ length: 26 }, (_, i) => ({
  x: (i * 37) % 100,
  d: ((i * 53) % 90) / 100,
  r: (i * 71) % 360,
  c: ['#f2d78b', '#d8b45c', '#5fd38a', '#7cc7ff', '#ffffff'][i % 5],
}));

const signed = (v: number) => (v >= 0 ? '+' : '') + fmt(v);

/** Праздничное окно: договор подписан — показываем, что выросло. */
function DealModal({ d }: { d: Deal }) {
  const g = getGame()!;
  const info = DEAL_INFO[d.kind];
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 350);
    return () => clearTimeout(t);
  }, []);
  const close = () => {
    deals.shift();
    emit();
  };
  // главный показатель: что именно выросло
  const isRel = d.kind === 'pact' || d.kind === 'peace';
  const main =
    d.kind === 'trade' ? { label: 'Доход казны в секунду', from: d.rateBefore, to: d.rateAfter, unit: '/сек' }
    : d.kind === 'alliance' ? { label: 'Военная мощь вместе с союзником', from: d.powerBefore, to: d.powerAfter, unit: '' }
    : { label: 'Отношения', from: d.relBefore, to: d.relAfter, unit: '' };
  const delta = main.to - main.from;
  const pct = Math.abs(main.from) > 1e-9 ? (delta / Math.abs(main.from)) * 100 : 0;
  const scale = Math.max(Math.abs(main.from), Math.abs(main.to), 1e-9);
  const w = (v: number) => `${isRel ? (v + 100) / 2 : Math.max(0, (v / scale) * 100)}%`;
  const num = isRel ? signed : fmt;
  const facts: [string, ComponentChildren][] = [];
  if (d.kind === 'trade') facts.push(['📅 За год принесёт', <b class="up">+{fmt(delta * 365)} 💰</b>]);
  if (d.kind === 'pact') facts.push(['🛡️ Граница', <span>{COUNTRY_DEFS[d.partner].name} не нападёт</span>]);
  if (d.kind === 'alliance') facts.push(['⚔️ В войне', <span>союзник встанет на вашу сторону</span>]);
  if (d.kind === 'peace') {
    facts.push(['🕊️ Перемирие', <span>на целый год</span>]);
    if (d.soldiersBack) facts.push(['💂 Вернулись с фронта', <b>{fmt(d.soldiersBack)}</b>]);
  }
  if (!isRel) facts.push(['❤️ Отношения', <b style={{ color: relColor(d.relAfter) }}>{signed(d.relBefore)} → {signed(d.relAfter)}</b>]);
  return (
    <div class="modal-bg deal-bg" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class={`modal deal ${d.kind}`}>
        <div class="confetti" aria-hidden="true">
          {CONFETTI.map((p, i) => (
            <i key={i} style={{ left: `${p.x}%`, animationDelay: `${p.d}s`, background: p.c, '--r': `${p.r}deg` }} />
          ))}
        </div>
        <div class="deal-ribbon">{info.ribbon}</div>
        <div class="deal-seals">
          <span class="seal l" style={{ background: COUNTRY_DEFS[g.player].color }}>{COUNTRY_DEFS[g.player].name[0]}</span>
          <span class="deal-ic">{info.icon}</span>
          <span class="seal r" style={{ background: COUNTRY_DEFS[d.partner].color }}>{COUNTRY_DEFS[d.partner].name[0]}</span>
        </div>
        <div class="deal-names"><span>{COUNTRY_DEFS[g.player].name}</span><span>{COUNTRY_DEFS[d.partner].name}</span></div>
        <h2>{info.title}</h2>
        <div class="deal-main">
          <div class="dm-label">{main.label}</div>
          <div class="dm-row">
            <span class="dm-before">{num(main.from)}{main.unit}</span>
            <span class="dm-arrow">➜</span>
            <span class="dm-after"><CountUp from={main.from} to={main.to} format={num} />{main.unit}</span>
          </div>
          {delta > 0 && (
            <div class="dm-delta">▲ +{fmt(delta)}{main.unit}{pct >= 0.5 && !isRel ? ` · +${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%` : ''}</div>
          )}
          <div class="dm-bars">
            <div class="dm-bar was"><span>было</span><b><i style={{ width: w(main.from) }} /></b></div>
            <div class="dm-bar now"><span>стало</span><b><i style={{ width: grown ? w(main.to) : w(main.from) }} /></b></div>
          </div>
        </div>
        <div class="deal-facts">
          {facts.map(([k, v], i) => <div key={i} class="row between"><span class="muted">{k}</span>{v}</div>)}
        </div>
        <button class="btn block deal-ok" onClick={close}>Отлично!</button>
      </div>
    </div>
  );
}
