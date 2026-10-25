// Действия стран: стройка, наука, армия, расширение, дипломатия, война.
import {
  BATTLE_DAYS, BUILDER_COST, BUILDER_NAMES, BUILDERS_MAX, BUILDINGS, COST_GROWTH, LEVEL_COST, TECHS, TECH_BY_ID, TIER_COST, WAR_GRACE_DAYS,
} from './defs';
import { attackPerSoldier, computeAll, pairKey, PORT_TILES, regionDefense, regionWeight, STATS } from './economy';
import { allBuildings, banner, celebrate, fx, log, mapDirty, news, putBuilding, rand, removeBuilding, sfx } from './state';
import type { BuildingType, GameState, PairState } from './types';
import { coalitionBuildBlock, coalitionWarBlock } from './elections';
import { brothers, onBrotherWar, onLodgeDestroyed } from './lodge';
import { onOrderDestroyed, onOrderWar, orderBrothers } from './order';
import { endWar, fearsUN, isAggressor, joinCoalition, liberatedOwner, onConquest, onDestroyed, openCase, sanctions, warJustice } from './un';
import {
  COLS, COUNTRY_DEFS, NEIGH, REGIONS, REGION_OF, adjacentWaters, hexDist, isCoastalTile, isWater, terrainOf,
} from './world';

/** Сколько дней боты не трогают игрока в начале партии. */
export const PLAYER_GRACE = { easy: 900, normal: 540, hard: 300 };

// ---------- общие ----------
export function pair(g: GameState, a: number, b: number): PairState {
  const k = pairKey(a, b);
  return (g.pairs[k] ??= {});
}
export const peekPair = (g: GameState, a: number, b: number): PairState => g.pairs[pairKey(a, b)] ?? {};
export const atWar = (g: GameState, a: number, b: number) => !!peekPair(g, a, b).war;
export function setRel(g: GameState, a: number, b: number, v: number) {
  const x = Math.max(-100, Math.min(100, v));
  g.rel[a][b] = x;
  g.rel[b][a] = x;
}
export const addRel = (g: GameState, a: number, b: number, dv: number) => setRel(g, a, b, g.rel[a][b] + dv);
export const cname = (_g: GameState, i: number) => (i < 0 ? 'Нейтральные земли' : COUNTRY_DEFS[i]?.name ?? '?');
const involvesPlayer = (g: GameState, ...ids: number[]) => ids.includes(g.player);
const colorOf = (i: number) => (i >= 0 ? parseInt(COUNTRY_DEFS[i].color.slice(1), 16) : 0x8a8f99);

export function enemiesOf(g: GameState, a: number): number[] {
  const out: number[] = [];
  g.countries.forEach((c, i) => {
    if (i !== a && c.alive && atWar(g, a, i)) out.push(i);
  });
  return out;
}
export function alliesOf(g: GameState, a: number): number[] {
  const out: number[] = [];
  g.countries.forEach((c, i) => {
    if (i !== a && c.alive && peekPair(g, a, i).alliance) out.push(i);
  });
  return out;
}
/** Страны, с которыми есть общая сухопутная граница. */
export function neighborCountries(g: GameState, a: number): Set<number> {
  const out = new Set<number>();
  for (const rid of STATS[a]?.regions ?? []) {
    for (const nb of REGIONS[rid].neighbors) {
      const o = g.regions[nb].owner;
      if (o >= 0 && o !== a) out.add(o);
    }
  }
  return out;
}

// ---------- стройка ----------
export function buildCost(g: GameState, ci: number, type: BuildingType, level: number, rid: number): number {
  const c = g.countries[ci];
  const w = regionWeight(g.regions[rid].pop);
  return BUILDINGS[type].cost * LEVEL_COST[level] * w * c.baseProd * Math.pow(COST_GROWTH, STATS[ci].counts[type]);
}
export const buildTime = (type: BuildingType, level: number) => Math.round(BUILDINGS[type].time * (level === 1 ? 1 : level * 1.5));

export function isBorderTile(g: GameState, tile: number): boolean {
  const owner = g.regions[REGION_OF[tile]].owner;
  for (let d = 0; d < 6; d++) {
    const n = NEIGH[tile * 6 + d];
    if (n < 0 || isWater(n)) continue;
    const o = g.regions[REGION_OF[n]].owner;
    if (o !== owner) return true;
  }
  return false;
}

/** Можно ли поставить здание на клетку (null — можно, иначе причина). */
export function placeError(g: GameState, ci: number, tile: number, type: BuildingType): string | null {
  if (isWater(tile)) return 'Это вода';
  const rid = REGION_OF[tile];
  if (g.regions[rid].owner !== ci) return 'Не ваша территория';
  if (REGIONS[rid].center === tile) return 'Здесь центр региона';
  if (g.buildings[tile]) return 'Клетка уже занята';
  const def = BUILDINGS[type];
  const ter = terrainOf(tile);
  if (ter === 's') return 'Вечные льды — строить нельзя';
  if (def.terrains && !def.terrains.includes(ter)) return 'Неподходящая местность';
  if (def.nearCity !== undefined && hexDist(tile, REGIONS[rid].center) > def.nearCity) return 'Слишком далеко от центра региона';
  if (def.coastal && !isCoastalTile(tile)) return 'Нужно побережье';
  if (def.fortress && ter !== 'm' && !isBorderTile(g, tile)) return 'Только горы или граница';
  return coalitionBuildBlock(g, ci, type);
}

export function startBuild(g: GameState, ci: number, tile: number, type: BuildingType): string | null {
  const err = placeError(g, ci, tile, type);
  if (err) return err;
  const s = STATS[ci];
  if (s.constructing >= s.slots) return `Одновременно можно строить не больше ${s.slots}`;
  const cost = buildCost(g, ci, type, 1, REGION_OF[tile]);
  const c = g.countries[ci];
  if (c.money < cost) return 'Не хватает денег';
  c.money -= cost;
  const t = buildTime(type, 1);
  putBuilding(g, tile, { type, level: 1, progress: t, total: t });
  mapDirty.buildings = true;
  if (ci === g.player) sfx('build');
  computeAll(g);
  return null;
}

export function upgradeError(g: GameState, ci: number, tile: number): string | null {
  const b = g.buildings[tile];
  if (!b) return 'Здесь нет здания';
  if (g.regions[REGION_OF[tile]].owner !== ci) return 'Не ваше здание';
  if (b.progress > 0) return 'Идёт строительство';
  if (b.level >= 3) return 'Максимальный уровень';
  const tech = BUILDINGS[b.type].techFor[b.level + 1];
  if (tech && !g.countries[ci].techs.includes(tech)) return `Нужна технология «${TECH_BY_ID[tech].name}»`;
  const s = STATS[ci];
  if (s.constructing >= s.slots) return `Одновременно можно строить не больше ${s.slots}`;
  return null;
}

export function startUpgrade(g: GameState, ci: number, tile: number): string | null {
  const err = upgradeError(g, ci, tile);
  if (err) return err;
  const b = g.buildings[tile];
  const cost = buildCost(g, ci, b.type, b.level + 1, REGION_OF[tile]);
  const c = g.countries[ci];
  if (c.money < cost) return 'Не хватает денег';
  c.money -= cost;
  b.level++;
  b.progress = b.total = buildTime(b.type, b.level);
  mapDirty.buildings = true;
  if (ci === g.player) sfx('build');
  computeAll(g);
  return null;
}

// ---------- строители ----------
export const builderLevel = (g: GameState, ci: number) => g.countries[ci].builders ?? 1;
/** Цена следующего уровня строителей (0 — уже максимум). */
export function builderCost(g: GameState, ci: number): number {
  const next = builderLevel(g, ci) + 1;
  return next > BUILDERS_MAX ? 0 : BUILDER_COST[next] * g.countries[ci].moneyScale;
}
export function builderError(g: GameState, ci: number): string | null {
  if (builderLevel(g, ci) >= BUILDERS_MAX) return 'Строители уже лучшие в мире';
  if (g.countries[ci].money < builderCost(g, ci)) return 'Не хватает денег';
  return null;
}
/** Нанять строителей следующего уровня: +1 место для стройки, стройка быстрее. */
export function upgradeBuilders(g: GameState, ci: number): string | null {
  const err = builderError(g, ci);
  if (err) return err;
  const c = g.countries[ci];
  c.money -= builderCost(g, ci);
  c.builders = builderLevel(g, ci) + 1;
  if (ci === g.player) {
    sfx('build');
    log(g, `👷 Строители: ${BUILDER_NAMES[c.builders]} (ур. ${c.builders})`, 'good');
  }
  computeAll(g);
  return null;
}

export function demolish(g: GameState, ci: number, tile: number) {
  if (g.regions[REGION_OF[tile]].owner !== ci) return;
  removeBuilding(g, tile);
  mapDirty.buildings = true;
  computeAll(g);
}

/** Лучшая клетка для здания: регион побольше и где таких зданий меньше. */
export function bestTileFor(g: GameState, ci: number, type: BuildingType): number {
  let best = -1, bestScore = -Infinity;
  const perRegion = new Int32Array(REGIONS.length);
  const { tiles, list } = allBuildings(g);
  for (let k = 0; k < tiles.length; k++) if (list[k].type === type) perRegion[REGION_OF[tiles[k]]]++;
  for (const rid of STATS[ci].regions) {
    const pop = g.regions[rid].pop;
    const score0 = Math.log10(pop + 10) - 0.9 * perRegion[rid];
    for (const t of REGIONS[rid].tiles) {
      if (placeError(g, ci, t, type)) continue;
      const score = score0 - hexDist(t, REGIONS[rid].center) * 0.01 + (type === 'fortress' && isBorderTile(g, t) ? 0.5 : 0);
      if (score > bestScore) { bestScore = score; best = t; }
    }
  }
  return best;
}

// ---------- наука ----------
export function techCost(g: GameState, ci: number, techId: string): number {
  const t = TECH_BY_ID[techId];
  return TIER_COST[t.tier] * g.countries[ci].techScale;
}
export const fundamentalCost = (g: GameState, ci: number) => 2500 * Math.pow(1.25, g.countries[ci].fundamental) * g.countries[ci].techScale;

export function researchError(g: GameState, ci: number, techId: string): string | null {
  const c = g.countries[ci];
  const t = TECH_BY_ID[techId];
  if (c.techs.includes(techId)) return 'Уже изучено';
  if (t.req && !c.techs.includes(t.req)) return `Сначала «${TECH_BY_ID[t.req].name}»`;
  if (c.brains < techCost(g, ci, techId)) return 'Не хватает 🧠';
  return null;
}
export function research(g: GameState, ci: number, techId: string): string | null {
  const err = researchError(g, ci, techId);
  if (err) return err;
  const c = g.countries[ci];
  c.brains -= techCost(g, ci, techId);
  c.techs.push(techId);
  g.counters.techs = (g.counters.techs ?? 0) + (ci === g.player ? 1 : 0);
  if (ci === g.player) {
    sfx('research');
    log(g, `🔬 Изучено: ${TECH_BY_ID[techId].name}`, 'good');
  }
  computeAll(g);
  return null;
}
export function researchFundamental(g: GameState, ci: number): string | null {
  const c = g.countries[ci];
  const cost = fundamentalCost(g, ci);
  if (c.brains < cost) return 'Не хватает 🧠';
  c.brains -= cost;
  c.fundamental++;
  if (ci === g.player) {
    sfx('research');
    log(g, `🔬 Фундаментальные исследования, уровень ${c.fundamental}`, 'good');
  }
  computeAll(g);
  return null;
}
export const availableTechs = (g: GameState, ci: number) =>
  TECHS.filter((t) => !g.countries[ci].techs.includes(t.id) && (!t.req || g.countries[ci].techs.includes(t.req)));

// ---------- армия ----------
export function recruitCost(g: GameState, ci: number, n: number) {
  const c = g.countries[ci];
  return n * 0.25 * c.baseProd * (c.armyType === 'contract' ? 1.5 : 0.5) * STATS[ci].barracksMult;
}
export const armyLimit = (g: GameState, ci: number) => STATS[ci].civPop * (g.countries[ci].armyType === 'conscript' ? 0.08 : 0.05);

function takePopulation(g: GameState, ci: number, n: number) {
  const s = STATS[ci];
  if (s.civPop <= 0) return;
  const k = Math.min(1, n / s.civPop);
  for (const rid of s.regions) g.regions[rid].pop *= 1 - k;
}
function addPopulation(g: GameState, ci: number, n: number) {
  const s = STATS[ci];
  if (s.civPop <= 0) return;
  const k = n / s.civPop;
  for (const rid of s.regions) g.regions[rid].pop *= 1 + k;
}

export function recruit(g: GameState, ci: number, n: number): string | null {
  const c = g.countries[ci];
  n = Math.floor(n);
  if (n <= 0) return 'Некого призывать';
  if (c.soldiers + n > armyLimit(g, ci)) return 'Достигнут предел армии для такого населения';
  const cost = recruitCost(g, ci, n);
  if (c.money < cost) return 'Не хватает денег';
  c.money -= cost;
  c.soldiers += n;
  takePopulation(g, ci, n);
  if (ci === g.player) sfx('recruit');
  computeAll(g);
  return null;
}
export function disband(g: GameState, ci: number, n: number) {
  const c = g.countries[ci];
  n = Math.min(c.soldiers, Math.floor(n));
  c.soldiers -= n;
  addPopulation(g, ci, n);
  computeAll(g);
}

// ---------- расширение ----------
/** Можно ли дотянуться до региона: общая граница или морем (нужен порт). */
export function reach(g: GameState, ci: number, rid: number): 'land' | 'sea' | null {
  for (const nb of REGIONS[rid].neighbors) if (g.regions[nb].owner === ci) return 'land';
  if (seaReach(ci, rid)) return 'sea';
  return null;
}
export const SEA_RANGE = 30;
/** Морем: свой порт в том же водоёме и не дальше SEA_RANGE клеток. */
export function seaReach(ci: number, rid: number): boolean {
  const reg = REGIONS[rid];
  if (!reg.coastal) return false;
  for (const p of PORT_TILES[ci] ?? []) {
    if (hexDist(p, reg.center) > SEA_RANGE) continue;
    if (adjacentWaters(p).some((w) => reg.waters.includes(w))) return true;
  }
  return false;
}
export const hasPort = (_g: GameState, ci: number) => (PORT_TILES[ci]?.length ?? 0) > 0;

export function annexCost(g: GameState, ci: number, rid: number): number {
  const s = STATS[ci];
  const c = g.countries[ci];
  const pop = g.regions[rid].pop;
  const gross = Math.max(c.lastGross, 30);
  const friend = g.regions[rid].ally === ci ? ALLY_DISCOUNT : 1; // помогли отделиться — земля сама просится к нам
  return (gross * 150 * (1 + (pop / Math.max(1, s.civPop)) * 3) * Math.pow(1.12, c.annexCount) + REGIONS[rid].tiles.length * 50 * c.baseProd) * friend;
}
/** Во сколько обходится присоединение земли, которой мы помогли отделиться (доля обычной цены). */
export const ALLY_DISCOUNT = 0.4;
export function annexError(g: GameState, ci: number, rid: number): string | null {
  if (g.regions[rid].owner !== -1) return 'Это не нейтральная земля';
  if (!reach(g, ci, rid)) return 'Нет общей границы (или порта для пути по морю)';
  if (g.battles.some((b) => b.region === rid)) return 'Здесь идёт бой';
  if (g.countries[ci].money < annexCost(g, ci, rid)) return 'Не хватает денег';
  return null;
}
export function annex(g: GameState, ci: number, rid: number): string | null {
  const err = annexError(g, ci, rid);
  if (err) return err;
  const c = g.countries[ci];
  c.money -= annexCost(g, ci, rid);
  c.annexCount++;
  transferRegion(g, rid, ci, false);
  fx({ kind: 'float', tile: REGIONS[rid].center, text: '🕊️' });
  if (ci === g.player) {
    g.counters.annexed = (g.counters.annexed ?? 0) + 1;
    sfx('annex');
    log(g, `🕊️ ${REGIONS[rid].name} мирно присоединены`, 'good');
  }
  return null;
}

export function transferRegion(g: GameState, rid: number, to: number, conquest: boolean) {
  const from = g.regions[rid].owner;
  const share = g.regions[rid].pop / Math.max(1, STATS[to]?.civPop ?? 1);
  g.regions[rid].owner = to;
  delete g.regions[rid].ally;
  if (conquest) {
    if (from >= 0) onConquest(g, from, to);
    g.regions[rid].pop *= 0.97;
    g.countries[to].unrest += Math.min(8, Math.max(1, share * 30));
    // компании со штаб-квартирой в регионе переходят к победителю (часть стоимости теряется)
    for (const co of g.companies) {
      if (co.hq !== rid) continue;
      co.value *= 0.75;
      if (to === g.player) log(g, `🏢 Компания «${co.name}» перешла под наш контроль`, 'good');
      else if (from === g.player) log(g, `🏢 Мы потеряли компанию «${co.name}»`, 'bad');
    }
  } else {
    g.countries[to].unrest += Math.min(3, Math.max(0.5, share * 10));
  }
  mapDirty.territory = true;
  mapDirty.buildings = true;
  fx({ kind: 'flash', tile: REGIONS[rid].center, color: colorOf(to) });
  if (from >= 0) {
    const fc = g.countries[from];
    fc.stability = Math.max(0, fc.stability - 6);
    const left = g.regions.filter((r) => r.owner === from);
    if (left.length === 0) {
      destroyCountry(g, from, to);
    } else if (fc.capital === rid) {
      let best = -1, bp = -1;
      g.regions.forEach((r, i) => { if (r.owner === from && r.pop > bp) { bp = r.pop; best = i; } });
      fc.capital = best;
      fc.stability = Math.max(0, fc.stability - 20);
      if (from === g.player) log(g, `🏚️ Столица пала! Новая столица — ${REGIONS[best].name}`, 'bad');
      else if (involvesPlayer(g, to)) log(g, `🏳️ Столица страны ${cname(g, from)} взята!`, 'war');
      else news(g, `🏳️ ${cname(g, to)} взяла столицу страны ${cname(g, from)} — ${REGIONS[rid].name}`, 'war');
    }
  }
  computeAll(g);
}

function destroyCountry(g: GameState, ci: number, by: number) {
  const c = g.countries[ci];
  c.alive = false;
  c.soldiers = 0;
  for (const k of Object.keys(g.pairs)) {
    const [a, b] = k.split('-').map(Number);
    if (a === ci || b === ci) delete g.pairs[k];
  }
  g.battles = g.battles.filter((b) => b.att !== ci && b.def !== ci);
  if (c.project) c.project = undefined;
  onDestroyed(g, ci);
  onLodgeDestroyed(g, ci);
  onOrderDestroyed(g, ci);
  if (ci === g.player) {
    g.gameOver = true;
    sfx('defeat');
    log(g, '💀 Ваша страна потеряла все земли', 'bad');
  } else if (involvesPlayer(g, by)) {
    log(g, `💀 ${cname(g, ci)} прекратила существование`, 'war');
  } else {
    news(g, `💀 ${cname(g, ci)} прекратила существование — её последние земли взяла ${cname(g, by)}`, 'war');
  }
}

// ---------- война ----------
export function warError(g: GameState, a: number, b: number): string | null {
  if (a === b || !g.countries[b].alive) return 'Недопустимая цель';
  const p = peekPair(g, a, b);
  if (p.war) return 'Уже идёт война';
  if (p.alliance) return 'Это ваш союзник — сначала разорвите союз';
  if (p.truce && p.truce > g.day) return `Перемирие ещё ${Math.ceil(p.truce - g.day)} дн.`;
  if (a !== g.player && g.day < WAR_GRACE_DAYS) return 'Рано';
  if (b === g.player && g.day < PLAYER_GRACE[g.difficulty]) return 'Рано';
  return coalitionWarBlock(g, a);
}

export function declareWar(g: GameState, a: number, b: number, chain = true): string | null {
  const err = warError(g, a, b);
  if (err) return err;
  const p = pair(g, a, b);
  // права ли a: помочь жертве агрессии или упредить чужое нападение мир одобрит, иначе — дело в ООН
  const justice = warJustice(g, a, b);
  const vsAggressor = isAggressor(g, b);
  const treachery = !!p.pact && !justice.just;
  if (p.pact && justice.just) p.pact = false;
  else if (p.pact) {
    // предательство
    p.pact = false;
    p.grudge = 60;
    g.countries.forEach((_, i) => { if (i !== a && i !== b) addRel(g, a, i, -15); });
    if (involvesPlayer(g, a, b)) log(g, `⚠️ ${cname(g, a)} нарушает пакт о ненападении с ${cname(g, b)}!`, 'war');
    else news(g, `⚠️ ${cname(g, a)} вероломно нарушила пакт с ${cname(g, b)}`, 'war');
  }
  p.trade = false;
  p.war = { since: g.day, aRegions: STATS[Math.min(a, b)].regions.length, bRegions: STATS[Math.max(a, b)].regions.length };
  addRel(g, a, b, -50);
  if (!justice.just) g.countries.forEach((c, i) => { if (c.alive && i !== a && i !== b) addRel(g, a, i, -4); });
  g.countries[a].aiFlags.lastWarDay = g.day;
  if (a === g.player) g.counters.warsDeclared = (g.counters.warsDeclared ?? 0) + 1;
  if (involvesPlayer(g, a, b)) sfx('war');
  if (b === g.player) {
    log(g, `⚔️ ${cname(g, a)} объявляет вам войну!`, 'war', false);
    banner({ icon: '⚔️', title: 'Война!', text: `${cname(g, a)} объявляет вам войну`, kind: 'war' });
  } else if (a === g.player) {
    log(g, `⚔️ Вы объявили войну: ${cname(g, b)}${justice.just ? ` — ${justice.reason}` : ''}`, 'war', false);
    banner({ icon: '⚔️', title: 'Война объявлена', text: justice.just ? `${cname(g, b)} — ${justice.reason}` : cname(g, b), kind: 'war' });
  }
  else news(g, `⚔️ ${cname(g, a)} объявила войну стране ${cname(g, b)}`, 'war');
  if (chain) {
    for (const ally of alliesOf(g, b)) {
      if (ally === a || atWar(g, ally, a)) continue;
      if (peekPair(g, ally, a).alliance) continue; // союзник обеих сторон остаётся в стороне
      const ap = pair(g, ally, a);
      ap.pact = false;
      ap.truce = 0;
      ap.trade = false;
      ap.war = { since: g.day, aRegions: STATS[Math.min(ally, a)].regions.length, bRegions: STATS[Math.max(ally, a)].regions.length };
      addRel(g, ally, a, -40);
      if (ally === g.player) {
        sfx('war');
        log(g, `🤝 Союзный долг: вы вступили в войну против ${cname(g, a)}`, 'war');
      } else if (a === g.player) log(g, `🛡️ ${cname(g, ally)} вступает в войну на стороне союзника`, 'war');
      else news(g, `🛡️ ${cname(g, ally)} вступает в войну против ${cname(g, a)} на стороне союзника`, 'war');
    }
  }
  if (vsAggressor) joinCoalition(g, a, b);
  else if (!justice.just) openCase(g, a, b, treachery);
  if (brothers(g, a, b)) onBrotherWar(g, a, b);
  if (orderBrothers(g, a, b)) onOrderWar(g, a, b);
  computeAll(g);
  return null;
}

/** quiet — без отдельной новости (мир коалиции ООН объявляется одной строкой). */
export function makePeace(g: GameState, a: number, b: number, quiet = false) {
  const p = pair(g, a, b);
  if (!p.war) return;
  const me = g.player;
  const other = a === me ? b : a;
  const before = involvesPlayer(g, a, b) ? { rate: STATS[me].moneyRate, rel: g.rel[me][other], power: STATS[me].power } : null;
  let back = 0;
  delete p.war;
  p.truce = g.day + 365;
  for (const bt of g.battles.filter((x) => (x.att === a && x.def === b) || (x.att === b && x.def === a))) {
    g.countries[bt.att].soldiers += bt.soldiers;
    if (bt.att === me) back += bt.soldiers;
    if (bt.guard) {
      g.countries[bt.def].soldiers += bt.guard;
      if (bt.def === me) back += bt.guard;
    }
  }
  g.battles = g.battles.filter((x) => !((x.att === a && x.def === b) || (x.att === b && x.def === a)));
  addRel(g, a, b, 20);
  if (involvesPlayer(g, a, b)) {
    sfx('peace');
    log(g, `🕊️ Мир между ${cname(g, a)} и ${cname(g, b)}`, 'good', false);
  } else if (!quiet) news(g, `🕊️ Мир между ${cname(g, a)} и ${cname(g, b)}`, 'good');
  endWar(g, a, b);
  if (before) {
    computeAll(g);
    celebrate({
      kind: 'peace', partner: other,
      rateBefore: before.rate, rateAfter: STATS[me].moneyRate,
      relBefore: before.rel, relAfter: g.rel[me][other],
      powerBefore: before.power, powerAfter: STATS[me].power, soldiersBack: back,
    });
  }
}

export function attackError(g: GameState, ci: number, rid: number): string | null {
  const owner = g.regions[rid].owner;
  if (owner === ci) return 'Это ваш регион';
  if (owner >= 0 && !atWar(g, ci, owner)) return 'Сначала нужно объявить войну';
  if (!reach(g, ci, rid)) return 'Нет общей границы (или порта для высадки с моря)';
  if (g.battles.some((b) => b.region === rid)) return 'Здесь уже идёт бой';
  if (g.battles.filter((b) => b.att === ci).length >= 3) return 'Не больше 3 наступлений одновременно';
  return null;
}

export function launchAttack(g: GameState, ci: number, rid: number, soldiers: number): string | null {
  const err = attackError(g, ci, rid);
  if (err) return err;
  const c = g.countries[ci];
  soldiers = Math.floor(Math.min(soldiers, c.soldiers));
  if (soldiers < 1) return 'Нет свободных солдат';
  c.soldiers -= soldiers;
  const owner = g.regions[rid].owner;
  const naval = reach(g, ci, rid) === 'sea';
  g.battles.push({ id: g.nextId++, att: ci, def: owner, region: rid, soldiers, start: g.day, end: g.day + BATTLE_DAYS, naval });
  if (ci === g.player) sfx('attack');
  if (owner === g.player) {
    sfx('alarm');
    log(g, `🚨 ${cname(g, ci)} наступает на ${REGIONS[rid].name}!`, 'war');
  }
  computeAll(g);
  return null;
}

/** Оценка: шанс победы при отправке n солдат. */
export function winChance(g: GameState, ci: number, rid: number, n: number) {
  const naval = reach(g, ci, rid) === 'sea';
  const A = n * attackPerSoldier(g, ci, naval);
  const D = regionDefense(g, rid).strength;
  if (A <= 0) return 0;
  return (A * A) / (A * A + D * D);
}
/** Сколько солдат нужно для шанса p. */
export function soldiersFor(g: GameState, ci: number, rid: number, p: number) {
  const naval = reach(g, ci, rid) === 'sea';
  const per = attackPerSoldier(g, ci, naval);
  const D = regionDefense(g, rid).strength;
  return Math.ceil((D * Math.sqrt(p / (1 - p))) / Math.max(1e-9, per));
}

// ---------- ход боя: подкрепления, отступление, резервы защитника ----------
type BattleT = GameState['battles'][number];
/** Последние дни боя ничего уже не изменить. */
export const BATTLE_LOCK = 3;
const battleForces = (g: GameState, bt: BattleT) => ({
  A: bt.soldiers * attackPerSoldier(g, bt.att, bt.naval),
  D: regionDefense(g, bt.region, bt.guard ?? 0).strength,
});
/** Шанс нападающего выиграть идущий бой. */
export function battleChance(g: GameState, bt: BattleT) {
  const { A, D } = battleForces(g, bt);
  return A <= 0 ? 0 : (A * A) / (A * A + D * D || 1);
}
/** Сколько ещё солдат нужно стороне side, чтобы шанс нападающего стал p (для защитника — упал до p). */
export function battleNeed(g: GameState, bt: BattleT, side: 'att' | 'def', p: number) {
  const { A, D } = battleForces(g, bt);
  if (side === 'att') {
    const per = attackPerSoldier(g, bt.att, bt.naval);
    return Math.max(0, Math.ceil((D * Math.sqrt(p / (1 - p))) / Math.max(1e-9, per) - bt.soldiers));
  }
  if (bt.def < 0) return 0;
  const per = regionDefense(g, bt.region, 1).strength - regionDefense(g, bt.region, 0).strength;
  return Math.max(0, Math.ceil((A * Math.sqrt((1 - p) / p) - D) / Math.max(1e-9, per)));
}
export function battleActError(g: GameState, ci: number, bt: BattleT | undefined, side: 'att' | 'def'): string | null {
  if (!bt || (side === 'att' ? bt.att : bt.def) !== ci) return 'Нет такого боя';
  if (bt.end - g.day < BATTLE_LOCK) return 'Бой почти закончен — поздно';
  if (g.countries[ci].soldiers < 1) return 'Нет свободных солдат';
  return null;
}
/** Подкрепление в наступление. */
export function reinforce(g: GameState, ci: number, id: number, n: number): string | null {
  const bt = g.battles.find((b) => b.id === id);
  const err = battleActError(g, ci, bt, 'att');
  if (err) return err;
  const c = g.countries[ci];
  n = Math.floor(Math.min(n, c.soldiers));
  if (n < 1) return 'Нет свободных солдат';
  c.soldiers -= n;
  bt!.soldiers += n;
  computeAll(g);
  return null;
}
/** Резервы в обороняющийся регион: гарнизон там крепче, но меньше солдат остаётся на остальных землях. */
export function sendGuard(g: GameState, ci: number, id: number, n: number): string | null {
  const bt = g.battles.find((b) => b.id === id);
  const err = battleActError(g, ci, bt, 'def');
  if (err) return err;
  const c = g.countries[ci];
  n = Math.floor(Math.min(n, c.soldiers));
  if (n < 1) return 'Нет свободных солдат';
  c.soldiers -= n;
  bt!.guard = (bt!.guard ?? 0) + n;
  if (bt!.att === g.player) log(g, `🛡️ ${cname(g, ci)} перебрасывает резервы в ${REGIONS[bt!.region].name}`, 'war');
  computeAll(g);
  return null;
}
/** Отступить: уцелевшие возвращаются, но чем дольше шёл бой, тем дороже отход под огнём. */
export function retreat(g: GameState, ci: number, id: number): string | null {
  const bt = g.battles.find((b) => b.id === id);
  if (!bt || bt.att !== ci) return 'Нет такого боя';
  const c = g.countries[ci];
  const loss = bt.soldiers * (0.04 + 0.16 * Math.min(1, (g.day - bt.start) / BATTLE_DAYS));
  c.soldiers += bt.soldiers - loss;
  c.arms = Math.max(0, c.arms - loss * Math.min(1, STATS[ci].equip) * 0.7);
  if (bt.guard && bt.def >= 0) g.countries[bt.def].soldiers += bt.guard;
  g.battles = g.battles.filter((b) => b.id !== id);
  const rname = REGIONS[bt.region].name;
  if (ci === g.player) log(g, `↩️ Войска отходят от региона ${rname}: потеряно ${fmtK(loss)}`, 'war');
  else if (bt.def === g.player) {
    g.counters.defended = (g.counters.defended ?? 0) + 1;
    sfx('victory');
    log(g, `🛡️ ${cname(g, ci)} отступила от региона ${rname} (потеряла ${fmtK(loss)})`, 'good');
  }
  computeAll(g);
  return null;
}

export function resolveBattle(g: GameState, bt: (typeof g.battles)[number]) {
  const att = g.countries[bt.att];
  const r = g.regions[bt.region];
  const guard = bt.def >= 0 ? bt.guard ?? 0 : 0;
  if (!att.alive) {
    if (guard) g.countries[bt.def].soldiers += guard;
    return;
  }
  if (r.owner !== bt.def || (bt.def >= 0 && !atWar(g, bt.att, bt.def))) {
    att.soldiers += bt.soldiers;
    if (guard) g.countries[bt.def].soldiers += guard;
    return;
  }
  const A = bt.soldiers * attackPerSoldier(g, bt.att, bt.naval);
  const { garrison, strength: D } = regionDefense(g, bt.region, guard);
  const p = (A * A) / (A * A + D * D || 1);
  const win = rand(g) < p;
  const ratio = D / Math.max(1e-9, A);
  let attLoss: number, defLoss: number;
  if (win) {
    attLoss = bt.soldiers * Math.min(0.5, Math.max(0.03, 0.15 * ratio + 0.03));
    defLoss = garrison * 0.5;
  } else {
    attLoss = bt.soldiers * Math.min(0.8, Math.max(0.15, 0.35 * ratio));
    defLoss = garrison * Math.min(0.4, Math.max(0.02, 0.2 / Math.max(ratio, 0.01)));
  }
  att.soldiers += bt.soldiers - attLoss;
  const sa = STATS[bt.att];
  att.weariness = Math.min(100, att.weariness + 1 + (attLoss / Math.max(1, sa.civPop)) * 3000);
  // вместе с погибшими теряется и их оружие
  att.arms = Math.max(0, att.arms - attLoss * Math.min(1, sa.equip) * 0.7);
  if (bt.def >= 0) {
    const d = g.countries[bt.def];
    // переброшенные резервы гибнут в той же доле, что и гарнизон; уцелевшие возвращаются в армию
    const guardLoss = guard * (defLoss / Math.max(1e-9, garrison));
    d.soldiers = Math.max(0, d.soldiers - (defLoss - guardLoss) + (guard - guardLoss));
    d.arms = Math.max(0, d.arms - defLoss * Math.min(1, STATS[bt.def].equip) * 0.7);
    d.weariness = Math.min(100, d.weariness + 1 + (defLoss / Math.max(1, STATS[bt.def].civPop)) * 3000);
  }
  const rname = REGIONS[bt.region].name;
  const lossTxt = `потери: ${fmtK(attLoss)} / ${fmtK(defLoss)}`;
  const center = REGIONS[bt.region].center;
  if (win) {
    fx({ kind: 'float', tile: center, text: '🔥' });
    // коалиция ООН не захватывает, а освобождает: земли жертвы возвращаются ей
    const to = liberatedOwner(g, bt.att, bt.def, bt.region);
    const freed = to !== bt.att ? `${rname} освобождён и возвращён стране ${cname(g, to)}` : '';
    if (freed) addRel(g, bt.att, to, 15);
    if (bt.att === g.player) {
      g.counters.wins = (g.counters.wins ?? 0) + 1;
      g.counters.conquered = (g.counters.conquered ?? 0) + 1;
      g.counters.lastWinDay = g.day;
      sfx('victory');
      log(g, `🏆 Победа! ${freed || `${rname} захвачен`} (${lossTxt})`, 'good', false);
      banner({ icon: '🏆', title: 'Победа!', text: `${freed || `${rname} захвачен`} · ${lossTxt}`, kind: 'gold' });
    } else if (freed && to === g.player) {
      sfx('victory');
      log(g, `🕊️ Коалиция ООН освободила ${rname} и вернула его нам`, 'good', false);
      banner({ icon: '🕊️', title: 'Земли возвращены', text: `${cname(g, bt.att)} освободила ${rname}`, kind: 'good' });
    } else if (freed) {
      news(g, `🕊️ ${cname(g, bt.att)}: ${freed}`, 'good');
    } else if (bt.def === g.player) {
      sfx('defeat');
      log(g, `💥 Мы потеряли ${rname} (${lossTxt})`, 'bad', false);
      banner({ icon: '💥', title: 'Регион потерян', text: `${rname} · ${lossTxt}`, kind: 'war' });
    }
    if (bt.def < 0) g.countries.forEach((c, i) => { if (c.alive && i !== bt.att) addRel(g, bt.att, i, -2); });
    transferRegion(g, bt.region, to, true);
  } else {
    fx({ kind: 'float', tile: center, text: '🛡️' });
    if (bt.att === g.player) {
      sfx('defeat');
      log(g, `❌ Наступление на ${rname} отбито (${lossTxt})`, 'bad');
    } else if (bt.def === g.player) {
      g.counters.defended = (g.counters.defended ?? 0) + 1;
      if (guard) g.counters.guardHolds = (g.counters.guardHolds ?? 0) + 1;
      sfx('victory');
      log(g, `🛡️ Мы отбили атаку на ${rname} (${lossTxt})`, 'good');
    }
  }
}

function fmtK(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toString();
}

// ---------- дипломатия ----------
export type DiploKind = 'trade' | 'pact' | 'alliance';
const DIPLO_NEED: Record<DiploKind, number> = { trade: 0, pact: 10, alliance: 50 };
export const DIPLO_NAME: Record<DiploKind, string> = { trade: 'Торговый договор', pact: 'Пакт о ненападении', alliance: 'Военный союз' };

export function maxTrade(g: GameState, ci: number) {
  return 4 + (g.countries[ci].techs.includes('global_logistics') ? 2 : 0) + (g.countries[ci].techs.includes('auto_ports') ? 1 : 0);
}

/** Согласится ли бот b на договор с a. */
export function willAccept(g: GameState, a: number, b: number, kind: DiploKind): boolean {
  const per = g.countries[b].personality;
  let need = DIPLO_NEED[kind];
  if (per === 'trader' && kind === 'trade') need -= 25;
  if (per === 'cautious' && kind === 'pact') need -= 15;
  if (per === 'aggressor') need += kind === 'trade' ? 10 : 25;
  if (per === 'fanatic' && g.countries[a].religion !== g.countries[b].religion) need += 15;
  if (kind !== 'trade' && sharedFoe(g, a, b) >= 0) need -= 25;
  if (brothers(g, a, b) || orderBrothers(g, a, b)) need -= 15; // братья по ложе договариваются легче
  if (kind === 'trade' && STATS[b].tradePartners >= maxTrade(g, b)) return false;
  if (sanctions(g, b, a)) return false; // кто ввёл санкции, с агрессором договоров не заключает
  return g.rel[a][b] >= need;
}

/** Общий враг: обе страны воюют с ним или обе боятся сильнейшего (-1 — нет). Союзы против него заключаются легче. */
export function sharedFoe(g: GameState, a: number, b: number): number {
  for (let k = 0; k < g.countries.length; k++) {
    if (k === a || k === b || !g.countries[k].alive) continue;
    if (atWar(g, a, k) && atWar(g, b, k)) return k;
    if (g.rel[a][k] < -40 && g.rel[b][k] < -40 && STATS[k].power > Math.max(STATS[a].power, STATS[b].power)) return k;
  }
  return -1;
}

export function diploError(g: GameState, a: number, b: number, kind: DiploKind): string | null {
  const p = peekPair(g, a, b);
  if (p.war) return 'Вы воюете';
  if (p[kind]) return 'Уже заключён';
  if (kind === 'trade' && STATS[a].tradePartners >= maxTrade(g, a)) return `Не больше ${maxTrade(g, a)} торговых договоров`;
  if (kind === 'trade' && sanctions(g, a, b)) return 'Действуют наши санкции';
  if (a === g.player && p.cooldown && p.cooldown > g.day) return `Повторить можно через ${Math.ceil(p.cooldown - g.day)} дн.`;
  return null;
}

export function sign(g: GameState, a: number, b: number, kind: DiploKind) {
  const p = pair(g, a, b);
  const me = g.player;
  const other = a === me ? b : a;
  const before = involvesPlayer(g, a, b) ? { rate: STATS[me].moneyRate, rel: g.rel[me][other], power: STATS[me].power } : null;
  p[kind] = true;
  if (kind === 'alliance') p.pact = true;
  if (kind === 'trade') {
    p.tradeSince = g.day;
    p.earned = 0;
  }
  addRel(g, a, b, kind === 'alliance' ? 10 : 5);
  if (!involvesPlayer(g, a, b) && kind === 'alliance') news(g, `🛡️ Военный союз: ${cname(g, a)} и ${cname(g, b)}`, 'info');
  if (involvesPlayer(g, a, b)) {
    sfx('treaty');
    log(g, `🤝 ${DIPLO_NAME[kind]}: ${cname(g, other)}`, 'good', false);
    if (kind === 'trade') g.counters.trades = (g.counters.trades ?? 0) + 1;
    if (kind === 'alliance') g.counters.alliances = (g.counters.alliances ?? 0) + 1;
  }
  computeAll(g);
  if (before) {
    celebrate({
      kind, partner: other,
      rateBefore: before.rate, rateAfter: STATS[me].moneyRate,
      relBefore: before.rel, relAfter: g.rel[me][other],
      powerBefore: before.power, powerAfter: STATS[me].power + (kind === 'alliance' ? STATS[other].power : 0),
    });
  }
}

/** Предложение договора (боту). Возвращает текст результата. */
export function propose(g: GameState, a: number, b: number, kind: DiploKind): string {
  const err = diploError(g, a, b, kind);
  if (err) return err;
  if (sanctions(g, b, a)) return `${cname(g, b)} отказывается: она ввела против вас санкции`;
  if (willAccept(g, a, b, kind)) {
    sign(g, a, b, kind);
    return `${cname(g, b)} согласна: ${DIPLO_NAME[kind].toLowerCase()}`;
  }
  pair(g, a, b).cooldown = g.day + 30;
  addRel(g, a, b, -2);
  return `${cname(g, b)} отказывается (нужны отношения получше)`;
}

export function cancelTreaty(g: GameState, a: number, b: number, kind: DiploKind) {
  const p = pair(g, a, b);
  if (!p[kind]) return;
  p[kind] = false;
  addRel(g, a, b, kind === 'alliance' ? -25 : kind === 'pact' ? -15 : -8);
  if (kind === 'alliance') p.grudge = Math.max(p.grudge ?? 0, 20);
  if (involvesPlayer(g, a, b)) log(g, `📜 ${DIPLO_NAME[kind]} с ${cname(g, a === g.player ? b : a)} расторгнут`, 'info');
  else if (kind === 'alliance') news(g, `💔 Распался союз ${cname(g, a)} и ${cname(g, b)}`, 'info');
  computeAll(g);
}

export const giftCost = (g: GameState, b: number) => Math.max(1000, g.countries[b].lastGross * 120);
export function gift(g: GameState, a: number, b: number): string {
  const cost = giftCost(g, b);
  const c = g.countries[a];
  if (c.money < cost) return 'Не хватает денег';
  c.money -= cost;
  g.countries[b].money += cost;
  addRel(g, a, b, g.countries[b].personality === 'trader' ? 20 : 15);
  if (a === g.player) {
    g.counters.gifts = (g.counters.gifts ?? 0) + 1;
    sfx('coins');
  }
  return `${cname(g, b)} благодарит за подарок (+отношения)`;
}

export function demandTribute(g: GameState, a: number, b: number): string {
  const p = pair(g, a, b);
  if (p.cooldown && p.cooldown > g.day && a === g.player) return `Повторить можно через ${Math.ceil(p.cooldown - g.day)} дн.`;
  p.cooldown = g.day + 60;
  const ratio = STATS[a].power / Math.max(1, STATS[b].power);
  const target = g.countries[b];
  if (ratio >= 2 && target.money > 0) {
    const amount = target.money * 0.2;
    target.money -= amount;
    g.countries[a].money += amount;
    addRel(g, a, b, -30);
    if (a === g.player) sfx('coins');
    else if (b !== g.player) news(g, `💰 ${cname(g, b)} платит дань стране ${cname(g, a)}`, 'info');
    return `${cname(g, b)} платит дань: +${fmtK(amount)} 💰`;
  }
  addRel(g, a, b, -15);
  if (target.personality === 'aggressor' && !warError(g, b, a) && !fearsUN(g, b, a) && rand(g) < 0.4) {
    declareWar(g, b, a);
    return `${cname(g, b)} в ярости и объявляет войну!`;
  }
  return `${cname(g, b)} отказывается платить`;
}

/** Согласится ли бот b на мир с a. */
export function peaceScore(g: GameState, a: number, b: number) {
  const p = peekPair(g, a, b);
  if (!p.war) return 0;
  const cb = g.countries[b];
  const ratio = STATS[a].power / Math.max(1, STATS[b].power);
  const startB = a < b ? p.war.bRegions : p.war.aRegions;
  const delta = STATS[b].regions.length - startB; // <0 — потеряла, >0 — захватила
  let s = cb.weariness / 100 + (ratio - 1) * 0.35 + (delta < 0 ? -delta * 0.12 : delta * 0.15) + (g.day - p.war.since) / 1500;
  if (cb.personality === 'aggressor') s -= 0.25;
  if (cb.personality === 'cautious') s += 0.2;
  return s;
}
/** Условия мира от бота b: 0 — даром, число — выкуп в 💰, null — мира не будет. */
export function peaceTerms(g: GameState, a: number, b: number): number | null {
  if (peekPair(g, a, b).war?.un === a) return null; // коалиция ООН не даёт агрессору сепаратного мира
  const sc = peaceScore(g, a, b);
  if (sc > 0.35) return 0;
  if (sc < -0.3) return null;
  return Math.max(1000, Math.max(30, g.countries[a].lastGross) * 400 * (0.35 - sc));
}
export function proposePeace(g: GameState, a: number, b: number, pay = false): string {
  if (!atWar(g, a, b)) return 'Войны нет';
  const t = peaceTerms(g, a, b);
  if (t === 0) {
    makePeace(g, a, b);
    return `${cname(g, b)} принимает мир`;
  }
  if (t === null) return `${cname(g, b)} отказывается от мира`;
  if (!pay) return `${cname(g, b)} согласна на мир за ${fmtK(t)} 💰`;
  if (g.countries[a].money < t) return 'Не хватает денег на выкуп';
  g.countries[a].money -= t;
  g.countries[b].money += t;
  makePeace(g, a, b);
  return `Мир куплен за ${fmtK(t)} 💰`;
}

/** Цели для атаки или присоединения, доступные стране. */
export function reachableTargets(g: GameState, ci: number, onlyNeutral = false) {
  const out: { rid: number; owner: number; via: 'land' | 'sea' }[] = [];
  const seen = new Set<number>();
  for (const rid of STATS[ci].regions) {
    for (const nb of REGIONS[rid].neighbors) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      const o = g.regions[nb].owner;
      if (o === ci) continue;
      if (onlyNeutral ? o === -1 : o === -1 || atWar(g, ci, o)) out.push({ rid: nb, owner: o, via: 'land' });
    }
  }
  if (hasPort(g, ci)) {
    g.regions.forEach((r, rid) => {
      if (seen.has(rid) || r.owner === ci || !seaReach(ci, rid)) return;
      if (onlyNeutral ? r.owner === -1 : r.owner === -1 || atWar(g, ci, r.owner)) out.push({ rid, owner: r.owner, via: 'sea' });
    });
  }
  return out;
}

export const tileRowCol = (t: number) => [Math.floor(t / COLS), t % COLS];
