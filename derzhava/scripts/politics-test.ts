// Проверка выборов, разведки и госдолга без графики: npx tsx scripts/politics-test.ts [дней] [страна] [сид]
// Игрок играет ботом: занимает и шпионит, как боты, на выборах обещает первое из предложенного и признаёт итоги.
import { aiTurn } from '../src/game/ai';
import { RATINGS, rating, totalDebt } from '../src/game/debt';
import { STATS } from '../src/game/economy';
import { resolveEvent } from '../src/game/events';
import { fmt } from '../src/game/format';
import { newGame } from '../src/game/newGame';
import { tick } from '../src/game/sim';
import { COUNTRY_DEFS } from '../src/game/world';

const days = Number(process.argv[2] ?? 4000);
const player = COUNTRY_DEFS.findIndex((c) => c.id === (process.argv[3] ?? 'de'));
const g = newGame(player, 'normal', Number(process.argv[4] ?? 2024));
const lines: string[] = [];
let lastTop: object | undefined;
const t0 = Date.now();

for (let d = 1; d <= days && !g.gameOver; d++) {
  tick(g);
  if (g.day % 4 === 0) aiTurn(g, g.player);
  if (g.event) resolveEvent(g, 0);
  for (const l of g.log) {
    if (l === lastTop) break;
    if (/🗳️|🎤|📣|🛑|🤝 Коалиц|🏦|💥|💸|📉|✂️|🕵️|💾|🧑‍🔬|📢|🎖️|🔍|🧹/.test(l.text)) lines.push(`[${l.day}]${l.world ? ' 🌍' : ''} ${l.text}`);
  }
  lastTop = g.log[0];
  if (d % 500 === 0) {
    const alive = g.countries.filter((c) => c.alive);
    const debtors = alive.filter((c) => totalDebt(c) > 0);
    const ratings = alive.map((c) => RATINGS[rating(g, c.idx)]);
    const count = (r: string) => ratings.filter((x) => x === r).length;
    const nets = g.intel.net.flat().filter((v) => v > 10).length;
    const E = g.elections;
    console.log(`день ${g.day}: должников ${debtors.length}, МВФ ${alive.filter((c) => c.imf).length}, дефолт ${count('D')}, `
      + `рейтинги AAA ${count('AAA')} AA ${count('AA')} A ${count('A')} BBB ${count('BBB')} BB ${count('BB')} B ${count('B')} CCC ${count('CCC')}, `
      + `ставка ${((g.finance.base + g.finance.shock) * 100).toFixed(1)}%, сетей агентов >10%: ${nets}`);
    const c = g.countries[player];
    console.log(`  мы: ${c.gov}, рейтинг власти ${E.approval.toFixed(0)}%, выборы через ${E.next - g.day} дн., долг ${fmt(totalDebt(c))} (${RATINGS[rating(g, player)]}), `
      + `💰 ${fmt(c.money)} (${fmt(STATS[player].moneyRate)}/с, проценты ${fmt(STATS[player].debtInterest)}/с), контрразведка ${c.counterIntel ?? '-'}, ⚖️ ${c.stability.toFixed(0)}`);
  }
}
const world = lines.filter((l) => l.includes('🌍'));
const mine = lines.filter((l) => !l.includes('🌍'));
console.log(`\nМировых новостей: ${world.length}, последние:`);
for (const l of world.slice(-18)) console.log(' ', l);
console.log(`\nНаш журнал: ${mine.length}, последние:`);
for (const l of mine.slice(-22)) console.log(' ', l);
console.log(`\nВыборы: побед ${g.counters.electionsWon ?? 0}, поражений ${g.counters.electionsLost ?? 0}, обещаний выполнено ${g.counters.promisesKept ?? 0}; `
  + `разведка: успехов ${g.counters.spyWins ?? 0}, поймано чужих ${g.counters.spiesCaught ?? 0}; дефолтов ${g.counters.defaults ?? 0}`);
console.log(`${days} дней за ${Date.now() - t0} мс (${((Date.now() - t0) / days).toFixed(2)} мс/тик)`);
process.exit(0);
