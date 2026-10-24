// Ядерная программа: сборка атомных боеголовок и термоядерных бомб, испытания, ракетный удар, ПРО, ответный удар,
// заражение и ядерная зима.
import { addRel, alliesOf, atWar, cname, peekPair, setRel } from './actions';
import { DIFFICULTY } from './defs';
import { computeAll, regionDefense, STATS } from './economy';
import { fmt } from './format';
import { fx, log, mapDirty, news, rand, removeBuilding, sfx } from './state';
import type { GameState, Missile } from './types';
import { wonderOwner } from './wonders';
import { REGIONS } from './world';

export const BOMB_TECH = 'nuclear_bomb';
export const THERMO_TECH = 'thermonuclear';
export const NUKE_DAYS = 40; // сборка одной атомной боеголовки
export const HBOMB_DAYS = 70; // сборка термоядерной бомбы
const HBOMB_COST = { money: 2.5, brains: 2 }; // термоядерная бомба дороже атомной во столько раз
export const FLIGHT_DAYS = 3; // подлёт ракеты
/** Атомная / термоядерная: доля погибших в регионе, шанс разрушения здания, потери гарнизона, дни заражения. */
export const BLAST = {
  atomic: { kill: 0.12, ruin: 0.5, garrison: 0.5, fallout: 300 },
  thermo: { kill: 0.3, ruin: 0.9, garrison: 0.85, fallout: 500 },
};
/** Термоядерный взрыв задевает и соседние регионы: доля погибших и дни заражения там. */
export const THERMO_SPILL = { kill: 0.04, fallout: 200 };
const WINTER_AT = 4; // после стольких взрывов в мире наступает ядерная зима

export const hasBomb = (g: GameState, ci: number) => g.countries[ci].techs.includes(BOMB_TECH);
export const isThermo = (g: GameState, ci: number) => g.countries[ci].techs.includes(THERMO_TECH);
export const nukesOf = (g: GameState, ci: number) => g.countries[ci].nukes ?? 0;
export const hbombsOf = (g: GameState, ci: number) => g.countries[ci].hbombs ?? 0;
/** Весь арсенал: атомные боеголовки и термоядерные бомбы. */
export const arsenalOf = (g: GameState, ci: number) => nukesOf(g, ci) + hbombsOf(g, ci);
/** Ядерная держава: есть хотя бы одна готовая боеголовка или бомба. */
export const isNuclear = (g: GameState, ci: number) => g.countries[ci].alive && arsenalOf(g, ci) > 0;
export const inFallout = (g: GameState, rid: number) => (g.fallout[rid] ?? 0) > g.day;

export function nukeCost(g: GameState, ci: number, thermo = false) {
  const c = g.countries[ci];
  const k = thermo ? HBOMB_COST : { money: 1, brains: 1 };
  return { money: 90 * Math.max(30, c.moneyScale) * k.money, brains: 220 * c.techScale * k.brains };
}

/** Шанс, что ПРО страны собьёт ракету. */
export function interceptChance(g: GameState, ci: number) {
  let p = 0;
  if (g.countries[ci].techs.includes('missile_defense')) p += 0.3;
  if (wonderOwner(g, 'orbital') === ci) p += 0.15;
  return p;
}

// ---------- сборка ----------
export function nukeBuildError(g: GameState, ci: number, thermo = false): string | null {
  const c = g.countries[ci];
  if (!hasBomb(g, ci)) return 'Нужна технология «Атомная бомба»';
  if (thermo && !isThermo(g, ci)) return 'Нужна технология «Термоядерная бомба»';
  if (c.nukeBuild) return c.nukeBuild.thermo ? 'Термоядерная бомба уже собирается' : 'Боеголовка уже собирается';
  const cost = nukeCost(g, ci, thermo);
  if (c.money < cost.money) return 'Не хватает денег';
  if (c.brains < cost.brains) return 'Не хватает 🧠';
  return null;
}

export function startNuke(g: GameState, ci: number, thermo = false): string | null {
  const err = nukeBuildError(g, ci, thermo);
  if (err) return err;
  const c = g.countries[ci];
  const cost = nukeCost(g, ci, thermo);
  const days = thermo ? HBOMB_DAYS : NUKE_DAYS;
  c.money -= cost.money;
  c.brains -= cost.brains;
  c.nukeBuild = { left: days, total: days, thermo: thermo || undefined };
  if (ci === g.player) {
    sfx('build');
    log(g, thermo ? `💥 Начата сборка термоядерной бомбы — ${days} дн.` : `☢️ Начата сборка ядерной боеголовки — ${days} дн.`, 'info');
  }
  return null;
}

/** Самый малонаселённый регион страны (не столица) — полигон для испытаний. */
function testSite(g: GameState, ci: number) {
  const c = g.countries[ci];
  let site = c.capital, low = Infinity;
  for (const rid of STATS[ci].regions) if (rid !== c.capital && g.regions[rid].pop < low) { low = g.regions[rid].pop; site = rid; }
  return site;
}

function finishNuke(g: GameState, ci: number) {
  const c = g.countries[ci];
  const thermo = !!c.nukeBuild?.thermo;
  c.nukeBuild = undefined;
  if (thermo) return finishHBomb(g, ci);
  c.nukes = nukesOf(g, ci) + 1;
  if (c.nukeTested) {
    if (ci === g.player) {
      sfx('done');
      log(g, `☢️ Боеголовка готова. В арсенале: ${c.nukes}`, 'good');
    }
    return;
  }
  // первое испытание — на самой малонаселённой окраине
  c.nukeTested = true;
  const site = testSite(g, ci);
  fx({ kind: 'nuke', tile: REGIONS[site].center, near: ci === g.player });
  g.countries.forEach((o, j) => { if (o.alive && j !== ci) addRel(g, ci, j, -6); });
  if (ci === g.player) {
    g.counters.nukeTests = (g.counters.nukeTests ?? 0) + 1;
    sfx('nuke');
    log(g, `☢️ Ядерное испытание в регионе ${REGIONS[site].name} прошло успешно! Мир встревожен, но напасть на нас теперь побоятся`, 'good');
  } else {
    news(g, `☢️ ${cname(g, ci)} провела первое ядерное испытание`, 'war');
  }
}

/** Термоядерная бомба готова; первая — взрывается на полигоне, и мир видит гриб высотой 60 км. */
function finishHBomb(g: GameState, ci: number) {
  const c = g.countries[ci];
  c.hbombs = hbombsOf(g, ci) + 1;
  if (c.hbombTested) {
    if (ci === g.player) {
      sfx('done');
      log(g, `💥 Термоядерная бомба готова. В арсенале: ${c.hbombs}`, 'good');
    }
    return;
  }
  c.hbombTested = true;
  c.nukeTested = true;
  const site = testSite(g, ci);
  fx({ kind: 'nuke', tile: REGIONS[site].center, big: true, near: ci === g.player });
  g.countries.forEach((o, j) => { if (o.alive && j !== ci) addRel(g, ci, j, -10); });
  if (ci === g.player) {
    g.counters.nukeTests = (g.counters.nukeTests ?? 0) + 1;
    g.counters.hbombTests = (g.counters.hbombTests ?? 0) + 1;
    sfx('nuke');
    log(g, `💥 Испытание термоядерной бомбы над регионом ${REGIONS[site].name}: вспышку видели за тысячу километров, гриб поднялся на 60 км. Мир в ужасе`, 'good');
  } else {
    news(g, `💥 ${cname(g, ci)} испытала термоядерную бомбу`, 'war');
  }
}

// ---------- удар ----------
/** thermo: true — термоядерной бомбой, false — атомной боеголовкой, не задано — чем угодно. */
export function strikeError(g: GameState, ci: number, rid: number, thermo?: boolean): string | null {
  const owner = g.regions[rid].owner;
  if (!hasBomb(g, ci)) return 'Нужна технология «Атомная бомба»';
  const have = thermo === undefined ? arsenalOf(g, ci) : thermo ? hbombsOf(g, ci) : nukesOf(g, ci);
  if (have < 1) return thermo ? 'Нет готовых термоядерных бомб' : 'Нет готовых боеголовок';
  if (owner === ci) return 'Это ваш регион';
  if (owner < 0) return 'По нейтральным землям удар не наносится';
  if (!atWar(g, ci, owner)) return 'Удар возможен только по стране, с которой идёт война';
  if (g.missiles.some((m) => m.from === ci && m.region === rid)) return 'По этому региону уже летит ракета';
  return null;
}

/** Запуск ракеты. retaliation — ответный удар: мир осуждает его меньше, и на него уже не отвечают.
 *  thermo — чем бить (по умолчанию термоядерной бомбой, если она есть). */
export function launchNuke(g: GameState, ci: number, rid: number, retaliation = false, thermo?: boolean): string | null {
  const err = strikeError(g, ci, rid, thermo);
  if (err) return err;
  const c = g.countries[ci];
  const victim = g.regions[rid].owner;
  const hb = thermo ?? hbombsOf(g, ci) > 0;
  if (hb) c.hbombs = hbombsOf(g, ci) - 1;
  else c.nukes = nukesOf(g, ci) - 1;
  g.missiles.push({ id: g.nextId++, from: ci, region: rid, launch: g.day, arrive: g.day + FLIGHT_DAYS, thermo: hb });
  fx({ kind: 'missile', from: REGIONS[c.capital].center, tile: REGIONS[rid].center });
  condemn(g, ci, victim, retaliation);
  const where = REGIONS[rid].name;
  if (ci === g.player) {
    g.counters.nukesLaunched = (g.counters.nukesLaunched ?? 0) + 1;
    sfx('siren');
    log(g, `🚀 ${retaliation ? 'Ответный удар! ' : ''}${hb ? 'Термоядерная ракета' : 'Ракета'} летит на ${where}. Подлёт через ${FLIGHT_DAYS} дн.`, 'war');
  } else if (victim === g.player) {
    sfx('siren');
    log(g, `🚨 Ракетное нападение! ${cname(g, ci)} выпустила ${hb ? 'термоядерную ракету' : 'ядерную ракету'} по региону ${where}. Подлёт через ${FLIGHT_DAYS} дн.`, 'war');
    if (isNuclear(g, g.player)) log(g, '☢️ Наш арсенал готов к ответному удару — вкладка «Армия»', 'war', false);
  } else {
    news(g, `🚀 ${cname(g, ci)} ${retaliation ? 'наносит ответный' : 'нанесла'} ${hb ? 'термоядерный' : 'ядерный'} удар по стране ${cname(g, victim)}`, 'war');
  }
  if (!retaliation) {
    // гарантированное ответное уничтожение: ядерная жертва и её ядерные союзники отвечают, пока ракета в воздухе
    if (victim !== g.player && isNuclear(g, victim)) retaliate(g, victim, ci);
    for (const ally of alliesOf(g, victim)) {
      if (ally !== g.player && ally !== ci && isNuclear(g, ally) && atWar(g, ally, ci) && rand(g) < 0.35) retaliate(g, ally, ci);
    }
  }
  computeAll(g);
  return null;
}

function condemn(g: GameState, ci: number, victim: number, retaliation: boolean) {
  setRel(g, ci, victim, -100);
  g.countries.forEach((o, j) => {
    if (!o.alive || j === ci || j === victim) return;
    addRel(g, ci, j, retaliation ? -8 : peekPair(g, ci, j).alliance ? -15 : -30);
  });
  if (retaliation) return;
  const c = g.countries[ci];
  c.stability = Math.max(0, c.stability - (c.gov === 'dictatorship' ? 3 : c.gov === 'democracy' ? 15 : 8));
}

/** Самый населённый регион противника, по которому ещё не летит наша ракета. */
export function bestNukeTarget(g: GameState, ci: number, enemy: number): number {
  let best = -1, bp = -1;
  for (const rid of STATS[enemy]?.regions ?? []) {
    if (g.missiles.some((m) => m.from === ci && m.region === rid)) continue;
    if (g.regions[rid].pop > bp) { bp = g.regions[rid].pop; best = rid; }
  }
  return best;
}

function retaliate(g: GameState, ci: number, enemy: number) {
  const rid = bestNukeTarget(g, ci, enemy);
  if (rid >= 0) launchNuke(g, ci, rid, true);
}

function detonate(g: GameState, m: Missile) {
  const rid = m.region;
  const r = g.regions[rid];
  const owner = r.owner;
  const center = REGIONS[rid].center;
  const where = REGIONS[rid].name;
  if (owner >= 0 && rand(g) < interceptChance(g, owner)) {
    fx({ kind: 'float', tile: center, text: '🛰️' });
    if (owner === g.player) {
      sfx('victory');
      log(g, `🛰️ ПРО сбила ядерную ракету над регионом ${where}!`, 'good');
    } else if (m.from === g.player) {
      sfx('defeat');
      log(g, `🛰️ ПРО противника сбила нашу ракету над регионом ${where}`, 'bad');
    } else news(g, `🛰️ ПРО страны ${cname(g, owner)} сбила ядерную ракету`, 'info');
    return;
  }
  const b = m.thermo ? BLAST.thermo : BLAST.atomic;
  let dead = r.pop * b.kill;
  r.pop = Math.max(1000, r.pop - dead);
  let ruined = 0;
  for (const t of REGIONS[rid].tiles) {
    if (g.buildings[t] && rand(g) < b.ruin) {
      removeBuilding(g, t);
      ruined++;
    }
  }
  mapDirty.buildings = true;
  if (owner >= 0) {
    const d = g.countries[owner];
    d.soldiers = Math.max(0, d.soldiers - regionDefense(g, rid).garrison * b.garrison);
    d.stability = Math.max(0, d.stability - (d.capital === rid ? 20 : 10));
    d.weariness = Math.min(100, d.weariness + 15);
  }
  for (const bt of g.battles) if (bt.region === rid) bt.soldiers *= 1 - b.garrison;
  g.fallout[rid] = Math.max(g.fallout[rid] ?? 0, g.day + b.fallout);
  // термоядерная ударная волна и радиоактивное облако накрывают и соседей
  if (m.thermo) {
    for (const nb of REGIONS[rid].neighbors) {
      const n = g.regions[nb];
      const lost = n.pop * THERMO_SPILL.kill;
      n.pop = Math.max(1000, n.pop - lost);
      dead += lost;
      g.fallout[nb] = Math.max(g.fallout[nb] ?? 0, g.day + THERMO_SPILL.fallout);
    }
  }
  g.counters.worldNukes = (g.counters.worldNukes ?? 0) + 1;
  fx({ kind: 'nuke', tile: center, big: m.thermo, near: owner === g.player || m.from === g.player });
  const toll = `погибли ${fmt(dead)} человек, разрушено зданий: ${ruined}${m.thermo ? ', радиация накрыла соседние регионы' : ''}`;
  if (owner === g.player) {
    sfx('nuke');
    log(g, `☢️ ${m.thermo ? 'Термоядерный' : 'Ядерный'} взрыв в регионе ${where}: ${toll}`, 'bad');
  } else if (m.from === g.player) {
    sfx('nuke');
    g.counters.nukesHit = (g.counters.nukesHit ?? 0) + 1;
    log(g, `☢️ ${m.thermo ? 'Термоядерный' : 'Ядерный'} удар по региону ${where}: ${toll}`, 'war');
  } else news(g, `☢️ ${m.thermo ? 'Термоядерный' : 'Ядерный'} взрыв в регионе ${where} (${cname(g, owner)}): погибли ${fmt(dead)}`, 'war');
  if (g.counters.worldNukes === WINTER_AT) nuclearWinter(g);
}

function nuclearWinter(g: GameState) {
  for (const c of g.countries) {
    if (!c.alive) continue;
    c.mods.push({ kind: 'food', value: -0.3, until: g.day + 730, label: 'Ядерная зима' });
    c.mods.push({ kind: 'stab', value: -5, until: g.day + 730, label: 'Ядерная зима' });
  }
  sfx('revolution');
  log(g, '🌫️ Ядерная зима! Пепел закрыл солнце: урожаи по всему миру упали на 30% на два года', 'bad');
}

/** Раз в день: сборка боеголовок, подлёт ракет, распад заражения. */
export function tickNuclear(g: GameState) {
  g.countries.forEach((c, i) => {
    if (!c.alive || !c.nukeBuild) return;
    c.nukeBuild.left -= 1;
    if (c.nukeBuild.left <= 0) finishNuke(g, i);
  });
  if (g.missiles.length) {
    const hit = g.missiles.filter((m) => m.arrive <= g.day);
    if (hit.length) {
      g.missiles = g.missiles.filter((m) => m.arrive > g.day);
      for (const m of hit) detonate(g, m);
      computeAll(g);
    }
  }
  if (g.day % 10 === 0) {
    for (const k in g.fallout) if (g.fallout[k] <= g.day) delete g.fallout[k];
  }
}

// ---------- боты ----------
const NUKE_WANT = { aggressor: 4, fanatic: 3, cautious: 2, scientist: 1, trader: 1 };

/** Бот копит арсенал по характеру (с термоядом — бомбы мощнее) и (редко) бьёт первым, если проигрывает войну. */
export function aiNuclear(g: GameState, i: number, th: { enemies: number[]; enemyPower: number; underAttack: boolean }) {
  if (!hasBomb(g, i)) return;
  const c = g.countries[i];
  let want: number = NUKE_WANT[c.personality];
  for (const e of th.enemies) want = Math.max(want, Math.min(6, arsenalOf(g, e) + 1));
  if (!c.nukeBuild && arsenalOf(g, i) < want) {
    const thermo = isThermo(g, i);
    const cost = nukeCost(g, i, thermo);
    if (c.money > cost.money * 1.5 && c.brains > cost.brains * 1.2) startNuke(g, i, thermo);
  }
  if (!th.enemies.length || !th.underAttack || arsenalOf(g, i) < 1 || g.difficulty === 'easy') return;
  if (c.personality !== 'aggressor' && c.personality !== 'fanatic') return;
  if (th.enemyPower < STATS[i].power * 1.3) return;
  const enemy = th.enemies.reduce((a, b) => (STATS[b].power > STATS[a].power ? b : a));
  if (arsenalOf(g, enemy) > arsenalOf(g, i)) return; // больший арсенал противника сдерживает
  if (rand(g) > 0.05 * DIFFICULTY[g.difficulty].aggression) return;
  const rid = bestNukeTarget(g, i, enemy);
  if (rid >= 0) launchNuke(g, i, rid);
}
