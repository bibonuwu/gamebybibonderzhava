// Тайная ложа «Всевидящее око» — масоны среди правителей мира. Ложа есть с начала партии: в ней несколько ботов,
// Великий мастер получает половину взносов братьев. Игрока приглашают письмом (mail.ts): принять посвящение,
// отказаться или запретить ложу в стране — тогда она мстит.
// Член ложи растёт в степенях (Ученик → Подмастерье → Мастер; Великого мастера избирают раз в два года), копит
// 🔺 влияние — взносами, поручениями ложи и пожертвованиями — и тратит его на тайные услуги: компромат, переворот,
// биржевой сговор, кулуары ООН. Каждая услуга поднимает 🕵️ подозрение; докопаются газеты — скандал.
// Братья дружат (ai.ts → driftRelations), охотнее подписывают договоры и не воюют друг с другом; поднял меч на брата — изгнан.
import { addRel, atWar, availableTechs, cname, makePeace, maxTrade, pair, peekPair } from './actions';
import { GOVS, LODGE_OPEN_STAB } from './defs';
import { computeAll, STATS } from './economy';
import { fmt } from './format';
import { shockMarket } from './market';
import { dropBrother, inOrder } from './order';
import { allBuildings, banner, log, news, pick, rand, sfx } from './state';
import type { BuildingType, GameState, GovType, LodgeState, LodgeTask, LogEntry, Personality, TempMod } from './types';
import { isAggressor, P5, sanctions } from './un';
import { COUNTRY_DEFS, REGION_OF } from './world';

export const LODGE_NAME = 'Всевидящее око';
const TERM = 730; // Великого мастера избирают раз в два года
const START_MEMBERS = 6;
const MAX_MEMBERS = 10; // больше братьев-ботов ложа не набирает

/** Степени посвящения: от заслуг; Великого мастера избирают братья. */
export const RANKS = [
  { name: 'Ученик', icon: '🕯️', merit: 0 },
  { name: 'Подмастерье', icon: '📐', merit: 60 },
  { name: 'Мастер', icon: '⚒️', merit: 180 },
  { name: 'Великий мастер', icon: '👁️', merit: Infinity },
];

/** Кого ложа зовёт охотнее: фанатики не вступают никогда. */
export const JOIN_WISH: Record<Personality, number> = { trader: 3, scientist: 2.5, cautious: 1.5, aggressor: 1, fanatic: 0 };
/** Как быстро забывается подозрение: свободная пресса помнит дольше. */
const SUSP_DECAY: Record<GovType, number> = { democracy: 0.04, republic: 0.05, monarchy: 0.06, dictatorship: 0.09 };
/** Насколько легко газетам докопаться до правды. */
const EXPOSE: Record<GovType, number> = { democracy: 1.3, republic: 1.1, monarchy: 0.9, dictatorship: 0.6 };

// ---------- кто есть кто ----------
export const isMember = (g: GameState, i: number) => g.lodge.members.includes(i);
export const brothers = (g: GameState, a: number, b: number) => a !== b && isMember(g, a) && isMember(g, b);
/** Игрок знает о ложе: пришло приглашение или он уже сделал выбор. */
export const lodgeKnown = (g: GameState) => g.lodge.status !== 'none' || g.mailSeen.includes('lodge_invite');
/** Масоны, о которых знает игрок: члену ложи известны все братья, остальным — только разоблачённые газетами. */
export const visibleMembers = (g: GameState) =>
  g.lodge.members.filter((k) => k !== g.player && g.countries[k].alive
    && (g.lodge.status === 'member' || g.lodge.known.includes(k) || (g.intel?.watch[k] ?? 0) > g.day)); // досье разведки тоже знает
/** Братья-боты игрока. */
const botBrothers = (g: GameState) => g.lodge.members.filter((k) => k !== g.player && g.countries[k].alive);
/** Братья в ООН прикрывают игрока (услуга «Кулуары ООН»): k не вводит санкций, а в Совбезе накладывает вето. */
export const lodgeShield = (g: GameState, k: number) =>
  g.lodge.status === 'member' && (g.lodge.shield ?? 0) > g.day && k !== g.player && isMember(g, k);

/** Степень игрока (-1 — не в ложе). */
export function rankOf(g: GameState): number {
  const L = g.lodge;
  if (L.status !== 'member') return -1;
  if (L.master === g.player) return 3;
  return L.merit >= RANKS[2].merit ? 2 : L.merit >= RANKS[1].merit ? 1 : 0;
}
/** Сколько 🔺 приходит каждый день: игроку — за степень, ботам — по размеру экономики. */
export function infRate(g: GameState, k: number): number {
  if (k === g.player) return 0.1 + 0.02 * Math.max(0, rankOf(g));
  const big = Math.max(1, ...botBrothers(g).map((x) => Math.max(0, STATS[x]?.gdpIndex ?? 0)));
  return 0.06 + (0.18 * Math.max(0, STATS[k]?.gdpIndex ?? 0)) / big;
}

const econ = (i: number) => COUNTRY_DEFS[i].pop * COUNTRY_DEFS[i].gdp;
const income = (g: GameState) => Math.max(30, STATS[g.player].taxIncome);
const scale = (g: GameState) => Math.max(30, g.countries[g.player].moneyScale);
function mod(g: GameState, i: number, kind: TempMod['kind'], value: number, days: number, label: string) {
  g.countries[i].mods.push({ kind, value, until: g.day + days, label });
}
/** Тайная новость: член ложи узнаёт правду, остальной мир — только то, что напишут газеты. */
function whisper(g: GameState, secret: string, publicText?: string, kind: LogEntry['kind'] = 'info') {
  if (g.lodge.status === 'member') log(g, `👁️ Шёпот ложи: ${secret}`, 'info');
  else if (publicText) news(g, publicText, kind);
}

// ---------- начало партии ----------
export function initLodge(g: GameState): LodgeState {
  const n = g.countries.length;
  const L: LodgeState = {
    members: [], known: [], inf: new Array(n).fill(0), master: -1, status: 'none', merit: 0, suspicion: 0,
    nextTask: 0, cd: {}, nextElection: g.day + TERM, nextPlot: g.day + 200 + Math.floor(rand(g) * 150),
  };
  const maxEcon = Math.max(...COUNTRY_DEFS.map((_, i) => econ(i)));
  const pool = g.countries.filter((c) => c.alive && c.idx !== g.player && JOIN_WISH[c.personality] > 0).map((c) => c.idx);
  while (L.members.length < START_MEMBERS && pool.length) {
    const w = pool.map((i) => JOIN_WISH[g.countries[i].personality] * (0.4 + Math.sqrt(econ(i) / maxEcon)));
    let x = rand(g) * w.reduce((s, v) => s + v, 0);
    let k = 0;
    while (k < pool.length - 1 && (x -= w[k]) > 0) k++;
    const i = pool.splice(k, 1)[0];
    L.members.push(i);
    L.inf[i] = 20 + rand(g) * 60;
  }
  // мастером стал самый богатый из братьев
  if (L.members.length) {
    const top = L.members.reduce((a, i) => (econ(i) > econ(a) ? i : a));
    L.inf[top] += 40;
    L.master = top;
  }
  return L;
}

// ---------- день ----------
export function tickLodge(g: GameState) {
  const L = g.lodge;
  const me = g.player;
  for (const k of L.members) if (g.countries[k].alive) L.inf[k] += infRate(g, k);
  if (L.status === 'member') {
    const c = g.countries[me];
    L.merit += infRate(g, me);
    L.suspicion = Math.max(0, L.suspicion - SUSP_DECAY[c.gov]);
    checkRank(g);
    tickTask(g);
    // газеты копают: чем сильнее подозрение, тем вероятнее разоблачение
    if (!L.open && L.suspicion >= 25 && !g.event) {
      const p = Math.pow((L.suspicion - 15) / 100, 2) * 0.012 * EXPOSE[c.gov];
      if (rand(g) < p) expose(g);
    }
  }
  // газеты иногда раскрывают и ботов-масонов: кто-то после скандала уходит из ложи
  for (const k of botBrothers(g)) {
    if (L.known.includes(k) || rand(g) >= 0.00025) continue;
    L.known.push(k);
    mod(g, k, 'stab', -5, 120, 'Масонский скандал');
    news(g, `📰 Сенсация: правитель страны ${cname(g, k)} — член тайной ложи «${LODGE_NAME}»`, 'info');
    if (rand(g) < 0.35) {
      dropMember(g, k);
      whisper(g, `после скандала ${cname(g, k)} вышла из ложи`);
    }
  }
  if (g.day >= L.nextElection) election(g);
  if (g.day >= L.nextPlot) intrigue(g);
}

function checkRank(g: GameState) {
  const r = rankOf(g);
  const prev = g.counters.lodgeRank ?? 0;
  if (r === prev) return;
  g.counters.lodgeRank = r;
  if (r < prev || r <= 0) return;
  const R = RANKS[r];
  sfx('achievement');
  if (r === 3) {
    log(g, `👁️ Братья избрали нас Великим мастером ложи «${LODGE_NAME}»`, 'good', false);
    banner({ icon: '👁️', title: 'Великий мастер', text: 'Половина взносов братьев идёт в нашу казну, тайные услуги дешевле', kind: 'gold' });
  } else {
    log(g, `${R.icon} Ложа возвела нас в степень «${R.name}»`, 'good', false);
    banner({ icon: R.icon, title: 'Новая степень', text: `Ложа возвела нас в степень «${R.name}» — открыты новые тайные услуги`, kind: 'gold' });
  }
  (g.mailQueue ??= []).push({ day: g.day + 2, tpl: 'lodge_rank', vals: [r] });
}

/** Игрок получает 🔺: влияние тратится на услуги, а заслуги копятся и дают степень. */
function earn(g: GameState, v: number) {
  g.lodge.inf[g.player] += v;
  g.lodge.merit += v;
  checkRank(g);
}

// ---------- выбор игрока ----------
export function joinLodge(g: GameState): string | null {
  const L = g.lodge;
  const me = g.player;
  if (L.status === 'member') return 'Вы уже в ложе';
  if (L.status === 'expelled') return 'Ложа не прощает тех, кто поднял меч на брата';
  if (L.status === 'banned') return 'Сначала снимите запрет на ложу';
  if (g.order) return `Вы — мастер своей ложи «${g.order.name}»: братья не терпят двойной верности`;
  L.status = 'member';
  L.joined = g.day;
  L.merit = 0;
  L.inf[me] = 10;
  L.suspicion = 0;
  L.open = false;
  L.task = undefined;
  L.nextTask = g.day + 20;
  if (!L.members.includes(me)) L.members.push(me);
  g.counters.lodgeRank = 0;
  g.counters.lodgeJoined = (g.counters.lodgeJoined ?? 0) + 1;
  for (const k of botBrothers(g)) addRel(g, me, k, 10);
  sfx('achievement');
  log(g, `🕯️ Посвящение: мы — Ученик ложи «${LODGE_NAME}»`, 'good', false);
  banner({ icon: '🕯️', title: 'Посвящение', text: `Вы — Ученик тайной ложи. Братьев в мире: ${botBrothers(g).length}`, kind: 'gold' });
  computeAll(g);
  return null;
}

export function refuseLodge(g: GameState) {
  if (g.lodge.status !== 'none') return;
  g.lodge.status = 'refused';
  log(g, '🚪 Мы вежливо отказались от приглашения в ложу', 'info', false);
}

/** Религиозная страна запрет одобрит горячее. */
export const BAN_STAB: Record<string, number> = { theocracy: 8, state: 6, freedom: 3, secular: 2 };
export function banLodge(g: GameState): string | null {
  const L = g.lodge;
  const me = g.player;
  if (L.status === 'banned') return 'Ложа уже под запретом';
  if (L.status === 'member') leaveLodge(g, true);
  L.status = 'banned';
  L.nextPlot = Math.min(L.nextPlot, g.day + 90);
  mod(g, me, 'stab', BAN_STAB[g.countries[me].religion], 365, 'Запрет тайной ложи');
  for (const k of botBrothers(g)) addRel(g, me, k, -20);
  g.counters.lodgeBanned = (g.counters.lodgeBanned ?? 0) + 1;
  sfx('alarm');
  log(g, `🚫 Тайная ложа в стране запрещена. Народ доволен, но ложа этого не забудет`, 'info', false);
  computeAll(g);
  return null;
}

export function liftBan(g: GameState): string | null {
  const L = g.lodge;
  if (L.status !== 'banned') return 'Ложа не запрещена';
  L.status = 'refused';
  mod(g, g.player, 'stab', -3, 90, 'Отмена запрета ложи');
  for (const k of botBrothers(g)) addRel(g, g.player, k, 10);
  computeAll(g);
  return null;
}

/** Снова постучаться в ложу, если когда-то отказались. */
export const knockCost = (g: GameState) => scale(g) * 60;
export function knockError(g: GameState): string | null {
  const L = g.lodge;
  if (L.status === 'expelled') return 'Ложа не прощает тех, кто поднял меч на брата';
  if (L.status !== 'refused') return 'Недоступно';
  if (g.order) return `Сначала распустите свою ложу «${g.order.name}»`;
  const b = botBrothers(g);
  if (b.length && b.reduce((s, k) => s + g.rel[g.player][k], 0) / b.length < -10) return 'Братья нам не доверяют — нужны отношения получше';
  if (g.countries[g.player].money < knockCost(g)) return 'Не хватает денег';
  return null;
}
export function knock(g: GameState): string | null {
  const err = knockError(g);
  if (err) return err;
  g.countries[g.player].money -= knockCost(g);
  g.lodge.status = 'none';
  return joinLodge(g);
}

/** Выйти из ложи: влияние сгорает, братья обижаются. */
export function leaveLodge(g: GameState, quiet = false) {
  const L = g.lodge;
  const me = g.player;
  if (L.status !== 'member') return;
  for (const k of botBrothers(g)) addRel(g, me, k, -15);
  dropMember(g, me);
  L.status = 'refused';
  L.inf[me] = 0;
  L.merit = 0;
  L.task = undefined;
  L.shield = undefined;
  L.open = false;
  g.counters.lodgeRank = 0;
  if (!quiet) log(g, '🚪 Мы вышли из тайной ложи', 'info', false);
  computeAll(g);
}

function dropMember(g: GameState, k: number) {
  const L = g.lodge;
  L.members = L.members.filter((x) => x !== k);
  if (L.master === k) {
    L.master = -1;
    L.nextElection = Math.min(L.nextElection, g.day + 60);
  }
}

/** Страны не стало — в ложе на одного брата меньше. */
export function onLodgeDestroyed(g: GameState, ci: number) {
  dropMember(g, ci);
  g.lodge.known = g.lodge.known.filter((k) => k !== ci);
}

/** a объявила войну брату b: ложа изгоняет того, кто поднял меч на брата. */
export function onBrotherWar(g: GameState, a: number, b: number) {
  const L = g.lodge;
  const me = g.player;
  if (a === me) {
    for (const k of botBrothers(g)) addRel(g, me, k, k === b ? 0 : -20);
    dropMember(g, me);
    L.status = 'expelled';
    L.inf[me] = 0;
    L.merit = 0;
    L.task = undefined;
    L.shield = undefined;
    g.counters.lodgeRank = 0;
    log(g, `👁️ Мы подняли меч на брата (${cname(g, b)}) — ложа изгнала нас навсегда`, 'war', false);
    banner({ icon: '👁️', title: 'Изгнаны из ложи', text: `Брат не воюет с братом. Ложа нам этого не простит`, kind: 'war' });
    return;
  }
  dropMember(g, a);
  for (const k of botBrothers(g)) addRel(g, a, k, -20);
  if (b === me) log(g, `👁️ Ложа изгнала страну ${cname(g, a)} за нападение на брата — то есть на нас`, 'good');
  else whisper(g, `${cname(g, a)} подняла меч на брата (${cname(g, b)}) и изгнана из ложи`);
}

// ---------- поручения ложи ----------
interface TaskDef {
  id: string;
  icon: string;
  text: (g: GameState, t: LodgeTask) => string;
  value: (g: GameState, t: LodgeTask) => number;
  /** Цель поручения или null, если сейчас оно не подходит. */
  make: (g: GameState) => { target: number; param?: number; days?: number } | null;
  /** Провалено досрочно. */
  failed?: (g: GameState, t: LodgeTask) => boolean;
  reward: number;
}

function built(g: GameState, type?: BuildingType) {
  let n = 0;
  const { tiles, list } = allBuildings(g);
  for (let k = 0; k < tiles.length; k++) {
    const b = list[k];
    if ((b.progress > 0 && b.level === 1) || (type && b.type !== type)) continue;
    if (g.regions[REGION_OF[tiles[k]]].owner === g.player) n++;
  }
  return n;
}
const brotherFor = (g: GameState, ok: (k: number) => boolean) => {
  const b = botBrothers(g).filter((k) => !atWar(g, g.player, k) && ok(k));
  return b.length ? pick(g, b) : -1;
};
const lostBrother = (g: GameState, t: LodgeTask) => t.param === undefined || !g.countries[t.param].alive || !isMember(g, t.param);
const PEACE_DAYS = 200;

const TASKS: TaskDef[] = [
  { id: 'uni', icon: '🎓', reward: 30,
    text: (g, t) => `Свет знания: постройте университет — ${built(g, 'university')} из ${t.target}`,
    value: (g) => built(g, 'university'),
    make: (g) => ({ target: built(g, 'university') + 1 }) },
  { id: 'build', icon: '🏗️', reward: 30,
    text: (g, t) => `Ложа строителей: возведите новые здания — ${built(g)} из ${t.target}`,
    value: (g) => built(g),
    make: (g) => ({ target: built(g) + 3 }) },
  { id: 'tech', icon: '🔬', reward: 25,
    text: (g, t) => `Тайное знание: изучите новую технологию — ${g.countries[g.player].techs.length} из ${t.target}`,
    value: (g) => g.countries[g.player].techs.length,
    make: (g) => (availableTechs(g, g.player).length ? { target: g.countries[g.player].techs.length + 1 } : null) },
  { id: 'trade', icon: '🤝', reward: 35,
    text: (g, t) => `Братская торговля: заключите торговый договор с братом — ${cname(g, t.param!)}`,
    value: (g, t) => (peekPair(g, g.player, t.param!).trade ? 1 : 0),
    make: (g) => {
      if (STATS[g.player].tradePartners >= maxTrade(g, g.player)) return null;
      const k = brotherFor(g, (x) => !peekPair(g, g.player, x).trade && g.rel[g.player][x] >= -10 && !sanctions(g, g.player, x));
      return k < 0 ? null : { target: 1, param: k };
    },
    failed: lostBrother },
  { id: 'friend', icon: '❤️', reward: 30,
    text: (g, t) => `Узы братства: отношения с братом (${cname(g, t.param!)}) до +${t.target} — сейчас ${Math.round(g.rel[g.player][t.param!])}`,
    value: (g, t) => g.rel[g.player][t.param!],
    make: (g) => {
      const k = brotherFor(g, (x) => g.rel[g.player][x] > -30 && g.rel[g.player][x] < 35);
      return k < 0 ? null : { target: 50, param: k };
    },
    failed: lostBrother },
  { id: 'peace', icon: '🕊️', reward: 30,
    text: (g, t) => `Мир во имя порядка: не начинайте войн ${PEACE_DAYS} дней — осталось ${Math.max(0, Math.ceil(t.target - (g.day - t.since)))} дн.`,
    value: (g, t) => g.day - t.since,
    make: (g) => ({ target: PEACE_DAYS, param: g.counters.warsDeclared ?? 0, days: PEACE_DAYS + 15 }),
    failed: (g, t) => (g.counters.warsDeclared ?? 0) > (t.param ?? 0) },
  { id: 'secular', icon: '🔭', reward: 40,
    text: () => 'Против мракобесия: откажитесь от государственной религии (вкладка «Политика → Общество»)',
    value: (g) => (['secular', 'freedom'].includes(g.countries[g.player].religion) ? 1 : 0),
    make: (g) => (['state', 'theocracy'].includes(g.countries[g.player].religion) ? { target: 1 } : null) },
  { id: 'sanction', icon: '🚫', reward: 30,
    text: (g, t) => `Порядок в мире: введите санкции против агрессора — ${cname(g, t.param!)} (вкладка «Дипломатия → ООН»)`,
    value: (g, t) => (sanctions(g, g.player, t.param!) ? 1 : 0),
    make: (g) => {
      const cs = g.un.find((x) => x.resolved && x.until === undefined && x.aggressor !== g.player && x.victim !== g.player
        && !isMember(g, x.aggressor) && !x.sanctions.includes(g.player));
      return cs ? { target: 1, param: cs.aggressor } : null;
    },
    failed: (g, t) => !isAggressor(g, t.param!) },
  { id: 'stab', icon: '⚖️', reward: 30,
    text: (g, t) => `Порядок прежде всего: поднимите стабильность до ${t.target}% — сейчас ${Math.round(g.countries[g.player].stability)}%`,
    value: (g) => g.countries[g.player].stability,
    make: (g) => (g.countries[g.player].stability < 62 ? { target: 70 } : null) },
  { id: 'treasury', icon: '💰', reward: 25,
    text: (g, t) => `Казна — опора порядка: накопите ${fmt(t.target)} 💰 — сейчас ${fmt(g.countries[g.player].money)}`,
    value: (g) => g.countries[g.player].money,
    make: (g) => (g.countries[g.player].money > 0 ? { target: g.countries[g.player].money + income(g) * 150 } : null) },
];
const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t])) as Record<string, TaskDef>;

export const taskDef = (t: LodgeTask) => TASK_BY_ID[t.kind];
export const taskText = (g: GameState, t: LodgeTask) => TASK_BY_ID[t.kind]?.text(g, t) ?? '?';
export function taskProgress(g: GameState, t: LodgeTask) {
  const def = TASK_BY_ID[t.kind];
  if (!def) return 0;
  return Math.max(0, Math.min(1, (def.value(g, t) - t.base) / Math.max(1e-9, t.target - t.base)));
}
const TASK_DAYS = 180;
const TASK_FAIL = 10;

function newTask(g: GameState): LodgeTask | null {
  const last = g.counters.lodgeTask;
  const options = TASKS.filter((_, k) => k !== last);
  while (options.length) {
    const k = Math.floor(rand(g) * options.length);
    const def = options.splice(k, 1)[0];
    const made = def.make(g);
    if (!made) continue;
    const t: LodgeTask = { kind: def.id, target: made.target, param: made.param, base: 0, since: g.day, until: g.day + (made.days ?? TASK_DAYS), reward: def.reward };
    const v = def.value(g, t);
    if (v >= t.target) continue;
    // прогресс — от того, что было в день поручения (у «мира» и «отношений» — от нуля шкалы)
    t.base = def.id === 'peace' ? 0 : Math.min(v, t.target - 1);
    g.counters.lodgeTask = TASKS.indexOf(def);
    return t;
  }
  return null;
}

function tickTask(g: GameState) {
  const L = g.lodge;
  const t = L.task;
  if (!t) {
    if (g.day < L.nextTask) return;
    L.task = newTask(g) ?? undefined;
    L.nextTask = g.day + 30;
    if (L.task) {
      sfx('notify');
      log(g, `👁️ Поручение ложи: ${taskText(g, L.task)} — награда 🔺${L.task.reward}`, 'info');
    }
    return;
  }
  const def = TASK_BY_ID[t.kind];
  if (!def) {
    L.task = undefined;
    return;
  }
  if (def.value(g, t) >= t.target) {
    L.task = undefined;
    L.nextTask = g.day + 50 + Math.floor(rand(g) * 60);
    g.counters.lodgeTasks = (g.counters.lodgeTasks ?? 0) + 1;
    sfx('quest');
    log(g, `👁️ Поручение ложи исполнено: ${def.icon} ${def.text(g, t)} — +🔺${t.reward}`, 'good');
    earn(g, t.reward);
  } else if (def.failed?.(g, t) || g.day > t.until) {
    L.task = undefined;
    L.nextTask = g.day + 60 + Math.floor(rand(g) * 60);
    L.inf[g.player] = Math.max(0, L.inf[g.player] - TASK_FAIL);
    log(g, `👁️ Поручение ложи провалено: ${def.icon} ${def.text(g, t)} — −🔺${TASK_FAIL}`, 'bad');
  }
}

/** Отказаться от поручения: ложа запомнит. */
export function declineTask(g: GameState) {
  const L = g.lodge;
  if (!L.task) return;
  L.task = undefined;
  L.nextTask = g.day + 60;
  L.inf[g.player] = Math.max(0, L.inf[g.player] - 5);
}

// ---------- тайные услуги ----------
export interface OpChoice { v: number; label: string; flag?: number }
export interface OpDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  rank: number; // нужная степень
  cost: number; // 🔺
  susp: number; // + подозрение
  cd: number; // дней до повтора
  money?: (g: GameState) => number; // цена в 💰
  choices?: (g: GameState) => OpChoice[];
  can?: (g: GameState) => string | null;
  run: (g: GameState, t: number) => { text: string; bad?: boolean };
}

/** Страны вне ложи, на которых можно воздействовать. */
const outsiders = (g: GameState) => g.countries.filter((c) => c.alive && c.idx !== g.player && !isMember(g, c.idx)).map((c) => c.idx);
const countryChoices = (ids: number[], extra?: (k: number) => string): OpChoice[] =>
  ids.map((k) => ({ v: k, flag: k, label: `${COUNTRY_DEFS[k].name}${extra ? ` · ${extra(k)}` : ''}` }));
const GOODS: [('food' | 'arms'), number, string][] = [
  ['food', -0.4, '🌾 Еда подешевеет'], ['food', 0.4, '🌾 Еда подорожает'], ['arms', -0.4, '🔫 Оружие подешевеет'], ['arms', 0.4, '🔫 Оружие подорожает'],
];
/** Шанс переворота: шаткая власть падает легче, диктатура держится крепче. */
export function coupChance(g: GameState, k: number) {
  const c = g.countries[k];
  const govK = c.gov === 'democracy' ? 0.08 : c.gov === 'dictatorship' ? -0.15 : 0;
  return Math.max(0.1, Math.min(0.9, 0.25 + (70 - c.stability) / 80 + govK));
}

export const OPS: OpDef[] = [
  { id: 'handshake', icon: '🤝', name: 'Братское рукопожатие', rank: 0, cost: 8, susp: 2, cd: 45,
    desc: 'Тайная встреча с братом: отношения +20',
    choices: (g) => countryChoices(botBrothers(g), (k) => `${Math.round(g.rel[g.player][k])}`),
    run: (g, t) => {
      addRel(g, g.player, t, 20);
      return { text: `Братское рукопожатие: ${cname(g, t)} — отношения +20` };
    } },
  { id: 'donate', icon: '🕯️', name: 'Пожертвование ложе', rank: 0, cost: 0, susp: 0, cd: 60,
    desc: 'Казна — на храм ложи: +🔺15 влияния и заслуг',
    money: (g) => scale(g) * 40,
    run: (g) => {
      earn(g, 15);
      return { text: 'Пожертвование на храм ложи: +🔺15' };
    } },
  { id: 'fund', icon: '💰', name: 'Касса взаимопомощи', rank: 0, cost: 20, susp: 4, cd: 120,
    desc: 'Братья ссужают казну: деньги сейчас, вернуть не нужно',
    run: (g) => {
      const v = income(g) * 70;
      g.countries[g.player].money += v;
      sfx('coins');
      return { text: `Касса взаимопомощи ложи: +${fmt(v)} 💰` };
    } },
  { id: 'market', icon: '📈', name: 'Биржевой сговор', rank: 1, cost: 25, susp: 8, cd: 150,
    desc: 'Братья-банкиры двигают мировую цену еды или оружия: купите дёшево, продайте дорого',
    choices: () => GOODS.map(([, , label], i) => ({ v: i, label })),
    run: (g, t) => {
      const [good, v, label] = GOODS[t];
      shockMarket(g, good, v);
      news(g, `📉 Необъяснимая паника на бирже: ${good === 'food' ? 'продовольствие' : 'оружие'} ${v > 0 ? 'резко дорожает' : 'резко дешевеет'}`, 'info');
      return { text: `Биржевой сговор: ${label.toLowerCase()} — загляните на 🏪 рынок` };
    } },
  { id: 'compromat', icon: '📰', name: 'Компромат', rank: 1, cost: 30, susp: 14, cd: 150,
    desc: 'Газеты братьев публикуют тайную переписку чужого правительства: стабильность там −12, репутация в мире падает',
    choices: (g) => countryChoices(outsiders(g), (k) => `⚖️${Math.round(g.countries[k].stability)}%`),
    run: (g, t) => {
      mod(g, t, 'stab', -12, 200, 'Скандал (компромат)');
      g.countries.forEach((c, k) => { if (c.alive && k !== t && k !== g.player) addRel(g, k, t, -6); });
      news(g, `📰 Скандал в стране ${cname(g, t)}: газеты опубликовали тайную переписку правительства`, 'bad');
      return { text: `Компромат на страну ${cname(g, t)} опубликован: стабильность там −12, репутация в мире упала` };
    } },
  { id: 'un', icon: '🌐', name: 'Кулуары ООН', rank: 2, cost: 40, susp: 15, cd: 240,
    desc: 'Год братья не вводят против нас санкций и выходят из коалиций, а братья в Совбезе накладывают вето',
    run: (g) => {
      const me = g.player;
      g.lodge.shield = g.day + 365;
      let lifted = 0;
      for (const cs of g.un) {
        if (cs.aggressor !== me) continue;
        const before = cs.sanctions.length;
        cs.sanctions = cs.sanctions.filter((k) => !isMember(g, k));
        cs.donors = cs.donors.filter((k) => !isMember(g, k));
        cs.coalition = cs.coalition.filter((k) => !isMember(g, k));
        lifted += before - cs.sanctions.length;
      }
      let peace = 0;
      for (const k of botBrothers(g)) {
        if (peekPair(g, me, k).war?.un === me) {
          makePeace(g, me, k, true);
          peace++;
        }
      }
      const vetoes = P5.filter((k) => k !== me && isMember(g, k) && g.countries[k].alive).length;
      const parts = [vetoes ? `братьев в Совбезе: ${vetoes} — их вето прикроет нас` : 'братьев в Совбезе нет — вето не будет'];
      if (lifted) parts.push(`снято санкций: ${lifted}`);
      if (peace) parts.push(`вышли из коалиции: ${peace}`);
      return { text: `Кулуары ООН на год: ${parts.join(', ')}` };
    } },
  { id: 'coup', icon: '🔥', name: 'Переворот', rank: 2, cost: 70, susp: 28, cd: 365,
    desc: 'Заговор против чужого правительства. Удастся — новая власть станет нашим другом и братом по ложе; провалится — все узнают, чьих рук дело',
    choices: (g) => countryChoices(outsiders(g).filter((k) => !atWar(g, g.player, k)), (k) => `шанс ${Math.round(coupChance(g, k) * 100)}%`),
    run: (g, t) => {
      const me = g.player;
      if (rand(g) < coupChance(g, t)) {
        overthrow(g, t, g.countries[me].gov);
        joinBot(g, t, 10);
        addRel(g, me, t, 40);
        g.counters.coups = (g.counters.coups ?? 0) + 1;
        news(g, `🔥 Переворот в стране ${cname(g, t)}: к власти пришло новое правительство — ${GOVS[g.countries[t].gov].name}`, 'war');
        return { text: `Переворот удался! Новое правительство страны ${cname(g, t)} — наши люди: отношения +40, страна вступила в ложу` };
      }
      g.lodge.suspicion = Math.min(100, g.lodge.suspicion + 20);
      addRel(g, me, t, -35);
      mod(g, t, 'stab', 6, 200, 'Сплочение после путча');
      news(g, `🔥 В стране ${cname(g, t)} сорван государственный переворот`, 'war');
      return { text: `Переворот в стране ${cname(g, t)} провалился — заговорщиков схватили, следы ведут к нам (подозрение +20, отношения −35)`, bad: true };
    } },
  { id: 'decree', icon: '👁️', name: 'Воля Великого мастера', rank: 3, cost: 50, susp: 10, cd: 365,
    desc: 'Все братья объявляют бойкот чужой стране: разрывают с ней торговлю, отношения с ней −25, с нами +10',
    choices: (g) => countryChoices(outsiders(g)),
    run: (g, t) => {
      let broken = 0;
      for (const k of botBrothers(g)) {
        addRel(g, k, t, -25);
        addRel(g, g.player, k, 10);
        const p = peekPair(g, k, t);
        if (p.trade) {
          pair(g, k, t).trade = false;
          broken++;
        }
      }
      news(g, `🚫 Сразу несколько стран без объяснений свернули торговлю со страной ${cname(g, t)}`, 'bad');
      return { text: `Воля Великого мастера: братья бойкотируют страну ${cname(g, t)}${broken ? ` — разорвано договоров: ${broken}` : ''}` };
    } },
];
export const OP_BY_ID = Object.fromEntries(OPS.map((o) => [o.id, o])) as Record<string, OpDef>;

/** Великому мастеру услуги дешевле. */
export const opCost = (g: GameState, op: OpDef) => Math.round(op.cost * (rankOf(g) === 3 ? 0.7 : 1));
export const opWait = (g: GameState, op: OpDef) => Math.max(0, Math.ceil((g.lodge.cd[op.id] ?? 0) - g.day));

/** Почему услугу нельзя заказать (null — можно). t — цель, если она нужна. */
export function opError(g: GameState, id: string, t?: number): string | null {
  const op = OP_BY_ID[id];
  const L = g.lodge;
  if (!op) return 'Нет такой услуги';
  if (L.status !== 'member') return 'Вы не в ложе';
  if (rankOf(g) < op.rank) return `Нужна степень «${RANKS[op.rank].name}»`;
  const wait = opWait(g, op);
  if (wait > 0) return `Снова можно через ${wait} дн.`;
  if (L.inf[g.player] < opCost(g, op)) return 'Не хватает 🔺 влияния';
  if (op.money && g.countries[g.player].money < op.money(g)) return 'Не хватает денег';
  const err = op.can?.(g);
  if (err) return err;
  if (op.choices) {
    const list = op.choices(g);
    if (!list.length) return 'Нет подходящих целей';
    if (t !== undefined && !list.some((c) => c.v === t)) return 'Недопустимая цель';
  }
  return null;
}

export function runOp(g: GameState, id: string, t = -1): string | null {
  const op = OP_BY_ID[id];
  const err = opError(g, id, op?.choices ? t : undefined);
  if (err) return err;
  if (op.choices && t < 0) return 'Выберите цель';
  const L = g.lodge;
  const me = g.player;
  L.inf[me] -= opCost(g, op);
  if (op.money) g.countries[me].money -= op.money(g);
  L.cd[id] = g.day + op.cd;
  // тайну хранят не все: открытого масона за тайные дела ругает народ, остальных ищут газеты
  if (L.open && op.susp) mod(g, me, 'stab', -op.susp / 4, 90, 'Тайные дела ложи');
  else L.suspicion = Math.min(100, L.suspicion + op.susp);
  const res = op.run(g, t);
  g.counters.lodgeOps = (g.counters.lodgeOps ?? 0) + 1;
  sfx(res.bad ? 'alarm' : 'paper');
  log(g, `${op.icon} ${res.text}`, res.bad ? 'bad' : 'good');
  computeAll(g);
  return null;
}

// ---------- переворот и посвящение ботов ----------
function overthrow(g: GameState, i: number, gov: GovType) {
  const c = g.countries[i];
  if (gov === c.gov) gov = pick(g, (Object.keys(GOVS) as GovType[]).filter((k) => k !== c.gov));
  c.gov = gov;
  c.money *= c.money > 0 ? 0.8 : 1;
  c.stability = 30;
  c.tax = Math.min(c.tax, 0.15);
  c.govChangedDay = g.day;
  delete c.aiFlags.prepTarget;
  delete c.aiFlags.prepUntil;
}

function joinBot(g: GameState, k: number, inf: number) {
  const L = g.lodge;
  if (L.members.includes(k)) return;
  // новая власть уходит из нашей ложи в «Всевидящее око»
  if (inOrder(g, k)) {
    dropBrother(g, k);
    log(g, `👁️ После переворота ${cname(g, k)} вышла из ложи «${g.order!.name}» — новая власть служит «${LODGE_NAME}»`, 'bad');
  }
  L.members.push(k);
  L.inf[k] = Math.max(L.inf[k] ?? 0, inf);
}

// ---------- выборы Великого мастера ----------
export const BUY_VOTES = 40;
export const buyVotesCost = (g: GameState) => scale(g) * 120;

function election(g: GameState) {
  const L = g.lodge;
  const me = g.player;
  if (L.status !== 'member') return elect(g, 'abstain');
  if (!botBrothers(g).length) return elect(g, 'run');
  if (L.electionAsked) {
    // ответ ждём в окне; если окно пропало — считаем, что мы выдвинулись
    if (g.event?.id !== 'lodge-election') elect(g, 'run');
    return;
  }
  if (g.event) {
    if (g.day > L.nextElection + 15) elect(g, 'run');
    return;
  }
  L.electionAsked = true;
  const fav = favorite(g);
  const mine = L.inf[me];
  const again = L.master === me;
  g.event = {
    id: 'lodge-election', kind: 'lodge', icon: '👁️', title: 'Выборы Великого мастера', target: fav,
    text: `Раз в два года братья ложи «${LODGE_NAME}» тайно избирают Великого мастера: ему идёт половина взносов всех братьев, `
      + `а тайные услуги обходятся дешевле. Побеждает самый влиятельный. У нас 🔺${fmt(mine)}, у фаворита (${cname(g, fav)}) — 🔺${fmt(L.inf[fav])}.`,
    options: [
      { label: again ? '🕯️ Остаться на второй срок' : '🕯️ Выдвинуть себя', hint: mine >= L.inf[fav] ? 'Мы влиятельнее всех — победа за нами' : `Не хватает 🔺${fmt(L.inf[fav] - mine)} — скорее всего, проиграем` },
      { label: '💰 Купить голоса', hint: `−${fmt(buyVotesCost(g))} 💰, +🔺${BUY_VOTES} перед голосованием (${mine + BUY_VOTES >= L.inf[fav] ? 'этого хватит для победы' : 'и всё равно не хватит'}), подозрение +10` },
      { label: '🤝 Поддержать фаворита', hint: `${cname(g, fav)} станет Великим мастером: отношения +20, +🔺15 за верность` },
    ],
  };
  sfx('notify');
}

/** Самый влиятельный брат-бот (-1 — таких нет). */
function favorite(g: GameState) {
  const b = botBrothers(g);
  return b.length ? b.reduce((a, k) => (g.lodge.inf[k] > g.lodge.inf[a] ? k : a)) : -1;
}

function elect(g: GameState, mode: 'run' | 'support' | 'abstain') {
  const L = g.lodge;
  const me = g.player;
  L.electionAsked = false;
  L.nextElection = g.day + TERM;
  const playerIn = L.status === 'member' && mode === 'run';
  const cands = L.members.filter((k) => g.countries[k].alive && (k !== me || playerIn));
  if (!cands.length) {
    L.master = -1;
    return;
  }
  const fav = mode === 'support' ? favorite(g) : -1;
  const winner = fav >= 0 ? fav : cands.reduce((a, k) => (L.inf[k] > L.inf[a] ? k : a));
  const prev = L.master;
  L.master = winner;
  if (L.status === 'member') {
    if (winner === me) checkRank(g);
    else {
      if (prev === me) log(g, `👁️ Мы больше не Великий мастер: братья избрали страну ${cname(g, winner)}`, 'bad');
      else log(g, `👁️ Великим мастером ложи избрана страна ${cname(g, winner)}`, 'info');
      if (mode === 'run' && prev !== me) addRel(g, me, winner, -5);
      checkRank(g);
    }
  } else if (prev !== winner && L.known.includes(winner)) {
    news(g, `📰 По слухам, тайную ложу «${LODGE_NAME}» теперь возглавляет правитель страны ${cname(g, winner)}`, 'info');
  }
  computeAll(g);
}

// ---------- разоблачение ----------
function expose(g: GameState) {
  const c = g.countries[g.player];
  const openStab = LODGE_OPEN_STAB[c.religion];
  g.counters.lodgeExposed = (g.counters.lodgeExposed ?? 0) + 1;
  g.event = {
    id: 'lodge-exposed', kind: 'lodge', icon: '📰', title: 'Разоблачение!',
    text: `Газеты вышли с фотографией: правитель в фартуке и с циркулем на тайном собрании ложи «${LODGE_NAME}». `
      + `${c.gov === 'dictatorship' ? 'Цензура не успела перехватить тираж.' : 'Оппозиция требует объяснений.'} Страна гудит.`,
    options: [
      { label: '🙅 Всё отрицать', hint: c.gov === 'dictatorship' ? 'Газету закроют: стабильность −3, подозрение −30' : 'стабильность −8 на 200 дн., отношения −5 со странами вне ложи, подозрение −30' },
      { label: '📢 Признать открыто', hint: `Тайны больше нет: стабильность ${openStab ? openStab : '0 (светское государство)'} навсегда, а за тайные услуги будет злиться народ` },
      { label: '🚪 Выйти из ложи', hint: 'стабильность −2, всё 🔺 влияние сгорит, братья обидятся (−15)' },
    ],
  };
  sfx('alarm');
}

/** Ответ игрока в окне ложи: выборы или разоблачение. */
export function resolveLodgeEvent(g: GameState, option: number) {
  const ev = g.event;
  if (!ev) return;
  g.event = null;
  const L = g.lodge;
  const me = g.player;
  const c = g.countries[me];
  if (ev.id === 'lodge-election') {
    if (L.status !== 'member') return elect(g, 'abstain');
    if (option === 1) {
      const cost = buyVotesCost(g);
      if (c.money >= cost) {
        c.money -= cost;
        L.inf[me] += BUY_VOTES;
        L.suspicion = Math.min(100, L.suspicion + 10);
      } else log(g, '💰 Денег на голоса не хватило', 'bad');
    }
    const fav = favorite(g);
    if (option === 2 && fav >= 0) {
      addRel(g, me, fav, 20);
      earn(g, 15);
      return elect(g, 'support');
    }
    return elect(g, 'run');
  }
  if (ev.id === 'lodge-exposed') {
    if (L.status !== 'member') return;
    if (option === 0) {
      L.suspicion = Math.max(0, L.suspicion - 30);
      if (c.gov === 'dictatorship') mod(g, me, 'stab', -3, 100, 'Закрытая газета');
      else {
        mod(g, me, 'stab', -8, 200, 'Масонский скандал');
        g.countries.forEach((x, k) => { if (x.alive && k !== me && !isMember(g, k)) addRel(g, me, k, -5); });
      }
      log(g, '🙅 Мы всё отрицаем: «фото — монтаж»', 'info', false);
    } else if (option === 1) {
      L.open = true;
      L.suspicion = 0;
      if (!L.known.includes(me)) L.known.push(me);
      mod(g, me, 'stab', -5, 120, 'Масонский скандал');
      log(g, '📢 Мы открыто признали: «Да, я масон»', 'info', false);
    } else {
      mod(g, me, 'stab', -2, 90, 'Масонский скандал');
      leaveLodge(g);
    }
    computeAll(g);
  }
}

// ---------- тайные дела братьев-ботов ----------
function intrigue(g: GameState) {
  const L = g.lodge;
  const me = g.player;
  L.nextPlot = g.day + (L.status === 'banned' ? 110 + Math.floor(rand(g) * 90) : 150 + Math.floor(rand(g) * 110));
  if (L.status === 'banned' && rand(g) < 0.7) return plotAgainstPlayer(g);
  // соперницу-ложу игрока «Всевидящее око» тоже не жалует
  if (g.order && rand(g) < 0.25) return plotAgainstPlayer(g);
  const bots = botBrothers(g);
  if (!bots.length) return;
  const actor = L.master >= 0 && L.master !== me && g.countries[L.master].alive ? L.master : pick(g, bots);
  const r = rand(g);
  if (r < 0.3) recruit(g, actor);
  else if (r < 0.7) botCompromat(g, actor);
  else botCoup(g, actor);
}

/** Ложа посвящает нового брата — того, с кем у мастера лучшие отношения. */
function recruit(g: GameState, actor: number) {
  if (botBrothers(g).length >= MAX_MEMBERS) return;
  const cands = g.countries.filter((c) => c.alive && c.idx !== g.player && !isMember(g, c.idx) && !inOrder(g, c.idx)
    && JOIN_WISH[c.personality] > 0 && g.rel[actor][c.idx] > 10);
  if (!cands.length) return;
  const k = cands.reduce((a, c) => (g.rel[actor][c.idx] > g.rel[actor][a.idx] ? c : a)).idx;
  joinBot(g, k, 10);
  whisper(g, `${cname(g, actor)} посвятила в ложу правителя страны ${cname(g, k)}`);
}

function botCompromat(g: GameState, actor: number) {
  const me = g.player;
  const L = g.lodge;
  // по игроку ложа бьёт, только если он ей враг
  const hostile = (L.status === 'refused' || L.status === 'expelled') && g.rel[actor][me] < -20;
  const cands = outsiders(g).filter((k) => k !== actor && !atWar(g, actor, k)).concat(hostile ? [me] : []);
  if (!cands.length) return;
  // бьют по недругам мастера, но не всегда по одному и тому же
  const t = pick(g, cands.sort((x, y) => g.rel[actor][x] - g.rel[actor][y]).slice(0, 3));
  mod(g, t, 'stab', -10, 180, 'Скандал (компромат)');
  L.inf[actor] = Math.max(0, L.inf[actor] - 25);
  if (t === me) {
    sfx('alarm');
    log(g, `📰 Утечка компромата: газеты полны «тайной переписки» правительства (стабильность −10). Говорят, за этим стоит ложа`, 'bad');
    return;
  }
  whisper(g, `за скандалом в стране ${cname(g, t)} стоит брат — ${cname(g, actor)}`,
    `📰 Скандал в стране ${cname(g, t)}: газеты опубликовали тайную переписку правительства`, 'bad');
}

function botCoup(g: GameState, actor: number) {
  const cands = outsiders(g).filter((k) => k !== actor && g.countries[k].stability < 40);
  if (!cands.length) return recruit(g, actor);
  const t = pick(g, cands);
  g.lodge.inf[actor] = Math.max(0, g.lodge.inf[actor] - 40);
  if (rand(g) < coupChance(g, t)) {
    overthrow(g, t, g.countries[actor].gov);
    joinBot(g, t, 10);
    addRel(g, actor, t, 30);
    whisper(g, `переворот в стране ${cname(g, t)} устроила ложа — новое правительство уже в наших рядах`,
      `🔥 Переворот в стране ${cname(g, t)}: к власти пришло новое правительство — ${GOVS[g.countries[t].gov].name}`, 'war');
  } else {
    whisper(g, `брат ${cname(g, actor)} пытался устроить переворот в стране ${cname(g, t)}, но заговор раскрыли`,
      `🔥 В стране ${cname(g, t)} сорван государственный переворот`, 'war');
  }
}

/** Ложа мстит тому, кто её запретил. */
function plotAgainstPlayer(g: GameState) {
  const me = g.player;
  const r = rand(g);
  sfx('alarm');
  if (r < 0.4) {
    mod(g, me, 'stab', -8, 150, 'Происки ложи');
    log(g, '👁️ Происки ложи: подконтрольные ложе газеты травят правительство (стабильность −8)', 'bad');
  } else if (r < 0.7) {
    let broken = '';
    for (const k of botBrothers(g)) {
      addRel(g, me, k, -10);
      if (!broken && peekPair(g, me, k).trade) {
        pair(g, me, k).trade = false;
        broken = cname(g, k);
      }
    }
    log(g, `👁️ Происки ложи: братья-масоны объявили нам бойкот (отношения −10${broken ? `, ${broken} разорвала торговый договор` : ''})`, 'bad');
  } else {
    mod(g, me, 'prod', -0.06, 180, 'Происки ложи');
    log(g, '👁️ Происки ложи: на деньги ложи по стране идут забастовки (производство −6% на 180 дн.)', 'bad');
  }
  computeAll(g);
}
