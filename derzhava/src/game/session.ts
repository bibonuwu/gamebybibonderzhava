// Чрезвычайная сессия ООН: важное решение страны — ядерное испытание или удар, отмена или кража выборов, переворот,
// тайная война против соседа — и через несколько дней Генассамблея решает, как ответить. Сессию созывает пострадавшая
// страна, Генсек или самый возмущённый член ООН. Обвиняемая может выступить с речью, заранее выполнить требование
// или демонстративно игнорировать ООН. Принятая резолюция — санкции всех, кто голосовал «за» (после ядерного удара —
// и эмбарго), пока страна не выполнит требование или не выйдет срок. Союзники и братья по ложе заступаются,
// а боты боятся сессий и реже решаются на такие шаги. Голосование, лоббирование и архив — общие с Генассамблеей (assembly.ts).
import { addRel, atWar, cname, neighborCountries, pair, peekPair } from './actions';
import { donation, isSG, pending, resTitle, submit, votesOf, type ResDef } from './assembly';
import { GOVS } from './defs';
import { computeAll, SANCTION_MAX, sanctionLoss } from './economy';
import { isFree, observeElections } from './elections';
import { fmt, fmtDays } from './format';
import { isMember, lodgeShield, quitLodges } from './lodge';
import { arsenalOf } from './nuclear';
import { inOrder } from './order';
import { banner, log, news, rand, sfx } from './state';
import type { GameState, GovType, Personality, TempMod, UNResolution, UNSanctions } from './types';
import { countriesN, isAggressor, isP5, SANCTION_FEAR } from './un';
import { vb } from './world';

const SESSION_DAYS = 6; // от важного решения до голосования
const EVENT = 'uns-';
const eventId = (r: UNResolution) => `${EVENT}${r.id}`;
export const isSessionEvent = (id: string) => id.startsWith(EVENT);

const alive = (g: GameState) => g.countries.filter((c) => c.alive).map((c) => c.idx);
const income = (g: GameState, k: number) => Math.max(30, g.countries[k].lastGross);
const pct = (x: number) => Math.round(x * 100);
function mod(g: GameState, i: number, kind: TempMod['kind'], value: number, days: number, label: string) {
  g.countries[i].mods.push({ kind, value, until: g.day + days, label });
}

type Terms = Pick<UNSanctions, 'victim' | 'gov'>;
const terms = (r: UNResolution): Terms => ({ victim: r.target2, gov: r.gov });

/** Чрезвычайная сессия: резолюцию созывает сама ООН, а выполнив требование, страна снимает санкции. */
export interface SessionDef extends ResDef {
  demand: string; // чего ООН требует от обвиняемой
  days: number; // срок санкций
  k: number; // их сила (1 — как против агрессора)
  embargo?: boolean;
  /** Почему страна t не может выполнить требование (null — может). */
  complyError?: (g: GameState, t: number, s: Terms) => string | null;
  complyHint: (g: GameState, t: number, s: Terms) => string;
  comply: (g: GameState, t: number, s: Terms) => void;
}

/** Общее для всех сессий: о себе и о пострадавшей решают сами, союзники и братья по ложе заступаются,
 *  речь обвиняемой и её вызов ООН двигают колеблющихся. */
function judge(base: (g: GameState, k: number, r: UNResolution) => number) {
  return (g: GameState, k: number, r: UNResolution) => {
    const t = r.target!;
    if (k === t) return -100;
    if (k === r.target2) return 100;
    let s = base(g, k, r) + (g.rel[k][r.by] - g.rel[k][t]) / 4;
    if (peekPair(g, k, t).alliance) s -= 40;
    if (atWar(g, k, t)) s += 40;
    if (isMember(g, t) && isMember(g, k)) s -= 30; // брат по «Всевидящему оку» своего не сдаст
    if (t === g.player && lodgeShield(g, k)) s -= 60; // «Кулуары ООН»
    if (r.speech && g.rel[k][t] > -40) s -= r.speech;
    if (r.defiant) s += 12;
    return s;
  };
}

/** Что ждёт игрока, проголосовавшего «за». */
const joinHint = (g: GameState, r: UNResolution) => `мы тоже введём санкции: торговля со страной ${cname(g, r.target!)} прекратится, отношения с ней −10`;
const reparations = (g: GameState, t: number) => Math.max(1000, income(g, t) * 150);
const compensation = (g: GameState, t: number) => Math.max(500, income(g, t) * 60);
const NUKE_FEAR: Record<Personality, number> = { aggressor: -10, fanatic: -4, cautious: 8, trader: 5, scientist: 6 };
const common = { cost: 0, cd: 0, valid: (g: GameState, r: UNResolution) => g.countries[r.target!].alive, yesHint: joinHint };

export const SESSIONS: SessionDef[] = [
  { ...common, id: 'nuketest', icon: '☢️', name: 'Ядерное испытание', days: 365, k: 0.6,
    desc: 'Мир требует моратория на ядерное оружие: санкции, пока страна не остановит сборку боеголовок',
    demand: 'мораторий — два года не собирать боеголовки',
    stance: judge((g, k, r) => {
      const t = r.target!;
      const c = g.countries[k];
      const nuclear = arsenalOf(g, k) > 0 || !!c.nukeTested;
      return 12 + (nuclear ? -12 : 8) + NUKE_FEAR[c.personality] + (neighborCountries(g, t).has(k) ? 12 : 0) + (isAggressor(g, t) ? 15 : 0);
    }),
    pass: (g, r, yes) => impose(g, r, yes),
    complyHint: () => 'сборка боеголовок остановлена на 2 года (готовые остаются)',
    comply: (g, t) => {
      const c = g.countries[t];
      c.nukeBuild = undefined;
      c.nukeFreeze = g.day + 730;
    } },
  { ...common, id: 'nukestrike', icon: '🚀', name: 'Ядерный удар', days: 1095, k: 1, embargo: true,
    desc: 'Мир отвечает на применение ядерного оружия: санкции и эмбарго на три года, пострадавшей — помощь',
    demand: 'репарации пострадавшей стране',
    stance: judge((g, k, r) => {
      const v = r.target2;
      if (v === undefined) return 40;
      return 40 + (peekPair(g, k, v).alliance ? 30 : 0) - (atWar(g, k, v) ? 45 : 0);
    }),
    pass: (g, r, yes) => {
      const text = impose(g, r, yes);
      mod(g, r.target!, 'stab', -8, 365, 'Проклятие мира');
      const v = r.target2;
      if (v === undefined || !g.countries[v].alive) return text;
      let sum = 0;
      for (const k of yes) {
        if (k === v || k === r.target) continue;
        const d = donation(g, k);
        g.countries[k].money -= d;
        sum += d;
      }
      g.countries[v].money += sum;
      return `${text}; ${cname(g, v)} ${vb(v, 'получил')} ${fmt(sum)} 💰 помощи`;
    },
    complyError: (g, t) => (g.countries[t].money < reparations(g, t) ? `Нужно ${fmt(reparations(g, t))} 💰` : null),
    complyHint: (g, t, s) => `−${fmt(reparations(g, t))} 💰${s.victim !== undefined ? ` — стране ${cname(g, s.victim)}` : ''}`,
    comply: (g, t, s) => {
      const v = reparations(g, t);
      g.countries[t].money -= v;
      if (s.victim !== undefined && g.countries[s.victim].alive) g.countries[s.victim].money += v;
    },
    yesHint: (g, r) => `${joinHint(g, r)}; пострадавшей отдадим ≈ ${fmt(donation(g, g.player))} 💰` },
  { ...common, id: 'democracy', icon: '🗳️', name: 'Попрание демократии', days: 365, k: 0.5,
    desc: 'Демократии мира требуют честных выборов: санкции, пока выборы не пройдут под наблюдением ООН',
    demand: 'выборы под наблюдением ООН через 60 дней',
    stance: judge((g, k) => {
      const gov = g.countries[k].gov;
      return gov === 'democracy' ? 26 : gov === 'republic' ? 16 : gov === 'dictatorship' ? -20 : -2;
    }),
    pass: (g, r, yes) => {
      const text = impose(g, r, yes);
      mod(g, r.target!, 'stab', -4, 200, 'Международная изоляция');
      return text;
    },
    complyError: (g, t) => (t !== g.player ? 'Выборы под наблюдением ООН проводит только игрок'
      : !isFree(g.countries[t].gov) ? 'Выборы бывают только при демократии и республике' : null),
    complyHint: () => 'выборы через 60 дней — подтасовать или отменить их нельзя',
    comply: (g) => observeElections(g) },
  { ...common, id: 'coup', icon: '🔥', name: 'Государственный переворот', days: 365, k: 0.5,
    desc: 'Мир не признаёт хунту: санкции, пока страна не вернёт законную власть',
    demand: 'вернуть конституционный порядок',
    stance: judge((g, k) => {
      const gov = g.countries[k].gov;
      return 12 + (isFree(gov) ? 10 : gov === 'dictatorship' ? -12 : 0);
    }),
    pass: (g, r, yes) => {
      mod(g, r.target!, 'stab', -6, 200, 'Хунту не признали');
      return `хунту не признали — ${impose(g, r, yes)}`;
    },
    complyHint: (_g, _t, s) => `вернуть строй «${GOVS[s.gov ?? 'republic'].name}»; новая власть выйдет из тайной ложи`,
    comply: (g, t, s) => {
      const c = g.countries[t];
      if (s.gov && s.gov !== c.gov) {
        c.gov = s.gov;
        c.govChangedDay = g.day;
      }
      mod(g, t, 'stab', 4, 200, 'Законная власть вернулась');
      quitLodges(g, t);
    } },
  { ...common, id: 'meddle', icon: '🕵️', name: 'Вмешательство в чужие дела', days: 365, k: 0.5,
    desc: 'Мир осуждает тайную войну против соседа: санкции, пока страна не прекратит вмешательство и не заплатит компенсацию',
    demand: 'прекратить вмешательство и выплатить компенсацию',
    stance: judge((g, k, r) => {
      const v = r.target2;
      return 10 + (v === undefined ? 0 : g.rel[k][v] / 4 + (peekPair(g, k, v).alliance ? 25 : 0));
    }),
    pass: (g, r, yes) => impose(g, r, yes),
    complyError: (g, t) => (g.countries[t].money < compensation(g, t) ? `Нужно ${fmt(compensation(g, t))} 💰` : null),
    complyHint: (g, t, s) => `−${fmt(compensation(g, t))} 💰${s.victim !== undefined ? ` стране ${cname(g, s.victim)}` : ''}, мятежники там останутся без нашего оружия`,
    comply: (g, t, s) => {
      const v = compensation(g, t);
      g.countries[t].money -= v;
      if (s.victim !== undefined && g.countries[s.victim].alive) g.countries[s.victim].money += v;
      for (const rb of g.rebels) if (rb.sponsor === t && (s.victim === undefined || rb.country === s.victim)) rb.sponsor = -1;
    } },
];
export const SESSION_BY_ID = Object.fromEntries(SESSIONS.map((s) => [s.id, s])) as Record<string, SessionDef>;

// ---------- созыв ----------
/** Кто созывает сессию: пострадавшая страна, Генсек или самый возмущённый член ООН. */
function convener(g: GameState, t: number, v?: number): number {
  if (v !== undefined) return v;
  const me = g.player;
  const sg = g.assembly.sg;
  if (sg >= 0 && sg !== t && sg !== me && g.countries[sg].alive && g.rel[sg][t] < 30 && !peekPair(g, sg, t).alliance) return sg;
  const pool = alive(g).filter((k) => k !== t && k !== me && !peekPair(g, k, t).alliance);
  return pool.length ? pool.reduce((a, k) => (g.rel[k][t] < g.rel[a][t] ? k : a)) : -1;
}

/** Страна t приняла важное решение: ООН созывает чрезвычайную сессию (а если санкции за то же уже действуют — продлевает их). */
export function convene(g: GameState, kind: string, t: number, o: { victim?: number; note?: string; gov?: GovType } = {}) {
  const def = SESSION_BY_ID[kind];
  const me = g.player;
  if (!def || !g.countries[t]?.alive) return;
  if (pending(g).some((r) => r.session && r.kind === kind && r.target === t)) return;
  const why = o.note ?? def.name.toLowerCase();
  const on = g.assembly.sanctions.find((s) => s.kind === kind && s.target === t);
  if (on) {
    on.until = Math.max(on.until, g.day + def.days);
    const text = `ООН продлила санкции против ${t === me ? 'нас' : `страны ${cname(g, t)}`}: ${why}`;
    if (t === me) log(g, `🌐 ${text}`, 'bad');
    else news(g, `🌐 ${text}`, 'info');
    return;
  }
  const v = o.victim !== undefined && o.victim !== t && g.countries[o.victim]?.alive ? o.victim : undefined;
  const by = convener(g, t, v);
  if (by < 0) return;
  const r = submit(g, kind, by, SESSION_DAYS, t, v);
  r.session = true;
  r.note = o.note;
  r.gov = o.gov;
  if (t === me) {
    r.myVote = 'no';
    g.counters.sessionsVsUs = (g.counters.sessionsVsUs ?? 0) + 1;
    sfx('alarm');
    log(g, `🌐 Чрезвычайная сессия ООН о нас: ${why}. Голосование через ${SESSION_DAYS} дн. — вкладка «Армия → 🌐 ООН»`, 'bad');
  } else if (by === me) {
    log(g, `🌐 По нашему требованию созвана чрезвычайная сессия ООН «${resTitle(g, r)}»: ${why}. Голосование через ${SESSION_DAYS} дн.`, 'info');
  } else news(g, `🌐 Чрезвычайная сессия ООН «${resTitle(g, r)}»: ${why}`, 'war');
}

// ---------- прогноз ----------
function outlook(g: GameState, r: UNResolution) {
  const def = SESSION_BY_ID[r.kind];
  const t = r.target!;
  const v = votesOf(g, r);
  const loss = v.pass ? sanctionLoss(g, t, new Set(v.yes.filter((k) => k !== t))) * def.k : 0;
  return { yes: v.yes.length, no: v.no.length, pass: v.pass, loss, days: Math.round(def.days * (r.defiant ? 1.5 : 1)) };
}
export const sessionOutlook = (g: GameState, r: UNResolution) => outlook(g, r);

/** Чем кончится сессия о стране t, если созвать её сейчас (без случайностей). */
export function sessionForecast(g: GameState, kind: string, t: number, victim?: number) {
  const by = convener(g, t, victim);
  if (!SESSION_BY_ID[kind] || by < 0) return null;
  return outlook(g, { id: -1, kind, by, target: t, target2: victim, day: g.day, vote: g.day, session: true, myVote: t === g.player ? 'no' : undefined });
}

/** Подсказка перед решением: что скажет ООН. */
export function sessionPreview(g: GameState, kind: string, t: number, victim?: number): string {
  const f = sessionForecast(g, kind, t, victim);
  if (!f) return '';
  const def = SESSION_BY_ID[kind];
  return `🌐 Соберётся чрезвычайная сессия ООН. Прогноз: ${f.yes} за, ${f.no} против — `
    + (f.pass ? `санкции (−${pct(f.loss)}% производства на ${fmtDays(f.days)}), пока не выполним требование: ${def.demand}.` : 'резолюцию, скорее всего, отклонят.');
}

/** Удержит ли бота i страх перед сессией ООН. Решив не рисковать, он долго не возвращается к этой мысли. */
export function fearsSession(g: GameState, i: number, kind: string, victim?: number): boolean {
  const c = g.countries[i];
  if ((c.aiFlags.unWait ?? 0) > g.day) return true;
  const f = sessionForecast(g, kind, i, victim);
  if (!f?.pass) return false;
  const scared = (f.loss / SANCTION_MAX) * SANCTION_FEAR[c.personality] > 0.5 + rand(g) * 0.5;
  if (scared) c.aiFlags.unWait = g.day + 200 + Math.floor(rand(g) * 200);
  return scared;
}

// ---------- сессия идёт ----------
/** Окно сессии — тем, кого она касается: обвиняемым, великим державам и Генсеку, союзникам, врагам, соседям и братьям сторон. */
function involved(g: GameState, r: UNResolution) {
  const me = g.player;
  if (r.target === me || isP5(me) || isSG(g)) return true;
  const near = neighborCountries(g, me);
  return [r.target!, r.target2].some((x) => x !== undefined && (peekPair(g, me, x).alliance || atWar(g, me, x) || near.has(x)
    || inOrder(g, x) || (g.lodge.status === 'member' && isMember(g, x))));
}

/** Шанс, что речь нашего посла убедит колеблющихся: от отношений мира к нам, поста Генсека и свободы у нас дома. */
export function speechChance(g: GameState) {
  const me = g.player;
  const others = alive(g).filter((k) => k !== me);
  const avg = others.reduce((s, k) => s + g.rel[k][me], 0) / Math.max(1, others.length);
  return Math.max(0.1, Math.min(0.85, 0.4 + avg / 150 + (isSG(g) ? 0.2 : 0) + (isFree(g.countries[me].gov) ? 0.05 : 0)));
}
/** Вызов ООН: дома любят твёрдость, если это не демократия. */
export const defyStab = (g: GameState) => ({ dictatorship: 4, monarchy: 2, republic: -2, democracy: -3 })[g.countries[g.player].gov];

function ask(g: GameState, r: UNResolution) {
  const def = SESSION_BY_ID[r.kind];
  const me = g.player;
  const t = r.target!;
  r.asked = true;
  const f = outlook(g, r);
  const days = Math.max(0, r.vote - g.day);
  const when = days > 0 ? `Голосование через ${days} дн.` : 'Голосование — сразу после нашего ответа.';
  const why = `${cname(g, r.by)} ${vb(r.by, 'созвал')} чрезвычайную сессию Генассамблеи. Повод — ${r.note ?? def.name.toLowerCase()}.`;
  const fc = `Прогноз: ${f.yes} за, ${f.no} против — ${f.pass ? `санкции, −${pct(f.loss)}% производства на ${fmtDays(f.days)}` : 'резолюцию отклонят'}.`;
  if (t === me) {
    const err = def.complyError?.(g, me, terms(r));
    const stab = defyStab(g);
    g.event = {
      id: eventId(r), kind: 'un', icon: def.icon, title: 'Чрезвычайная сессия ООН — о нас', target: r.by,
      text: `${why} ООН требует: ${def.demand}. Если резолюцию примут, все, кто голосовал «за», введут санкции, пока мы не выполним требование. ${fc} ${when}`,
      options: [
        { label: '🎤 Выступить с речью', hint: `шанс убедить колеблющихся ${pct(speechChance(g))}%: удастся — голоса качнутся к нам, нет — против нас`, idx: 0 },
        ...(err ? [] : [{ label: '🙇 Выполнить требование', hint: `${def.complyHint(g, me, terms(r))}; сессия закроется без санкций, отношения со всеми +3`, idx: 1 }]),
        { label: '🚪 Игнорировать ООН', hint: `колеблющиеся обидятся, санкции — в полтора раза дольше; стабильность ${stab > 0 ? '+' : ''}${stab}`, idx: 2 },
        { label: '🤐 Ждать голосования', hint: 'убедить колеблющихся можно во вкладке «Армия → 🌐 ООН»', idx: 3 },
      ],
    };
    sfx('alarm');
    return;
  }
  g.event = {
    id: eventId(r), kind: 'un', icon: def.icon, title: `Чрезвычайная сессия ООН: ${cname(g, t)}`, target: t,
    text: `${why} ООН требует от страны ${cname(g, t)}: ${def.demand}. Если резолюцию примут, все, кто голосовал «за», введут санкции. ${fc} ${when}`,
    options: [
      { label: '✅ За резолюцию', hint: def.yesHint?.(g, r) ?? '' },
      { label: '❌ Против', hint: `${cname(g, t)} +10 к отношениям, ${cname(g, r.by)} −4` },
      { label: '🤐 Воздержаться', hint: 'пусть решают другие — отношения не изменятся' },
    ],
  };
  sfx('notify');
}

/** Ответ игрока в окне сессии. */
export function resolveSessionEvent(g: GameState, option: number) {
  const ev = g.event;
  if (!ev) return;
  g.event = null;
  const r = g.assembly.res.find((x) => eventId(x) === ev.id);
  if (!r || r.passed !== undefined) return;
  if (r.target === g.player) {
    const how = ev.options[option]?.idx ?? 3;
    if (how < 3) report(g, defend(g, r.id, how as 0 | 1 | 2));
    return;
  }
  r.myVote = (['yes', 'no', 'abstain'] as const)[option] ?? 'abstain';
}
const report = (g: GameState, err: string | null) => { if (err) log(g, `🌐 ${err}`, 'bad'); };

/** Что можно сделать до голосования о нас (null — можно). how: 0 — речь, 1 — выполнить требование, 2 — игнорировать ООН. */
export function defendError(g: GameState, r: UNResolution | undefined, how: 0 | 1 | 2): string | null {
  if (!r || r.passed !== undefined || r.target !== g.player || !r.session) return 'Голосование уже закончилось';
  if (how === 0 && r.speech !== undefined) return 'Наш посол уже выступил';
  if (how === 2 && r.defiant) return 'Мы уже покинули зал';
  if (how === 1) return SESSION_BY_ID[r.kind].complyError?.(g, g.player, terms(r)) ?? null;
  return null;
}

export function defend(g: GameState, id: number, how: 0 | 1 | 2): string | null {
  const r = g.assembly.res.find((x) => x.id === id);
  const err = defendError(g, r, how);
  if (err) return err;
  const me = g.player;
  const def = SESSION_BY_ID[r!.kind];
  if (how === 0) {
    const ok = rand(g) < speechChance(g);
    r!.speech = ok ? 18 : -8;
    g.counters.unSpeeches = (g.counters.unSpeeches ?? 0) + 1;
    sfx(ok ? 'treaty' : 'error');
    log(g, ok ? '🎤 Речь нашего посла в ООН произвела впечатление: колеблющиеся склоняются на нашу сторону'
      : '🎤 Речь в ООН провалилась: зал освистал нашего посла', ok ? 'good' : 'bad');
  } else if (how === 1) {
    def.comply(g, me, terms(r!));
    r!.complied = true;
    r!.passed = false;
    r!.yes = [];
    r!.no = [];
    for (const k of alive(g)) if (k !== me) addRel(g, me, k, 3);
    g.counters.unComplied = (g.counters.unComplied ?? 0) + 1;
    sfx('treaty');
    log(g, `🙇 Мы выполнили требование ООН (${def.demand}) — чрезвычайная сессия закрыта без санкций`, 'good');
  } else {
    r!.defiant = true;
    mod(g, me, 'stab', defyStab(g), 150, 'Вызов ООН');
    sfx('alarm');
    log(g, '🚪 Наш посол демонстративно покинул зал Генассамблеи: «Нам не указ!»', 'info');
  }
  computeAll(g);
  return null;
}

/** Голоса подсчитаны (assembly.ts → tally): окно закрывается, а наш голос запоминают. */
export function sessionTallied(g: GameState, r: UNResolution) {
  const me = g.player;
  const t = r.target!;
  if (g.event?.id === eventId(r)) g.event = null;
  if (t === me) {
    if (!r.passed) g.counters.sessionsWon = (g.counters.sessionsWon ?? 0) + 1;
    return;
  }
  if (r.myVote === 'yes') addRel(g, me, t, -10);
  else if (r.myVote === 'no') addRel(g, me, t, 10);
}

// ---------- санкции ----------
/** Резолюция принята: все, кто голосовал «за», вводят санкции. */
function impose(g: GameState, r: UNResolution, yes: number[]): string {
  const def = SESSION_BY_ID[r.kind];
  const t = r.target!;
  const by = yes.filter((k) => k !== t && g.countries[k].alive);
  const s: UNSanctions = {
    id: g.nextId++, kind: r.kind, target: t, by, since: g.day, until: g.day + Math.round(def.days * (r.defiant ? 1.5 : 1)), k: def.k,
    embargo: def.embargo || undefined, victim: r.target2, gov: r.gov,
  };
  g.assembly.sanctions.push(s);
  for (const k of by) {
    const p = pair(g, k, t);
    p.trade = false;
    p.grudge = Math.max(p.grudge ?? 0, 15);
    addRel(g, k, t, -10);
  }
  const loss = sanctionLoss(g, t, new Set(by)) * def.k;
  const me = t === g.player;
  return `санкции ввели ${countriesN(by.length)} (−${pct(loss)}% производства${def.embargo ? ', эмбарго на оружие' : ''}) на ${fmtDays(s.until - g.day)} — `
    + `пока ${me ? 'мы не выполним' : `${cname(g, t)} не ${vb(t, 'выполнит', 'выполнит', 'выполнят')}`} требование: ${def.demand}`;
}

/** Санкции ООН против x по итогам чрезвычайных сессий. */
export const sanctionsOn = (g: GameState, x: number) => g.assembly.sanctions.filter((s) => s.target === x);

function drop(g: GameState, s: UNSanctions) {
  g.assembly.sanctions = g.assembly.sanctions.filter((x) => x !== s);
}

/** Страна выполнила требование: санкции сняты, а кто их вводил, смягчается. */
function complyWith(g: GameState, s: UNSanctions) {
  const def = SESSION_BY_ID[s.kind];
  const me = g.player;
  const t = s.target;
  def.comply(g, t, s);
  for (const k of s.by) addRel(g, k, t, 5);
  drop(g, s);
  if (t === me) {
    g.counters.unComplied = (g.counters.unComplied ?? 0) + 1;
    sfx('treaty');
    log(g, `🌐 Мы выполнили требование ООН (${def.demand}) — санкции сняты`, 'good', false);
    banner({ icon: '🌐', title: 'Санкции сняты', text: `Мы выполнили требование ООН: ${def.demand}`, kind: 'good' });
  } else {
    const text = `🌐 ${cname(g, t)} ${vb(t, 'выполнил')} требование ООН (${def.demand}) — санкции сняты`;
    if (s.by.includes(me) || s.victim === me) log(g, text, 'good');
    else news(g, text, 'good');
  }
  computeAll(g);
}

const COMPLY: Record<Personality, number> = { aggressor: 0.4, fanatic: 0.2, cautious: 2, trader: 2.5, scientist: 1.6 };

/** Бот под санкциями раз в месяц решает, не выполнить ли требование: торговцы сдаются быстро, фанатики — почти никогда. */
function botComply(g: GameState, s: UNSanctions) {
  const def = SESSION_BY_ID[s.kind];
  if (!def || def.complyError?.(g, s.target, s)) return;
  const loss = sanctionLoss(g, s.target, new Set(s.by)) * s.k;
  if ((loss / SANCTION_MAX) * COMPLY[g.countries[s.target].personality] > rand(g) * 1.5) complyWith(g, s);
}

function tickSanctions(g: GameState) {
  const me = g.player;
  for (const s of [...g.assembly.sanctions]) {
    if (!g.countries[s.target].alive) {
      drop(g, s);
      continue;
    }
    s.by = s.by.filter((k) => g.countries[k].alive);
    if (g.day >= s.until) {
      drop(g, s);
      const def = SESSION_BY_ID[s.kind];
      const text = `🌐 Санкции ООН (${def?.name.toLowerCase() ?? 'сессия'}) против ${s.target === me ? 'нас' : `страны ${cname(g, s.target)}`} сняты: срок истёк`;
      if (s.target === me) log(g, text, 'good');
      else if (s.by.includes(me)) log(g, text, 'info', false);
      else news(g, text, 'info');
      computeAll(g);
    } else if (s.target !== me && (g.day - s.since) % 30 === 29) botComply(g, s);
  }
}

const WAIT = 12; // сколько дней сверх срока голосование ждёт ответа игрока (время идёт и при открытом окне)
/** Голосование сессии ждёт игрока: окно открыто или ещё не показано, потому что занято другим событием. */
export function awaiting(g: GameState, r: UNResolution) {
  if (!r.session || g.day >= r.vote + WAIT || !g.countries[g.player].alive) return false;
  return g.event?.id === eventId(r) || (!r.asked && r.by !== g.player && involved(g, r));
}

/** Раз в день (assembly.ts): окна сессий и санкции. */
export function tickSessions(g: GameState) {
  const me = g.player;
  if (g.countries[me].alive && !g.event) {
    const r = pending(g).find((x) => x.session && !x.asked && x.by !== me && involved(g, x));
    if (r) ask(g, r);
  }
  tickSanctions(g);
}

// ---------- игрок ----------
export function playerComplyError(g: GameState, id: number): string | null {
  const s = g.assembly.sanctions.find((x) => x.id === id);
  if (!s || s.target !== g.player) return 'Санкции уже сняты';
  return SESSION_BY_ID[s.kind]?.complyError?.(g, g.player, s) ?? null;
}
/** Выполнить требование ООН, чтобы снять санкции против нас. */
export function playerComply(g: GameState, id: number): string | null {
  const err = playerComplyError(g, id);
  if (err) return err;
  complyWith(g, g.assembly.sanctions.find((x) => x.id === id)!);
  return null;
}

export function joinError(g: GameState, s: UNSanctions | undefined): string | null {
  const me = g.player;
  if (!s || s.target === me) return 'Нет таких санкций';
  if (s.by.includes(me)) return 'Наши санкции уже введены';
  if (peekPair(g, me, s.target).alliance) return 'Это наш союзник';
  return null;
}
/** Присоединиться к санкциям ООН против чужой страны. */
export function joinSanctions(g: GameState, id: number): string | null {
  const s = g.assembly.sanctions.find((x) => x.id === id);
  const err = joinError(g, s);
  if (err) return err;
  const me = g.player;
  s!.by.push(me);
  pair(g, me, s!.target).trade = false;
  addRel(g, me, s!.target, -10);
  for (const k of s!.by) if (k !== me) addRel(g, me, k, 2);
  computeAll(g);
  return null;
}
