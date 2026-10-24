// Своя ложа: игрок основывает собственный масонский орден и становится его бессменным Великим мастером.
// Правителей посвящают по приглашению (шанс — от отношений и характера), иногда они просятся сами (письмом).
// Братья платят взносы (часть — в нашу казну), дружат, не нападают на нас и друг на друга, а за 🔺 влияние
// исполняют волю мастера: собрание, касса, клятва братства, бойкот, «Братья, к оружию!».
// Официально зарегистрированная ложа получает статус наблюдателя ООН: братья голосуют в Генассамблее вместе с нами.
import { addRel, atWar, cname, declareWar, enemiesOf, pair, peekPair, warError } from './actions';
import { ORDER_SHARE } from './defs';
import { computeAll, STATS } from './economy';
import { fmt } from './format';
import { isMember, JOIN_WISH, LODGE_NAME, type OpChoice } from './lodge';
import { banner, log, news, pick, rand, sfx } from './state';
import type { GameState, TempMod } from './types';
import { COUNTRY_DEFS } from './world';

export const ORDER_NAMES = ['Золотой циркуль', 'Северная звезда', 'Белый пеликан', 'Три светоча', 'Великий восток', 'Орден Феникса', 'Храм Соломона', 'Вольные каменщики'];
export const ORDER_EMBLEMS = ['📐', '🔺', '🌟', '🦅', '🔥', '🕯️', '🗝️', '🐍'];
export const ORDER_MAX = 12; // больше братьев ложа не вмещает
export const NAME_MAX = 28;
export const OFFICIAL_MIN = 3; // столько братьев нужно для официальной регистрации
export const orderShare = (g: GameState) => (g.order?.official ? ORDER_SHARE.official : ORDER_SHARE.secret);

// ---------- кто есть кто ----------
export const inOrder = (g: GameState, k: number) => !!g.order?.members.includes(k);
/** a и b — братья по нашей ложе (игрок в ней мастер). */
export function orderBrothers(g: GameState, a: number, b: number) {
  const O = g.order;
  if (!O || a === b) return false;
  const m = (x: number) => x === g.player || O.members.includes(x);
  return m(a) && m(b);
}
export const orderMembers = (g: GameState) => g.order?.members.filter((k) => g.countries[k].alive) ?? [];

const scale = (g: GameState) => Math.max(30, g.countries[g.player].moneyScale);
const income = (g: GameState) => Math.max(30, STATS[g.player].taxIncome);
function mod(g: GameState, i: number, kind: TempMod['kind'], value: number, days: number, label: string) {
  g.countries[i].mods.push({ kind, value, until: g.day + days, label });
}
/** 🔺 в день: чем больше братьев, тем больше влияния; официальной ложе — в полтора раза больше. */
export const orderInfRate = (g: GameState) => (0.05 + 0.03 * orderMembers(g).length) * (g.order?.official ? 1.5 : 1);

// ---------- основание ----------
export const foundCost = (g: GameState) => scale(g) * 80;
export function foundError(g: GameState, name: string): string | null {
  if (g.order) return 'Ложа уже основана';
  if (g.lodge.status === 'member') return `Сначала выйдите из ложи «${LODGE_NAME}»: её братья не терпят двойной верности`;
  if (!name.trim()) return 'Придумайте название ложи';
  if (g.countries[g.player].money < foundCost(g)) return 'Не хватает денег';
  return null;
}

export function foundOrder(g: GameState, name: string, emblem: string): string | null {
  const err = foundError(g, name);
  if (err) return err;
  const me = g.player;
  g.countries[me].money -= foundCost(g);
  g.order = {
    name: name.trim().slice(0, NAME_MAX), emblem: ORDER_EMBLEMS.includes(emblem) ? emblem : ORDER_EMBLEMS[0], founded: g.day,
    members: [], inf: 10, cd: {}, refused: {}, nextAsk: g.day + 90,
  };
  // «Всевидящее око» соперников не любит
  for (const k of g.lodge.members) if (k !== me && g.countries[k].alive) addRel(g, me, k, -10);
  g.counters.orderFounded = (g.counters.orderFounded ?? 0) + 1;
  sfx('achievement');
  log(g, `${g.order.emblem} Мы основали свою ложу «${g.order.name}» и стали её Великим мастером`, 'good', false);
  banner({ icon: g.order.emblem, title: `Ложа «${g.order.name}»`, text: 'Вы — её основатель и Великий мастер. Посвящайте правителей других стран', kind: 'gold' });
  computeAll(g);
  return null;
}

/** Распустить ложу: братья обижены, влияние сгорает. */
export function disbandOrder(g: GameState) {
  const O = g.order;
  if (!O) return;
  for (const k of orderMembers(g)) addRel(g, g.player, k, -10);
  log(g, `🚪 Ложа «${O.name}» распущена. Братья разошлись, затаив обиду`, 'info', false);
  g.order = undefined;
  computeAll(g);
}

// ---------- посвящение ----------
/** Насколько правитель k хочет в нашу ложу: 0…0.95. */
export function joinChance(g: GameState, k: number): number {
  const O = g.order;
  if (!O) return 0;
  const me = g.player;
  const c = g.countries[k];
  const wish = JOIN_WISH[c.personality];
  if (!wish) return 0; // фанатики в ложи не вступают
  let score = g.rel[me][k] + 8 * wish + 2 * orderMembers(g).length + (O.official ? 10 : 0) + (c.gov === g.countries[me].gov ? 5 : 0);
  if (isMember(g, k)) score -= 25; // брата «Всевидящего ока» переманить труднее
  return Math.max(0, Math.min(0.95, (score - 10) / 60));
}

export const inviteCost = (g: GameState) => scale(g) * 20;
export function inviteError(g: GameState, k: number): string | null {
  const O = g.order;
  if (!O) return 'Сначала основайте ложу';
  if (k === g.player || !g.countries[k]?.alive) return 'Недопустимая цель';
  if (inOrder(g, k)) return 'Уже наш брат';
  if (orderMembers(g).length >= ORDER_MAX) return `В ложе не больше ${ORDER_MAX} братьев`;
  if (atWar(g, g.player, k)) return 'С врагом о братстве не говорят';
  if (!JOIN_WISH[g.countries[k].personality]) return 'Фанатики в ложи не вступают';
  const wait = Math.ceil((O.refused[k] ?? 0) - g.day);
  if (wait > 0) return `Отказали — спросить снова можно через ${wait} дн.`;
  if (g.countries[g.player].money < inviteCost(g)) return 'Не хватает денег';
  return null;
}

/** Позвать правителя k в ложу: тайная встреча стоит денег, а согласится ли он — решает случай. */
export function invite(g: GameState, k: number): string | null {
  const err = inviteError(g, k);
  if (err) return err;
  const O = g.order!;
  g.countries[g.player].money -= inviteCost(g);
  if (rand(g) < joinChance(g, k)) {
    admit(g, k);
    return null;
  }
  O.refused[k] = g.day + 180;
  addRel(g, g.player, k, -3);
  sfx('error');
  log(g, `🚪 Правитель страны ${cname(g, k)} отказался от посвящения в ложу «${O.name}»`, 'bad', false);
  return null;
}

/** Правитель сам просился в ложу (письмом) — принимаем без проверки и без денег. */
export function acceptAsk(g: GameState, k: number): string | null {
  const O = g.order;
  if (!O) return 'Ложи больше нет';
  if (!g.countries[k]?.alive) return 'Этой страны больше нет';
  if (inOrder(g, k)) return 'Он уже наш брат';
  if (orderMembers(g).length >= ORDER_MAX) return `В ложе не больше ${ORDER_MAX} братьев`;
  if (atWar(g, g.player, k)) return 'Мы воюем — о братстве не может быть речи';
  admit(g, k);
  return null;
}

/** Отказать просителю: обида и год без разговоров о посвящении. */
export function refuseAsk(g: GameState, k: number) {
  if (!g.order) return;
  g.order.refused[k] = g.day + 365;
  addRel(g, g.player, k, -5);
}

function admit(g: GameState, k: number) {
  const O = g.order!;
  const me = g.player;
  // брат «Всевидящего ока» уходит оттуда к нам — та ложа этого не простит
  if (isMember(g, k)) {
    const eye = g.lodge;
    eye.members = eye.members.filter((x) => x !== k);
    if (eye.master === k) {
      eye.master = -1;
      eye.nextElection = Math.min(eye.nextElection, g.day + 60);
    }
    for (const x of eye.members) if (x !== me && g.countries[x].alive) addRel(g, me, x, -15);
    log(g, `👁️ ${cname(g, k)} ушла к нам из ложи «${LODGE_NAME}» — её братья в ярости (−15)`, 'info');
  }
  for (const x of orderMembers(g)) addRel(g, k, x, 5);
  O.members.push(k);
  O.inf += 5;
  addRel(g, me, k, 15);
  g.counters.orderAdmitted = (g.counters.orderAdmitted ?? 0) + 1;
  sfx('achievement');
  log(g, `${O.emblem} Правитель страны ${cname(g, k)} посвящён в ложу «${O.name}». Братьев: ${orderMembers(g).length}`, 'good', false);
  computeAll(g);
}

/** Изгнать брата. */
export function expel(g: GameState, k: number) {
  const O = g.order;
  if (!O || !inOrder(g, k)) return;
  dropBrother(g, k);
  addRel(g, g.player, k, -20);
  log(g, `🚪 Мы изгнали страну ${cname(g, k)} из ложи «${O.name}»`, 'info', false);
  computeAll(g);
}

/** Брат уходит из ложи: изгнан, свергнут, погиб — без лишних слов. */
export function dropBrother(g: GameState, k: number) {
  if (g.order) g.order.members = g.order.members.filter((x) => x !== k);
}

/** Страны не стало — в ложе на брата меньше. */
export const onOrderDestroyed = (g: GameState, ci: number) => dropBrother(g, ci);

/** a объявила войну b, и обе — в нашей ложе (мастер-игрок тоже брат). */
export function onOrderWar(g: GameState, a: number, b: number) {
  const O = g.order!;
  const me = g.player;
  if (a === me) {
    dropBrother(g, b);
    for (const k of orderMembers(g)) addRel(g, me, k, -15);
    log(g, `${O.emblem} Мастер поднял меч на брата (${cname(g, b)}): она покинула ложу, остальные братья возмущены (−15)`, 'war', false);
    return;
  }
  dropBrother(g, a);
  for (const k of orderMembers(g)) addRel(g, a, k, -20);
  addRel(g, me, a, -10);
  if (b === me) log(g, `${O.emblem} ${cname(g, a)} напала на своего мастера — изгнана из ложи «${O.name}»`, 'war', false);
  else log(g, `${O.emblem} ${cname(g, a)} подняла меч на брата (${cname(g, b)}) и изгнана из ложи «${O.name}»`, 'war');
}

// ---------- официальная регистрация ----------
export const officialCost = (g: GameState) => scale(g) * 150;
export function officialError(g: GameState): string | null {
  const O = g.order;
  if (!O) return 'Сначала основайте ложу';
  if (O.official) return 'Ложа уже зарегистрирована';
  if (orderMembers(g).length < OFFICIAL_MIN) return `Нужно хотя бы ${OFFICIAL_MIN} брата`;
  if (g.countries[g.player].money < officialCost(g)) return 'Не хватает денег';
  return null;
}

/** Ложа выходит из тени: регистрация и статус наблюдателя ООН. Верующие недовольны, фанатики — тем более. */
export function goOfficial(g: GameState): string | null {
  const err = officialError(g);
  if (err) return err;
  const O = g.order!;
  const me = g.player;
  g.countries[me].money -= officialCost(g);
  O.official = g.day;
  for (const k of orderMembers(g)) addRel(g, me, k, 10);
  g.countries.forEach((c, k) => { if (c.alive && k !== me && c.personality === 'fanatic') addRel(g, me, k, -15); });
  g.counters.orderOfficial = (g.counters.orderOfficial ?? 0) + 1;
  sfx('treaty');
  log(g, `📜 Ложа «${O.name}» зарегистрирована официально и получила статус наблюдателя ООН`, 'good', false);
  banner({ icon: '📜', title: 'Официальная ложа', text: `«${O.name}» — наблюдатель ООН: братья голосуют в Генассамблее вместе с нами`, kind: 'gold' });
  news(g, `📜 Масонская ложа «${O.name}» вышла из тени: штаб-квартира — в стране ${cname(g, me)}, статус наблюдателя ООН`, 'info');
  computeAll(g);
  return null;
}

// ---------- день ----------
export function tickOrder(g: GameState) {
  const O = g.order;
  if (!O) return;
  const me = g.player;
  O.members = O.members.filter((k) => g.countries[k].alive);
  O.inf += orderInfRate(g);
  // кто разругался с мастером — уходит
  if (g.day % 30 === 0) {
    for (const k of [...O.members]) {
      if (g.rel[me][k] >= -25 || rand(g) >= 0.35) continue;
      dropBrother(g, k);
      log(g, `🚪 ${cname(g, k)} вышла из ложи «${O.name}»: отношения с нами испортились`, 'bad');
    }
  }
  // правители иногда сами просятся в ложу — письмом
  if (g.day < O.nextAsk) return;
  O.nextAsk = g.day + 180 + Math.floor(rand(g) * 160);
  if (orderMembers(g).length >= ORDER_MAX) return;
  const cands = g.countries
    .filter((c) => c.alive && c.idx !== me && !inOrder(g, c.idx) && (O.refused[c.idx] ?? 0) <= g.day && !atWar(g, me, c.idx))
    .map((c) => c.idx)
    .filter((k) => joinChance(g, k) >= 0.4);
  if (cands.length) (g.mailQueue ??= []).push({ day: g.day, tpl: 'order_ask', vals: [pick(g, cands)] });
}

// ---------- воля мастера ----------
export interface OrderOp {
  id: string;
  icon: string;
  name: string;
  desc: string;
  cost: number; // 🔺
  cd: number; // дней до повтора
  min: number; // сколько нужно братьев
  money?: (g: GameState) => number;
  choices?: (g: GameState) => OpChoice[];
  can?: (g: GameState) => string | null;
  run: (g: GameState, t: number) => string;
}

/** Братья, готовые воевать с t: не воюют с ней, не союзники и не друзья ей. */
const fighters = (g: GameState, t: number) => orderMembers(g).filter((k) => !atWar(g, k, t) && !warError(g, k, t) && g.rel[k][t] < 40);
const flagged = (ids: number[], extra?: (k: number) => string): OpChoice[] =>
  ids.map((k) => ({ v: k, flag: k, label: `${COUNTRY_DEFS[k].name}${extra ? ` · ${extra(k)}` : ''}` }));

export const ORDER_OPS: OrderOp[] = [
  { id: 'gather', icon: '🕯️', name: 'Собрание ложи', cost: 0, cd: 90, min: 1,
    desc: 'Братья съезжаются на тайный ужин: отношения с ними +8, между собой +3, ложе +🔺10',
    money: (g) => scale(g) * 30,
    run: (g) => {
      const b = orderMembers(g);
      for (const k of b) {
        addRel(g, g.player, k, 8);
        for (const x of b) if (x > k) addRel(g, k, x, 3);
      }
      g.order!.inf += 10;
      return `Собрание ложи: ${b.length} братьев за одним столом — отношения +8, +🔺10`;
    } },
  { id: 'fund', icon: '💰', name: 'Братская касса', cost: 20, cd: 120, min: 2,
    desc: 'Братья скидываются в нашу казну — каждый по силам',
    run: (g) => {
      const b = orderMembers(g);
      const want = Math.min(income(g) * 60, income(g) * 8 * b.length);
      const w = b.map((k) => Math.max(1, g.countries[k].lastGross));
      const sum = w.reduce((s, x) => s + x, 0);
      let got = 0;
      b.forEach((k, j) => {
        const c = g.countries[k];
        const v = Math.max(0, Math.min((want * w[j]) / sum, c.money * 0.15));
        c.money -= v;
        got += v;
      });
      g.countries[g.player].money += got;
      sfx('coins');
      return `Братская касса: +${fmt(got)} 💰 от ${b.length} братьев`;
    } },
  { id: 'oath', icon: '📜', name: 'Клятва братства', cost: 25, cd: 365, min: 1,
    desc: 'Все братья подписывают с нами пакт о ненападении',
    can: (g) => (orderMembers(g).some((k) => { const p = peekPair(g, g.player, k); return !p.pact && !p.alliance && !p.war; }) ? null : 'Со всеми братьями уже есть пакт'),
    run: (g) => {
      let n = 0;
      for (const k of orderMembers(g)) {
        const p = peekPair(g, g.player, k);
        if (p.pact || p.alliance || p.war) continue;
        pair(g, g.player, k).pact = true;
        addRel(g, g.player, k, 5);
        n++;
      }
      return `Клятва братства: пакт о ненападении подписали ${n} братьев`;
    } },
  { id: 'boycott', icon: '🚫', name: 'Бойкот', cost: 30, cd: 240, min: 2,
    desc: 'Братья рвут торговлю с чужой страной, отношения с ней −25, стабильность там −4',
    choices: (g) => flagged(g.countries.filter((c) => c.alive && c.idx !== g.player && !inOrder(g, c.idx)).map((c) => c.idx)),
    run: (g, t) => {
      let broken = 0;
      for (const k of orderMembers(g)) {
        addRel(g, k, t, -25);
        if (peekPair(g, k, t).trade) {
          pair(g, k, t).trade = false;
          broken++;
        }
      }
      mod(g, t, 'stab', -4, 120, 'Бойкот ложи');
      news(g, `🚫 Сразу несколько стран без объяснений свернули торговлю со страной ${cname(g, t)}`, 'bad');
      return `Бойкот страны ${cname(g, t)}${broken ? ` — разорвано договоров: ${broken}` : ''}`;
    } },
  { id: 'arms', icon: '⚔️', name: 'Братья, к оружию!', cost: 60, cd: 365, min: 1,
    desc: 'Братья объявляют войну нашему врагу. Друзья врага откажутся, а нападение без причины ООН осудит',
    choices: (g) => flagged(enemiesOf(g, g.player).filter((t) => fighters(g, t).length > 0), (t) => `готовы: ${fighters(g, t).length}`),
    run: (g, t) => {
      const joined = fighters(g, t).filter((k) => !declareWar(g, k, t, false));
      g.counters.orderWars = (g.counters.orderWars ?? 0) + joined.length;
      return joined.length
        ? `Братья, к оружию! Против страны ${cname(g, t)} выступили: ${joined.map((k) => cname(g, k)).join(', ')}`
        : 'Никто из братьев так и не выступил';
    } },
];
export const ORDER_OP_BY_ID = Object.fromEntries(ORDER_OPS.map((o) => [o.id, o])) as Record<string, OrderOp>;
export const orderOpWait = (g: GameState, op: OrderOp) => Math.max(0, Math.ceil((g.order?.cd[op.id] ?? 0) - g.day));

export function orderOpError(g: GameState, id: string, t?: number): string | null {
  const op = ORDER_OP_BY_ID[id];
  const O = g.order;
  if (!op) return 'Нет такого действия';
  if (!O) return 'Сначала основайте ложу';
  if (orderMembers(g).length < op.min) return `Нужно братьев: ${op.min}`;
  const wait = orderOpWait(g, op);
  if (wait > 0) return `Снова можно через ${wait} дн.`;
  if (O.inf < op.cost) return 'Не хватает 🔺 влияния';
  if (op.money && g.countries[g.player].money < op.money(g)) return 'Не хватает денег';
  const err = op.can?.(g);
  if (err) return err;
  if (op.choices) {
    const list = op.choices(g);
    if (!list.length) return 'Нет подходящих целей';
    if (t !== undefined && !list.some((c) => c.v === t)) return 'Недопустимая цель';
  }
  return null;
}

export function runOrderOp(g: GameState, id: string, t = -1): string | null {
  const op = ORDER_OP_BY_ID[id];
  const err = orderOpError(g, id, op?.choices ? t : undefined);
  if (err) return err;
  if (op.choices && t < 0) return 'Выберите цель';
  const O = g.order!;
  O.inf -= op.cost;
  if (op.money) g.countries[g.player].money -= op.money(g);
  O.cd[id] = g.day + op.cd;
  const text = op.run(g, t);
  g.counters.orderOps = (g.counters.orderOps ?? 0) + 1;
  sfx('paper');
  log(g, `${op.icon} ${text}`, 'good');
  computeAll(g);
  return null;
}
