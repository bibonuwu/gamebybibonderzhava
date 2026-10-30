// Биржа: трейдинг сырьём, золотом, оружием и зерном. Купить дёшево, продать дорого — или держать впрок.
// Нефть и литий со склада сами закрывают дефицит, когда в мире их не хватает (стратегический резерв);
// золото ничего не производит, но дорожает в войны, кризисы и финансовую панику, а золотой запас поднимает
// кредитный рейтинг. Оружие и зерно — те же склады, что на вкладках «Оружие» и «Еда».
import { computeAll, STATS } from './economy';
import { buyArms, buyFood, buyQuote, maxBuy, newGood, priceAt, sellArms, sellFood, sellQuote } from './market';
import { activeCrises } from './resources';
import { log, sfx } from './state';
import type { Country, ExchangeState, GameState } from './types';

export type Commodity = 'oil' | 'gold' | 'lith' | 'arms' | 'food';
export const COMMODITIES: Commodity[] = ['oil', 'gold', 'lith', 'arms', 'food'];
/** lot — сколько единиц в котировке: оружие считают тысячами комплектов, зерно — миллионами тонн. */
export const COMMODITY: Record<Commodity, { name: string; icon: string; unit: string; color: string; lot: number; lotName: string }> = {
  oil: { name: 'Нефть', icon: '⛽', unit: 'млн барр.', color: '#d8b45c', lot: 1, lotName: '1 млн барр.' },
  gold: { name: 'Золото', icon: '🧈', unit: 'т', color: '#f2d78b', lot: 1, lotName: '1 т' },
  lith: { name: 'Литий', icon: '🔋', unit: 'тыс. т', color: '#7fd3e8', lot: 1, lotName: '1 тыс. т' },
  arms: { name: 'Оружие', icon: '🔫', unit: 'компл.', color: '#ff9b5a', lot: 1e3, lotName: '1K комплектов' },
  food: { name: 'Зерно', icon: '🌾', unit: 'т', color: '#7ee0a0', lot: 1e6, lotName: '1M т' },
};
/** Товары, которые лежат только на бирже: по ним считаем среднюю цену покупки и прибыль. */
export const PURE: Commodity[] = ['oil', 'gold', 'lith'];
const FEE = 0.97; // комиссия биржи при продаже

// ---------- золото ----------
/** Свободное золото на мировом рынке (т): крупные покупки поднимают цену. */
const GOLD_NORM = 20000;

export function ensureExchange(g: GameState): ExchangeState {
  if (g.exchange) return g.exchange;
  const gross = g.res?.gross0 ?? Math.max(1, g.countries.reduce((a, c, i) => a + (c.alive ? Math.max(0, STATS[i]?.taxIncome ?? 0) : 0), 0));
  const gold = newGood(gross * 0.0012);
  gold.norm = gold.stock = GOLD_NORM;
  g.exchange = { gold, fear: 1, basis: {} };
  gold.price = goldPrice(g);
  return g.exchange;
}

/** Страх на рынках: войны, мировые кризисы и финансовая паника гонят инвесторов в золото. */
export function goldFear(g: GameState) {
  let wars = 0;
  for (const k in g.pairs) if (g.pairs[k].war) wars++;
  return 1 + 0.03 * Math.min(10, wars) + 0.08 * activeCrises(g).length + 2.5 * (g.finance?.shock ?? 0);
}

/** Гладкий детерминированный шум цены (±10%): у золота свои приливы и отливы, а случайность партии не тратится. */
function wobble(day: number) {
  const h = (n: number) => (((Math.imul(n + 7919, 2654435761) >>> 0) % 2001) / 1000) - 1;
  const at = (period: number, salt: number) => {
    const t = day / period, k = Math.floor(t), f = t - k, s = f * f * (3 - 2 * f);
    return h(k * 31 + salt) * (1 - s) + h((k + 1) * 31 + salt) * s;
  };
  return 0.08 * at(45, 1) + 0.035 * at(11, 2);
}

function goldPrice(g: GameState) {
  const ex = g.exchange!;
  return priceAt(ex.gold, ex.gold.stock, (g.res?.level ?? 1) * ex.fear * Math.exp(wobble(g.day)));
}

// ---------- склады ----------
export function holding(c: Country, k: Commodity): number {
  switch (k) {
    case 'oil': return c.oilStock ?? 0;
    case 'gold': return c.gold ?? 0;
    case 'lith': return c.lithStock ?? 0;
    case 'arms': return c.arms;
    case 'food': return c.food;
  }
}
function addHolding(c: Country, k: 'oil' | 'gold' | 'lith', v: number) {
  const next = Math.max(0, holding(c, k) + v);
  if (k === 'oil') c.oilStock = next;
  else if (k === 'gold') c.gold = next;
  else c.lithStock = next;
}

/** Цена за единицу сейчас. */
export function unitPrice(g: GameState, k: Commodity): number {
  switch (k) {
    case 'oil': return g.res?.oil.price ?? 0;
    case 'lith': return g.res?.lith.price ?? 0;
    case 'gold': return ensureExchange(g).gold.price;
    case 'arms': return g.market.arms.price;
    case 'food': return g.market.food.price;
  }
}
/** История цены (раз в 5 дней). */
export function priceHist(g: GameState, k: Commodity): number[] {
  if (k === 'oil' || k === 'lith') return g.res?.[k].hist ?? [];
  if (k === 'gold') return ensureExchange(g).gold.hist;
  return g.market[k].hist;
}
/** Цена к обычной: >1 — дорого, <1 — дёшево. */
export function priceRatio(g: GameState, k: Commodity): number {
  const lvl = g.res?.level ?? 1;
  switch (k) {
    case 'oil': case 'lith': return g.res ? g.res[k].price / Math.max(1e-12, g.res[k].base * lvl) : 1;
    case 'gold': { const m = ensureExchange(g).gold; return m.price / Math.max(1e-12, m.base * lvl); }
    case 'arms': case 'food': { const m = g.market[k]; return m.price / Math.max(1e-12, m.base); }
  }
}

/** Нефть и литий: крупная сделка сдвигает мировую цену (скупить 40 дней мировой добычи — цена вдвое). */
const resImpact = (g: GameState, k: 'oil' | 'lith', qty: number) => qty / Math.max(1e-9, (g.res?.[k].supply ?? 1) * 40);
/** Больше 20 дней мировой добычи за раз не продадут. */
const resCap = (g: GameState, k: 'oil' | 'lith') => (g.res?.[k].supply ?? 0) * 20;

/** Сколько рынок готов продать за раз. */
export function maxQty(g: GameState, k: Commodity): number {
  switch (k) {
    case 'oil': case 'lith': return resCap(g, k);
    case 'gold': return maxBuy(ensureExchange(g).gold);
    case 'arms': case 'food': return maxBuy(g.market[k]);
  }
}

export function buyCost(g: GameState, k: Commodity, qty: number): number {
  if (qty <= 0) return 0;
  switch (k) {
    case 'oil': case 'lith': return qty * unitPrice(g, k) * (1 + resImpact(g, k, qty) / 2);
    case 'gold': return buyQuote(ensureExchange(g).gold, qty);
    case 'arms': case 'food': return buyQuote(g.market[k], qty);
  }
}
export function sellGain(g: GameState, k: Commodity, qty: number): number {
  if (qty <= 0) return 0;
  switch (k) {
    case 'oil': case 'lith': return qty * unitPrice(g, k) * Math.max(0.5, 1 - resImpact(g, k, qty) / 2) * FEE;
    case 'gold': return sellQuote(ensureExchange(g).gold, qty);
    case 'arms': case 'food': return sellQuote(g.market[k], qty);
  }
}

const whole = (k: Commodity) => k === 'arms' || k === 'food';
const round = (k: Commodity, q: number) => (whole(k) ? Math.floor(q) : Math.floor(q * 100) / 100);

/** Сколько можно купить на сумму budget (крупная покупка дороже за единицу — ищем делением пополам). */
export function qtyForMoney(g: GameState, k: Commodity, budget: number): number {
  const cap = maxQty(g, k);
  if (budget <= 0 || cap <= 0) return 0;
  if (buyCost(g, k, cap) <= budget) return round(k, cap);
  let lo = 0, hi = cap;
  for (let n = 0; n < 40; n++) {
    const mid = (lo + hi) / 2;
    if (buyCost(g, k, mid) <= budget) lo = mid;
    else hi = mid;
  }
  return round(k, lo);
}

/** Сколько продать: долю share запаса (оружие и зерно — со своих складов, остальное — с биржевого счёта). */
export const sellQty = (g: GameState, ci: number, k: Commodity, share = 1) => round(k, holding(g.countries[ci], k) * share);

// ---------- сделки ----------
export function buyError(g: GameState, ci: number, k: Commodity, qty: number): string | null {
  if (!g.res && (k === 'oil' || k === 'lith')) return 'Рынок сырья ещё не открылся';
  if (qty <= 0) return 'Нечего покупать';
  if (qty > maxQty(g, k) + 1e-9) return 'На мировом рынке столько нет';
  if (g.countries[ci].money < buyCost(g, k, qty)) return 'Не хватает денег';
  return null;
}

export function exchangeBuy(g: GameState, ci: number, k: Commodity, qty: number): string | null {
  qty = round(k, qty);
  if (k === 'arms') return buyArms(g, ci, qty);
  if (k === 'food') return buyFood(g, ci, qty);
  const err = buyError(g, ci, k, qty);
  if (err) return err;
  const ex = ensureExchange(g);
  const c = g.countries[ci];
  const cost = buyCost(g, k, qty);
  c.money -= cost;
  addHolding(c, k, qty);
  if (k === 'gold') {
    ex.gold.stock -= qty;
    ex.gold.price = goldPrice(g);
  } else g.res![k].price *= 1 + resImpact(g, k, qty);
  if (ci === g.player) {
    ex.basis[k] = (ex.basis[k] ?? 0) + cost;
    sfx('coins');
  }
  computeAll(g);
  return null;
}

export function exchangeSell(g: GameState, ci: number, k: Commodity, qty: number): string | null {
  qty = round(k, qty);
  if (k === 'arms') return sellArms(g, ci, qty);
  if (k === 'food') return sellFood(g, ci, qty);
  if (qty <= 0) return 'Нечего продавать';
  const c = g.countries[ci];
  const have = holding(c, k);
  if (qty > have + 1e-9) return 'У нас столько нет';
  if (!g.res && k !== 'gold') return 'Рынок сырья ещё не открылся';
  const ex = ensureExchange(g);
  const got = sellGain(g, k, qty);
  if (ci === g.player) {
    const part = Math.min(1, qty / Math.max(1e-9, have));
    const paid = (ex.basis[k] ?? 0) * part;
    ex.basis[k] = (ex.basis[k] ?? 0) - paid;
    g.counters.tradeProfit = (g.counters.tradeProfit ?? 0) + got - paid; // прибыль (или убыток) закрытых сделок
    sfx('coins');
  }
  c.money += got;
  addHolding(c, k, -qty);
  if (k === 'gold') {
    ex.gold.stock += qty;
    ex.gold.price = goldPrice(g);
  } else g.res![k].price *= Math.max(0.5, 1 - resImpact(g, k, qty));
  computeAll(g);
  return null;
}

/** Средняя цена покупки того, что лежит на счёте (0 — счёт пуст). */
export function avgCost(g: GameState, k: Commodity): number {
  const have = holding(g.countries[g.player], k);
  return have > 1e-9 ? (g.exchange?.basis[k] ?? 0) / have : 0;
}
/** Сколько принесёт продажа всего счёта сверх потраченного. */
export function profit(g: GameState, k: Commodity): number {
  const have = holding(g.countries[g.player], k);
  return have > 1e-9 ? sellGain(g, k, have) - (g.exchange?.basis[k] ?? 0) : 0;
}

/** Стоимость золотого запаса страны по нынешней цене. */
export const goldValue = (g: GameState, ci: number) => (g.countries[ci].gold ?? 0) * (g.exchange?.gold.price ?? 0);

// ---------- день ----------
export function tickExchange(g: GameState) {
  const ex = ensureExchange(g);
  ex.fear += (goldFear(g) - ex.fear) * 0.05;
  ex.gold.stock += (ex.gold.norm - ex.gold.stock) * 0.01;
  ex.gold.price = goldPrice(g);
  if (g.day % 5 === 0) {
    ex.gold.hist.push(ex.gold.price);
    if (ex.gold.hist.length > 60) ex.gold.hist.shift();
  }
  // стратегический резерв: нефть и литий со склада закрывают то, чего не нашлось на мировом рынке
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    const s = STATS[i];
    for (const k of ['oil', 'lith'] as const) {
      const draw = k === 'oil' ? s.oilDraw : s.lithDraw;
      if (!(draw > 0)) continue;
      const have = holding(c, k);
      if (i === g.player) ex.basis[k] = (ex.basis[k] ?? 0) * Math.max(0, 1 - draw / Math.max(1e-9, have));
      addHolding(c, k, -draw);
    }
  });
  const s = STATS[g.player];
  if (s && s.oilDraw + s.lithDraw > 0 && g.day - (g.counters.reserveWarn ?? -999) > 90) {
    g.counters.reserveWarn = g.day;
    const c = g.countries[g.player];
    const what = s.oilDraw > 0 ? `⛽ нефти осталось на ${Math.floor((c.oilStock ?? 0) / s.oilDraw)} дн.` : `🔋 лития осталось на ${Math.floor((c.lithStock ?? 0) / s.lithDraw)} дн.`;
    log(g, `🛢️ Мировой дефицит: заводы работают на стратегическом резерве — ${what}`, 'info');
  }
}
