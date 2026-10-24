// Общество: учёные, миллиардеры, мировые компании и звёзды науки.
// Учёные дают 🧠, миллиардеры инвестируют и открывают компании, компании платят в казну и усиливают свою отрасль.
import { addRel, atWar, cname, enemiesOf } from './actions';
import {
  ARMS_BASE, BUILDINGS, CORP_YIELD, FOOD_BASE, FOOD_PER, FOOD_SELF, GENIUS_COST, GENIUS_FIELDS, GENIUS_KEYS, GENIUS_LEVEL,
  GENIUS_NAMES, INVEST_PER, NAME_ROOT, SCI_OUT, SECTORS, SECTOR_KEYS,
} from './defs';
import { companyRef, computeAll, STATS } from './economy';
import { fmt } from './format';
import { initMarket, newGood } from './market';
import { allBuildings, log, news, pick, rand, sfx } from './state';
import type { Company, GameState, Genius, Sector } from './types';
import { COUNTRY_DEFS, REGIONS, REGION_OF, TERRAIN } from './world';

const OIL = new Set(['sa', 'ru', 'ir', 'dz', 'ng', 'kz', 'ca', 'us', 'mx', 'br', 'id', 'au']);
const AGRI_W: Record<string, number> = { p: 1, g: 1.2, f: 0.3, d: 0.05, t: 0.1, s: 0, m: 0.15 };

// ---------- начало партии и старые сохранения ----------
/** Урожай регионов: страна в целом обеспечена едой как в жизни, внутри — по пахотной земле. */
function initAgri(g: GameState) {
  const w = REGIONS.map((r) => 0.3 + r.tiles.reduce((a, t) => a + (AGRI_W[TERRAIN[t]] ?? 0), 0));
  COUNTRY_DEFS.forEach((d, i) => {
    const regs = REGIONS.filter((r) => r.origOwner === i);
    const pop = regs.reduce((a, r) => a + g.regions[r.id].pop, 0);
    const prod = (pop + g.countries[i].soldiers * 1.5) * FOOD_PER * (FOOD_SELF[d.id] ?? 1);
    const sum = regs.reduce((a, r) => a + w[r.id], 0);
    for (const r of regs) g.regions[r.id].agri = (prod * w[r.id]) / Math.max(1e-9, sum);
  });
  REGIONS.forEach((r) => {
    if (r.origOwner < 0) g.regions[r.id].agri = g.regions[r.id].pop * FOOD_PER;
  });
}

/** Новые системы: в новой партии (и в сохранении, где их ещё не было) — с нуля, иначе только недостающие поля. */
export function initSociety(g: GameState, fresh: boolean) {
  g.companies ??= [];
  g.geniuses ??= [];
  g.nextDemandDay ??= g.day + 60;
  for (const c of g.countries) {
    c.scientists ??= 0;
    c.billionaires ??= 0;
    c.food ??= 0;
    c.foodReserve ??= 90;
    c.foodAuto ??= true;
    c.arms ??= c.soldiers;
  }
  if (fresh || g.regions.some((r) => r.agri === undefined)) initAgri(g);
  g.market ??= { food: newGood(FOOD_BASE), arms: newGood(ARMS_BASE), sciPool: 0, sciNorm: 1, nextGenius: g.day + 20, nextShock: g.day + 400 };
  computeAll(g);
  if (!fresh) return;
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    c.scientists = STATS[i].sciTarget;
    c.food = STATS[i].foodCons * c.foodReserve;
  });
  if (!g.companies.length) seedCompanies(g);
  computeAll(g);
  g.countries.forEach((c, i) => {
    if (c.alive) c.billionaires = STATS[i].billTarget;
  });
  initMarket(g);
  for (let k = 0; k < 3; k++) listGenius(g, true);
  computeAll(g);
}

function seedCompanies(g: GameState) {
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    const n = Math.max(1, Math.floor(companyTarget(g, i, STATS[i].billTarget)));
    const sw = sectorWeights(g, i);
    for (let k = 0; k < n; k++) {
      const sector = weightedSector(g, sw);
      sw[sector] *= 0.4;
      makeCompany(g, i, sector, companyRef(c) * (0.6 + 0.8 * rand(g)), false, k === 0 ? c.capital : undefined, 0);
    }
  });
}

// ---------- компании ----------
export const companyOwner = (g: GameState, co: Company) => g.regions[co.hq].owner;
export const companiesOf = (g: GameState, ci: number) =>
  g.companies.filter((co) => companyOwner(g, co) === ci).sort((a, b) => b.value - a.value);
/** Сколько 💰 в день компания приносит казне. */
export function companyIncome(g: GameState, co: Company) {
  const owner = companyOwner(g, co);
  if (owner < 0) return 0;
  return co.value * CORP_YIELD * (0.5 + 2.5 * g.countries[owner].tax) * (co.state ? 1.5 : 1);
}

/** Сколько частных компаний «тянет» страна: миллиардеры, учёные, технологии. */
export function companyTarget(g: GameState, ci: number, billionaires = g.countries[ci].billionaires) {
  const c = g.countries[ci];
  return 0.38 * Math.sqrt(Math.max(0, billionaires)) + Math.sqrt(Math.max(0, c.scientists)) / 1000 + c.techs.length / 8 + c.fundamental / 10;
}

/** В какой отрасли стране выгоднее всего открыть компанию. */
export function sectorWeights(g: GameState, ci: number): Record<Sector, number> {
  const c = g.countries[ci];
  const s = STATS[ci];
  const d = COUNTRY_DEFS[ci];
  const w: Record<Sector, number> = {
    tech: 0.6 + Math.max(0, c.eduIndex - 0.8) * 3 + Math.min(1.5, s.coverage.university),
    energy: 0.8 + (OIL.has(d.id) ? 1.5 : 0),
    finance: 0.5 + (d.gdp > 30 ? 1 : 0) + s.tradePartners * 0.2,
    industry: 0.7 + Math.min(1.5, s.coverage.factory),
    defense: 0.4 + (c.weaponsBase > 1.3 ? 0.8 : 0) + (c.budget.military >= 2 ? 0.6 : 0),
    agro: 0.4 + Math.max(0, s.foodProd / Math.max(1, s.foodCons) - 1) * 1.5 + Math.min(1, s.coverage.farm),
    pharma: 0.4 + (d.gdp > 30 ? 0.6 : 0) + Math.min(1, s.coverage.hospital),
  };
  // где компаний уже много, новая принесёт меньше
  for (const k of SECTOR_KEYS) w[k] /= 1 + s.sectorUnits[k] * 0.5;
  return w;
}

function weightedSector(g: GameState, w: Record<Sector, number>): Sector {
  const total = SECTOR_KEYS.reduce((a, k) => a + w[k], 0);
  let r = rand(g) * total;
  for (const k of SECTOR_KEYS) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return 'industry';
}

/** Штаб-квартира: регион с нужным зданием, иначе один из крупных городов. */
function pickHQ(g: GameState, ci: number, sector: Sector): number {
  const regs = STATS[ci].regions.slice().sort((a, b) => g.regions[b].pop - g.regions[a].pop);
  if (!regs.length) return g.countries[ci].capital;
  const need = SECTORS[sector].need;
  const withNeed: number[] = [];
  const { tiles, list } = allBuildings(g);
  for (let k = 0; k < tiles.length; k++) {
    const b = list[k];
    const rid = REGION_OF[tiles[k]];
    if (b.type === need && b.progress === 0 && g.regions[rid].owner === ci && !withNeed.includes(rid)) withNeed.push(rid);
  }
  if (withNeed.length && rand(g) < 0.7) return pick(g, withNeed);
  return regs[Math.floor(rand(g) * Math.min(3, regs.length))];
}

function companyName(g: GameState, ci: number, sector: Sector, hq: number): string {
  const root = NAME_ROOT[COUNTRY_DEFS[ci].id] ?? COUNTRY_DEFS[ci].name.slice(0, 4);
  const city = REGIONS[hq].name;
  const used = new Set(g.companies.map((co) => co.name));
  for (let k = 0; k < 10; k++) {
    const name = pick(g, SECTORS[sector].names).replace('{R}', root).replace('{C}', city);
    if (!used.has(name)) return name;
  }
  return `${root}${SECTORS[sector].name} ${g.companies.length + 1}`;
}

function makeCompany(g: GameState, ci: number, sector: Sector, value: number, state: boolean, hq?: number, founded = g.day): Company {
  const where = hq ?? pickHQ(g, ci, sector);
  const co: Company = { id: g.nextId++, name: companyName(g, ci, sector, where), sector, hq: where, value, founded };
  if (state) co.state = true;
  g.companies.push(co);
  return co;
}

/** Раз в 10 дней: слабые компании разоряются, миллиардеры открывают новые. */
function corporateLife(g: GameState, i: number) {
  const c = g.countries[i];
  const mine = companiesOf(g, i);
  const ref = companyRef(c);
  const target = companyTarget(g, i);
  const priv = mine.filter((co) => !co.state);
  if (mine.length) {
    const weakest = mine[mine.length - 1];
    if (weakest.value < ref * 0.25 || (priv.length > target + 1.5 && !weakest.state && rand(g) < 0.03)) {
      g.companies = g.companies.filter((x) => x !== weakest);
      if (i === g.player) log(g, `📉 Банкротство: компания «${weakest.name}» закрылась`, 'bad');
      return;
    }
  }
  const gap = target - priv.length;
  if (gap > 0 && rand(g) < 0.04 * gap) {
    const sector = weightedSector(g, sectorWeights(g, i));
    const co = makeCompany(g, i, sector, ref * (0.6 + 0.6 * rand(g)), false);
    if (i === g.player) {
      sfx('achievement');
      log(g, `🏢 Новая мировая компания: «${co.name}» (${SECTORS[sector].icon} ${SECTORS[sector].name})`, 'good');
    }
  }
}

export function foundCost(g: GameState, ci: number) {
  const states = companiesOf(g, ci).filter((co) => co.state).length;
  return companyRef(g.countries[ci]) * 1.6 * Math.pow(1.3, states);
}
export function foundError(g: GameState, ci: number, sector: Sector): string | null {
  const c = g.countries[ci];
  const wait = (c.aiFlags.lastCompany ?? -9999) + 90 - g.day;
  if (wait > 0) return `Следующую госкорпорацию можно основать через ${Math.ceil(wait)} дн.`;
  const need = SECTORS[sector].need;
  if (STATS[ci].coverage[need] <= 0) return `Нужно готовое здание: ${BUILDINGS[need].icon} ${BUILDINGS[need].name}`;
  if (c.money < foundCost(g, ci)) return 'Не хватает денег';
  return null;
}
/** Госкорпорация: дорого, но вся прибыль — в казну, и отрасль сразу сильнее. */
export function foundCompany(g: GameState, ci: number, sector: Sector): string | null {
  const err = foundError(g, ci, sector);
  if (err) return err;
  const c = g.countries[ci];
  c.money -= foundCost(g, ci);
  c.aiFlags.lastCompany = g.day;
  const co = makeCompany(g, ci, sector, companyRef(c) * 0.9, true);
  if (ci === g.player) {
    sfx('build');
    log(g, `🏢 Основана госкорпорация «${co.name}» (${SECTORS[sector].icon} ${SECTORS[sector].name})`, 'good');
  }
  computeAll(g);
  return null;
}

export const companyPrice = (co: Company) => co.value * 1.5;
export function buyCompanyError(g: GameState, ci: number, co: Company): string | null {
  const owner = companyOwner(g, co);
  if (owner === ci) return 'Это наша компания';
  if (owner < 0 || owner === g.player) return 'Не продаётся';
  if (co.state) return 'Госкорпорации не продаются';
  if (atWar(g, ci, owner)) return 'Мы воюем с этой страной';
  if (g.rel[ci][owner] < -20) return 'Слишком плохие отношения';
  if (g.countries[ci].money < companyPrice(co)) return 'Не хватает денег';
  return null;
}
/** Покупка иностранной компании: штаб-квартира переезжает в нашу столицу. */
export function buyCompany(g: GameState, ci: number, id: number): string | null {
  const co = g.companies.find((x) => x.id === id);
  if (!co) return 'Компании больше нет';
  const err = buyCompanyError(g, ci, co);
  if (err) return err;
  const owner = companyOwner(g, co);
  const price = companyPrice(co);
  g.countries[ci].money -= price;
  g.countries[owner].money += price;
  co.hq = g.countries[ci].capital;
  co.value *= 0.9;
  addRel(g, ci, owner, g.countries[owner].personality === 'trader' ? -3 : -8);
  if (ci === g.player) {
    sfx('coins');
    log(g, `💼 Куплена компания «${co.name}» — штаб-квартира переехала к нам`, 'good');
  } else news(g, `💼 ${cname(g, ci)} купила компанию «${co.name}» у страны ${cname(g, owner)}`, 'info');
  computeAll(g);
  return null;
}

// ---------- миллиардеры ----------
export const richTaxGain = (g: GameState, ci: number) => g.countries[ci].billionaires * INVEST_PER * 250;
export function richTaxError(g: GameState, ci: number): string | null {
  const c = g.countries[ci];
  if (c.billionaires < 1) return 'В стране нет миллиардеров';
  const wait = (c.aiFlags.lastRichTax ?? -9999) + 365 - g.day;
  if (wait > 0) return `Повторить можно через ${Math.ceil(wait)} дн.`;
  return null;
}
/** Разовый налог на сверхбогатых: деньги сейчас, но часть миллиардеров уедет. */
export function richTax(g: GameState, ci: number): string | null {
  const err = richTaxError(g, ci);
  if (err) return err;
  const c = g.countries[ci];
  const gain = richTaxGain(g, ci);
  const fled = c.billionaires * 0.2;
  c.money += gain;
  c.billionaires -= fled;
  c.aiFlags.lastRichTax = g.day;
  c.mods.push({ kind: 'rich', value: -0.15, until: g.day + 365, label: 'Налог на сверхбогатых' });
  const free = c.gov === 'democracy' || c.gov === 'republic';
  c.mods.push({ kind: 'stab', value: free ? 5 : 3, until: g.day + 150, label: 'Справедливые налоги' });
  if (ci === g.player) {
    sfx('coins');
    log(g, `💎 Налог на сверхбогатых: +${fmt(gain)} 💰, уехали ${fmt(fled)} миллиардеров`, 'good');
  } else news(g, `💎 ${cname(g, ci)} ввела налог на сверхбогатых`, 'info');
  computeAll(g);
  return null;
}

export const investorsCost = (g: GameState, ci: number) => Math.max(30, g.countries[ci].moneyScale) * 30;
export function investorsError(g: GameState, ci: number): string | null {
  const c = g.countries[ci];
  if (c.mods.some((m) => m.kind === 'rich' && m.value > 0 && m.until > g.day)) return 'Программа уже действует';
  if (c.money < investorsCost(g, ci)) return 'Не хватает денег';
  return null;
}
/** Льготы инвесторам: на год страна привлекательнее для миллиардеров. */
export function inviteInvestors(g: GameState, ci: number): string | null {
  const err = investorsError(g, ci);
  if (err) return err;
  const c = g.countries[ci];
  c.money -= investorsCost(g, ci);
  c.mods.push({ kind: 'rich', value: 0.3, until: g.day + 365, label: 'Льготы инвесторам' });
  if (ci === g.player) {
    sfx('treaty');
    log(g, '🤝 Льготы инвесторам: миллиардеры охотнее едут к нам', 'good');
  }
  computeAll(g);
  return null;
}

// ---------- учёные ----------
/** Цена переезда одного учёного: сколько он принесёт стране, и сколько свободных учёных в мире. */
export function sciPrice(g: GameState, ci: number) {
  const c = g.countries[ci];
  const scarce = Math.max(0.7, Math.min(3, Math.sqrt(g.market.sciNorm / Math.max(1, g.market.sciPool))));
  return SCI_OUT * c.eduIndex * (Math.max(30, c.moneyScale) / Math.max(1, c.techScale)) * 1000 * scarce;
}
export function hireScientists(g: GameState, ci: number, n: number): string | null {
  const c = g.countries[ci];
  n = Math.floor(Math.min(n, g.market.sciPool));
  if (n < 1) return 'Свободных учёных в мире нет';
  if (c.stability < 25) return 'Учёные не едут в нестабильную страну';
  const cost = n * sciPrice(g, ci);
  if (c.money < cost) return 'Не хватает денег';
  c.money -= cost;
  c.scientists += n;
  g.market.sciPool -= n;
  if (ci === g.player) {
    sfx('research');
    log(g, `🧑‍🔬 К нам переехали ${fmt(n)} учёных`, 'good');
  }
  computeAll(g);
  return null;
}

export const grantCost = (g: GameState, ci: number) => Math.max(30, g.countries[ci].moneyScale) * 25;
export function grantError(g: GameState, ci: number): string | null {
  const c = g.countries[ci];
  if (c.mods.some((m) => m.kind === 'sci' && m.value > 0 && m.until > g.day)) return 'Гранты уже выдаются';
  if (c.money < grantCost(g, ci)) return 'Не хватает денег';
  return null;
}
/** Научные гранты: на 300 дней страна растит больше учёных. */
export function sciGrant(g: GameState, ci: number): string | null {
  const err = grantError(g, ci);
  if (err) return err;
  const c = g.countries[ci];
  c.money -= grantCost(g, ci);
  c.mods.push({ kind: 'sci', value: 0.15, until: g.day + 300, label: 'Научные гранты' });
  if (ci === g.player) {
    sfx('research');
    log(g, '🎓 Научные гранты: учёных станет больше', 'good');
  }
  computeAll(g);
  return null;
}

// ---------- звёзды науки ----------
export function geniusPrice(g: GameState, ci: number, gen: Genius) {
  const c = g.countries[ci];
  let k = GENIUS_COST[gen.level] * Math.max(30, c.moneyScale);
  if (c.gov === 'dictatorship') k *= 1.4;
  else if (c.gov === 'monarchy') k *= 1.1;
  if (c.religion === 'theocracy') k *= 1.2;
  if (enemiesOf(g, ci).length) k *= 1.3;
  if (gen.employer >= 0 && gen.employer !== ci) k *= 1.8; // переманить дороже
  return k;
}
export function geniusError(g: GameState, ci: number, gen: Genius): string | null {
  if (gen.employer === ci) return 'Уже работает у нас';
  const c = g.countries[ci];
  if (c.stability < 30) return 'Учёные не едут в нестабильную страну (нужна ⚖️ 30%+)';
  if (gen.employer >= 0 && atWar(g, ci, gen.employer)) return 'Мы воюем с этой страной';
  if (c.money < geniusPrice(g, ci, gen)) return 'Не хватает денег';
  return null;
}
export const geniusText = (gen: Genius) => GENIUS_FIELDS[gen.field].desc(gen.level);

export function hireGenius(g: GameState, ci: number, id: number): string | null {
  const gen = g.geniuses.find((x) => x.id === id);
  if (!gen) return 'Учёный уже уехал';
  const err = geniusError(g, ci, gen);
  if (err) return err;
  const from = gen.employer;
  g.countries[ci].money -= geniusPrice(g, ci, gen);
  if (from >= 0) {
    addRel(g, ci, from, -12);
    if (from === g.player) log(g, `🧑‍🔬 ${gen.name} уезжает в страну ${cname(g, ci)}: её переманили`, 'bad');
  } else gen.until = g.day + 1200 + Math.floor(rand(g) * 1200);
  gen.employer = ci;
  if (ci === g.player) {
    sfx('research');
    g.counters.geniuses = (g.counters.geniuses ?? 0) + 1;
    log(g, `🌟 ${gen.name} теперь работает у нас: ${geniusText(gen)}`, 'good');
  } else if (gen.level === 3) news(g, `🌟 ${cname(g, ci)} пригласила нобелевского лауреата: ${gen.name}`, 'info');
  computeAll(g);
  return null;
}

function newGenius(g: GameState, level: number, origin: number, employer: number, until: number): Genius | null {
  const used = new Set(g.geniuses.map((x) => x.name));
  const names = GENIUS_NAMES.filter((n) => !used.has(n));
  if (!names.length) return null;
  const gen: Genius = { id: g.nextId++, name: pick(g, names), field: pick(g, GENIUS_KEYS), level, origin, employer, until };
  g.geniuses.push(gen);
  return gen;
}

/** Учёный-перебежчик: сразу работает у нас. */
export function adoptGenius(g: GameState, ci: number, origin: number): Genius | null {
  const gen = newGenius(g, 2, origin, ci, g.day + 1200 + Math.floor(rand(g) * 1200));
  if (gen && ci === g.player) g.counters.geniuses = (g.counters.geniuses ?? 0) + 1;
  computeAll(g);
  return gen;
}

export function listGenius(g: GameState, quiet = false) {
  const alive = g.countries.filter((c) => c.alive);
  if (!alive.length) return;
  const r = rand(g);
  const gen = newGenius(g, r < 0.55 ? 1 : r < 0.88 ? 2 : 3, pick(g, alive).idx, -1, g.day + 120);
  if (!gen) return;
  if (!quiet && gen.level >= 2) {
    const f = GENIUS_FIELDS[gen.field];
    log(g, `🌟 На рынке учёных: ${gen.name} — ${GENIUS_LEVEL[gen.level].toLowerCase()}, ${f.name.toLowerCase()} (${geniusText(gen)})`, 'info', gen.level === 3);
  }
}

/** Куда едет учёный, которого никто не нанял: в самую спокойную страну, учёные-боты ценятся выше. */
function bestHome(g: GameState): number {
  let best = -1, bs = -Infinity;
  g.countries.forEach((c, j) => {
    if (!c.alive || j === g.player) return;
    const sc = c.stability + (c.personality === 'scientist' ? 20 : 0) + rand(g) * 15;
    if (sc > bs) { bs = sc; best = j; }
  });
  return best;
}

/** Недовольный учёный уезжает туда, где спокойнее и платят больше. */
function tryPoach(g: GameState, gen: Genius, war: boolean[]) {
  const e = gen.employer;
  const ce = g.countries[e];
  if (!(ce.stability < 40 || (war[e] && ce.weariness > 30) || STATS[e].hunger > 0)) return;
  let best = -1, bs = 0;
  g.countries.forEach((c, j) => {
    if (!c.alive || j === e || j === g.player || war[j] || c.stability < ce.stability + 15) return;
    if (c.money < geniusPrice(g, j, gen) * 2) return;
    const sc = c.stability + (c.personality === 'scientist' ? 20 : 0) + rand(g) * 10;
    if (sc > bs) { bs = sc; best = j; }
  });
  if (best < 0 || rand(g) > 0.3) return;
  g.countries[best].money -= geniusPrice(g, best, gen);
  gen.employer = best;
  addRel(g, best, e, -5);
  if (e === g.player) {
    sfx('error');
    log(g, `🧑‍🔬 ${gen.name} уезжает в страну ${cname(g, best)}: там спокойнее и платят больше`, 'bad');
  } else if (gen.level === 3) news(g, `🧑‍🔬 ${cname(g, best)} переманила у страны ${cname(g, e)} учёного ${gen.name}`, 'info');
}

function tickGeniuses(g: GameState, war: boolean[]) {
  const mk = g.market;
  if (g.day >= mk.nextGenius) {
    mk.nextGenius = g.day + 45 + Math.floor(rand(g) * 50);
    if (g.geniuses.filter((x) => x.employer < 0).length < 4) listGenius(g);
  }
  for (const gen of g.geniuses.slice()) {
    if (gen.employer >= 0 && !g.countries[gen.employer].alive) {
      gen.employer = -1;
      gen.until = g.day + 60;
    }
    if (gen.employer < 0) {
      if (g.day < gen.until) continue;
      const to = bestHome(g);
      if (to < 0) {
        g.geniuses = g.geniuses.filter((x) => x !== gen);
        continue;
      }
      gen.employer = to;
      gen.until = g.day + 1200 + Math.floor(rand(g) * 1200);
      if (gen.level >= 2) news(g, `🧑‍🔬 ${gen.name} (${GENIUS_FIELDS[gen.field].name.toLowerCase()}) переезжает в страну ${cname(g, to)}`, 'info');
      continue;
    }
    if (g.day >= gen.until) {
      g.geniuses = g.geniuses.filter((x) => x !== gen);
      if (gen.employer === g.player) log(g, `🧑‍🔬 ${gen.name} уходит на пенсию. Спасибо за службу!`, 'info');
      continue;
    }
    if ((g.day + gen.id) % 30 === 0) tryPoach(g, gen, war);
  }
}

// ---------- день ----------
export function tickSociety(g: GameState) {
  const mk = g.market;
  const war = g.countries.map((c, i) => c.alive && enemiesOf(g, i).length > 0);
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    const s = STATS[i];
    // учёные растут из образования, а при кризисе уезжают
    const d = s.sciTarget - c.scientists;
    let leave = 0;
    if (d > 0) c.scientists += d * 0.003;
    else {
      const out = -d * 0.002;
      c.scientists -= out;
      leave += out * 0.5;
    }
    const drain = (c.stability < 35 ? 0.0004 : 0) + s.hunger * 0.001 + (war[i] && c.weariness > 30 ? 0.0003 : 0);
    if (drain > 0) {
      const out = c.scientists * drain;
      c.scientists -= out;
      leave += out;
    }
    mk.sciPool += leave;
    if (i === g.player && leave > 0) g.counters.sciDrain = (g.counters.sciDrain ?? 0) + leave;
    // миллиардеры приезжают в растущую экономику с умеренными налогами
    c.billionaires = Math.max(0, c.billionaires + (s.billTarget - c.billionaires) * 0.004);
    if ((g.day + i) % 10 === 0) corporateLife(g, i);
  });
  // капитализация: растёт в спокойной стране, падает в войну, долги и голод
  for (const co of g.companies) {
    const owner = companyOwner(g, co);
    if (owner < 0) continue;
    const c = g.countries[owner];
    const gy = 0.09 * (0.3 + (0.7 * c.stability) / 100) - 0.5 * Math.max(0, c.tax - 0.3) - (war[owner] ? 0.06 : 0)
      - (c.money < 0 ? 0.08 : 0) - 0.3 * STATS[owner].hunger - (co.state ? 0.02 : 0);
    co.value *= 1 + gy / 365 + (rand(g) - 0.5) * 0.008;
  }
  tickGeniuses(g, war);
  if (g.day % 30 === 0 && (g.counters.sciDrain ?? 0) > 0) {
    const lost = g.counters.sciDrain;
    g.counters.sciDrain = 0;
    if (lost > g.countries[g.player].scientists * 0.005) log(g, `✈️ Утечка мозгов: за месяц уехали ${fmt(lost)} учёных`, 'bad');
  }
}
