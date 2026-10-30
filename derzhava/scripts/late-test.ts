// Проверка поздней игры без графики: npx tsx scripts/late-test.ts [дней] [страна] [сид]
// Сырьё и климат, цена процветания, мегапроекты, программы развития, лоббирование в ООН, сохранение и его обновление.
// В отличие от остальных скриптов здесь есть проверки: при ошибке — код выхода 1.
import { aiTurn } from '../src/game/ai';
import { lobby, lobbyTargets, pending } from '../src/game/assembly';
import { EXPECT_MAX } from '../src/game/defs';
import { ratingParts } from '../src/game/debt';
import { computeAll, STATS } from '../src/game/economy';
import { resolveEvent } from '../src/game/events';
import { COMMODITIES, COMMODITY, exchangeBuy, exchangeSell, goldValue, holding, priceRatio, qtyForMoney } from '../src/game/exchange';
import { aidError, MEGAS, megaNext, startAid, startMega } from '../src/game/megaprojects';
import { newGame, SAVE_VERSION } from '../src/game/newGame';
import { pensionReform, PROGRAMS, setGreen, setSafety, startProgram } from '../src/game/prosperity';
import { REGION_LITH, REGION_OIL } from '../src/game/resources';
import { exportText, parseSave } from '../src/game/save';
import { tick } from '../src/game/sim';
import type { GameState } from '../src/game/types';
import { COUNTRY_DEFS, REGIONS, vb } from '../src/game/world';

const days = Number(process.argv[2] ?? 2500);
const playerId = process.argv[3] ?? 'de';
const seed = Number(process.argv[4] ?? 2024);
const player = COUNTRY_DEFS.findIndex((c) => c.id === playerId);

let failed = 0;
function check(ok: boolean, what: string) {
  if (ok) console.log(`  ✓ ${what}`);
  else {
    failed++;
    console.log(`  ✗ ${what}`);
  }
}
const finite = (x: number | undefined) => typeof x === 'number' && Number.isFinite(x);
const idx = (id: string) => COUNTRY_DEFS.findIndex((c) => c.id === id);

/** Все числа поздней игры конечны и в своих рамках. */
function sane(g: GameState): string | null {
  for (const c of g.countries) {
    if (!c.alive) continue;
    const s = STATS[c.idx];
    const name = COUNTRY_DEFS[c.idx].name;
    for (const [k, v] of Object.entries({ money: c.money, brains: c.brains, stab: c.stability, moneyRate: s.moneyRate, resMoney: s.resMoney, emis: s.emis, oilNeed: s.oilNeed, lithNeed: s.lithNeed })) {
      if (!finite(v)) return `${name}: ${k} = ${v}`;
    }
    if ((c.expect ?? 0) < 0 || (c.expect ?? 0) > EXPECT_MAX) return `${name}: ожидания ${c.expect}`;
    if ((c.aging ?? 0) < 0 || (c.aging ?? 0) > 1) return `${name}: старение ${c.aging}`;
    if (s.resShort < 0 || s.resShort > 0.3) return `${name}: нехватка сырья ${s.resShort}`;
  }
  const R = g.res!;
  for (const k of ['oil', 'lith'] as const) {
    if (!finite(R[k].price) || R[k].price <= 0) return `цена ${k} = ${R[k].price}`;
    if (R[k].avail < 0 || R[k].avail > 1) return `доступность ${k} = ${R[k].avail}`;
  }
  if (!finite(g.climate!.temp)) return `температура ${g.climate!.temp}`;
  return null;
}

console.log('— месторождения и род названий');
check(REGION_OIL.reduce((a, x) => a + x, 0) > 50, 'нефть разложена по регионам');
check(REGION_LITH.reduce((a, x) => a + x, 0) > 20, 'литий разложен по регионам');
check(REGIONS.some((r) => r.origOwner < 0 && REGION_OIL[r.id] > 0.5), 'у ничьих земель есть нефть');
check(vb(idx('cn'), 'взял') === 'взял' && vb(idx('de'), 'взял') === 'взяла' && vb(idx('us'), 'взял') === 'взяли', 'Китай взял, Германия взяла, США взяли');
check(vb(idx('eg'), 'отказался') === 'отказался' && vb(idx('fr'), 'отказался') === 'отказалась' && vb(idx('us'), 'отказался') === 'отказались', 'возвратные глаголы');

console.log('— новая партия');
const g = newGame(player, 'normal', seed);
check(g.version === SAVE_VERSION, `версия сохранения ${SAVE_VERSION}`);
check(!!g.res && !!g.climate && !!g.crises, 'рынок сырья, климат и кризисы созданы');
check(Math.abs(g.climate!.temp - 1.3) < 0.01, 'потепление в начале +1.3°C');
check(g.countries.every((c) => (c.gdp0 ?? 0) > 0 && finite(c.aging)), 'у стран есть размер экономики и старение');
check(sane(g) === null, `числа в порядке: ${sane(g) ?? 'да'}`);

console.log(`— ${days} дней, игрок — бот (${COUNTRY_DEFS[player].name})`);
const me = g.countries[player];
let actions = 0;
for (let d = 1; d <= days; d++) {
  tick(g);
  if (g.day % 4 === 0) aiTurn(g, player);
  if (g.event) resolveEvent(g, d % 3);
  // игрок пробует решения поздней игры
  if (d === 400) { setGreen(g, player, 1); setSafety(g, player, 1); actions++; }
  if (d === 800) {
    me.money += 1e9;
    const p = PROGRAMS[0];
    check(startProgram(g, player, p.id) === null, `народная программа «${p.name}»`);
    const rail = MEGAS.find((m) => m.id === 'rail')!;
    if (me.mega) me.mega = undefined;
    check(startMega(g, player, rail.id) === null, `мегапроект «${rail.name}» начат`);
    const poor = g.countries.find((c) => c.alive && !aidError(g, player, c.idx));
    check(!!poor && startAid(g, player, poor.idx) === null, `программа развития${poor ? ` в стране ${COUNTRY_DEFS[poor.idx].name}` : ''}`);
    check(pensionReform(g, player) === null, 'пенсионная реформа');
    actions++;
  }
  if (d > 800 && pending(g).length && !g.counters.lobbyTried) {
    const r = pending(g).find((x) => x.by !== player);
    if (r) {
      r.myVote = 'yes';
      const list = lobbyTargets(g, r);
      if (list.length) {
        g.counters.lobbyTried = 1;
        me.money += 1e9;
        check(lobby(g, r.id) === null && (r.lobby?.length ?? 0) === list.length, `лоббирование: убедили ${list.length}`);
      }
    }
  }
  if (d % 250 === 0) {
    const bad = sane(g);
    if (bad) { check(false, `день ${g.day}: ${bad}`); break; }
  }
}
check(sane(g) === null, `числа в порядке на день ${g.day}`);
check(g.climate!.temp > 1.3, `планета нагрелась: +${g.climate!.temp.toFixed(2)}°C`);
check((me.megas?.rail ?? 0) >= 1, 'этап мегапроекта достроен');
check(g.countries.some((c) => c.idx !== player && Object.keys(c.megas ?? {}).length > 0), 'боты строят мегапроекты');
check(g.countries.some((c) => c.idx !== player && (c.green ?? 0) > 0) || g.climate!.temp < 1.75, 'боты переходят на зелёный курс, когда жарко');
check(actions === 2, 'решения игрока сработали');
const stabs = g.countries.filter((c) => c.alive).map((c) => c.stability).sort((a, b) => a - b);
console.log(`  стабильность: медиана ${stabs[Math.floor(stabs.length / 2)].toFixed(0)}, ожидания игрока ${(me.expect ?? 0).toFixed(1)}, нефть ×${(g.res!.oil.price / g.res!.oil.base / g.res!.level).toFixed(2)}, литий ×${(g.res!.lith.price / g.res!.lith.base / g.res!.level).toFixed(2)}`);

console.log('— биржа');
me.money = Math.max(me.money, 0) + 1e7;
for (const k of COMMODITIES) {
  const have = holding(me, k), m0 = me.money;
  const q = qtyForMoney(g, k, me.money * 0.05);
  check(q > 0 && exchangeBuy(g, player, k, q) === null && holding(me, k) > have && me.money < m0, `${COMMODITY[k].name}: куплено ${q.toFixed(1)}`);
  const m1 = me.money;
  check(exchangeSell(g, player, k, q) === null && me.money > m1 && me.money < m0, `${COMMODITY[k].name}: продано — туда-обратно чуть дешевле`);
}
check(exchangeSell(g, player, 'gold', holding(me, 'gold') + 1) !== null, 'больше, чем есть, не продать');
check(exchangeBuy(g, player, 'gold', qtyForMoney(g, 'gold', me.money * 0.3)) === null && goldValue(g, player) > 0, 'золотой запас');
check(ratingParts(g, player).some((p) => p[0] === 'Золотой запас' && p[1] > 0), 'золото поднимает кредитный рейтинг');
// мировой дефицит нефти: резерв закрывает недостачу
me.oilStock = 1e6;
g.res!.oil.cut = 0.6;
for (let d = 0; d < 5; d++) tick(g);
const S = STATS[player];
if (g.res!.oil.avail < 0.999 && S.oilNeed > S.oilProd) check(S.oilDraw > 0 && (me.oilStock ?? 0) < 1e6, `резерв нефти тратится в дефицит: −${S.oilDraw.toFixed(2)} в день`);
else console.log('  · нефти хватает и без резерва — проверка резерва пропущена');
g.res!.oil.cut = 0;
check(sane(g) === null && Number.isFinite(g.exchange!.gold.price) && g.exchange!.gold.price > 0, `числа биржи в порядке: золото ×${priceRatio(g, 'gold').toFixed(2)}`);

console.log('— сохранение');
const back = parseSave(exportText(g));
check('g' in back && back.g.day === g.day && !!back.g.res, 'партия сохраняется и открывается');
check('g' in back && (back.g.countries[player].gold ?? 0) === (me.gold ?? 0) && !!back.g.exchange, 'биржевой счёт сохраняется');

// старое сохранение (версия 1): без эпохи ресурсов и климата
const old = JSON.parse(JSON.stringify(newGame(player, 'normal', seed + 1))) as GameState;
old.version = 1;
delete old.res;
delete old.climate;
delete old.crises;
delete old.aid;
delete old.firsts;
for (const c of old.countries) {
  delete c.gdp0;
  delete c.expect;
  delete c.aging;
}
const up = parseSave(JSON.stringify(old));
check('g' in up && up.g.version === SAVE_VERSION, 'сохранение версии 1 обновляется до нынешней');
if ('g' in up) {
  computeAll(up.g);
  check(!!up.g.res && !!up.g.climate && up.g.countries.every((c) => finite(c.aging)), 'после загрузки начинается эпоха ресурсов и климата');
  for (let d = 0; d < 200; d++) tick(up.g);
  check(sane(up.g) === null, 'обновлённая партия идёт без ошибок');
}
const future = parseSave(JSON.stringify({ ...old, version: SAVE_VERSION + 1 }));
check('error' in future, 'сохранение из будущей версии не открывается, но и не ломает игру');

console.log(failed ? `\n✗ Ошибок: ${failed}` : '\n✓ Всё в порядке');
process.exit(failed ? 1 : 0);
