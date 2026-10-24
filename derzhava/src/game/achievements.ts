import { rating } from './debt';
import { TECHS } from './defs';
import { STATS } from './economy';
import { banner, log, sfx } from './state';
import type { GameState } from './types';
import { REGION_OF } from './world';

export interface AchievementDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  check: (g: GameState) => boolean;
}

const me = (g: GameState) => g.countries[g.player];
const st = (g: GameState) => STATS[g.player];
const countOf = (g: GameState, type: string) =>
  Object.entries(g.buildings).filter(([t, b]) => b.type === type && b.progress === 0 && g.regions[REGION_OF[+t]].owner === g.player).length;
const rankOf = (g: GameState, f: (i: number) => number) => {
  const mine = f(g.player);
  return g.countries.filter((c) => c.alive && f(c.idx) > mine).length + 1;
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'year1', icon: '📅', name: 'Первый год', desc: 'Правьте страной целый год', check: (g) => g.day >= 365 },
  { id: 'decade', icon: '🗓️', name: 'Десятилетие у власти', desc: 'Правьте 10 лет', check: (g) => g.day >= 3650 },
  { id: 'pop100', icon: '👥', name: '100 миллионов', desc: 'Население 100 млн', check: (g) => st(g).civPop >= 1e8 },
  { id: 'pop500', icon: '🏙️', name: 'Полмиллиарда', desc: 'Население 500 млн', check: (g) => st(g).civPop >= 5e8 },
  { id: 'pop1b', icon: '🌍', name: 'Миллиард', desc: 'Население 1 млрд', check: (g) => st(g).civPop >= 1e9 },
  { id: 'money1m', icon: '💰', name: 'Миллионер', desc: 'В казне 1M', check: (g) => me(g).money >= 1e6 },
  { id: 'money1b', icon: '🏦', name: 'Миллиардер', desc: 'В казне 1B', check: (g) => me(g).money >= 1e9 },
  { id: 'fact10', icon: '🏭', name: 'Индустриализация', desc: '10 заводов', check: (g) => countOf(g, 'factory') >= 10 },
  { id: 'uni10', icon: '🎓', name: 'Страна знаний', desc: '10 университетов', check: (g) => countOf(g, 'university') >= 10 },
  { id: 'temple10', icon: '⛪', name: 'Духовная держава', desc: '10 храмов', check: (g) => countOf(g, 'temple') >= 10 },
  { id: 'trade1', icon: '🤝', name: 'Первая сделка', desc: 'Заключите торговый договор', check: (g) => (g.counters.trades ?? 0) >= 1 },
  { id: 'ally1', icon: '🛡️', name: 'Верный союзник', desc: 'Заключите военный союз', check: (g) => (g.counters.alliances ?? 0) >= 1 },
  { id: 'win1', icon: '⚔️', name: 'Первая победа', desc: 'Захватите регион в бою', check: (g) => (g.counters.wins ?? 0) >= 1 },
  { id: 'conq5', icon: '🏰', name: 'Завоеватель', desc: 'Захватите 5 регионов', check: (g) => (g.counters.conquered ?? 0) >= 5 },
  { id: 'conq20', icon: '👑', name: 'Империя', desc: 'Захватите 20 регионов', check: (g) => (g.counters.conquered ?? 0) >= 20 },
  { id: 'annex3', icon: '🕊️', name: 'Мирный рост', desc: 'Присоедините 3 нейтральных региона', check: (g) => (g.counters.annexed ?? 0) >= 3 },
  { id: 'defend', icon: '🧱', name: 'Несокрушимые', desc: 'Отбейте 3 вражеские атаки', check: (g) => (g.counters.defended ?? 0) >= 3 },
  { id: 'stab90', icon: '⚖️', name: 'Золотой век', desc: 'Стабильность 90%', check: (g) => me(g).stability >= 90 },
  { id: 'tech10', icon: '🔬', name: 'Учёный совет', desc: 'Изучите 10 технологий', check: (g) => me(g).techs.length >= 10 },
  { id: 'techall', icon: '🚀', name: 'Будущее наступило', desc: 'Изучите все технологии', check: (g) => me(g).techs.length >= TECHS.length },
  { id: 'wonder1', icon: '🏛️', name: 'Чудо света', desc: 'Постройте чудо света', check: (g) => (g.counters.wonders ?? 0) >= 1 },
  { id: 'wonder3', icon: '🗿', name: 'Колыбель цивилизации', desc: 'Владейте тремя чудесами света', check: (g) =>
    Object.values(g.wonders).filter((w) => g.regions[w.region].owner === g.player).length >= 3 },
  { id: 'quests10', icon: '📋', name: 'Слово правителя', desc: 'Выполните 10 заданий', check: (g) => (g.counters.quests ?? 0) >= 10 },
  { id: 'sci1m', icon: '🧑‍🔬', name: 'Мозговой центр', desc: 'Миллион учёных', check: (g) => me(g).scientists >= 1e6 },
  { id: 'genius3', icon: '🌟', name: 'Звёзды науки', desc: 'Три звезды науки работают у вас', check: (g) => st(g).geniuses >= 3 },
  { id: 'rich100', icon: '💎', name: 'Клуб миллиардеров', desc: '100 миллиардеров в стране', check: (g) => me(g).billionaires >= 100 },
  { id: 'corp5', icon: '🏢', name: 'Корпоративная держава', desc: '5 мировых компаний', check: (g) => st(g).companies >= 5 },
  { id: 'food10m', icon: '🌾', name: 'Житница мира', desc: 'Продайте 10M т продовольствия', check: (g) => (g.counters.foodSold ?? 0) >= 1e7 },
  { id: 'arms1m', icon: '🔫', name: 'Оружейный барон', desc: 'Продайте 1M комплектов оружия', check: (g) => (g.counters.armsSold ?? 0) >= 1e6 },
  { id: 'voice10', icon: '📢', name: 'Слуга народа', desc: 'Ответьте на 10 требований народа', check: (g) => (g.counters.demands ?? 0) >= 10 },
  { id: 'atom1', icon: '☢️', name: 'Ядерная держава', desc: 'Проведите ядерное испытание', check: (g) => (g.counters.nukeTests ?? 0) >= 1 },
  { id: 'peaceatom', icon: '🕊️', name: 'Мирный атом', desc: 'Держите 5 боеголовок и ни разу не нажмите кнопку', check: (g) =>
    (me(g).nukes ?? 0) >= 5 && !g.counters.nukesLaunched },
  { id: 'lodge1', icon: '🕯️', name: 'Посвящённый', desc: 'Вступите в тайную ложу', check: (g) => g.lodge.status === 'member' },
  { id: 'lodgegm', icon: '👁️', name: 'Великий мастер', desc: 'Возглавьте тайную ложу', check: (g) => g.lodge.status === 'member' && g.lodge.master === g.player },
  { id: 'coup', icon: '🔥', name: 'Серый кардинал', desc: 'Устройте успешный переворот в чужой стране', check: (g) => (g.counters.coups ?? 0) >= 1 },
  { id: 'lodgeban', icon: '🚫', name: 'Охотник на масонов', desc: 'Запретите тайную ложу в своей стране', check: (g) => (g.counters.lodgeBanned ?? 0) >= 1 },
  { id: 'elect1', icon: '🗳️', name: 'Народный избранник', desc: 'Победите на выборах', check: (g) => (g.counters.electionsWon ?? 0) >= 1 },
  { id: 'elect3', icon: '🏛️', name: 'Трижды избранный', desc: 'Победите на трёх выборах', check: (g) => (g.counters.electionsWon ?? 0) >= 3 },
  { id: 'promise3', icon: '🤞', name: 'Слово чести', desc: 'Выполните три предвыборных обещания', check: (g) => (g.counters.promisesKept ?? 0) >= 3 },
  { id: 'spy7', icon: '🕵️', name: 'Агент 007', desc: 'Проведите 7 успешных операций разведки', check: (g) => (g.counters.spyWins ?? 0) >= 7 },
  { id: 'catch5', icon: '🧤', name: 'Контрразведка не дремлет', desc: 'Поймайте 5 групп чужих агентов', check: (g) => (g.counters.spiesCaught ?? 0) >= 5 },
  { id: 'aaa', icon: '🏦', name: 'Рейтинг AAA', desc: 'Добейтесь высшего кредитного рейтинга', check: (g) => rating(g, g.player) === 0 },
  { id: 'top1', icon: '🥇', name: 'Мировой лидер', desc: 'Станьте №1 по военной мощи или экономике', check: (g) =>
    rankOf(g, (i) => STATS[i].power) === 1 || rankOf(g, (i) => STATS[i].moneyRate) === 1 },
];

export function checkAchievements(g: GameState) {
  for (const a of ACHIEVEMENTS) {
    if (g.achievements.includes(a.id)) continue;
    if (a.check(g)) {
      g.achievements.push(a.id);
      sfx('achievement');
      log(g, `🏅 Достижение: ${a.name}`, 'good', false);
      banner({ icon: a.icon, title: 'Достижение', text: a.name, kind: 'gold' });
    }
  }
}
