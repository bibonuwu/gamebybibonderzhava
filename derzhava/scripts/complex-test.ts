// Проверка зданий-комплексов без графики: npx tsx scripts/complex-test.ts [дней] [страна] [сид]
// Стройка на несколько клеток, рост при улучшении, разрушение клеток, граница регионов, старые здания в одну клетку,
// сохранение — и долгий прогон с ботами: ни одна клетка не занята дважды. При ошибке — код выхода 1.
import { aiTurn } from '../src/game/ai';
import { bestTileFor, startBuild, startUpgrade, transferRegion, upgradeError, upgradeGrowth } from '../src/game/actions';
import { FOOTPRINT } from '../src/game/defs';
import { computeAll, STATS } from '../src/game/economy';
import { resolveEvent } from '../src/game/events';
import { newGame } from '../src/game/newGame';
import { exportText, parseSave } from '../src/game/save';
import { tick } from '../src/game/sim';
import { buildingAt, buildingSize, buildingTiles, buildingWorking, putBuilding, ruinTile, setBuildingTiles } from '../src/game/state';
import type { GameState } from '../src/game/types';
import { COUNTRY_DEFS, NEIGH, REGIONS, REGION_OF, TERRAIN, isWater } from '../src/game/world';

const days = Number(process.argv[2] ?? 1500);
const playerId = process.argv[3] ?? 'kz';
const seed = Number(process.argv[4] ?? 2024);
const me = COUNTRY_DEFS.findIndex((c) => c.id === playerId);

let failed = 0;
function check(ok: boolean, what: string) {
  if (ok) console.log(`  ✓ ${what}`);
  else {
    failed++;
    console.log(`  ✗ ${what}`);
  }
}

/** Клетки комплексов не пересекаются, не лежат на воде, льдах, в центрах регионов и на чужой земле. */
function consistent(g: GameState): string | null {
  const seen = new Map<number, number>();
  for (const [k, b] of Object.entries(g.buildings)) {
    const at = +k;
    const own = g.regions[REGION_OF[at]].owner;
    for (const t of buildingTiles(at, b)) {
      if (seen.has(t)) return `клетка ${t} занята дважды (${seen.get(t)} и ${at})`;
      seen.set(t, at);
      if (buildingAt(g, t) !== at) return `индекс клеток устарел: ${t}`;
      if (isWater(t) || TERRAIN[t] === 's' || REGIONS[REGION_OF[t]].center === t) return `пристройка на негодной клетке ${t}`;
      if (t !== at && g.regions[REGION_OF[t]].owner !== own) return `пристройка ${t} на чужой земле`;
    }
    if ((b.add ?? 0) > (b.tiles?.length ?? 0) || (b.add && b.progress <= 0)) return `неверное число строящихся пристроек у ${at}`;
  }
  return null;
}

const g = newGame(me, 'normal', seed);
computeAll(g);
const c = g.countries[me];
c.money = 1e12;

console.log('Стройка');
const tile = bestTileFor(g, me, 'factory');
check(tile >= 0, 'есть место под завод');
check(!startBuild(g, me, tile, 'factory'), 'завод заложен');
const b = g.buildings[tile];
check(buildingSize(b) === FOOTPRINT[1], `завод сразу занимает ${FOOTPRINT[1]} клетки`);
check(b.tiles!.every((t) => buildingAt(g, t) === tile && NEIGH.slice(tile * 6, tile * 6 + 6).includes(t)), 'пристройка — соседняя клетка того же комплекса');
check(STATS[me].counts.factory === 1 && STATS[me].area.factory === FOOTPRINT[1], 'счёт: один комплекс, две клетки');
check(buildingWorking(b) === FOOTPRINT[1] && STATS[me].factoryIncome === 0, 'пока строится — дохода нет');
c.techs.push('smart_factories'); // открывает завод ур. 2 — заранее, чтобы доход сравнивать при тех же бонусах
while (b.progress > 0) tick(g);
computeAll(g);
const income1 = STATS[me].factoryIncome;
check(income1 > 0, 'готовый завод приносит деньги');

console.log('Улучшение');
const wing = b.tiles![0];
check(upgradeGrowth(g, tile) === FOOTPRINT[2] - FOOTPRINT[1], 'улучшение пристроит ещё клетку');
check(!upgradeError(g, me, wing), 'улучшать можно с любой клетки комплекса');
check(!startUpgrade(g, me, wing), 'улучшение началось');
check(b.level === 2 && buildingSize(b) === FOOTPRINT[2] && b.add === 1, 'комплекс вырос на клетку, она строится');
computeAll(g);
check(Math.abs(STATS[me].factoryIncome - income1) / income1 < 1e-9, 'пока идёт улучшение — работают старые клетки на старом уровне');
while (b.progress > 0) tick(g);
computeAll(g);
check(b.add === undefined, 'пристройка достроена');
check(STATS[me].factoryIncome > income1 * 3, `уровень 2 на ${FOOTPRINT[2]} клетках даёт больше втрое`);

console.log('Разрушение и границы');
const err = consistent(g);
check(!err, err ?? 'клетки комплексов в порядке');
check(ruinTile(g, tile), 'главная клетка разрушена');
const head = buildingAt(g, wing);
check(!g.buildings[tile] && head >= 0 && buildingSize(g.buildings[head]) === FOOTPRINT[2] - 1, 'главной стала пристройка, комплекс потерял одну клетку');
check(buildingAt(g, tile) === -1, 'разрушенная клетка свободна');
// пристройка в соседнем своём регионе: отпадает, когда регион уходит к другой стране
let cross: [number, number] = [-1, -1];
for (const rid of STATS[me].regions) {
  if (rid === c.capital) continue;
  for (const t of REGIONS[rid].tiles) {
    if (t === REGIONS[rid].center || isWater(t) || buildingAt(g, t) >= 0) continue;
    const n = NEIGH.slice(t * 6, t * 6 + 6).find((x) => x >= 0 && !isWater(x) && REGION_OF[x] !== rid && g.regions[REGION_OF[x]].owner === me
      && REGION_OF[x] !== c.capital && REGIONS[REGION_OF[x]].center !== x && buildingAt(g, x) < 0 && TERRAIN[x] !== 's');
    if (n !== undefined && TERRAIN[t] !== 's') { cross = [t, n]; break; }
  }
  if (cross[0] >= 0) break;
}
if (cross[0] >= 0) {
  const [a, x] = cross;
  putBuilding(g, a, { type: 'temple', level: 1, progress: 0, total: 1 });
  setBuildingTiles(g, a, [x]);
  const other = g.countries.findIndex((o) => o.alive && o.idx !== me);
  transferRegion(g, REGION_OF[x], other, false);
  check(buildingSize(g.buildings[a]) === 1 && buildingAt(g, x) === -1, 'пристройка на отошедшей земле отпала от комплекса');
} else console.log('  · нет пары соседних своих регионов — проверка границы пропущена');

console.log('Старые здания в одну клетку');
const lone = bestTileFor(g, me, 'temple');
putBuilding(g, lone, { type: 'temple', level: 1, progress: 0, total: 1 });
computeAll(g);
check(buildingSize(g.buildings[lone]) === 1 && upgradeGrowth(g, lone) === FOOTPRINT[2] - 1, 'старое здание растёт сразу до размера уровня 2');

console.log('Сохранение');
const back = parseSave(exportText(g));
check('g' in back && JSON.stringify(back.g.buildings) === JSON.stringify(g.buildings), 'комплексы сохраняются и загружаются');

console.log(`Прогон ${days} дней с ботами`);
for (let d = 1; d <= days; d++) {
  tick(g);
  if (d % 4 === 0) aiTurn(g, g.player);
  if (g.event) resolveEvent(g, 0);
  if (d % 250 === 0) {
    const e = consistent(g);
    if (e) { check(false, `день ${g.day}: ${e}`); break; }
  }
}
const all = Object.values(g.buildings);
const grown = all.filter((x) => x.level > 1).length;
check(!consistent(g), `клетки комплексов в порядке: ${all.length} комплексов, ${all.reduce((s, x) => s + buildingSize(x), 0)} клеток, улучшено ${grown}`);
check(grown > 0, 'боты улучшают комплексы');

console.log(failed ? `\n✗ Не прошло проверок: ${failed}` : '\n✓ Все проверки прошли');
process.exit(failed ? 1 : 0);
