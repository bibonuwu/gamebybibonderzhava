// Мировой рынок продовольствия и оружия. Цена зависит от того, сколько товара свободно в мире:
// скупают — дорожает, продают — дешевеет. Малые страны (вне игры) понемногу возвращают рынок к норме.
import { ARMS_BASE, FOOD_BASE } from './defs';
import { computeAll, STATS } from './economy';
import { fmt } from './format';
import { log, news, pick, rand, sfx } from './state';
import type { GameState, MarketGood } from './types';
import { embargoed } from './un';

export const newGood = (base: number): MarketGood => ({ stock: 1, norm: 1, base, price: base, shock: 0, hist: [] });

/** Цена единицы при данном запасе на рынке. */
export function priceAt(m: MarketGood, stock: number, mod = 1) {
  const scarcity = Math.max(0.4, Math.min(4, Math.pow(m.norm / Math.max(m.norm * 0.03, stock), 0.7)));
  return m.base * scarcity * Math.max(0.3, 1 + m.shock) * mod;
}

/** Чем больше войн в мире, тем дороже оружие. */
export function armsWarMod(g: GameState) {
  let wars = 0;
  for (const k in g.pairs) if (g.pairs[k].war) wars++;
  return 1 + 0.05 * Math.min(10, wars);
}

/** Стоимость сделки с учётом того, что крупная покупка сама поднимает цену. */
function quote(m: MarketGood, qty: number, buy: boolean) {
  const p0 = priceAt(m, m.stock);
  const p1 = priceAt(m, buy ? m.stock - qty : m.stock + qty);
  return (qty * m.price * (1 + p1 / p0)) / 2;
}
export const buyQuote = (m: MarketGood, qty: number) => quote(m, qty, true);
export const sellQuote = (m: MarketGood, qty: number) => quote(m, qty, false) * 0.97; // комиссия биржи
/** Сколько товара рынок готов продать за раз. */
export const maxBuy = (m: MarketGood) => Math.max(0, m.stock - m.norm * 0.1);

function refresh(g: GameState) {
  const mk = g.market;
  mk.food.price = priceAt(mk.food, mk.food.stock);
  mk.arms.price = priceAt(mk.arms, mk.arms.stock, armsWarMod(g));
}

export function initMarket(g: GameState) {
  const mk = g.market;
  let food = 0, soldiers = 0, sci = 0;
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    food += STATS[i].foodCons;
    soldiers += c.soldiers;
    sci += c.scientists;
  });
  mk.food.norm = mk.food.stock = food * 20;
  mk.arms.norm = mk.arms.stock = soldiers * 0.15;
  mk.sciNorm = mk.sciPool = sci * 0.004;
  refresh(g);
}

// ---------- сделки ----------
function trade(g: GameState, ci: number, good: 'food' | 'arms', qty: number, buy: boolean): string | null {
  const m = g.market[good];
  const c = g.countries[ci];
  qty = Math.floor(qty);
  if (qty <= 0) return buy ? 'Нечего покупать' : 'Нечего продавать';
  if (buy) {
    if (good === 'arms' && embargoed(g, ci)) return 'Эмбарго ООН: агрессору оружие не продают';
    if (qty > maxBuy(m)) return 'На мировом рынке столько нет';
    const cost = buyQuote(m, qty);
    if (c.money < cost) return 'Не хватает денег';
    c.money -= cost;
    c[good] += qty;
    m.stock -= qty;
  } else {
    if (qty > c[good]) return 'У нас столько нет';
    const got = sellQuote(m, qty);
    c.money += got;
    c[good] -= qty;
    m.stock += qty;
    if (ci === g.player) {
      const key = good === 'food' ? 'foodSold' : 'armsSold';
      g.counters[key] = (g.counters[key] ?? 0) + qty;
    }
  }
  if (ci === g.player) sfx('coins');
  refresh(g);
  computeAll(g);
  return null;
}
export const buyFood = (g: GameState, ci: number, qty: number) => trade(g, ci, 'food', qty, true);
export const sellFood = (g: GameState, ci: number, qty: number) => trade(g, ci, 'food', qty, false);
export const buyArms = (g: GameState, ci: number, qty: number) => trade(g, ci, 'arms', qty, true);
export const sellArms = (g: GameState, ci: number, qty: number) => trade(g, ci, 'arms', qty, false);

/** Дней, на сколько хватит запаса еды при нынешнем потреблении. */
export const foodDays = (g: GameState, ci: number) => g.countries[ci].food / Math.max(1, STATS[ci].foodCons);

// ---------- день ----------
export function tickMarket(g: GameState) {
  const mk = g.market;
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    const s = STATS[i];
    c.food = Math.max(0, c.food + s.foodProd - s.foodCons + s.foodBuy - s.foodSell);
    mk.food.stock = Math.max(mk.food.norm * 0.03, mk.food.stock - s.foodBuy + s.foodSell);
    // оружие устаревает, заводы выпускают новое
    c.arms = Math.max(0, c.arms * 0.999 + s.armsProd);
    if (i === g.player && s.foodSell > 0) g.counters.foodSold = (g.counters.foodSold ?? 0) + s.foodSell;
  });
  for (const m of [mk.food, mk.arms]) {
    m.stock += (m.norm - m.stock) * 0.02;
    m.shock *= 0.99;
    if (Math.abs(m.shock) < 0.005) m.shock = 0;
  }
  mk.sciPool += (mk.sciNorm - mk.sciPool) * 0.005;
  refresh(g);
  if (g.day % 5 === 0) {
    for (const m of [mk.food, mk.arms]) {
      m.hist.push(m.price);
      if (m.hist.length > 60) m.hist.shift();
    }
  }
  if (g.day >= mk.nextShock) worldShock(g);

  // предупреждение о голоде
  const s = STATS[g.player];
  if (s?.hunger > 0 && g.day - (g.counters.hungerWarn ?? -999) > 45) {
    g.counters.hungerWarn = g.day;
    sfx('alarm');
    log(g, `🍞 Голод! Не хватает ${Math.round(s.hunger * 100)}% еды — закупите продовольствие на 🏪 рынке`, 'bad');
  }
}

const SHOCKS: { good: 'food' | 'arms'; v: number; text: string; kind: 'good' | 'bad' | 'info' }[] = [
  { good: 'food', v: 0.6, text: '🌍 Мировой неурожай: цены на продовольствие взлетели', kind: 'bad' },
  { good: 'food', v: -0.3, text: '🌾 Рекордный мировой урожай: продовольствие дешевеет', kind: 'good' },
  { good: 'arms', v: 0.5, text: '🚀 Гонка вооружений: оружие на мировом рынке дорожает', kind: 'bad' },
  { good: 'arms', v: -0.3, text: '🕊️ Договор о разоружении: оружие дешевеет', kind: 'good' },
];

/** Резкий скачок цены: мировое потрясение или биржевой сговор тайной ложи. */
export function shockMarket(g: GameState, good: 'food' | 'arms', v: number) {
  const m = g.market[good];
  m.shock = Math.max(-0.5, Math.min(1.5, m.shock + v));
  refresh(g);
}

function worldShock(g: GameState) {
  const mk = g.market;
  mk.nextShock = g.day + 350 + Math.floor(rand(g) * 300);
  const sh = pick(g, SHOCKS);
  const m = mk[sh.good];
  shockMarket(g, sh.good, sh.v);
  news(g, `${sh.text} (${fmt(m.price * (sh.good === 'food' ? 1e6 : 1e3))} 💰 за ${sh.good === 'food' ? '1M т' : '1K комплектов'})`, sh.kind);
}

/** Цена для показа: еда — за 1M т, оружие — за 1K комплектов. */
export const showPrice = (g: GameState, good: 'food' | 'arms') => g.market[good].price * (good === 'food' ? 1e6 : 1e3);
export const priceTrend = (m: MarketGood) => (m.hist.length > 10 ? m.price / m.hist[Math.max(0, m.hist.length - 11)] - 1 : 0);
export { ARMS_BASE, FOOD_BASE };
