// Случайные события с выбором (только для игрока).
import { addRel, atWar, enemiesOf, neighborCountries } from './actions';
import { resolveSGEvent, SG_EVENT } from './assembly';
import { INVEST_PER } from './defs';
import { computeAll, STATS } from './economy';
import { resolveDebtEvent } from './debt';
import { resolveElectionEvent } from './elections';
import { resolveLodgeEvent } from './lodge';
import { resolveDemand } from './people';
import { adoptGenius, companiesOf, geniusText } from './society';
import { allBuildings, log, pick, rand, removeBuilding, sfx } from './state';
import type { Country, GameState, TempMod } from './types';
import { voteUN } from './un';
import { COUNTRY_DEFS, REGION_OF, REGIONS } from './world';

/** t — страна, о которой событие (-1, если событие не про другую страну). */
interface EventOption {
  label: string;
  hint: (g: GameState, t: number) => string;
  apply: (g: GameState, t: number) => void;
}
interface EventDef {
  id: string;
  title: string;
  icon: string;
  /** Несколько строк — каждый раз звучит одна из них. */
  text: string | string[] | ((g: GameState, t: number) => string);
  /** Выбор страны для события; -1 — подходящей нет, событие пропускается. */
  target?: (g: GameState) => number;
  can?: (g: GameState) => boolean;
  options: EventOption[];
}

const me = (g: GameState) => g.countries[g.player];
const income = (g: GameState) => Math.max(20, STATS[g.player].taxIncome);
const brainsRate = (g: GameState) => Math.max(5, STATS[g.player].brainsRate);
const fmt = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n).toString());
function mod(g: GameState, c: Country, kind: TempMod['kind'], value: number, days: number, label: string) {
  c.mods.push({ kind, value, until: g.day + days, label });
}
function popLoss(g: GameState, share: number) {
  for (const rid of STATS[g.player].regions) g.regions[rid].pop *= 1 - share;
}
const pay = (g: GameState, secs: number) => { me(g).money -= income(g) * secs; };
const relAll = (g: GameState, v: number) => g.countries.forEach((c, i) => { if (c.alive && i !== g.player) addRel(g, g.player, i, v); });
const bots = (g: GameState) => g.countries.filter((c) => c.alive && c.idx !== g.player && !atWar(g, g.player, c.idx)).map((c) => c.idx);
const anyBot = (g: GameState) => { const b = bots(g); return b.length ? pick(g, b) : -1; };
const friendlyBot = (g: GameState) => { const b = bots(g).filter((i) => g.rel[g.player][i] > -10); return b.length ? pick(g, b) : -1; };
const neighborBot = (g: GameState) => { const b = [...neighborCountries(g, g.player)].filter((i) => !atWar(g, g.player, i)); return b.length ? pick(g, b) : anyBot(g); };
const name = (t: number) => COUNTRY_DEFS[t]?.name ?? '?';

// оружейная сделка: воюющая страна просит продать излишки
const spareArms = (g: GameState) => Math.max(0, Math.floor((me(g).arms - (me(g).soldiers + STATS[g.player].deployed) * 1.05) * 0.5));
const armsDealMoney = (g: GameState) => spareArms(g) * g.market.arms.price * 1.5;
const warBuyer = (g: GameState) => {
  const b = bots(g).filter((i) => enemiesOf(g, i).length > 0 && !enemiesOf(g, i).some((e) => g.rel[g.player][e] > 40) && g.countries[i].money > armsDealMoney(g));
  return b.length ? pick(g, b) : -1;
};
// иностранцы хотят купить нашу крупнейшую частную компанию
const topCompany = (g: GameState) => companiesOf(g, g.player).find((co) => !co.state);
const takeoverPrice = (g: GameState) => (topCompany(g)?.value ?? 0) * 1.6;
const richBuyer = (g: GameState) => {
  const b = bots(g).filter((i) => g.rel[g.player][i] > -10 && g.countries[i].money > takeoverPrice(g) * 3);
  return b.length ? b.reduce((a, x) => (g.countries[x].money > g.countries[a].money ? x : a)) : -1;
};
// миллиардер бежит от налогов и беспорядков
const tycoonHome = (g: GameState) => {
  const b = bots(g).filter((i) => g.countries[i].billionaires >= 5 && (g.countries[i].tax > me(g).tax + 0.05 || g.countries[i].stability < 45));
  return b.length ? pick(g, b) : -1;
};

const EVENTS: EventDef[] = [
  { id: 'drought', title: 'Засуха', icon: '☀️', text: ['Реки мелеют, поля выгорают. Урожай в этом году будет меньше.', 'Третий месяц ни капли дождя: земля трескается, коровы прячутся в тень.'], options: [
    { label: 'Спасти урожай: полив и техника', hint: (g) => `−${fmt(income(g) * 50)} 💰, урожай −10% на 120 дн.`, apply: (g) => { pay(g, 50); mod(g, me(g), 'food', -0.1, 120, 'Засуха'); } },
    { label: 'Справятся сами', hint: () => 'урожай −35% на 120 дн., стабильность −6', apply: (g) => { mod(g, me(g), 'food', -0.35, 120, 'Засуха'); mod(g, me(g), 'stab', -6, 120, 'Засуха'); } },
  ] },
  { id: 'epidemic', title: 'Эпидемия', icon: '🦠', text: ['В крупных городах вспышка опасной инфекции.', 'Больницы заполняются: врачи бьют тревогу — новая инфекция передаётся очень быстро.'], options: [
    { label: 'Карантин и вакцины', hint: (g) => `−${fmt(income(g) * 45)} 💰, производство −10% на 90 дн.`, apply: (g) => { pay(g, 45); mod(g, me(g), 'prod', -0.1, 90, 'Карантин'); } },
    { label: 'Не вмешиваться', hint: () => '−3% 👥, стабильность −8', apply: (g) => { popLoss(g, 0.03); mod(g, me(g), 'stab', -8, 150, 'Эпидемия'); } },
  ] },
  { id: 'breakthrough', title: 'Научный прорыв', icon: '💡', text: ['Учёные на пороге важного открытия.', 'В лаборатории ночью погас свет — а прибор продолжал светиться. Учёные уверены: это прорыв.'], options: [
    { label: 'Профинансировать', hint: (g) => `−${fmt(income(g) * 50)} 💰, +${fmt(brainsRate(g) * 250)} 🧠`, apply: (g) => { pay(g, 50); me(g).brains += brainsRate(g) * 250; } },
    { label: 'Продать патент', hint: (g) => `+${fmt(income(g) * 90)} 💰`, apply: (g) => { me(g).money += income(g) * 90; } },
  ] },
  { id: 'protests', title: 'Массовые протесты', icon: '📢', text: ['Люди вышли на улицы и требуют перемен.', 'Центральные площади заполнены людьми: протест охватил сразу несколько городов.'], options: [
    { label: 'Снизить налоги на 5%', hint: () => 'стабильность +10 на 200 дн.', apply: (g) => { me(g).tax = Math.max(0, me(g).tax - 0.05); mod(g, me(g), 'stab', 10, 200, 'Уступки'); } },
    { label: 'Диалог с лидерами', hint: (g) => `−${fmt(income(g) * 30)} 💰, стабильность +5`, apply: (g) => { pay(g, 30); mod(g, me(g), 'stab', 5, 150, 'Диалог'); } },
    { label: 'Разогнать', hint: (g) => (me(g).gov === 'dictatorship' ? 'стабильность −3' : 'стабильность −12, отношения −5 со всеми'), apply: (g) => {
      if (me(g).gov === 'dictatorship') mod(g, me(g), 'stab', -3, 100, 'Разгон');
      else { mod(g, me(g), 'stab', -12, 200, 'Разгон'); relAll(g, -5); }
    } },
  ] },
  { id: 'schism', title: 'Религиозный раскол', icon: '⛪', text: 'Духовенство спорит о реформах. Общество разделилось.', options: [
    { label: 'Поддержать традиции', hint: () => 'стабильность +8, 🧠 −10% на 150 дн.', apply: (g) => { mod(g, me(g), 'stab', 8, 150, 'Традиции'); mod(g, me(g), 'brains', -0.1, 150, 'Традиции'); } },
    { label: 'Поддержать реформаторов', hint: () => '🧠 +10%, стабильность −8 на 150 дн.', apply: (g) => { mod(g, me(g), 'brains', 0.1, 150, 'Реформы'); mod(g, me(g), 'stab', -8, 150, 'Реформы'); } },
  ] },
  { id: 'deposit', title: 'Найдено месторождение', icon: '⛏️', text: ['Геологи нашли крупные запасы нефти и редких металлов.', 'Буровая вышка ударила фонтаном нефти, а рядом нашли жилу лития.'], options: [
    { label: 'Государственная компания', hint: (g) => `+${fmt(income(g) * 150)} 💰`, apply: (g) => { me(g).money += income(g) * 150; } },
    { label: 'Пустить иностранцев', hint: (g) => `+${fmt(income(g) * 80)} 💰, +15 к отношениям с тремя странами`, apply: (g) => {
      me(g).money += income(g) * 80;
      const others = g.countries.filter((c) => c.alive && c.idx !== g.player);
      for (let k = 0; k < 3 && others.length; k++) addRel(g, g.player, pick(g, others).idx, 15);
    } },
  ] },
  { id: 'flood', title: 'Наводнение', icon: '🌊', text: ['Реки вышли из берегов, затоплены города.', 'После недели ливней по улицам плывут лодки, а не машины.'], options: [
    { label: 'Построить дамбы', hint: (g) => `−${fmt(income(g) * 50)} 💰, стабильность +3`, apply: (g) => { pay(g, 50); mod(g, me(g), 'stab', 3, 200, 'Дамбы'); } },
    { label: 'Минимальная помощь', hint: () => '−1.5% 👥, стабильность −5', apply: (g) => { popLoss(g, 0.015); mod(g, me(g), 'stab', -5, 120, 'Наводнение'); } },
  ] },
  { id: 'braindrain', title: 'Утечка мозгов', icon: '✈️', text: 'Лучшие специалисты уезжают за границу.', options: [
    { label: 'Гранты учёным', hint: (g) => `−${fmt(income(g) * 70)} 💰`, apply: (g) => pay(g, 70) },
    { label: 'Пусть едут', hint: () => '🧠 −20% на 150 дн.', apply: (g) => mod(g, me(g), 'brains', -0.2, 150, 'Утечка мозгов') },
  ] },
  { id: 'startups', title: 'Бум стартапов', icon: '📈', text: ['Молодые компании растут как на дрожжах.', 'Гаражный стартап за год стал стоить больше старого завода. Инвесторы ищут следующий.'], options: [
    { label: 'Венчурный фонд', hint: (g) => `−${fmt(income(g) * 40)} 💰, производство +18% на 200 дн.`, apply: (g) => { pay(g, 40); mod(g, me(g), 'prod', 0.18, 200, 'Венчурный фонд'); } },
    { label: 'Не мешать', hint: () => 'производство +8% на 200 дн.', apply: (g) => mod(g, me(g), 'prod', 0.08, 200, 'Стартапы') },
  ] },
  { id: 'babyboom', title: 'Демографический бум', icon: '👶', text: 'Рождаемость неожиданно выросла.', options: [
    { label: 'Поддержать семьи', hint: (g) => `−${fmt(income(g) * 30)} 💰, рост +0.8%/год на 300 дн.`, apply: (g) => { pay(g, 30); mod(g, me(g), 'growth', 0.8, 300, 'Бэби-бум'); } },
    { label: 'Принять к сведению', hint: () => 'рост +0.4%/год на 300 дн.', apply: (g) => mod(g, me(g), 'growth', 0.4, 300, 'Бэби-бум') },
  ] },
  { id: 'scandal', title: 'Коррупционный скандал', icon: '🕵️', text: 'Журналисты раскрыли схему хищений в министерстве.', options: [
    { label: 'Громкое расследование', hint: () => 'стабильность −5 сейчас, производство +6% на 300 дн.', apply: (g) => { mod(g, me(g), 'stab', -5, 60, 'Расследование'); mod(g, me(g), 'prod', 0.06, 300, 'Борьба с коррупцией'); } },
    { label: 'Замять', hint: (g) => `+${fmt(income(g) * 40)} 💰, стабильность −10`, apply: (g) => { me(g).money += income(g) * 40; mod(g, me(g), 'stab', -10, 200, 'Скандал'); } },
  ] },
  { id: 'refugees', title: 'Беженцы', icon: '🧳', text: 'На границе тысячи людей просят убежища.', options: [
    { label: 'Принять', hint: () => '+0.5% 👥, стабильность −4, отношения +5 со всеми', apply: (g) => {
      popLoss(g, -0.005); mod(g, me(g), 'stab', -4, 150, 'Беженцы');
      relAll(g, 5);
    } },
    { label: 'Закрыть границу', hint: () => 'стабильность +2', apply: (g) => mod(g, me(g), 'stab', 2, 100, 'Закрытая граница') },
  ] },
  { id: 'olympics', title: 'Олимпийские игры', icon: '🏅', text: ['Нам предлагают провести Олимпиаду.', 'Олимпийский комитет приехал с проверкой: наши стадионы им понравились.'], options: [
    { label: 'Провести', hint: (g) => `−${fmt(income(g) * 90)} 💰, стабильность +10, отношения +5 со всеми`, apply: (g) => {
      pay(g, 90); mod(g, me(g), 'stab', 10, 250, 'Олимпиада');
      relAll(g, 5);
    } },
    { label: 'Отказаться', hint: () => 'ничего не меняется', apply: () => {} },
  ] },
  { id: 'quake', title: 'Землетрясение', icon: '🌋', text: 'Сильное землетрясение разрушило часть инфраструктуры.', options: [
    { label: 'Восстановить всё', hint: (g) => `−${fmt(income(g) * 70)} 💰`, apply: (g) => pay(g, 70) },
    { label: 'Только самое важное', hint: () => 'одно здание теряет уровень, стабильность −6', apply: (g) => {
      const mine = allBuildings(g).tiles.filter((t) => g.regions[REGION_OF[t]].owner === g.player);
      if (mine.length) {
        const t = pick(g, mine);
        const b = g.buildings[t];
        if (b.level > 1 && b.progress === 0) b.level--;
        else removeBuilding(g, t);
      }
      mod(g, me(g), 'stab', -6, 120, 'Землетрясение');
    } },
  ] },
  { id: 'invention', title: 'Гениальный изобретатель', icon: '🧑‍🔬', text: 'Молодой инженер создал революционный прибор.', options: [
    { label: 'Взять в госпроект', hint: (g) => `+${fmt(brainsRate(g) * 200)} 🧠`, apply: (g) => { me(g).brains += brainsRate(g) * 200; } },
    { label: 'Помочь открыть бизнес', hint: (g) => `+${fmt(income(g) * 60)} 💰`, apply: (g) => { me(g).money += income(g) * 60; } },
  ] },

  { id: 'meteor', title: 'Упал метеорит', icon: '☄️', text: ['Ночью небо вспыхнуло, и в поле упал метеорит размером с автобус.', 'Над страной пролетел огненный шар и рухнул в тайгу. Окна дрожали за сотню километров.'], options: [
    { label: 'Отдать учёным', hint: (g) => `+${fmt(brainsRate(g) * 160)} 🧠`, apply: (g) => { me(g).brains += brainsRate(g) * 160; } },
    { label: 'Продать коллекционерам', hint: (g) => `+${fmt(income(g) * 70)} 💰`, apply: (g) => { me(g).money += income(g) * 70; } },
    { label: 'Открыть музей у кратера', hint: (g) => `−${fmt(income(g) * 15)} 💰, стабильность +4, туристы`, apply: (g) => { pay(g, 15); mod(g, me(g), 'stab', 4, 200, 'Музей метеорита'); mod(g, me(g), 'prod', 0.03, 200, 'Туристы у кратера'); } },
  ] },
  { id: 'blackout', title: 'Блэкаут', icon: '🔌', text: ['Авария на подстанции: полстраны осталось без света.', 'Ураган оборвал провода — города погрузились в темноту, лифты встали.'], options: [
    { label: 'Срочный ремонт сетей', hint: (g) => `−${fmt(income(g) * 40)} 💰, производство −5% на 30 дн.`, apply: (g) => { pay(g, 40); mod(g, me(g), 'prod', -0.05, 30, 'Блэкаут'); } },
    { label: 'Новая энергосистема', hint: (g) => `−${fmt(income(g) * 90)} 💰, производство +8% на 400 дн.`, apply: (g) => { pay(g, 90); mod(g, me(g), 'prod', 0.08, 400, 'Новая энергосистема'); } },
    { label: 'Чинить по очереди', hint: () => 'производство −15% на 60 дн., стабильность −5', apply: (g) => { mod(g, me(g), 'prod', -0.15, 60, 'Блэкаут'); mod(g, me(g), 'stab', -5, 90, 'Блэкаут'); } },
  ] },
  { id: 'tourism', title: 'Туристический бум', icon: '🧳', can: (g) => me(g).stability >= 45 && enemiesOf(g, g.player).length === 0,
    text: ['Блогеры назвали нашу страну лучшим местом для отпуска. Туристы едут толпами.', 'Фильм, снятый в наших горах, собрал миллиард. Теперь все хотят сюда.'], options: [
    { label: 'Строить отели и аэропорты', hint: (g) => `−${fmt(income(g) * 45)} 💰, производство +12% на 300 дн.`, apply: (g) => { pay(g, 45); mod(g, me(g), 'prod', 0.12, 300, 'Туризм'); } },
    { label: 'Ввести туристический сбор', hint: (g) => `+${fmt(income(g) * 40)} 💰`, apply: (g) => { me(g).money += income(g) * 40; } },
    { label: 'Беречь природу от толп', hint: () => 'стабильность +3', apply: (g) => mod(g, me(g), 'stab', 3, 150, 'Тихий отдых') },
  ] },
  { id: 'strike', title: 'Забастовка шахтёров', icon: '⛏️', text: ['Шахтёры спустились под землю и отказываются подниматься, пока не поднимут зарплаты.', 'Портовые грузчики бросили работу: в гавани стоят сотни кораблей.'], options: [
    { label: 'Поднять зарплаты', hint: (g) => `−${fmt(income(g) * 35)} 💰, стабильность +4`, apply: (g) => { pay(g, 35); mod(g, me(g), 'stab', 4, 150, 'Уступки бастующим'); } },
    { label: 'Переговоры', hint: (g) => `−${fmt(income(g) * 12)} 💰, производство −5% на 40 дн.`, apply: (g) => { pay(g, 12); mod(g, me(g), 'prod', -0.05, 40, 'Забастовка'); } },
    { label: 'Ждать, пока сдадутся', hint: () => 'производство −15% на 60 дн., стабильность −4', apply: (g) => { mod(g, me(g), 'prod', -0.15, 60, 'Забастовка'); mod(g, me(g), 'stab', -4, 120, 'Забастовка'); } },
  ] },
  { id: 'locusts', title: 'Нашествие саранчи', icon: '🦗', text: ['Туча саранчи закрыла солнце над южными полями.', 'Фермеры в панике: саранча съедает поле пшеницы за час.'], options: [
    { label: 'Авиация и химия', hint: (g) => `−${fmt(income(g) * 30)} 💰, урожай −5% на 90 дн.`, apply: (g) => { pay(g, 30); mod(g, me(g), 'food', -0.05, 90, 'Саранча'); } },
    { label: 'Позвать птиц и учёных', hint: (g) => `−${fmt(income(g) * 10)} 💰, урожай −12% на 90 дн., 🧠 +${fmt(brainsRate(g) * 30)}`, apply: (g) => { pay(g, 10); mod(g, me(g), 'food', -0.12, 90, 'Саранча'); me(g).brains += brainsRate(g) * 30; } },
    { label: 'Переждать', hint: () => 'урожай −30% на 90 дн.', apply: (g) => mod(g, me(g), 'food', -0.3, 90, 'Саранча') },
  ] },
  { id: 'expo', title: 'Всемирная выставка', icon: '🎡', text: ['Нам предлагают принять Всемирную выставку: павильоны всех стран, роботы и летающие такси.', 'Изобретатели всего мира хотят показать свои чудеса у нас на Всемирной выставке.'], options: [
    { label: 'Принять с размахом', hint: (g) => `−${fmt(income(g) * 70)} 💰, 🧠 +${fmt(brainsRate(g) * 120)}, отношения +5 со всеми`, apply: (g) => { pay(g, 70); me(g).brains += brainsRate(g) * 120; relAll(g, 5); } },
    { label: 'Скромный павильон', hint: (g) => `−${fmt(income(g) * 20)} 💰, 🧠 +${fmt(brainsRate(g) * 40)}`, apply: (g) => { pay(g, 20); me(g).brains += brainsRate(g) * 40; } },
    { label: 'Отказаться', hint: () => 'ничего не меняется', apply: () => {} },
  ] },
  { id: 'film', title: 'Наш фильм покорил мир', icon: '🎬', text: ['Фильм нашего режиссёра получил главный приз мирового кинофестиваля.', 'Мультфильм про нашу страну стал самым кассовым в мире.'], options: [
    { label: 'Наградить и снимать ещё', hint: (g) => `−${fmt(income(g) * 15)} 💰, стабильность +5, отношения +3 со всеми`, apply: (g) => { pay(g, 15); mod(g, me(g), 'stab', 5, 200, 'Мировой кинохит'); relAll(g, 3); } },
    { label: 'Продать права на продолжение', hint: (g) => `+${fmt(income(g) * 45)} 💰`, apply: (g) => { me(g).money += income(g) * 45; } },
  ] },

  // ---------- события с другими странами ----------
  { id: 'spy', title: 'Пойман шпион', icon: '🕶️', target: anyBot,
    text: (_g, t) => `Контрразведка задержала агента страны «${name(t)}» в секретной лаборатории.`, options: [
      { label: 'Публичный скандал', hint: (_g, t) => `стабильность +5, отношения с «${name(t)}» −20`, apply: (g, t) => { mod(g, me(g), 'stab', 5, 150, 'Разоблачение шпиона'); addRel(g, g.player, t, -20); } },
      { label: 'Перевербовать', hint: (g) => `+${fmt(brainsRate(g) * 120)} 🧠 (их секреты)`, apply: (g) => { me(g).brains += brainsRate(g) * 120; } },
      { label: 'Тихо обменять', hint: (_g, t) => `отношения с «${name(t)}» +10`, apply: (g, t) => addRel(g, g.player, t, 10) },
    ] },
  { id: 'aid', title: 'Просьба о помощи', icon: '🙏', target: friendlyBot,
    text: (_g, t) => `«${name(t)}» пострадала от стихийного бедствия и просит о помощи.`, options: [
      { label: 'Отправить помощь', hint: (g, t) => `−${fmt(income(g) * 40)} 💰, отношения с «${name(t)}» +25, с остальными +3`, apply: (g, t) => { pay(g, 40); addRel(g, g.player, t, 25); relAll(g, 3); } },
      { label: 'Отказать', hint: (_g, t) => `отношения с «${name(t)}» −8`, apply: (g, t) => addRel(g, g.player, t, -8) },
    ] },
  { id: 'border', title: 'Пограничный инцидент', icon: '🚧', target: neighborBot,
    text: (_g, t) => `Патрули «${name(t)}» и наши пограничники обменялись выстрелами.`, options: [
      { label: 'Потребовать извинений', hint: (_g, t) => `стабильность +5 (патриотизм), отношения с «${name(t)}» −20`, apply: (g, t) => { mod(g, me(g), 'stab', 5, 120, 'Патриотический подъём'); addRel(g, g.player, t, -20); } },
      { label: 'Замять', hint: (_g, t) => `стабильность −3, отношения с «${name(t)}» +8`, apply: (g, t) => { mod(g, me(g), 'stab', -3, 90, 'Уступка соседу'); addRel(g, g.player, t, 8); } },
    ] },
  { id: 'defector', title: 'Перебежчик', icon: '🏃', target: anyBot,
    text: (_g, t) => `Ведущий учёный из страны «${name(t)}» просит политического убежища.`, options: [
      { label: 'Дать убежище', hint: (_g, t) => `🌟 звезда науки будет работать у нас, отношения с «${name(t)}» −15`, apply: (g, t) => {
        const gen = adoptGenius(g, g.player, t);
        if (gen) log(g, `🌟 ${gen.name} теперь работает у нас: ${geniusText(gen)}`, 'good');
        addRel(g, g.player, t, -15);
      } },
      { label: 'Выдать', hint: (_g, t) => `отношения с «${name(t)}» +15`, apply: (g, t) => addRel(g, g.player, t, 15) },
    ] },
  { id: 'summit', title: 'Международный саммит', icon: '🌐', text: 'Нам предлагают провести саммит мировых лидеров.', options: [
    { label: 'Провести с размахом', hint: (g) => `−${fmt(income(g) * 50)} 💰, отношения +8 со всеми`, apply: (g) => { pay(g, 50); relAll(g, 8); } },
    { label: 'Скромно', hint: (g) => `−${fmt(income(g) * 15)} 💰, отношения +3 со всеми`, apply: (g) => { pay(g, 15); relAll(g, 3); } },
    { label: 'Отказаться', hint: () => 'ничего не меняется', apply: () => {} },
  ] },
  { id: 'hackers', title: 'Хакерская атака', icon: '💻', target: anyBot,
    text: (_g, t) => `Хакеры взломали государственные системы. Следы ведут в «${name(t)}».`, options: [
      { label: 'Усилить киберзащиту', hint: (g) => `−${fmt(income(g) * 35)} 💰`, apply: (g) => pay(g, 35) },
      { label: 'Ответный удар', hint: (g, t) => `+${fmt(brainsRate(g) * 80)} 🧠, отношения с «${name(t)}» −25`, apply: (g, t) => { me(g).brains += brainsRate(g) * 80; addRel(g, g.player, t, -25); } },
      { label: 'Ничего не делать', hint: () => '🧠 −15% на 120 дн.', apply: (g) => mod(g, me(g), 'brains', -0.15, 120, 'Взлом') },
    ] },
  { id: 'oil', title: 'Нефтяной бум', icon: '🛢️', text: ['Мировые цены на сырьё взлетели.', 'Биржи лихорадит: баррель нефти подорожал за неделю на треть.'], options: [
    { label: 'Продать сейчас', hint: (g) => `+${fmt(income(g) * 100)} 💰`, apply: (g) => { me(g).money += income(g) * 100; } },
    { label: 'Фонд будущего', hint: () => 'производство +10% на 300 дн.', apply: (g) => mod(g, me(g), 'prod', 0.1, 300, 'Фонд будущего') },
  ] },
  { id: 'harvest', title: 'Рекордный урожай', icon: '🌾', text: ['Фермеры собрали небывалый урожай.', 'Элеваторы переполнены: зерно ссыпают прямо на площадях под брезент.'], options: [
    { label: 'Продать соседям', hint: (g) => `+${fmt(income(g) * 50)} 💰, отношения с соседями +6`, apply: (g) => {
      me(g).money += income(g) * 50;
      for (const n of neighborCountries(g, g.player)) addRel(g, g.player, n, 6);
    } },
    { label: 'Засыпать в закрома', hint: () => '+60 дней запаса еды, рост населения +0.3%/год на 250 дн.', apply: (g) => {
      me(g).food += STATS[g.player].foodCons * 60;
      mod(g, me(g), 'growth', 0.3, 250, 'Запасы зерна');
    } },
  ] },
  { id: 'armsdeal', title: 'Оружейная сделка', icon: '🔫', target: warBuyer, can: (g) => spareArms(g) > 1000,
    text: (_g, t) => `«${name(t)}» воюет и просит продать ей оружие с наших складов — платит в полтора раза дороже рынка.`, options: [
      { label: 'Продать', hint: (g, t) => `+${fmt(armsDealMoney(g))} 💰 за ${fmt(spareArms(g))} комплектов, отношения с «${name(t)}» +15, с её врагами −10`, apply: (g, t) => {
        const q = spareArms(g);
        const money = armsDealMoney(g);
        me(g).arms -= q;
        me(g).money += money;
        g.countries[t].arms += q;
        g.countries[t].money -= money;
        g.counters.armsSold = (g.counters.armsSold ?? 0) + q;
        addRel(g, g.player, t, 15);
        for (const e of enemiesOf(g, t)) if (e !== g.player) addRel(g, g.player, e, -10);
        sfx('coins');
      } },
      { label: 'Отказать', hint: (_g, t) => `отношения с «${name(t)}» −3`, apply: (g, t) => addRel(g, g.player, t, -3) },
    ] },
  { id: 'takeover', title: 'Предложение о покупке', icon: '🏢', target: richBuyer, can: (g) => !!topCompany(g),
    text: (g, t) => `Инвесторы из страны «${name(t)}» хотят купить нашу компанию «${topCompany(g)?.name}» — и перевезти её штаб-квартиру к себе.`, options: [
      { label: 'Продать', hint: (g, t) => `+${fmt(takeoverPrice(g))} 💰, компания уйдёт в «${name(t)}», отношения +10`, apply: (g, t) => {
        const co = topCompany(g);
        if (!co) return;
        const price = takeoverPrice(g);
        me(g).money += price;
        g.countries[t].money -= price;
        co.hq = g.countries[t].capital;
        addRel(g, g.player, t, 10);
        sfx('coins');
      } },
      { label: 'Не продавать', hint: (_g, t) => `отношения с «${name(t)}» −3`, apply: (g, t) => addRel(g, g.player, t, -3) },
    ] },
  { id: 'tycoon', title: 'Миллиардер просится к нам', icon: '💎', target: tycoonHome, can: (g) => me(g).stability >= 50,
    text: (g, t) => `Известный миллиардер из страны «${name(t)}» устал от тамошних налогов и хочет переехать в ${REGIONS[me(g).capital].name} со всем капиталом.`, options: [
      { label: 'Принять', hint: (_g, t) => `+3 миллиардера (+${fmt(3 * INVEST_PER)} 💰/сек инвестиций), отношения с «${name(t)}» −5`, apply: (g, t) => {
        me(g).billionaires += 3;
        g.countries[t].billionaires = Math.max(0, g.countries[t].billionaires - 3);
        mod(g, me(g), 'rich', 0.05, 300, 'Переезд миллиардера');
        addRel(g, g.player, t, -5);
      } },
      { label: 'Отказать', hint: () => 'ничего не меняется', apply: () => {} },
    ] },
  { id: 'military', title: 'Военная реформа', icon: '🎖️', text: 'Генералы предлагают модернизировать вооружение армии.', options: [
    { label: 'Модернизировать', hint: (g) => `−${fmt(income(g) * 80)} 💰, вооружение +8% навсегда`, apply: (g) => { pay(g, 80); me(g).weaponsBase *= 1.08; } },
    { label: 'Отложить', hint: () => 'ничего не меняется', apply: () => {} },
  ] },
  { id: 'warloan', title: 'Военный заём', icon: '🏦', can: (g) => enemiesOf(g, g.player).length > 0,
    text: 'Банки предлагают крупный заём на нужды войны.', options: [
      { label: 'Взять заём', hint: (g) => `+${fmt(income(g) * 150)} 💰 сейчас, производство −8% на 300 дн.`, apply: (g) => { me(g).money += income(g) * 150; mod(g, me(g), 'prod', -0.08, 300, 'Выплаты по займу'); } },
      { label: 'Военные облигации', hint: (g) => `+${fmt(income(g) * 60)} 💰, стабильность +4`, apply: (g) => { me(g).money += income(g) * 60; mod(g, me(g), 'stab', 4, 150, 'Патриотические облигации'); } },
      { label: 'Отказаться', hint: () => 'ничего не меняется', apply: () => {} },
    ] },
  { id: 'festival', title: 'Национальный праздник', icon: '🎉', text: ['Приближается юбилей государства.', 'Скоро круглая дата основания страны — люди ждут праздника.'], options: [
    { label: 'Пышное торжество', hint: (g) => `−${fmt(income(g) * 30)} 💰, стабильность +8 на 120 дн.`, apply: (g) => { pay(g, 30); mod(g, me(g), 'stab', 8, 120, 'Праздник'); } },
    { label: 'Скромно', hint: () => 'стабильность +2', apply: (g) => mod(g, me(g), 'stab', 2, 90, 'Праздник') },
  ] },
  { id: 'pandemic', title: 'Мировая пандемия', icon: '😷', can: (g) => g.day > 700, text: 'Новый вирус распространяется по всему миру.', options: [
    { label: 'Жёсткий локдаун', hint: () => 'производство −15% на 90 дн., население почти не страдает', apply: (g) => mod(g, me(g), 'prod', -0.15, 90, 'Локдаун') },
    { label: 'Вакцины для всех', hint: (g) => `−${fmt(income(g) * 80)} 💰, отношения +10 со всеми`, apply: (g) => { pay(g, 80); relAll(g, 10); } },
    { label: 'Коллективный иммунитет', hint: () => '−4% 👥, стабильность −10', apply: (g) => { popLoss(g, 0.04); mod(g, me(g), 'stab', -10, 150, 'Пандемия'); } },
  ] },
];

/** Сколько последних событий не повторять. */
const RECENT_EVENTS = 12;

export function triggerEvent(g: GameState) {
  const recent = (g.recentEvents ??= []);
  const ok = EVENTS.map((_, k) => k).filter((k) => !recent.includes(EVENTS[k].id) && (!EVENTS[k].can || EVENTS[k].can!(g)));
  const idx = ok.length ? ok[Math.floor(rand(g) * ok.length)] : Math.floor(rand(g) * EVENTS.length);
  const ev = EVENTS[idx];
  const t = ev.target ? ev.target(g) : -1;
  g.nextEventDay = g.day + 150 + Math.floor(rand(g) * 150);
  if (ev.target && t < 0) return; // некому — в другой раз
  recent.push(ev.id);
  if (recent.length > RECENT_EVENTS) recent.shift();
  const text = typeof ev.text === 'function' ? ev.text(g, t) : Array.isArray(ev.text) ? pick(g, ev.text) : ev.text;
  g.event = { id: ev.id, title: ev.title, text, icon: ev.icon, target: t >= 0 ? t : undefined, options: ev.options.map((o) => ({ label: o.label, hint: o.hint(g, t) })) };
  sfx('event');
}

export function resolveEvent(g: GameState, option: number) {
  if (!g.event) return;
  if (g.event.kind === 'demand') return resolveDemand(g, option);
  if (g.event.kind === 'un') return g.event.id === SG_EVENT ? resolveSGEvent(g, option) : voteUN(g, option);
  if (g.event.kind === 'lodge') return resolveLodgeEvent(g, option);
  if (g.event.kind === 'election') return resolveElectionEvent(g, option);
  if (g.event.kind === 'debt') return resolveDebtEvent(g, option);
  const ev = EVENTS.find((e) => e.id === g.event!.id);
  const opt = ev?.options[option];
  const t = g.event.target ?? -1;
  g.event = null;
  if (!opt) return;
  if (ev!.target && (t < 0 || !g.countries[t]?.alive)) return;
  opt.apply(g, t);
  g.counters.events = (g.counters.events ?? 0) + 1;
  log(g, `${ev!.icon} ${ev!.title}: «${opt.label}»`, 'info', false);
  computeAll(g);
}
