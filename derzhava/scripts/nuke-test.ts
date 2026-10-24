// Проверка ядерной программы без графики: npx tsx scripts/nuke-test.ts [дней] [страна] [сид]
import { aiTurn } from '../src/game/ai';
import { resolveEvent } from '../src/game/events';
import { newGame } from '../src/game/newGame';
import { BOMB_TECH, nukesOf, THERMO_TECH } from '../src/game/nuclear';
import { tick } from '../src/game/sim';
import { COUNTRY_DEFS } from '../src/game/world';

const days = Number(process.argv[2] ?? 6000);
const player = COUNTRY_DEFS.findIndex((c) => c.id === (process.argv[3] ?? 'us'));
const g = newGame(player, 'hard', Number(process.argv[4] ?? 777));
const atomNews: string[] = [];
let lastTop: object | undefined;

for (let d = 1; d <= days && !g.gameOver; d++) {
  tick(g);
  if (g.day % 4 === 0) aiTurn(g, g.player);
  if (g.event) resolveEvent(g, 0);
  // свежие ядерные записи журнала (журнал растёт сверху)
  for (const l of g.log) {
    if (l === lastTop) break;
    if (/☢️|🚀|🛰️|🌫️|🚨 Ракет/.test(l.text)) atomNews.push(`[${l.day}] ${l.text}`);
  }
  lastTop = g.log[0];
  if (d % 1000 === 0) {
    const bomb = g.countries.filter((c) => c.alive && c.techs.includes(BOMB_TECH)).length;
    const thermo = g.countries.filter((c) => c.alive && c.techs.includes(THERMO_TECH)).length;
    const arsenal = g.countries.reduce((s, c, i) => s + (c.alive ? nukesOf(g, i) : 0), 0);
    console.log(`день ${g.day}: с бомбой ${bomb}, термояд ${thermo}, боеголовок в мире ${arsenal}, взрывов ${g.counters.worldNukes ?? 0}, зон заражения ${Object.keys(g.fallout).length}, ракет в полёте ${g.missiles.length}`);
  }
}
console.log('\nЯдерный клуб:');
g.countries.forEach((c, i) => { if (nukesOf(g, i) || c.nukeBuild) console.log(`  ${COUNTRY_DEFS[i].name}: ☢️ ${nukesOf(g, i)}${c.nukeBuild ? ' (+собирает)' : ''}`); });
console.log(`\nЯдерные события (${atomNews.length}):`);
for (const t of [...new Set(atomNews)].slice(-30)) console.log('  ' + t);
