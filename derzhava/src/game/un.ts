// ООН: кто напал без причины — агрессор. Совбез голосует (у пятёрки постоянных членов — право вето),
// мир вводит санкции и помогает жертве деньгами и оружием, а если вето нет — соседи воюют с агрессором.
import {
  addRel, alliesOf, atWar, cname, enemiesOf, hasPort, makePeace, neighborCountries, pair, peekPair, seaReach,
} from './actions';
import { computeAll, SANCTION_MAX, sanctionLoss, STATS } from './economy';
import { lodgeShield } from './lodge';
import { fmt } from './format';
import { banner, log, news, rand, sfx } from './state';
import type { GameState, Personality, UNCase, UNVote } from './types';
import { COUNTRY_DEFS, REGIONS } from './world';

/** Постоянные члены Совбеза — у них право вето. */
export const P5 = ['us', 'ru', 'cn', 'gb', 'fr'].map((id) => COUNTRY_DEFS.findIndex((d) => d.id === id)).filter((i) => i >= 0);
export const isP5 = (i: number) => P5.includes(i);

const VOTE_DAYS = 3; // Совбез собирается на экстренное заседание
const VOTE_WAIT = 12; // сколько ждём голоса игрока, если окно занято другим событием
const AID_GAP = 30; // помощь жертве — раз в месяц
const AID_DAYS = 2; // каждый донор за раз отдаёт столько дней своих налогов
const AID_CAP = 15; // а жертва получает не больше стольких дней своих налогов
const ANNEX_DAYS = 730; // мир заключён, но захват не признан: санкции ещё на два года

/** Шанс, что бот нападёт, хотя резолюция пройдёт и против него встанет коалиция. */
const UN_RECKLESS: Record<Personality, number> = { aggressor: 0.12, fanatic: 0.08, cautious: 0.02, trader: 0, scientist: 0 };
/** Насколько бот боится санкций всего мира (1 — передумает, если санкции введут все). */
const SANCTION_FEAR: Record<Personality, number> = { aggressor: 1, fanatic: 1.2, cautious: 2.5, trader: 3, scientist: 2.5 };
/** Готовность воевать в коалиции ООН. */
const FIGHT_ZEAL: Record<Personality, number> = { aggressor: 0.25, fanatic: 0.15, cautious: 0.05, trader: -0.05, scientist: -0.05 };

const one = (n: number) => n % 10 === 1 && n % 100 !== 11;
/** «1 страна», «3 страны», «7 стран». */
export const countriesN = (n: number) => `${n} ${one(n) ? 'страна' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'страны' : 'стран'}`;
const eventId = (cs: UNCase) => `un-${cs.id}`;

// ---------- кто прав ----------
/** Агрессор: напала и ещё не помирилась с жертвой. */
export const isAggressor = (g: GameState, x: number) => g.un.some((cs) => cs.aggressor === x && cs.until === undefined);
const activeCase = (g: GameState, a: number, v: number) => g.un.find((cs) => cs.aggressor === a && cs.victim === v && cs.until === undefined);
/** Жертвы агрессора x, с которыми он ещё воюет. */
export const victimsOf = (g: GameState, x: number) => g.un.filter((cs) => cs.aggressor === x && cs.until === undefined).map((cs) => cs.victim);
/** Ввела ли страна k санкции против x. */
export const sanctions = (g: GameState, k: number, x: number) => g.un.some((cs) => cs.aggressor === x && cs.sanctions.includes(k));
/** Эмбарго на оружие: резолюция Совбеза принята, а агрессор всё ещё воюет. */
export const embargoed = (g: GameState, x: number) =>
  g.un.some((cs) => cs.aggressor === x && cs.until === undefined && cs.resolved && cs.veto === undefined);

/** Права ли страна a, объявляя войну b. Справедливо — помочь жертве агрессии или ударить первым по тому,
 *  кто сам готовил нападение; всё остальное — агрессия. */
export function warJustice(g: GameState, a: number, b: number): { just: boolean; reason: string } {
  if (isAggressor(g, b)) return { just: true, reason: `помощь жертве агрессии (${victimsOf(g, b).map((v) => cname(g, v)).join(', ')})` };
  if (g.countries[b].aiFlags.prepTarget === a) return { just: true, reason: 'упреждающий удар: она сама готовила нападение' };
  if (g.rebels?.some((r) => r.country === a && r.sponsor === b && r.exposed)) return { just: true, reason: 'ответ на войну чужими руками: она вооружает мятежников у нас' };
  return { just: false, reason: 'нападение без причины' };
}

// ---------- как ответит мир ----------
const VOTE_NAME: Record<UNVote, string> = { yes: 'за', veto: 'вето', abstain: 'воздержится' };

/** Как постоянный член m проголосует за резолюцию против a, напавшей на b. */
function p5Vote(g: GameState, m: number, a: number, b: number): UNVote {
  if (m === a || peekPair(g, m, a).alliance || atWar(g, m, b)) return 'veto';
  if (m === b || peekPair(g, m, b).alliance) return 'yes';
  if (a === g.player && lodgeShield(g, m)) return 'veto'; // брат по ложе прикрывает (услуга «Кулуары ООН»)
  const ra = g.rel[m][a], rb = g.rel[m][b];
  if (ra >= 40 && ra > rb + 25) return 'veto'; // покрывает друга
  if (ra > rb + 10) return 'abstain';
  return 'yes';
}

/** Пойдёт ли k воевать с агрессором a по мандату ООН. */
function willFight(g: GameState, k: number, a: number, b: number, near: Set<number>) {
  if (enemiesOf(g, k).length) return false; // своих войн хватает
  if (!near.has(k) && !(hasPort(g, k) && STATS[a].regions.some((rid) => seaReach(k, rid)))) return false; // не дотянуться
  if (STATS[k].power < STATS[a].power * 0.12) return false; // малой стране с агрессором не тягаться
  return (g.rel[k][b] - g.rel[k][a]) / 100 + FIGHT_ZEAL[g.countries[k].personality] > 0.15;
}

interface Response { sanctions: number[]; donors: number[]; coalition: number[] }
/** Кто как ответит агрессору a. mandate — резолюция принята: санкции обязательны для всех, кроме близких
 *  друзей агрессора, и соседи-добровольцы воюют. Без неё санкции вводят только несогласные. Игрок решает сам. */
function respond(g: GameState, a: number, b: number, mandate: boolean): Response {
  const out: Response = { sanctions: [], donors: [], coalition: [] };
  const near = neighborCountries(g, a);
  g.countries.forEach((c, k) => {
    if (!c.alive || k === a || k === b || k === g.player) return;
    if (peekPair(g, k, a).alliance || atWar(g, k, b)) return;
    if (a === g.player && lodgeShield(g, k)) return;
    const ra = g.rel[k][a], rb = g.rel[k][b];
    if (mandate ? ra >= 50 : ra >= 15 || ra > rb) return;
    out.sanctions.push(k);
    if (rb > -30) out.donors.push(k);
    if (mandate && willFight(g, k, a, b, near)) out.coalition.push(k);
  });
  return out;
}

/** Чем мир ответит на нападение a на b: игроку — предупреждение, ботам — повод передумать. */
export function forecast(g: GameState, a: number, b: number) {
  const veto = P5.find((m) => g.countries[m].alive && p5Vote(g, m, a, b) === 'veto') ?? -1;
  const r = respond(g, a, b, veto < 0);
  return { veto, ...r, loss: sanctionLoss(g, a, new Set(r.sanctions)) };
}

/** Удержит ли бота a от нападения на b страх перед ответом мира. */
export function fearsUN(g: GameState, a: number, b: number): boolean {
  if (warJustice(g, a, b).just) return false;
  const f = forecast(g, a, b);
  const per = g.countries[a].personality;
  const scared = (f.loss / SANCTION_MAX) * SANCTION_FEAR[per] > rand(g);
  if (f.veto >= 0) return scared; // вето прикроет от коалиции, но не от санкций
  let against = 0;
  for (const k of new Set([b, ...alliesOf(g, b), ...f.coalition])) against += STATS[k].power;
  if (STATS[a].power > against * 0.8) return scared; // сверхдержаве коалиция не страшна, санкции — да
  return rand(g) >= UN_RECKLESS[per];
}

// ---------- дело об агрессии ----------
/** a напала на b без причины: ООН заводит дело, через несколько дней собирается Совбез. */
export function openCase(g: GameState, a: number, b: number, treachery: boolean) {
  if (activeCase(g, a, b)) return;
  g.un.push({
    id: g.nextId++, aggressor: a, victim: b, since: g.day, treachery, vote: g.day + VOTE_DAYS,
    sanctions: [], donors: [], coalition: [], aid: { money: 0, arms: 0 }, nextAid: 0, taken: 0,
  });
  const how = treachery ? ', вероломно нарушив пакт' : '';
  if (a === g.player) log(g, `🌐 Мир осуждает наше нападение на ${cname(g, b)}${how}. Совбез ООН соберётся через ${VOTE_DAYS} дн.`, 'bad');
  else if (b === g.player) log(g, `🌐 ${cname(g, a)} напала на нас без причины${how} — созван Совбез ООН`, 'war', false);
  else news(g, `🌐 Экстренное заседание Совбеза ООН: ${cname(g, a)} напала на ${cname(g, b)}${how}`, 'war');
}

/** a сама объявила войну агрессору x — она в коалиции: воюет, пока агрессия не прекратится. */
export function joinCoalition(g: GameState, a: number, x: number) {
  const p = peekPair(g, a, x);
  if (p.war) p.war.un = x;
  for (const cs of g.un) if (cs.aggressor === x && cs.until === undefined && !cs.coalition.includes(a)) cs.coalition.push(a);
  for (const v of victimsOf(g, x)) addRel(g, a, v, 10);
}

/** k вступает в войну с агрессором по мандату ООН. */
function enlist(g: GameState, cs: UNCase, k: number) {
  const a = cs.aggressor;
  if (!cs.coalition.includes(k)) cs.coalition.push(k);
  if (atWar(g, k, a)) return;
  const p = pair(g, k, a);
  p.pact = false;
  p.trade = false;
  p.truce = 0;
  p.war = { since: g.day, aRegions: STATS[Math.min(k, a)].regions.length, bRegions: STATS[Math.max(k, a)].regions.length, un: a };
  addRel(g, k, a, -30);
}

export function tickUN(g: GameState) {
  for (const cs of [...g.un]) {
    if (!g.countries[cs.aggressor].alive) drop(g, cs);
    else if (cs.until !== undefined) {
      if (g.day < cs.until) continue;
      drop(g, cs);
      if (cs.aggressor === g.player) log(g, '🌐 Санкции против нас сняты', 'good');
      else news(g, `🌐 Санкции против страны ${cname(g, cs.aggressor)} сняты`, 'info');
    } else if (!cs.resolved) {
      if (g.day >= cs.vote) councilMeets(g, cs);
    } else if (g.day >= cs.nextAid) sendAid(g, cs);
  }
}

function drop(g: GameState, cs: UNCase) {
  g.un = g.un.filter((x) => x !== cs);
  if (g.event?.id === eventId(cs)) g.event = null;
}

/** Заседание Совбеза: если игрок — постоянный член и не участник войны, сначала ждём его голос. */
function councilMeets(g: GameState, cs: UNCase) {
  const me = g.player;
  const voter = isP5(me) && g.countries[me].alive && me !== cs.aggressor && me !== cs.victim;
  if (voter && !cs.playerVote) {
    if (g.event?.id === eventId(cs)) return;
    if (!g.event) return askPlayer(g, cs);
    if (g.day < cs.vote + VOTE_WAIT) return;
    cs.playerVote = 'abstain';
  }
  resolve(g, cs);
}

function askPlayer(g: GameState, cs: UNCase) {
  const { aggressor: a, victim: b } = cs;
  const A = cname(g, a), B = cname(g, b);
  const others = P5.filter((m) => m !== g.player && g.countries[m].alive).map((m) => `${cname(g, m)} — ${VOTE_NAME[p5Vote(g, m, a, b)]}`);
  g.event = {
    id: eventId(cs), kind: 'un', icon: '🌐', title: 'Совбез ООН: ваш голос', target: a,
    text: `${A} напала на ${B}${cs.treachery ? ', нарушив пакт о ненападении' : ''}. Мы — постоянный член Совета Безопасности: `
      + 'одно наше вето блокирует резолюцию. Если она пройдёт — соседи-добровольцы вступят в войну с агрессором, '
      + `весь мир введёт санкции и эмбарго на оружие. Позиции: ${others.join(', ')}.`,
    options: [
      { label: '✋ За резолюцию', hint: `${B} +15 к отношениям, ${A} −25` },
      { label: '🚫 Вето', hint: `Прикрыть агрессора: ${A} +20, ${B} −25, остальной мир −5` },
      { label: '🤐 Воздержаться', hint: 'Пусть решают другие — отношения не изменятся' },
    ],
  };
  sfx('notify');
}

/** Ответ игрока в окне голосования. */
export function voteUN(g: GameState, option: number) {
  const ev = g.event;
  if (!ev) return;
  g.event = null;
  const cs = g.un.find((x) => eventId(x) === ev.id);
  if (!cs || cs.resolved) return;
  cs.playerVote = (['yes', 'veto', 'abstain'] as const)[option] ?? 'abstain';
  resolve(g, cs);
}

/** Итог голосования: резолюция (коалиция, санкции всего мира, эмбарго) или вето (санкции несогласных), и помощь жертве. */
function resolve(g: GameState, cs: UNCase) {
  const { aggressor: a, victim: b } = cs;
  const me = g.player;
  cs.resolved = true;
  if (g.event?.id === eventId(cs)) g.event = null;
  if (cs.playerVote === 'yes') {
    addRel(g, me, a, -25);
    addRel(g, me, b, 15);
  } else if (cs.playerVote === 'veto') {
    addRel(g, me, a, 20);
    addRel(g, me, b, -25);
    g.countries.forEach((c, k) => { if (c.alive && k !== me && k !== a && k !== b) addRel(g, me, k, -5); });
  }
  const vetoes = P5.filter((m) => g.countries[m].alive && (m === me && cs.playerVote ? cs.playerVote : p5Vote(g, m, a, b)) === 'veto');
  if (vetoes.length) cs.veto = vetoes.includes(a) ? a : vetoes[0];
  const mandate = cs.veto === undefined;
  const r = respond(g, a, b, mandate);
  cs.sanctions = r.sanctions;
  cs.donors = r.donors;
  for (const k of r.sanctions) {
    const p = pair(g, k, a);
    p.trade = false;
    p.grudge = Math.max(p.grudge ?? 0, mandate ? 20 : 12);
    addRel(g, k, a, -15);
  }
  for (const k of r.coalition) enlist(g, cs, k);

  const A = cname(g, a), B = cname(g, b);
  const sanc = r.sanctions.length ? `санкции ввели ${countriesN(r.sanctions.length)}` : 'санкций почти нет';
  const n = r.coalition.length;
  const text = mandate
    ? `Резолюция против страны ${A} принята: ${n ? `${countriesN(n)} ${one(n) ? 'вступает' : 'вступают'} в войну, ` : ''}${sanc}, эмбарго на оружие, ${B} получит помощь`
    : `${cs.veto === me ? 'Мы наложили' : `${cname(g, cs.veto!)} наложила`} вето на резолюцию против страны ${A}. Генассамблея ООН осудила агрессию: ${sanc}, ${B} получит помощь`;
  if (b === me) {
    sfx('treaty');
    log(g, `🌐 ${text}`, 'good', false);
    banner({ icon: '🌐', title: mandate ? 'Весь мир на нашей стороне' : 'Мир помогает нам', text, kind: 'good' });
  } else if (a === me) {
    sfx('alarm');
    log(g, `🌐 ${text}`, 'bad', false);
    banner({ icon: '🌐', title: mandate ? 'ООН против нас' : 'Вето спасло нас от коалиции', text, kind: 'war' });
  } else news(g, `🌐 ${text}`, 'war');
  sendAid(g, cs);
  computeAll(g);
}

/** Месячная помощь жертве: деньги — по силам и по симпатии каждого донора, оружие — из их запасов. */
function sendAid(g: GameState, cs: UNCase) {
  cs.nextAid = g.day + AID_GAP;
  const { aggressor: a, victim: b } = cs;
  const v = g.countries[b];
  if (!v.alive) return;
  const donors = cs.donors.filter((k) => g.countries[k].alive && !atWar(g, k, b) && g.countries[k].money > 0);
  if (!donors.length) return;
  const sympathy = (k: number) => 0.5 + Math.max(0, Math.min(1, (g.rel[k][b] - g.rel[k][a] + 50) / 100));
  const want = donors.map((k) => Math.max(0, g.countries[k].lastGross) * AID_DAYS * sympathy(k));
  const total = want.reduce((s, x) => s + x, 0);
  const cap = Math.max(1000, Math.max(30, v.lastGross) * AID_CAP);
  const km = total > cap ? cap / total : 1;
  // себе каждый донор оставляет 85% комплекта на солдата
  const need = Math.max(0, (v.soldiers + STATS[b].deployed) * 1.3 - v.arms);
  const spare = donors.map((k) => {
    const c = g.countries[k];
    return Math.max(0, Math.min(c.arms * 0.08, c.arms - (c.soldiers + STATS[k].deployed) * 0.85));
  });
  const spareSum = spare.reduce((s, x) => s + x, 0);
  const ka = spareSum > need ? need / spareSum : 1;
  let money = 0, arms = 0;
  donors.forEach((k, j) => {
    const c = g.countries[k];
    const m = Math.min(want[j] * km, c.money * 0.25);
    c.money -= m;
    money += m;
    c.arms -= spare[j] * ka;
    arms += spare[j] * ka;
    addRel(g, k, b, 2);
  });
  v.money += money;
  v.arms += arms;
  cs.aid.money += money;
  cs.aid.arms += arms;
  if (b === g.player) {
    sfx('coins');
    log(g, `📦 Помощь мира: +${fmt(money)} 💰${arms >= 1 ? ` и ${fmt(arms)} 🔫` : ''} — ${countriesN(donors.length)}`, 'good');
  } else if (a === g.player && cs.aid.money === money) {
    log(g, `📦 ${countriesN(donors.length)} снабжают страну ${cname(g, b)} деньгами и оружием`, 'bad', false);
  }
}

// ---------- конец агрессии ----------
/** Мир между a и b: если одна из них напала на другую — дело закрывается. */
export function endWar(g: GameState, a: number, b: number) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const cs = activeCase(g, x, y);
    if (cs) closeCase(g, cs);
  }
}

/** Война агрессора с жертвой окончена: коалиция заключает мир, а если захваченное не вернули — санкции остаются. */
function closeCase(g: GameState, cs: UNCase) {
  if (!cs.resolved) return drop(g, cs); // помирились раньше, чем собрался Совбез
  const { aggressor: a, victim: b } = cs;
  const A = cname(g, a), B = cname(g, b);
  const more = g.un.some((x) => x !== cs && x.aggressor === a && x.until === undefined);
  if (!more) standDown(g, a);
  if (cs.taken > 0 && g.countries[a].alive) {
    cs.until = g.day + ANNEX_DAYS;
    cs.donors = [];
    cs.coalition = [];
    const text = `ООН не признала захват ${cs.taken} рег. страны ${B}: санкции против ${a === g.player ? 'нас' : `страны ${A}`} останутся ещё на 2 года`;
    if (a === g.player || b === g.player) log(g, `🌐 ${text}`, 'info');
    else news(g, `🌐 ${text}`, 'info');
    return;
  }
  drop(g, cs);
  const text = `${A} прекратила агрессию против страны ${B}${more ? '' : ' — санкции сняты'}`;
  if (a === g.player || b === g.player) log(g, `🌐 ${text}`, 'good');
  else news(g, `🌐 ${text}`, 'good');
}

/** Коалиция ООН заключает мир с бывшим агрессором a. */
function standDown(g: GameState, a: number) {
  let n = 0;
  for (const [key, p] of Object.entries(g.pairs)) {
    if (p.war?.un !== a) continue;
    const [x, y] = key.split('-').map(Number);
    makePeace(g, x, y, true);
    p.grudge = Math.max(p.grudge ?? 0, 20);
    n++;
  }
  if (n && a !== g.player) news(g, `🌐 Коалиция ООН (${countriesN(n)}) заключает мир со страной ${cname(g, a)}`, 'good');
}

/** Регион перешёл силой: учёт земель жертвы в руках агрессора. */
export function onConquest(g: GameState, from: number, to: number) {
  for (const cs of g.un) {
    if (cs.aggressor === to && cs.victim === from && cs.until === undefined) cs.taken++;
    else if (cs.aggressor === from && cs.victim === to && cs.taken > 0) {
      cs.taken--;
      if (cs.until !== undefined && cs.taken === 0) cs.until = g.day; // всё вернули — санкции снимутся
    }
  }
}

/** Кому отойдёт регион, отбитый у агрессора: коалиция ООН возвращает земли жертвы законному хозяину. */
export function liberatedOwner(g: GameState, att: number, def: number, rid: number): number {
  if (def < 0 || peekPair(g, att, def).war?.un !== def) return att;
  const orig = REGIONS[rid].origOwner;
  if (orig < 0 || orig === att || !g.countries[orig].alive) return att;
  return activeCase(g, def, orig) ? orig : att;
}

/** Страны не стало: дела против неё закрыты, а если это была жертва — её захват не признан. */
export function onDestroyed(g: GameState, ci: number) {
  for (const cs of g.un.filter((x) => x.aggressor === ci)) drop(g, cs);
  for (const cs of g.un.filter((x) => x.victim === ci && x.until === undefined)) closeCase(g, cs);
  for (const cs of g.un) {
    cs.sanctions = cs.sanctions.filter((k) => k !== ci);
    cs.donors = cs.donors.filter((k) => k !== ci);
    cs.coalition = cs.coalition.filter((k) => k !== ci);
  }
}

// ---------- игрок со стороны ----------
export const aidCost = (g: GameState) => Math.max(1000, Math.max(30, g.countries[g.player].lastGross) * 20);

/** Игрок отправляет жертве помощь из казны. */
export function playerAid(g: GameState, id: number): string | null {
  const cs = g.un.find((x) => x.id === id);
  const me = g.player;
  if (!cs || cs.until !== undefined || !g.countries[cs.victim].alive) return 'Помощь уже не нужна';
  const cost = aidCost(g);
  if (g.countries[me].money < cost) return 'Не хватает денег';
  g.countries[me].money -= cost;
  g.countries[cs.victim].money += cost;
  cs.aid.money += cost;
  addRel(g, me, cs.victim, 15);
  addRel(g, me, cs.aggressor, -5);
  for (const k of cs.donors) addRel(g, me, k, 2);
  g.counters.unAid = (g.counters.unAid ?? 0) + 1;
  sfx('coins');
  return null;
}

/** Игрок вводит санкции против агрессора: торговля с ним разорвана. */
export function playerSanctions(g: GameState, id: number): string | null {
  const cs = g.un.find((x) => x.id === id);
  const me = g.player;
  if (!cs || !cs.resolved) return 'Совбез ещё не проголосовал';
  if (cs.sanctions.includes(me)) return 'Санкции уже введены';
  cs.sanctions.push(me);
  pair(g, me, cs.aggressor).trade = false;
  addRel(g, me, cs.aggressor, -15);
  addRel(g, me, cs.victim, 10);
  for (const k of cs.sanctions) if (k !== me) addRel(g, me, k, 2);
  computeAll(g);
  return null;
}
