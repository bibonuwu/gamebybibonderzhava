// Выборы: в демократии раз в 4 года, в республике раз в 5. Рейтинг власти растёт от стабильности, роста экономики и
// сдержанных обещаний и падает от голода, войн, долгов и усталости от одной и той же власти. За 90 дней до выборов —
// кампания: обещание избирателям (из того, о чём говорит народ), агитация, дебаты, а кто не боится — подтасовка или
// отмена выборов. Победа — мандат доверия и год на выполнение обещания. Поражение — правительство формирует коалиция
// с партией-победителем, и год действуют её условия. Боты тоже голосуют: победа оппозиции — новый курс страны.
import { addRel, cname, enemiesOf } from './actions';
import { BUDGET_LEVELS, PERSONALITIES } from './defs';
import { rating, totalDebt } from './debt';
import { computeAll, STATS } from './economy';
import { fmt, fmtDate } from './format';
import { foodDays } from './market';
import { moodOf } from './people';
import { banner, log, news, pick, rand, sfx } from './state';
import type { BuildingType, ElectionPromise, ElectionState, GameState, GovType, Personality } from './types';
import { REGION_OF } from './world';

/** Срок между выборами: остальные формы правления выборов не проводят. */
export const CYCLE: Partial<Record<GovType, number>> = { democracy: 1460, republic: 1825 };
export const CAMPAIGN = 90;
const FIRST = 900; // первые выборы — не раньше этого дня партии
export const isFree = (gov: GovType) => gov in CYCLE;

// ---------- партии ----------
export interface PartyDef { id: string; name: string; icon: string; slogan: string; terms: string; mood: string[] }
export const PARTIES: PartyDef[] = [
  { id: 'peace', name: 'Партия мира', icon: '🕊️', slogan: 'Нет войне!', terms: 'никаких новых войн, военный бюджет не выше «Низкие»', mood: ['antiwar', 'mothers'] },
  { id: 'people', name: 'Народная партия', icon: '💸', slogan: 'Снизить налоги!', terms: 'налог не выше 15%', mood: ['taxes', 'richtax'] },
  { id: 'social', name: 'Социал-демократы', icon: '🏥', slogan: 'Медицина и школы — всем!', terms: 'расходы на медицину и образование не ниже «Средние»', mood: ['health', 'students', 'labs', 'bread'] },
  { id: 'green', name: 'Зелёные', icon: '🌳', slogan: 'Чистый воздух!', terms: 'никаких новых заводов', mood: ['ecology', 'farmers'] },
  { id: 'patriots', name: 'Патриоты', icon: '🛡️', slogan: 'Сильная армия!', terms: 'военный бюджет не ниже «Средние»', mood: ['defense', 'parade', 'migrants', 'jobs'] },
];
export const PARTY_BY_ID = Object.fromEntries(PARTIES.map((p) => [p.id, p])) as Record<string, PartyDef>;
const LEADERS = [
  'Анна Светлова', 'Игорь Громов', 'Марта Ковач', 'Давид Ортега', 'Лейла Хасанова', 'Виктор Ланской', 'Ольга Миронова',
  'Рустам Алиев', 'Елена Брандт', 'Павел Зорин', 'Сара Коэн', 'Мигель Санчес', 'Айдана Сеитова', 'Томас Риверс',
];

/** Главная оппозиция сейчас — та, что говорит о самом больном. */
export function rivalParty(g: GameState): PartyDef {
  for (const m of moodOf(g, g.player)) {
    const p = PARTIES.find((x) => x.mood.includes(m.id));
    if (p) return p;
  }
  return PARTY_BY_ID[g.elections.party] ?? PARTIES[1];
}

// ---------- обещания ----------
interface PromiseDef {
  id: string;
  icon: string;
  text: (g: GameState, p: ElectionPromise) => string;
  value: (g: GameState) => number;
  /** Цель обещания или null, если сейчас оно не к месту. */
  make: (g: GameState) => number | null;
  less?: boolean; // выполнено, когда значение не выше цели
  mood: string[];
}
const me = (g: GameState) => g.countries[g.player];
function built(g: GameState, type: BuildingType) {
  let n = 0;
  for (const key in g.buildings) {
    const b = g.buildings[+key];
    if (b.type === type && !(b.progress > 0 && b.level === 1) && g.regions[REGION_OF[+key]].owner === g.player) n++;
  }
  return n;
}
const buildPromise = (id: string, type: BuildingType, icon: string, n: number, word: string, mood: string[]): PromiseDef => ({
  id, icon, mood,
  text: (g, p) => `Построить ${n} ${word} — ${built(g, type) - p.base} из ${n}`,
  value: (g) => built(g, type),
  make: (g) => built(g, type) + n,
});

const PROMISES: PromiseDef[] = [
  { id: 'tax', icon: '💸', mood: ['taxes', 'richtax'], less: true,
    text: (g, p) => `Снизить налог до ${p.target}% — сейчас ${Math.round(me(g).tax * 100)}%`,
    value: (g) => Math.round(me(g).tax * 100),
    make: (g) => (me(g).tax >= 0.12 ? Math.round(me(g).tax * 100) - 5 : null) },
  { id: 'peace', icon: '🕊️', mood: ['antiwar', 'mothers'], less: true,
    text: (g) => `Мир: закончить войны и не начинать новых${enemiesOf(g, g.player).length ? ` — сейчас войн: ${enemiesOf(g, g.player).length}` : ''}`,
    value: (g) => (g.counters.warsDeclared ?? 0) + 1000 * enemiesOf(g, g.player).length,
    make: (g) => g.counters.warsDeclared ?? 0 },
  buildPromise('hospital', 'hospital', '🏥', 2, 'больницы', ['health']),
  buildPromise('school', 'university', '🎓', 2, 'университета', ['students', 'labs']),
  buildPromise('jobs', 'factory', '🏭', 3, 'завода', ['jobs']),
  { id: 'food', icon: '🍞', mood: ['bread', 'farmers'],
    text: (g) => `Хлеб в каждый дом: запас еды на 90 дней — сейчас ${Math.floor(foodDays(g, g.player))}`,
    value: (g) => (STATS[g.player].hunger > 0 ? 0 : foodDays(g, g.player)),
    make: (g) => (foodDays(g, g.player) < 85 ? 90 : null) },
  { id: 'army', icon: '🛡️', mood: ['defense', 'parade', 'migrants'],
    text: (g, p) => `Сильная армия: военная мощь ${fmt(p.target)} — сейчас ${fmt(STATS[g.player].power)}`,
    value: (g) => STATS[g.player].power,
    make: (g) => Math.round(STATS[g.player].power * 1.25) },
  { id: 'debt', icon: '🏦', mood: ['taxes'], less: true,
    text: (g, p) => `Сократить госдолг вдвое: до ${fmt(p.target)} 💰 — сейчас ${fmt(totalDebt(me(g)))}`,
    value: (g) => totalDebt(me(g)),
    make: (g) => (totalDebt(me(g)) > STATS[g.player].taxIncome * 60 ? Math.round(totalDebt(me(g)) / 2) : null) },
  { id: 'stab', icon: '⚖️', mood: [],
    text: (g) => `Порядок и спокойствие: стабильность 70% — сейчас ${Math.round(me(g).stability)}%`,
    value: (g) => me(g).stability,
    make: (g) => (me(g).stability < 66 ? 70 : null) },
];
const PROMISE_BY_ID = Object.fromEntries(PROMISES.map((p) => [p.id, p])) as Record<string, PromiseDef>;
export const promiseText = (g: GameState, p: ElectionPromise) => PROMISE_BY_ID[p.kind]?.text(g, p) ?? '?';
export const promiseIcon = (p: ElectionPromise) => PROMISE_BY_ID[p.kind]?.icon ?? '📜';
export function promiseOk(g: GameState, p: ElectionPromise) {
  const def = PROMISE_BY_ID[p.kind];
  if (!def) return true;
  const v = def.value(g);
  return def.less ? v <= p.target : v >= p.target;
}

/** Три обещания на выбор: сначала о том, что больнее всего народу. */
function offerPromises(g: GameState): ElectionPromise[] {
  const out: ElectionPromise[] = [];
  const add = (def: PromiseDef) => {
    if (out.length >= 3 || out.some((p) => p.kind === def.id)) return;
    const t = def.make(g);
    if (t === null) return;
    const p = { kind: def.id, target: t, base: def.value(g) };
    if (!promiseOk(g, p) || def.id === 'peace') out.push(p);
  };
  for (const m of moodOf(g, g.player)) for (const def of PROMISES) if (def.mood.includes(m.id)) add(def);
  for (const def of [...PROMISES].sort(() => rand(g) - 0.5)) add(def);
  return out;
}

// ---------- рейтинг ----------
/** Из чего складывается рейтинг власти. */
export function approvalParts(g: GameState): [string, number][] {
  const c = me(g);
  const s = STATS[g.player];
  const E = g.elections;
  const parts: [string, number][] = [['База', 50], ['Стабильность', (c.stability - 55) * 0.45]];
  const h = g.hist.s;
  const old = h[Math.max(0, h.length - 19)];
  if (old && h.length > 6) parts.push(['Экономика', Math.max(-10, Math.min(10, ((s.moneyRate - old.mr) / Math.max(10, Math.abs(old.mr))) * 40))]);
  parts.push(['Налоги', (0.2 - c.tax) * 40]);
  if (s.hunger > 0) parts.push(['Голод', -25 * s.hunger]);
  if (c.weariness > 2) parts.push(['Война', -c.weariness * 0.2]);
  const r = rating(g, g.player);
  if (r >= 7) parts.push(['Дефолт', -15]);
  else if (r >= 6) parts.push(['Долги', -6]);
  const terms = Math.min(5, g.counters.electionsWon ?? 0);
  if (terms) parts.push(['Усталость от власти', -3 * terms]);
  if (Math.abs(E.trust) >= 0.5) parts.push(['Доверие', E.trust]);
  if (E.boost) parts.push(['Кампания', E.boost]);
  return parts.filter((p) => Math.abs(p[1]) >= 0.05);
}
export const approvalTarget = (g: GameState) => Math.max(5, Math.min(95, approvalParts(g).reduce((s, p) => s + p[1], 0)));

export function initElections(g: GameState): ElectionState {
  const c = g.countries[g.player];
  return {
    next: g.day + FIRST + Math.floor(rand(g) * 200), approval: 50, forGov: c.gov, party: 'people', leader: pick(g, LEADERS),
    boost: 0, trust: 0, cd: {},
  };
}

// ---------- день ----------
export function tickElections(g: GameState) {
  const E = g.elections;
  const c = me(g);
  E.trust *= 0.998;
  if (Math.abs(E.trust) < 0.05) E.trust = 0;
  tickMandate(g);
  tickCoalition(g);
  if (!isFree(c.gov)) {
    E.campaign = false;
    E.forGov = c.gov;
  } else {
    // реформа сделала страну свободной — первые выборы через два года
    if (E.forGov !== c.gov) {
      if (!isFree((E.forGov ?? 'monarchy') as GovType) || E.next < g.day) E.next = Math.max(E.next, g.day + 730);
      E.forGov = c.gov;
    }
    E.approval += (approvalTarget(g) - E.approval) * 0.03;
    if (!E.campaign && g.day >= E.next - CAMPAIGN) startCampaign(g);
    if (E.campaign && g.day >= E.next) vote(g);
  }
  botElections(g);
}

function startCampaign(g: GameState) {
  const E = g.elections;
  if (g.event) {
    if (g.day < E.next - CAMPAIGN + 30) return; // окно занято — объявим кампанию чуть позже
  }
  const party = rivalParty(g);
  E.campaign = true;
  E.party = party.id;
  E.leader = pick(g, LEADERS);
  E.boost = 0;
  E.rigged = 0;
  E.cd = {};
  E.promise = undefined;
  if (g.event) return;
  const offers = offerPromises(g);
  g.event = {
    id: 'el-campaign', kind: 'election', icon: '🗳️', title: 'Предвыборная кампания',
    text: `До выборов ${Math.ceil(E.next - g.day)} дней. Оппозицию возглавляет ${E.leader} — ${party.icon} «${party.name}»: «${party.slogan}». `
      + `Наш рейтинг — ${Math.round(E.approval)}%. Что пообещаем избирателям? Обещание поднимет рейтинг, но после победы его придётся выполнить за год.`,
    options: [
      ...offers.map((p) => ({ label: `${promiseIcon(p)} ${promiseText(g, p).split(' — ')[0]}`, hint: '+6 к рейтингу; не выполним за год — доверие рухнет' })),
      { label: '🤐 Ничего не обещать', hint: 'рейтинг не изменится, зато и спрашивать не с чего' },
    ],
  };
  E.offers = offers;
  sfx('notify');
}

/** Показать итог выборов; если окно занято другим событием — решить за игрока по умолчанию. */
function show(g: GameState, ev: NonNullable<GameState['event']>, fallback: number) {
  if (!g.event) {
    g.event = ev;
    return;
  }
  const busy = g.event;
  g.event = ev;
  resolveElectionEvent(g, fallback);
  g.event = busy;
}

function vote(g: GameState) {
  const E = g.elections;
  if (g.event && g.day < E.next + 10) return; // окно занято — подождём, но недолго
  const swing = (rand(g) + rand(g) + rand(g) - 1.5) * 8;
  let ours = Math.max(5, Math.min(95, E.approval + swing + (E.rigged ?? 0)));
  const party = PARTY_BY_ID[E.party] ?? PARTIES[1];
  E.campaign = false;
  E.boost = 0;
  const promise = E.promise;
  E.promise = undefined;
  // подтасовку могут раскрыть
  if (E.rigged && rand(g) < (me(g).gov === 'democracy' ? 0.45 : 0.35)) {
    E.rigged = 0;
    E.next = g.day + 120;
    E.trust -= 20;
    me(g).mods.push({ kind: 'stab', value: -15, until: g.day + 200, label: 'Фальсификация выборов' });
    relFree(g, -10);
    g.counters.electionsRigged = (g.counters.electionsRigged ?? 0) + 1;
    show(g, {
      id: 'el-fraud', kind: 'election', icon: '🗳️', title: 'Фальсификации раскрыты',
      text: `Наблюдатели нашли вбросы бюллетеней. Итоги отменены, переголосование — через 120 дней. Страна возмущена, демократии осуждают.`,
      options: [{ label: 'Принять', hint: 'стабильность −15, доверие −20, отношения с демократиями −10' }],
    }, 0);
    sfx('alarm');
    computeAll(g);
    return;
  }
  E.rigged = 0;
  ours = Math.round(ours);
  const won = ours >= 50;
  E.last = { day: g.day, ours, won };
  E.next = g.day + (CYCLE[me(g).gov] ?? 1460);
  if (won) {
    E.mandate = promise ? { ...promise, until: g.day + 365 } : undefined;
    g.counters.electionsWon = (g.counters.electionsWon ?? 0) + 1;
    me(g).mods.push({ kind: 'stab', value: 6, until: g.day + 365, label: 'Мандат доверия' });
    sfx('victory');
    show(g, {
      id: 'el-won', kind: 'election', icon: '🎉', title: 'Победа на выборах!',
      text: `Мы набрали ${ours}%, ${party.icon} «${party.name}» — ${100 - ours}%. Народ снова доверил нам страну.`
        + (promise ? ` Теперь у нас год, чтобы выполнить обещание: ${promiseText(g, promise).split(' — ')[0].toLowerCase()}.` : ''),
      options: [
        { label: '🎉 Устроить праздник', hint: `−${fmt(income(g) * 20)} 💰, стабильность +3` },
        { label: '🙏 Поблагодарить и за работу', hint: 'ничего не меняется' },
      ],
    }, 1);
  } else {
    E.mandate = undefined;
    g.counters.electionsLost = (g.counters.electionsLost ?? 0) + 1;
    sfx('defeat');
    show(g, {
      id: 'el-lost', kind: 'election', icon: '🗳️', title: 'Оппозиция победила',
      text: `Мы набрали ${ours}%, ${party.icon} «${party.name}» — ${100 - ours}%. Мы остаёмся во главе государства, но правительство `
        + `теперь формирует коалиция, и год действуют её условия: ${party.terms}.`,
      options: [
        { label: '🤝 Признать поражение', hint: `год условий «${party.name}», стабильность +4, демократии уважают (+5)` },
        { label: '✊ Не признавать итоги', hint: 'условий не будет, но стабильность −25, доверие −25, демократии осудят (−15)' },
      ],
    }, 0);
  }
  computeAll(g);
}

const income = (g: GameState) => Math.max(30, STATS[g.player].taxIncome);
function relFree(g: GameState, v: number) {
  g.countries.forEach((o, j) => { if (o.alive && j !== g.player && isFree(o.gov)) addRel(g, g.player, j, v); });
}

/** Ответ игрока в окне выборов. */
export function resolveElectionEvent(g: GameState, option: number) {
  const ev = g.event;
  if (!ev) return;
  g.event = null;
  const E = g.elections;
  const c = me(g);
  if (ev.id === 'el-campaign') {
    const p = E.offers?.[option];
    E.offers = undefined;
    if (p) {
      E.promise = p;
      E.boost += 6;
      log(g, `🗳️ Обещание избирателям: ${promiseText(g, p).split(' — ')[0]}`, 'info', false);
    }
  } else if (ev.id === 'el-won') {
    if (option === 0) {
      c.money -= income(g) * 20;
      c.mods.push({ kind: 'stab', value: 3, until: g.day + 150, label: 'Праздник победы' });
    }
    log(g, `🗳️ Победа на выборах: ${E.last?.ours ?? 0}%`, 'good', false);
    banner({ icon: '🗳️', title: 'Победа на выборах', text: `${E.last?.ours ?? 0}% — народ доверяет нам ещё один срок`, kind: 'gold' });
  } else if (ev.id === 'el-lost') {
    const party = PARTY_BY_ID[E.party] ?? PARTIES[1];
    if (option === 0) {
      E.coalition = { party: party.id, until: g.day + 365 };
      E.approval = 55;
      c.mods.push({ kind: 'stab', value: 4, until: g.day + 200, label: 'Мирная передача власти' });
      relFree(g, 5);
      enforce(g, true);
      log(g, `🤝 Коалиция с партией «${party.name}» на год: ${party.terms}`, 'info', false);
    } else {
      c.mods.push({ kind: 'stab', value: -25, until: g.day + 300, label: 'Украденные выборы' });
      c.unrest += 4;
      E.trust -= 25;
      relFree(g, -15);
      g.counters.electionsStolen = (g.counters.electionsStolen ?? 0) + 1;
      log(g, '✊ Мы не признали итоги выборов. На улицах — протесты', 'bad', false);
    }
  }
  computeAll(g);
}

// ---------- после выборов: обещание и коалиция ----------
function tickMandate(g: GameState) {
  const E = g.elections;
  const m = E.mandate;
  if (!m || g.day < (m.until ?? Infinity)) return;
  E.mandate = undefined;
  const c = me(g);
  if (promiseOk(g, m)) {
    E.trust += 8;
    c.mods.push({ kind: 'stab', value: 5, until: g.day + 365, label: 'Слово сдержано' });
    g.counters.promisesKept = (g.counters.promisesKept ?? 0) + 1;
    sfx('quest');
    log(g, `🗳️ Обещание выполнено: ${promiseText(g, m).split(' — ')[0]} — доверие растёт`, 'good');
  } else {
    E.trust -= 12;
    c.mods.push({ kind: 'stab', value: -8, until: g.day + 300, label: 'Обманутые избиратели' });
    sfx('alarm');
    log(g, `🗳️ Обещание не выполнено: ${promiseText(g, m).split(' — ')[0]} — избиратели этого не забудут`, 'bad');
  }
  computeAll(g);
}

function tickCoalition(g: GameState) {
  const E = g.elections;
  if (!E.coalition) return;
  if (g.day >= E.coalition.until) {
    log(g, `🤝 Коалиционный договор с партией «${PARTY_BY_ID[E.coalition.party]?.name}» истёк — правим сами`, 'good');
    E.coalition = undefined;
    return;
  }
  enforce(g, false);
}

/** Условия коалиции: возвращаем налоги и бюджет в рамки, о каждом нарушении говорим не чаще раза в месяц. */
function enforce(g: GameState, quiet: boolean) {
  const party = g.elections.coalition?.party;
  const c = me(g);
  let fixed = '';
  if (party === 'people' && c.tax > 0.15 + 1e-9) { c.tax = 0.15; fixed = 'налог снижен до 15%'; }
  if (party === 'peace' && c.budget.military > 1) { c.budget.military = 1; fixed = `военный бюджет — «${BUDGET_LEVELS[1]}»`; }
  if (party === 'patriots' && c.budget.military < 2) { c.budget.military = 2; fixed = `военный бюджет — «${BUDGET_LEVELS[2]}»`; }
  if (party === 'social') {
    if (c.budget.health < 2) { c.budget.health = 2; fixed = `медицина — «${BUDGET_LEVELS[2]}»`; }
    if (c.budget.edu < 2) { c.budget.edu = 2; fixed = `образование — «${BUDGET_LEVELS[2]}»`; }
  }
  if (!fixed) return;
  computeAll(g);
  if (!quiet && g.day - (g.counters.coalitionWarn ?? -999) > 30) {
    g.counters.coalitionWarn = g.day;
    log(g, `🤝 Коалиция настояла на своём: ${fixed}`, 'info');
  }
}

export const coalitionParty = (g: GameState) => (g.elections.coalition && g.day < g.elections.coalition.until ? g.elections.coalition.party : null);
/** Коалиция «Партии мира» не даёт игроку объявлять войны. */
export const coalitionWarBlock = (g: GameState, a: number) =>
  a === g.player && coalitionParty(g) === 'peace' ? 'Коалиция с «Партией мира» запрещает объявлять войны' : null;
/** Коалиция «Зелёных» не даёт строить заводы. */
export const coalitionBuildBlock = (g: GameState, ci: number, type: BuildingType) =>
  ci === g.player && type === 'factory' && coalitionParty(g) === 'green' ? 'Коалиция с «Зелёными» запрещает новые заводы' : null;
/** Пределы налога и бюджета, которые ставит коалиция: [мин, макс]. */
export function coalitionBounds(g: GameState, key: 'tax' | 'military' | 'health' | 'edu' | 'infra'): [number, number] {
  const p = coalitionParty(g);
  if (key === 'tax') return [0, p === 'people' ? 0.15 : 0.5];
  if (key === 'military') return p === 'peace' ? [0, 1] : p === 'patriots' ? [2, 3] : [0, 3];
  if ((key === 'health' || key === 'edu') && p === 'social') return [2, 3];
  return [0, 3];
}

// ---------- кампания ----------
export interface CampaignAct { id: string; icon: string; name: string; desc: string }
export const CAMPAIGN_ACTS: CampaignAct[] = [
  { id: 'rally', icon: '📣', name: 'Агитация по стране', desc: 'митинги, реклама, концерты: рейтинг +3' },
  { id: 'debate', icon: '🎤', name: 'Теледебаты', desc: 'можно блеснуть (+6), а можно провалиться (−4)' },
  { id: 'rig', icon: '🗳️', name: 'Подтасовать итоги', desc: '+8% голосов, но если вскроется — переголосование и скандал' },
  { id: 'cancel', icon: '🛑', name: 'Отменить выборы', desc: 'чрезвычайное положение: выборы через год, стабильность −20, доверие −15, демократии осудят' },
];
export const rallyCost = (g: GameState) => income(g) * 20;
export const debateChance = (g: GameState) => Math.max(0.15, Math.min(0.85, 0.5 + (me(g).stability - 55) / 100 + (g.elections.approval - 50) / 150));

export function actError(g: GameState, id: string): string | null {
  const E = g.elections;
  if (!isFree(me(g).gov) || !E.campaign) return 'Кампания ещё не началась';
  if ((E.cd[id] ?? 0) > g.day) return `Снова можно через ${Math.ceil(E.cd[id] - g.day)} дн.`;
  if (id === 'rally' && me(g).money < rallyCost(g)) return 'Не хватает денег';
  return null;
}

export function campaignAct(g: GameState, id: string): string | null {
  const err = actError(g, id);
  if (err) return err;
  const E = g.elections;
  const c = me(g);
  if (id === 'rally') {
    c.money -= rallyCost(g);
    E.boost += 3;
    E.cd.rally = g.day + 15;
    log(g, '📣 Агитация по стране: рейтинг +3', 'good', false);
  } else if (id === 'debate') {
    E.cd.debate = E.next; // раз за кампанию
    if (rand(g) < debateChance(g)) {
      E.boost += 6;
      log(g, '🎤 Теледебаты: мы разгромили оппонента — рейтинг +6', 'good');
    } else {
      E.boost -= 4;
      log(g, '🎤 Теледебаты провалены: оппонент был убедительнее — рейтинг −4', 'bad');
    }
  } else if (id === 'rig') {
    E.cd.rig = E.next;
    E.rigged = 8;
    log(g, '🗳️ Избиркомы «поправят» итоги на 8% — лишь бы никто не узнал', 'info', false);
  } else if (id === 'cancel') {
    E.campaign = false;
    E.boost = 0;
    E.rigged = 0;
    E.promise = undefined;
    E.next = g.day + 365;
    E.trust -= 15;
    c.mods.push({ kind: 'stab', value: -20, until: g.day + 300, label: 'Отмена выборов' });
    relFree(g, -12);
    g.counters.electionsCancelled = (g.counters.electionsCancelled ?? 0) + 1;
    sfx('alarm');
    log(g, `🛑 Выборы отменены: чрезвычайное положение. Новые — ${fmtDate(E.next)}`, 'bad');
  }
  computeAll(g);
  return null;
}

// ---------- выборы ботов ----------
/** Кто приходит на смену: оппозиция обычно обещает обратное. */
const NEW_COURSE: Record<Personality, Personality[]> = {
  aggressor: ['cautious', 'trader', 'scientist'],
  fanatic: ['scientist', 'trader', 'cautious'],
  trader: ['scientist', 'cautious', 'aggressor', 'fanatic'],
  scientist: ['trader', 'cautious', 'fanatic', 'aggressor'],
  cautious: ['trader', 'scientist', 'aggressor'],
};

function botElections(g: GameState) {
  g.countries.forEach((c, i) => {
    if (!c.alive || i === g.player || !isFree(c.gov)) return;
    const cycle = CYCLE[c.gov]!;
    if (c.aiFlags.nextVote === undefined || c.aiFlags.nextVote < g.day - 30) c.aiFlags.nextVote = g.day + 200 + Math.floor(rand(g) * cycle);
    if (g.day < c.aiFlags.nextVote) return;
    c.aiFlags.nextVote = g.day + cycle;
    const score = 50 + (c.stability - 55) * 0.7 + (c.aiFlags.voteBias ?? 0) - c.weariness * 0.2 + (rand(g) - 0.5) * 24;
    delete c.aiFlags.voteBias;
    if (score >= 50) {
      if (rand(g) < 0.25) news(g, `🗳️ ${cname(g, i)}: правящая партия удержала власть на выборах`, 'info');
      return;
    }
    // новая власть — новый курс: другой характер, старые обиды и дружбы наполовину забыты
    const old = c.personality;
    c.personality = pick(g, NEW_COURSE[old]);
    for (let j = 0; j < g.countries.length; j++) {
      if (j === i) continue;
      g.rel[i][j] *= 0.7;
      g.rel[j][i] = g.rel[i][j];
    }
    delete c.aiFlags.prepTarget;
    delete c.aiFlags.prepUntil;
    c.mods.push({ kind: 'stab', value: 5, until: g.day + 180, label: 'Новое правительство' });
    news(g, `🗳️ Выборы в стране ${cname(g, i)}: победила оппозиция — новый курс (${PERSONALITIES[old].icon} ${PERSONALITIES[old].name} → ${PERSONALITIES[c.personality].icon} ${PERSONALITIES[c.personality].name})`, 'info');
  });
}
