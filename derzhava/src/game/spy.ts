// Разведка. У каждой страны — сети агентов в чужих странах (0…100): растут, когда внедряешь агентов, и тают сами и
// под чужой контрразведкой. С сетью можно проводить операции: досье, кража технологий, диверсия, переманить учёного,
// поддержать оппозицию, подкупить генерала. Шанс — от сети и контрразведки цели; провал — агентов ловят, сеть
// разгромлена, отношения портятся. Контрразведка стоит долю налогов, ловит чужих агентов и видит их сети у нас.
// Боты шпионят друг за другом и за игроком.
import { addRel, cname, enemiesOf, pair } from './actions';
import { BUILDINGS, INTEL_COST, TECH_BY_ID } from './defs';
import { computeAll, STATS } from './economy';
import { fmt } from './format';
import { allBuildings, fx, log, mapDirty, news, pick, rand, removeBuilding, ruinTile, sfx } from './state';
import type { BuildingType, GameState, IntelState, Personality } from './types';
import { COUNTRY_DEFS, REGIONS, REGION_OF } from './world';

export const INTEL_LEVELS = ['Нет', 'Слабая', 'Средняя', 'Сильная'];
export { INTEL_COST };
const INTEL_POWER = [0.1, 0.3, 0.5, 0.7];
/** Контрразведка ботов по характеру. */
const BOT_INTEL: Record<Personality, number> = { cautious: 3, aggressor: 2, fanatic: 2, scientist: 1, trader: 1 };
const PLANT = 20; // на сколько вырастает сеть за одно внедрение
const PLANT_GAP = 20; // игрок внедряет агентов в одну страну не чаще

export function initIntel(g: GameState): IntelState {
  const n = g.countries.length;
  return { net: Array.from({ length: n }, () => new Array(n).fill(0)), watch: {}, cd: {} };
}

/** Сила контрразведки: 0…0.9. Диктатура следит за всеми, демократия — мягче. */
export function counterOf(g: GameState, i: number) {
  const c = g.countries[i];
  const lvl = c.counterIntel ?? BOT_INTEL[c.personality];
  return Math.min(0.9, INTEL_POWER[lvl] + (c.gov === 'dictatorship' ? 0.1 : c.gov === 'democracy' ? -0.05 : 0));
}
export const netOf = (g: GameState, a: number, b: number) => g.intel.net[a]?.[b] ?? 0;
/** Досье игрока на страну ещё действует. */
export const watched = (g: GameState, b: number) => (g.intel.watch[b] ?? 0) > g.day;
const scale = (g: GameState, a: number) => Math.max(30, g.countries[a].moneyScale);

// ---------- агенты ----------
export const plantCost = (g: GameState, a: number, b: number) => scale(g, a) * 15 * (1 + netOf(g, a, b) / 50);
export function plantError(g: GameState, a: number, b: number): string | null {
  if (a === b || !g.countries[b].alive) return 'Недопустимая цель';
  if (netOf(g, a, b) >= 99) return 'Сеть и так самая крепкая';
  if (a === g.player && (g.intel.cd[`plant${b}`] ?? 0) > g.day) return `Новых агентов можно отправить через ${Math.ceil(g.intel.cd[`plant${b}`] - g.day)} дн.`;
  if (g.countries[a].money < plantCost(g, a, b)) return 'Не хватает денег';
  return null;
}

/** Внедрить агентов: сеть растёт, но чужая контрразведка может схватить их на границе. */
export function plant(g: GameState, a: number, b: number): string | null {
  const err = plantError(g, a, b);
  if (err) return err;
  g.countries[a].money -= plantCost(g, a, b);
  if (a === g.player) g.intel.cd[`plant${b}`] = g.day + PLANT_GAP;
  if (rand(g) < counterOf(g, b) * 0.25) {
    addRel(g, a, b, -10);
    if (a === g.player) log(g, `🕵️ Наших агентов задержали на границе страны ${cname(g, b)} (отношения −10)`, 'bad');
    else if (b === g.player) log(g, `🕵️ Пограничники задержали агентов страны ${cname(g, a)}`, 'good');
    return null;
  }
  g.intel.net[a][b] = Math.min(100, netOf(g, a, b) + PLANT);
  if (a === g.player) {
    sfx('paper');
    log(g, `🕵️ Агенты внедрены в стране ${cname(g, b)}: сеть ${Math.round(netOf(g, a, b))}%`, 'good', false);
  }
  return null;
}

// ---------- операции ----------
export interface SpyOp {
  id: string;
  icon: string;
  name: string;
  desc: string;
  need: number; // нужная сеть
  days: number; // цена в днях дохода (мерило — доход в начале партии)
  base: number; // базовый шанс
  cd: number; // игрок повторяет операцию не чаще
  heavy?: boolean; // если поймают — обида сильнее
  can?: (g: GameState, a: number, b: number) => string | null;
  /** Успех: что вышло (для журнала того, кто заказал). */
  run: (g: GameState, a: number, b: number) => string;
  /** Что увидит жертва. */
  harm: string;
}

/** Технология, которую можно украсть: у цели есть, у нас нет, и её предшественница у нас изучена. */
function stealable(g: GameState, a: number, b: number) {
  const mine = g.countries[a].techs;
  return g.countries[b].techs.filter((id) => !mine.includes(id) && (!TECH_BY_ID[id]?.req || mine.includes(TECH_BY_ID[id].req!)));
}
const SAB_TYPES: BuildingType[] = ['factory', 'port', 'university', 'barracks'];
function sabTargets(g: GameState, b: number) {
  const out: number[] = [];
  const { tiles, list } = allBuildings(g);
  for (let k = 0; k < tiles.length; k++) {
    const bl = list[k];
    if (bl.progress > 0 || !SAB_TYPES.includes(bl.type)) continue;
    if (g.regions[REGION_OF[tiles[k]]].owner === b) out.push(tiles[k]);
  }
  return out;
}

/** Подробность последней операции — чтобы жертва узнала, что именно взорвали. */
let detail = '';

export const SPY_OPS: SpyOp[] = [
  { id: 'dossier', icon: '🔍', name: 'Досье', need: 10, days: 10, base: 0.85, cd: 60,
    desc: 'Год видим всё: казну, боеголовки, масонство, их сеть агентов у нас и кредитный рейтинг',
    harm: 'кто-то копался в секретных архивах правительства',
    run: (g, a, b) => {
      if (a === g.player) g.intel.watch[b] = g.day + 365;
      return `Досье на страну ${cname(g, b)} собрано — подробности в её карточке`;
    } },
  { id: 'tech', icon: '💾', name: 'Кража технологий', need: 30, days: 30, base: 0.5, cd: 120,
    desc: 'Украсть технологию, которой у нас нет (или чертежи — 🧠)',
    harm: 'из секретной лаборатории пропали чертежи',
    run: (g, a, b) => {
      const list = stealable(g, a, b);
      if (list.length) {
        const id = pick(g, list);
        g.countries[a].techs.push(id);
        g.counters.techs = (g.counters.techs ?? 0) + (a === g.player ? 1 : 0);
        return `Украдена технология «${TECH_BY_ID[id].name}» у страны ${cname(g, b)}`;
      }
      const v = Math.max(5, STATS[b].brainsRate) * 120;
      g.countries[a].brains += v;
      return `Украдены чертежи у страны ${cname(g, b)}: +${fmt(v)} 🧠`;
    } },
  { id: 'sabotage', icon: '💥', name: 'Диверсия', need: 40, days: 40, base: 0.45, cd: 150, heavy: true,
    desc: 'Взорвать завод, порт, университет или казарму и сжечь часть арсенала',
    can: (g, _a, b) => (sabTargets(g, b).length ? null : 'Там нечего взрывать'),
    harm: 'взрыв на объекте',
    run: (g, _a, b) => {
      const tile = pick(g, sabTargets(g, b));
      const bl = g.buildings[tile];
      // у комплекса взрывают один корпус, одиночное здание теряет уровень или рушится
      const wing = bl.tiles?.length ? pick(g, bl.tiles) : -1;
      const broken = wing < 0 && bl.level <= 1;
      if (wing >= 0) ruinTile(g, wing);
      else if (broken) removeBuilding(g, tile);
      else bl.level--;
      g.countries[b].arms *= 0.9;
      mapDirty.buildings = true;
      fx({ kind: 'flash', tile: wing >= 0 ? wing : tile, color: 0xff6a3d });
      detail = `здание «${BUILDINGS[bl.type].name}» в регионе ${REGIONS[REGION_OF[tile]].name} ${wing >= 0 ? 'лишилось корпуса' : broken ? 'разрушено до основания' : 'повреждено'}`;
      return `Диверсия удалась (страна ${cname(g, b)}): ${detail}, арсенал −10%`;
    } },
  { id: 'scientist', icon: '🧑‍🔬', name: 'Переманить учёного', need: 30, days: 30, base: 0.5, cd: 150,
    desc: 'Звезда науки (если есть) или каждый десятый учёный переезжает к нам',
    harm: 'учёные тайно уехали за границу',
    run: (g, a, b) => {
      const star = g.geniuses.find((x) => x.employer === b);
      if (star) {
        star.employer = a;
        return `Звезда науки ${star.name} переехала к нам из страны ${cname(g, b)}`;
      }
      const n = g.countries[b].scientists * 0.1;
      g.countries[b].scientists -= n;
      g.countries[a].scientists += n;
      return `Из страны ${cname(g, b)} к нам переехали ${fmt(n)} учёных`;
    } },
  { id: 'opposition', icon: '📢', name: 'Поддержать оппозицию', need: 50, days: 50, base: 0.45, cd: 180, heavy: true,
    desc: 'Деньги и газеты для протестов: стабильность там −10, а на ближайших выборах вероятнее победит оппозиция',
    harm: 'протесты, оплаченные из-за рубежа',
    run: (g, _a, b) => {
      const c = g.countries[b];
      c.mods.push({ kind: 'stab', value: -10, until: g.day + 180, label: 'Протесты, оплаченные из-за рубежа' });
      c.unrest += 2;
      c.aiFlags.voteBias = (c.aiFlags.voteBias ?? 0) - 12;
      if (b === g.player) g.elections.approval = Math.max(0, g.elections.approval - 8);
      return `В стране ${cname(g, b)} на наши деньги идут протесты: стабильность −10, оппозиция окрепла`;
    } },
  { id: 'general', icon: '🎖️', name: 'Подкупить генерала', need: 60, days: 70, base: 0.35, cd: 240, heavy: true,
    desc: 'Генерал саботирует приказы: армия цели −6%, усталость от войны +15',
    harm: 'генерал-предатель саботировал приказы',
    run: (g, _a, b) => {
      const c = g.countries[b];
      c.soldiers *= 0.94;
      c.weariness = Math.min(100, c.weariness + 15);
      return `Генерал страны ${cname(g, b)} куплен: её армия −6%, усталость от войны +15`;
    } },
];
export const SPY_BY_ID = Object.fromEntries(SPY_OPS.map((o) => [o.id, o])) as Record<string, SpyOp>;

export const spyCost = (g: GameState, a: number, op: SpyOp) => scale(g, a) * op.days;
/** Шанс успеха: сеть помогает, контрразведка цели мешает. */
export const spyChance = (g: GameState, a: number, b: number, op: SpyOp) =>
  Math.max(0.05, Math.min(0.95, op.base + netOf(g, a, b) / 250 - counterOf(g, b) * 0.45));

export function spyError(g: GameState, a: number, b: number, id: string): string | null {
  const op = SPY_BY_ID[id];
  if (!op) return 'Нет такой операции';
  if (a === b || !g.countries[b]?.alive) return 'Недопустимая цель';
  if (netOf(g, a, b) < op.need) return `Нужна сеть агентов ${op.need}%`;
  if (a === g.player && (g.intel.cd[id] ?? 0) > g.day) return `Снова можно через ${Math.ceil(g.intel.cd[id] - g.day)} дн.`;
  if (g.countries[a].money < spyCost(g, a, op)) return 'Не хватает денег';
  return op.can?.(g, a, b) ?? null;
}

export function spyRun(g: GameState, a: number, b: number, id: string): string | null {
  const err = spyError(g, a, b, id);
  if (err) return err;
  const op = SPY_BY_ID[id];
  const me = g.player;
  g.countries[a].money -= spyCost(g, a, op);
  if (a === me) g.intel.cd[id] = g.day + op.cd;
  const A = cname(g, a), B = cname(g, b);
  if (rand(g) < spyChance(g, a, b, op)) {
    detail = '';
    const text = op.run(g, a, b);
    // даже удачную операцию контрразведка может отследить
    const traced = rand(g) < counterOf(g, b) * 0.35;
    if (traced) addRel(g, a, b, op.heavy ? -15 : -8);
    if (a === me) {
      g.counters.spyWins = (g.counters.spyWins ?? 0) + 1;
      sfx('research');
      log(g, `🕵️ ${op.icon} ${text}${traced ? ` — но контрразведка страны ${B} вышла на наш след` : ''}`, 'good');
    } else if (b === me && (op.id !== 'dossier' || traced)) {
      // тихое досье на нас так и останется тайной
      sfx('alarm');
      log(g, `🕵️ ${op.icon} ${capital(op.harm)}${detail ? `: ${detail}` : ''} — ${traced ? `следы ведут в страну ${A}` : 'заказчик неизвестен'}`, 'bad');
    } else if (op.id === 'sabotage' && rand(g) < 0.5) news(g, `💥 Взрыв на объекте в стране ${B}${traced ? ` — подозревают агентов страны ${A}` : ''}`, 'bad');
    computeAll(g);
    return null;
  }
  // провал: агентов поймали
  g.intel.net[a][b] *= 0.35;
  addRel(g, a, b, op.heavy ? -25 : -15);
  const p = pair(g, a, b);
  p.grudge = Math.max(p.grudge ?? 0, op.heavy ? 20 : 10);
  if (a === me) {
    sfx('alarm');
    log(g, `🕵️ Провал: наших агентов поймали в стране ${B} («${op.name}»). Сеть разгромлена, отношения −${op.heavy ? 25 : 15}`, 'bad');
  } else if (b === me) {
    sfx('notify');
    g.counters.spiesCaught = (g.counters.spiesCaught ?? 0) + 1;
    log(g, `🕵️ Контрразведка поймала агентов страны ${A}: готовили «${op.name}»`, 'good');
  } else if (rand(g) < 0.15) news(g, `🕵️ В стране ${B} разоблачена шпионская сеть страны ${A}`, 'info');
  return null;
}
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---------- контрразведка ----------
export function setCounterIntel(g: GameState, i: number, lvl: number) {
  g.countries[i].counterIntel = Math.max(0, Math.min(3, lvl));
  computeAll(g);
}

/** Чужие сети в стране b, которые видит её контрразведка (слабая — ничего, средняя — крупные, сильная — почти все). */
export function detected(g: GameState, b: number): { a: number; net: number }[] {
  const lvl = g.countries[b].counterIntel ?? 0;
  if (lvl < 2) return [];
  const min = lvl >= 3 ? 8 : 25;
  return g.countries.map((c, a) => ({ a, net: netOf(g, a, b), alive: c.alive }))
    .filter((x) => x.a !== b && x.alive && x.net >= min).sort((x, y) => y.net - x.net).map(({ a, net }) => ({ a, net }));
}

export const sweepCost = (g: GameState) => scale(g, g.player) * 40;
export const SWEEP_GAP = 180;
export function sweepError(g: GameState): string | null {
  const wait = (g.intel.sweep ?? -999) + SWEEP_GAP - g.day;
  if (wait > 0) return `Снова можно через ${Math.ceil(wait)} дн.`;
  if (g.countries[g.player].money < sweepCost(g)) return 'Не хватает денег';
  return null;
}
/** Зачистка: чужие сети в нашей стране разгромлены, самых наглых — высылаем. */
export function sweep(g: GameState): string | null {
  const err = sweepError(g);
  if (err) return err;
  const me = g.player;
  g.countries[me].money -= sweepCost(g);
  g.intel.sweep = g.day;
  const caught: string[] = [];
  g.countries.forEach((c, a) => {
    if (!c.alive || a === me) return;
    const v = netOf(g, a, me);
    if (v >= 30) {
      caught.push(cname(g, a));
      addRel(g, me, a, -5);
    }
    g.intel.net[a][me] = v * 0.4;
  });
  sfx('notify');
  log(g, `🕵️ 🧹 Зачистка: сети чужих агентов разгромлены${caught.length ? `, высланы дипломаты: ${caught.join(', ')}` : ''}`, 'good');
  return null;
}

// ---------- день ----------
export function tickSpy(g: GameState) {
  const n = g.countries.length;
  const counter = g.countries.map((_, b) => counterOf(g, b));
  for (let a = 0; a < n; a++) {
    const row = g.intel.net[a];
    for (let b = 0; b < n; b++) {
      if (row[b] > 0) row[b] = Math.max(0, row[b] * 0.9993 - counter[b] * 0.03);
    }
  }
}

// ---------- боты ----------
const FAVOR: Record<Personality, string[]> = {
  aggressor: ['sabotage', 'general', 'tech'],
  scientist: ['tech', 'scientist', 'opposition'],
  trader: ['tech', 'scientist', 'sabotage'],
  fanatic: ['opposition', 'sabotage', 'tech'],
  cautious: ['tech', 'opposition', 'scientist'],
};
const BOT_GAP = { easy: 120, normal: 80, hard: 55 };

/** Бот раз в несколько месяцев шпионит: за врагом, за тем, на кого готовит нападение, за недругом или за лидером науки. */
export function botSpy(g: GameState, i: number) {
  const c = g.countries[i];
  c.counterIntel ??= BOT_INTEL[c.personality];
  if (g.day < 200 || g.day - (c.aiFlags.lastSpy ?? 0) < BOT_GAP[g.difficulty] + ((i * 13) % 40)) return;
  c.aiFlags.lastSpy = g.day;
  if (c.money < STATS[i].taxIncome * 40) return;
  const enemies = enemiesOf(g, i);
  let t = enemies.length ? pick(g, enemies) : c.aiFlags.prepTarget ?? -1;
  if (t < 0) {
    const foes = g.countries.filter((o) => o.alive && o.idx !== i && g.rel[i][o.idx] < -15).map((o) => o.idx);
    if (foes.length) t = pick(g, foes);
    else if (c.personality === 'scientist' || c.personality === 'trader') {
      const lead = g.countries.filter((o) => o.alive && o.idx !== i && stealable(g, i, o.idx).length).map((o) => o.idx);
      if (lead.length) t = pick(g, lead);
    }
  }
  if (t < 0) return;
  const wants = FAVOR[c.personality].map((id) => SPY_BY_ID[id]).filter((op) => !op.can || !op.can(g, i, t));
  const op = wants.find((o) => netOf(g, i, t) >= o.need);
  // главная операция ещё недоступна — сначала сеть
  if (!op || (op !== wants[0] && rand(g) < 0.6)) {
    if (!plantError(g, i, t)) plant(g, i, t);
    return;
  }
  if (!spyError(g, i, t, op.id)) spyRun(g, i, t, op.id);
}

/** Сколько игрок знает о стране благодаря досье. */
export function dossier(g: GameState, b: number): [string, string][] {
  const c = g.countries[b];
  const out: [string, string][] = [
    ['💰 Казна', fmt(c.money)],
    ['☢️ Боеголовок', c.hbombs ? `${c.nukes ?? 0} + 💥${c.hbombs} термоядерных` : String(c.nukes ?? 0)],
    ['🧑‍🔬 Звёзд науки', String(g.geniuses.filter((x) => x.employer === b).length)],
    ['🛡️ Контрразведка', INTEL_LEVELS[c.counterIntel ?? BOT_INTEL[c.personality]]],
    ['🕵️ Их сеть у нас', `${Math.round(netOf(g, b, g.player))}%`],
    ['👁️ Тайная ложа', g.lodge.members.includes(b) ? 'масон' : 'нет'],
  ];
  if (c.aiFlags.prepTarget !== undefined) out.push(['🪖 Готовит войну', COUNTRY_DEFS[c.aiFlags.prepTarget].name]);
  return out;
}
