// Голос народа: граждане сами просят и требуют — в зависимости от того, что на самом деле происходит в стране.
// У каждого требования есть «давление» (0…1): чем хуже дела в этой сфере, тем громче люди. Боты отвечают своему народу тоже.
import { addRel, bestTileFor, buildCost, buildTime, cname, enemiesOf, neighborCountries, peekPair } from './actions';
import { FOOD_BASE } from './defs';
import { computeAll, STATS } from './economy';
import { fmt } from './format';
import { buyArms, buyFood, buyQuote, foodDays } from './market';
import { richTax, richTaxError, richTaxGain } from './society';
import { log, mapDirty, news, pick, putBuilding, rand, sfx } from './state';
import type { BuildingType, GameState, LogEntry, TempMod } from './types';
import { REGIONS, REGION_OF } from './world';

interface DemandOption {
  label: string;
  hint: (g: GameState, ci: number) => string;
  apply: (g: GameState, ci: number) => void;
  /** Насколько вариант нравится боту (больше — лучше). */
  ai: (g: GameState, ci: number) => number;
  can?: (g: GameState, ci: number) => boolean;
  /** Мировая новость, если так поступил бот: {c} — страна. */
  news?: [string, LogEntry['kind']];
}
/** Текст требования; можно сменить и заголовок с иконкой — тогда одно и то же требование каждый раз звучит по-новому. */
interface DemandText {
  title?: string;
  icon?: string;
  text: string;
}
interface DemandDef {
  id: string;
  icon: string;
  title: string;
  slogan: string;
  /** Общее требование (митинг, праздник): не повторяется, пока не прозвучат несколько других. */
  generic?: boolean;
  text: (g: GameState, ci: number) => string | DemandText;
  pressure: (g: GameState, ci: number) => number;
  options: DemandOption[];
}

// ---------- помощники ----------
const C = (g: GameState, ci: number) => g.countries[ci];
const income = (_g: GameState, ci: number) => Math.max(20, STATS[ci].taxIncome);
const cost = (g: GameState, ci: number, days: number) => income(g, ci) * days;
const pay = (g: GameState, ci: number, days: number) => { C(g, ci).money -= cost(g, ci, days); };
const rich = (g: GameState, ci: number) => C(g, ci).money > income(g, ci) * 120;
const broke = (g: GameState, ci: number) => C(g, ci).money < income(g, ci) * 25;
const free = (g: GameState, ci: number) => C(g, ci).gov === 'democracy' || C(g, ci).gov === 'republic';
const atWarNow = (g: GameState, ci: number) => enemiesOf(g, ci).length > 0;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function mod(g: GameState, ci: number, kind: TempMod['kind'], value: number, days: number, label: string) {
  C(g, ci).mods.push({ kind, value, until: g.day + days, label });
}
const stab = (g: GameState, ci: number, v: number, days: number, label: string) => mod(g, ci, 'stab', v, days, label);
function relDemocracies(g: GameState, ci: number, v: number) {
  g.countries.forEach((o, j) => { if (o.alive && j !== ci && o.gov === 'democracy') addRel(g, ci, j, v); });
}
const tell = (g: GameState, ci: number, text: string, kind: LogEntry['kind'] = 'info') => { if (ci === g.player) log(g, text, kind); };
const has = (_g: GameState, ci: number, type: BuildingType) => STATS[ci].coverage[type];
/** Случайный крупный город страны — чтобы требования приходили не только из столицы. */
function city(g: GameState, ci: number): string {
  const rs = [...STATS[ci].regions].sort((a, b) => g.regions[b].pop - g.regions[a].pop).slice(0, 6);
  return REGIONS[rs.length ? pick(g, rs) : C(g, ci).capital].name;
}
const enemyNames = (g: GameState, ci: number) => enemiesOf(g, ci).map((e) => cname(g, e)).join('», «');

const RALLY_WHO: [string, string][] = [
  ['Гражданские активисты', 'просят'], ['Студенческий союз', 'просит'], ['Профсоюз рабочих', 'просит'], ['Совет пенсионеров', 'просит'],
  ['Учителя и врачи', 'просят'], ['Молодёжное движение', 'просит'], ['Союз предпринимателей', 'просит'], ['Жители окраин', 'просят'],
];
const RALLY_FORM: [string, string, string][] = [
  ['Мирный митинг', '✊', 'мирный митинг'],
  ['Шествие с плакатами', '🪧', 'шествие с плакатами'],
  ['Пикет у правительства', '📣', 'пикет у здания правительства'],
  ['Марш за перемены', '🥁', 'марш с флагами и барабанами'],
  ['Сидячая акция', '🧘', 'сидячую акцию на главной площади'],
  ['Велопробег протеста', '🚲', 'велопробег по центру города'],
  ['Концерт-протест', '🎸', 'концерт-протест под открытым небом'],
];
const factories = (_g: GameState, ci: number) => STATS[ci].counts.factory;

/** Народная стройка: начинается сразу, даже если все стройплощадки заняты. Платит казна. */
function peopleBuild(g: GameState, ci: number, type: BuildingType): boolean {
  const tile = bestTileFor(g, ci, type);
  if (tile < 0) return false;
  const price = buildCost(g, ci, type, 1, REGION_OF[tile]);
  const c = C(g, ci);
  if (c.money < price) return false;
  c.money -= price;
  const t = buildTime(type, 1);
  putBuilding(g, tile, { type, level: 1, progress: t, total: t });
  mapDirty.buildings = true;
  if (ci === g.player) sfx('build');
  computeAll(g);
  return true;
}
const buildHint = (g: GameState, ci: number, type: BuildingType) => {
  const tile = bestTileFor(g, ci, type);
  return tile < 0 ? 'негде строить — выделим деньги' : `−${fmt(buildCost(g, ci, type, 1, REGION_OF[tile]))} 💰, стройка вне очереди`;
};

/** Сосед, который заметно сильнее и враждебен, или бот, который готовит против нас войну. */
function danger(g: GameState, ci: number): number {
  let d = 0;
  g.countries.forEach((c) => {
    if (c.alive && c.aiFlags.prepTarget === ci) d = Math.max(d, 0.75);
  });
  for (const j of neighborCountries(g, ci)) {
    if (peekPair(g, ci, j).alliance) continue;
    const ratio = STATS[j].power / Math.max(1, STATS[ci].power);
    if (ratio > 1.4 && g.rel[ci][j] < -20) d = Math.max(d, Math.min(0.7, 0.3 + (ratio - 1.4) * 0.3));
  }
  return d;
}

const DEMANDS: DemandDef[] = [
  {
    id: 'rally', icon: '✊', title: 'Мирный митинг', slogan: 'За светлое будущее!', generic: true,
    text: (g, ci) => {
      const [who, verb] = pick(g, RALLY_WHO);
      const [title, icon, form] = pick(g, RALLY_FORM);
      return { title, icon, text: `${who} ${verb} разрешить ${form} в городе ${city(g, ci)}. Лозунг: «${topSlogan(g, ci)}»` };
    },
    // громкость — от самой острой проблемы: если ничего не болит, на улицы не выходят
    pressure: (g, ci) => {
      const top = moodOf(g, ci).find((m) => m.id !== 'rally' && m.id !== 'festival');
      return 0.08 + 0.5 * (top?.pressure ?? 0) + (C(g, ci).stability < 45 ? 0.1 : 0);
    },
    options: [
      { label: 'Разрешить', hint: (g, ci) => (C(g, ci).stability < 30 ? `стабильность +${free(g, ci) ? 4 : 2}, но акция может перерасти в беспорядки` : `стабильность +${free(g, ci) ? 4 : 2}: людей услышали`),
        apply: (g, ci) => {
          if (C(g, ci).stability < 30 && rand(g) < 0.3) {
            stab(g, ci, -6, 120, 'Беспорядки после акции');
            tell(g, ci, '🔥 Акция протеста переросла в беспорядки', 'bad');
          } else {
            stab(g, ci, free(g, ci) ? 4 : 2, 120, 'Мирная акция');
            C(g, ci).unrest = Math.max(0, C(g, ci).unrest - 1);
          }
        },
        ai: (g, ci) => (free(g, ci) ? 2 : 0.8) - (C(g, ci).stability < 30 ? 1 : 0) },
      { label: 'Разрешить и выйти к людям', hint: (g, ci) => `−${fmt(cost(g, ci, 15))} 💰, стабильность +7, демократии одобряют`,
        apply: (g, ci) => { pay(g, ci, 15); stab(g, ci, 7, 150, 'Правитель вышел к народу'); relDemocracies(g, ci, 2); },
        ai: (g, ci) => (rich(g, ci) ? 2.3 : 0.5) + (C(g, ci).stability < 45 ? 0.6 : 0) },
      { label: 'Запретить', hint: (g, ci) => (C(g, ci).gov === 'dictatorship' ? 'стабильность −1' : `стабильность −${free(g, ci) ? 7 : 3}, демократии осуждают`),
        apply: (g, ci) => {
          const gov = C(g, ci).gov;
          stab(g, ci, gov === 'dictatorship' ? -1 : free(g, ci) ? -7 : -3, 150, 'Запрет акции');
          if (gov !== 'dictatorship') relDemocracies(g, ci, -3);
        },
        ai: (g, ci) => (C(g, ci).gov === 'dictatorship' ? 1.6 : C(g, ci).gov === 'monarchy' ? 1 : 0.2) },
      { label: 'Разогнать силой', hint: (g, ci) => (C(g, ci).gov === 'dictatorship' ? 'стабильность +1 (страх), отношения −3 со всеми' : 'стабильность −12, отношения −6 со всеми'),
        apply: (g, ci) => {
          const dict = C(g, ci).gov === 'dictatorship';
          stab(g, ci, dict ? 1 : -12, dict ? 60 : 200, 'Разгон акции');
          C(g, ci).unrest += dict ? 0.5 : 2;
          g.countries.forEach((o, j) => { if (o.alive && j !== ci) addRel(g, ci, j, dict ? -3 : -6); });
        },
        ai: (g, ci) => (C(g, ci).gov === 'dictatorship' && C(g, ci).personality === 'aggressor' ? 1.8 : -1),
        news: ['✊ {c}: мирная акция протеста разогнана силой', 'bad'] },
    ],
  },
  {
    id: 'taxes', icon: '💸', title: 'Налоги душат', slogan: 'Снизить налоги!',
    text: (g, ci) => {
      const t = Math.round(C(g, ci).tax * 100);
      return pick(g, [
        `Люди жалуются: налог ${t}% — это слишком. Малый бизнес закрывается.`,
        `Владельцы кафе и мастерских в городе ${city(g, ci)} повесили на двери таблички «Закрыто из-за налогов». Налог ${t}% съедает всю выручку.`,
        `Таксисты устроили автопробег с плакатами «${t}% — это грабёж!». К ним присоединяются торговцы и фермеры.`,
      ]);
    },
    pressure: (g, ci) => clamp01((C(g, ci).tax - 0.2) * 3.5),
    options: [
      { label: 'Снизить налог на 5%', hint: () => 'стабильность +6 на 150 дн., миллиардеров станет больше',
        apply: (g, ci) => { C(g, ci).tax = Math.max(0, C(g, ci).tax - 0.05); stab(g, ci, 6, 150, 'Снижение налогов'); },
        ai: (_g, ci) => (STATS[ci].moneyRate > STATS[ci].taxIncome * 0.15 ? 2 : 0.4),
        news: ['💸 {c} снизила налоги после протестов', 'info'] },
      { label: 'Объяснить, на что идут деньги', hint: (g, ci) => `−${fmt(cost(g, ci, 10))} 💰, стабильность +2`,
        apply: (g, ci) => { pay(g, ci, 10); stab(g, ci, 2, 100, 'Разъяснения правительства'); },
        ai: () => 1 },
      { label: 'Налоги нужны стране', hint: (g, ci) => `стабильность −${C(g, ci).gov === 'dictatorship' ? 2 : 5}`,
        apply: (g, ci) => stab(g, ci, C(g, ci).gov === 'dictatorship' ? -2 : -5, 120, 'Отказ снизить налоги'),
        ai: (g, ci) => (broke(g, ci) ? 1.5 : 0.3) },
    ],
  },
  {
    id: 'antiwar', icon: '🕊️', title: 'Народ устал от войны', slogan: 'Нет войне!',
    text: (g, ci) => pick(g, [
      `Война с «${enemyNames(g, ci)}» идёт слишком долго. Семьи ждут солдат домой.`,
      `У вокзала в городе ${city(g, ci)} стоят женщины со свечами: война с «${enemyNames(g, ci)}» забирает сыновей. Люди просят мира.`,
      `По улицам прошёл молчаливый марш: тысячи людей несли фотографии солдат. Война с «${enemyNames(g, ci)}» затянулась.`,
    ]),
    pressure: (g, ci) => (atWarNow(g, ci) ? clamp01(C(g, ci).weariness / 70 + (C(g, ci).stability < 40 ? 0.2 : 0)) : 0),
    options: [
      { label: 'Начать мирные переговоры', hint: () => 'враги охотнее согласятся на мир, усталость −8, стабильность +4',
        apply: (g, ci) => {
          for (const e of enemiesOf(g, ci)) { addRel(g, ci, e, 12); C(g, e).weariness = Math.min(100, C(g, e).weariness + 6); }
          C(g, ci).weariness = Math.max(0, C(g, ci).weariness - 8);
          stab(g, ci, 4, 100, 'Мирные переговоры');
        },
        ai: (g, ci) => (C(g, ci).personality === 'aggressor' ? 0.5 : 1.8) + (C(g, ci).weariness > 50 ? 1 : 0),
        news: ['🕊️ {c}: под давлением народа начались мирные переговоры', 'good'] },
      { label: 'Патриотическая кампания', hint: (g, ci) => `−${fmt(cost(g, ci, 25))} 💰, усталость −12, стабильность +3`,
        apply: (g, ci) => { pay(g, ci, 25); C(g, ci).weariness = Math.max(0, C(g, ci).weariness - 12); stab(g, ci, 3, 100, 'Патриотическая кампания'); },
        ai: (g, ci) => (rich(g, ci) ? 1.6 : 0.6) },
      { label: 'Война до победы', hint: (g, ci) => `стабильность −${C(g, ci).gov === 'dictatorship' ? 3 : 8}, усталость растёт`,
        apply: (g, ci) => { stab(g, ci, C(g, ci).gov === 'dictatorship' ? -3 : -8, 150, 'Война до победы'); C(g, ci).weariness = Math.min(100, C(g, ci).weariness + 4); },
        ai: (g, ci) => (C(g, ci).personality === 'aggressor' ? 1.7 : 0.2) },
    ],
  },
  {
    id: 'bread', icon: '🍞', title: 'Хлеба!', slogan: 'Хлеба и справедливых цен!',
    text: (g, ci) => (STATS[ci].hunger > 0
      ? pick(g, [
        `В стране голод: еды не хватает ${Math.round(STATS[ci].hunger * 100)}% людей. Очереди за хлебом растут.`,
        `В городе ${city(g, ci)} люди с ночи стоят у пекарен с пустыми сумками. Еды не хватает ${Math.round(STATS[ci].hunger * 100)}% жителей.`,
      ])
      : pick(g, [
        `Запасов еды осталось на ${Math.floor(foodDays(g, ci))} дн., цены в магазинах растут.`,
        `Хозяйки скупают крупу и муку мешками: ходят слухи, что еды осталось на ${Math.floor(foodDays(g, ci))} дн.`,
      ])),
    pressure: (g, ci) => {
      const s = STATS[ci];
      if (s.hunger > 0) return clamp01(0.6 + s.hunger);
      if (foodDays(g, ci) < 15) return 0.5;
      return s.foodProd < s.foodCons && g.market.food.price > FOOD_BASE * 1.8 ? 0.35 : 0;
    },
    options: [
      { label: 'Экстренная закупка зерна', hint: (g, ci) => `−${fmt(buyQuote(g.market.food, STATS[ci].foodCons * 45))} 💰: запас еды на 45 дней, стабильность +3`,
        apply: (g, ci) => { if (!buyFood(g, ci, STATS[ci].foodCons * 45)) stab(g, ci, 3, 90, 'Хлеб в магазинах'); else tell(g, ci, '🍞 Закупить зерно не удалось', 'bad'); },
        ai: (g, ci) => (rich(g, ci) ? 2.2 : 0.8) },
      { label: 'Субсидии фермерам', hint: (g, ci) => `−${fmt(cost(g, ci, 35))} 💰, урожай +20% на 300 дн.`,
        apply: (g, ci) => { pay(g, ci, 35); mod(g, ci, 'food', 0.2, 300, 'Субсидии фермерам'); },
        ai: () => 1.4 },
      { label: 'Талоны на продукты', hint: () => 'стабильность −5, еды тратится меньше (урожай +10% на 150 дн.)',
        apply: (g, ci) => { stab(g, ci, -5, 120, 'Продуктовые талоны'); mod(g, ci, 'food', 0.1, 150, 'Продуктовые талоны'); },
        ai: (g, ci) => (broke(g, ci) ? 1.8 : 0.2),
        news: ['🍞 {c} ввела продуктовые талоны', 'bad'] },
    ],
  },
  {
    id: 'health', icon: '🏥', title: 'Больницы переполнены', slogan: 'Доступная медицина!',
    text: (g, ci) => pick(g, [
      'Врачи и пациенты требуют денег на медицину: очереди к врачу — по месяцу.',
      `Медсёстры больницы в городе ${city(g, ci)} вышли на пикет: лекарств не хватает, а смены длятся сутками.`,
      'Скорая едет по два часа. Люди собирают подписи за новые больницы и зарплаты врачам.',
    ]),
    pressure: (g, ci) => (C(g, ci).budget.health <= 1 ? 0.45 : 0) + (STATS[ci].growthYear < 0 ? 0.2 : 0) + (g.day > 300 && has(g, ci, 'hospital') < 0.3 ? 0.15 : 0),
    options: [
      { label: 'Поднять бюджет медицины', can: (g, ci) => C(g, ci).budget.health < 3, hint: () => 'расходы бюджета растут, стабильность +3',
        apply: (g, ci) => { C(g, ci).budget.health++; stab(g, ci, 3, 120, 'Деньги на медицину'); },
        ai: (_g, ci) => (STATS[ci].moneyRate > STATS[ci].taxIncome * 0.1 ? 2 : 0.5) },
      { label: 'Построить больницу', hint: (g, ci) => buildHint(g, ci, 'hospital'),
        apply: (g, ci) => { if (!peopleBuild(g, ci, 'hospital')) pay(g, ci, 20); stab(g, ci, 3, 120, 'Новая больница'); },
        ai: (g, ci) => (rich(g, ci) ? 1.8 : 0.7) },
      { label: 'Денег нет', hint: () => 'стабильность −4, рост населения −0.2% на 200 дн.',
        apply: (g, ci) => { stab(g, ci, -4, 120, 'Медицина без денег'); mod(g, ci, 'growth', -0.2, 200, 'Медицина без денег'); },
        ai: (g, ci) => (broke(g, ci) ? 1.5 : 0) },
    ],
  },
  {
    id: 'students', icon: '🎓', title: 'Студенты просят гранты', slogan: 'Образование для всех!',
    text: (g, ci) => pick(g, [
      'Студенты вышли к университетам: учёба дорожает, лучшие выпускники уезжают за границу.',
      `Студенты в городе ${city(g, ci)} устроили «лекцию под открытым небом» прямо у здания правительства: стипендии не хватает даже на учебники.`,
      'Выпускники собирают чемоданы: за границей молодым учёным платят втрое больше. Студенты просят гранты и общежития.',
    ]),
    pressure: (g, ci) => (C(g, ci).budget.edu <= 1 ? 0.45 : 0) + (C(g, ci).scientists < STATS[ci].sciTarget * 0.9 ? 0.15 : 0) + (C(g, ci).scientists > STATS[ci].sciTarget * 1.05 ? 0.2 : 0),
    options: [
      { label: 'Гранты студентам', hint: (g, ci) => `−${fmt(cost(g, ci, 25))} 💰, учёных станет больше, стабильность +2`,
        apply: (g, ci) => { pay(g, ci, 25); mod(g, ci, 'sci', 0.12, 300, 'Гранты студентам'); stab(g, ci, 2, 100, 'Гранты студентам'); },
        ai: (g, ci) => (C(g, ci).personality === 'scientist' ? 2.5 : 1) + (rich(g, ci) ? 0.5 : 0) },
      { label: 'Поднять бюджет образования', can: (g, ci) => C(g, ci).budget.edu < 3, hint: () => 'больше 🧠 и учёных, стабильность +3',
        apply: (g, ci) => { C(g, ci).budget.edu++; stab(g, ci, 3, 120, 'Деньги на образование'); },
        ai: (_g, ci) => (STATS[ci].moneyRate > STATS[ci].taxIncome * 0.1 ? 1.6 : 0.3) },
      { label: 'Отказать', hint: () => '2% учёных уедут за границу, стабильность −3',
        apply: (g, ci) => { const out = C(g, ci).scientists * 0.02; C(g, ci).scientists -= out; g.market.sciPool += out; stab(g, ci, -3, 100, 'Отказ студентам'); },
        ai: (g, ci) => (broke(g, ci) ? 1.2 : 0) },
    ],
  },
  {
    id: 'richtax', icon: '💎', title: 'Богатые не платят', slogan: 'Справедливые налоги для богатых!',
    text: (g, ci) => pick(g, [
      `В стране ${fmt(C(g, ci).billionaires)} миллиардеров, а простые люди едва сводят концы с концами. Народ требует справедливости.`,
      `Пока ${fmt(C(g, ci).billionaires)} миллиардеров покупают яхты, в городе ${city(g, ci)} закрывают библиотеки. Люди требуют, чтобы богатые платили больше.`,
    ]),
    pressure: (g, ci) => {
      const c = C(g, ci);
      if (c.billionaires < 3 || richTaxError(g, ci)) return 0;
      const ratio = c.billionaires / Math.max(1, STATS[ci].gdpIndex * 0.035);
      return clamp01((ratio - 1) * 0.6 + (c.stability < 50 ? 0.25 : 0) + (c.tax < 0.15 ? 0.15 : 0));
    },
    options: [
      { label: 'Налог на сверхбогатых', hint: (g, ci) => `+${fmt(richTaxGain(g, ci))} 💰, стабильность +${free(g, ci) ? 5 : 3}, 20% миллиардеров уедут`,
        apply: (g, ci) => { richTax(g, ci); },
        ai: (g, ci) => (broke(g, ci) ? 2.2 : 1) - (C(g, ci).personality === 'trader' ? 1 : 0) },
      { label: 'Попросить о благотворительности', hint: (g, ci) => `+${fmt(C(g, ci).billionaires * 20)} 💰, стабильность +3`,
        apply: (g, ci) => { C(g, ci).money += C(g, ci).billionaires * 20; stab(g, ci, 3, 100, 'Благотворительность богачей'); },
        ai: () => 1.3 },
      { label: 'Богатые создают рабочие места', hint: () => 'стабильность −4, миллиардеров станет больше',
        apply: (g, ci) => { stab(g, ci, -4, 120, 'Защита богатых'); mod(g, ci, 'rich', 0.1, 200, 'Защита богатых'); },
        ai: (g, ci) => (C(g, ci).personality === 'trader' ? 1.8 : 0.3) },
    ],
  },
  {
    id: 'ecology', icon: '🌳', title: 'Экологи против заводов', slogan: 'Чистый воздух!',
    text: (g, ci) => pick(g, [
      `${factories(g, ci)} заводов дымят над городами. Экологи требуют защитить природу.`,
      `Над городом ${city(g, ci)} висит рыжий смог, дети кашляют. Экологи надели противогазы и встали живой цепью у заводских ворот.`,
      'В реке у заводов всплыла рыба. Экологи требуют фильтры на трубы и штрафы для тех, кто загрязняет.',
    ]),
    pressure: (g, ci) => (factories(g, ci) > 6 ? Math.min(0.7, (factories(g, ci) - 6) / 14) + (C(g, ci).gov === 'democracy' ? 0.1 : 0) : 0),
    options: [
      { label: 'Зелёные технологии', hint: (g, ci) => `−${fmt(cost(g, ci, 35))} 💰, стабильность +6 на 200 дн.`,
        apply: (g, ci) => { pay(g, ci, 35); stab(g, ci, 6, 200, 'Зелёные технологии'); },
        ai: (g, ci) => (rich(g, ci) ? 1.8 : 0.4) },
      { label: 'Создать заповедник', hint: (g, ci) => `−${fmt(cost(g, ci, 12))} 💰, стабильность +3`,
        apply: (g, ci) => { pay(g, ci, 12); stab(g, ci, 3, 120, 'Новый заповедник'); },
        ai: () => 1.2 },
      { label: 'Экономика важнее', hint: () => 'стабильность −4, производительность +3% на 150 дн.',
        apply: (g, ci) => { stab(g, ci, -4, 150, 'Экология подождёт'); mod(g, ci, 'prod', 0.03, 150, 'Экология подождёт'); },
        ai: (g, ci) => (C(g, ci).personality === 'aggressor' || broke(g, ci) ? 1.5 : 0.4) },
    ],
  },
  {
    id: 'mothers', icon: '🪖', title: 'Матери солдат', slogan: 'Верните наших сыновей!',
    text: (g) => pick(g, [
      'Комитет солдатских матерей требует отменить призыв: молодые ребята гибнут и калечатся.',
      'Матери солдат приехали к министерству обороны с портретами сыновей. Они требуют отменить призыв.',
    ]),
    pressure: (g, ci) => {
      const c = C(g, ci);
      if (c.armyType !== 'conscript') return 0;
      return atWarNow(g, ci) || c.soldiers / Math.max(1, STATS[ci].civPop) > 0.012 ? clamp01(0.35 + c.weariness / 150) : 0;
    },
    options: [
      { label: 'Перейти на контрактную армию', hint: () => 'армия сильнее, но дороже; стабильность +5',
        apply: (g, ci) => { C(g, ci).armyType = 'contract'; stab(g, ci, 5, 150, 'Отмена призыва'); },
        ai: (_g, ci) => (STATS[ci].moneyRate > STATS[ci].upkeepArmy ? 1.5 : 0.3) },
      { label: 'Выплаты семьям солдат', hint: (g, ci) => `−${fmt(cost(g, ci, 25))} 💰, стабильность +5`,
        apply: (g, ci) => { pay(g, ci, 25); stab(g, ci, 5, 120, 'Выплаты семьям солдат'); },
        ai: (g, ci) => (rich(g, ci) ? 1.7 : 0.6) },
      { label: 'Служба — долг каждого', hint: (g, ci) => `стабильность −${C(g, ci).gov === 'dictatorship' ? 2 : 6}`,
        apply: (g, ci) => stab(g, ci, C(g, ci).gov === 'dictatorship' ? -2 : -6, 150, 'Призыв остаётся'),
        ai: (g, ci) => (C(g, ci).personality === 'aggressor' ? 1.6 : 0.3) },
    ],
  },
  {
    id: 'freedom', icon: '🗳️', title: 'Требуем выборов', slogan: 'Свободные выборы!',
    text: (g, ci) => pick(g, [
      `Оппозиция собирает тысячи людей: «${C(g, ci).gov === 'monarchy' ? 'Конституцию и парламент' : 'Долой диктатуру'}!»`,
      'Студенты расклеили листовки «Мы хотим выбирать!», а по вечерам люди стучат в кастрюли на балконах.',
    ]),
    pressure: (g, ci) => {
      const c = C(g, ci);
      if (c.gov !== 'dictatorship' && c.gov !== 'monarchy') return 0;
      return clamp01((55 - c.stability) / 45 + (c.gov === 'dictatorship' ? 0.15 : 0));
    },
    options: [
      { label: 'Провести реформы', hint: () => 'новая форма правления — республика, стабильность +6, демократии рады',
        apply: (g, ci) => {
          const c = C(g, ci);
          c.gov = 'republic';
          c.govChangedDay = g.day;
          stab(g, ci, 6, 200, 'Демократические реформы');
          relDemocracies(g, ci, 5);
          tell(g, ci, '🏛️ Новая форма правления: Республика', 'good');
        },
        ai: (g, ci) => (C(g, ci).stability < 25 ? 2.5 : 0.6) - (C(g, ci).personality === 'aggressor' ? 1 : 0),
        news: ['🗳️ {c}: после протестов власть провела демократические реформы', 'good'] },
      { label: 'Пообещать выборы', hint: () => 'стабильность +5 на 120 дн.',
        apply: (g, ci) => stab(g, ci, 5, 120, 'Обещание выборов'),
        ai: () => 1.4 },
      { label: 'Закрутить гайки', hint: (g, ci) => `стабильность −${C(g, ci).gov === 'dictatorship' ? 3 : 8}, демократии осуждают`,
        apply: (g, ci) => {
          stab(g, ci, C(g, ci).gov === 'dictatorship' ? -3 : -8, 200, 'Закручивание гаек');
          C(g, ci).unrest += 2;
          relDemocracies(g, ci, -3);
        },
        ai: (g, ci) => (C(g, ci).personality === 'aggressor' || C(g, ci).personality === 'fanatic' ? 1.6 : 0.2),
        news: ['⛓️ {c}: оппозиция разгромлена, лидеры протестов арестованы', 'bad'] },
    ],
  },
  {
    id: 'faith', icon: '⛪', title: 'Верующие просят храм', slogan: 'Уважайте веру!',
    text: (g, ci) => pick(g, [
      'Верующие собирают подписи: в новых районах нет ни одного храма.',
      `Прихожане в городе ${city(g, ci)} молятся под открытым небом: старый храм тесен, а нового нет.`,
    ]),
    pressure: (g, ci) => {
      const r = C(g, ci).religion;
      if (r === 'state' || r === 'theocracy') return has(g, ci, 'temple') < 0.6 ? 0.45 : 0.1;
      return r === 'secular' ? 0.2 : has(g, ci, 'temple') < 0.2 && g.day > 400 ? 0.15 : 0;
    },
    options: [
      { label: 'Построить храм', hint: (g, ci) => buildHint(g, ci, 'temple'),
        apply: (g, ci) => { if (!peopleBuild(g, ci, 'temple')) pay(g, ci, 15); stab(g, ci, 3, 120, 'Новый храм'); },
        ai: (g, ci) => (C(g, ci).personality === 'fanatic' ? 2.5 : 1) },
      { label: 'Пожертвование на храмы', hint: (g, ci) => `−${fmt(cost(g, ci, 15))} 💰, стабильность +4`,
        apply: (g, ci) => { pay(g, ci, 15); stab(g, ci, 4, 150, 'Пожертвование на храмы'); },
        ai: () => 1.2 },
      { label: 'Отказать', hint: (g, ci) => `стабильность −${C(g, ci).religion === 'theocracy' ? 8 : 4}`,
        apply: (g, ci) => stab(g, ci, C(g, ci).religion === 'theocracy' ? -8 : -4, 150, 'Отказ верующим'),
        ai: (g, ci) => (C(g, ci).religion === 'secular' ? 1.5 : 0) },
    ],
  },
  {
    id: 'migrants', icon: '🧳', title: 'Споры о мигрантах', slogan: 'Наведите порядок на границе!',
    text: (g, ci) => pick(g, [
      'Одни требуют закрыть границы, другие — защитить приезжих. Страна спорит.',
      `В городе ${city(g, ci)} спорят до хрипоты: одни несут приезжим одеяла, другие требуют закрыть границу.`,
    ]),
    pressure: (g, ci) => (C(g, ci).migration === 2 ? 0.45 + (C(g, ci).stability < 50 ? 0.2 : 0) : C(g, ci).migration === 1 && C(g, ci).stability < 45 ? 0.25 : 0),
    options: [
      { label: 'Ограничить миграцию', can: (g, ci) => C(g, ci).migration > 0, hint: () => 'миграция на ступень строже',
        apply: (g, ci) => { C(g, ci).migration--; },
        ai: (g, ci) => (C(g, ci).stability < 50 ? 1.8 : 0.6) },
      { label: 'Программы интеграции', hint: (g, ci) => `−${fmt(cost(g, ci, 20))} 💰, стабильность +4`,
        apply: (g, ci) => { pay(g, ci, 20); stab(g, ci, 4, 150, 'Интеграция мигрантов'); },
        ai: (g, ci) => (rich(g, ci) ? 1.6 : 0.5) },
      { label: 'Мигранты нужны экономике', hint: () => 'стабильность −4, рост населения +0.1%',
        apply: (g, ci) => { stab(g, ci, -4, 120, 'Споры о мигрантах'); mod(g, ci, 'growth', 0.1, 200, 'Мигранты'); },
        ai: (g, ci) => (C(g, ci).personality === 'trader' ? 1.4 : 0.3) },
    ],
  },
  {
    id: 'jobs', icon: '🏭', title: 'Нужна работа', slogan: 'Работу людям!',
    text: (g, ci) => pick(g, [
      'В городах растёт безработица. Люди просят открыть новые предприятия.',
      `У биржи труда в городе ${city(g, ci)} очередь с самого утра. Молодёжь просит работу, а не пособия.`,
    ]),
    pressure: (g, ci) => (g.day > 150 && has(g, ci, 'factory') < 0.35 ? 0.4 : 0) + (STATS[ci].moneyRate < 0 ? 0.15 : 0),
    options: [
      { label: 'Построить завод', hint: (g, ci) => buildHint(g, ci, 'factory'),
        apply: (g, ci) => { if (!peopleBuild(g, ci, 'factory')) { pay(g, ci, 20); mod(g, ci, 'prod', 0.04, 200, 'Новые рабочие места'); } stab(g, ci, 2, 100, 'Новые рабочие места'); },
        ai: () => 2 },
      { label: 'Госпрограмма занятости', hint: (g, ci) => `−${fmt(cost(g, ci, 30))} 💰, производительность +6% на 200 дн.`,
        apply: (g, ci) => { pay(g, ci, 30); mod(g, ci, 'prod', 0.06, 200, 'Программа занятости'); stab(g, ci, 2, 100, 'Программа занятости'); },
        ai: (g, ci) => (rich(g, ci) ? 1.7 : 0.6) },
      { label: 'Пусть ищут сами', hint: () => 'стабильность −4',
        apply: (g, ci) => stab(g, ci, -4, 120, 'Безработица'),
        ai: (g, ci) => (broke(g, ci) ? 1.2 : 0) },
    ],
  },
  {
    id: 'defense', icon: '🛡️', title: 'Народ просит защиты', slogan: 'Защитите наши границы!',
    text: (g, ci) => {
      const prep = g.countries.find((c) => c.alive && c.aiFlags.prepTarget === ci);
      return prep ? `Соседи шепчутся: «${cname(g, prep.idx)}» стягивает войска. Люди боятся войны и просят укрепить армию.` : 'Рядом сильный и недружелюбный сосед. Люди боятся войны и просят укрепить армию.';
    },
    pressure: (g, ci) => danger(g, ci),
    options: [
      { label: 'Поднять военный бюджет', can: (g, ci) => C(g, ci).budget.military < 3, hint: () => `мораль выше, оружия выпускается больше, стабильность +3`,
        apply: (g, ci) => { C(g, ci).budget.military++; stab(g, ci, 3, 120, 'Укрепление обороны'); },
        ai: () => 1.8 },
      { label: 'Закупить оружие', hint: (g, ci) => `−${fmt(buyQuote(g.market.arms, (C(g, ci).soldiers + STATS[ci].deployed) * 0.2))} 💰: +20% оружия армии`,
        apply: (g, ci) => { if (!buyArms(g, ci, (C(g, ci).soldiers + STATS[ci].deployed) * 0.2)) stab(g, ci, 3, 120, 'Новое оружие'); else tell(g, ci, '🔫 Купить оружие не удалось', 'bad'); },
        ai: (g, ci) => (rich(g, ci) ? 2.2 : 0.5) },
      { label: 'Мы — мирная страна', hint: () => 'стабильность −3, отношения с соседями +3',
        apply: (g, ci) => { stab(g, ci, -3, 100, 'Тревога'); for (const n of neighborCountries(g, ci)) addRel(g, ci, n, 3); },
        ai: (g, ci) => (C(g, ci).personality === 'cautious' || C(g, ci).personality === 'trader' ? 1 : 0.3) },
    ],
  },
  {
    id: 'festival', icon: '🎉', title: 'Народ хочет праздника', slogan: 'Праздник для всех!', generic: true,
    text: (g, ci) => pick<string | DemandText>(g, [
      'Дела идут хорошо, и люди хотят отметить успехи страны большим праздником.',
      { title: 'Карнавал!', icon: '🎭', text: 'Люди предлагают устроить карнавал: маски, фейерверки, уличная еда и танцы до утра.' },
      { title: 'Юбилей города', icon: '🎂', text: `Городу ${city(g, ci)} исполняется круглая дата. Жители просят праздник на всю страну.` },
    ]),
    pressure: (g, ci) => (C(g, ci).stability > 65 && !atWarNow(g, ci) ? 0.3 : 0),
    options: [
      { label: 'Народные гуляния', hint: (g, ci) => `−${fmt(cost(g, ci, 15))} 💰, стабильность +6 на 120 дн.`,
        apply: (g, ci) => { pay(g, ci, 15); stab(g, ci, 6, 120, 'Народные гуляния'); },
        ai: (g, ci) => (rich(g, ci) ? 1.8 : 0.5) },
      { label: 'Скромный праздник', hint: () => 'стабильность +2',
        apply: (g, ci) => stab(g, ci, 2, 60, 'Скромный праздник'),
        ai: () => 1 },
    ],
  },
  {
    id: 'labs', icon: '🔬', title: 'Учёным нужны лаборатории', slogan: 'Науке — финансирование!',
    text: (g, ci) => pick(g, [
      `У нас ${fmt(C(g, ci).scientists)} учёных, но лабораторий не хватает. Без них учёные уедут туда, где их ценят.`,
      'Молодые учёные ставят опыты в подвалах и на кухнях. Они просят лаборатории и оборудование.',
    ]),
    pressure: (g, ci) => (C(g, ci).scientists > STATS[ci].sciTarget * 1.03 ? 0.35 : 0) + (g.day > 200 && has(g, ci, 'university') < 0.3 ? 0.25 : 0),
    options: [
      { label: 'Построить университет', hint: (g, ci) => buildHint(g, ci, 'university'),
        apply: (g, ci) => { if (!peopleBuild(g, ci, 'university')) { pay(g, ci, 20); mod(g, ci, 'sci', 0.1, 200, 'Новые лаборатории'); } },
        ai: (g, ci) => (C(g, ci).personality === 'scientist' ? 2.5 : 1.3) },
      { label: 'Гранты на исследования', hint: (g, ci) => `−${fmt(cost(g, ci, 25))} 💰, 🧠 +10% и больше учёных на 200 дн.`,
        apply: (g, ci) => { pay(g, ci, 25); mod(g, ci, 'brains', 0.1, 200, 'Гранты на исследования'); mod(g, ci, 'sci', 0.1, 200, 'Гранты на исследования'); },
        ai: (g, ci) => (rich(g, ci) ? 1.8 : 0.6) },
      { label: 'Отказать', hint: () => '3% учёных уедут за границу, стабильность −2',
        apply: (g, ci) => { const out = C(g, ci).scientists * 0.03; C(g, ci).scientists -= out; g.market.sciPool += out; stab(g, ci, -2, 100, 'Отказ учёным'); },
        ai: (g, ci) => (broke(g, ci) ? 1.2 : 0) },
    ],
  },
  {
    id: 'farmers', icon: '🚜', title: 'Фермеры недовольны ценами', slogan: 'Поддержите село!',
    text: (g) => pick(g, [
      'Зерно на мировом рынке подешевело, и фермеры работают себе в убыток. Они перекрыли трассы тракторами.',
      'Фермеры привезли к министерству грузовик картошки и раздают её бесплатно: «Всё равно продаём дешевле себестоимости».',
    ]),
    pressure: (g, ci) => (g.market.food.price < FOOD_BASE * 0.8 && STATS[ci].foodProd > STATS[ci].foodCons * 1.15 ? 0.45 : 0),
    options: [
      { label: 'Субсидии фермерам', hint: (g, ci) => `−${fmt(cost(g, ci, 20))} 💰, урожай +10% на 300 дн., стабильность +3`,
        apply: (g, ci) => { pay(g, ci, 20); mod(g, ci, 'food', 0.1, 300, 'Субсидии фермерам'); stab(g, ci, 3, 120, 'Субсидии фермерам'); },
        ai: (g, ci) => (rich(g, ci) ? 1.6 : 0.6) },
      { label: 'Скупить зерно в госрезерв', hint: () => 'государственный запас еды на 60 дней больше, стабильность +2',
        apply: (g, ci) => { C(g, ci).foodReserve = Math.min(365, C(g, ci).foodReserve + 60); stab(g, ci, 2, 100, 'Госзакупки зерна'); },
        ai: () => 1.3 },
      { label: 'Рынок всё решит', hint: () => 'стабильность −3, урожай −5% на 150 дн.',
        apply: (g, ci) => { stab(g, ci, -3, 120, 'Фермерские протесты'); mod(g, ci, 'food', -0.05, 150, 'Фермерские протесты'); },
        ai: (g, ci) => (broke(g, ci) ? 1.4 : 0.2) },
    ],
  },
  {
    id: 'parade', icon: '🎖️', title: 'Парад победы', slogan: 'Слава героям!',
    text: () => 'Армия вернулась с победой. Ветераны и их семьи просят провести парад.',
    pressure: (g, ci) => (ci === g.player && g.day - (g.counters.lastWinDay ?? -999) < 90 && !atWarNow(g, ci) ? 0.5 : 0),
    options: [
      { label: 'Провести парад', hint: (g, ci) => `−${fmt(cost(g, ci, 15))} 💰, стабильность +7, усталость от войны −10`,
        apply: (g, ci) => { pay(g, ci, 15); stab(g, ci, 7, 150, 'Парад победы'); C(g, ci).weariness = Math.max(0, C(g, ci).weariness - 10); },
        ai: () => 1.5 },
      { label: 'Почтить павших', hint: () => 'стабильность +3, усталость −5',
        apply: (g, ci) => { stab(g, ci, 3, 120, 'Память павших'); C(g, ci).weariness = Math.max(0, C(g, ci).weariness - 5); },
        ai: () => 1 },
    ],
  },
  {
    id: 'roads', icon: '🛣️', title: 'Дороги разбиты', slogan: 'Дороги, а не ямы!',
    text: (g, ci) => pick(g, [
      'Водители жалуются: на трассах ямы размером с ванну. Грузовики ломаются, товары едут неделями.',
      `Жители города ${city(g, ci)} высадили цветы прямо в ямы на главной улице — и сфотографировали для газет.`,
      'Между городами легче долететь, чем доехать. Люди просят дороги и мосты.',
    ]),
    pressure: (g, ci) => (C(g, ci).budget.infra <= 1 ? 0.45 : 0) + (g.day > 250 && STATS[ci].regions.length >= 8 && C(g, ci).budget.infra < 3 ? 0.15 : 0),
    options: [
      { label: 'Поднять бюджет инфраструктуры', can: (g, ci) => C(g, ci).budget.infra < 3, hint: () => 'производительность выше, стабильность +3',
        apply: (g, ci) => { C(g, ci).budget.infra++; stab(g, ci, 3, 120, 'Деньги на дороги'); },
        ai: (_g, ci) => (STATS[ci].moneyRate > STATS[ci].taxIncome * 0.1 ? 1.8 : 0.4) },
      { label: 'Отремонтировать главные трассы', hint: (g, ci) => `−${fmt(cost(g, ci, 25))} 💰, производительность +4% на 250 дн., стабильность +2`,
        apply: (g, ci) => { pay(g, ci, 25); mod(g, ci, 'prod', 0.04, 250, 'Новые дороги'); stab(g, ci, 2, 120, 'Новые дороги'); },
        ai: (g, ci) => (rich(g, ci) ? 1.7 : 0.6) },
      { label: 'Ямы — это традиция', hint: () => 'стабильность −3',
        apply: (g, ci) => stab(g, ci, -3, 120, 'Разбитые дороги'),
        ai: (g, ci) => (broke(g, ci) ? 1.3 : 0) },
    ],
  },
  {
    id: 'housing', icon: '🏘️', title: 'Жильё не по карману', slogan: 'Квартиры молодым семьям!',
    text: (g, ci) => pick(g, [
      'Молодые семьи по десять лет копят на квартиру и живут у родителей. Люди просят доступное жильё.',
      `В городе ${city(g, ci)} аренда подорожала вдвое. Студенты живут по шестеро в комнате.`,
    ]),
    pressure: (_g, ci) => (STATS[ci].civPop > STATS[ci].popCap * 0.92 ? 0.4 : 0) + (STATS[ci].growthYear > 1.2 ? 0.2 : 0),
    options: [
      { label: 'Льготная ипотека', hint: (g, ci) => `−${fmt(cost(g, ci, 30))} 💰, рост 👥 +0.3%/год на 300 дн., стабильность +4`,
        apply: (g, ci) => { pay(g, ci, 30); mod(g, ci, 'growth', 0.3, 300, 'Льготная ипотека'); stab(g, ci, 4, 150, 'Льготная ипотека'); },
        ai: (g, ci) => (rich(g, ci) ? 1.8 : 0.6) },
      { label: 'Государственная стройка жилья', hint: (g, ci) => `−${fmt(cost(g, ci, 45))} 💰, стабильность +6 на 200 дн.`,
        apply: (g, ci) => { pay(g, ci, 45); stab(g, ci, 6, 200, 'Новые кварталы'); },
        ai: (g, ci) => (rich(g, ci) ? 1.5 : 0.3) },
      { label: 'Рынок отрегулирует', hint: () => 'стабильность −4',
        apply: (g, ci) => stab(g, ci, -4, 120, 'Дорогое жильё'),
        ai: (g, ci) => (broke(g, ci) || C(g, ci).personality === 'trader' ? 1.3 : 0.2) },
    ],
  },
  {
    id: 'pensions', icon: '👵', title: 'Пенсионеры просят прибавки', slogan: 'Достойную пенсию!',
    text: (g, ci) => pick(g, [
      'Пенсионеры пишут коллективное письмо: пенсии не хватает даже на лекарства и коммуналку.',
      `Бабушки из города ${city(g, ci)} вышли на площадь с самодельными плакатами и термосами с чаем.`,
      'Ветераны труда просят поднять пенсии: «Мы строили эту страну — не забывайте нас».',
    ]),
    pressure: (g, ci) => (g.day > 200 ? 0.12 + (C(g, ci).budget.health <= 1 ? 0.3 : 0) + (C(g, ci).stability < 50 ? 0.15 : 0) + (broke(g, ci) ? 0.1 : 0) : 0),
    options: [
      { label: 'Поднять пенсии', hint: (g, ci) => `−${fmt(cost(g, ci, 30))} 💰, стабильность +5 на 200 дн.`,
        apply: (g, ci) => { pay(g, ci, 30); stab(g, ci, 5, 200, 'Прибавка к пенсии'); },
        ai: (g, ci) => (rich(g, ci) ? 1.9 : 0.6) + (free(g, ci) ? 0.4 : 0) },
      { label: 'Разовая выплата к празднику', hint: (g, ci) => `−${fmt(cost(g, ci, 10))} 💰, стабильность +2`,
        apply: (g, ci) => { pay(g, ci, 10); stab(g, ci, 2, 90, 'Выплата пенсионерам'); },
        ai: () => 1.2 },
      { label: 'Денег нет, но держитесь', hint: () => 'стабильность −5, над вами смеются в интернете',
        apply: (g, ci) => stab(g, ci, -5, 150, 'Обиженные пенсионеры'),
        ai: (g, ci) => (broke(g, ci) ? 1.4 : 0) },
    ],
  },
  {
    id: 'corruption', icon: '🕵️', title: 'Хватит воровать!', slogan: 'Чиновников — к ответу!',
    text: (g, ci) => pick(g, [
      'Журналисты нашли у замминистра дворец с золотыми унитазами. Люди требуют наказать коррупционеров.',
      `Мэр города ${city(g, ci)} построил себе третью дачу, а дорога к школе так и не готова. Народ возмущён.`,
      'Блогер выложил видео: чиновник в часах ценой в сто зарплат учителя. Ролик посмотрела вся страна.',
    ]),
    pressure: (g, ci) => {
      const c = C(g, ci);
      if (g.day < 300) return 0;
      return 0.08 + (c.gov === 'dictatorship' || c.gov === 'monarchy' ? 0.15 : 0) + (c.stability < 50 ? 0.2 : 0) + (c.tax > 0.3 ? 0.1 : 0);
    },
    options: [
      { label: 'Антикоррупционный комитет', hint: (g, ci) => `−${fmt(cost(g, ci, 20))} 💰, производительность +5% на 300 дн., стабильность +3`,
        apply: (g, ci) => { pay(g, ci, 20); mod(g, ci, 'prod', 0.05, 300, 'Борьба с коррупцией'); stab(g, ci, 3, 150, 'Борьба с коррупцией'); },
        ai: (g, ci) => (free(g, ci) ? 1.8 : 0.8) },
      { label: 'Показательный процесс', hint: () => 'стабильность +5 на 100 дн., чиновники напуганы',
        apply: (g, ci) => { stab(g, ci, 5, 100, 'Показательный процесс'); C(g, ci).unrest = Math.max(0, C(g, ci).unrest - 0.5); },
        ai: (g, ci) => (C(g, ci).gov === 'dictatorship' ? 1.7 : 1) },
      { label: 'Это клевета оппозиции', hint: (g, ci) => `стабильность −${free(g, ci) ? 6 : 3}, демократии хмурятся`,
        apply: (g, ci) => { stab(g, ci, free(g, ci) ? -6 : -3, 150, 'Коррупция без наказания'); relDemocracies(g, ci, -2); },
        ai: (g, ci) => (C(g, ci).personality === 'aggressor' ? 1 : 0.2),
        news: ['🕵️ {c}: власти назвали коррупционный скандал «клеветой»', 'bad'] },
    ],
  },
  {
    id: 'crime', icon: '🚨', title: 'Преступность растёт', slogan: 'Безопасные улицы!',
    text: (g, ci) => pick(g, [
      'По вечерам люди боятся выходить из дома: кражи и грабежи участились.',
      `В городе ${city(g, ci)} за неделю ограбили три банка и кондитерскую. Жители просят навести порядок.`,
    ]),
    pressure: (g, ci) => clamp01(Math.max(0, C(g, ci).unrest - 0.5) * 0.3 + (C(g, ci).stability < 40 ? 0.3 : 0) + (STATS[ci].hunger > 0 ? 0.15 : 0)),
    options: [
      { label: 'Больше полиции на улицах', hint: (g, ci) => `−${fmt(cost(g, ci, 20))} 💰, стабильность +4, волнения стихают`,
        apply: (g, ci) => { pay(g, ci, 20); stab(g, ci, 4, 150, 'Полиция на улицах'); C(g, ci).unrest = Math.max(0, C(g, ci).unrest - 1); },
        ai: (g, ci) => (rich(g, ci) ? 1.8 : 0.8) },
      { label: 'Кружки и спорт для молодёжи', hint: (g, ci) => `−${fmt(cost(g, ci, 15))} 💰, стабильность +2, 🧠 +3% на 200 дн.`,
        apply: (g, ci) => { pay(g, ci, 15); stab(g, ci, 2, 150, 'Занятия для молодёжи'); mod(g, ci, 'brains', 0.03, 200, 'Занятия для молодёжи'); },
        ai: (g, ci) => (C(g, ci).personality === 'scientist' ? 1.8 : 0.9) },
      { label: 'Жёсткие законы', hint: (g, ci) => (C(g, ci).gov === 'dictatorship' ? 'стабильность +2' : 'стабильность −2, демократии осуждают'),
        apply: (g, ci) => {
          const dict = C(g, ci).gov === 'dictatorship';
          stab(g, ci, dict ? 2 : -2, 120, 'Жёсткие законы');
          if (!dict) relDemocracies(g, ci, -2);
        },
        ai: (g, ci) => (C(g, ci).gov === 'dictatorship' ? 1.6 : 0.3) },
    ],
  },
  {
    id: 'culture', icon: '🎭', title: 'Театрам нужна поддержка', slogan: 'Культура — душа страны!',
    text: (g, ci) => pick(g, [
      'Актёры, музыканты и художники просят помочь: в старом театре течёт крыша, а в музее нет денег на свет.',
      `Знаменитый оркестр из города ${city(g, ci)} играет в подземном переходе: зал закрыли на ремонт десять лет назад.`,
      'Писатели собирают подписи за новые библиотеки и книжные фестивали.',
    ]),
    pressure: (g, ci) => (C(g, ci).stability > 55 && !atWarNow(g, ci) && g.day > 120 ? 0.2 + (C(g, ci).budget.edu <= 1 ? 0.15 : 0) : 0),
    options: [
      { label: 'Грант театрам и музеям', hint: (g, ci) => `−${fmt(cost(g, ci, 12))} 💰, стабильность +3, отношения +1 со всеми`,
        apply: (g, ci) => {
          pay(g, ci, 12); stab(g, ci, 3, 150, 'Поддержка культуры');
          g.countries.forEach((o, j) => { if (o.alive && j !== ci) addRel(g, ci, j, 1); });
        },
        ai: (g, ci) => (rich(g, ci) ? 1.6 : 0.6) },
      { label: 'Бесплатный день в музеях', hint: (g, ci) => `−${fmt(cost(g, ci, 4))} 💰, стабильность +2, 🧠 +2% на 150 дн.`,
        apply: (g, ci) => { pay(g, ci, 4); stab(g, ci, 2, 100, 'Музеи для всех'); mod(g, ci, 'brains', 0.02, 150, 'Музеи для всех'); },
        ai: () => 1.2 },
      { label: 'Искусство подождёт', hint: () => 'стабильность −2',
        apply: (g, ci) => stab(g, ci, -2, 100, 'Культура без денег'),
        ai: (g, ci) => (broke(g, ci) ? 1.2 : 0.1) },
    ],
  },
  {
    id: 'press', icon: '📰', title: 'Свободу прессе!', slogan: 'Правду — в эфир!',
    text: (g, ci) => pick(g, [
      'Журналисты вышли с заклеенными ртами: закрыта ещё одна независимая газета.',
      `Студенты в городе ${city(g, ci)} печатают самиздат на старом принтере и раздают у метро.`,
    ]),
    pressure: (g, ci) => {
      const c = C(g, ci);
      if (c.gov === 'dictatorship') return 0.3 + (c.stability < 50 ? 0.2 : 0);
      return c.gov === 'monarchy' && c.stability < 55 ? 0.2 : 0;
    },
    options: [
      { label: 'Ослабить цензуру', hint: () => 'стабильность +4, демократии одобряют',
        apply: (g, ci) => { stab(g, ci, 4, 150, 'Свобода слова'); relDemocracies(g, ci, 3); },
        ai: (g, ci) => (C(g, ci).stability < 35 ? 1.8 : 0.7),
        news: ['📰 {c} ослабила цензуру', 'good'] },
      { label: 'Новый государственный телеканал', hint: (g, ci) => `−${fmt(cost(g, ci, 15))} 💰, стабильность +2`,
        apply: (g, ci) => { pay(g, ci, 15); stab(g, ci, 2, 120, 'Госпропаганда'); },
        ai: () => 1.3 },
      { label: 'Закрыть газеты', hint: (g, ci) => (C(g, ci).gov === 'dictatorship' ? 'стабильность −1, демократии осуждают' : 'стабильность −6, демократии осуждают'),
        apply: (g, ci) => { stab(g, ci, C(g, ci).gov === 'dictatorship' ? -1 : -6, 150, 'Закрытые газеты'); relDemocracies(g, ci, -3); C(g, ci).unrest += 0.5; },
        ai: (g, ci) => (C(g, ci).personality === 'aggressor' || C(g, ci).personality === 'fanatic' ? 1.5 : 0.2),
        news: ['📰 {c}: закрыты последние независимые газеты', 'bad'] },
    ],
  },
  {
    id: 'sport', icon: '⚽', title: 'Стадион для города', slogan: 'Спорт — это здоровье!',
    generic: true,
    text: (g, ci) => pick(g, [
      `Болельщики из города ${city(g, ci)} просят новый стадион: старый помнит ещё прадедов нынешних игроков.`,
      { title: 'Спортивные секции', icon: '🏊', text: 'Родители просят бесплатные секции: дети сидят в телефонах, а бассейн закрыт третий год.' },
      { title: 'Сборной нужна база', icon: '🏅', text: 'Олимпийская сборная тренируется во дворе школы. Спортсмены просят базу и тренеров.' },
    ]),
    pressure: (g, ci) => (C(g, ci).stability > 50 && !atWarNow(g, ci) && g.day > 180 ? 0.22 : 0),
    options: [
      { label: 'Построить стадион', hint: (g, ci) => `−${fmt(cost(g, ci, 30))} 💰, стабильность +5 на 250 дн.`,
        apply: (g, ci) => { pay(g, ci, 30); stab(g, ci, 5, 250, 'Новый стадион'); },
        ai: (g, ci) => (rich(g, ci) ? 1.7 : 0.4) },
      { label: 'Секции для детей', hint: (g, ci) => `−${fmt(cost(g, ci, 10))} 💰, рост 👥 +0.1%/год, стабильность +2`,
        apply: (g, ci) => { pay(g, ci, 10); mod(g, ci, 'growth', 0.1, 250, 'Детский спорт'); stab(g, ci, 2, 120, 'Детский спорт'); },
        ai: () => 1.3 },
      { label: 'Не до спорта', hint: () => 'стабильность −1',
        apply: (g, ci) => stab(g, ci, -1, 60, 'Спорт без денег'),
        ai: (g, ci) => (broke(g, ci) ? 1.2 : 0.1) },
    ],
  },
];
const DEMAND_BY_ID = Object.fromEntries(DEMANDS.map((d) => [d.id, d])) as Record<string, DemandDef>;

export interface Mood {
  id: string;
  icon: string;
  title: string;
  slogan: string;
  pressure: number;
}
/** О чём сейчас говорит народ (по убыванию громкости). */
export function moodOf(g: GameState, ci: number): Mood[] {
  const out: Mood[] = [];
  for (const d of DEMANDS) {
    if (d.id === 'rally') continue;
    const p = d.pressure(g, ci);
    if (p >= 0.1) out.push({ id: d.id, icon: d.icon, title: d.title, slogan: d.slogan, pressure: Math.min(1, p) });
  }
  return out.sort((a, b) => b.pressure - a.pressure);
}
const topSlogan = (g: GameState, ci: number) => moodOf(g, ci).find((m) => m.id !== 'festival')?.slogan ?? 'За светлое будущее!';

// ---------- игрок ----------
/** Народ выдвигает требование игроку: чем громче проблема, тем вероятнее именно она. */
/** Сколько последних требований помнить: недавние звучат реже, общие (митинг, праздник) — не повторяются вовсе. */
const RECENT = 6;
/** Вес требования по тому, как давно оно звучало (0 — только что). Острая проблема может вернуться, но не сразу. */
const RECENT_W = [0, 0, 0.15, 0.3, 0.5, 0.75];

export function triggerDemand(g: GameState) {
  const ci = g.player;
  g.nextDemandDay = g.day + 80 + Math.floor(rand(g) * 60);
  const recent = (g.recentDemands ??= []);
  // первое обращение народа — мирная акция
  const first = !(g.counters.demands ?? 0);
  const cands = DEMANDS.map((d, k) => {
    const ago = recent.length - 1 - recent.lastIndexOf(d.id);
    const p = first ? (d.id === 'rally' ? 1 : 0) : d.pressure(g, ci);
    const w = ago >= recent.length ? 1 : d.generic ? 0 : RECENT_W[ago] ?? 1;
    return { k, p, w: p * p * w };
  }).filter((x) => x.p >= 0.2 && x.w > 0);
  if (!cands.length) {
    g.nextDemandDay = g.day + 40;
    return;
  }
  let r = rand(g) * cands.reduce((a, x) => a + x.w, 0);
  let k = cands[0].k;
  for (const x of cands) {
    r -= x.w;
    if (r <= 0) { k = x.k; break; }
  }
  const d = DEMANDS[k];
  recent.push(d.id);
  if (recent.length > RECENT) recent.shift();
  const opts = d.options.map((o, idx) => ({ o, idx })).filter(({ o }) => !o.can || o.can(g, ci));
  const t = d.text(g, ci);
  const v: DemandText = typeof t === 'string' ? { text: t } : t;
  g.event = {
    id: d.id, kind: 'demand', title: v.title ?? d.title, icon: v.icon ?? d.icon, text: v.text,
    options: opts.map(({ o, idx }) => ({ label: o.label, hint: o.hint(g, ci), idx })),
  };
  sfx('event');
}

export function resolveDemand(g: GameState, option: number) {
  const ev = g.event;
  if (!ev) return;
  g.event = null;
  const d = DEMAND_BY_ID[ev.id];
  const opt = d?.options[ev.options[option]?.idx ?? -1];
  if (!d || !opt) return;
  opt.apply(g, g.player);
  g.counters.demands = (g.counters.demands ?? 0) + 1;
  log(g, `📢 ${ev.icon} ${ev.title}: «${opt.label}»`, 'info', false);
  computeAll(g);
}

// ---------- боты ----------
/** Бот раз в несколько месяцев отвечает своему народу: умный — взвешивает варианты, глупый — как получится. */
export function botPeople(g: GameState, i: number, careful: boolean) {
  const c = g.countries[i];
  if (g.day - (c.aiFlags.lastDemand ?? 0) < 100 + ((i * 37) % 60)) return;
  c.aiFlags.lastDemand = g.day;
  let best: DemandDef | null = null;
  let bp = 0.25;
  for (const d of DEMANDS) {
    const p = d.pressure(g, i) * (0.7 + 0.6 * rand(g));
    if (p > bp) { bp = p; best = d; }
  }
  if (!best) return;
  const opts = best.options.filter((o) => !o.can || o.can(g, i));
  let choice = opts[0];
  let sc = -Infinity;
  for (const o of opts) {
    const v = careful ? o.ai(g, i) + rand(g) * 0.3 : rand(g);
    if (v > sc) { sc = v; choice = o; }
  }
  choice.apply(g, i);
  if (choice.news && rand(g) < 0.6) news(g, choice.news[0].replace('{c}', cname(g, i)), choice.news[1]);
  computeAll(g);
}
