// Производные показатели стран: доходы, наука, рост населения, стабильность, армия, продовольствие, общество.
import {
  ADDITIVE_MODS, BASE_MODS, BIRTH_POLICY, BUDGET_COST, BUDGET_INFO, BUILDER_SPEED, BUILDINGS, BUILDING_TYPES, CORP_YIELD, DIFFICULTY, EDU_SCI,
  FOOD_PER, GENIUS_FIELDS, GOVS, GREEN_LEVELS, IMF_RATE, INTEL_COST, INVEST_PER, LEVEL_EFFECT, LODGE_DUES, LODGE_OPEN_STAB, LODGE_TITHE, MIGRATION,
  MIL_ARMS, ORDER_SHARE, RELIGIONS, SAFETY_LEVELS, SCI_OUT, SECTOR_KEYS, SG_STAB, TECH_BY_ID, type TechMods,
} from './defs';
import { megaMods } from './megaprojects';
import { autoPenalty, climateFear, climateFoodLoss, elderly, initLate } from './prosperity';
import { REGION_LITH, REGION_OIL, resourceStats } from './resources';
import { allBuildings } from './state';
import type { BuildingType, Country, GameState, Sector } from './types';
import { wonderMods } from './wonders';
import { COUNTRY_DEFS, REGIONS, REGION_OF } from './world';

export interface CountryStats {
  regions: number[];
  civPop: number;
  wSum: number;
  counts: Record<BuildingType, number>;
  coverage: Record<BuildingType, number>;
  constructing: number;
  slots: number;
  buildSpeed: number; // сколько секунд стройки проходит за секунду (строители)
  mods: TechMods;
  prod: number;
  taxIncome: number;
  factoryIncome: number;
  portIncome: number;
  tradeIncome: number;
  budgetCost: number;
  birthCost: number;
  upkeepBuildings: number;
  upkeepArmy: number;
  moneyRate: number;
  brainsBase: number;
  brainsUni: number;
  brainsRate: number;
  growthYear: number;
  popRate: number;
  popCap: number;
  stabTarget: number;
  stabParts: [string, number][];
  weapons: number;
  morale: number;
  quality: number;
  power: number;
  barracksMult: number;
  tradePartners: number;
  tradeMult: number; // множитель торговли (порты, финансовые компании)
  // армия: оснащение оружием
  deployed: number; // солдаты в наступлениях
  equip: number; // комплектов вооружения на солдата
  armsProd: number; // выпуск оружия, компл./день
  // общество
  gdpIndex: number; // размер экономики (доход при 100% налоге)
  sciTarget: number; // к скольким учёным стремится страна
  brainsSci: number;
  billTarget: number;
  investIncome: number;
  corpIncome: number;
  companies: number;
  corpValue: number;
  sectorUnits: Record<Sector, number>; // сила отраслей (1 — типичная компания)
  geniuses: number;
  // продовольствие (т/день)
  foodProd: number;
  foodCons: number;
  foodBuy: number;
  foodSell: number;
  foodMoney: number;
  hunger: number; // доля голодающих 0…1
  // санкции ООН
  sanctions: number; // на сколько упало производство (0…SANCTION_MAX)
  sanctionLoss: number; // 💰/сек, которых казна недосчитывается
  // тайная ложа
  lodgeDues: number; // взносы, 💰/сек
  lodgeTithe: number; // десятина Великому мастеру от взносов братьев
  debtInterest: number; // проценты по госдолгу, 💰/сек
  intelCost: number; // контрразведка, 💰/сек
  // поздняя игра (prosperity.ts, resources.ts)
  pensionCost: number; // пенсии сверх обычного, 💰/сек
  safetyCost: number; // защита от безработицы из-за роботов
  greenCost: number; // зелёный курс
  oilProd: number; // добыча нефти
  oilNeed: number; // нужды в нефти
  lithProd: number;
  lithNeed: number;
  resMoney: number; // продажа излишков сырья (+) или закупка недостающего (−), 💰/сек
  resShort: number; // на сколько упало производство из-за нехватки сырья в мире (0…0.3)
  emis: number; // выбросы: доля от мировых в начале эпохи
}

export let STATS: CountryStats[] = [];
/** Прирост населения региона за день (для симуляции). */
export let REGION_DELTA = new Float64Array(REGIONS.length);
/** Сумма уровней ферм и макс. уровень крепости в каждом регионе. */
export let REGION_FARM = new Float64Array(REGIONS.length);
export let REGION_FORT = new Float64Array(REGIONS.length);
/** Готовые порты каждой страны (клетки). */
export let PORT_TILES: number[][] = [];
/** Нефть и литий ничьих земель — их добыча идёт на мировой рынок. */
export const FREE_RES = { oil: 0, lith: 0 };

export const regionWeight = (pop: number) => 1 + pop / 2e6;
const PAIR_KEYS: (string | undefined)[] = new Array(64 * 64);
/** Ключ пары стран «меньший-больший». Строки запоминаем: ключ нужен тысячи раз за день, а склеивать его каждый раз дорого. */
export const pairKey = (a: number, b: number) => {
  const lo = a < b ? a : b, hi = a < b ? b : a;
  if (lo < 0 || hi >= 64) return `${lo}-${hi}`;
  return (PAIR_KEYS[lo * 64 + hi] ??= `${lo}-${hi}`);
};
/** Капитализация «типичной» мировой компании страны. */
export const companyRef = (c: Country) => Math.max(30, c.moneyScale) * 15;
/** Учёных на человека в начале партии: образованность и богатство страны. */
export const sciShare0 = (c: Country) => 0.0015 * c.eduIndex * c.eduIndex * Math.sqrt(COUNTRY_DEFS[c.idx].gdp / 20);

/** Бонусы отраслей: чем больше и дороже компании, тем сильнее (с потолком). */
export function sectorMods(u: Record<Sector, number>): Partial<TechMods> {
  return {
    brains: 1 + Math.min(0.15, 0.03 * u.tech),
    prod: 1 + Math.min(0.15, 0.03 * u.energy),
    trade: 1 + Math.min(0.4, 0.08 * u.finance),
    factory: 1 + Math.min(0.3, 0.06 * u.industry),
    weapons: 1 + Math.min(0.1, 0.02 * u.defense),
    food: 1 + Math.min(0.3, 0.06 * u.agro),
    growth: Math.min(0.8, 0.15 * u.pharma),
  };
}

export const equipFactor = (e: number) => 0.7 + 0.3 * Math.min(1, e) + 0.2 * Math.max(0, Math.min(1, e - 1));

function applyMods(m: TechMods, mods: Partial<TechMods> | undefined) {
  if (!mods) return;
  for (const key in mods) {
    const k = key as keyof TechMods;
    if (ADDITIVE_MODS.has(k)) m[k] += mods[k]!;
    else m[k] *= mods[k]!;
  }
}

export function techMods(c: Country, extra: Partial<TechMods>[] = []): TechMods {
  const m = { ...BASE_MODS };
  // без промежуточных массивов: считается для каждой страны при каждом пересчёте
  for (const id of c.techs) applyMods(m, TECH_BY_ID[id]?.mods);
  for (const mods of extra) applyMods(m, mods);
  const f = Math.pow(1.03, c.fundamental);
  m.prod *= f;
  m.brains *= f;
  return m;
}

export function modSum(g: GameState, c: Country, kind: string) {
  let sum = 0;
  for (const m of c.mods) if (m.kind === kind && m.until > g.day) sum += m.value;
  return sum;
}

/** Сколько 💰/сек стране i приносит торговый договор с j. */
export const tradeWith = (g: GameState, i: number, j: number, mult = STATS[i].tradeMult) =>
  0.05 * Math.sqrt(Math.max(0, g.countries[i].lastGross) * Math.max(0, g.countries[j].lastGross)) * mult;

export function difficultyMult(g: GameState, ci: number) {
  return ci === g.player ? 1 : DIFFICULTY[g.difficulty].bot;
}

/** Санкции всего мира отнимают у агрессора до четверти производства. */
export const SANCTION_MAX = 0.25;
/** На сколько упадёт производство x, если с ней перестанут торговать страны by: по их доле в мировых налогах. */
export function sanctionLoss(g: GameState, x: number, by: ReadonlySet<number>) {
  let w = 0, world = 0;
  g.countries.forEach((c, k) => {
    if (!c.alive || k === x) return;
    const v = Math.max(0, c.lastGross);
    world += v;
    if (by.has(k)) w += v;
  });
  return SANCTION_MAX * Math.min(1, w / Math.max(1, world));
}

/** Санкции против каждой страны: пока агрессор воюет — в полную силу, за непризнанный захват — вполовину. */
function sanctionPenalty(g: GameState, n: number): number[] {
  const out: number[] = new Array(n).fill(0);
  const by = new Map<number, { set: Set<number>; k: number }>();
  for (const cs of g.un ?? []) {
    if (!cs.resolved) continue;
    const e = by.get(cs.aggressor) ?? { set: new Set<number>(), k: 0.5 };
    for (const s of cs.sanctions) e.set.add(s);
    if (cs.until === undefined) e.k = 1;
    by.set(cs.aggressor, e);
  }
  for (const [x, e] of by) out[x] = sanctionLoss(g, x, e.set) * e.k;
  return out;
}

const ZERO_COUNTS = Object.fromEntries(BUILDING_TYPES.map((t) => [t, 0])) as Record<BuildingType, number>;
const ZERO_SECTORS = Object.fromEntries(SECTOR_KEYS.map((k) => [k, 0])) as Record<Sector, number>;
const TYPE_INDEX = Object.fromEntries(BUILDING_TYPES.map((t, i) => [t, i])) as Record<BuildingType, number>;
const UPKEEP = BUILDING_TYPES.map((t) => BUILDINGS[t].upkeep);
const T_FACTORY = TYPE_INDEX.factory, T_PORT = TYPE_INDEX.port, T_UNIVERSITY = TYPE_INDEX.university;
const T_FARM = TYPE_INDEX.farm, T_FORTRESS = TYPE_INDEX.fortress;
/** Вес региона по населению (regionWeight) — на время пересчёта. */
let REGION_W = new Float64Array(REGIONS.length);

export function computeAll(g: GameState) {
  const n = g.countries.length;
  if (REGION_DELTA.length !== REGIONS.length) {
    REGION_DELTA = new Float64Array(REGIONS.length);
    REGION_FARM = new Float64Array(REGIONS.length);
    REGION_FORT = new Float64Array(REGIONS.length);
    REGION_W = new Float64Array(REGIONS.length);
  }
  const stats: CountryStats[] = [];
  for (let i = 0; i < n; i++) {
    stats.push({
      regions: [], civPop: 0, wSum: 0, counts: { ...ZERO_COUNTS }, coverage: { ...ZERO_COUNTS }, constructing: 0, slots: 2, buildSpeed: 1,
      mods: BASE_MODS, prod: 0, taxIncome: 0, factoryIncome: 0, portIncome: 0, tradeIncome: 0, budgetCost: 0, birthCost: 0,
      upkeepBuildings: 0, upkeepArmy: 0, moneyRate: 0, brainsBase: 0, brainsUni: 0, brainsRate: 0, growthYear: 0, popRate: 0,
      popCap: 0, stabTarget: 50, stabParts: [], weapons: 1, morale: 1, quality: 1, power: 0, barracksMult: 1, tradePartners: 0, tradeMult: 1,
      deployed: 0, equip: 1, armsProd: 0, gdpIndex: 0, sciTarget: 0, brainsSci: 0, billTarget: 0, investIncome: 0, corpIncome: 0,
      companies: 0, corpValue: 0, sectorUnits: { ...ZERO_SECTORS }, geniuses: 0,
      foodProd: 0, foodCons: 0, foodBuy: 0, foodSell: 0, foodMoney: 0, hunger: 0, sanctions: 0, sanctionLoss: 0,
      lodgeDues: 0, lodgeTithe: 0, debtInterest: 0, intelCost: 0,
      pensionCost: 0, safetyCost: 0, greenCost: 0, oilProd: 0, oilNeed: 0, lithProd: 0, lithNeed: 0, resMoney: 0, resShort: 0, emis: 0,
    });
  }
  const sanc = sanctionPenalty(g, n);
  const rebels: number[] = new Array(n).fill(0);
  for (const r of g.rebels ?? []) rebels[r.country]++;
  const brothers = new Set(g.lodge?.members ?? []);
  const order = new Set(g.order?.members ?? []); // братья своей ложи игрока
  REGION_FARM.fill(0);
  REGION_FORT.fill(0);
  PORT_TILES = Array.from({ length: n }, () => []);
  const oilCap: number[] = new Array(n).fill(0);
  const lithCap: number[] = new Array(n).fill(0);
  FREE_RES.oil = FREE_RES.lith = 0;
  g.regions.forEach((r, id) => {
    if (r.owner < 0) {
      FREE_RES.oil += REGION_OIL[id];
      FREE_RES.lith += REGION_LITH[id];
      return;
    }
    oilCap[r.owner] += REGION_OIL[id];
    lithCap[r.owner] += REGION_LITH[id];
    const s = stats[r.owner];
    s.regions.push(id);
    s.civPop += r.pop;
    REGION_W[id] = regionWeight(r.pop);
    s.wSum += REGION_W[id];
  });

  // здания: счётчики по типам копим в плоских массивах — обращение к полю по имени типа на тысячах зданий дорогое
  const factoryW: number[] = new Array(n).fill(0);
  const portW: number[] = new Array(n).fill(0);
  const uniW: number[] = new Array(n).fill(0);
  const portLevels: number[] = new Array(n).fill(0);
  const T = BUILDING_TYPES.length;
  const counts = new Int32Array(n * T);
  const coverage = new Float64Array(n * T);
  const { tiles, list } = allBuildings(g);
  for (let k = 0; k < tiles.length; k++) {
    const tile = tiles[k];
    const b = list[k];
    const rid = REGION_OF[tile];
    const owner = g.regions[rid].owner;
    if (owner < 0) continue;
    const s = stats[owner];
    const ti = TYPE_INDEX[b.type];
    counts[owner * T + ti]++;
    if (b.progress > 0 && b.level === 1) {
      s.constructing++;
      continue;
    }
    if (b.progress > 0) s.constructing++;
    const lvl = b.progress > 0 ? b.level - 1 : b.level;
    const eff = LEVEL_EFFECT[lvl];
    const w = REGION_W[rid];
    coverage[owner * T + ti] += eff * w;
    s.upkeepBuildings += UPKEEP[ti] * lvl * w * g.countries[owner].baseProd;
    if (ti === T_FACTORY) factoryW[owner] += eff * w;
    else if (ti === T_PORT) { portW[owner] += eff * w; portLevels[owner] += eff; PORT_TILES[owner].push(tile); }
    else if (ti === T_UNIVERSITY) uniW[owner] += eff * w;
    else if (ti === T_FARM) REGION_FARM[rid] += eff;
    else if (ti === T_FORTRESS) REGION_FORT[rid] = Math.max(REGION_FORT[rid], eff);
  }
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < T; t++) {
      stats[i].counts[BUILDING_TYPES[t]] = counts[i * T + t];
      stats[i].coverage[BUILDING_TYPES[t]] = coverage[i * T + t];
    }
  }

  // урожай регионов (фермы поднимают его)
  const agri: number[] = new Array(n).fill(0);
  g.regions.forEach((r, id) => {
    if (r.owner >= 0) agri[r.owner] += (r.agri ?? 0) * (1 + (0.3 * REGION_FARM[id]) / (REGION_FARM[id] + 3));
  });
  for (const b of g.battles) {
    if (b.att >= 0 && stats[b.att]) stats[b.att].deployed += b.soldiers;
    if (b.guard && b.def >= 0 && stats[b.def]) stats[b.def].deployed += b.guard;
  }

  // мировые компании и звёзды науки
  const wmods = wonderMods(g);
  const privateCount: number[] = new Array(n).fill(0);
  const corpBase: number[] = new Array(n).fill(0);
  for (const co of g.companies ?? []) {
    const owner = g.regions[co.hq].owner;
    if (owner < 0 || !g.countries[owner].alive) continue;
    const s = stats[owner];
    s.companies++;
    s.corpValue += co.value;
    if (!co.state) privateCount[owner]++;
    corpBase[owner] += co.value * (co.state ? 1.5 : 1); // прибыль госкорпорации целиком идёт в казну
    s.sectorUnits[co.sector] += co.value / companyRef(g.countries[owner]);
  }
  for (const gen of g.geniuses ?? []) {
    if (gen.employer < 0 || !g.countries[gen.employer]?.alive) continue;
    stats[gen.employer].geniuses++;
    wmods[gen.employer].push(GENIUS_FIELDS[gen.field].mods(gen.level));
  }

  for (let i = 0; i < n; i++) {
    const c = g.countries[i];
    const s = stats[i];
    if (!c.alive) continue;
    for (const t of BUILDING_TYPES) s.coverage[t] = s.wSum > 0 ? s.coverage[t] / s.wSum : 0;
    const mods = techMods(c, [...wmods[i], sectorMods(s.sectorUnits), ...megaMods(c)]);
    s.mods = mods;
    const crew = c.builders ?? 1;
    s.slots = 1 + crew + mods.slots;
    s.buildSpeed = 1 + BUILDER_SPEED * (crew - 1);
    const gov = GOVS[c.gov];
    const rel = RELIGIONS[c.religion];
    const diff = difficultyMult(g, i);

    // продовольствие: урожай, потребление и автоторговля с мировым рынком
    s.foodCons = (s.civPop + (c.soldiers + s.deployed) * 1.5) * FOOD_PER;
    s.foodProd = agri[i] * mods.food * (0.85 + (0.25 * c.stability) / 100) * (1 - c.weariness / 300) * Math.max(0.2, 1 + modSum(g, c, 'food'))
      * (1 - climateFoodLoss(g, i, mods.climate));
    planFoodTrade(g, c, s);

    // стабильность (цель)
    const parts: [string, number][] = [['База', 55]];
    parts.push([gov.name, gov.stab]);
    parts.push([rel.name, rel.stab]);
    const taxEff = c.tax > 0.15 ? -(c.tax - 0.15) * 100 * gov.taxSens : (0.15 - c.tax) * 40;
    parts.push(['Налоги', taxEff]);
    const temple = Math.min(30, 14 * Math.min(2.5, s.coverage.temple) * rel.temple);
    if (temple) parts.push(['Храмы', temple]);
    parts.push(['Здравоохранение', BUDGET_INFO.health.stab[c.budget.health]]);
    parts.push(['Инфраструктура', BUDGET_INFO.infra.stab[c.budget.infra]]);
    parts.push(['Миграция', MIGRATION[c.migration].stab]);
    if (c.birthPolicy) parts.push(['Поддержка семей', BIRTH_POLICY[c.birthPolicy].stab]);
    if (c.weariness > 0.5) parts.push(['Усталость от войны', -c.weariness * 0.3]);
    if (c.unrest > 0.5) parts.push(['Недовольство на новых землях', -c.unrest]);
    if (c.money < 0) parts.push(['Долги казны', -15]);
    if (s.hunger > 0) parts.push(['Голод', -Math.max(3, 30 * s.hunger)]);
    if (rebels[i]) parts.push(['Мятежи', -2.5 * rebels[i]]);
    s.sanctions = sanc[i];
    if (s.sanctions > 0) parts.push(['Санкции ООН', -s.sanctions * 25]);
    if (mods.stab) parts.push(['Технологии и чудеса', mods.stab]);
    if (i === g.player && g.lodge?.open && brothers.has(i)) parts.push(['Правитель — масон', LODGE_OPEN_STAB[c.religion]]);
    if (i === g.player && g.order?.official) parts.push(['Официальная ложа', LODGE_OPEN_STAB[c.religion]]);
    if (g.assembly?.sg === i) parts.push(['Генсек ООН — наш', SG_STAB]);
    const civ = Math.max(1, s.civPop);
    if (c.gov === 'dictatorship') parts.push(['Страх перед армией', Math.min(10, (c.soldiers / civ) * 1000)]);
    if (c.armyType === 'conscript' && c.soldiers / civ > 0.01) parts.push(['Призыв', -5]);
    // цена процветания: избалованность, роботы, тревога за климат
    if ((c.expect ?? 0) >= 0.5) parts.push(['Ожидания народа', -c.expect!]);
    const safety = SAFETY_LEVELS[c.safety ?? 0];
    const jobless = autoPenalty(mods.auto, c.budget.edu) * (1 - safety.cover);
    if (jobless >= 0.05) parts.push(['Роботы отнимают работу', -jobless]);
    if (safety.stab) parts.push([safety.name, safety.stab]);
    const fear = climateFear(g, i);
    if (fear >= 0.05) parts.push(['Тревога за климат', -fear]);
    const ev = modSum(g, c, 'stab');
    if (ev) parts.push(['События', ev]);
    s.stabParts = parts.filter((p) => Math.abs(p[1]) >= 0.05);
    s.stabTarget = Math.max(0, Math.min(100, parts.reduce((a, p) => a + p[1], 0)));

    // экономика
    const stabF = 0.6 + (0.4 * c.stability) / 100;
    const prodEvent = (1 + modSum(g, c, 'prod')) * (1 - s.sanctions);
    const old = elderly(c, mods.aging); // пожилых сверх обычного: рабочих рук меньше
    s.prod = c.baseProd * (1 + BUDGET_INFO.infra.prod[c.budget.infra]) * mods.prod * gov.money * stabF * diff * prodEvent * (1 - c.weariness / 250) * (1 - 0.3 * old);
    s.taxIncome = (s.civPop / 1e5) * c.tax * s.prod;
    s.factoryIncome = 4 * factoryW[i] * c.baseProd * mods.factory * stabF * diff * prodEvent;
    // нефть и литий: своя добыча, нужды, закупка; при мировом дефиците производство падает
    if (g.res) {
      resourceStats(g, i, s, (s.civPop / 1e5) * s.prod, oilCap[i], lithCap[i]);
      if (s.resShort > 0) {
        const k = 1 - s.resShort;
        s.prod *= k;
        s.taxIncome *= k;
        s.factoryIncome *= k;
      }
    }
    s.sanctionLoss = ((s.taxIncome + s.factoryIncome) * s.sanctions) / (1 - s.sanctions);
    s.portIncome = 2 * portW[i] * c.baseProd * stabF * diff;
    const budgetShare = BUDGET_COST[c.budget.edu] + BUDGET_COST[c.budget.health] + BUDGET_COST[c.budget.infra] + BUDGET_COST[c.budget.military];
    s.budgetCost = s.taxIncome * budgetShare;
    s.birthCost = s.taxIncome * BIRTH_POLICY[c.birthPolicy].cost;
    s.barracksMult = 1 - Math.min(0.45, 0.15 * s.coverage.barracks);
    const typeMult = c.armyType === 'contract' ? 1.5 : 0.6;
    s.upkeepArmy = c.soldiers * 0.0001 * c.baseProd * typeMult * s.barracksMult * gov.armyUpkeep;
    // компании платят в казну, миллиардеры инвестируют
    s.gdpIndex = (s.civPop / 1e5) * s.prod;
    const taxF = Math.max(0.4, Math.min(2.2, Math.pow(0.2 / Math.max(0.05, c.tax), 0.7)));
    s.billTarget = s.gdpIndex * 0.035 * taxF * gov.rich * (c.religion === 'theocracy' ? 0.85 : 1) * (1 + 0.04 * privateCount[i])
      * Math.max(0.3, 1 + modSum(g, c, 'rich')) * (1 - 0.5 * s.hunger);
    s.investIncome = INVEST_PER * (c.billionaires ?? 0);
    s.corpIncome = corpBase[i] * CORP_YIELD * (0.5 + 2.5 * c.tax);
    s.tradePartners = 0;
    s.tradeIncome = 0;
    s.tradeMult = mods.trade * (1 + 0.1 * Math.min(10, portLevels[i]));
    for (let j = 0; j < n; j++) {
      if (j === i || !g.countries[j].alive) continue;
      const p = g.pairs[pairKey(i, j)];
      if (!p?.trade) continue;
      s.tradePartners++;
      s.tradeIncome += tradeWith(g, i, j, s.tradeMult);
    }
    s.lodgeDues = brothers.has(i) || order.has(i) ? Math.max(0, s.taxIncome) * LODGE_DUES : 0;
    s.debtInterest = ((c.debt ?? 0) * (c.debtRate ?? 0) + (c.imf?.loan ?? 0) * IMF_RATE) / 365;
    s.intelCost = Math.max(0, s.taxIncome) * INTEL_COST[c.counterIntel ?? 1];
    s.pensionCost = Math.max(0, s.taxIncome) * old * 0.7 * (1 - 0.15 * (c.pensionReform ?? 0));
    s.safetyCost = Math.max(0, s.taxIncome) * safety.cost;
    s.greenCost = Math.max(0, s.taxIncome) * GREEN_LEVELS[c.green ?? 0].cost;
    s.moneyRate = s.taxIncome + s.factoryIncome + s.portIncome + s.tradeIncome + s.corpIncome + s.investIncome + s.foodMoney + s.resMoney
      - s.budgetCost - s.birthCost - s.upkeepBuildings - s.upkeepArmy - s.lodgeDues - s.debtInterest - s.intelCost
      - s.pensionCost - s.safetyCost - s.greenCost;

    // наука
    const brainF = rel.brains * gov.brains * mods.brains * (0.8 + (0.2 * c.stability) / 100) * diff * (1 + modSum(g, c, 'brains'));
    s.brainsBase = (s.civPop / 1e5) * c.eduIndex * BUDGET_INFO.edu.mult[c.budget.edu] * 0.8 * brainF;
    s.brainsUni = 3 * uniW[i] * c.eduIndex * brainF;
    s.brainsSci = (c.scientists ?? 0) * SCI_OUT * c.eduIndex * brainF;
    s.brainsRate = s.brainsBase + s.brainsUni + s.brainsSci;
    s.sciTarget = s.civPop * sciShare0(c) * EDU_SCI[c.budget.edu] * (1 + 0.15 * Math.min(3, s.coverage.university)) * rel.sci * gov.sci
      * (0.85 + (0.25 * c.stability) / 100) * Math.max(0.3, 1 + modSum(g, c, 'sci')) * (1 - 0.5 * s.hunger);

    // население
    const attract = Math.max(0, Math.min(1.5, ((c.stability - 40) / 40) * (c.baseProd / 2)));
    const mig = MIGRATION[c.migration].growth * (c.migration === 0 ? 1 : attract);
    s.growthYear = c.growthBase + BUDGET_INFO.health.growth[c.budget.health] + BIRTH_POLICY[c.birthPolicy].growth + mig + rel.growth
      + 0.3 * Math.min(3, s.coverage.hospital) + mods.growth - c.weariness * 0.01 + modSum(g, c, 'growth') - 4 * s.hunger;

    // армия: без оружия на складах солдаты слабее, запас сверх нормы — сильнее
    const troops = c.soldiers + s.deployed;
    s.equip = troops > 0 ? (c.arms ?? troops) / troops : 1;
    s.weapons = c.weaponsBase * mods.weapons * equipFactor(s.equip);
    s.armsProd = troops * 0.001 * MIL_ARMS[c.budget.military] * (1 + 0.1 * Math.min(2.5, s.coverage.barracks)) * (0.85 + (0.25 * c.stability) / 100)
      + s.sectorUnits.defense * 0.0005 * Math.max(troops, s.civPop * 0.004);
    s.quality = c.armyType === 'contract' ? 1.25 : 0.85;
    s.morale = Math.max(0.2, Math.min(1.6, 0.6 + c.stability / 250 + BUDGET_INFO.military.morale[c.budget.military] - c.weariness / 200 + gov.morale));
    s.power = (c.soldiers * s.weapons * s.morale * s.quality * diff) / 1000;
  }

  // Великий мастер ложи получает часть взносов братьев
  const gm = g.lodge?.master ?? -1;
  if (gm >= 0 && brothers.has(gm) && g.countries[gm]?.alive) {
    let dues = 0;
    for (const k of brothers) if (k !== gm && g.countries[k]?.alive) dues += stats[k].lodgeDues;
    stats[gm].lodgeTithe = dues * LODGE_TITHE;
    stats[gm].moneyRate += stats[gm].lodgeTithe;
  }
  // своя ложа игрока: мастеру — доля взносов всех братьев
  if (g.order && g.countries[g.player].alive) {
    let dues = 0;
    for (const k of order) if (g.countries[k]?.alive) dues += stats[k].lodgeDues;
    const share = dues * (g.order.official ? ORDER_SHARE.official : ORDER_SHARE.secret);
    stats[g.player].lodgeTithe += share;
    stats[g.player].moneyRate += share;
  }

  // прирост по регионам; при сильном потеплении море наступает на побережья
  const flood = Math.max(0, (g.climate?.temp ?? 0) - 2) * 0.05;
  g.regions.forEach((r, id) => {
    let gy: number, capMult: number;
    if (r.owner < 0) { gy = 0.8; capMult = 1; }
    else { gy = stats[r.owner].growthYear; capMult = stats[r.owner].mods.cap; }
    if (flood && REGIONS[id].coastal) capMult *= 1 - flood * (r.owner >= 0 ? stats[r.owner].mods.climate : 1);
    const cap = r.cap0 * (1 + 0.15 * REGION_FARM[id]) * capMult;
    const rd = gy / 100 / 365;
    let d = rd > 0 ? r.pop * rd * Math.max(0, 1 - r.pop / cap) : r.pop * rd;
    // радиоактивное заражение: люди болеют и уезжают
    if ((g.fallout?.[id] ?? 0) > g.day) d = -r.pop * 0.25 / 365;
    REGION_DELTA[id] = d;
    if (r.owner >= 0) {
      stats[r.owner].popRate += d;
      stats[r.owner].popCap += cap;
    }
  });
  STATS = stats;
  // эпоха ресурсов и климата начинается с первого пересчёта (в старых сохранениях — с загрузки)
  if (!g.res || !g.climate) {
    initLate(g, stats);
    return computeAll(g);
  }
  return stats;
}

/** План торговли продовольствием на день: покрыть дефицит, продать излишки, держать запас. */
function planFoodTrade(g: GameState, c: Country, s: CountryStats) {
  const price = g.market?.food.price ?? 0;
  const bal = s.foodProd - s.foodCons;
  let net = 0;
  if (c.foodAuto) {
    net = -bal;
    const target = c.foodReserve * s.foodCons;
    if (c.food < target * 0.85) net += (target - c.food) * 0.03;
    else if (c.food > target * 1.15) net -= (c.food - target) * 0.03;
  }
  let buy = Math.max(0, net);
  let sell = Math.max(0, -net);
  // в долгах закупаем только чтобы не было голода, а в глубоких долгах не закупаем вовсе
  if (c.money < 0) buy = Math.min(buy, Math.max(0, -bal - c.food));
  if (c.money < -Math.max(1000, c.lastGross * 60)) buy = 0;
  sell = Math.min(sell, Math.max(0, c.food + bal));
  s.foodBuy = buy;
  s.foodSell = sell;
  s.foodMoney = sell * price * 0.97 - buy * price;
  const avail = c.food + s.foodProd + buy - sell;
  s.hunger = avail >= s.foodCons ? 0 : Math.min(1, 1 - avail / Math.max(1, s.foodCons));
}

/** Сила обороны региона (для боя и подсказок). guard — резервы, переброшенные сюда защитником. */
export function regionDefense(g: GameState, rid: number, guard = 0): { garrison: number; strength: number } {
  const r = g.regions[rid];
  const info = REGIONS[rid];
  const terrain = 1 + info.mountainShare * 0.6 + info.forestShare * 0.25;
  if (r.owner < 0) {
    const garrison = r.pop * 0.003;
    return { garrison, strength: garrison * 0.7 * terrain };
  }
  const d = g.countries[r.owner];
  const s = STATS[r.owner];
  const garrison = d.soldiers / Math.max(1, s.regions.length) + guard;
  const fort = 1 + 0.4 * REGION_FORT[rid];
  const cap = d.capital === rid ? 1.5 : 1;
  return { garrison, strength: garrison * s.weapons * s.morale * s.quality * terrain * fort * cap * s.mods.defense * difficultyMult(g, r.owner) };
}

export function attackPerSoldier(g: GameState, ci: number, naval: boolean) {
  const s = STATS[ci];
  return s.weapons * s.morale * s.quality * difficultyMult(g, ci) * (naval ? 0.75 : 1);
}
