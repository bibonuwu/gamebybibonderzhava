// Мятежи, войны чужими руками и распад государств.
// Повстанцы (g.rebels) поднимаются там, где плохо живётся: низкая стабильность, голод, недовольство на захваченных
// землях, далёкие окраины. Раз в месяц они бьются с гарнизоном; две победы подряд — регион отделяется и становится
// ничьей землёй вместе с жителями и заводами. Власть может подавить мятеж силой или откупиться автономией.
// Войны чужими руками: на ядерную державу или на того, кто намного сильнее, в открытую не нападают — соперник тайно
// вооружает её мятежников. Контрразведка или досье могут раскрыть заказчика, и тогда война с ним справедлива (un.ts).
// Распад: бот, который долго не выходит из тяжёлого кризиса (развал, голод, долги, санкции, проигранная война),
// разом теряет окраины. Великие державы прочнее, игрок не распадается — у него свои мятежи.
import { addRel, alliesOf, atWar, cname, enemiesOf, makePeace, pair, peekPair, PLAYER_GRACE } from './actions';
import { WAR_GRACE_DAYS } from './defs';
import { attackPerSoldier, computeAll, regionDefense, regionWeight, STATS } from './economy';
import { fmt } from './format';
import { brothers } from './lodge';
import { isNuclear } from './nuclear';
import { counterOf, netOf, plant, plantError, watched } from './spy';
import { banner, fx, log, mapDirty, news, rand, sfx } from './state';
import type { GameState, Personality, Rebellion } from './types';
import { REGIONS, hexDist } from './world';

const CLASH_GAP = 30; // дней между стычками с гарнизоном
const WINS_TO_SECEDE = 2;
export const MAX_REBELS = 3; // мятежей в одной стране одновременно
const CRACKDOWN_GAP = 30;
const COLLAPSE_AT = 240; // очков кризиса до распада (≈8 месяцев тяжёлых времён)
const COLLAPSE_GAP = 1000; // дней между распадами одной страны
export const PROXY_NET = 35; // нужная сеть агентов, чтобы возить мятежникам оружие
const PROXY_START = 45; // цена в днях дохода: оружие и инструкторы
const PROXY_MONTH = 6; // ежемесячное содержание
const MAX_PROXIES = 3; // скольких мятежей одна страна может вооружать
/** Насколько охотно бунтует народ игрока: на лёгкой сложности терпеливее. */
const PLAYER_RISK = { easy: 0.5, normal: 0.8, hard: 1 };
/** Охота воевать чужими руками по характеру. */
const PROXY_ZEAL: Record<Personality, number> = { aggressor: 1, fanatic: 0.8, cautious: 0.3, trader: 0.25, scientist: 0.25 };

const scale = (g: GameState, a: number) => Math.max(30, g.countries[a].moneyScale);
export const rebelsIn = (g: GameState, ci: number) => g.rebels.filter((r) => r.country === ci);
export const rebelsOf = (g: GameState, sponsor: number) => g.rebels.filter((r) => r.sponsor === sponsor);
export const rebelAt = (g: GameState, rid: number) => g.rebels.find((r) => r.region === rid);
const rname = (rid: number) => REGIONS[rid].name;

/** Насколько неспокойно в регионе: 0 — тихо, 1 и выше — пороховая бочка. */
export function restless(g: GameState, rid: number, ci: number): number {
  const c = g.countries[ci];
  const s = STATS[ci];
  let v = Math.max(0, (50 - c.stability) / 40) + s.hunger * 2;
  const orig = REGIONS[rid].origOwner;
  if (orig >= 0 && orig !== ci) v += 0.25 + Math.min(0.3, c.unrest / 40); // отнятые у соседа земли помнят прежнюю родину
  else if (orig < 0) v += 0.1; // присоединённые ничьи земли
  if (c.money < -Math.max(1000, s.taxIncome * 60)) v += 0.3; // зарплаты не платят
  v += Math.min(0.15, hexDist(REGIONS[rid].center, REGIONS[c.capital].center) / 150); // далёкая окраина
  return v;
}

/** Сила повстанцев в бою: чужое оружие и горы с лесами им в помощь. */
export function rebelStrength(g: GameState, r: Rebellion): number {
  const info = REGIONS[r.region];
  const terrain = 1 + info.mountainShare * 0.8 + info.forestShare * 0.4;
  const per = r.sponsor >= 0 && g.countries[r.sponsor].alive ? 0.45 + 0.45 * Math.min(2.5, STATS[r.sponsor].weapons) : 0.45;
  return r.fighters * per * terrain;
}
/** Шанс повстанцев выиграть следующую стычку с гарнизоном. */
export function rebelThreat(g: GameState, r: Rebellion): number {
  const R = rebelStrength(g, r);
  const D = regionDefense(g, r.region).strength;
  return R <= 0 ? 0 : (R * R) / (R * R + D * D || 1);
}

// ---------- начало мятежа ----------
/** Где поднять мятеж: самый неспокойный регион (заказчику удобнее у своей границы — оружие везти ближе). */
function bestRegion(g: GameState, ci: number, sponsor: number, jitter: boolean): number {
  const c = g.countries[ci];
  let best = -1, bestV = -Infinity;
  for (const rid of STATS[ci].regions) {
    if (rid === c.capital || rebelAt(g, rid) || g.battles.some((b) => b.region === rid)) continue;
    let v = restless(g, rid, ci) + (jitter ? rand(g) * 0.3 : 0);
    if (sponsor >= 0 && REGIONS[rid].neighbors.some((nb) => g.regions[nb].owner === sponsor)) v += 0.4;
    if (v > bestV) { bestV = v; best = rid; }
  }
  return best;
}

function rise(g: GameState, ci: number, rid: number, sponsor: number): Rebellion {
  const v = restless(g, rid, ci);
  const r: Rebellion = {
    id: g.nextId++, region: rid, country: ci, sponsor, since: g.day, nextClash: g.day + CLASH_GAP, wins: 0,
    fighters: g.regions[rid].pop * 0.0015 * (0.5 + v) * (sponsor >= 0 ? 1.5 : 1),
  };
  g.rebels.push(r);
  if (ci === g.player) {
    sfx('alarm');
    log(g, `✊ Мятеж в регионе ${rname(rid)}: ~${fmt(r.fighters)} повстанцев. Подавить или договориться — вкладка «Армия»`, 'war', false);
    banner({ icon: '✊', title: 'Мятеж!', text: `${rname(rid)}: ~${fmt(r.fighters)} повстанцев`, kind: 'war' });
  } else if (sponsor < 0 && rand(g) < 0.5) news(g, `✊ В стране ${cname(g, ci)} мятеж: восстал регион ${rname(rid)}`, 'bad');
  fx({ kind: 'float', tile: REGIONS[rid].center, text: '✊' });
  return r;
}

/** Сам собой мятеж вспыхивает, только когда в стране плохо: проверка раз в 10 дней. */
function maybeRise(g: GameState, ci: number) {
  const c = g.countries[ci];
  const s = STATS[ci];
  if (s.regions.length < 2 || rebelsIn(g, ci).length >= MAX_REBELS) return;
  if (ci === g.player && g.day < 200) return;
  let p = Math.max(0, (35 - c.stability) / 35) * 0.25 + s.hunger * 0.3 + (c.stability < 50 ? Math.min(0.05, c.unrest / 150) : 0);
  if ((c.aiFlags.crisis ?? 0) > 90) p += 0.08;
  if (ci === g.player) p *= PLAYER_RISK[g.difficulty];
  if (p <= 0 || rand(g) >= p) return;
  const rid = bestRegion(g, ci, -1, true);
  if (rid >= 0) rise(g, ci, rid, -1);
}

/** Мятеж в самом неспокойном регионе страны (сценарий «Эпоха потрясений»). */
export function seedRebellion(g: GameState, ci: number) {
  const rid = bestRegion(g, ci, -1, false);
  if (rid >= 0) rise(g, ci, rid, -1);
}

// ---------- день мятежа ----------
function dayOf(g: GameState, r: Rebellion) {
  const pop = g.regions[r.region].pop;
  const v = restless(g, r.region, r.country);
  const paid = r.sponsor >= 0;
  r.fighters += pop * (0.00008 * v * v + (paid ? 0.00005 : 0));
  r.fighters *= v < 0.35 && !paid ? 0.985 : 0.995; // жизнь наладилась — расходятся по домам
  if (r.fighters < Math.max(300, pop * 0.0003)) {
    end(g, r);
    if (r.country === g.player) log(g, `🕊️ Мятеж в регионе ${rname(r.region)} утих сам: люди разошлись по домам`, 'good');
    else if (r.sponsor === g.player) log(g, `✊ Мятеж в регионе ${rname(r.region)} (${cname(g, r.country)}) угас: повстанцы разошлись`, 'bad');
    return;
  }
  if (g.day >= r.nextClash) clash(g, r);
}

const end = (g: GameState, r: Rebellion) => { g.rebels = g.rebels.filter((x) => x.id !== r.id); };

/** Раз в месяц: заказчик платит, повстанцы бьются с гарнизоном, контрразведка ищет, откуда оружие. */
function clash(g: GameState, r: Rebellion) {
  r.nextClash = g.day + CLASH_GAP;
  const me = g.player;
  const c = g.countries[r.country];
  if (r.sponsor >= 0) {
    const sp = g.countries[r.sponsor];
    const fee = proxyFee(g, r.sponsor);
    if (sp.money < fee || peekPair(g, r.sponsor, r.country).alliance) {
      if (r.sponsor === me) log(g, `🔥 Поддержка мятежников в регионе ${rname(r.region)} прекращена: ${sp.money < fee ? 'нет денег' : 'мы теперь союзники'}`, 'info');
      r.sponsor = -1;
    } else sp.money -= fee;
  }
  const p = rebelThreat(g, r);
  const garrison = regionDefense(g, r.region).garrison;
  const win = rand(g) < p;
  if (win) {
    c.soldiers = Math.max(0, c.soldiers - garrison * 0.08);
    c.stability = Math.max(0, c.stability - 3);
    r.fighters *= 1.1;
    r.wins++;
  } else {
    c.soldiers = Math.max(0, c.soldiers - garrison * 0.02);
    r.fighters *= 0.55;
    r.wins = 0;
  }
  if (r.sponsor >= 0 && !r.exposed) {
    // досье на заказчика — видим его поставки; иначе — как повезёт контрразведке
    const chance = r.country === me && watched(g, r.sponsor) ? 1 : 0.06 + counterOf(g, r.country) * 0.25;
    if (rand(g) < chance) expose(g, r);
  }
  if (r.wins >= WINS_TO_SECEDE) {
    const sponsor = r.sponsor;
    secede(g, r.region, sponsor);
    onSecession(g, r, sponsor);
    computeAll(g);
    return;
  }
  const where = rname(r.region);
  if (r.country === me) {
    if (win) log(g, `✊ Повстанцы разбили гарнизон в регионе ${where}! Ещё одна победа — и регион отделится`, 'bad');
    else log(g, `🛡️ Гарнизон отбил вылазку повстанцев в регионе ${where}`, 'good', false);
  } else if (r.sponsor === me) {
    log(g, win ? `🔥 Наши повстанцы разбили гарнизон в регионе ${where} (${cname(g, r.country)}) — ещё победа, и он отделится` : `🔥 Повстанцев в регионе ${where} отбросили: их стало ${fmt(r.fighters)}`, win ? 'good' : 'info', false);
  }
}

function expose(g: GameState, r: Rebellion) {
  r.exposed = true;
  const me = g.player;
  addRel(g, r.sponsor, r.country, -25);
  const p = pair(g, r.sponsor, r.country);
  p.grudge = Math.max(p.grudge ?? 0, 30);
  g.countries.forEach((c, k) => { if (c.alive && k !== r.sponsor && k !== r.country) addRel(g, r.sponsor, k, -3); });
  if (r.country === me) {
    sfx('alarm');
    log(g, `🕵️ Раскрыто: повстанцев в регионе ${rname(r.region)} вооружает ${cname(g, r.sponsor)}! Война с ней теперь будет справедливой`, 'war');
  } else if (r.sponsor === me) {
    sfx('alarm');
    log(g, `🕵️ Наш след раскрыт: ${cname(g, r.country)} узнала, кто вооружает её мятежников (отношения −25)`, 'bad');
  } else news(g, `🕵️ Скандал: ${cname(g, r.sponsor)} тайно вооружает мятежников в стране ${cname(g, r.country)}`, 'war');
}

/** Регион отделяется и становится ничьей землёй. ally — кто помог: ему присоединение дешевле. */
export function secede(g: GameState, rid: number, ally = -1) {
  const from = g.regions[rid].owner;
  if (from < 0 || g.countries[from].capital === rid) return;
  g.regions[rid].owner = -1;
  if (ally >= 0 && g.countries[ally].alive) g.regions[rid].ally = ally;
  else delete g.regions[rid].ally;
  g.rebels = g.rebels.filter((x) => x.region !== rid);
  g.counters.seceded = (g.counters.seceded ?? 0) + 1; // по всему миру
  const fc = g.countries[from];
  fc.stability = Math.max(0, fc.stability - 4);
  mapDirty.territory = true;
  mapDirty.buildings = true;
  fx({ kind: 'flash', tile: REGIONS[rid].center, color: 0x8a8f99 });
  fx({ kind: 'float', tile: REGIONS[rid].center, text: '🏳️' });
}

function onSecession(g: GameState, r: Rebellion, sponsor: number) {
  const me = g.player;
  const where = rname(r.region);
  if (r.country === me) {
    sfx('defeat');
    log(g, `🏳️ ${where} отделился: повстанцы провозгласили независимость`, 'bad', false);
    banner({ icon: '🏳️', title: 'Регион отделился', text: `${where} больше не наш — его можно вернуть силой или выкупом`, kind: 'war' });
  } else if (sponsor === me) {
    g.counters.proxyWins = (g.counters.proxyWins ?? 0) + 1;
    sfx('victory');
    log(g, `🏳️ ${where} отделился от страны ${cname(g, r.country)} на наше оружие — присоединить его теперь дешевле`, 'good', false);
    banner({ icon: '🏳️', title: 'Наши повстанцы победили', text: `${where} независим — присоединение со скидкой`, kind: 'gold' });
  } else news(g, `🏳️ ${where} отделился от страны ${cname(g, r.country)}${sponsor >= 0 && r.exposed ? ` при поддержке страны ${cname(g, sponsor)}` : ''}`, 'war');
}

// ---------- ответ власти ----------
export function crackdownChance(g: GameState, ci: number, r: Rebellion, n: number) {
  const A = n * attackPerSoldier(g, ci, false);
  const R = rebelStrength(g, r);
  return A <= 0 ? 0 : (A * A) / (A * A + R * R);
}
/** Сколько солдат нужно для операции с шансом p. */
export function crackdownNeed(g: GameState, ci: number, r: Rebellion, p: number) {
  return Math.ceil((rebelStrength(g, r) * Math.sqrt(p / (1 - p))) / Math.max(1e-9, attackPerSoldier(g, ci, false)));
}
export function crackdownError(g: GameState, ci: number, r: Rebellion | undefined): string | null {
  if (!r || r.country !== ci) return 'Нет такого мятежа';
  if ((r.cd ?? 0) > g.day) return `Войска перегруппируются ещё ${Math.ceil(r.cd! - g.day)} дн.`;
  if (g.countries[ci].soldiers < 1) return 'Нет свободных солдат';
  return null;
}
/** Карательная операция: победа — мятежу конец (народ этого не любит), поражение — потери и повстанцы смелее. */
export function crackdown(g: GameState, ci: number, id: number, n: number): string | null {
  const r = g.rebels.find((x) => x.id === id);
  const err = crackdownError(g, ci, r);
  if (err) return err;
  const c = g.countries[ci];
  n = Math.floor(Math.min(n, c.soldiers));
  if (n < 1) return 'Нет свободных солдат';
  const p = crackdownChance(g, ci, r!, n);
  const ratio = rebelStrength(g, r!) / Math.max(1e-9, n * attackPerSoldier(g, ci, false));
  r!.cd = g.day + CRACKDOWN_GAP;
  const where = rname(r!.region);
  if (rand(g) < p) {
    const loss = n * Math.min(0.3, Math.max(0.02, 0.12 * ratio + 0.02));
    c.soldiers = Math.max(0, c.soldiers - loss);
    g.regions[r!.region].pop *= 0.995;
    c.mods.push({ kind: 'stab', value: c.gov === 'democracy' ? -5 : -2, until: g.day + 120, label: 'Карательная операция' });
    // кому есть куда уйти — к покровителю через границу — тот вернётся
    const refuge = r!.sponsor >= 0 && REGIONS[r!.region].neighbors.some((nb) => g.regions[nb].owner === r!.sponsor);
    if (refuge) {
      r!.fighters *= 0.3;
      r!.wins = 0;
    } else end(g, r!);
    if (ci === g.player) {
      if (!refuge) g.counters.rebelsCrushed = (g.counters.rebelsCrushed ?? 0) + 1;
      sfx('victory');
      log(g, refuge
        ? `⚔️ Повстанцы в регионе ${where} разбиты, но остатки ушли за границу — к тем, кто их вооружает (потери: ${fmt(loss)})`
        : `⚔️ Мятеж в регионе ${where} подавлен (потери: ${fmt(loss)})`, 'good');
    } else if (r!.sponsor === g.player) log(g, refuge ? `🔥 Наших повстанцев в регионе ${where} разбили — остатки отошли к нам через границу` : `🔥 Повстанцев, которых мы вооружали в регионе ${where}, разгромили`, 'bad');
  } else {
    const loss = n * Math.min(0.5, Math.max(0.1, 0.3 * ratio));
    c.soldiers = Math.max(0, c.soldiers - loss);
    c.weariness = Math.min(100, c.weariness + 3);
    r!.fighters *= 0.85;
    if (ci === g.player) {
      sfx('defeat');
      log(g, `❌ Карательная операция в регионе ${where} провалилась (потери: ${fmt(loss)})`, 'bad');
    } else if (r!.sponsor === g.player) log(g, `🔥 Наши повстанцы в регионе ${where} отбились от карателей`, 'good', false);
  }
  computeAll(g);
  return null;
}

export function autonomyCost(g: GameState, ci: number, r: Rebellion) {
  return scale(g, ci) * 20 * regionWeight(g.regions[r.region].pop) * (r.sponsor >= 0 ? 2 : 1);
}
export function autonomyError(g: GameState, ci: number, r: Rebellion | undefined): string | null {
  if (!r || r.country !== ci) return 'Нет такого мятежа';
  if (g.countries[ci].money < autonomyCost(g, ci, r)) return 'Не хватает денег';
  return null;
}
/** Автономия: деньги на местный бюджет и уступки — мятеж кончается миром (тем, кто его вооружал, дороже). */
export function autonomy(g: GameState, ci: number, id: number): string | null {
  const r = g.rebels.find((x) => x.id === id);
  const err = autonomyError(g, ci, r);
  if (err) return err;
  const c = g.countries[ci];
  c.money -= autonomyCost(g, ci, r!);
  c.mods.push({ kind: 'stab', value: -2, until: g.day + 180, label: 'Уступки мятежникам' });
  end(g, r!);
  if (ci === g.player) {
    sfx('peace');
    log(g, `🤝 ${rname(r!.region)} получил автономию — мятеж окончен миром`, 'good');
  } else if (r!.sponsor === g.player) log(g, `🔥 Мятежники в регионе ${rname(r!.region)} договорились с властями: наша помощь больше не нужна`, 'info');
  computeAll(g);
  return null;
}

// ---------- война чужими руками ----------
export const proxyFee = (g: GameState, a: number) => scale(g, a) * PROXY_MONTH;
export const proxyCost = (g: GameState, a: number) => scale(g, a) * PROXY_START;
/** Кого будем вооружать в стране b: уже идущий мятеж без покровителя или самый неспокойный регион. */
export function proxyTarget(g: GameState, a: number, b: number): { rid: number; rebel?: Rebellion } | null {
  const free = rebelsIn(g, b).filter((r) => r.sponsor < 0).sort((x, y) => y.fighters - x.fighters)[0];
  if (free) return { rid: free.region, rebel: free };
  if (rebelsIn(g, b).length >= MAX_REBELS) return null;
  const rid = bestRegion(g, b, a, false);
  return rid >= 0 ? { rid } : null;
}
export function proxyError(g: GameState, a: number, b: number): string | null {
  if (a === b || !g.countries[b]?.alive) return 'Недопустимая цель';
  if (peekPair(g, a, b).alliance) return 'Это наш союзник';
  if (rebelsOf(g, a).length >= MAX_PROXIES) return `Больше ${MAX_PROXIES} мятежей одновременно не потянуть`;
  if (netOf(g, a, b) < PROXY_NET) return `Нужна сеть агентов ${PROXY_NET}% — через неё повезут оружие`;
  if (!proxyTarget(g, a, b)) return 'Там негде поднять мятеж';
  if (g.countries[a].money < proxyCost(g, a)) return 'Не хватает денег';
  return null;
}
/** Тайно вооружить мятежников в стране b: подхватить идущий мятеж или поднять новый. */
export function sponsorRebels(g: GameState, a: number, b: number): string | null {
  const err = proxyError(g, a, b);
  if (err) return err;
  const t = proxyTarget(g, a, b)!;
  g.countries[a].money -= proxyCost(g, a);
  let r = t.rebel;
  if (r) {
    r.sponsor = a;
    r.fighters *= 1.3;
    r.exposed = false;
  } else {
    r = rise(g, b, t.rid, a);
  }
  if (a === g.player) {
    g.counters.proxies = (g.counters.proxies ?? 0) + 1;
    sfx('paper');
    log(g, `🔥 Оружие и инструкторы отправлены мятежникам в регионе ${rname(r.region)} (${cname(g, b)}). Содержание — 💰 ${fmt(proxyFee(g, a))} в месяц`, 'good', false);
  }
  return null;
}
export function stopSponsor(g: GameState, a: number, id: number) {
  const r = g.rebels.find((x) => x.id === id && x.sponsor === a);
  if (!r) return;
  r.sponsor = -1;
  if (a === g.player) log(g, `🔥 Мы больше не вооружаем мятежников в регионе ${rname(r.region)}`, 'info');
}

/** Бот воюет чужими руками с тем, на кого нельзя напасть в открытую: ядерной державой или тем, кто намного сильнее. */
export function botProxy(g: GameState, i: number) {
  const c = g.countries[i];
  const cold = g.scenario === 'coldwar';
  if (g.day < (cold ? 150 : WAR_GRACE_DAYS) || g.day - (c.aiFlags.lastProxy ?? -999) < 90) return;
  if (enemiesOf(g, i).length && !cold) return;
  if (rebelsOf(g, i).length >= 2 || c.money < STATS[i].taxIncome * 100) return;
  c.aiFlags.lastProxy = g.day;
  const zeal = PROXY_ZEAL[c.personality] * (g.difficulty === 'easy' ? 0.6 : g.difficulty === 'hard' ? 1.3 : 1) * (cold ? 2 : 1);
  if (rand(g) > zeal * 0.5) return;
  let best = -1, bestV = 0;
  for (let j = 0; j < g.countries.length; j++) {
    if (j === i || !g.countries[j].alive || atWar(g, i, j) || peekPair(g, i, j).alliance || brothers(g, i, j)) continue;
    if (j === g.player && g.day < PLAYER_GRACE[g.difficulty]) continue;
    const rel = g.rel[i][j];
    if (rel > (cold ? -15 : -25)) continue;
    const untouchable = isNuclear(g, j) || STATS[j].power > STATS[i].power * 1.3;
    if (!untouchable) continue; // со слабым можно и в открытую
    // союзники врага — тоже враги: в холодной войне бьют по всему блоку
    const v = -rel + (isNuclear(g, j) ? 25 : 0) + (cold && alliesOf(g, j).length ? 10 : 0) + rand(g) * 10;
    if (v > bestV) { bestV = v; best = j; }
  }
  if (best < 0) return;
  if (netOf(g, i, best) < PROXY_NET) {
    if (!plantError(g, i, best)) plant(g, i, best);
    c.aiFlags.lastProxy = g.day - 60; // как сеть окрепнет — вернёмся к делу
    return;
  }
  if (!proxyError(g, i, best)) {
    sponsorRebels(g, i, best);
    if (best === g.player && rand(g) < 0.3) log(g, '🕵️ Разведка докладывает: кто-то тайно возит оружие нашим недовольным', 'war');
  }
}

/** Бот гасит свои мятежи: карательная операция, если хватает солдат, иначе — автономия. */
export function botRebels(g: GameState, i: number) {
  const c = g.countries[i];
  for (const r of rebelsIn(g, i)) {
    if ((r.cd ?? 0) > g.day) continue;
    const p = rebelThreat(g, r);
    const need = crackdownNeed(g, i, r, 0.75);
    // слабый мятеж власти замечают не сразу, а давят, только если это дёшево
    const cheap = g.day - r.since > 60 && need <= c.soldiers * 0.03;
    if (p < (r.wins ? 0.1 : 0.25) && !cheap) continue;
    if (need <= c.soldiers * 0.25) crackdown(g, i, r.id, need);
    else if (!autonomyError(g, i, r) && c.money > autonomyCost(g, i, r) * 2) autonomy(g, i, r.id);
    else if (c.soldiers > 1000) crackdown(g, i, r.id, c.soldiers * 0.25);
  }
}

// ---------- распад ----------
/** Насколько тяжело стране сегодня: 0 — спокойно, 1 и выше — кризис (развал, голод, долги, санкции, война, мятежи). */
export function crisisLoad(g: GameState, i: number): number {
  const c = g.countries[i];
  const s = STATS[i];
  let k = Math.max(0, (40 - c.stability) / 20) + s.hunger * 4 + s.sanctions * 3 + rebelsIn(g, i).length * 0.3;
  if (c.money < -Math.max(1000, s.taxIncome * 60)) k += 1;
  if ((c.defaulted ?? 0) > g.day) k += 0.5;
  if (c.weariness > 40) k += 0.5;
  // война идёт плохо: земли тают
  for (const e of enemiesOf(g, i)) {
    const w = peekPair(g, i, e).war;
    if (w && (i < e ? w.aRegions : w.bRegions) - s.regions.length >= 2) { k += 0.5; break; }
  }
  return k;
}

/** Кризис копится, только когда беда серьёзная: от санкций или войны самих по себе страны не распадаются. */
const CRISIS_FROM = 0.5;

/** Счётчик кризиса бота: копится в тяжёлые времена (великие державы прочнее), тает в спокойные. */
function crisisDay(g: GameState, i: number, great: boolean) {
  const c = g.countries[i];
  const s = STATS[i];
  const k = crisisLoad(g, i);
  const was = c.aiFlags.crisis ?? 0;
  const cr = k >= CRISIS_FROM ? Math.min(400, was + (k - CRISIS_FROM * 0.6) * (great ? 0.5 : 1)) : Math.max(0, was - 1.5);
  if (cr > 0) c.aiFlags.crisis = cr;
  else delete c.aiFlags.crisis;
  if (cr >= COLLAPSE_AT && g.day >= 365 && s.regions.length >= 4 && g.day - (c.aiFlags.collapsed ?? -9999) > COLLAPSE_GAP) collapse(g, i);
}
/** Близко ли страна к распаду (для карточки страны). */
export const nearCollapse = (g: GameState, i: number) => (g.countries[i].aiFlags.crisis ?? 0) >= COLLAPSE_AT * 0.6;

/** Распад: мятежные, захваченные и самые дальние земли отделяются разом, армия расходится по домам. */
export function collapse(g: GameState, i: number) {
  const c = g.countries[i];
  const total = STATS[i].regions.length;
  const capC = REGIONS[c.capital].center;
  const cand = STATS[i].regions.filter((rid) => rid !== c.capital).map((rid) => {
    const reb = rebelAt(g, rid);
    return { rid, ally: reb?.sponsor ?? -1, v: (reb ? 100 : 0) + (REGIONS[rid].origOwner !== i ? 50 : 0) + hexDist(REGIONS[rid].center, capC) };
  }).sort((a, b) => b.v - a.v);
  const n = Math.min(cand.length, Math.max(1, Math.round(total * (0.25 + rand(g) * 0.15))));
  const lost = cand.slice(0, n);
  for (const x of lost) secede(g, x.rid, x.ally);
  c.soldiers *= 1 - (n / total) * 0.8;
  c.stability = Math.max(c.stability, 40);
  c.unrest = 0;
  c.aiFlags.collapsed = g.day;
  delete c.aiFlags.crisis;
  // ослабевшая страна просит мира у всех
  for (const e of enemiesOf(g, i)) {
    if (e !== g.player) makePeace(g, i, e);
    else if (!g.proposals.some((p) => p.from === i)) g.proposals.push({ id: g.nextId++, from: i, kind: 'peace', expires: g.day + 60 });
  }
  const names = lost.slice(0, 3).map((x) => rname(x.rid)).join(', ') + (n > 3 ? ` и ещё ${n - 3}` : '');
  const near = STATS[g.player].regions.some((rid) => REGIONS[rid].neighbors.some((nb) => lost.some((x) => x.rid === nb)));
  g.counters.collapses = (g.counters.collapses ?? 0) + 1;
  if (near) {
    sfx('alarm');
    log(g, `💔 Распад: ${cname(g, i)} теряет ${n} из ${total} регионов (${names}). У наших границ — ничьи земли`, 'war', false);
    banner({ icon: '💔', title: `Распад: ${cname(g, i)}`, text: `Отделились ${n} регионов — их можно присоединить`, kind: 'war' });
  } else news(g, `💔 Распад: ${cname(g, i)} теряет ${n} из ${total} регионов (${names})`, 'war');
  computeAll(g);
}

// ---------- день ----------
export function tickRebels(g: GameState) {
  // регион сменил хозяина или страна пала — мятеж кончился; пропал заказчик — повстанцы сами по себе
  g.rebels = g.rebels.filter((r) => g.countries[r.country].alive && g.regions[r.region].owner === r.country);
  for (const r of g.rebels) if (r.sponsor >= 0 && !g.countries[r.sponsor].alive) r.sponsor = -1;
  for (const r of [...g.rebels]) dayOf(g, r);
  const top = g.countries.filter((c) => c.alive).map((c) => c.idx).sort((a, b) => STATS[b].power - STATS[a].power).slice(0, 3);
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    if (i !== g.player) crisisDay(g, i, top.includes(i));
    if ((g.day + i * 3) % 10 === 0) maybeRise(g, i);
  });
}
