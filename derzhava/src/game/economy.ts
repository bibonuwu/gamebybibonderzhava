// Производные показатели стран: доходы, наука, рост населения, стабильность, армия, продовольствие, общество.
import {
  BASE_MODS, BIRTH_POLICY, BUDGET_COST, BUDGET_INFO, BUILDINGS, BUILDING_TYPES, CORP_YIELD, DIFFICULTY, EDU_SCI, FOOD_PER,
  GENIUS_FIELDS, GOVS, IMF_RATE, INTEL_COST, INVEST_PER, LEVEL_EFFECT, LODGE_DUES, LODGE_OPEN_STAB, LODGE_TITHE, MIGRATION, MIL_ARMS, RELIGIONS, SCI_OUT,
  SECTOR_KEYS, TECH_BY_ID, type TechMods,
} from './defs';
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
}

export let STATS: CountryStats[] = [];
/** Прирост населения региона за день (для симуляции). */
export let REGION_DELTA = new Float64Array(REGIONS.length);
/** Сумма уровней ферм и макс. уровень крепости в каждом регионе. */
export let REGION_FARM = new Float64Array(REGIONS.length);
export let REGION_FORT = new Float64Array(REGIONS.length);
/** Готовые порты каждой страны (клетки). */
export let PORT_TILES: number[][] = [];

export const regionWeight = (pop: number) => 1 + pop / 2e6;
export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
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

export function techMods(c: Country, extra: Partial<TechMods>[] = []): TechMods {
  const m = { ...BASE_MODS };
  const all = [...c.techs.map((id) => TECH_BY_ID[id]?.mods), ...extra];
  for (const mods of all) {
    if (!mods) continue;
    for (const [k, v] of Object.entries(mods) as [keyof TechMods, number][]) {
      if (k === 'growth' || k === 'stab' || k === 'slots') m[k] += v;
      else m[k] *= v;
    }
  }
  const f = Math.pow(1.03, c.fundamental);
  m.prod *= f;
  m.brains *= f;
  return m;
}

export const modSum = (g: GameState, c: Country, kind: string) =>
  c.mods.filter((m) => m.kind === kind && m.until > g.day).reduce((s, m) => s + m.value, 0);

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

export function computeAll(g: GameState) {
  const n = g.countries.length;
  if (REGION_DELTA.length !== REGIONS.length) {
    REGION_DELTA = new Float64Array(REGIONS.length);
    REGION_FARM = new Float64Array(REGIONS.length);
    REGION_FORT = new Float64Array(REGIONS.length);
  }
  const emptyCounts = () => Object.fromEntries(BUILDING_TYPES.map((t) => [t, 0])) as Record<BuildingType, number>;
  const stats: CountryStats[] = [];
  for (let i = 0; i < n; i++) {
    stats.push({
      regions: [], civPop: 0, wSum: 0, counts: emptyCounts(), coverage: emptyCounts(), constructing: 0, slots: 2,
      mods: BASE_MODS, prod: 0, taxIncome: 0, factoryIncome: 0, portIncome: 0, tradeIncome: 0, budgetCost: 0, birthCost: 0,
      upkeepBuildings: 0, upkeepArmy: 0, moneyRate: 0, brainsBase: 0, brainsUni: 0, brainsRate: 0, growthYear: 0, popRate: 0,
      popCap: 0, stabTarget: 50, stabParts: [], weapons: 1, morale: 1, quality: 1, power: 0, barracksMult: 1, tradePartners: 0, tradeMult: 1,
      deployed: 0, equip: 1, armsProd: 0, gdpIndex: 0, sciTarget: 0, brainsSci: 0, billTarget: 0, investIncome: 0, corpIncome: 0,
      companies: 0, corpValue: 0, sectorUnits: Object.fromEntries(SECTOR_KEYS.map((k) => [k, 0])) as Record<Sector, number>, geniuses: 0,
      foodProd: 0, foodCons: 0, foodBuy: 0, foodSell: 0, foodMoney: 0, hunger: 0, sanctions: 0, sanctionLoss: 0,
      lodgeDues: 0, lodgeTithe: 0, debtInterest: 0, intelCost: 0,
    });
  }
  const sanc = sanctionPenalty(g, n);
  const brothers = new Set(g.lodge?.members ?? []);
  REGION_FARM.fill(0);
  REGION_FORT.fill(0);
  PORT_TILES = Array.from({ length: n }, () => []);
  g.regions.forEach((r, id) => {
    if (r.owner < 0) return;
    const s = stats[r.owner];
    s.regions.push(id);
    s.civPop += r.pop;
    s.wSum += regionWeight(r.pop);
  });

  // здания
  const factoryW: number[] = new Array(n).fill(0);
  const portW: number[] = new Array(n).fill(0);
  const uniW: number[] = new Array(n).fill(0);
  const portLevels: number[] = new Array(n).fill(0);
  for (const key in g.buildings) {
    const tile = +key;
    const b = g.buildings[tile];
    const rid = REGION_OF[tile];
    const owner = g.regions[rid].owner;
    if (owner < 0) continue;
    const s = stats[owner];
    s.counts[b.type]++;
    if (b.progress > 0 && b.level === 1) {
      s.constructing++;
      continue;
    }
    if (b.progress > 0) s.constructing++;
    const lvl = b.progress > 0 ? b.level - 1 : b.level;
    const eff = LEVEL_EFFECT[lvl];
    const w = regionWeight(g.regions[rid].pop);
    s.coverage[b.type] += eff * w;
    s.upkeepBuildings += BUILDINGS[b.type].upkeep * lvl * w * g.countries[owner].baseProd;
    if (b.type === 'factory') factoryW[owner] += eff * w;
    if (b.type === 'port') { portW[owner] += eff * w; portLevels[owner] += eff; PORT_TILES[owner].push(tile); }
    if (b.type === 'university') uniW[owner] += eff * w;
    if (b.type === 'farm') REGION_FARM[rid] += eff;
    if (b.type === 'fortress') REGION_FORT[rid] = Math.max(REGION_FORT[rid], eff);
  }

  // урожай регионов (фермы поднимают его)
  const agri: number[] = new Array(n).fill(0);
  g.regions.forEach((r, id) => {
    if (r.owner >= 0) agri[r.owner] += (r.agri ?? 0) * (1 + (0.3 * REGION_FARM[id]) / (REGION_FARM[id] + 3));
  });
  for (const b of g.battles) if (b.att >= 0 && stats[b.att]) stats[b.att].deployed += b.soldiers;

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
    const mods = techMods(c, [...wmods[i], sectorMods(s.sectorUnits)]);
    s.mods = mods;
    s.slots = 2 + mods.slots;
    const gov = GOVS[c.gov];
    const rel = RELIGIONS[c.religion];
    const diff = difficultyMult(g, i);

    // продовольствие: урожай, потребление и автоторговля с мировым рынком
    s.foodCons = (s.civPop + (c.soldiers + s.deployed) * 1.5) * FOOD_PER;
    s.foodProd = agri[i] * mods.food * (0.85 + (0.25 * c.stability) / 100) * (1 - c.weariness / 300) * Math.max(0.2, 1 + modSum(g, c, 'food'));
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
    s.sanctions = sanc[i];
    if (s.sanctions > 0) parts.push(['Санкции ООН', -s.sanctions * 25]);
    if (mods.stab) parts.push(['Технологии и чудеса', mods.stab]);
    if (i === g.player && g.lodge?.open && brothers.has(i)) parts.push(['Правитель — масон', LODGE_OPEN_STAB[c.religion]]);
    const civ = Math.max(1, s.civPop);
    if (c.gov === 'dictatorship') parts.push(['Страх перед армией', Math.min(10, (c.soldiers / civ) * 1000)]);
    if (c.armyType === 'conscript' && c.soldiers / civ > 0.01) parts.push(['Призыв', -5]);
    const ev = modSum(g, c, 'stab');
    if (ev) parts.push(['События', ev]);
    s.stabParts = parts.filter((p) => Math.abs(p[1]) >= 0.05);
    s.stabTarget = Math.max(0, Math.min(100, parts.reduce((a, p) => a + p[1], 0)));

    // экономика
    const stabF = 0.6 + (0.4 * c.stability) / 100;
    const prodEvent = (1 + modSum(g, c, 'prod')) * (1 - s.sanctions);
    s.prod = c.baseProd * (1 + BUDGET_INFO.infra.prod[c.budget.infra]) * mods.prod * gov.money * stabF * diff * prodEvent * (1 - c.weariness / 250);
    s.taxIncome = (s.civPop / 1e5) * c.tax * s.prod;
    s.factoryIncome = 4 * factoryW[i] * c.baseProd * mods.factory * stabF * diff * prodEvent;
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
    s.lodgeDues = brothers.has(i) ? Math.max(0, s.taxIncome) * LODGE_DUES : 0;
    s.debtInterest = ((c.debt ?? 0) * (c.debtRate ?? 0) + (c.imf?.loan ?? 0) * IMF_RATE) / 365;
    s.intelCost = Math.max(0, s.taxIncome) * INTEL_COST[c.counterIntel ?? 1];
    s.moneyRate = s.taxIncome + s.factoryIncome + s.portIncome + s.tradeIncome + s.corpIncome + s.investIncome + s.foodMoney
      - s.budgetCost - s.birthCost - s.upkeepBuildings - s.upkeepArmy - s.lodgeDues - s.debtInterest - s.intelCost;

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

  // прирост по регионам
  g.regions.forEach((r, id) => {
    let gy: number, capMult: number;
    if (r.owner < 0) { gy = 0.8; capMult = 1; }
    else { gy = stats[r.owner].growthYear; capMult = stats[r.owner].mods.cap; }
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

/** Сила обороны региона (для боя и подсказок). */
export function regionDefense(g: GameState, rid: number): { garrison: number; strength: number } {
  const r = g.regions[rid];
  const info = REGIONS[rid];
  const terrain = 1 + info.mountainShare * 0.6 + info.forestShare * 0.25;
  if (r.owner < 0) {
    const garrison = r.pop * 0.003;
    return { garrison, strength: garrison * 0.7 * terrain };
  }
  const d = g.countries[r.owner];
  const s = STATS[r.owner];
  const garrison = d.soldiers / Math.max(1, s.regions.length);
  const fort = 1 + 0.4 * REGION_FORT[rid];
  const cap = d.capital === rid ? 1.5 : 1;
  return { garrison, strength: garrison * s.weapons * s.morale * s.quality * terrain * fort * cap * s.mods.defense * difficultyMult(g, r.owner) };
}

export function attackPerSoldier(g: GameState, ci: number, naval: boolean) {
  const s = STATS[ci];
  return s.weapons * s.morale * s.quality * difficultyMult(g, ci) * (naval ? 0.75 : 1);
}
