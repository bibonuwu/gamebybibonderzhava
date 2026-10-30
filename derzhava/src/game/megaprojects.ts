// Куда тратить большие деньги в поздней игре.
// • Мегапроекты: национальные стройки в три этапа — магистрали, умные города, защита от стихии, энергопереход,
//   программа здоровья, космос, хлеб, вода, наука, цифра, финансы, мирный атом, оборона и культура.
//   Цена — в днях нынешнего дохода, так что дорого всегда.
//   Космос — гонка: кто первым высадится на Луну и основает колонию на Марсе, тот прославится на весь мир.
// • Программы развития: год вкладываться в бедную страну — она богатеет, дружит с нами и голосует в ООН заодно.
import { addRel, atWar, cname, enemiesOf } from './actions';
import { TECH_BY_ID, type TechMods } from './defs';
import { computeAll, STATS } from './economy';
import { fmt } from './format';
import { isNuclear } from './nuclear';
import { incomeNow } from './prosperity';
import { banner, fx, log, news, pick, rand, sfx } from './state';
import type { Country, GameState, Personality } from './types';
import { REGIONS, vb } from './world';

export interface MegaStage { name: string; days: number; cost: number; brains?: number; tech?: string }
export interface MegaDef {
  id: string;
  name: string;
  icon: string;
  desc: string; // что даёт каждый этап
  stages: MegaStage[];
  mods: (n: number) => Partial<TechMods>;
  pref: Personality[];
  onDone?: (g: GameState, i: number, stage: number) => void; // разовый эффект готового этапа
}

export const MEGAS: MegaDef[] = [
  { id: 'rail', name: 'Скоростные магистрали', icon: '🚄', desc: 'каждый этап: производительность +4%, торговля +6%, нефти −4%',
    stages: [{ name: 'Первая линия', days: 120, cost: 80 }, { name: 'Сеть между городами', days: 150, cost: 150 }, { name: 'Вакуумный экспресс', days: 180, cost: 250, tech: 'hyperloop' }],
    mods: (n) => ({ prod: 1 + 0.04 * n, trade: 1 + 0.06 * n, oil: 1 - 0.04 * n }), pref: ['trader', 'aggressor'] },
  { id: 'cities', name: 'Умные города', icon: '🏙️', desc: 'каждый этап: стабильность +2, ожидания растут на 12% медленнее, 🧠 +3%',
    stages: [{ name: 'Цифровая столица', days: 120, cost: 100, tech: 'digital_edu' }, { name: 'Умные мегаполисы', days: 150, cost: 180, tech: 'supercomputers' }, { name: 'Город под управлением ИИ', days: 180, cost: 300, tech: 'ai' }],
    mods: (n) => ({ stab: 2 * n, expect: 1 - 0.12 * n, brains: 1 + 0.03 * n }), pref: ['scientist', 'trader'] },
  { id: 'coast', name: 'Защита от стихии', icon: '🌊', desc: 'каждый этап: вред от потепления и стихийных бедствий −18%',
    stages: [{ name: 'Дамбы и волнорезы', days: 100, cost: 70 }, { name: 'Пожарная авиация и водохранилища', days: 130, cost: 130 }, { name: 'Климатический щит', days: 160, cost: 200, tech: 'carbon_capture' }],
    mods: (n) => ({ climate: 1 - 0.18 * n }), pref: ['cautious', 'fanatic'] },
  { id: 'energy', name: 'Энергопереход', icon: '☀️', desc: 'каждый этап: выбросы −15%, нефти −15%, лития +8%, производительность +2%',
    stages: [{ name: 'Солнечные и ветряные парки', days: 120, cost: 100, tech: 'green_energy' }, { name: 'Электромобили для всех', days: 150, cost: 180, tech: 'smart_grid' }, { name: 'Страна без угля и нефти', days: 180, cost: 300, tech: 'fusion' }],
    mods: (n) => ({ emis: 1 - 0.15 * n, oil: 1 - 0.15 * n, lith: 1 + 0.08 * n, prod: 1 + 0.02 * n }), pref: ['scientist', 'cautious', 'trader'] },
  { id: 'health', name: 'Нация долгожителей', icon: '🧬', desc: 'каждый этап: пенсии −10%, рост 👥 +0.1%/год, стабильность +1',
    stages: [{ name: 'Поликлиника в каждом селе', days: 100, cost: 80, tech: 'telemed' }, { name: 'Генетический паспорт', days: 130, cost: 140, tech: 'gene_therapy' }, { name: 'Клиники омоложения', days: 160, cost: 220, tech: 'rejuvenation' }],
    mods: (n) => ({ aging: 1 - 0.1 * n, growth: 0.1 * n, stab: n }), pref: ['cautious', 'fanatic', 'scientist'] },
  { id: 'space', name: 'Космическая программа', icon: '🚀', desc: 'каждый этап: стабильность +2, 🧠 +5%, производительность +2%. Первым на Луне и на Марсе — слава на весь мир',
    stages: [
      { name: 'Свои спутники', days: 120, cost: 100, brains: 200 },
      { name: 'Высадка на Луну', days: 180, cost: 200, brains: 500 },
      { name: 'Колония на Марсе', days: 240, cost: 350, brains: 1000, tech: 'nuclear_rockets' },
    ],
    mods: (n) => ({ stab: 2 * n, brains: 1 + 0.05 * n, prod: 1 + 0.02 * n }), pref: ['scientist', 'aggressor'] },
  { id: 'agro', name: 'Хлебная держава', icon: '🚜', desc: 'каждый этап: урожай +10%, лимит населения +3%',
    stages: [{ name: 'Орошение степей', days: 100, cost: 70 }, { name: 'Элеваторы и агрохолдинги', days: 130, cost: 130, tech: 'vertical_farms' }, { name: 'Агрогорода будущего', days: 160, cost: 220, tech: 'lab_meat' }],
    mods: (n) => ({ food: 1 + 0.1 * n, cap: 1 + 0.03 * n }), pref: ['cautious', 'fanatic', 'trader'] },
  { id: 'water', name: 'Вода для пустынь', icon: '💧', desc: 'каждый этап: лимит населения +5%, урожай +4%, вред от потепления −10%',
    stages: [{ name: 'Каналы и водохранилища', days: 110, cost: 80 }, { name: 'Опреснительные заводы', days: 140, cost: 150, tech: 'green_energy' }, { name: 'Зелёная стена против пустыни', days: 170, cost: 230, tech: 'drought_crops' }],
    mods: (n) => ({ cap: 1 + 0.05 * n, food: 1 + 0.04 * n, climate: 1 - 0.1 * n }), pref: ['cautious', 'fanatic'] },
  { id: 'science', name: 'Наукоград', icon: '🔬', desc: 'каждый этап: 🧠 +7%, производительность +2%',
    stages: [{ name: 'Технопарк', days: 110, cost: 90, tech: 'digital_edu' }, { name: 'Академгородок', days: 150, cost: 170, tech: 'supercomputers' }, { name: 'Большой адронный коллайдер', days: 210, cost: 300, brains: 600, tech: 'quantum' }],
    mods: (n) => ({ brains: 1 + 0.07 * n, prod: 1 + 0.02 * n }), pref: ['scientist'] },
  { id: 'digital', name: 'Цифровое государство', icon: '🌐', desc: 'каждый этап: производительность +3%, 🧠 +3%, стабильность +1',
    stages: [{ name: 'Интернет в каждый дом', days: 100, cost: 80 }, { name: 'Электронное правительство', days: 130, cost: 150, tech: 'supercomputers' }, { name: 'Квантовая связь', days: 170, cost: 250, tech: 'quantum' }],
    mods: (n) => ({ prod: 1 + 0.03 * n, brains: 1 + 0.03 * n, stab: n }), pref: ['scientist', 'trader'] },
  { id: 'finance', name: 'Мировой финансовый центр', icon: '🏦', desc: 'каждый этап: торговля +8%, производительность +3%',
    stages: [{ name: 'Фондовая биржа', days: 100, cost: 90 }, { name: 'Деловой квартал небоскрёбов', days: 140, cost: 170, tech: 'global_logistics' }, { name: 'Своя мировая валюта', days: 180, cost: 280, tech: 'digital_money' }],
    mods: (n) => ({ trade: 1 + 0.08 * n, prod: 1 + 0.03 * n }), pref: ['trader'] },
  { id: 'atom', name: 'Мирный атом', icon: '⚛️', desc: 'каждый этап: производительность +3%, нефти −10%, выбросы −8%',
    stages: [{ name: 'Атомные электростанции', days: 130, cost: 110, tech: 'nuclear_power' }, { name: 'Атомный ледокольный флот', days: 150, cost: 170, tech: 'thorium' }, { name: 'Термоядерный реактор', days: 210, cost: 320, brains: 500, tech: 'fusion' }],
    mods: (n) => ({ prod: 1 + 0.03 * n, oil: 1 - 0.1 * n, emis: 1 - 0.08 * n }), pref: ['scientist', 'aggressor'] },
  { id: 'shield', name: 'Щит Родины', icon: '🛡️', desc: 'каждый этап: оборона +10%, вооружение +4%. Купол ПРО сбивает ядерные ракеты на 20% чаще',
    stages: [{ name: 'Линия укреплений', days: 110, cost: 80 }, { name: 'Эшелонированная ПВО', days: 140, cost: 150, tech: 'hypersonic' }, { name: 'Противоракетный купол', days: 180, cost: 260, tech: 'missile_defense' }],
    mods: (n) => ({ defense: 1 + 0.1 * n, weapons: 1 + 0.04 * n }), pref: ['aggressor', 'cautious'] },
  { id: 'culture', name: 'Культурная столица мира', icon: '🎭', desc: 'каждый этап: стабильность +2, ожидания растут на 8% медленнее, а мир теплеет к нам: отношения со всеми +4',
    stages: [{ name: 'Национальный музей и театр', days: 100, cost: 70 }, { name: 'Киностудия мирового уровня', days: 130, cost: 130, tech: 'dialogue' }, { name: 'Всемирная выставка', days: 160, cost: 220, tech: 'soft_power' }],
    mods: (n) => ({ stab: 2 * n, expect: 1 - 0.08 * n }), pref: ['trader', 'fanatic', 'cautious'],
    onDone: (g, i) => {
      g.countries.forEach((o, j) => { if (o.alive && j !== i && !atWar(g, i, j)) addRel(g, i, j, 4); });
      if (i === g.player) log(g, '🎭 Наша культура покоряет мир: отношения со всеми странами +4', 'good');
    } },
];
export const MEGA_BY_ID = Object.fromEntries(MEGAS.map((m) => [m.id, m])) as Record<string, MegaDef>;
/** Этапы космической гонки: кто первый — получает славу. */
const RACE: Record<number, { key: string; icon: string; act: string; rest: string; ours: string }> = {
  2: { key: 'moon', icon: '🌕', act: 'высадился', rest: 'на Луну', ours: 'первыми высадились на Луну' },
  3: { key: 'mars', icon: '🔴', act: 'основал', rest: 'колонию на Марсе', ours: 'первыми основали колонию на Марсе' },
};

export const megaStages = (c: Country, id: string) => c.megas?.[id] ?? 0;

/** Бонусы готовых этапов мегапроектов страны. */
export function megaMods(c: Country): Partial<TechMods>[] {
  const out: Partial<TechMods>[] = [];
  for (const id in c.megas) {
    const n = c.megas[id];
    if (n > 0 && MEGA_BY_ID[id]) out.push(MEGA_BY_ID[id].mods(n));
  }
  return out;
}

/** Следующий этап и его цена (null — проект закончен). */
export function megaNext(g: GameState, i: number, id: string) {
  const def = MEGA_BY_ID[id];
  const c = g.countries[i];
  const n = megaStages(c, id);
  if (!def || n >= def.stages.length) return null;
  const st = def.stages[n];
  return { stage: n + 1, st, money: st.cost * incomeNow(g, i), brains: (st.brains ?? 0) * c.techScale };
}

export function megaError(g: GameState, i: number, id: string): string | null {
  const c = g.countries[i];
  const next = megaNext(g, i, id);
  if (!next) return 'Проект завершён';
  if (c.mega) return 'Уже идёт мегапроект';
  if (next.st.tech && !c.techs.includes(next.st.tech)) return `Нужна технология «${TECH_BY_ID[next.st.tech].name}»`;
  if (c.money < next.money) return 'Не хватает денег';
  if (c.brains < next.brains) return 'Не хватает 🧠';
  return null;
}

export function startMega(g: GameState, i: number, id: string): string | null {
  const err = megaError(g, i, id);
  if (err) return err;
  const c = g.countries[i];
  const next = megaNext(g, i, id)!;
  c.money -= next.money;
  c.brains -= next.brains;
  c.mega = { id, stage: next.stage, left: next.st.days, total: next.st.days, money: next.money };
  c.aiFlags.saveMega = undefined;
  const race = id === 'space' ? RACE[next.stage] : undefined;
  if (i === g.player) {
    sfx('build');
    log(g, `${MEGA_BY_ID[id].icon} Начат мегапроект: ${MEGA_BY_ID[id].name} — «${next.st.name}»`, 'good');
  } else if (race && g.firsts?.[race.key] === undefined) {
    news(g, `${race.icon} ${cname(g, i)} начинает программу «${next.st.name}» — космическая гонка!`, 'info');
    if (g.countries[g.player].mega?.id === 'space' && g.countries[g.player].mega!.stage === next.stage) {
      log(g, `🚀 ${cname(g, i)} тоже летит: «${next.st.name}». Кто первый?`, 'bad');
    }
  }
  return null;
}

/** Отмена этапа: возвращается половина денег. */
export function cancelMega(g: GameState, i: number) {
  const c = g.countries[i];
  if (!c.mega) return;
  c.money += c.mega.money * 0.5;
  c.mega = undefined;
}

function finishMega(g: GameState, i: number) {
  const c = g.countries[i];
  const m = c.mega!;
  const def = MEGA_BY_ID[m.id];
  c.mega = undefined;
  (c.megas ??= {})[m.id] = m.stage;
  const st = def.stages[m.stage - 1];
  def.onDone?.(g, i, m.stage);
  fx({ kind: 'float', tile: REGIONS[c.capital].center, text: def.icon });
  const race = m.id === 'space' ? RACE[m.stage] : undefined;
  const first = race && (g.firsts ??= {})[race.key] === undefined;
  if (race && first) {
    g.firsts![race.key] = i;
    c.mods.push({ kind: 'stab', value: 6, until: g.day + 730, label: `Мы ${race.ours}` });
    g.countries.forEach((o, j) => { if (o.alive && j !== i && !atWar(g, i, j)) addRel(g, i, j, 6); });
  }
  if (i === g.player) {
    g.counters.megas = (g.counters.megas ?? 0) + 1;
    sfx('wonder');
    log(g, `${def.icon} Мегапроект «${def.name}»: готов этап «${st.name}»`, 'good', false);
    banner(first && race
      ? { icon: race.icon, title: 'Космическая гонка выиграна!', text: `Мы ${race.ours}`, kind: 'gold' }
      : { icon: def.icon, title: 'Мегапроект', text: `${def.name}: ${st.name}`, kind: 'gold' });
  } else if (first && race) {
    news(g, `${race.icon} ${cname(g, i)} ${vb(i, 'первым', 'первой', 'первыми')} в мире ${vb(i, race.act)} ${race.rest}!`, 'info');
    if (megaStages(g.countries[g.player], 'space') >= m.stage - 1 && g.countries[g.player].mega?.id === 'space') {
      log(g, `😞 ${cname(g, i)} ${vb(i, 'опередил')} нас в космической гонке`, 'bad');
    }
  } else if (race) news(g, `${race.icon} ${cname(g, i)} тоже ${vb(i, race.act)} ${race.rest}`, 'info');
}

/** Ход мегапроектов (раз в день). */
export function tickMegas(g: GameState) {
  g.countries.forEach((c, i) => {
    if (!c.alive || !c.mega) return;
    // в войну стройка идёт вдвое медленнее
    c.mega.left -= enemiesOf(g, i).length ? 0.5 : 1;
    if (c.mega.left <= 0) finishMega(g, i);
  });
  // программы развития: закончились — получатель помнит добро ещё два года
  if (g.aid?.length) g.aid = g.aid.filter((a) => a.until + AID_MEMORY > g.day && g.countries[a.to].alive && g.countries[a.from].alive);
}

// ---------- программы развития ----------
export const AID_DAYS = 365;
export const AID_MEMORY = 730; // столько дней после программы получатель голосует в ООН заодно с донором
export const AID_MAX = 3;
export const AID_NOT_POOR = 'Страна не беднее нас — помощь ей не нужна';
export const aidCost = (g: GameState, from: number) => incomeNow(g, from) * 60;
export const activeAid = (g: GameState, from: number) => (g.aid ?? []).filter((a) => a.from === from && a.until > g.day);
/** Помнит ли страна k помощь от donor (идёт программа или прошло меньше двух лет). */
export const aidLoyal = (g: GameState, k: number, donor: number) => (g.aid ?? []).some((a) => a.to === k && a.from === donor && a.until + AID_MEMORY > g.day);
/** Кому помогают сейчас: страна → доноры. */
export const aidDonors = (g: GameState, k: number) => (g.aid ?? []).filter((a) => a.to === k && a.until > g.day).map((a) => a.from);

export function aidError(g: GameState, from: number, to: number): string | null {
  if (from === to || !g.countries[to].alive) return 'Некому помогать';
  if (atWar(g, from, to)) return 'Мы воюем';
  if ((g.aid ?? []).some((a) => a.from === from && a.to === to && a.until > g.day)) return 'Программа уже идёт';
  if (activeAid(g, from).length >= AID_MAX) return `Не больше ${AID_MAX} программ одновременно`;
  if (STATS[to].prod > STATS[from].prod * 0.85 && g.countries[to].stability >= 40 && STATS[to].hunger <= 0) return AID_NOT_POOR;
  if (g.countries[from].money < aidCost(g, from)) return 'Не хватает денег';
  return null;
}

/** Год помогать бедной стране: ей — деньги, рост и спокойствие, нам — дружба и голоса в ООН. */
export function startAid(g: GameState, from: number, to: number): string | null {
  const err = aidError(g, from, to);
  if (err) return err;
  const cost = aidCost(g, from);
  g.countries[from].money -= cost;
  g.countries[to].money += cost * 0.4;
  const t = g.countries[to];
  t.mods.push({ kind: 'prod', value: 0.06, until: g.day + AID_DAYS, label: `Программа развития: ${cname(g, from)}` });
  t.mods.push({ kind: 'stab', value: 3, until: g.day + AID_DAYS, label: `Программа развития: ${cname(g, from)}` });
  addRel(g, from, to, 22);
  (g.aid ??= []).push({ id: g.nextId++, from, to, since: g.day, until: g.day + AID_DAYS, money: cost });
  if (from === g.player) {
    sfx('coins');
    g.counters.aid = (g.counters.aid ?? 0) + 1;
    log(g, `🤲 Программа развития в стране ${cname(g, to)}: школы, дороги, больницы. Отношения +22, в ООН она будет голосовать заодно с нами`, 'good');
  } else if (to === g.player) {
    log(g, `🤲 ${cname(g, from)} начинает у нас программу развития: +${fmt(cost * 0.4)} 💰, производительность +6% на год`, 'good');
  } else if (rand(g) < 0.35) news(g, `🤲 ${cname(g, from)} вкладывается в развитие страны ${cname(g, to)}`, 'info');
  computeAll(g);
  return null;
}

// ---------- боты ----------
/** Бот с лишними деньгами строит мегапроекты и покупает влияние программами развития. */
export function botMegas(g: GameState, i: number) {
  const c = g.countries[i];
  if (enemiesOf(g, i).length || STATS[i].moneyRate < 0) return;
  if (!c.mega && !c.project && rand(g) < 0.35) {
    let best: string | null = null, bestScore = 0;
    for (const m of MEGAS) {
      const err = megaError(g, i, m.id);
      if (err && err !== 'Не хватает денег') continue;
      const next = megaNext(g, i, m.id)!;
      if (c.brains < next.brains) continue;
      let sc = (m.pref.includes(c.personality) ? 2 : 1) * (0.5 + rand(g));
      if (m.id === 'coast' && (g.climate?.temp ?? 1.3) > 1.9) sc *= 1.8;
      if (m.id === 'energy' && STATS[i].oilNeed > STATS[i].oilProd * 1.5) sc *= 1.6;
      if (m.id === 'health' && STATS[i].pensionCost > STATS[i].taxIncome * 0.05) sc *= 1.6;
      if (m.id === 'space') sc *= next.stage >= 2 ? 2.2 : 1.3; // гонка за славой
      if (m.id === 'agro' && (STATS[i].hunger > 0 || STATS[i].foodProd < STATS[i].foodCons)) sc *= 1.8;
      if (m.id === 'water' && STATS[i].popCap > 0 && STATS[i].civPop / STATS[i].popCap > 0.85) sc *= 1.5;
      if (m.id === 'atom' && STATS[i].oilNeed > STATS[i].oilProd * 1.5) sc *= 1.4;
      if (m.id === 'culture' && c.stability < 50) sc *= 1.6;
      if (m.id === 'shield' && isNuclear(g, i)) sc *= 0.7; // своя бомба и так пугает соседей
      if (sc > bestScore) { bestScore = sc; best = m.id; }
    }
    if (best) {
      // хватает с запасом — строим, иначе копим: полгода меньше тратим на стройку и чудеса
      if (c.money >= megaNext(g, i, best)!.money * 1.6) startMega(g, i, best);
      else if (g.day > (c.aiFlags.saveMega ?? -999) + 200) c.aiFlags.saveMega = g.day + 180;
    }
  }
  // влияние: торговцы, учёные, осторожные и великие державы помогают бедным друзьям
  const generous = c.personality !== 'aggressor' || c.money > aidCost(g, i) * 12;
  if (generous && c.money > aidCost(g, i) * 5 && rand(g) < 0.06) {
    const cands = g.countries.filter((o) => o.alive && o.idx !== i && g.rel[i][o.idx] > -10 && !aidError(g, i, o.idx)).map((o) => o.idx);
    if (cands.length) {
      const to = cands.reduce((a, b) => (g.rel[i][b] - STATS[b].prod * 10 > g.rel[i][a] - STATS[a].prod * 10 ? b : a), pick(g, cands));
      startAid(g, i, to);
    }
  }
}
