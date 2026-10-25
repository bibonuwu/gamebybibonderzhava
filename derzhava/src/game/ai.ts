// Поведение ботов: оценка угроз, экономика, наука, армия, война, дипломатия и предложения игроку,
// а ещё — рынок (еда, оружие, учёные), компании и ответы своему народу.
import {
  addRel, alliesOf, annex, annexCost, armyLimit, atWar, availableTechs, BATTLE_LOCK, battleChance, battleNeed, bestTileFor, buildCost,
  builderCost, builderError, cancelTreaty, cname, declareWar, demandTribute, disband, enemiesOf, fundamentalCost, gift, giftCost,
  launchAttack, makePeace, neighborCountries, peaceScore, peekPair, PLAYER_GRACE, propose, reachableTargets, recruit, recruitCost,
  reinforce, research, researchFundamental, retreat, seaReach, sendGuard, sharedFoe, sign, soldiersFor, startBuild, startUpgrade,
  techCost, upgradeBuilders, upgradeError, warError, willAccept, type DiploKind,
} from './actions';
import {
  BUILDINGS, BUILDING_TYPES, COST_GROWTH, DIFFICULTY, GOVS, LEVEL_EFFECT, PERSONALITIES, WAR_GRACE_DAYS,
} from './defs';
import { difficultyMult, PORT_TILES, regionWeight, STATS } from './economy';
import { fmt } from './format';
import { buyArms, buyQuote, maxBuy, sellArms } from './market';
import { botDebt } from './debt';
import { brothers } from './lodge';
import { orderBrothers } from './order';
import { aiNuclear, BOMB_TECH, isNuclear } from './nuclear';
import { botPeople } from './people';
import { botProxy, botRebels } from './rebels';
import {
  buyCompany, buyCompanyError, companyPrice, foundCompany, foundCost, foundError, geniusError, geniusPrice, grantCost, grantError,
  hireGenius, hireScientists, inviteInvestors, investorsCost, investorsError, richTax, richTaxError, sciGrant, sciPrice,
} from './society';
import { allBuildings, log, news, pick, rand, sfx } from './state';
import type { BudgetKey, BuildingType, Company, GameState, Genius, GovType, Proposal, ReligionPolicy, Sector } from './types';
import { botSpy } from './spy';
import { fearsUN, sanctions, victimsOf } from './un';
import { rivals, startWonder, WONDERS, wonderCost, wonderError, wonderInRegion } from './wonders';
import { REGIONS, REGION_OF } from './world';

const BRANCH_PREF: Record<string, string[]> = {
  aggressor: ['Армия', 'Экономика', 'Атом'],
  trader: ['Торговля', 'Экономика'],
  scientist: ['Наука', 'Медицина', 'Атом'],
  fanatic: ['Культура', 'Армия'],
  cautious: ['Армия', 'Сельское хозяйство', 'Медицина'],
};

/** Доля продуманных решений: лёгкие боты чаще действуют наугад. */
const SKILL = { easy: 0.5, normal: 0.8, hard: 1 };
/** Сколько дней бот ждёт между атаками на игрока. */
const PLAYER_ATTACK_GAP = { easy: 45, normal: 30, hard: 20 };
/** Сколько регионов игрока бот хочет отнять, прежде чем согласиться на мир. */
const PLAYER_WAR_GOAL = { easy: 2, normal: 3, hard: 4 };
const smart = (g: GameState) => rand(g) < SKILL[g.difficulty];

export interface Threat {
  enemies: number[];
  enemyPower: number; // суммарная мощь противников
  danger: number; // мощь, от которой стоит иметь защиту
  underAttack: boolean;
}

export function aiTurn(g: GameState, i: number) {
  reform(g, i);
  const th = assessThreat(g, i);
  manageTaxes(g, i, th);
  manageBudget(g, i, th);
  doResearch(g, i, th);
  manageArmy(g, i, th);
  manageArms(g, i, th);
  manageFood(g, i, th);
  doConstruction(g, i, th);
  doWonders(g, i, th);
  aiNuclear(g, i, th);
  if ((Math.floor(g.day / 4) + i) % 3 === 0) {
    manageScience(g, i, th);
    manageCorporations(g, i, th);
  }
  expandPeacefully(g, i, th);
  manageBattles(g, i);
  wageWar(g, i, th);
  seekPeace(g, i, th);
  considerWar(g, i, th);
  if ((Math.floor(g.day / 4) + i) % 5 === 0) aiDiplomacy(g, i, th);
  botPeople(g, i, smart(g));
  botDebt(g, i);
  botSpy(g, i);
  botRebels(g, i);
  botProxy(g, i);
}

// ---------- оценка обстановки ----------
export function assessThreat(g: GameState, i: number): Threat {
  const enemies = enemiesOf(g, i);
  let enemyPower = 0;
  for (const e of enemies) enemyPower += STATS[e].power;
  let danger = enemyPower;
  for (const j of neighborCountries(g, i)) {
    if (atWar(g, i, j)) continue;
    const p = peekPair(g, i, j);
    if (p.alliance) continue;
    const rel = g.rel[i][j];
    let k = rel < -40 ? 0.9 : rel < 0 ? 0.6 : rel < 30 ? 0.35 : 0.15;
    if (p.pact) k *= 0.5;
    danger = Math.max(danger, enemyPower + STATS[j].power * k);
  }
  // разведка видит чужую мобилизацию против нас
  g.countries.forEach((c, j) => {
    if (c.alive && c.aiFlags.prepTarget === i) danger = Math.max(danger, enemyPower + STATS[j].power);
  });
  return { enemies, enemyPower, danger, underAttack: g.battles.some((b) => b.def === i) };
}

/** Самая сильная страна мира, если она заметно оторвалась от остальных (-1 — такой нет). */
function worldLeader(g: GameState): number {
  let a = -1, b = -1;
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    if (a < 0 || STATS[i].power > STATS[a].power) { b = a; a = i; }
    else if (b < 0 || STATS[i].power > STATS[b].power) b = i;
  });
  return a >= 0 && b >= 0 && STATS[a].power > STATS[b].power * 1.8 ? a : -1;
}

// ---------- внутренняя политика ----------
function reform(g: GameState, i: number) {
  const c = g.countries[i];
  if (c.aiFlags.reformed || g.day <= 30) return;
  c.aiFlags.reformed = true;
  const r = rand(g);
  let religion: ReligionPolicy | null = null;
  let gov: GovType | null = null;
  if (c.personality === 'fanatic') religion = r < 0.6 ? 'theocracy' : 'state';
  if (c.personality === 'scientist' && r < 0.6) religion = 'secular';
  if (c.personality === 'aggressor' && r < 0.3) gov = 'dictatorship';
  if (c.personality === 'cautious' && r < 0.3) religion = 'state';
  if (religion) c.religion = religion;
  if (gov) c.gov = gov;
}

function manageTaxes(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const s = STATS[i];
  const want = PERSONALITIES[c.personality].tax + (th.enemies.length ? 0.04 : 0) + (c.money < 0 ? 0.03 : 0);
  // смотрим, куда стабильность придёт, а не где она сейчас
  if (c.stability < 30 || s.stabTarget < 40) c.tax = Math.max(0.05, c.tax - 0.02);
  else if (s.stabTarget > 60 && c.tax < want) c.tax = Math.min(want, c.tax + 0.01);
  else if (c.tax > want + 0.02 || (s.stabTarget < 50 && c.tax > 0.12)) c.tax = Math.max(0.05, c.tax - 0.01);
}

function manageBudget(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const s = STATS[i];
  const war = th.enemies.length > 0;
  if (s.moneyRate < 0) {
    const order: BudgetKey[] = war ? ['infra', 'edu', 'health', 'military'] : ['military', 'infra', 'edu', 'health'];
    const k = order.find((x) => c.budget[x] > 1);
    if (k) c.budget[k]--;
    else if (!war && c.soldiers > s.civPop * PERSONALITIES[c.personality].armyRatio) disband(g, i, c.soldiers * 0.05);
    return;
  }
  if (c.money < s.taxIncome * 300) return;
  let want: BudgetKey =
    c.personality === 'scientist' ? 'edu' : c.personality === 'trader' ? 'infra' : c.personality === 'aggressor' ? 'military' : 'health';
  if (war || th.danger > s.power * 1.2) want = 'military';
  else if (c.stability < 50) want = 'health';
  if (c.budget[want] < 3) c.budget[want]++;
  else {
    const k = (['infra', 'edu', 'health'] as BudgetKey[]).find((x) => c.budget[x] < 2);
    if (k) c.budget[k]++;
  }
}

function doResearch(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const s = STATS[i];
  const avail = availableTechs(g, i);
  if (!avail.length) {
    if (c.brains >= fundamentalCost(g, i)) researchFundamental(g, i);
    return;
  }
  const prefs = BRANCH_PREF[c.personality] ?? [];
  const careful = smart(g);
  let best = avail[0], bestScore = -Infinity;
  for (const t of avail) {
    let sc = prefs.includes(t.branch) ? 3 : 1;
    if (careful) {
      // технологии, открывающие уровни зданий, которых у нас много
      for (const bt of BUILDING_TYPES) if (BUILDINGS[bt].techFor.includes(t.id)) sc += Math.min(3, s.counts[bt] * 0.25);
      if (t.mods.prod || t.mods.factory || t.mods.slots) sc += 1.5;
      if ((th.enemies.length || th.danger > s.power) && (t.mods.weapons || t.mods.defense)) sc += 2.5;
      if (c.stability < 45 && t.mods.stab) sc += 2;
      if (t.id === BOMB_TECH && th.danger > s.power) sc += 2;
    } else sc *= 0.5 + rand(g);
    sc /= Math.sqrt(t.tier);
    if (sc > bestScore) { bestScore = sc; best = t; }
  }
  if (c.brains >= techCost(g, i, best.id)) research(g, i, best.id);
}

// ---------- армия ----------
// Защита — это не паритет: обороне помогают рельеф и крепости, а нападающему нужен перевес.
const DETERRENCE: Record<string, number> = { aggressor: 1, fanatic: 0.9, cautious: 0.9, trader: 0.6, scientist: 0.6 };

function manageArmy(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const s = STATS[i];
  const prep = c.aiFlags.prepTarget;
  const war = th.enemies.length > 0 || prep !== undefined; // в подготовке к войне армию набирают как в войну
  const perSoldier = Math.max(1e-9, (s.weapons * s.morale * s.quality * difficultyMult(g, i)) / 1000);
  // столько, чтобы отпугнуть опасного соседа, и не меньше обычной доли для характера
  let target = Math.max(s.civPop * PERSONALITIES[c.personality].armyRatio, (th.danger * (DETERRENCE[c.personality] ?? 1)) / perSoldier);
  if (war) target = Math.max(target, ((th.enemyPower + (prep !== undefined ? STATS[prep].power : 0)) * 1.2) / perSoldier);
  // но не больше, чем казна потянет на содержание: в мирное время армия не должна съедать стройку
  const upkeepPer = 0.0001 * c.baseProd * (c.armyType === 'contract' ? 1.5 : 0.6) * s.barracksMult * GOVS[c.gov].armyUpkeep;
  const affordable = (s.taxIncome * (war ? 0.5 : 0.2) + s.factoryIncome * (war ? 0.3 : 0.12)) / Math.max(1e-9, upkeepPer);
  target = Math.min(target, affordable, armyLimit(g, i) * 0.95);
  if (c.soldiers < target) {
    if (!war && s.moneyRate <= 0) return;
    const pace = th.underAttack ? 0.006 : war ? 0.004 : 0.002;
    let n = Math.min(target - c.soldiers, s.civPop * pace);
    const peaceShare = c.personality === 'aggressor' ? 0.25 : 0.15;
    const budget = c.money * (th.underAttack ? 0.7 : war ? 0.45 : peaceShare);
    const cost = recruitCost(g, i, n);
    if (cost > budget) n *= budget / Math.max(1e-9, cost);
    if (n > Math.max(100, s.civPop * 0.0002)) recruit(g, i, n);
  } else if (!war && c.soldiers > target * 1.25 && s.moneyRate < s.taxIncome * 0.1) {
    disband(g, i, (c.soldiers - target) * 0.2);
  }
}

// ---------- стройка ----------
function buildWeights(g: GameState, i: number, th: Threat): Partial<Record<BuildingType, number>> {
  const c = g.countries[i];
  const s = STATS[i];
  const w: Partial<Record<BuildingType, number>> = { ...PERSONALITIES[c.personality].build };
  if (c.stability < 50) w.temple = (w.temple ?? 1) * 3;
  if (th.enemies.length || th.danger > s.power) {
    w.fortress = (w.fortress ?? 1) + 2;
    w.barracks = (w.barracks ?? 1) + 1.5;
  }
  if (s.popCap > 0 && s.civPop / s.popCap > 0.85) w.farm = (w.farm ?? 1) + 2.5;
  if (s.growthYear < 0.3) w.hospital = (w.hospital ?? 1) + 1;
  // бедная казна — в первую очередь то, что приносит деньги
  if (s.moneyRate < s.taxIncome * 0.15) {
    w.factory = (w.factory ?? 1) * 2.5;
    if (w.port) w.port *= 1.5;
  }
  // окупаемость завода падает с каждым новым (цена растёт)
  const payback = (150 * Math.pow(COST_GROWTH, s.counts.factory)) / Math.max(0.3, s.mods.factory);
  if (payback > 900 && w.factory) w.factory *= 0.4;
  return w;
}

function weightedPick(g: GameState, w: Partial<Record<BuildingType, number>>): BuildingType | null {
  const total = BUILDING_TYPES.reduce((a, t) => a + (w[t] ?? 0), 0);
  if (total <= 0) return null;
  let roll = rand(g) * total;
  for (const t of BUILDING_TYPES) {
    roll -= w[t] ?? 0;
    if (roll <= 0) return t;
  }
  return null;
}

/** Новое здание или улучшение старого — что дешевле за единицу эффекта (с содержанием за год). */
export function bestBuildOption(g: GameState, i: number, type: BuildingType, careful: boolean) {
  const c = g.countries[i];
  const upkeepK = BUILDINGS[type].upkeep * c.baseProd * 365;
  let best: { tile: number; cost: number; upgrade: boolean } | null = null;
  let bestPer = Infinity;
  const tile = bestTileFor(g, i, type);
  if (tile >= 0) {
    const w = regionWeight(g.regions[REGION_OF[tile]].pop);
    const cost = buildCost(g, i, type, 1, REGION_OF[tile]);
    bestPer = (cost + upkeepK * w) / w;
    best = { tile, cost, upgrade: false };
  }
  if (!careful && best) return best;
  const { tiles, list } = allBuildings(g);
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k];
    const b = list[k];
    if (b.type !== type || g.regions[REGION_OF[t]].owner !== i || upgradeError(g, i, t)) continue;
    const rid = REGION_OF[t];
    const w = regionWeight(g.regions[rid].pop);
    const cost = buildCost(g, i, type, b.level + 1, rid);
    const per = (cost + upkeepK * w) / ((LEVEL_EFFECT[b.level + 1] - LEVEL_EFFECT[b.level]) * w);
    if (per < bestPer) {
      bestPer = per;
      best = { tile: t, cost, upgrade: true };
    }
  }
  return best;
}

function doConstruction(g: GameState, i: number, th: Threat) {
  // все площадки заняты, а денег с запасом — нанимаем строителей получше
  if (STATS[i].constructing >= STATS[i].slots && !th.enemies.length && !builderError(g, i)
    && g.countries[i].money > builderCost(g, i) * 4 && rand(g) < 0.1) upgradeBuilders(g, i);
  for (let k = 0; k < 2; k++) {
    const c = g.countries[i];
    const s = STATS[i];
    if (s.constructing >= s.slots || c.money <= 0) return;
    const budget = c.money * (th.enemies.length ? 0.3 : 0.55);
    const type = weightedPick(g, buildWeights(g, i, th));
    if (!type) return;
    const opt = bestBuildOption(g, i, type, smart(g));
    if (!opt || opt.cost > budget) return;
    if (opt.upgrade) startUpgrade(g, i, opt.tile);
    else startBuild(g, i, opt.tile, type);
  }
}

function doWonders(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  if (c.project || th.enemies.length || rand(g) > 0.15) return;
  let best: string | null = null, bestScore = 0;
  for (const w of WONDERS) {
    if (wonderError(g, i, w.id)) continue;
    if (c.money < wonderCost(g, i, w.id).money * 1.6) continue; // держим запас
    const lead = rivals(g, i, w.id)[0];
    if (lead && lead.pct > 0.3) continue; // не догнать
    const sc = (w.pref.includes(c.personality) ? 2 : 1) * (0.5 + rand(g));
    if (sc > bestScore) { bestScore = sc; best = w.id; }
  }
  if (best) startWonder(g, i, best);
}

// ---------- расширение и война ----------
function expandPeacefully(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const gap = c.personality === 'trader' || c.personality === 'scientist' ? 45 : 60;
  if (th.underAttack || g.day - (c.aiFlags.lastAnnex ?? -999) <= gap) return;
  if (c.personality === 'aggressor' && rand(g) > 0.4) return;
  let best = -1, bestV = Infinity;
  for (const t of reachableTargets(g, i, true)) {
    const v = annexCost(g, i, t.rid) / Math.max(1, g.regions[t.rid].pop + REGIONS[t.rid].tiles.length * 20000);
    if (v < bestV) { bestV = v; best = t.rid; }
  }
  if (best >= 0 && annexCost(g, i, best) <= c.money * 0.5 && !annex(g, i, best)) c.aiFlags.lastAnnex = g.day;
}

/** Захват нейтральных земель силой (агрессоры и фанатики). */
function grabNeutral(g: GameState, i: number) {
  const c = g.countries[i];
  if ((c.personality !== 'aggressor' && c.personality !== 'fanatic') || g.day <= 60) return;
  if (g.battles.some((b) => b.att === i)) return;
  const options = reachableTargets(g, i, true).filter((t) => t.via === 'land' && !g.battles.some((b) => b.region === t.rid));
  if (!options.length) return;
  let best = -1, bestV = 0, bestNeed = 0;
  for (const t of smart(g) ? options : [pick(g, options)]) {
    const need = soldiersFor(g, i, t.rid, 0.8);
    const v = (g.regions[t.rid].pop + REGIONS[t.rid].tiles.length * 20000) / Math.max(1, need);
    if (need < c.soldiers * 0.35 && v > bestV) { bestV = v; best = t.rid; bestNeed = need; }
  }
  if (best >= 0 && rand(g) < 0.4 * DIFFICULTY[g.difficulty].aggression && !launchAttack(g, i, best, bestNeed * 1.15)) {
    c.aiFlags.nextAttack = g.day + 40;
  }
}

/** Идущие бои: проигрываем наступление — подкрепление или отход, теряем регион — резервы туда (раз за бой). */
function manageBattles(g: GameState, i: number) {
  const c = g.countries[i];
  for (const bt of g.battles) {
    if (bt.end - g.day < BATTLE_LOCK || (bt.att !== i && bt.def !== i)) continue;
    if (!smart(g)) continue;
    const p = battleChance(g, bt);
    if (bt.att === i) {
      if (p >= 0.45) continue;
      const need = battleNeed(g, bt, 'att', 0.65);
      if (need <= c.soldiers * 0.3) reinforce(g, i, bt.id, need);
      else if (p < 0.2) retreat(g, i, bt.id);
    } else if (!bt.guard && p > 0.55) {
      const need = battleNeed(g, bt, 'def', 0.35);
      if (need > 0) sendGuard(g, i, bt.id, Math.min(need, c.soldiers * 0.25));
    }
  }
}

function wageWar(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  if (g.day < (c.aiFlags.nextAttack ?? 0)) return;
  if (!th.enemies.length) return grabNeutral(g, i);
  const maxBattles = g.difficulty === 'hard' ? 3 : 2;
  if (g.battles.filter((b) => b.att === i).length >= maxBattles) return;
  // часть армии всегда остаётся дома
  const reserve = c.soldiers * (th.underAttack ? 0.45 : th.enemyPower > STATS[i].power ? 0.4 : 0.25);
  const avail = c.soldiers - reserve;
  const targets = reachableTargets(g, i).filter((t) => t.owner >= 0 && !g.battles.some((b) => b.region === t.rid));
  const careful = smart(g);
  let best: { rid: number; need: number; owner: number } | null = null;
  let bestV = 0;
  for (const t of targets) {
    const need = soldiersFor(g, i, t.rid, 0.75);
    if (need * 1.1 > avail) continue;
    let value = 1 + g.regions[t.rid].pop / 2e6 + REGIONS[t.rid].tiles.length * 0.02;
    if (careful) {
      if (g.countries[t.owner].capital === t.rid) value *= 2; // столица — удар по стабильности врага
      if (wonderInRegion(g, t.rid)) value *= 1.6; // чудо света перейдёт к нам
    } else value *= 0.5 + rand(g);
    const v = value / Math.max(1, need);
    if (v > bestV) { bestV = v; best = { rid: t.rid, need, owner: t.owner }; }
  }
  if (!best) return;
  const send = Math.min(avail, best.need * (1.25 + 0.15 * rand(g)));
  if (!launchAttack(g, i, best.rid, send)) {
    c.aiFlags.nextAttack = g.day + (best.owner === g.player ? PLAYER_ATTACK_GAP[g.difficulty] : 10);
  }
}

function seekPeace(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const s = STATS[i];
  for (const e of th.enemies) {
    const p = peekPair(g, i, e);
    if (!p.war) continue;
    const dur = g.day - p.war.since;
    if (dur < 30) continue;
    const start = i < e ? p.war.aRegions : p.war.bRegions;
    const gained = s.regions.length - start;
    let goal = c.personality === 'aggressor' ? 4 : 2;
    if (e === g.player) goal = Math.min(goal, PLAYER_WAR_GOAL[g.difficulty]);
    const losing = th.underAttack && STATS[e].power > s.power * 1.5;
    const broke = c.money < -s.taxIncome * 30;
    if (p.war.un !== undefined) {
      // коалиция ООН воюет, пока агрессор не помирится с жертвой; сепаратный мир — только если сами проигрываем
      if (p.war.un !== i && (losing || broke)) makePeace(g, i, e);
      continue;
    }
    // агрессор под санкциями и против коалиции ищет мира с жертвой быстрее
    const pressed = dur > 90 && victimsOf(g, i).includes(e) && (s.sanctions > 0.06 || th.enemies.length > 1);
    // peaceScore(e, i) — насколько мир нужен нам самим
    const want = peaceScore(g, e, i) > 0.35 || gained >= goal || losing || broke || pressed || dur > 400;
    if (!want) continue;
    if (e === g.player) {
      // победитель берёт контрибуцию
      const amount = gained > 0 ? Math.max(1000, g.countries[e].lastGross * 30 * gained) : undefined;
      offer(g, i, 'peace', amount);
    } else if (peaceScore(g, i, e) > 0.3) makePeace(g, i, e); // и противник должен согласиться
  }
}

const WAR_NEED: Record<string, [number, number]> = {
  // [нужный перевес сил, отношения не выше]
  aggressor: [1.25, 25],
  fanatic: [1.4, -5],
  trader: [2, -45],
  scientist: [2.2, -50],
  cautious: [2.4, -55],
};

/** Страны, до которых можно дотянуться: соседи по суше и побережья в зоне наших портов. */
function warCandidates(g: GameState, i: number): Set<number> {
  const out = neighborCountries(g, i);
  if ((PORT_TILES[i]?.length ?? 0) > 0) {
    g.regions.forEach((r, rid) => {
      if (r.owner >= 0 && r.owner !== i && !out.has(r.owner) && seaReach(i, rid)) out.add(r.owner);
    });
  }
  return out;
}

/** Насколько выгодно напасть на j (0 — не стоит). recheck — проверка «всё ещё по силам» после подготовки:
 *  боту-цели прощается небольшая разница, игроку — нет (он успел вооружиться, найти союзников или задобрить). */
function warScore(g: GameState, i: number, j: number, leader: number, breakPact: boolean, recheck = false): number {
  const c = g.countries[i];
  if (warError(g, i, j)) return 0;
  const p = peekPair(g, i, j);
  if (p.pact && !breakPact) return 0;
  // занятый другой войной противник слабее
  const busy = enemiesOf(g, j).length;
  // на лёгкой и средней не добиваем игрока толпой (если он не мировой лидер)
  if (j === g.player && busy > 0 && j !== leader && g.difficulty !== 'hard') return 0;
  const helpers = alliesOf(g, j).filter((k) => !atWar(g, k, i)).reduce((a, k) => a + STATS[k].power * 0.5, 0);
  const defPower = (STATS[j].power + helpers) / (1 + busy * 0.4);
  let ratio = STATS[i].power / Math.max(1, defPower);
  if (j === g.player && g.difficulty === 'easy') ratio /= 1.3;
  // ядерное сдерживание: на ядерную державу нападают неохотно
  if (isNuclear(g, j)) ratio /= isNuclear(g, i) ? 1.4 : 2.5;
  const rel = g.rel[i][j];
  if ((brothers(g, i, j) || orderBrothers(g, i, j)) && rel > -60) return 0; // брат на брата не идёт
  let [need, relMax] = WAR_NEED[c.personality] ?? [2, -50];
  if (c.personality === 'fanatic' && g.countries[j].religion === c.religion) relMax = -40;
  if (j === leader && busy > 0) {
    // коалиция против лидера, который уже воюет
    need *= 0.6;
    relMax += 30;
  } else if (busy > 0) need *= 0.85;
  const slack = recheck && j !== g.player ? 0.9 : 1;
  const relSlack = recheck ? (j === g.player ? 5 : 15) : 0;
  if (ratio < need * slack || rel > relMax + relSlack) return 0;
  return ratio * (1 + Math.max(0, -rel) / 100) * (j === leader ? 1.5 : 1);
}

function considerWar(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const prep = c.aiFlags.prepTarget;
  if (prep !== undefined) {
    if (g.day < (c.aiFlags.prepUntil ?? 0) && !th.enemies.length) return;
    delete c.aiFlags.prepTarget;
    delete c.aiFlags.prepUntil;
    // подготовка окончена: нападаем, если цель всё ещё по силам (игрок мог успеть вооружиться или найти союзников)
    const leader = worldLeader(g);
    if (!th.enemies.length && g.countries[prep].alive && warScore(g, i, prep, leader, true, true) > 0) {
      if (prep === leader && enemiesOf(g, prep).length) news(g, `🤜 ${cname(g, i)} присоединяется к коалиции против страны ${cname(g, prep)}`, 'war');
      declareWar(g, i, prep);
    } else if (prep === g.player) log(g, `🕵️ Разведка: ${cname(g, i)} отказалась от планов нападения на нас`, 'good');
    return;
  }
  if (g.day < WAR_GRACE_DAYS || th.enemies.length) return;
  if (g.day - (c.aiFlags.lastWarDay ?? -999) <= (c.personality === 'aggressor' ? 365 : 540)) return;
  if (c.weariness > 25 || c.stability < 35 || c.money < 0) return;
  const leader = worldLeader(g);
  let best = -1, bestScore = 0;
  for (const j of warCandidates(g, i)) {
    const sc = warScore(g, i, j, leader, c.personality === 'aggressor' && rand(g) < 0.1);
    if (sc > bestScore) { bestScore = sc; best = j; }
  }
  if (best >= 0 && rand(g) < 0.35 * DIFFICULTY[g.difficulty].aggression) {
    // ООН ополчит против агрессора весь мир: передумав, к мыслям о войне вернётся не скоро
    if (fearsUN(g, i, best)) {
      c.aiFlags.lastWarDay = g.day;
      return;
    }
    // сначала подготовка: закупка оружия, запасы еды, мобилизация
    c.aiFlags.prepTarget = best;
    c.aiFlags.prepUntil = g.day + (best === g.player ? 25 : 15);
    if (best === g.player) {
      sfx('alarm');
      log(g, `🕵️ Разведка: ${cname(g, i)} скупает оружие и стягивает войска к нашим границам! Нападение возможно через ~25 дней`, 'war');
    } else if (rand(g) < 0.4) news(g, `🪖 ${cname(g, i)} объявила мобилизацию`, 'war');
  }
}

// ---------- рынок ----------
/** Оружие: к войне — с запасом, в мирное время излишки продаём тем, кто воюет. */
function manageArms(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const s = STATS[i];
  const m = g.market.arms;
  const troops = c.soldiers + s.deployed;
  if (troops < 100) return;
  const prep = c.aiFlags.prepTarget !== undefined;
  const war = th.enemies.length > 0;
  const want = war ? 1.5 : prep ? 1.4 : th.danger > s.power ? 1.2 : c.personality === 'aggressor' ? 1.1 : 1;
  if (want > s.equip + 0.05 && c.money > 0) {
    // дорогое оружие покупаем только перед войной или в войну
    if (!war && !prep && m.price > m.base * 1.8) return;
    const share = th.underAttack ? 0.5 : war ? 0.35 : prep ? 0.4 : 0.12;
    let qty = Math.min((want - s.equip) * troops, maxBuy(m) * 0.3);
    const budget = c.money * share;
    const cost = buyQuote(m, qty);
    if (cost > budget) qty *= budget / Math.max(1e-9, cost);
    if (qty > troops * 0.02) buyArms(g, i, qty);
  } else if (!war && !prep && s.equip > want + 0.35 && smart(g)) {
    if (m.price > m.base * 1.2 || c.money < s.taxIncome * 60 || c.personality === 'trader') sellArms(g, i, (s.equip - want - 0.2) * troops * 0.5);
  }
}

/** Еда: запас по характеру и обстановке; умный бот продаёт, когда дорого, и закупает впрок, когда дёшево. */
function manageFood(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const s = STATS[i];
  const m = g.market.food;
  c.foodAuto = true;
  let days = c.personality === 'cautious' ? 150 : 90;
  if (th.enemies.length || c.aiFlags.prepTarget !== undefined) days += 60;
  if (smart(g)) {
    if (m.price > m.base * 1.6 && s.foodProd > s.foodCons) days = Math.max(30, days - 60);
    else if (m.price < m.base * 0.75 && c.money > s.taxIncome * 200) days += 60;
  }
  c.foodReserve = days;
}

/** Учёные: звёзды науки под свои нужды, учёные из-за рубежа, гранты. */
function manageScience(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const s = STATS[i];
  if (th.enemies.length || c.money < s.taxIncome * 150 || !smart(g)) return;
  const sciBot = c.personality === 'scientist';
  let best: Genius | null = null, bestV = 0;
  for (const gen of g.geniuses) {
    if (gen.employer >= 0 || geniusError(g, i, gen)) continue;
    if (c.money < geniusPrice(g, i, gen) * (sciBot ? 1.5 : 2.5)) continue;
    let v = gen.level * (sciBot ? 1.5 : 1);
    if (gen.field === 'military' && (c.personality === 'aggressor' || th.danger > s.power)) v *= 1.8;
    if (gen.field === 'agro' && s.foodProd < s.foodCons) v *= 1.8;
    if (gen.field === 'medicine' && s.growthYear < 0.3) v *= 1.5;
    if ((gen.field === 'econ' || gen.field === 'it') && c.personality === 'trader') v *= 1.5;
    if (gen.field === 'physics' && sciBot) v *= 1.5;
    if (v > bestV) { bestV = v; best = gen; }
  }
  if (best && rand(g) < 0.5) hireGenius(g, i, best.id);
  if ((sciBot || c.money > s.taxIncome * 500) && g.market.sciPool > 100 && rand(g) < 0.25) {
    const n = Math.min(g.market.sciPool * 0.3, c.scientists * 0.03 + 100);
    if (n * sciPrice(g, i) < c.money * 0.1) hireScientists(g, i, n);
  }
  if ((sciBot || c.scientists < s.sciTarget * 0.85) && c.money > grantCost(g, i) * 4 && !grantError(g, i) && rand(g) < 0.2) sciGrant(g, i);
}

/** Компании и миллиардеры: госкорпорации там, где нужнее, покупка чужих компаний, налог на богатых в кризис. */
function manageCorporations(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const s = STATS[i];
  if (c.money < -s.taxIncome * 20 && c.billionaires >= 3 && !richTaxError(g, i)) {
    richTax(g, i);
    return;
  }
  if (th.enemies.length || !smart(g) || rand(g) > 0.3) return;
  const states = g.companies.filter((co) => co.state && g.regions[co.hq].owner === i).length;
  if (c.money > foundCost(g, i) * 3 && g.day - (c.aiFlags.lastCompany ?? -999) > 300 && states < 2 + s.companies * 0.3) {
    const need: Sector[] = [];
    if (s.foodProd < s.foodCons * 0.95) need.push('agro');
    if (c.aiFlags.prepTarget !== undefined || c.personality === 'aggressor') need.push('defense');
    if (c.personality === 'scientist') need.push('tech');
    if (c.personality === 'trader') need.push('finance');
    need.push('energy', 'industry', 'pharma', 'tech');
    const sector = need.find((k) => !foundError(g, i, k));
    if (sector) {
      foundCompany(g, i, sector);
      return;
    }
  }
  if ((c.personality === 'trader' || c.money > s.taxIncome * 800) && g.day - (c.aiFlags.lastCompany ?? -999) > 200) {
    let best: Company | null = null;
    for (const co of g.companies) {
      if (buyCompanyError(g, i, co) || c.money < companyPrice(co) * 3) continue;
      if (!best || co.value > best.value) best = co;
    }
    if (best && rand(g) < 0.3) {
      buyCompany(g, i, best.id);
      c.aiFlags.lastCompany = g.day;
      return;
    }
  }
  if (c.personality === 'trader' && c.money > investorsCost(g, i) * 5 && !investorsError(g, i) && rand(g) < 0.2) inviteInvestors(g, i);
}

// ---------- дипломатия ----------
function aiDiplomacy(g: GameState, i: number, th: Threat) {
  const c = g.countries[i];
  const s = STATS[i];
  const neighbors = neighborCountries(g, i);
  const others = g.countries.filter((o, j) => o.alive && j !== i && !atWar(g, i, j)).map((o) => o.idx);
  if (!others.length) return;

  // самый полезный договор: союз против общего врага, пакт с сильным соседом, торговля с богатым другом
  const careful = smart(g);
  let bestJ = -1, bestKind: DiploKind | null = null, bestScore = 0;
  for (const j of careful ? others : [pick(g, others)]) {
    const p = peekPair(g, i, j);
    for (const kind of ['trade', 'pact', 'alliance'] as DiploKind[]) {
      if (p[kind] || !willAccept(g, j, i, kind)) continue; // сам бот хочет?
      let sc = 0.5 + g.rel[i][j] / 100;
      if (kind === 'trade') sc += 0.6 + (c.personality === 'trader' ? 0.5 : 0) + Math.min(1, STATS[j].taxIncome / Math.max(1, s.taxIncome) / 3);
      if (kind === 'pact') sc += neighbors.has(j) && STATS[j].power > s.power * 0.7 ? 1.2 : 0.2;
      if (kind === 'alliance') sc += sharedFoe(g, i, j) >= 0 ? 1.6 : 0.3;
      if (sc > bestScore) { bestScore = sc; bestJ = j; bestKind = kind; }
    }
  }
  if (bestJ >= 0 && bestKind) {
    if (bestJ === g.player) offer(g, i, bestKind);
    else if (willAccept(g, i, bestJ, bestKind)) propose(g, i, bestJ, bestKind);
  }

  // под угрозой — задабриваем сильного соседа-кандидата в союзники
  if (th.danger > s.power * 1.2 && c.money > s.taxIncome * 250) {
    const cand = others.filter((j) => j !== g.player && !peekPair(g, i, j).alliance && g.rel[i][j] > 15 && g.rel[i][j] < 50 && STATS[j].power > s.power * 0.5);
    if (cand.length) {
      const j = cand.reduce((a, b) => (STATS[b].power > STATS[a].power ? b : a));
      if (giftCost(g, j) < c.money * 0.3) gift(g, i, j);
    }
  }

  // разрываем союз с тем, кого теперь ненавидим
  for (const ally of alliesOf(g, i)) {
    if (g.rel[i][ally] < -20 && ally !== g.player) cancelTreaty(g, i, ally, 'alliance');
  }

  // агрессор выжимает дань из слабых соседей-ботов (не чаще раза в полгода с каждого)
  if (c.personality === 'aggressor' && rand(g) < 0.25) {
    for (const j of neighbors) {
      if (j === g.player || atWar(g, i, j) || g.rel[i][j] >= 0) continue;
      const p = peekPair(g, i, j);
      if ((p.cooldown ?? 0) > g.day || s.power <= STATS[j].power * 2.5) continue;
      demandTribute(g, i, j);
      peekPair(g, i, j).cooldown = g.day + 180;
      break;
    }
  }

  const me = g.player;
  if (!g.countries[me].alive || atWar(g, i, me)) return;
  // дань с игрока
  if (c.personality === 'aggressor' && neighbors.has(me) && g.day >= PLAYER_GRACE[g.difficulty] && s.power > STATS[me].power * 2.5 && g.rel[i][me] < 0 && rand(g) < 0.3) {
    offer(g, i, 'tribute', g.countries[me].money * 0.15);
  }
  // подарок игроку от друга
  if ((c.personality === 'trader' || c.personality === 'cautious') && g.rel[i][me] > 40 && c.money > s.taxIncome * 400
    && g.day - (g.counters.lastGiftIn ?? -999) > 200 && rand(g) < 0.15) {
    const amount = Math.min(c.money * 0.08, Math.max(1000, g.countries[me].lastGross * 40));
    c.money -= amount;
    g.countries[me].money += amount;
    addRel(g, i, me, 5);
    g.counters.lastGiftIn = g.day;
    sfx('coins');
    log(g, `🎁 ${cname(g, i)} в знак дружбы прислала вам подарок: +${fmt(amount)} 💰`, 'good');
  }
}

/** Предложение бота → игроку (с ограничением частоты). */
export function offer(g: GameState, from: number, kind: Proposal['kind'], amount?: number) {
  const c = g.countries[from];
  if (g.proposals.length >= 3 || g.proposals.some((p) => p.from === from)) return;
  const lastAny = g.counters.lastProposal ?? -999;
  if (kind !== 'peace' && g.day - lastAny < 45) return;
  if (g.day - (c.aiFlags.lastProposalDay ?? -999) < 120 && kind !== 'peace') return;
  c.aiFlags.lastProposalDay = g.day;
  g.counters.lastProposal = g.day;
  g.proposals.push({ id: g.nextId++, from, kind, amount, expires: g.day + 60 });
  sfx('notify');
}

const PROPOSAL_TEXT: Record<Proposal['kind'], string[]> = {
  trade: [
    'предлагает торговый договор', 'хочет открыть свои рынки для наших товаров', 'зовёт подписать договор о свободной торговле',
    'предлагает обмениваться товарами без пошлин', 'приглашает наших купцов в свои порты',
  ],
  pact: [
    'предлагает пакт о ненападении', 'обещает никогда не нападать — если мы пообещаем то же', 'хочет закрепить мир на границе договором',
    'предлагает подписать «вечный мир» между нашими странами',
  ],
  alliance: [
    'предлагает военный союз', 'зовёт стоять плечом к плечу против любых врагов', 'предлагает объединить армии в союз',
    'хочет союза: «враг одного — враг обоих»',
  ],
  peace: [
    'предлагает заключить мир', 'просит перемирия: война всех измотала', 'присылает парламентёров с белым флагом',
    'предлагает сложить оружие и подписать мир',
  ],
  tribute: [
    'требует дань', 'грозит войной, если мы не заплатим', 'присылает ультиматум: платите — или ждите армию',
  ],
};
/** Как звучит предложение бота: у каждого — своя формулировка. */
export const proposalText = (p: Proposal) => PROPOSAL_TEXT[p.kind][p.id % PROPOSAL_TEXT[p.kind].length];

export function answerProposal(g: GameState, id: number, accept: boolean) {
  const pr = g.proposals.find((p) => p.id === id);
  if (!pr) return;
  g.proposals = g.proposals.filter((p) => p.id !== id);
  const me = g.player;
  const from = pr.from;
  if (!g.countries[from].alive) return;
  if (pr.kind === 'peace') {
    if (!accept || !atWar(g, me, from)) return;
    if (pr.amount) {
      const pay = Math.min(Math.max(0, g.countries[me].money), pr.amount);
      g.countries[me].money -= pay;
      g.countries[from].money += pay;
      log(g, `💰 Контрибуция выплачена: ${fmt(pay)} → ${cname(g, from)}`, 'info');
    }
    makePeace(g, me, from);
    return;
  }
  if (pr.kind === 'tribute') {
    if (accept) {
      const amount = Math.min(g.countries[me].money, pr.amount ?? 0);
      g.countries[me].money -= amount;
      g.countries[from].money += amount;
      addRel(g, me, from, 10);
      log(g, `💰 Дань выплачена: ${cname(g, from)}`, 'info');
    } else {
      addRel(g, me, from, -20);
      if (!warError(g, from, me) && !fearsUN(g, from, me) && rand(g) < 0.5) declareWar(g, from, me);
      else log(g, `${cname(g, from)} недовольна отказом`, 'info');
    }
    return;
  }
  if (accept) {
    if (peekPair(g, me, from)[pr.kind]) return;
    if (pr.kind === 'trade' && STATS[me].tradePartners >= 4 + (g.countries[me].techs.includes('global_logistics') ? 2 : 0) + (g.countries[me].techs.includes('auto_ports') ? 1 : 0)) {
      log(g, 'Нет свободных мест для торговых договоров', 'bad');
      return;
    }
    sign(g, me, from, pr.kind);
  } else {
    addRel(g, me, from, -5);
  }
}

export function expireProposals(g: GameState) {
  for (const p of g.proposals.filter((x) => x.expires <= g.day)) answerProposal(g, p.id, false);
}

/** Плавное изменение отношений между всеми странами. */
export function driftRelations(g: GameState) {
  const n = g.countries.length;
  const alive = g.countries.filter((c) => c.alive);
  const powers = alive.map((c) => STATS[c.idx].power).sort((a, b) => a - b);
  const median = powers[Math.floor(powers.length / 2)] || 1;
  const startRegions = new Array(n).fill(0);
  REGIONS.forEach((r) => { if (r.origOwner >= 0) startRegions[r.origOwner]++; });
  const threat = g.countries.map((c, i) => c.alive && (STATS[i].power > median * 4 || STATS[i].regions.length > startRegions[i] * 1.6 + 2));
  const borders = g.countries.map((c, i) => (c.alive ? neighborCountries(g, i) : new Set<number>()));
  const enemies = g.countries.map((c, i) => (c.alive ? enemiesOf(g, i) : []));
  const lodge = new Set(g.lodge.members);
  const banned = g.lodge.status === 'banned';
  const order = new Set(g.order ? [g.player, ...g.order.members] : []); // своя ложа игрока: мастер и братья
  for (let a = 0; a < n; a++) {
    const ca = g.countries[a];
    if (!ca.alive) continue;
    for (let b = a + 1; b < n; b++) {
      const cb = g.countries[b];
      if (!cb.alive) continue;
      let base = 0;
      if (ca.gov === cb.gov) base += 10;
      else if ((ca.gov === 'democracy' && cb.gov === 'dictatorship') || (cb.gov === 'democracy' && ca.gov === 'dictatorship')) base -= 12;
      if (ca.religion === cb.religion) base += 6;
      else if ((ca.religion === 'theocracy' && cb.religion === 'secular') || (cb.religion === 'theocracy' && ca.religion === 'secular')) base -= 10;
      const p = g.pairs[`${a}-${b}`];
      if (p) {
        if (p.trade) base += 15;
        if (p.alliance) base += 25;
        if (p.pact) base += 8;
        if (p.war) base -= 70;
        if (p.grudge) { base -= p.grudge; p.grudge *= 0.985; if (p.grudge < 1) delete p.grudge; }
      }
      if (sanctions(g, a, b) || sanctions(g, b, a)) base -= 20;
      // враг моего врага — мой друг
      if (enemies[a].some((k) => enemies[b].includes(k))) base += 12;
      if (borders[a].has(b)) base -= 6;
      // братья по ложе дружат, а запретившего ложу братья недолюбливают
      if ((lodge.has(a) && lodge.has(b)) || (order.has(a) && order.has(b))) base += 12;
      else if (banned && ((a === g.player && lodge.has(b)) || (b === g.player && lodge.has(a)))) base -= 10;
      for (const x of [ca, cb]) {
        if (x.personality === 'trader') base += 8;
        if (x.personality === 'aggressor') base -= 10;
      }
      if (ca.personality === 'fanatic' && ca.religion !== cb.religion) base -= 10;
      if (cb.personality === 'fanatic' && ca.religion !== cb.religion) base -= 10;
      if (threat[a]) base -= 15;
      if (threat[b]) base -= 15;
      g.rel[a][b] += (base - g.rel[a][b]) * 0.04;
      g.rel[b][a] = g.rel[a][b];
    }
  }
}

export const buildingName = (t: BuildingType) => BUILDINGS[t].name;
export const regionName = (rid: number) => REGIONS[rid].name;
