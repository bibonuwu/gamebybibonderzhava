// Справочники: здания, технологии, формы правления, религия, характеры ботов, компании, рынок.
import type { BuildingType, GeniusField, GovType, Personality, ReligionPolicy, Sector, Terrain } from './types';

export interface BuildingDef {
  name: string;
  icon: string;
  desc: string;
  where: string;
  cost: number; // базовая цена (× вес региона × производительность)
  upkeep: number;
  time: number; // сек на уровень 1
  techFor: [null, null, string, string]; // технология для уровня (индекс = уровень)
  terrains?: Terrain[];
  nearCity?: number; // макс. расстояние до центра региона
  coastal?: boolean;
  fortress?: boolean;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  factory: { name: 'Завод', icon: '🏭', desc: '+💰 в секунду', where: 'Равнины, луга, пустыня — не дальше 2 клеток от города', cost: 600, upkeep: 0.35, time: 20, techFor: [null, null, 'smart_factories', 'nanotech'], terrains: ['p', 'g', 'd'], nearCity: 2 },
  university: { name: 'Университет', icon: '🎓', desc: '+🧠 в секунду', where: 'В городе (рядом с центром)', cost: 700, upkeep: 0.5, time: 25, techFor: [null, null, 'digital_edu', 'ai'], nearCity: 1 },
  temple: { name: 'Храм', icon: '⛪', desc: '+⚖️ стабильность (зависит от религии)', where: 'Любая суша', cost: 400, upkeep: 0.25, time: 15, techFor: [null, null, 'dialogue', 'revival'], terrains: ['p', 'g', 'f', 'd', 't', 'm'] },
  hospital: { name: 'Больница', icon: '🏥', desc: '+рост 👥', where: 'В городе (рядом с центром)', cost: 500, upkeep: 0.45, time: 20, techFor: [null, null, 'telemed', 'gene_therapy'], nearCity: 1 },
  farm: { name: 'Ферма', icon: '🌾', desc: '+лимит населения и урожай 🌾 региона', where: 'Равнины и луга', cost: 350, upkeep: 0.15, time: 12, techFor: [null, null, 'vertical_farms', 'gmo'], terrains: ['p', 'g'] },
  barracks: { name: 'Казарма', icon: '🏰', desc: 'Дешевле набор и содержание армии', where: 'Любая суша, кроме гор', cost: 450, upkeep: 0.35, time: 18, techFor: [null, null, 'drones', 'combat_robots'], terrains: ['p', 'g', 'f', 'd', 't'] },
  port: { name: 'Порт', icon: '⚓', desc: '+💰 от торговли, морские атаки', where: 'Побережье', cost: 600, upkeep: 0.2, time: 22, techFor: [null, null, 'auto_ports', 'global_logistics'], coastal: true },
  fortress: { name: 'Крепость', icon: '🛡️', desc: '+оборона региона', where: 'Горы или граница с другой страной', cost: 500, upkeep: 0.35, time: 20, techFor: [null, null, 'hypersonic', 'missile_defense'], fortress: true },
};
export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];

/** Множители уровня: цена / эффект. */
export const LEVEL_COST = [0, 1, 2.6, 6];
export const LEVEL_EFFECT = [0, 1, 2.5, 5];
export const COST_GROWTH = 1.06;

export interface TechMods {
  prod: number;
  factory: number;
  brains: number;
  growth: number;
  cap: number;
  weapons: number;
  stab: number;
  trade: number;
  defense: number;
  slots: number;
  food: number;
}
export const BASE_MODS: TechMods = { prod: 1, factory: 1, brains: 1, growth: 0, cap: 1, weapons: 1, stab: 0, trade: 1, defense: 1, slots: 0, food: 1 };

export interface TechDef {
  id: string;
  name: string;
  icon: string;
  branch: string;
  tier: number;
  req?: string;
  desc: string;
  fact?: string; // историческая справка
  mods: Partial<TechMods>;
}

export const TECH_BRANCHES = ['Экономика', 'Наука', 'Медицина', 'Сельское хозяйство', 'Армия', 'Атом', 'Торговля', 'Культура'];
export const TIER_COST = [0, 180, 480, 1000, 2000];

export const TECHS: TechDef[] = [
  { id: 'smart_factories', name: 'Умные фабрики', icon: '⚙️', branch: 'Экономика', tier: 1, desc: 'Заводы +25%, открывает завод ур. 2', mods: { factory: 1.25 } },
  { id: 'robotics', name: 'Промышленные роботы', icon: '🤖', branch: 'Экономика', tier: 2, req: 'smart_factories', desc: 'Производительность +10%, заводы +30%, +1 стройка одновременно', mods: { prod: 1.1, factory: 1.3, slots: 1 } },
  { id: 'nanotech', name: 'Нанотехнологии', icon: '🔬', branch: 'Экономика', tier: 3, req: 'robotics', desc: 'Заводы +50%, открывает завод ур. 3', mods: { factory: 1.5 } },
  { id: 'fusion', name: 'Термоядерная энергия', icon: '⚛️', branch: 'Экономика', tier: 4, req: 'nanotech', desc: 'Производительность +25%', mods: { prod: 1.25 } },
  { id: 'digital_edu', name: 'Цифровое образование', icon: '💻', branch: 'Наука', tier: 1, desc: '🧠 +20%, открывает университет ур. 2', mods: { brains: 1.2 } },
  { id: 'supercomputers', name: 'Суперкомпьютеры', icon: '🖥️', branch: 'Наука', tier: 2, req: 'digital_edu', desc: '🧠 +25%', mods: { brains: 1.25 } },
  { id: 'ai', name: 'Искусственный интеллект', icon: '🧬', branch: 'Наука', tier: 3, req: 'supercomputers', desc: '🧠 +30%, производительность +10%, университет ур. 3', mods: { brains: 1.3, prod: 1.1 } },
  { id: 'quantum', name: 'Квантовые компьютеры', icon: '🌀', branch: 'Наука', tier: 4, req: 'ai', desc: '🧠 +40%', mods: { brains: 1.4 } },
  { id: 'space', name: 'Освоение космоса', icon: '🚀', branch: 'Наука', tier: 4, req: 'ai', desc: '🧠 +15%, производительность +10%, стабильность +3', mods: { brains: 1.15, prod: 1.1, stab: 3 } },
  { id: 'telemed', name: 'Телемедицина', icon: '📡', branch: 'Медицина', tier: 1, desc: 'Рост населения +0.2%/год, больница ур. 2', mods: { growth: 0.2 } },
  { id: 'gene_therapy', name: 'Генная терапия', icon: '🧪', branch: 'Медицина', tier: 2, req: 'telemed', desc: 'Рост +0.3%/год, больница ур. 3', mods: { growth: 0.3 } },
  { id: 'longevity', name: 'Продление жизни', icon: '💊', branch: 'Медицина', tier: 3, req: 'gene_therapy', desc: 'Рост +0.4%/год, стабильность +3', mods: { growth: 0.4, stab: 3 } },
  { id: 'vertical_farms', name: 'Вертикальные фермы', icon: '🏢', branch: 'Сельское хозяйство', tier: 1, desc: 'Лимит населения +10%, урожай +10%, ферма ур. 2', mods: { cap: 1.1, food: 1.1 } },
  { id: 'gmo', name: 'ГМО-культуры', icon: '🌽', branch: 'Сельское хозяйство', tier: 2, req: 'vertical_farms', desc: 'Лимит населения +15%, урожай +15%, ферма ур. 3', mods: { cap: 1.15, food: 1.15 } },
  { id: 'drones', name: 'Беспилотники', icon: '🛸', branch: 'Армия', tier: 1, desc: 'Вооружение +20%, казарма ур. 2', mods: { weapons: 1.2 } },
  { id: 'hypersonic', name: 'Гиперзвуковые ракеты', icon: '🚀', branch: 'Армия', tier: 2, req: 'drones', desc: 'Вооружение +25%, крепость ур. 2', mods: { weapons: 1.25 } },
  { id: 'combat_robots', name: 'Боевые роботы', icon: '🦾', branch: 'Армия', tier: 3, req: 'hypersonic', desc: 'Вооружение +35%, казарма ур. 3', mods: { weapons: 1.35 } },
  { id: 'missile_defense', name: 'Противоракетная оборона', icon: '🛰️', branch: 'Армия', tier: 3, req: 'hypersonic', desc: 'Оборона +30%, крепость ур. 3', mods: { defense: 1.3 } },
  { id: 'nuclear_physics', name: 'Ядерная физика', icon: '⚛️', branch: 'Атом', tier: 1, desc: '🧠 +10%, открывает атомную ветку', fact: '1938: Ган и Штрассман расщепили ядро урана нейтроном. Одно деление даёт 200 МэВ — в миллионы раз больше, чем химическая реакция.', mods: { brains: 1.1 } },
  { id: 'nuclear_power', name: 'Атомная энергетика', icon: '⚡', branch: 'Атом', tier: 2, req: 'nuclear_physics', desc: 'Производительность +10%: АЭС дают дешёвую энергию', fact: '1954: в Обнинске заработала первая в мире АЭС. Килограмм урана-235 заменяет около 2 500 т угля.', mods: { prod: 1.1 } },
  { id: 'nuclear_bomb', name: 'Атомная бомба', icon: '☢️', branch: 'Атом', tier: 3, req: 'nuclear_power', desc: 'Сборка ядерных боеголовок (вкладка «Армия»). Боты боятся нападать на ядерную державу', fact: '1945: в «Малыше» было 64 кг урана, но разделилось меньше килограмма. Мощность — 15 кт тротила.', mods: {} },
  { id: 'thermonuclear', name: 'Термоядерная бомба', icon: '💥', branch: 'Атом', tier: 4, req: 'nuclear_bomb', desc: 'Боеголовки вдвое разрушительнее', fact: '1961: «Царь-бомба» мощностью 50 Мт — в 3 000 с лишним раз сильнее хиросимской. Гриб поднялся на 60 км.', mods: {} },
  { id: 'auto_ports', name: 'Автоматизированные порты', icon: '🏗️', branch: 'Торговля', tier: 1, desc: 'Торговля +20%, порт ур. 2', mods: { trade: 1.2 } },
  { id: 'global_logistics', name: 'Глобальная логистика', icon: '🌐', branch: 'Торговля', tier: 2, req: 'auto_ports', desc: 'Торговля +30%, производительность +5%, порт ур. 3', mods: { trade: 1.3, prod: 1.05 } },
  { id: 'dialogue', name: 'Межрелигиозный диалог', icon: '🕊️', branch: 'Культура', tier: 1, desc: 'Стабильность +3, храм ур. 2', mods: { stab: 3 } },
  { id: 'revival', name: 'Духовное возрождение', icon: '✨', branch: 'Культура', tier: 2, req: 'dialogue', desc: 'Стабильность +4, храм ур. 3', mods: { stab: 4 } },
];
export const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t])) as Record<string, TechDef>;

export interface GovDef {
  name: string;
  icon: string;
  desc: string;
  stab: number;
  taxSens: number;
  money: number;
  brains: number;
  weariness: number;
  morale: number;
  armyUpkeep: number;
  sci: number; // привлекательность для учёных
  rich: number; // привлекательность для миллиардеров
}
export const GOVS: Record<GovType, GovDef> = {
  democracy: { name: 'Демократия', icon: '🗳️', desc: '🧠 +10%, высокие налоги злят людей, война быстро утомляет', stab: 5, taxSens: 1.3, money: 1, brains: 1.1, weariness: 1.5, morale: 0, armyUpkeep: 1, sci: 1.05, rich: 1 },
  republic: { name: 'Республика', icon: '🏛️', desc: '💰 +5%, сбалансированный вариант', stab: 3, taxSens: 1, money: 1.05, brains: 1, weariness: 1.1, morale: 0, armyUpkeep: 1, sci: 1, rich: 1.05 },
  monarchy: { name: 'Монархия', icon: '👑', desc: 'Стабильность +8, налоги переносятся легче', stab: 8, taxSens: 0.9, money: 1, brains: 0.95, weariness: 1, morale: 0.05, armyUpkeep: 1, sci: 0.95, rich: 1.1 },
  dictatorship: { name: 'Диктатура', icon: '✊', desc: 'Налоги почти не влияют на стабильность, армия дешевле и злее, 🧠 −15%', stab: 0, taxSens: 0.5, money: 1, brains: 0.85, weariness: 0.6, morale: 0.12, armyUpkeep: 0.85, sci: 0.85, rich: 0.75 },
};

export interface ReligionDef {
  name: string;
  icon: string;
  desc: string;
  stab: number;
  brains: number;
  temple: number;
  growth: number;
  sci: number;
}
export const RELIGIONS: Record<ReligionPolicy, ReligionDef> = {
  secular: { name: 'Светское государство', icon: '🔭', desc: '🧠 +15%, стабильность −4, храмы слабее', stab: -4, brains: 1.15, temple: 0.5, growth: -0.1, sci: 1.1 },
  freedom: { name: 'Свобода вероисповедания', icon: '🤝', desc: '🧠 +5%, нейтральный вариант', stab: 0, brains: 1.05, temple: 1, growth: 0, sci: 1 },
  state: { name: 'Государственная религия', icon: '⛪', desc: 'Стабильность +6, храмы сильнее, 🧠 −5%', stab: 6, brains: 0.95, temple: 1.4, growth: 0.15, sci: 0.95 },
  theocracy: { name: 'Теократия', icon: '📿', desc: 'Стабильность +12, храмы ×1.9, рождаемость выше, 🧠 −20%', stab: 12, brains: 0.8, temple: 1.9, growth: 0.3, sci: 0.85 },
};

export interface PersonalityDef {
  name: string;
  icon: string;
  desc: string;
  armyRatio: number;
  tax: number;
  build: Partial<Record<BuildingType, number>>;
}
export const PERSONALITIES: Record<Personality, PersonalityDef> = {
  aggressor: { name: 'Агрессор', icon: '🗡️', desc: 'Копит армию и нападает на слабых', armyRatio: 0.014, tax: 0.26, build: { barracks: 3, factory: 3, fortress: 1, farm: 1, temple: 1, university: 1, hospital: 1 } },
  trader: { name: 'Торговец', icon: '💼', desc: 'Ищет торговые договоры и строит порты', armyRatio: 0.005, tax: 0.2, build: { factory: 4, port: 3, university: 1, farm: 1, temple: 1, hospital: 1 } },
  scientist: { name: 'Учёный', icon: '🔬', desc: 'Вкладывается в науку', armyRatio: 0.005, tax: 0.22, build: { university: 4, factory: 2, hospital: 2, farm: 1, temple: 1 } },
  fanatic: { name: 'Фанатик', icon: '⛪', desc: 'Религия на первом месте, непредсказуем', armyRatio: 0.009, tax: 0.22, build: { temple: 4, factory: 2, barracks: 2, farm: 1, hospital: 1 } },
  cautious: { name: 'Осторожный', icon: '🛡️', desc: 'Нейтралитет и оборона', armyRatio: 0.007, tax: 0.18, build: { fortress: 3, factory: 3, farm: 2, hospital: 1, university: 1, temple: 1 } },
};
export const PERSONALITY_KEYS = Object.keys(PERSONALITIES) as Personality[];

export const BUDGET_LEVELS = ['Нет', 'Низкие', 'Средние', 'Высокие'];
export const BUDGET_COST = [0, 0.04, 0.08, 0.14];
export const BUDGET_INFO = {
  edu: { name: 'Образование', icon: '🎓', mult: [0.3, 0.7, 1, 1.4], hint: 'Больше 🧠' },
  health: { name: 'Здравоохранение', icon: '🏥', growth: [-0.4, -0.1, 0, 0.25], stab: [-6, -2, 0, 3], hint: 'Рост 👥 и стабильность' },
  infra: { name: 'Инфраструктура', icon: '🛣️', prod: [0, 0.05, 0.12, 0.2], stab: [-4, -1, 0, 2], hint: 'Производительность экономики' },
  military: { name: 'Военный бюджет', icon: '🎖️', morale: [-0.2, 0, 0.1, 0.2], hint: 'Мораль армии' },
};
export const BIRTH_POLICY = [
  { name: 'Нет', growth: 0, cost: 0, stab: 0 },
  { name: 'Умеренная', growth: 0.35, cost: 0.03, stab: 1 },
  { name: 'Сильная', growth: 0.8, cost: 0.07, stab: 2 },
];
export const MIGRATION = [
  { name: 'Закрытая', growth: -0.1, stab: 2 },
  { name: 'Умеренная', growth: 0.15, stab: -2 },
  { name: 'Открытая', growth: 0.45, stab: -6 },
];

export const DIFFICULTY = {
  easy: { name: 'Лёгкая', bot: 0.85, aggression: 0.6 },
  normal: { name: 'Средняя', bot: 1, aggression: 1 },
  hard: { name: 'Высокая', bot: 1.2, aggression: 1.3 },
};

// ---------- общество: учёные, миллиардеры, мировые компании ----------
export const SCI_OUT = 0.0007; // 🧠 в день от одного учёного (× образованность)
export const EDU_SCI = [0.6, 0.85, 1, 1.2]; // бюджет образования → сколько учёных вырастает
export const INVEST_PER = 0.2; // 💰 в день от инвестиций одного миллиардера
export const CORP_YIELD = 0.0006; // доля капитализации компании, которая каждый день идёт в казну

export interface SectorDef {
  name: string;
  icon: string;
  desc: string;
  need: BuildingType; // что нужно в стране, чтобы основать госкорпорацию
  names: string[]; // шаблоны названий: {R} — корень страны, {C} — город
}
export const SECTORS: Record<Sector, SectorDef> = {
  tech: { name: 'Технологии', icon: '💻', desc: '🧠 +3% за компанию', need: 'university', names: ['{R}Телеком', '{C} Софт', '{R}Тех', 'Нео{R}', '{C} Дигитал', '{R}Сеть'] },
  energy: { name: 'Энергетика', icon: '⚡', desc: 'Производительность +3% за компанию', need: 'factory', names: ['{R}Нефтегаз', '{C} Энерго', '{R}Атом', '{C} Петролеум', '{R}Сила', '{R}Уголь'] },
  finance: { name: 'Финансы', icon: '🏦', desc: 'Торговля +8% за компанию', need: 'port', names: ['{R}Банк', 'Банк «{C}»', '{C} Капитал', '{R}Инвест', '{C} Финанс', '{R}Кредит'] },
  industry: { name: 'Промышленность', icon: '🚗', desc: 'Заводы +6% за компанию', need: 'factory', names: ['{R}Маш', '{C} Моторс', '{R}Сталь', '{R}Авто', '{C} Индастриз', '{R}Хим'] },
  defense: { name: 'Оборонка', icon: '🔫', desc: 'Выпуск оружия, вооружение +2% за компанию', need: 'barracks', names: ['{R}Оборонпром', '{C} Арсенал', '{R}Дефенс', '{R}Ракета', '{C} Аэроспейс', '{R}Броня'] },
  agro: { name: 'Агрохолдинг', icon: '🌾', desc: 'Урожай +6% за компанию', need: 'farm', names: ['{R}Агро', '{C} Зерно', '{R}Хлеб', '{C} Фудс', '{R}Нива', '{R}Молоко'] },
  pharma: { name: 'Фармацевтика', icon: '💊', desc: 'Рост населения +0.15%/год за компанию', need: 'hospital', names: ['{R}Фарм', '{C} Биотех', '{R}Мед', '{C} Лабс', '{R}Вита', '{R}Ген'] },
};
export const SECTOR_KEYS = Object.keys(SECTORS) as Sector[];

/** Корни названий компаний по странам. */
export const NAME_ROOT: Record<string, string> = {
  ru: 'Рос', us: 'Амер', cn: 'Чжун', in: 'Инд', br: 'Браз', ca: 'Кан', mx: 'Мекс', ar: 'Арг', gb: 'Брит', fr: 'Гал', de: 'Дойч',
  it: 'Итал', es: 'Иберо', ua: 'Укр', tr: 'Тюрк', ir: 'Перс', sa: 'Араб', kz: 'Каз', pk: 'Пак', jp: 'Ниппон', id: 'Нуса',
  eg: 'Нил', ng: 'Нигер', dz: 'Сахара', za: 'Кап', au: 'Оз',
};

export interface GeniusFieldDef {
  name: string;
  icon: string;
  desc: (lvl: number) => string;
  mods: (lvl: number) => Partial<TechMods>;
}
export const GENIUS_FIELDS: Record<GeniusField, GeniusFieldDef> = {
  physics: { name: 'Физик', icon: '⚛️', desc: (l) => `🧠 +${4 * l}%`, mods: (l) => ({ brains: 1 + 0.04 * l }) },
  it: { name: 'Программист', icon: '💻', desc: (l) => `🧠 +${2.5 * l}%, производительность +${1.5 * l}%`, mods: (l) => ({ brains: 1 + 0.025 * l, prod: 1 + 0.015 * l }) },
  medicine: { name: 'Медик', icon: '🩺', desc: (l) => `рост 👥 +${(0.15 * l).toFixed(2)}%/год`, mods: (l) => ({ growth: 0.15 * l }) },
  agro: { name: 'Агроном', icon: '🌾', desc: (l) => `урожай +${6 * l}%`, mods: (l) => ({ food: 1 + 0.06 * l }) },
  military: { name: 'Военный инженер', icon: '🎖️', desc: (l) => `вооружение +${4 * l}%`, mods: (l) => ({ weapons: 1 + 0.04 * l }) },
  econ: { name: 'Экономист', icon: '📊', desc: (l) => `производительность +${3 * l}%`, mods: (l) => ({ prod: 1 + 0.03 * l }) },
};
export const GENIUS_KEYS = Object.keys(GENIUS_FIELDS) as GeniusField[];
export const GENIUS_LEVEL = ['', 'Талант', 'Светило', 'Нобелевский лауреат'];
export const GENIUS_COST = [0, 35, 70, 130]; // × доход страны в начале партии
export const GENIUS_NAMES = [
  'Анна Ковальская', 'Ли Вэй', 'Карлос Мендес', 'Айгерим Сапарова', 'Хироси Танака', 'Амара Оконкво', 'Давид Леви', 'Мария Россо',
  'Рахим Хан', 'Ингрид Свенсон', 'Пьер Дюбуа', 'Фатима Аль-Захра', 'Игорь Волков', 'Сунь Мэй', 'Джеймс Картер', 'Ольга Бондаренко',
  'Арджун Мехта', 'Лукас Фернандес', 'Ким Мин Джун', 'Нурлан Абенов', 'Эмма Шульц', 'Омар Хассан', 'Елена Петрова', 'Тадео Гарсиа',
  'Ая Накамура', 'Кофи Менса', 'София Мартен', 'Мехмет Йылмаз', 'Дарья Соколова', 'Хуан Перес', 'Ноа Уильямс', 'Зейнеп Кая',
];

// ---------- рынок: продовольствие и оружие ----------
export const FOOD_PER = 0.001; // т продовольствия на человека в день (солдату — в полтора раза больше)
export const FOOD_BASE = 0.0001; // базовая цена 1 т
export const ARMS_BASE = 0.1; // базовая цена одного комплекта вооружения
export const MIL_ARMS = [0.5, 1, 1.25, 1.5]; // военный бюджет → выпуск оружия
/** Самообеспеченность продовольствием в начале партии (1 — ровно хватает). */
export const FOOD_SELF: Record<string, number> = {
  ru: 1.5, us: 1.3, cn: 0.95, in: 1.05, br: 1.5, ca: 1.9, mx: 0.8, ar: 2.2, gb: 0.75, fr: 1.3, de: 0.95, it: 0.75, es: 0.85,
  ua: 2, tr: 1, ir: 0.8, sa: 0.4, kz: 1.6, pk: 1, jp: 0.6, id: 0.9, eg: 0.6, ng: 0.85, dz: 0.5, za: 1.05, au: 2,
};

export const START_YEAR = 2026;
export const WAR_GRACE_DAYS = 120;
export const BATTLE_DAYS = 20;
