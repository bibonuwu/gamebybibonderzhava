export type Terrain = 'o' | 'c' | 'p' | 'g' | 'f' | 'd' | 't' | 's' | 'm';
export type GovType = 'democracy' | 'republic' | 'monarchy' | 'dictatorship';
export type ReligionPolicy = 'secular' | 'freedom' | 'state' | 'theocracy';
export type Personality = 'aggressor' | 'trader' | 'scientist' | 'fanatic' | 'cautious';
export type BuildingType = 'factory' | 'university' | 'temple' | 'hospital' | 'farm' | 'barracks' | 'port' | 'fortress';
export type ArmyType = 'conscript' | 'contract';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type BudgetKey = 'edu' | 'health' | 'infra' | 'military';
export type Sector = 'tech' | 'energy' | 'finance' | 'industry' | 'defense' | 'agro' | 'pharma';
export type GeniusField = 'physics' | 'it' | 'medicine' | 'agro' | 'military' | 'econ';

export interface CountryDef {
  id: string;
  iso: string;
  name: string;
  color: string;
  pop: number; // млн
  gdp: number; // тыс. $ на человека
  growth: number; // %/год
  army: number; // тыс. солдат
  weapons: number;
  edu: number;
  gov: GovType;
  cities: [string, number, number][];
}

export interface TempMod {
  kind: 'stab' | 'growth' | 'prod' | 'brains' | 'food' | 'rich' | 'sci';
  value: number;
  until: number;
  label: string;
}

export interface Country {
  idx: number;
  alive: boolean;
  personality: Personality;
  money: number;
  brains: number;
  soldiers: number;
  tax: number;
  budget: Record<BudgetKey, number>;
  religion: ReligionPolicy;
  gov: GovType;
  armyType: ArmyType;
  birthPolicy: number;
  migration: number;
  stability: number;
  weariness: number;
  unrest: number;
  capital: number; // id региона
  techs: string[];
  fundamental: number;
  baseProd: number;
  eduIndex: number;
  growthBase: number;
  weaponsBase: number;
  techScale: number;
  annexCount: number;
  govChangedDay: number;
  mods: TempMod[];
  lastGross: number;
  moneyScale: number; // доход в начале партии — мерило цен великих проектов
  project?: WonderProject;
  scientists: number;
  billionaires: number;
  food: number; // запас продовольствия, т
  foodReserve: number; // сколько дней потребления держать в запасе
  foodAuto: boolean; // автоторговля излишками и дефицитом
  arms: number; // комплекты вооружения на складах и в войсках
  nukes?: number; // готовые ядерные боеголовки
  nukeBuild?: { left: number; total: number }; // сборка боеголовки
  nukeTested?: boolean; // первое испытание проведено
  aiFlags: {
    reformed?: boolean; lastWarDay?: number; lastProposalDay?: number; lastAnnex?: number; nextAttack?: number;
    prepTarget?: number; prepUntil?: number; // подготовка к войне: закупки и мобилизация
    lastDemand?: number; lastCompany?: number; lastRichTax?: number;
  };
}

export interface RegionState {
  owner: number; // -1 нейтральная
  pop: number;
  cap0: number;
  agri: number; // урожай региона без бонусов, т/день
}

export interface Building {
  type: BuildingType;
  level: number;
  progress: number; // сек до готовности (0 — готово)
  total: number;
}

export interface PairState {
  trade?: boolean;
  pact?: boolean;
  alliance?: boolean;
  war?: { since: number; aRegions: number; bRegions: number; un?: number }; // un — агрессор, против которого воюют по мандату ООН
  truce?: number; // день, до которого нельзя воевать
  grudge?: number;
  cooldown?: number; // день, до которого игрок не может повторить предложение
  tradeSince?: number; // день подписания торгового договора
  earned?: number; // сколько 💰 договор уже принёс игроку
}

export type UNVote = 'yes' | 'veto' | 'abstain';

/** Дело ООН об агрессии: кто на кого напал, как решил Совбез, кто помогает жертве (см. un.ts). */
export interface UNCase {
  id: number;
  aggressor: number;
  victim: number;
  since: number;
  treachery?: boolean; // нарушен пакт о ненападении
  vote: number; // день заседания Совбеза
  playerVote?: UNVote; // голос игрока, если он постоянный член Совбеза
  resolved?: boolean; // Совбез проголосовал
  veto?: number; // кто наложил вето (нет — резолюция принята)
  sanctions: number[]; // ввели санкции
  donors: number[]; // раз в месяц помогают жертве деньгами и оружием
  coalition: number[]; // воюют с агрессором по мандату ООН
  aid: { money: number; arms: number }; // сколько жертва уже получила
  nextAid: number;
  taken: number; // сколько регионов жертвы агрессор удерживает
  until?: number; // мир заключён, но захват не признан: санкции до этого дня
}

export interface Battle {
  id: number;
  att: number;
  def: number; // -1 — нейтральные
  region: number;
  soldiers: number;
  start: number;
  end: number;
  naval: boolean;
}

/** Ракета с ядерной боеголовкой в полёте. */
export interface Missile {
  id: number;
  from: number; // страна-агрессор
  region: number;
  launch: number;
  arrive: number;
  thermo: boolean;
}

export interface LogEntry {
  day: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'war';
  world?: boolean; // мировая новость (без участия игрока)
}

export interface WonderProject {
  id: string;
  left: number; // дней до завершения
  total: number;
  money: number; // сколько вложено (для возврата при неудаче)
  brains: number;
}

export interface WonderState {
  region: number;
  day: number;
  builder: number;
}

export interface Quest {
  id: number;
  kind: string;
  target: number;
  param?: number;
  reward: { money: number; brains: number };
  done: boolean;
}

/** Вложение в письме: забирается одной кнопкой. */
export interface LetterGift {
  money?: number;
  brains?: number;
  food?: number;
  stab?: number; // временная прибавка к стабильности
  label: string;
}

/** Письмо в почтовом ящике игрока (тексты посчитаны при отправке, см. mail.ts). */
export interface Letter {
  id: number;
  tpl: string; // шаблон письма
  day: number;
  from: string;
  icon: string; // кто пишет
  subject: string;
  body: string[]; // абзацы
  sign: string;
  art: string; // картинка в шапке письма
  paper: string; // бумага: пергамент, тетрадь, телеграмма…
  stamp: string; // эмодзи на марке
  seal: string; // цвет сургуча
  read?: boolean;
  gift?: LetterGift;
  claimed?: boolean;
  replies?: { label: string; hint: string }[];
  answered?: number;
  result?: string; // чем кончился ответ
  target?: number; // страна-отправитель
  vals?: number[]; // числа, посчитанные при отправке
}

export interface Proposal {
  id: number;
  from: number;
  kind: 'trade' | 'pact' | 'alliance' | 'peace' | 'tribute';
  amount?: number;
  expires: number;
}

export interface PendingEvent {
  id: string;
  kind?: 'demand' | 'un'; // требование народа или голосование в Совбезе ООН, а не случайное событие
  title: string;
  text: string;
  icon: string;
  target?: number; // страна, о которой событие
  options: { label: string; hint: string; idx?: number }[];
}

/** Мировая компания. Принадлежит стране, где штаб-квартира. */
export interface Company {
  id: number;
  name: string;
  sector: Sector;
  hq: number; // регион
  value: number; // капитализация
  founded: number;
  state?: boolean; // госкорпорация
}

/** Звезда науки: учёный, которого можно нанять на рынке. */
export interface Genius {
  id: number;
  name: string;
  field: GeniusField;
  level: number; // 1–3
  origin: number; // страна родом
  employer: number; // -1 — ищет работу на рынке
  until: number; // на рынке — до какого дня ждёт, на работе — день ухода на пенсию
}

export interface MarketGood {
  stock: number; // свободный товар на мировом рынке
  norm: number;
  base: number; // базовая цена за единицу
  price: number;
  shock: number; // мировые потрясения: неурожай, гонка вооружений
  hist: number[];
}

export interface MarketState {
  food: MarketGood;
  arms: MarketGood;
  sciPool: number; // учёные, ищущие работу по всему миру
  sciNorm: number;
  nextGenius: number;
  nextShock: number;
}

export interface Sample {
  d: number;
  pop: number;
  money: number;
  brains: number;
  mr: number;
  br: number;
  pr: number;
}

export interface GameState {
  version: number;
  day: number;
  player: number;
  difficulty: Difficulty;
  countries: Country[];
  regions: RegionState[];
  buildings: Record<number, Building>;
  rel: number[][];
  pairs: Record<string, PairState>;
  battles: Battle[];
  missiles: Missile[];
  fallout: Record<number, number>; // регион → день, до которого держится радиоактивное заражение
  un: UNCase[]; // дела ООН об агрессии
  nextId: number;
  log: LogEntry[];
  proposals: Proposal[];
  event: PendingEvent | null;
  nextEventDay: number;
  achievements: string[];
  wonders: Record<string, WonderState>;
  quests: Quest[];
  mail: Letter[]; // почтовый ящик, свежие — первыми
  mailSeen: string[]; // сюжетные письма, которые уже приходили
  nextMailDay: number;
  mailQueue?: { day: number; tpl: string; vals: number[]; target?: number }[]; // продолжения цепочек писем
  companies: Company[];
  geniuses: Genius[];
  market: MarketState;
  nextDemandDay: number;
  counters: Record<string, number>;
  hist: { s: Sample[]; m: Sample[]; l: Sample[] };
  rng: number;
  gameOver: boolean;
}
