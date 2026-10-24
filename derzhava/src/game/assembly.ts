// ООН как организация: Генеральный секретарь и Генеральная Ассамблея. Любая страна (и игрок) вносит резолюции —
// миротворцы, осуждение, гуманитарная помощь, ядерное разоружение, климатическое соглашение; через несколько дней
// голосуют все страны (по отношению к автору и к цели), решает большинство. Братья своей ложи игрока голосуют
// вместе с ним. Раз в пять лет избирают Генсека: постоянный член Совбеза может наложить вето на кандидата,
// Генассамблея выбирает из оставшихся. Генсек — престиж, вес в голосованиях и дешёвые резолюции.
// Дела об агрессии, Совбез и санкции — в un.ts.
import { addRel, atWar, cname, makePeace, peekPair } from './actions';
import { computeAll, STATS } from './economy';
import { fmt } from './format';
import { isMember } from './lodge';
import { arsenalOf, hbombsOf, nukesOf } from './nuclear';
import { inOrder } from './order';
import { banner, log, news, pick, rand, sfx } from './state';
import type { AssemblyState, GameState, GAVote, Personality, TempMod, UNResolution } from './types';
import { countriesN, isAggressor, P5 } from './un';

const VOTE_DAYS = 5; // от внесения резолюции игрока до голосования
const BOT_VOTE_DAYS = 8; // по чужим резолюциям игрок успевает подумать
const SG_TERM = 1825; // Генсека избирают на пять лет
const KEEP = 10; // столько решённых резолюций хранит архив
const THRESHOLD = 8; // «за» или «против» — если позиция страны сильнее этого, иначе воздержится
const SG_VETO = -25; // постоянный член Совбеза накладывает вето на кандидата, к которому относится хуже
export const SG_EVENT = 'un-sg';

const scale = (g: GameState) => Math.max(30, g.countries[g.player].moneyScale);
const alive = (g: GameState) => g.countries.filter((c) => c.alive).map((c) => c.idx);
const one = (n: number) => n % 10 === 1 && n % 100 !== 11;
const votesN = (n: number) => `${n} ${one(n) ? 'голос' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'голоса' : 'голосов'}`;
function mod(g: GameState, i: number, kind: TempMod['kind'], value: number, days: number, label: string) {
  g.countries[i].mods.push({ kind, value, until: g.day + days, label });
}
/** Генсек — наш правитель. */
export const isSG = (g: GameState) => g.assembly.sg === g.player;

export function initAssembly(g: GameState): AssemblyState {
  // по традиции Генсек — не из постоянных членов Совбеза
  const pool = g.countries.filter((c) => c.alive && c.idx !== g.player && !P5.includes(c.idx)).map((c) => c.idx);
  return {
    sg: pool.length ? pick(g, pool) : -1, sgSince: g.day, nextSG: g.day + 700 + Math.floor(rand(g) * 300),
    res: [], cd: {}, nextBot: g.day + 200 + Math.floor(rand(g) * 150),
  };
}

// ---------- кто в беде и кто воюет ----------
/** Почему стране нужна помощь мира (null — не нужна). */
export function inNeed(g: GameState, k: number): string | null {
  if (!g.countries[k].alive) return null;
  if (g.un.some((cs) => cs.victim === k && cs.until === undefined)) return 'жертва агрессии';
  if (STATS[k].hunger > 0) return 'голод';
  if (STATS[k].regions.some((rid) => (g.fallout[rid] ?? 0) > g.day)) return 'радиация';
  if (g.countries[k].stability < 35) return 'смута';
  return null;
}

/** Все войны мира: пары стран. */
function wars(g: GameState): [number, number][] {
  const out: [number, number][] = [];
  for (const [key, p] of Object.entries(g.pairs)) {
    if (!p.war) continue;
    const [a, b] = key.split('-').map(Number);
    if (g.countries[a].alive && g.countries[b].alive) out.push([a, b]);
  }
  return out;
}

/** Побеждает ли k в войне с e: прибавила земель — да, потеряла — нет, иначе — кто сильнее. */
function winning(g: GameState, k: number, e: number) {
  const w = peekPair(g, k, e).war;
  if (!w) return false;
  const start = k < e ? w.aRegions : w.bRegions;
  const now = STATS[k].regions.length;
  if (now !== start) return now > start;
  return STATS[k].power > STATS[e].power;
}

/** Сколько страна k отдаст по резолюции о гуманитарной помощи. */
export function donation(g: GameState, k: number) {
  const c = g.countries[k];
  return Math.max(0, Math.min(c.money * 0.03, Math.max(30, c.lastGross) * 4));
}

// ---------- резолюции ----------
export interface ResTarget { t: number; t2?: number; label: string }
export interface ResDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  cost: number; // × доход в начале партии
  cd: number; // дней до следующей такой же резолюции игрока
  /** Цели для автора (нет — резолюция без цели). */
  targets?: (g: GameState, by: number) => ResTarget[];
  can?: (g: GameState, by: number) => string | null;
  /** Не потеряла ли резолюция смысл к голосованию (например, война уже кончилась). */
  valid?: (g: GameState, r: UNResolution) => boolean;
  /** Позиция страны k: больше нуля — «за», меньше — «против». */
  stance: (g: GameState, k: number, r: UNResolution) => number;
  /** Последствия принятой резолюции; yes — кто голосовал «за». */
  pass: (g: GameState, r: UNResolution, yes: number[]) => string;
  fail?: (g: GameState, r: UNResolution) => void;
  /** Что ждёт игрока, если он проголосует «за» и резолюцию примут. */
  yesHint?: (g: GameState, r: UNResolution) => string;
}

const PEACE_LOVE: Record<Personality, number> = { aggressor: -25, fanatic: -5, cautious: 10, trader: 10, scientist: 5 };
const GREEN: Record<Personality, number> = { aggressor: -15, fanatic: -5, cautious: 5, trader: 8, scientist: 15 };

export const RESOLUTIONS: ResDef[] = [
  { id: 'peace', icon: '🕊️', name: 'Миротворцы ООН', cost: 25, cd: 240,
    desc: 'Голубые каски разводят воюющие стороны: немедленный мир и перемирие на год',
    targets: (g, by) => wars(g)
      .filter(([a, b]) => by === g.player || (a !== g.player && b !== g.player && a !== by && b !== by))
      .map(([a, b]) => ({ t: a, t2: b, label: `${cname(g, a)} — ${cname(g, b)}` })),
    valid: (g, r) => atWar(g, r.target!, r.target2!),
    stance: (g, k, r) => {
      const [a, b] = [r.target!, r.target2!];
      let s = 0;
      let side = false;
      for (const e of [a, b]) {
        if (k !== e && !atWar(g, k, e)) continue;
        side = true;
        // воюющая сторона: проигрывающий просит мира, побеждающий — против
        const foe = k === e ? (e === a ? b : a) : e;
        s += winning(g, k, foe) ? -40 : 40;
      }
      if (side) return s;
      return 20 + PEACE_LOVE[g.countries[k].personality] + g.rel[k][r.by] / 4;
    },
    pass: (g, r) => {
      makePeace(g, r.target!, r.target2!, true);
      return `голубые каски развели страны ${cname(g, r.target!)} и ${cname(g, r.target2!)}: мир и перемирие на год`;
    },
    yesHint: (g, r) => (r.target === g.player || r.target2 === g.player ? 'наша война закончится' : 'отношения с автором +4') },
  { id: 'condemn', icon: '⚠️', name: 'Осудить страну', cost: 15, cd: 180,
    desc: 'Генассамблея осуждает правительство: стабильность там −8, голосовавшие «за» охладеют к нему',
    targets: (g, by) => alive(g).filter((k) => k !== by).map((k) => ({ t: k, label: cname(g, k) })),
    valid: (g, r) => g.countries[r.target!].alive,
    stance: (g, k, r) => {
      const t = r.target!;
      if (k === t) return -100;
      if (peekPair(g, k, t).alliance) return -40;
      return (g.rel[k][r.by] - g.rel[k][t]) / 2 + (isAggressor(g, t) ? 30 : 0) + (atWar(g, k, t) ? 40 : 0);
    },
    pass: (g, r, yes) => {
      const t = r.target!;
      mod(g, t, 'stab', -8, 200, 'Осуждение ООН');
      for (const k of yes) if (k !== t) addRel(g, k, t, -8);
      addRel(g, t, r.by, -25);
      return `стабильность в стране ${cname(g, t)} −8, голосовавшие «за» охладели к её правительству`;
    },
    fail: (g, r) => addRel(g, r.target!, r.by, -15),
    yesHint: (g, r) => (r.target === g.player ? 'осуждают нас: стабильность −8 — голосуйте «против»' : `отношения со страной ${cname(g, r.target!)} −8`) },
  { id: 'aid', icon: '📦', name: 'Гуманитарная помощь', cost: 10, cd: 365,
    desc: 'Мир помогает стране в беде (война, голод, радиация, смута): голосовавшие «за» присылают деньги',
    targets: (g) => alive(g).filter((k) => inNeed(g, k)).map((k) => ({ t: k, label: `${cname(g, k)} · ${inNeed(g, k)}` })),
    valid: (g, r) => g.countries[r.target!].alive,
    stance: (g, k, r) => {
      const t = r.target!;
      if (k === t) return 100;
      if (atWar(g, k, t)) return -100;
      return g.rel[k][t] / 2 + 15;
    },
    pass: (g, r, yes) => {
      const t = r.target!;
      const v = g.countries[t];
      const cap = Math.max(30, v.lastGross) * 40;
      let sum = 0;
      for (const k of yes) {
        if (k === t || sum >= cap) continue;
        const d = Math.min(donation(g, k), cap - sum);
        if (d <= 0) continue;
        g.countries[k].money -= d;
        sum += d;
        addRel(g, t, k, 5);
        if (k === g.player) g.counters.unAid = (g.counters.unAid ?? 0) + 1;
      }
      v.money += sum;
      mod(g, t, 'stab', 3, 180, 'Помощь ООН');
      return `${cname(g, t)} получила ${fmt(sum)} 💰 и гуманитарные грузы`;
    },
    yesHint: (g, r) => (r.target === g.player ? 'помощь получим мы' : `отдадим ≈ ${fmt(donation(g, g.player))} 💰, отношения +5`) },
  { id: 'disarm', icon: '☢️', name: 'Ядерное разоружение', cost: 30, cd: 730,
    desc: 'Кто голосует «за» и держит бомбу — уничтожает половину арсенала и останавливает сборку; ядерные державы против — в немилости',
    can: (g) => (alive(g).some((k) => arsenalOf(g, k) > 0 || g.countries[k].nukeBuild) ? null : 'В мире нет ядерного оружия'),
    stance: (g, k, r) => {
      const c = g.countries[k];
      const n = arsenalOf(g, k) + (c.nukeBuild ? 1 : 0);
      const pers = c.personality === 'aggressor' ? -15 : c.personality === 'scientist' || c.personality === 'trader' ? 5 : 0;
      return (n > 0 ? -25 - 6 * n : 30) + pers + g.rel[k][r.by] / 4;
    },
    pass: (g, _r, yes) => {
      let gone = 0, states = 0;
      for (const k of yes) {
        const c = g.countries[k];
        const n = nukesOf(g, k), h = hbombsOf(g, k);
        if (!n && !h && !c.nukeBuild) continue;
        c.nukes = Math.floor(n / 2);
        c.hbombs = Math.floor(h / 2);
        c.nukeBuild = undefined;
        gone += n - c.nukes + h - c.hbombs;
        states++;
      }
      const holdouts = alive(g).filter((k) => !yes.includes(k) && arsenalOf(g, k) > 0);
      for (const k of yes) for (const x of holdouts) addRel(g, k, x, -10);
      return `уничтожено боеголовок: ${gone} (стран: ${states})${holdouts.length ? `; не подписали ядерные державы: ${holdouts.map((k) => cname(g, k)).join(', ')}` : ''}`;
    },
    yesHint: (g) => (arsenalOf(g, g.player) > 0 || g.countries[g.player].nukeBuild
      ? `уничтожим половину своего арсенала (${arsenalOf(g, g.player)}) и сборку`
      : 'нам разоружать нечего') },
  { id: 'climate', icon: '🌍', name: 'Климатическое соглашение', cost: 15, cd: 730,
    desc: 'Все, кто голосует «за», на два года: урожай +5%, стабильность +2, но производство −2%',
    stance: (g, k, r) => 12 + GREEN[g.countries[k].personality] + g.rel[k][r.by] / 4,
    pass: (g, _r, yes) => {
      for (const k of yes) {
        mod(g, k, 'food', 0.05, 730, 'Климатическое соглашение');
        mod(g, k, 'stab', 2, 730, 'Климатическое соглашение');
        mod(g, k, 'prod', -0.02, 730, 'Климатическое соглашение');
      }
      return `соглашение подписали: ${countriesN(yes.length)} — урожай +5%, стабильность +2, производство −2% на два года`;
    },
    yesHint: () => 'на 2 года: урожай +5%, стабильность +2, производство −2%' },
];
export const RES_BY_ID = Object.fromEntries(RESOLUTIONS.map((r) => [r.id, r])) as Record<string, ResDef>;

export function resTitle(g: GameState, r: Pick<UNResolution, 'kind' | 'target' | 'target2'>) {
  const def = RES_BY_ID[r.kind];
  const who = r.target === undefined ? '' : `: ${cname(g, r.target)}${r.target2 !== undefined ? ` — ${cname(g, r.target2)}` : ''}`;
  return `${def?.icon ?? '📜'} ${def?.name ?? 'Резолюция'}${who}`;
}

/** Генсеку резолюции вдвое дешевле и вносятся вдвое чаще. */
export const resCost = (g: GameState, def: ResDef) => def.cost * scale(g) * (isSG(g) ? 0.5 : 1);
const resCd = (g: GameState, def: ResDef) => Math.round(def.cd * (isSG(g) ? 0.5 : 1));
export const resWait = (g: GameState, def: ResDef) => Math.max(0, Math.ceil((g.assembly.cd[def.id] ?? 0) - g.day));
export const pending = (g: GameState) => g.assembly.res.filter((r) => r.passed === undefined);

// ---------- голосование ----------
/** Голос страны k (noise — случайный разброс при настоящем голосовании). */
function voteOf(g: GameState, k: number, r: UNResolution, def: ResDef, noise = 0): GAVote {
  const me = g.player;
  if (k === r.by) return 'yes';
  if (k === me) return r.by === me ? 'yes' : r.myVote ?? 'abstain';
  let s = def.stance(g, k, r) + noise;
  const mv = r.by === me ? 'yes' : r.myVote;
  // о себе самой страна решает сама, чей бы братом она ни была
  if ((mv === 'yes' || mv === 'no') && k !== r.target && k !== r.target2) {
    const dir = mv === 'yes' ? 1 : -1;
    // братья нашей ложи: официальная (наблюдатель ООН) голосует вместе с мастером, тайная — прислушивается
    if (inOrder(g, k)) {
      if (g.order!.official) return mv;
      s += 30 * dir;
    }
    if (g.lodge.status === 'member' && isMember(g, k)) s += 12 * dir; // братья «Всевидящего ока» тоже помнят о нас
    if (isSG(g)) s += 10 * dir; // вес Генсека
  }
  return s > THRESHOLD ? 'yes' : s < -THRESHOLD ? 'no' : 'abstain';
}

/** Прогноз голосования (без случайности). */
export function forecastRes(g: GameState, r: UNResolution) {
  const def = RES_BY_ID[r.kind];
  let yes = 0, no = 0, abstain = 0;
  for (const k of alive(g)) {
    const v = voteOf(g, k, r, def);
    if (v === 'yes') yes++;
    else if (v === 'no') no++;
    else abstain++;
  }
  return { yes, no, abstain, pass: yes > no && yes >= 3 };
}

/** Черновик резолюции игрока — для прогноза до внесения. */
export const draft = (g: GameState, kind: string, t?: number, t2?: number): UNResolution =>
  ({ id: -1, kind, by: g.player, target: t, target2: t2, day: g.day, vote: g.day + VOTE_DAYS, myVote: 'yes' });

function submit(g: GameState, kind: string, by: number, days: number, t?: number, t2?: number): UNResolution {
  const r: UNResolution = { id: g.nextId++, kind, by, target: t, target2: t2, day: g.day, vote: g.day + days };
  g.assembly.res.unshift(r);
  return r;
}

export function proposeError(g: GameState, kind: string, t?: number, t2?: number): string | null {
  const def = RES_BY_ID[kind];
  const me = g.player;
  if (!def) return 'Нет такой резолюции';
  if (pending(g).some((r) => r.by === me)) return 'Наша резолюция уже на голосовании';
  const wait = resWait(g, def);
  if (wait > 0) return `Снова можно через ${wait} дн.`;
  if (g.countries[me].money < resCost(g, def)) return 'Не хватает денег';
  const err = def.can?.(g, me);
  if (err) return err;
  if (def.targets) {
    const list = def.targets(g, me);
    if (!list.length) return 'Нет подходящих целей';
    if (t !== undefined && !list.some((x) => x.t === t && x.t2 === t2)) return 'Недопустимая цель';
  }
  return null;
}

/** Игрок вносит резолюцию в Генассамблею. */
export function proposeRes(g: GameState, kind: string, t?: number, t2?: number): string | null {
  const err = proposeError(g, kind, t, t2);
  if (err) return err;
  const def = RES_BY_ID[kind];
  if (def.targets && t === undefined) return 'Выберите цель';
  const me = g.player;
  g.countries[me].money -= resCost(g, def);
  g.assembly.cd[kind] = g.day + resCd(g, def);
  const r = submit(g, kind, me, VOTE_DAYS, t, t2);
  r.myVote = 'yes';
  g.counters.unRes = (g.counters.unRes ?? 0) + 1;
  sfx('paper');
  log(g, `🌐 Мы внесли в Генассамблею резолюцию «${resTitle(g, r)}». Голосование через ${VOTE_DAYS} дн.`, 'info', false);
  return null;
}

/** Голос игрока по чужой резолюции. */
export function castVote(g: GameState, id: number, v: GAVote): string | null {
  const r = g.assembly.res.find((x) => x.id === id);
  if (!r || r.passed !== undefined) return 'Голосование уже закончилось';
  if (r.by === g.player) return 'Это наша резолюция — мы, конечно, «за»';
  r.myVote = v;
  return null;
}

function tally(g: GameState, r: UNResolution) {
  const def = RES_BY_ID[r.kind];
  const me = g.player;
  const title = resTitle(g, r);
  const mine = r.by === me || r.target === me || r.target2 === me;
  if (!def || (def.valid && !def.valid(g, r))) {
    r.passed = false;
    r.yes = [];
    r.no = [];
    if (mine) log(g, `🌐 Резолюция «${title}» снята с голосования: она потеряла смысл`, 'info', false);
    return;
  }
  const yes: number[] = [], no: number[] = [];
  for (const k of alive(g)) {
    const v = voteOf(g, k, r, def, (rand(g) - 0.5) * 12);
    if (v === 'yes') yes.push(k);
    else if (v === 'no') no.push(k);
  }
  r.yes = yes;
  r.no = no;
  r.passed = yes.length > no.length && yes.length >= 3;
  // автор помнит, кто его поддержал
  if (r.by !== me && r.myVote === 'yes') addRel(g, me, r.by, 4);
  if (r.by !== me && r.myVote === 'no') addRel(g, me, r.by, -4);
  const score = `${yes.length} за, ${no.length} против`;
  const text = r.passed
    ? `✅ Генассамблея приняла резолюцию «${title}» (${score}): ${def.pass(g, r, yes)}`
    : `❌ Генассамблея отклонила резолюцию «${title}» (${score})`;
  if (!r.passed) def.fail?.(g, r);
  if (r.by === me && r.passed) g.counters.unResPassed = (g.counters.unResPassed ?? 0) + 1;
  if (mine) {
    const good = r.kind === 'condemn' && r.target === me ? !r.passed : r.passed;
    sfx(good ? 'treaty' : 'alarm');
    log(g, `🌐 ${text}`, good ? 'good' : 'bad', false);
    banner({ icon: '🌐', title: r.passed ? 'Резолюция принята' : 'Резолюция отклонена', text: `${title} — ${score}`, kind: good ? 'good' : 'war' });
  } else if (r.myVote && r.myVote !== 'abstain') log(g, `🌐 ${text}`, 'info');
  else news(g, `🌐 ${text}`, 'info');
  computeAll(g);
}

// ---------- резолюции ботов ----------
function botProposal(g: GameState) {
  const A = g.assembly;
  const me = g.player;
  A.nextBot = g.day + 160 + Math.floor(rand(g) * 160);
  if (pending(g).some((r) => r.by !== me)) return; // одна чужая резолюция за раз
  const bots = alive(g).filter((k) => k !== me);
  if (bots.length < 2) return;
  const opts: { by: number; kind: string; t?: number; t2?: number; w: number }[] = [];
  // миротворцы — для затяжных войн между ботами
  for (const [a, b] of wars(g)) {
    if (a === me || b === me || g.day - (peekPair(g, a, b).war?.since ?? g.day) < 240) continue;
    const by = bots.filter((k) => k !== a && k !== b && !atWar(g, k, a) && !atWar(g, k, b));
    if (by.length) opts.push({ by: pick(g, by), kind: 'peace', t: a, t2: b, w: 3 });
  }
  // осудить заклятого врага (особенно агрессора)
  for (const by of bots) {
    const foes = alive(g).filter((t) => t !== by && g.rel[by][t] < -45);
    if (!foes.length) continue;
    const t = foes.reduce((x, y) => (g.rel[by][y] < g.rel[by][x] ? y : x));
    opts.push({ by, kind: 'condemn', t, w: isAggressor(g, t) ? 2 : 0.6 });
  }
  // страна в беде просит помощи
  for (const k of bots) if (inNeed(g, k)) opts.push({ by: k, kind: 'aid', t: k, w: 1.5 });
  // разоружение предлагают неядерные миролюбцы, когда бомба есть хотя бы у двоих
  if (alive(g).filter((k) => arsenalOf(g, k) > 0).length >= 2) {
    const by = bots.filter((k) => arsenalOf(g, k) === 0 && ['scientist', 'trader', 'cautious'].includes(g.countries[k].personality));
    if (by.length) opts.push({ by: pick(g, by), kind: 'disarm', w: 1 });
  }
  const greenRecent = A.res.some((r) => r.kind === 'climate' && r.passed && g.day - r.vote < 730);
  if (!greenRecent) {
    const by = bots.filter((k) => ['scientist', 'trader'].includes(g.countries[k].personality));
    if (by.length) opts.push({ by: pick(g, by), kind: 'climate', w: 0.8 });
  }
  if (!opts.length) return;
  let x = rand(g) * opts.reduce((s, o) => s + o.w, 0);
  const o = opts.find((p) => (x -= p.w) <= 0) ?? opts[opts.length - 1];
  const r = submit(g, o.kind, o.by, BOT_VOTE_DAYS, o.t, o.t2);
  const vs = r.target === me || r.target2 === me;
  if (vs) sfx('alarm');
  log(g, `🌐 Генассамблея: ${cname(g, o.by)} вносит резолюцию «${resTitle(g, r)}». Наш голос — во вкладке «Армия → 🌐 ООН», голосование через ${BOT_VOTE_DAYS} дн.`,
    vs && r.kind === 'condemn' ? 'bad' : 'info', vs);
}

// ---------- Генеральный секретарь ----------
/** Кандидаты-боты: два самых уважаемых в мире правителя не из пятёрки (и Генсек, если хочет на второй срок). */
function botCandidates(g: GameState): number[] {
  const me = g.player;
  const pool = alive(g).filter((k) => k !== me && !P5.includes(k));
  const respect = (k: number) => alive(g).reduce((s, j) => s + (j === k ? 0 : g.rel[j][k]), 0);
  const top = pool.sort((a, b) => respect(b) - respect(a)).slice(0, 2);
  const sg = g.assembly.sg;
  if (sg >= 0 && sg !== me && g.countries[sg].alive && !P5.includes(sg) && !top.includes(sg)) top.push(sg);
  return top;
}

/** Итог выборов Генсека: вето Совбеза и голоса Генассамблеи. bonus — дипломатическая кампания игрока, myPick — за кого голосует игрок. */
export function sgVotes(g: GameState, cands: number[], myPick: number, bonus = 0) {
  const me = g.player;
  const veto: Record<number, number> = {};
  for (const c of cands) {
    for (const m of P5) {
      if (m === c || !g.countries[m].alive) continue;
      if (m === me) continue; // своё вето игрок не тратит
      if (c === me && (inOrder(g, m) || (g.lodge.status === 'member' && isMember(g, m)))) continue; // брат не наложит вето
      if (g.rel[m][c] + (c === me ? bonus : 0) < SG_VETO) {
        veto[c] = m;
        break;
      }
    }
  }
  const ok = cands.filter((c) => veto[c] === undefined);
  const votes: Record<number, number> = {};
  for (const c of cands) votes[c] = 0;
  if (!ok.length) return { veto, votes, winner: -1 };
  for (const k of alive(g)) {
    let best = -1, bs = -Infinity;
    if (k === me) best = ok.includes(myPick) ? myPick : -1;
    else {
      for (const c of ok) {
        const s = k === c ? 1000 : g.rel[k][c] + (c === me ? bonus + (inOrder(g, k) ? 40 : 0) : 0);
        if (s > bs) { bs = s; best = c; }
      }
    }
    if (best >= 0) votes[best]++;
  }
  const winner = ok.reduce((a, c) => (votes[c] > votes[a] ? c : a));
  return { veto, votes, winner };
}

export const campaignCost = (g: GameState) => scale(g) * 100;
const CAMPAIGN = 15; // насколько кампания поднимает отношение к нам при выборах

function sgElection(g: GameState) {
  const A = g.assembly;
  const me = g.player;
  if (!g.countries[me].alive) return electSG(g, 'skip');
  if (A.sgAsked) {
    // ответ ждём в окне; если окно пропало — считаем, что мы не участвуем
    if (g.event?.id !== SG_EVENT) electSG(g, 'skip');
    return;
  }
  if (g.event) {
    if (g.day > A.nextSG + 15) electSG(g, 'skip');
    return;
  }
  const bots = botCandidates(g);
  if (!bots.length) return electSG(g, 'skip');
  A.sgAsked = true;
  const fav = sgVotes(g, bots, -1).winner;
  const with0 = sgVotes(g, [...bots, me], me);
  const with1 = sgVotes(g, [...bots, me], me, CAMPAIGN);
  const chance = (r: ReturnType<typeof sgVotes>) => (r.veto[me] !== undefined
    ? `${cname(g, r.veto[me])} наложит вето`
    : r.winner === me ? `победа: ${votesN(r.votes[me])}` : `проиграем: ${votesN(r.votes[me])} против ${votesN(r.votes[r.winner] ?? 0)}`);
  g.event = {
    id: SG_EVENT, kind: 'un', icon: '🌐', title: 'Выборы Генерального секретаря ООН', target: fav >= 0 ? fav : undefined,
    text: `Срок Генсека${A.sg >= 0 && g.countries[A.sg].alive ? ` (${cname(g, A.sg)})` : ''} истёк. Совбез рекомендует кандидатов — `
      + 'любой постоянный член может наложить вето, — а Генассамблея голосует. '
      + `Кандидаты: ${bots.map((k) => cname(g, k)).join(', ')}. Генсек на пять лет: престиж (стабильность +3), вес в голосованиях, резолюции вдвое дешевле.`,
    options: [
      { label: '🙋 Выдвинуть себя', hint: chance(with0) },
      { label: '✈️ Дипломатическое турне и выдвижение', hint: `−${fmt(campaignCost(g))} 💰, отношения со всеми +5 — ${chance(with1)}` },
      fav >= 0
        ? { label: `🤝 Поддержать: ${cname(g, fav)}`, hint: `${cname(g, fav)} станет Генсеком и запомнит это: отношения +20` }
        : { label: '🤐 Не участвовать', hint: 'пусть решают другие' },
    ],
  };
  sfx('notify');
}

/** Ответ игрока в окне выборов Генсека. */
export function resolveSGEvent(g: GameState, option: number) {
  g.event = null;
  electSG(g, (['run', 'campaign', 'support'] as const)[option] ?? 'skip');
}

function electSG(g: GameState, mode: 'run' | 'campaign' | 'support' | 'skip') {
  const A = g.assembly;
  const me = g.player;
  A.sgAsked = false;
  A.nextSG = g.day + SG_TERM;
  const bots = botCandidates(g);
  let bonus = 0;
  if (mode === 'campaign') {
    const cost = campaignCost(g);
    if (g.countries[me].money >= cost) {
      g.countries[me].money -= cost;
      for (const k of alive(g)) if (k !== me) addRel(g, me, k, 5);
      bonus = CAMPAIGN;
    } else log(g, '💰 Денег на турне не хватило — выдвигаемся без него', 'bad');
  }
  const running = mode === 'run' || mode === 'campaign';
  const cands = running ? [...bots, me] : bots;
  if (!cands.length) return;
  const fav = sgVotes(g, bots, -1).winner;
  const myPick = running ? me : mode === 'support' ? fav : -1;
  const res = sgVotes(g, cands, myPick, bonus);
  const prev = A.sg;
  // если вето на всех — прежний Генсек остаётся ещё на срок
  const winner = res.winner >= 0 ? res.winner : prev >= 0 && g.countries[prev].alive ? prev : -1;
  A.sg = winner;
  A.sgSince = g.day;
  if (mode === 'support' && fav >= 0) addRel(g, me, fav, 20);
  if (winner === me) {
    g.counters.sgTerms = (g.counters.sgTerms ?? 0) + 1;
    sfx('achievement');
    log(g, `🌐 Мы избраны Генеральным секретарём ООН: ${votesN(res.votes[me])}`, 'good', false);
    banner({ icon: '🌐', title: 'Генеральный секретарь ООН', text: 'Пять лет мир слушает нас: стабильность +3, резолюции вдвое дешевле', kind: 'gold' });
  } else if (running) {
    sfx('defeat');
    const why = res.veto[me] !== undefined ? `${cname(g, res.veto[me])} наложила вето на нашу кандидатуру` : `у нас ${votesN(res.votes[me])}`;
    log(g, `🌐 Генсеком ООН избрана страна ${winner >= 0 ? cname(g, winner) : '—'}: ${why}`, 'bad', false);
  } else if (winner >= 0) {
    if (prev === me) log(g, `🌐 Наш срок Генсека окончен. Новый Генеральный секретарь ООН — ${cname(g, winner)}`, 'info');
    else news(g, `🌐 Новый Генеральный секретарь ООН — правитель страны ${cname(g, winner)}`, 'info');
  }
  computeAll(g);
}

// ---------- день ----------
export function tickAssembly(g: GameState) {
  const A = g.assembly;
  if (A.sg >= 0 && !g.countries[A.sg].alive) {
    A.sg = -1;
    A.nextSG = Math.min(A.nextSG, g.day + 30);
  }
  for (const r of A.res) if (r.passed === undefined && g.day >= r.vote) tally(g, r);
  // архив: всё, что ещё голосуется, и последние решённые
  let kept = 0;
  A.res = A.res.filter((r) => r.passed === undefined || kept++ < KEEP);
  if (g.day >= A.nextBot) botProposal(g);
  if (g.day >= A.nextSG) sgElection(g);
}
