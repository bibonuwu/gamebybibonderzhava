// Проверка своей ложи, ООН и термоядерной бомбы без графики: npx tsx scripts/order-un-test.ts [дней] [страна] [сид]
// Игрок играет ботом: основывает ложу, зовёт братьев, регистрирует ложу, вносит резолюции и голосует,
// выдвигается в Генсеки, а получив термояд — собирает термоядерные бомбы.
import { aiTurn } from '../src/game/ai';
import { castVote, forecastRes, pending, proposeError, proposeRes, RES_BY_ID, RESOLUTIONS, resTitle } from '../src/game/assembly';
import { resolveEvent } from '../src/game/events';
import { answerLetter } from '../src/game/mail';
import { newGame } from '../src/game/newGame';
import { hbombsOf, isThermo, nukesOf, startNuke } from '../src/game/nuclear';
import {
  foundOrder, goOfficial, invite, inviteError, joinChance, officialError, ORDER_OPS, orderMembers, orderOpError, runOrderOp,
} from '../src/game/order';
import { tick } from '../src/game/sim';
import { COUNTRY_DEFS } from '../src/game/world';

const days = Number(process.argv[2] ?? 3000);
const player = COUNTRY_DEFS.findIndex((c) => c.id === (process.argv[3] ?? 'br'));
const g = newGame(player, 'normal', Number(process.argv[4] ?? 2024));
const me = g.player;
const names = (ids: number[]) => ids.map((k) => COUNTRY_DEFS[k].name).join(', ');
const lines: string[] = [];
let lastTop: object | undefined;

console.log(`Генсек в начале: ${COUNTRY_DEFS[g.assembly.sg]?.name}, выборы в день ${g.assembly.nextSG}`);
for (let d = 1; d <= days && !g.gameOver; d++) {
  tick(g);
  if (g.day % 4 === 0) aiTurn(g, me);
  // выборы Генсека: выдвигаемся с турне; остальные окна — первый вариант
  if (g.event) resolveEvent(g, g.event.id === 'un-sg' ? 1 : 0);
  for (const l of g.mail) if (l.replies && l.answered === undefined) answerLetter(g, l.id, l.tpl === 'lodge_invite' ? 1 : 0);
  // своя ложа: основать, как только хватит денег
  if (!g.order && g.lodge.status !== 'member' && g.day > 30) {
    const err = foundOrder(g, 'Золотой циркуль', '📐');
    if (!err) console.log(`[${g.day}] основали ложу`);
  }
  if (g.order && g.day % 20 === 0) {
    // зовём самого вероятного кандидата
    const cands = g.countries.filter((c) => c.alive && c.idx !== me && !inviteError(g, c.idx)).map((c) => c.idx);
    if (cands.length) {
      const k = cands.reduce((a, b) => (joinChance(g, b) > joinChance(g, a) ? b : a));
      invite(g, k);
    }
    if (!officialError(g)) goOfficial(g);
    for (const op of ORDER_OPS) {
      if (orderOpError(g, op.id)) continue;
      const t = op.choices ? op.choices(g)[0]?.v ?? -1 : -1;
      const err = runOrderOp(g, op.id, t);
      if (err) console.log(`  ! ${op.id}: ${err}`);
      break;
    }
  }
  // ООН: вносим первую доступную резолюцию, если прогноз обещает победу; по чужим голосуем «за»
  if (g.day % 15 === 0) {
    for (const def of RESOLUTIONS) {
      if (proposeError(g, def.id)) continue;
      const t = def.targets?.(g, me)[0];
      const r = { id: -1, kind: def.id, by: me, target: t?.t, target2: t?.t2, day: g.day, vote: g.day + 5, myVote: 'yes' as const };
      if (!forecastRes(g, r).pass) continue;
      const err = proposeRes(g, def.id, t?.t, t?.t2);
      if (err) console.log(`  ! ${def.id}: ${err}`);
      break;
    }
    for (const r of pending(g)) if (r.by !== me && !r.myVote) castVote(g, r.id, r.kind === 'condemn' && r.target === me ? 'no' : 'yes');
  }
  // термояд: бомбы, как только изучен
  if (g.day % 30 === 0) {
    const c = g.countries[me];
    if (g.day === 1500) {
      for (const t of ['nuclear_physics', 'nuclear_power', 'nuclear_bomb', 'thermonuclear']) if (!c.techs.includes(t)) c.techs.push(t);
      c.money += 1e9;
      c.brains += 1e9;
    }
    if (isThermo(g, me)) startNuke(g, me, true);
  }
  for (const l of g.log) {
    if (l === lastTop) break;
    if (/🌐|📐|💥|📜|🚪|🕯️|⚔️ Братья|💰 Братская|🚫 Бойкот/.test(l.text)) lines.push(`[${l.day}] ${l.text}`);
  }
  lastTop = g.log[0];
  if (d % 500 === 0) {
    const O = g.order;
    console.log(`день ${g.day}: ложа ${O ? `«${O.name}» братьев ${orderMembers(g).length}, 🔺${O.inf.toFixed(0)}, официально: ${!!O.official}` : '—'}; `
      + `Генсек ${COUNTRY_DEFS[g.assembly.sg]?.name ?? '—'}; резолюций: на голосовании ${pending(g).length}, архив ${g.assembly.res.length}; `
      + `☢️${nukesOf(g, me)} 💥${hbombsOf(g, me)}; десятина ${g.countries[me].money.toFixed(0)}`);
  }
}
console.log(`\nЖурнал (${lines.length}), последние:`);
for (const l of lines.slice(-45)) console.log(' ', l);
console.log(`\nБратья: ${names(orderMembers(g))}`);
console.log(`Архив ООН:`);
for (const r of g.assembly.res) console.log(`  ${resTitle(g, r)} от ${COUNTRY_DEFS[r.by].name}: ${r.passed === undefined ? 'голосуется' : r.passed ? 'принята' : 'отклонена'} ${r.yes ? `${r.yes.length}/${r.no!.length}` : ''}`);
console.log(`Счётчики: резолюций ${g.counters.unRes ?? 0} (принято ${g.counters.unResPassed ?? 0}), сроков Генсека ${g.counters.sgTerms ?? 0}, `
  + `термоядерных испытаний ${g.counters.hbombTests ?? 0}, посвящено ${g.counters.orderAdmitted ?? 0}, войн братьев ${g.counters.orderWars ?? 0}`);
console.log(`Достижения: ${g.achievements.join(', ')}`);
void RES_BY_ID;
process.exit(0);
