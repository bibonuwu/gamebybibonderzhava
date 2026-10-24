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
  // госдолг (debt.ts)
  debt?: number; // облигации на рынке
  debtRate?: number; // годовая ставка по ним — от кредитного рейтинга
  imf?: ImfProgram; // программа МВФ
  defaulted?: number; // до этого дня рейтинг «D» после дефолта
  imfBan?: number; // до этого дня МВФ не даёт денег
  imfBroken?: number; // до этого дня рейтинг ниже: страна сорвала программу МВФ
  counterIntel?: number; // контрразведка 0…3 (spy.ts)
  aiFlags: {
    reformed?: boolean; lastWarDay?: number; lastProposalDay?: number; lastAnnex?: number; nextAttack?: number;
    prepTarget?: number; prepUntil?: number; // подготовка к войне: закупки и мобилизация
    lastDemand?: number; lastCompany?: number; lastRichTax?: number;
    nextVote?: number; voteBias?: number; // выборы бота и вмешательство чужих спецслужб
    lastSpy?: number;
  };
}

/** Программа МВФ: дешёвый кредит в обмен на строгий бюджет. */
export interface ImfProgram {
  loan: number; // долг МВФ
  until: number; // конец программы
  warn?: number; // день, когда условия нарушены: через 30 дней программу прервут
}

/** Обещание кампании: до выборов поднимает рейтинг, после победы его надо выполнить за год. */
export interface ElectionPromise {
  kind: string;
  target: number;
  base: number; // значение в день обещания
  until?: number; // срок выполнения (после победы)
}

/** Выборы игрока (elections.ts). */
export interface ElectionState {
  next: number; // день выборов
  approval: number; // рейтинг власти, %
  forGov?: string; // для какой формы правления назначены
  party: string; // главная оппозиционная партия
  leader: string;
  promise?: ElectionPromise; // обещание кампании
  offers?: ElectionPromise[]; // обещания, предложенные в окне кампании
  mandate?: ElectionPromise; // обещание, которое надо выполнить после победы
  boost: number; // очки кампании: агитация, дебаты, обещание
  trust: number; // доверие: сдержанные и нарушенные обещания, скандалы — со временем забывается
  cd: Record<string, number>; // действие кампании → день, когда снова можно
  rigged?: number; // «дорисовано» голосов
  campaign?: boolean; // кампания объявлена
  coalition?: { party: string; until: number }; // проиграли — условия партии-победителя
  last?: { day: number; ours: number; won: boolean };
}

/** Спецслужбы (spy.ts). */
export interface IntelState {
  net: number[][]; // net[a][b] — сеть агентов a в стране b, 0…100
  watch: Record<number, number>; // досье игрока: страна → до какого дня видим всё
  cd: Record<string, number>; // операция игрока → день, когда снова можно
  sweep?: number; // день последней зачистки
}

/** Мировые финансы: базовая ставка и кризисы. */
export interface FinanceState {
  base: number; // мировая ставка
  shock: number; // кризисная надбавка, гаснет со временем
  nextCrisis: number;
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

/** Как игрок относится к тайной ложе: не знает о ней, состоит, отказался, запретил, изгнан за войну с братом. */
export type LodgeStatus = 'none' | 'member' | 'refused' | 'banned' | 'expelled';

/** Поручение ложи игроку (см. lodge.ts). */
export interface LodgeTask {
  kind: string;
  target: number;
  base: number; // значение в день поручения
  param?: number; // страна-брат или агрессор
  since: number;
  until: number;
  reward: number; // 🔺
}

/** Тайная ложа «Всевидящее око»: масоны среди правителей мира. */
export interface LodgeState {
  members: number[]; // страны-члены, вместе с игроком
  known: number[]; // члены, чьё масонство раскрыли газеты
  inf: number[]; // 🔺 влияние в ложе по странам
  master: number; // Великий мастер (-1 — не избран)
  status: LodgeStatus;
  joined?: number;
  merit: number; // заслуги игрока: от них степень посвящения
  open?: boolean; // игрок открыто признал членство: разоблачать нечего, но тайные дела злят народ
  suspicion: number; // 0…100 — насколько газеты близки к разгадке
  task?: LodgeTask;
  nextTask: number;
  cd: Record<string, number>; // услуга → день, когда она снова доступна
  shield?: number; // до этого дня братья в ООН прикрывают игрока
  nextElection: number;
  electionAsked?: boolean;
  nextPlot: number; // тайные дела ботов-братьев и происки ложи против тех, кто её запретил
}

export interface PendingEvent {
  id: string;
  kind?: 'demand' | 'un' | 'lodge' | 'election' | 'debt'; // требование народа, Совбез ООН, тайная ложа, выборы или финансы, а не случайное событие
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
  lodge: LodgeState; // тайная ложа
  elections: ElectionState; // выборы игрока
  intel: IntelState; // разведка
  finance: FinanceState; // мировые финансы
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
