// Задания игрока: короткие цели с наградой — подсказывают, чем заняться дальше.
import { armyLimit, atWar, availableTechs, enemiesOf, maxTrade, reachableTargets } from './actions';
import { BUILDINGS } from './defs';
import { STATS } from './economy';
import { fmt } from './format';
import { allBuildings, banner, log, pick, rand, sfx } from './state';
import type { BuildingType, GameState, Quest } from './types';
import { foundCost } from './society';
import { WONDERS, wondersOf } from './wonders';
import { COUNTRY_DEFS, REGION_OF, isCoastalTile, REGIONS } from './world';

interface QuestDef {
  id: string;
  icon: string;
  text: (g: GameState, q: Quest) => string;
  value: (g: GameState, q: Quest) => number;
  /** Цель задания или null, если сейчас оно не подходит. */
  make: (g: GameState) => { target: number; param?: number } | null;
  reward: [number, number]; // дней дохода 💰, дней науки 🧠
}

const me = (g: GameState) => g.countries[g.player];
const st = (g: GameState) => STATS[g.player];
function built(g: GameState, type?: BuildingType, minLevel = 1) {
  let n = 0;
  const { tiles, list } = allBuildings(g);
  for (let k = 0; k < tiles.length; k++) {
    const b = list[k];
    if (b.progress > 0 && b.level <= minLevel) continue;
    if ((type && b.type !== type) || b.level < minLevel) continue;
    if (g.regions[REGION_OF[tiles[k]]].owner === g.player) n++;
  }
  return n;
}
const counter = (g: GameState, k: string) => g.counters[k] ?? 0;
const buildQuest = (type: BuildingType, icon: string, add: number, when: (g: GameState) => boolean, reward: [number, number]): QuestDef => ({
  id: `b_${type}`,
  icon,
  text: (g, q) => `${BUILDINGS[type].name}: постройте ещё — ${built(g, type)} из ${q.target}`,
  value: (g) => built(g, type),
  make: (g) => (when(g) ? { target: built(g, type) + add } : null),
  reward,
});

const QUESTS: QuestDef[] = [
  buildQuest('factory', '🏭', 2, () => true, [80, 0]),
  buildQuest('university', '🎓', 1, () => true, [30, 60]),
  buildQuest('temple', '⛪', 1, (g) => me(g).stability < 65, [50, 0]),
  buildQuest('farm', '🌾', 1, (g) => st(g).civPop / Math.max(1, st(g).popCap) > 0.75, [50, 0]),
  buildQuest('hospital', '🏥', 1, (g) => st(g).growthYear < 1.2, [50, 0]),
  buildQuest('port', '⚓', 1, (g) => built(g, 'port') < 3 && st(g).regions.some((r) => REGIONS[r].tiles.some(isCoastalTile)), [70, 0]),
  {
    id: 'any', icon: '🏗️',
    text: (g, q) => `Постройте новые здания — ${built(g)} из ${q.target}`,
    value: (g) => built(g),
    make: (g) => ({ target: built(g) + 4 }),
    reward: [100, 30],
  },
  {
    id: 'upgrade', icon: '⬆️',
    text: (g, q) => `Улучшите здание до ур. 2 — ${built(g, undefined, 2)} из ${q.target}`,
    value: (g) => built(g, undefined, 2),
    make: (g) => (me(g).techs.some((t) => Object.values(BUILDINGS).some((b) => b.techFor[2] === t)) ? { target: built(g, undefined, 2) + 1 } : null),
    reward: [70, 30],
  },
  {
    id: 'tech', icon: '🔬',
    text: () => 'Изучите новую технологию',
    value: (g) => me(g).techs.length,
    make: (g) => (availableTechs(g, g.player).length ? { target: me(g).techs.length + 1 } : null),
    reward: [60, 40],
  },
  {
    id: 'army', icon: '💂',
    text: (_g, q) => `Увеличьте армию до ${fmt(q.target)} солдат`,
    value: (g) => me(g).soldiers,
    make: (g) => {
      const t = Math.ceil(me(g).soldiers * 1.25);
      return t < armyLimit(g, g.player) ? { target: t } : null;
    },
    reward: [60, 0],
  },
  {
    id: 'stab', icon: '⚖️',
    text: (_g, q) => `Поднимите стабильность до ${q.target}%`,
    value: (g) => me(g).stability,
    make: (g) => (me(g).stability < 78 ? { target: Math.min(90, Math.floor(me(g).stability / 5) * 5 + 12) } : null),
    reward: [70, 20],
  },
  {
    id: 'income', icon: '💰',
    text: (_g, q) => `Доход казны +${fmt(q.target)}/сек`,
    value: (g) => st(g).moneyRate,
    make: (g) => (st(g).moneyRate > 1 ? { target: st(g).moneyRate * 1.3 } : null),
    reward: [90, 0],
  },
  {
    id: 'science', icon: '🧠',
    text: (_g, q) => `Интеллект +${fmt(q.target)}/сек`,
    value: (g) => st(g).brainsRate,
    make: (g) => ({ target: Math.max(5, st(g).brainsRate * 1.3) }),
    reward: [20, 80],
  },
  {
    id: 'treasury', icon: '🏦',
    text: (_g, q) => `Накопите в казне ${fmt(q.target)}`,
    value: (g) => me(g).money,
    make: (g) => ({ target: Math.max(me(g).money * 1.8, (st(g).taxIncome + st(g).factoryIncome) * 250, 5000) }),
    reward: [60, 30],
  },
  {
    id: 'pop', icon: '👥',
    text: (_g, q) => `Население ${fmt(q.target)}`,
    value: (g) => st(g).civPop,
    make: (g) => (st(g).popRate > 0 ? { target: st(g).civPop * 1.04 } : null),
    reward: [60, 30],
  },
  {
    id: 'trade', icon: '🤝',
    text: () => 'Заключите новый торговый договор',
    value: (g) => counter(g, 'trades'),
    make: (g) => (st(g).tradePartners < maxTrade(g, g.player) ? { target: counter(g, 'trades') + 1 } : null),
    reward: [70, 0],
  },
  {
    id: 'annex', icon: '🕊️',
    text: () => 'Присоедините нейтральную землю',
    value: (g) => counter(g, 'annexed'),
    make: (g) => (reachableTargets(g, g.player, true).length ? { target: counter(g, 'annexed') + 1 } : null),
    reward: [60, 30],
  },
  {
    id: 'win', icon: '⚔️',
    text: () => 'Выиграйте сражение',
    value: (g) => counter(g, 'wins'),
    make: (g) => (enemiesOf(g, g.player).length ? { target: counter(g, 'wins') + 1 } : null),
    reward: [100, 20],
  },
  {
    id: 'friend', icon: '💞',
    text: (_g, q) => `Отношения с «${COUNTRY_DEFS[q.param ?? 0].name}» до +${q.target}`,
    value: (g, q) => g.rel[g.player][q.param ?? 0],
    make: (g) => {
      const cand = g.countries.filter((c) => c.alive && c.idx !== g.player && !atWar(g, g.player, c.idx) && g.rel[g.player][c.idx] > -25 && g.rel[g.player][c.idx] < 45);
      if (!cand.length) return null;
      const c = pick(g, cand);
      return { target: Math.min(80, Math.round(g.rel[g.player][c.idx] / 5) * 5 + 25), param: c.idx };
    },
    reward: [50, 20],
  },
  {
    id: 'scientists', icon: '🧑‍🔬',
    text: (_g, q) => `Учёных в стране: ${fmt(q.target)}`,
    value: (g) => me(g).scientists,
    make: (g) => ({ target: Math.ceil(me(g).scientists * 1.08) }),
    reward: [30, 80],
  },
  {
    id: 'company', icon: '🏢',
    text: (_g, q) => `Мировых компаний: ${q.target} (основать — 🏪 Рынок → Компании)`,
    value: (g) => st(g).companies,
    make: (g) => (me(g).money > foundCost(g, g.player) * 0.4 ? { target: st(g).companies + 1 } : null),
    reward: [100, 20],
  },
  {
    id: 'wonder', icon: '🏛️',
    text: () => 'Постройте чудо света',
    value: (g) => wondersOf(g, g.player).length,
    make: (g) => (WONDERS.some((w) => !g.wonders[w.id]) ? { target: wondersOf(g, g.player).length + 1 } : null),
    reward: [120, 60],
  },
];
const QUEST_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q])) as Record<string, QuestDef>;

export const questDef = (q: Quest) => QUEST_BY_ID[q.kind];
export const questText = (g: GameState, q: Quest) => QUEST_BY_ID[q.kind]?.text(g, q) ?? '?';
export const questIcon = (q: Quest) => QUEST_BY_ID[q.kind]?.icon ?? '📋';
export function questProgress(g: GameState, q: Quest) {
  const def = QUEST_BY_ID[q.kind];
  if (!def) return 0;
  return q.done ? 1 : Math.max(0, Math.min(1, def.value(g, q) / Math.max(1e-9, q.target)));
}

function newQuest(g: GameState): Quest | null {
  const active = new Set(g.quests.map((q) => q.kind));
  const options = QUESTS.filter((d) => !active.has(d.id));
  for (let tries = 0; tries < 12 && options.length; tries++) {
    const k = Math.floor(rand(g) * options.length);
    const def = options[k];
    const made = def.make(g);
    options.splice(k, 1);
    if (!made) continue;
    // уже выполнено — неинтересно
    const q: Quest = { id: g.nextId++, kind: def.id, target: made.target, param: made.param, reward: { money: 0, brains: 0 }, done: false };
    if (def.value(g, q) >= q.target) continue;
    const s = st(g);
    q.reward.money = def.reward[0] * Math.max(30, s.taxIncome + s.factoryIncome);
    q.reward.brains = def.reward[1] * Math.max(5, s.brainsRate);
    return q;
  }
  return null;
}

export const QUEST_SLOTS = 3;

/** Раз в день: проверка заданий и добор новых. */
export function checkQuests(g: GameState) {
  if (g.gameOver) return;
  for (const q of g.quests) {
    const def = QUEST_BY_ID[q.kind];
    if (q.done || !def) continue;
    if (def.value(g, q) >= q.target) {
      q.done = true;
      sfx('quest');
      log(g, `📋 Задание выполнено: ${def.icon} ${def.text(g, q)} — заберите награду`, 'good', false);
      banner({ icon: '📋', title: 'Задание выполнено', text: `${def.icon} ${def.text(g, q)} — заберите награду`, kind: 'good' });
    }
  }
  g.quests = g.quests.filter((q) => QUEST_BY_ID[q.kind]);
  while (g.quests.length < QUEST_SLOTS) {
    const q = newQuest(g);
    if (!q) break;
    g.quests.push(q);
  }
}

export function claimQuest(g: GameState, id: number) {
  const q = g.quests.find((x) => x.id === id);
  if (!q || !q.done) return;
  const c = me(g);
  c.money += q.reward.money;
  c.brains += q.reward.brains;
  g.quests = g.quests.filter((x) => x.id !== id);
  g.counters.quests = counter(g, 'quests') + 1;
  sfx('coins');
  log(g, `🎁 Награда: +${fmt(q.reward.money)} 💰${q.reward.brains ? ` +${fmt(q.reward.brains)} 🧠` : ''}`, 'good');
  checkQuests(g);
}

export const SKIP_COOLDOWN = 60;
/** Заменить задание другим (не чаще раза в 60 дней). */
export function skipQuest(g: GameState, id: number): string | null {
  const wait = counter(g, 'questSkip') + SKIP_COOLDOWN - g.day;
  if (wait > 0) return `Заменить можно через ${Math.ceil(wait)} дн.`;
  const q = g.quests.find((x) => x.id === id);
  if (!q || q.done) return 'Нечего заменять';
  g.quests = g.quests.filter((x) => x.id !== id);
  g.counters.questSkip = g.day;
  const fresh = newQuest(g);
  if (fresh) g.quests.push(fresh);
  else g.quests.push(q);
  return null;
}
