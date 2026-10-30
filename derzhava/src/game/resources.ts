// Стратегическое сырьё: нефть и литий. Месторождения лежат в регионах — у каждой страны свои, как в жизни,
// и богатые ничьи земли: Ближний Восток, «литиевый треугольник» Южной Америки, Конго, Гренландия.
// Нужды стран растут вместе с экономикой и технологиями (роботам и электромобилям нужен литий), а нефть
// понемногу иссякает: к середине партии сырья не хватает, цены растут, импортёры теряют производство,
// а земли с месторождениями становятся поводом для войны. Здесь же — мировые потрясения поздней игры:
// с каждым годом они случаются чаще.
import { cname } from './actions';
import { GREEN_LEVELS } from './defs';
import { FREE_RES, modSum, STATS, type CountryStats } from './economy';
import { fmt } from './format';
import { shockMarket } from './market';
import { banner, log, news, pick, rand, sfx } from './state';
import type { GameState, ResourceMarket } from './types';
import { COUNTRY_DEFS, REGIONS, TERRAIN } from './world';

export type Res = 'oil' | 'lith';
export const RES_INFO: Record<Res, { name: string; icon: string; unit: string; short: number }> = {
  oil: { name: 'Нефть', icon: '⛽', unit: 'млн барр./день', short: 0.2 },
  lith: { name: 'Литий', icon: '🔋', unit: 'тыс. т/год', short: 0.1 },
};

// ---------- месторождения ----------
/** Добыча по странам (нефть — млн баррелей в день, литий — тысячи тонн в год), примерно как в жизни. */
const OIL: Record<string, number> = {
  us: 13, sa: 10.5, ru: 10, ca: 5.5, cn: 4.2, ir: 3.6, br: 3.4, mx: 1.9, kz: 1.9, ng: 1.5, dz: 1.2, gb: 0.8, ar: 0.8, id: 0.6, in: 0.6, eg: 0.6, au: 0.4,
};
const LITH: Record<string, number> = { au: 9, cn: 5, ar: 3.5, br: 1.2, ca: 1, us: 1, ru: 0.8, id: 0.8, kz: 0.6, za: 0.6, in: 0.3 };
/** Ничьи земли по частям света: Ирак, Кувейт, Эмираты; Ливия и Ангола; Венесуэла; Норвегия; Туркмения… */
const OIL_FREE: Record<string, number> = { 'Ближний Восток': 14, 'Африка': 3.5, 'Юж. Америка': 2.2, 'Европа': 2.2, 'Средняя Азия': 1.3, 'Азия': 1 };
/** Чили и Боливия, Конго и Зимбабве, редкие земли Гренландии и Мьянмы. */
const LITH_FREE: Record<string, number> = { 'Юж. Америка': 9, 'Африка': 4, 'Гренландия': 1.5, 'Азия': 1 };

/** Часть света ничьей земли: «Вольные земли — Ближний Восток 3» → «Ближний Восток». */
const partOf = (name: string) => name.replace(/^.*— /, '').replace(/ \d+$/, '');
/** Детерминированный «случай» для региона: месторождения одни и те же в каждой партии. */
const hash = (id: number, salt: number) => ((Math.imul(id + 1, 2654435761) ^ salt) >>> 0) % 1000 / 1000;

function shareOf(id: number, ter: string) {
  const tiles = REGIONS[id].tiles;
  let n = 0;
  for (const t of tiles) if (ter.includes(TERRAIN[t])) n++;
  return n / Math.max(1, tiles.length);
}

/** Разложить запасы группы регионов по самым подходящим из них. */
function spread(out: Float64Array, ids: number[], total: number, share: number, score: (id: number) => number) {
  if (!ids.length || total <= 0) return;
  const ranked = ids.map((id) => ({ id, s: score(id) })).sort((a, b) => b.s - a.s);
  const top = ranked.slice(0, Math.max(1, Math.round(ids.length * share)));
  const sum = top.reduce((a, x) => a + x.s + 0.5, 0);
  for (const x of top) out[x.id] += (total * (x.s + 0.5)) / sum;
}

/** Нефть и литий каждого региона (запасы на старте). */
export const REGION_OIL = new Float64Array(REGIONS.length);
export const REGION_LITH = new Float64Array(REGIONS.length);
{
  const groups = new Map<string, number[]>();
  for (const r of REGIONS) {
    const key = r.origOwner >= 0 ? COUNTRY_DEFS[r.origOwner].id : `free:${partOf(r.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r.id);
  }
  const oilScore = (id: number) => 2 * shareOf(id, 'd') + 1.2 * shareOf(id, 't') + (REGIONS[id].coastal ? 0.4 : 0) + hash(id, 7);
  const lithScore = (id: number) => 2 * REGIONS[id].mountainShare + shareOf(id, 'd') + hash(id, 13);
  for (const [key, ids] of groups) {
    const free = key.startsWith('free:');
    const k = free ? key.slice(5) : key;
    const oil = free ? OIL_FREE[k] : OIL[k];
    const lith = free ? LITH_FREE[k] : LITH[k];
    if (oil) spread(REGION_OIL, ids, oil, free && k === 'Ближний Восток' ? 0.8 : 0.35, oilScore);
    if (lith) spread(REGION_LITH, ids, lith, 0.25, lithScore);
  }
}
/** Сколько всего месторождений (для подсказок). */
export const hasDeposit = (rid: number) => REGION_OIL[rid] > 0.05 || REGION_LITH[rid] > 0.05;

/** Нефть иссякает: старые месторождения дают всё меньше. */
export const oilDepletion = (g: GameState) => Math.pow(0.99, g.day / 365);

// ---------- эпоха ресурсов: начало ----------
const newMarket = (): ResourceMarket => ({ base: 1, k: 1, price: 1, hist: [], demand: 0, supply: 0, avail: 1, sell: 1, cut: 0, boom: 0 });
/** Вес страны в мировом спросе: большие экономики сырья берут больше, но не пропорционально. */
export const weight0 = (gdp0: number) => Math.pow(Math.max(1, gdp0), 0.85);

/** Рынки сырья: нужды стран настроены так, чтобы в начале нефти хватало впритык, а лития — с запасом. */
export function initResources(g: GameState, stats: CountryStats[]) {
  let gross = 0, w = 0, oil = 0, lith = 0, freeOil = 0, freeLith = 0;
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    gross += Math.max(0, stats[i].taxIncome);
    w += weight0(c.gdp0 ?? 1);
  });
  g.regions.forEach((r, id) => {
    if (r.owner >= 0) { oil += REGION_OIL[id]; lith += REGION_LITH[id]; }
    else { freeOil += REGION_OIL[id]; freeLith += REGION_LITH[id]; }
  });
  const S = { oil: (oil + 0.7 * freeOil) * oilDepletion(g), lith: lith + 0.7 * freeLith };
  const R = { oil: newMarket(), lith: newMarket(), gross0: Math.max(1, gross), level: 1 };
  const setup = (m: ResourceMarket, supply: number, fill: number, valueShare: number) => {
    m.k = (fill * supply) / Math.max(1, w);
    m.base = (valueShare * R.gross0) / Math.max(1e-9, fill * supply);
    m.price = m.base * Math.max(0.4, fill * fill);
    m.demand = fill * supply;
    m.supply = supply;
  };
  setup(R.oil, S.oil, 0.95, 0.04);
  setup(R.lith, S.lith, 0.55, 0.012);
  g.res = R;
}

// ---------- страна: добыча, нужды, торговля сырьём ----------
/** Сырьё страны на день: добыча, нужды, выручка или закупка по мировой цене, недостача при мировом дефиците. */
export function resourceStats(g: GameState, i: number, s: CountryStats, gdp: number, oilCap: number, lithCap: number) {
  const R = g.res!;
  const c = g.countries[i];
  const m = s.mods;
  const gdp0 = Math.max(1, c.gdp0 ?? gdp);
  const w0 = weight0(gdp0);
  const size = Math.max(0.2, gdp / gdp0);
  const green = GREEN_LEVELS[c.green ?? 0];
  s.oilProd = oilCap * oilDepletion(g);
  s.lithProd = lithCap;
  s.oilNeed = R.oil.k * w0 * Math.pow(size, 0.6) * m.oil * (1 - green.oil) * (1 + R.oil.boom);
  s.lithNeed = R.lith.k * w0 * Math.pow(size, 0.45) * (1 + 0.22 * m.auto) * m.lith * (1 + 0.4 * (c.green ?? 0)) * (1 + R.lith.boom);
  // под санкциями ООН сырьё у агрессора покупают немногие
  const open = 1 - Math.min(0.75, s.sanctions * 3);
  let money = 0, short = 0;
  for (const k of ['oil', 'lith'] as Res[]) {
    const mk = R[k];
    const prod = k === 'oil' ? s.oilProd : s.lithProd;
    const need = k === 'oil' ? s.oilNeed : s.lithNeed;
    const bal = prod - need;
    if (bal >= 0) money += bal * mk.sell * open * mk.price;
    else {
      money += bal * mk.avail * mk.price;
      // чего не нашлось на рынке, берём из стратегического резерва (биржа, exchange.ts)
      const miss = -bal * (1 - mk.avail);
      const draw = Math.min(miss, (k === 'oil' ? c.oilStock : c.lithStock) ?? 0);
      if (k === 'oil') s.oilDraw = draw;
      else s.lithDraw = draw;
      short += ((miss - draw) / Math.max(1e-9, need)) * RES_INFO[k].short;
    }
  }
  s.resMoney = money;
  s.resShort = Math.min(0.3, short);
  if (g.climate) {
    s.emis = (w0 * Math.pow(size, 0.8) * m.emis * (1 - green.cut) * Math.max(0.2, 1 + modSum(g, c, 'emis'))) / g.climate.e0;
  }
}

/** Насколько стране не хватает сырья: доля импорта × дороговизна (0 — сырья вдоволь, 2–3 — голод). */
export function resHunger(g: GameState, i: number): number {
  const R = g.res;
  const s = STATS[i];
  if (!R || !s) return 0;
  const part = (prod: number, need: number, mk: ResourceMarket) =>
    need > 0 ? Math.max(0, (need - prod) / need) * Math.max(0, mk.price / mk.base - 0.8 + (1 - mk.avail) * 2) : 0;
  return part(s.oilProd, s.oilNeed, R.oil) + 0.6 * part(s.lithProd, s.lithNeed, R.lith);
}

/** Во сколько раз регион ценнее для страны из-за месторождений (1 — сырья в нём нет). */
export function resBoost(g: GameState, i: number, rid: number): number {
  const o = REGION_OIL[rid], l = REGION_LITH[rid];
  if (!g.res || (o < 0.05 && l < 0.05)) return 1;
  return 1 + Math.min(3, resHunger(g, i)) * (o / (o + 1) + l / (l + 1)) + 0.2;
}

/** Месторождения страны b у границы со страной a (сумма запасов). */
export function borderDeposits(g: GameState, a: number, b: number): number {
  let sum = 0;
  const seen = new Set<number>();
  for (const rid of STATS[a]?.regions ?? []) {
    for (const nb of REGIONS[rid].neighbors) {
      if (seen.has(nb) || g.regions[nb].owner !== b) continue;
      seen.add(nb);
      sum += REGION_OIL[nb] + REGION_LITH[nb];
    }
  }
  return sum;
}

/** Цена для показа: нефть — за 1 млн баррелей, литий — за 1 тыс. т. */
export const resPrice = (g: GameState, k: Res) => g.res?.[k].price ?? 0;
export const resPriceRatio = (g: GameState, k: Res) => (g.res ? g.res[k].price / Math.max(1e-9, g.res[k].base * g.res.level) : 1);

// ---------- мировой рынок: раз в день ----------
export function tickResources(g: GameState) {
  const R = g.res;
  if (!R) return;
  let gross = 0;
  const tot = { oil: { D: 0, S: 0, imp: 0, exp: 0 }, lith: { D: 0, S: 0, imp: 0, exp: 0 } };
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    const s = STATS[i];
    gross += Math.max(0, s.taxIncome);
    const open = 1 - Math.min(0.75, s.sanctions * 3);
    for (const k of ['oil', 'lith'] as Res[]) {
      const prod = k === 'oil' ? s.oilProd : s.lithProd;
      const need = k === 'oil' ? s.oilNeed : s.lithNeed;
      const t = tot[k];
      t.D += need;
      t.S += prod;
      if (prod >= need) t.exp += (prod - need) * open;
      else t.imp += need - prod;
    }
  });
  R.level += (Math.pow(gross / R.gross0, 0.85) - R.level) * 0.01;
  for (const k of ['oil', 'lith'] as Res[]) {
    const mk = R[k];
    const t = tot[k];
    // ничьи земли продают то, что не съедают сами
    const free = FREE_RES[k] * 0.7 * (k === 'oil' ? oilDepletion(g) : 1);
    const S = (t.S + free) * (1 - mk.cut);
    const exp = (t.exp + free) * (1 - mk.cut);
    mk.demand = t.D;
    mk.supply = S;
    mk.avail = t.imp > 0 ? Math.min(1, exp / t.imp) : 1;
    mk.sell = exp > 0 ? Math.min(1, t.imp / exp) : 1;
    const ratio = t.D / Math.max(1e-9, S);
    const target = mk.base * R.level * Math.max(0.4, Math.min(5, ratio * ratio));
    const before = mk.price / (mk.base * R.level);
    mk.price += (target - mk.price) * 0.04;
    const after = mk.price / (mk.base * R.level);
    if (before < 2 && after >= 2) news(g, `${RES_INFO[k].icon} ${RES_INFO[k].name} ${k === 'oil' ? 'подорожала' : 'подорожал'} вдвое: ${k === 'oil' ? 'нефти' : 'лития'} в мире не хватает`, 'bad');
    if (before < 3.5 && after >= 3.5) news(g, `${RES_INFO[k].icon} ${k === 'oil' ? 'Нефтяной' : 'Литиевый'} голод: цена выше обычной в ${Math.round(after)} раза — земли с месторождениями теперь на вес золота`, 'war');
    if (g.day % 5 === 0) {
      mk.hist.push(mk.price);
      if (mk.hist.length > 60) mk.hist.shift();
    }
  }
  // недостача сырья бьёт по нашему производству — предупреждаем
  const s = STATS[g.player];
  if (s && s.resShort > 0.015 && g.day - (g.counters.resWarn ?? -999) > 120) {
    g.counters.resWarn = g.day;
    sfx('alarm');
    const what = s.oilNeed > s.oilProd && R.oil.avail < 1 ? 'нефти' : 'лития';
    log(g, `⛽ В мире не хватает ${what}: наше производство −${Math.round(s.resShort * 100)}%. Помогут свои месторождения, зелёная энергетика или переработка`, 'bad');
  }
  tickCrises(g);
}

// ---------- мировые потрясения ----------
interface CrisisDef {
  id: string;
  icon: string;
  name: string;
  days: number;
  can: (g: GameState) => boolean;
  /** Начало кризиса: текст новости. */
  start: (g: GameState) => string;
  end?: (g: GameState) => void;
}

const alive = (g: GameState) => g.countries.filter((c) => c.alive).map((c) => c.idx);
const temp = (g: GameState) => g.climate?.temp ?? 1.3;
function mod(g: GameState, i: number, kind: 'stab' | 'prod' | 'food' | 'growth', value: number, days: number, label: string) {
  g.countries[i].mods.push({ kind, value, until: g.day + days, label });
}
const HOT = new Set(['in', 'pk', 'eg', 'ng', 'sa', 'ir', 'dz', 'id', 'mx', 'br', 'au', 'za']);

export const CRISES: CrisisDef[] = [
  { id: 'embargo', icon: '⛽', name: 'Нефтяное эмбарго', days: 240, can: (g) => g.day > 700,
    start: (g) => {
      g.res!.oil.cut = 0.3;
      return 'Картель нефтяных стран урезал добычу на треть: нефть дорожает, у импортёров встают заводы';
    },
    end: (g) => { g.res!.oil.cut = 0; } },
  { id: 'lithium', icon: '🔋', name: 'Литиевая лихорадка', days: 365, can: (g) => g.day > 1100,
    start: (g) => {
      g.res!.lith.boom = 0.45;
      return 'Мир скупает батареи и электромобили: спрос на литий вырос почти в полтора раза';
    },
    end: (g) => { g.res!.lith.boom = 0; } },
  { id: 'heat', icon: '🔥', name: 'Аномальная жара', days: 150, can: (g) => temp(g) >= 1.6,
    start: (g) => {
      const v = 0.05 + 0.05 * (temp(g) - 1.5);
      for (const i of alive(g)) mod(g, i, 'food', -v * (HOT.has(COUNTRY_DEFS[i].id) ? 1.5 : 1), 150, 'Аномальная жара');
      shockMarket(g, 'food', 0.35);
      return `Жара на всех континентах: урожай −${Math.round(v * 100)}% и больше, продовольствие дорожает`;
    } },
  { id: 'cyber', icon: '👾', name: 'Мировая кибератака', days: 60, can: (g) => g.day > 1500,
    start: (g) => {
      const hit = alive(g).filter((i) => !g.countries[i].techs.includes('cyber_army') && rand(g) < 0.3);
      for (const i of hit) mod(g, i, 'prod', -0.08, 60, 'Кибератака');
      return `Хакеры парализовали банки и заводы: пострадали ${hit.length ? hit.map((i) => cname(g, i)).join(', ') : 'немногие'}`;
    } },
  { id: 'refugees', icon: '🧳', name: 'Климатические беженцы', days: 180, can: (g) => temp(g) >= 1.9,
    start: (g) => {
      for (const i of alive(g)) {
        const id = COUNTRY_DEFS[i].id;
        if (HOT.has(id)) {
          mod(g, i, 'stab', -3, 180, 'Бегство от жары');
          mod(g, i, 'growth', -0.5, 180, 'Бегство от жары');
        } else if (COUNTRY_DEFS[i].gdp > 25) {
          mod(g, i, 'stab', -3, 180, 'Споры о климатических беженцах');
          mod(g, i, 'growth', 0.4, 180, 'Климатические беженцы');
        }
      }
      return 'Миллионы людей бегут из раскалённых стран на север: южане теряют людей, богатые страны спорят о мигрантах';
    } },
  { id: 'supply', icon: '📦', name: 'Обвал цепочек поставок', days: 120, can: (g) => g.day > 900,
    start: (g) => {
      for (const i of alive(g)) if ((STATS[i]?.tradePartners ?? 0) >= 3) mod(g, i, 'prod', -0.05, 120, 'Обвал поставок');
      shockMarket(g, 'arms', 0.25);
      return 'Порты забиты, контейнеры застряли в пути: страны, живущие торговлей, теряют производство';
    } },
];
export const CRISIS_BY_ID = Object.fromEntries(CRISES.map((c) => [c.id, c])) as Record<string, CrisisDef>;
export const activeCrises = (g: GameState) => (g.crises?.active ?? []).filter((a) => a.until > g.day);

/** С каждым годом мир всё беспокойнее: от кризиса до кризиса меньше времени. */
const crisisGap = (g: GameState) => Math.max(260, 800 - (g.day / 365) * 35) * (0.7 + 0.6 * rand(g));

function tickCrises(g: GameState) {
  const C = (g.crises ??= { next: g.day + 700, active: [] });
  for (const a of C.active) if (a.until <= g.day) CRISIS_BY_ID[a.id]?.end?.(g);
  C.active = C.active.filter((a) => a.until > g.day);
  if (g.day < C.next) return;
  C.next = g.day + Math.round(crisisGap(g));
  const options = CRISES.filter((d) => d.can(g) && !C.active.some((a) => a.id === d.id));
  if (!options.length) return;
  const d = pick(g, options);
  C.active.push({ id: d.id, until: g.day + d.days });
  const text = d.start(g);
  news(g, `🌍 ${d.icon} ${d.name}: ${text}`, 'bad');
  if (g.countries[g.player].alive) {
    sfx('alarm');
    banner({ icon: d.icon, title: `Мировой кризис: ${d.name}`, text, kind: 'war' });
  }
}

/** Цена в деньгах для показа и подсказок (за 1 единицу в день, ×1000 для читаемости). */
export const fmtResPrice = (g: GameState, k: Res) => fmt(resPrice(g, k) * 1000);
/** Кто в мире больше всех добывает: [страна, добыча]. */
export function topProducers(g: GameState, k: Res, n = 5): [number, number][] {
  const out: [number, number][] = [];
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    const v = k === 'oil' ? STATS[i].oilProd : STATS[i].lithProd;
    if (v > 0.05) out.push([i, v]);
  });
  return out.sort((a, b) => b[1] - a[1]).slice(0, n);
}
/** Ничьи регионы с месторождениями. */
export const freeDeposits = (g: GameState) => g.regions.map((r, id) => (r.owner < 0 && hasDeposit(id) ? id : -1)).filter((id) => id >= 0);
