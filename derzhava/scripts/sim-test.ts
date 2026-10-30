// Прогон симуляции без графики: npm run sim -- [дней] [страна] [bot|idle] [classic|coldwar|turmoil]
import { STATS } from '../src/game/economy';
import { fmt } from '../src/game/format';
import { newGame } from '../src/game/newGame';
import { tick } from '../src/game/sim';
import { COUNTRY_DEFS } from '../src/game/world';
import { PERSONALITIES } from '../src/game/defs';
import { aiTurn } from '../src/game/ai';
import { resolveEvent } from '../src/game/events';
import { WONDER_BY_ID } from '../src/game/wonders';
import { foodDays, showPrice } from '../src/game/market';
import type { Scenario } from '../src/game/types';
import { activeCrises, resPriceRatio } from '../src/game/resources';
import { MEGAS } from '../src/game/megaprojects';

const days = Number(process.argv[2] ?? 1500);
const playerId = process.argv[3] ?? 'kz';
const player = COUNTRY_DEFS.findIndex((c) => c.id === playerId);
const scenario = (process.argv[5] ?? 'classic') as Scenario;
const g = newGame(player, 'normal', Number(process.env.SEED ?? 12345), scenario);

function report() {
  console.log(`\n=== день ${g.day} === живых стран: ${g.countries.filter((c) => c.alive).length}, боёв: ${g.battles.length}, нейтральных регионов: ${g.regions.filter((r) => r.owner < 0).length}, мятежей: ${g.rebels.length} (с покровителем: ${g.rebels.filter((r) => r.sponsor >= 0).length}), отделилось регионов: ${g.counters.seceded ?? 0}, распадов: ${g.counters.collapses ?? 0}`);
  console.log(`  рынок: 🌾 ${fmt(showPrice(g, 'food'))}/1M т (запас ${fmt(g.market.food.stock / g.market.food.norm * 100)}%)  🔫 ${fmt(showPrice(g, 'arms'))}/1K (запас ${fmt(g.market.arms.stock / g.market.arms.norm * 100)}%)  учёных ищут работу: ${fmt(g.market.sciPool)}  компаний: ${g.companies.length}  гениев: ${g.geniuses.filter((x) => x.employer >= 0).length}/${g.geniuses.length}`);
  const R = g.res!;
  console.log(`  климат: +${g.climate!.temp.toFixed(2)}°C (выбросы ×${g.climate!.emis.toFixed(2)})  ⛽ ×${resPriceRatio(g, 'oil').toFixed(2)} (спрос/добыча ${(R.oil.demand / R.oil.supply).toFixed(2)}, хватает ${Math.round(R.oil.avail * 100)}%)  🔋 ×${resPriceRatio(g, 'lith').toFixed(2)} (спрос/добыча ${(R.lith.demand / R.lith.supply).toFixed(2)}, хватает ${Math.round(R.lith.avail * 100)}%)  кризисы: ${activeCrises(g).map((a) => a.id).join(',') || '—'}  программ развития: ${g.aid?.length ?? 0}  космос: ${Object.entries(g.firsts ?? {}).map(([k, v]) => k + '→' + COUNTRY_DEFS[v].name).join(', ') || '—'}`);
  const sizes = g.countries.filter((c) => c.alive).map((c) => STATS[c.idx].gdpIndex / (c.gdp0 ?? 1)).sort((a, b) => a - b);
  console.log(`  размер экономик к началу: медиана ×${sizes[Math.floor(sizes.length / 2)].toFixed(2)}, разброс ×${sizes[0].toFixed(2)}…×${sizes[sizes.length - 1].toFixed(2)}; стабильность: медиана ${[...g.countries.filter((c) => c.alive).map((c) => c.stability)].sort((a, b) => a - b)[12]?.toFixed(0)}`);
  const rows = g.countries
    .map((c, i) => ({ c, s: STATS[i], d: COUNTRY_DEFS[i] }))
    .sort((a, b) => b.s.power - a.s.power);
  for (const { c, s, d } of rows) {
    if (!c.alive) { console.log(`  ✝ ${d.name}`); continue; }
    const wars = Object.entries(g.pairs).filter(([k, p]) => p.war && k.split('-').map(Number).includes(c.idx)).length;
    console.log(
      `  ${(c.idx === g.player ? '★' : ' ')}${d.name.padEnd(18)} ${PERSONALITIES[c.personality].icon} рег:${String(s.regions.length).padStart(3)} 👥${fmt(s.civPop).padStart(6)} (${fmt(s.popRate)}/с) 💰${fmt(c.money).padStart(7)} (${fmt(s.moneyRate)}/с) 🧠${fmt(s.brainsRate).padStart(6)}/с ⚖️${c.stability.toFixed(0).padStart(3)} ⚔️${fmt(s.power).padStart(6)} 🪖${fmt(c.soldiers)} тех:${c.techs.length} войн:${wars} стр:${s.counts.factory + s.counts.university + s.counts.temple + s.counts.farm + s.counts.hospital + s.counts.barracks + s.counts.port + s.counts.fortress}`
      + `\n      🧑‍🔬${fmt(c.scientists)} (+${fmt(s.brainsSci)}🧠) 💎${Math.round(c.billionaires)} (+${fmt(s.investIncome)}) 🏢${s.companies} (+${fmt(s.corpIncome)}) 🌾${(s.foodProd / Math.max(1, s.foodCons)).toFixed(2)}× ${Math.round(foodDays(g, c.idx))}дн ${s.foodMoney >= 0 ? '+' : ''}${fmt(s.foodMoney)}${s.hunger > 0 ? ' ГОЛОД ' + Math.round(s.hunger * 100) + '%' : ''} 🔫${(s.equip * 100).toFixed(0)}% ${c.aiFlags.prepTarget !== undefined ? '🪖→' + COUNTRY_DEFS[c.aiFlags.prepTarget].name : ''}`
      + `
      😤${(c.expect ?? 0).toFixed(1)} 👴${Math.round((c.aging ?? 0) * 100)}% (−${fmt(s.pensionCost)}) 🤖${s.mods.auto}${c.safety ? '/' + c.safety : ''} 🌱${c.green ?? 0} ⛽${s.oilProd.toFixed(1)}/${s.oilNeed.toFixed(1)} 🔋${s.lithProd.toFixed(1)}/${s.lithNeed.toFixed(1)} сырьё ${s.resMoney >= 0 ? '+' : ''}${fmt(s.resMoney)}${s.resShort > 0.005 ? ' нехватка −' + Math.round(s.resShort * 100) + '%' : ''} 🏗️${MEGAS.map((m) => c.megas?.[m.id] ? m.icon + c.megas[m.id] : '').join('')}${c.mega ? ' (строит ' + c.mega.id + ')' : ''}`,
    );
  }
}

const botPlayer = process.argv[4] === 'bot';
const t0 = Date.now();
report();
for (let d = 1; d <= days; d++) {
  tick(g);
  if (botPlayer && g.day % 4 === 0) aiTurn(g, g.player);
  if (g.event) resolveEvent(g, 0);
  if (d % 500 === 0) report();
  if (g.gameOver) { console.log('\n💀 игрок уничтожен на дне', g.day); report(); break; }
}
console.log('\nЧудеса света:');
for (const [id, w] of Object.entries(g.wonders)) console.log(`  [${w.day}] ${WONDER_BY_ID[id].icon} ${WONDER_BY_ID[id].name} — ${COUNTRY_DEFS[w.builder].name}`);
const wars = g.log.filter((l) => l.text.includes('объявила войну') || l.text.includes('объявляет')).length;
const peaces = g.log.filter((l) => l.text.startsWith('🕊️ Мир')).length;
console.log(`\nВ журнале (последние ${g.log.length}): войн ${wars}, мирных договоров ${peaces}; заданий игрока выполнено: ${g.counters.quests ?? 0}`);
console.log(`Поздняя игра: подготовок к войне за сырьё ${g.counters.oilWars ?? 0}, +${g.climate!.temp.toFixed(2)}°C, первые в космосе: ${JSON.stringify(g.firsts)}`);
console.log(`\n${days} дней за ${Date.now() - t0} мс (${((Date.now() - t0) / days).toFixed(2)} мс/тик)`);
console.log('\nПоследние события:');
for (const l of g.log.slice(0, 25)) console.log(`  [${l.day}] ${l.text}`);
process.exit(0);
