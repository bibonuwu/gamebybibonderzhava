// Госдолг и МВФ. Страна занимает деньги облигациями под процент, который зависит от кредитного рейтинга (AAA…CCC):
// долг к доходам, дефицит, стабильность, войны, санкции. Совсем плохо — программа МВФ: дешёвый кредит в обмен на
// строгий бюджет (налог не ниже 20%, расходы не выше «Средние»; нарушишь — программу прервут) или дефолт: долг
// списан, но рейтинг «D» на три года и бегство капитала. Раз в несколько лет мир накрывает финансовый кризис.
import { addRel, cname, enemiesOf } from './actions';
import { BUDGET_INFO, BUDGET_LEVELS, IMF_RATE } from './defs';
import { computeAll, STATS } from './economy';
import { goldValue } from './exchange';
import { fmt, fmtDays } from './format';
import { banner, log, news, rand, sfx } from './state';
import type { BudgetKey, Country, GameState, TempMod } from './types';
import { vb } from './world';

export const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'D'];
const STEPS = [85, 75, 65, 55, 45, 35]; // баллы для AAA…B, ниже — CCC
const SPREAD = [0, 0.005, 0.01, 0.02, 0.04, 0.07, 0.12]; // надбавка к мировой ставке
const LIMIT_YEARS = [3, 2.5, 2, 1.5, 1, 0.6, 0.3, 0]; // сколько годовых доходов дадут в долг
export const BASE_RATE = 0.03;
export { IMF_RATE };
export const IMF_DAYS = 730;
export const IMF_TAX = 0.2;
export const IMF_BUDGET = 2; // «Средние»
const IMF_GRACE = 30;
const DEFAULT_DAYS = 1095;
/** Облигации: на сколько дней дохода. */
export const BORROW_DAYS = [90, 180, 365];
const BUDGET_KEYS = Object.keys(BUDGET_INFO) as BudgetKey[];

export const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
function mod(g: GameState, i: number, kind: TempMod['kind'], value: number, days: number, label: string) {
  g.countries[i].mods.push({ kind, value, until: g.day + days, label });
}

// ---------- рейтинг и ставка ----------
/** Доход страны в день — мерило долга. */
export function revenue(_g: GameState, i: number) {
  const s = STATS[i];
  return Math.max(30, s.taxIncome + s.factoryIncome + s.portIncome + s.tradeIncome + s.corpIncome);
}
export const totalDebt = (c: Country) => (c.debt ?? 0) + (c.imf?.loan ?? 0);
/** Долг в годовых доходах. */
export const debtYears = (g: GameState, i: number) => totalDebt(g.countries[i]) / (revenue(g, i) * 365);

/** Из чего складывается кредитный рейтинг (баллы). */
export function ratingParts(g: GameState, i: number): [string, number][] {
  const c = g.countries[i];
  const s = STATS[i];
  const parts: [string, number][] = [['База', 78], ['Стабильность', (c.stability - 60) * 0.3]];
  const dy = debtYears(g, i);
  if (dy > 0.005) parts.push(['Госдолг', -dy * 15]); // год доходов в долг — минус ступень-полторы
  if (c.money < 0) parts.push(['Пустая казна', -15]);
  const gold = goldValue(g, i) / (revenue(g, i) * 365); // золотой запас в годовых доходах
  if (gold > 0.01) parts.push(['Золотой запас', Math.min(6, gold * 20)]);
  if (s.moneyRate < 0) parts.push(['Дефицит бюджета', -8]);
  const wars = enemiesOf(g, i).length;
  if (wars) parts.push(['Войны', -5 * wars]);
  if (s.sanctions > 0) parts.push(['Санкции', -60 * s.sanctions]);
  if (c.imf) parts.push(['Программа МВФ', 8]);
  if ((c.imfBroken ?? 0) > g.day) parts.push(['Сорванная программа МВФ', -20]);
  return parts;
}
/** Кредитный рейтинг: 0 — AAA … 6 — CCC, 7 — D (дефолт). */
export function rating(g: GameState, i: number): number {
  if ((g.countries[i].defaulted ?? 0) > g.day) return 7;
  const v = ratingParts(g, i).reduce((s, p) => s + p[1], 0);
  const k = STEPS.findIndex((t) => v >= t);
  return k < 0 ? 6 : k;
}
export const worldRate = (g: GameState) => g.finance.base + g.finance.shock;
/** Ставка, под которую страну кредитует рынок. */
export function marketRate(g: GameState, i: number) {
  const r = rating(g, i);
  return r >= 7 ? 0.25 : worldRate(g) + SPREAD[r];
}
export const debtLimit = (g: GameState, i: number) => revenue(g, i) * 365 * LIMIT_YEARS[rating(g, i)];
export const borrowRoom = (g: GameState, i: number) => Math.max(0, debtLimit(g, i) - totalDebt(g.countries[i]));

// ---------- облигации ----------
export function borrowError(g: GameState, i: number, amount: number): string | null {
  const r = rating(g, i);
  if (r >= 7) return 'После дефолта в долг не дают';
  if (amount > borrowRoom(g, i) + 1e-6) return `Больше не дадут: при рейтинге ${RATINGS[r]} лимит — ${fmt(debtLimit(g, i))} 💰`;
  return null;
}

export function borrow(g: GameState, i: number, amount: number): string | null {
  const err = borrowError(g, i, amount);
  if (err) return err;
  const c = g.countries[i];
  c.debtRate = marketRate(g, i);
  c.debt = (c.debt ?? 0) + amount;
  c.money += amount;
  if (i === g.player) {
    sfx('coins');
    log(g, `🏦 Выпущены облигации: +${fmt(amount)} 💰 под ${pct(c.debtRate)} годовых`, 'info', false);
  }
  computeAll(g);
  return null;
}

/** Погасить долг: сначала облигации, потом МВФ. */
export function repay(g: GameState, i: number, amount: number): string | null {
  const c = g.countries[i];
  const pay = Math.min(amount, totalDebt(c), Math.max(0, c.money));
  if (pay <= 0) return totalDebt(c) <= 0 ? 'Долгов нет' : 'В казне нет денег';
  c.money -= pay;
  const m = Math.min(pay, c.debt ?? 0);
  c.debt = (c.debt ?? 0) - m;
  if (pay > m && c.imf) c.imf.loan = Math.max(0, c.imf.loan - (pay - m));
  if (totalDebt(c) < 1) {
    c.debt = 0;
    if (c.imf) c.imf.loan = 0;
  }
  if (i === g.player) {
    sfx('coins');
    log(g, `🏦 Погашено долга: ${fmt(pay)} 💰`, 'good', false);
  }
  computeAll(g);
  return null;
}

// ---------- МВФ ----------
export const imfLoanSize = (g: GameState, i: number) => revenue(g, i) * 240;
export function imfError(g: GameState, i: number): string | null {
  const c = g.countries[i];
  if (c.imf) return 'Программа МВФ уже идёт';
  if ((c.imfBan ?? 0) > g.day) return `МВФ не доверяет нам ещё ${fmtDays((c.imfBan ?? 0) - g.day)}`;
  if (rating(g, i) < 4 && c.money >= 0) return 'МВФ помогает только в кризис: рейтинг BB и ниже или пустая казна';
  return null;
}

export function joinImf(g: GameState, i: number): string | null {
  const err = imfError(g, i);
  if (err) return err;
  const c = g.countries[i];
  const loan = imfLoanSize(g, i);
  c.imf = { loan, until: g.day + IMF_DAYS };
  c.money += loan;
  // условия программы вступают в силу сразу
  c.tax = Math.max(c.tax, IMF_TAX);
  for (const k of BUDGET_KEYS) c.budget[k] = Math.min(c.budget[k], IMF_BUDGET);
  if (i === g.player) {
    sfx('treaty');
    log(g, `🏦 Программа МВФ: +${fmt(loan)} 💰 под ${pct(IMF_RATE)} на 2 года. Налог не ниже ${pct(IMF_TAX)}, расходы не выше «${BUDGET_LEVELS[IMF_BUDGET]}»`, 'good', false);
    banner({ icon: '🏦', title: 'Программа МВФ', text: `+${fmt(loan)} 💰 под ${pct(IMF_RATE)} — но бюджет теперь под присмотром`, kind: 'good' });
  } else news(g, `🏦 ${cname(g, i)} ${vb(i, 'получил')} кредит МВФ и затягивает пояса`, 'info');
  computeAll(g);
  return null;
}

/** Какие условия МВФ сейчас нарушены. */
export function imfBreaches(c: Country): string[] {
  const out: string[] = [];
  if (c.tax < IMF_TAX - 1e-9) out.push(`налог ниже ${pct(IMF_TAX)}`);
  for (const k of BUDGET_KEYS) if (c.budget[k] > IMF_BUDGET) out.push(`${BUDGET_INFO[k].name.toLowerCase()} выше «${BUDGET_LEVELS[IMF_BUDGET]}»`);
  return out;
}

function tickImf(g: GameState, i: number) {
  const c = g.countries[i];
  const p = c.imf!;
  const me = i === g.player;
  if (p.loan < 1) {
    c.imf = undefined;
    if (me) log(g, '🏦 Долг МВФ погашен досрочно — бюджет снова наш', 'good');
    return;
  }
  if (g.day >= p.until) {
    c.debt = (c.debt ?? 0) + p.loan;
    c.imf = undefined;
    if (me) log(g, `🏦 Программа МВФ завершена: остаток ${fmt(p.loan)} 💰 стал обычным долгом`, 'good');
    return;
  }
  const breaches = imfBreaches(c);
  if (!me && breaches.length) {
    // боты условия соблюдают
    c.tax = Math.max(c.tax, IMF_TAX);
    for (const k of BUDGET_KEYS) c.budget[k] = Math.min(c.budget[k], IMF_BUDGET);
    return;
  }
  if (!breaches.length) {
    delete p.warn;
    return;
  }
  if (p.warn === undefined) {
    p.warn = g.day;
    sfx('alarm');
    log(g, `🏦 МВФ: нарушены условия (${breaches.join(', ')}) — исправьте за ${IMF_GRACE} дн., иначе программу прервут`, 'bad');
  } else if (g.day - p.warn >= IMF_GRACE) breakImf(g, i);
}

function breakImf(g: GameState, i: number) {
  const c = g.countries[i];
  if (!c.imf) return;
  c.debt = (c.debt ?? 0) + c.imf.loan;
  c.imf = undefined;
  c.imfBan = g.day + DEFAULT_DAYS;
  c.imfBroken = g.day + 365;
  mod(g, i, 'stab', -5, 150, 'Сорвана программа МВФ');
  if (i === g.player) {
    sfx('alarm');
    log(g, '🏦 МВФ прервал программу: долг теперь под рыночный процент, рейтинг упал', 'bad');
  } else news(g, `🏦 МВФ прервал программу помощи стране ${cname(g, i)}`, 'bad');
}

// ---------- дефолт ----------
export function goDefault(g: GameState, i: number) {
  const c = g.countries[i];
  const R = revenue(g, i);
  const before = totalDebt(c);
  c.debt = before * 0.4;
  c.imf = undefined;
  c.imfBan = Math.max(c.imfBan ?? 0, g.day + 365);
  c.defaulted = g.day + DEFAULT_DAYS;
  c.money = Math.max(c.money, -R * 15); // часть долгов казны реструктурирована
  c.billionaires *= 0.75;
  mod(g, i, 'stab', -15, 300, 'Дефолт');
  mod(g, i, 'prod', -0.1, 365, 'Бегство капитала');
  mod(g, i, 'rich', -0.3, 365, 'Дефолт');
  g.countries.forEach((o, k) => { if (o.alive && k !== i) addRel(g, i, k, -6); });
  g.counters.defaults = (g.counters.defaults ?? 0) + (i === g.player ? 1 : 0);
  if (i === g.player) {
    sfx('alarm');
    log(g, `💥 Дефолт: списано ${fmt(before * 0.6)} 💰 долга, но рейтинг «D» на 3 года и инвесторы бегут`, 'bad', false);
    banner({ icon: '💥', title: 'Дефолт', text: 'Долги списаны, но в долг больше не дадут три года', kind: 'war' });
  } else news(g, `💥 Дефолт в стране ${cname(g, i)}: долги не будут выплачены, инвесторы бегут`, 'bad');
  computeAll(g);
}

/** Жёсткая экономия: все расходы на уровень ниже, налоги выше. */
function austerity(g: GameState, i: number) {
  const c = g.countries[i];
  for (const k of BUDGET_KEYS) c.budget[k] = Math.max(0, c.budget[k] - 1);
  c.tax = Math.min(0.5, c.tax + 0.05);
  c.birthPolicy = 0;
  mod(g, i, 'stab', -8, 200, 'Жёсткая экономия');
  if (i === g.player) log(g, '✂️ Жёсткая экономия: расходы урезаны, налоги подняты', 'info', false);
  computeAll(g);
}

// ---------- день ----------
const CRUNCH_GAP = 150;

export function tickDebt(g: GameState) {
  const F = g.finance;
  F.shock *= 0.997;
  if (F.shock < 0.001) F.shock = 0;
  if (g.day >= F.nextCrisis) worldCrisis(g);
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    if (totalDebt(c) > 0) c.debtRate = marketRate(g, i);
    if (c.imf) tickImf(g, i);
  });
  // кризис неплатежей у игрока: в казне глубокий минус, а занять больше негде
  const me = g.player;
  const c = g.countries[me];
  const R = revenue(g, me);
  if (c.money < -R * 60 && borrowRoom(g, me) < R * 60 && !g.event && g.day - (g.counters.lastCrunch ?? -999) > CRUNCH_GAP) crunch(g);
}

function crunch(g: GameState) {
  const me = g.player;
  const c = g.countries[me];
  g.counters.lastCrunch = g.day;
  const r = rating(g, me);
  const opts: { label: string; hint: string; idx: number }[] = [];
  if (!imfError(g, me)) opts.push({ idx: 0, label: '🏦 Программа МВФ', hint: `+${fmt(imfLoanSize(g, me))} 💰 под ${pct(IMF_RATE)} на 2 года; налог не ниже ${pct(IMF_TAX)}, расходы не выше «${BUDGET_LEVELS[IMF_BUDGET]}»` });
  opts.push({ idx: 1, label: '💥 Объявить дефолт', hint: 'долг −60%, рейтинг «D» на 3 года, стабильность −15, производство −10% на год, миллиардеры бегут' });
  opts.push({ idx: 2, label: '✂️ Жёсткая экономия', hint: 'все расходы бюджета на уровень ниже, налог +5%, стабильность −8' });
  g.event = {
    id: 'debt-crunch', kind: 'debt', icon: '💸', title: 'Кризис неплатежей',
    text: `Казна в глубоком минусе (${fmt(c.money)} 💰), а занять больше не у кого: рейтинг ${RATINGS[r]}, долг — ${fmt(totalDebt(c))} 💰. Учителям и солдатам нечем платить.`,
    options: opts,
  };
  sfx('alarm');
}

/** Ответ игрока в окне финансового кризиса. */
export function resolveDebtEvent(g: GameState, option: number) {
  const ev = g.event;
  if (!ev) return;
  g.event = null;
  const pick = ev.options[option]?.idx;
  if (pick === 0) {
    const err = joinImf(g, g.player);
    if (err) log(g, `🏦 ${err}`, 'bad');
  } else if (pick === 1) goDefault(g, g.player);
  else if (pick === 2) austerity(g, g.player);
}

function worldCrisis(g: GameState) {
  const F = g.finance;
  F.nextCrisis = g.day + 2200 + Math.floor(rand(g) * 1400);
  F.shock += 0.04;
  g.countries.forEach((c, i) => { if (c.alive) mod(g, i, 'prod', -0.05, 240, 'Мировой финансовый кризис'); });
  const text = `📉 Мировой финансовый кризис: ставки по долгам взлетели до ${pct(worldRate(g))}, экономики буксуют`;
  news(g, text, 'bad');
  log(g, text, 'bad');
  sfx('alarm');
  computeAll(g);
}

// ---------- боты ----------
/** Бот занимает, когда казна пуста, гасит долг, когда разбогател; в беде — МВФ или дефолт. */
export function botDebt(g: GameState, i: number) {
  const c = g.countries[i];
  const R = revenue(g, i);
  if (c.money < -R * 10) {
    const need = Math.min(borrowRoom(g, i), -c.money + R * 40);
    if (need > R * 10 && rating(g, i) <= 5) borrow(g, i, need);
    else if (c.money < -R * 60) {
      if (!imfError(g, i) && rand(g) < 0.6) joinImf(g, i);
      else goDefault(g, i);
    }
  } else if (totalDebt(c) > 0 && c.money > R * 150) repay(g, i, Math.min(totalDebt(c), c.money - R * 100));
}
