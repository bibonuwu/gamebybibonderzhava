// Проверка тайной ложи без графики: npx tsx scripts/lodge-test.ts [дней] [страна] [join|ban|refuse] [сид]
// Игрок играет ботом, отвечает на письмо-приглашение и, если вступил, заказывает тайные услуги.
import { aiTurn } from '../src/game/ai';
import { resolveEvent } from '../src/game/events';
import { isMember, OPS, opError, rankOf, RANKS, runOp } from '../src/game/lodge';
import { answerLetter } from '../src/game/mail';
import { newGame } from '../src/game/newGame';
import { tick } from '../src/game/sim';
import { COUNTRY_DEFS } from '../src/game/world';

const days = Number(process.argv[2] ?? 4000);
const player = COUNTRY_DEFS.findIndex((c) => c.id === (process.argv[3] ?? 'de'));
const choice = ['join', 'refuse', 'ban'].indexOf(process.argv[4] ?? 'join');
const g = newGame(player, 'normal', Number(process.argv[5] ?? 4242));
const L = g.lodge;
const names = (ids: number[]) => ids.map((k) => COUNTRY_DEFS[k].name).join(', ');
const lines: string[] = [];
let lastTop: object | undefined;

console.log(`Ложа в начале: ${names(L.members)}; мастер — ${COUNTRY_DEFS[L.master]?.name}`);
for (let d = 1; d <= days && !g.gameOver; d++) {
  tick(g);
  if (g.day % 4 === 0) aiTurn(g, g.player);
  // на разоблачение отвечаем по очереди: отрицать, признать, выйти
  if (g.event) resolveEvent(g, g.event.id === 'lodge-exposed' ? (g.counters.lodgeExposed ?? 1) % 3 === 1 ? 0 : 1 : 0);
  const inv = g.mail.find((l) => l.tpl === 'lodge_invite' && l.answered === undefined);
  if (inv) answerLetter(g, inv.id, Math.max(0, choice));
  // член ложи заказывает первую доступную услугу на первую цель
  if (L.status === 'member' && g.day % 10 === 0) {
    for (const op of OPS) {
      if (opError(g, op.id)) continue;
      const t = op.choices ? op.choices(g)[0]?.v ?? -1 : -1;
      const err = runOp(g, op.id, t);
      if (err) console.log(`  ! ${op.id}: ${err}`);
      break;
    }
  }
  for (const l of g.log) {
    if (l === lastTop) break;
    if (/👁️|🕯️|📐|⚒️|📰|🔥|🤝 Братское|📈|🌐 Кулуары|🚫|💰 Касса/.test(l.text)) lines.push(`[${l.day}] ${l.text}`);
  }
  lastTop = g.log[0];
  if (d % 500 === 0) {
    const r = rankOf(g);
    console.log(`день ${g.day}: статус ${L.status}, степень ${r >= 0 ? RANKS[r].name : '—'}, 🔺${L.inf[player].toFixed(0)} (заслуги ${L.merit.toFixed(0)}), `
      + `подозрение ${L.suspicion.toFixed(0)}, открыто: ${!!L.open}, поручение: ${L.task?.kind ?? '—'}, братьев: ${L.members.length}, мастер — ${COUNTRY_DEFS[L.master]?.name ?? '—'}`);
  }
}
console.log(`\nЛога ложи: ${lines.length} записей, последние:`);
for (const l of lines.slice(-40)) console.log(' ', l);
console.log(`\nВ ложе: ${names(L.members)}${isMember(g, player) ? ' (и мы)' : ''}; разоблачены газетами: ${names(L.known.filter((k) => k !== player))}`);
console.log(`Поручений выполнено: ${g.counters.lodgeTasks ?? 0}, услуг: ${g.counters.lodgeOps ?? 0}, переворотов: ${g.counters.coups ?? 0}, разоблачений: ${g.counters.lodgeExposed ?? 0}`);
process.exit(0);
