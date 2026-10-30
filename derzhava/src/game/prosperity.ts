// Цена процветания: богатство и спокойствие в поздней игре не бесплатны.
// • Ожидания народа: привыкнув к хорошей жизни, люди хотят большего — стабильность сама не держится на 100%.
//   Сбить ожидания можно народными программами (дорого) и культурой.
// • Старение: долгая жизнь и низкая рождаемость — больше пенсионеров: пенсии съедают налоги, рабочих рук меньше.
//   Помогают рождаемость, миграция, пенсионная реформа (народ злится) и медицина омоложения.
// • Роботы и ИИ: каждая технология автоматизации отнимает работу — без переобучения или базового дохода растёт недовольство.
// • Климат: выбросы всех стран греют планету — урожай падает, побережья топит, стихийные бедствия всё чаще,
//   а избиратели требуют зелёного курса.
import { cname, enemiesOf } from './actions';
import { EXPECT_MAX, GREEN_LEVELS, PENSION_AGE, SAFETY_LEVELS } from './defs';
import { computeAll, STATS } from './economy';
import { fmt } from './format';
import { initResources } from './resources';
import { banner, log, news, pick, rand, sfx } from './state';
import type { CountryStats } from './economy';
import type { GameState, TempMod } from './types';
import { COUNTRY_DEFS, REGIONS } from './world';

/** Потепление за год, °C, при выбросах как в начале партии. Время в игре сжато — климат меняется заметнее, чем в жизни. */
export const WARMING = 0.07;
/** Насколько стране вредит жара: жаркие и бедные — сильнее, северные — слабее. */
export const VULN: Record<string, number> = {
  in: 1.6, pk: 1.6, eg: 1.5, ng: 1.5, sa: 1.4, dz: 1.4, ir: 1.3, id: 1.3, mx: 1.2, au: 1.2, br: 1.1, za: 1.1, tr: 1.1, es: 1.1,
  it: 1, cn: 1, us: 1, fr: 0.9, ar: 0.9, jp: 0.9, ua: 0.8, de: 0.8, kz: 0.8, gb: 0.7, ru: 0.5, ca: 0.4,
};
export const vuln = (i: number) => VULN[COUNTRY_DEFS[i]?.id] ?? 1;
const free = (g: GameState, i: number) => g.countries[i].gov === 'democracy' || g.countries[i].gov === 'republic';
function mod(g: GameState, i: number, kind: TempMod['kind'], value: number, days: number, label: string) {
  g.countries[i].mods.push({ kind, value, until: g.day + days, label });
}
const gross = (s: CountryStats) => s.taxIncome + s.factoryIncome + s.portIncome + s.tradeIncome + s.corpIncome + s.investIncome;
/** Доход страны в день — мерило цен программ и проектов поздней игры (растёт вместе с экономикой). */
export const incomeNow = (g: GameState, i: number) => Math.max(30, g.countries[i].moneyScale, gross(STATS[i]));

// ---------- начало эпохи ----------
/** Доля пожилых в начале партии: у богатых и стареющих стран выше. */
export function agingStart(i: number): number {
  const d = COUNTRY_DEFS[i];
  return Math.max(0.04, Math.min(0.3, 0.16 - 0.055 * d.growth + 0.04 * Math.log10(d.gdp / 10)));
}

/** Поля поздней игры: в новой партии — с первого пересчёта, в старом сохранении — с момента загрузки. */
export function initLate(g: GameState, stats: CountryStats[]) {
  g.countries.forEach((c, i) => {
    c.gdp0 ??= Math.max(1, stats[i].gdpIndex);
    c.aging ??= agingStart(i);
    c.expect ??= 0;
  });
  if (!g.climate) {
    let e0 = 0;
    g.countries.forEach((c) => { if (c.alive) e0 += Math.pow(Math.max(1, c.gdp0 ?? 1), 0.85); });
    g.climate = { temp: 1.3 + 0.03 * (g.day / 365), e0: Math.max(1, e0), emis: 1, nextDisaster: g.day + 500 + Math.floor(rand(g) * 400) };
  }
  if (!g.res) initResources(g, stats);
  g.crises ??= { next: g.day + 700 + Math.floor(rand(g) * 300), active: [] };
  g.aid ??= [];
  g.firsts ??= {};
}

// ---------- формулы (их же показывает интерфейс) ----------
/** К какой доле пожилых страна идёт: медицина и долгая жизнь — выше, рождаемость и мигранты — ниже. */
export function agingTarget(g: GameState, i: number): number {
  const c = g.countries[i];
  const s = STATS[i];
  const longLife = ['telemed', 'gene_therapy', 'longevity'].filter((t) => c.techs.includes(t)).length;
  return Math.max(0.03, Math.min(0.42, 0.13 + 0.035 * c.budget.health + 0.03 * longLife - 0.05 * s.growthYear));
}
/** Доля пожилых сверх обычной — она и ложится на бюджет (с учётом омоложения). */
export const elderly = (c: GameState['countries'][number], agingMod: number) => Math.max(0, (c.aging ?? 0) - PENSION_AGE) * agingMod;
/** На сколько роботы и ИИ отнимают стабильность (без учёта защиты). */
export const autoPenalty = (auto: number, edu: number) => auto * 1.6 * (1 - 0.08 * edu);
/** Тревога за климат: в свободных странах громче, зелёный курс её успокаивает. */
export function climateFear(g: GameState, i: number): number {
  const t = g.climate?.temp ?? 1.3;
  if (t <= 1.6) return 0;
  return (t - 1.6) * 4 * (free(g, i) ? 1 : 0.4) * (1 - 0.45 * (g.countries[i].green ?? 0));
}
/** Насколько потепление режет урожай страны (0…1). */
export function climateFoodLoss(g: GameState, i: number, climateMod: number) {
  const t = g.climate?.temp ?? 1.3;
  return Math.min(0.5, 0.08 * Math.max(0, t - 1.5) * vuln(i) * climateMod);
}

/** Сколько °C в год прибавляет планета сейчас (минус — остывает). */
export function warmingRate(g: GameState): number {
  const C = g.climate;
  if (!C) return 0;
  const geo = g.countries.filter((c) => c.alive && c.techs.includes('geoengineering')).length;
  return WARMING * C.emis - Math.min(0.12, 0.05 * geo);
}

// ---------- день ----------
const TEMP_MARKS = [1.5, 2, 2.5, 3];
const TEMP_TEXT: Record<number, string> = {
  1.5: 'Планета нагрелась на 1.5°C: учёные бьют тревогу, засухи и ураганы участились',
  2: 'Потепление достигло 2°C: урожаи падают, море наступает на побережья',
  2.5: 'Потепление 2.5°C: стихийные бедствия стали обычным делом, южные страны изнывают от жары',
  3: 'Потепление 3°C: мир на грани климатической катастрофы',
};

export function tickProsperity(g: GameState) {
  const C = g.climate;
  if (!C) return;
  // климат: выбросы всех стран греют планету, геоинженерия охлаждает
  let E = 0;
  g.countries.forEach((c, i) => { if (c.alive) E += STATS[i].emis; });
  C.emis = E;
  const before = C.temp;
  C.temp = Math.max(1.1, C.temp + warmingRate(g) / 365);
  for (const m of TEMP_MARKS) {
    if (before < m && C.temp >= m && !g.counters[`temp${m}`]) {
      g.counters[`temp${m}`] = 1;
      news(g, `🌡️ ${TEMP_TEXT[m]}`, 'bad');
      banner({ icon: '🌡️', title: `Потепление +${m}°C`, text: TEMP_TEXT[m], kind: 'war' });
    }
  }
  // ожидания народа и старение
  const era = Math.min(1, g.day / 900); // в первые годы люди ещё не избалованы
  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    const s = STATS[i];
    let e = c.expect ?? 0;
    if (c.stability > 55) e += 0.012 * ((c.stability - 55) / 45) * era * s.mods.expect;
    else e -= 0.02 * ((55 - c.stability) / 55);
    c.expect = Math.max(0, Math.min(EXPECT_MAX, e));
    const a = c.aging ?? agingStart(i);
    c.aging = a + (agingTarget(g, i) - a) * 0.0008;
  });
  if (g.day >= C.nextDisaster) disaster(g);
}

// ---------- стихийные бедствия ----------
interface DisasterDef { id: string; icon: string; name: string; coastal?: boolean; food?: boolean; text: string[] }
const DISASTERS: DisasterDef[] = [
  { id: 'storm', icon: '🌀', name: 'Ураган', coastal: true, text: [
    'Ураган небывалой силы обрушился на побережье: сорваны крыши, затоплены порты, оборваны провода.',
    'Тайфун пятой категории прошёл над городом {r}: ветер переворачивал машины, волны заливали улицы.',
  ] },
  { id: 'fire', icon: '🔥', name: 'Лесные пожары', text: [
    'Леса горят третью неделю: дым закрыл солнце над городами, пожарные не справляются.',
    'Огонь подступил к окраинам города {r}: жителей эвакуируют, небо оранжевое даже днём.',
  ] },
  { id: 'drought', icon: '☀️', name: 'Засуха', food: true, text: [
    'Жара за сорок градусов: реки пересохли, урожай гибнет на корню.',
    'Второй месяц ни капли дождя: под городом {r} пересохло водохранилище.',
  ] },
  { id: 'flood', icon: '🌊', name: 'Наводнение', text: [
    'Ливни не прекращаются неделю: реки вышли из берегов, затоплены поля и дороги.',
    'Вода поднялась до вторых этажей: город {r} передвигается на лодках.',
  ] },
];
const DIS_BY_ID = Object.fromEntries(DISASTERS.map((d) => [d.id, d])) as Record<string, DisasterDef>;

/** Защита от стихии (мегапроект, геоинженерия) смягчает удар. */
const shield = (i: number) => STATS[i]?.mods.climate ?? 1;

function disaster(g: GameState) {
  const C = g.climate!;
  const t = C.temp;
  C.nextDisaster = g.day + Math.round((360 + 360 * rand(g)) / Math.max(0.4, 0.5 + (t - 1.3) * 1.6));
  const cands = g.countries.filter((c) => c.alive && STATS[c.idx].regions.length).map((c) => c.idx);
  if (!cands.length) return;
  // кому достанется: жарким странам чаще; игроку — чуть чаще, чем каждому боту
  const w = cands.map((i) => vuln(i) * (i === g.player ? 1.5 : 1));
  let r = rand(g) * w.reduce((a, x) => a + x, 0);
  let ci = cands[0];
  for (let k = 0; k < cands.length; k++) {
    r -= w[k];
    if (r <= 0) { ci = cands[k]; break; }
  }
  const coastal = STATS[ci].regions.filter((rid) => REGIONS[rid].coastal);
  const d = pick(g, DISASTERS.filter((x) => !x.coastal || coastal.length));
  const pool = d.coastal ? coastal : STATS[ci].regions;
  const rid = pool.reduce((a, b) => (g.regions[b].pop > g.regions[a].pop && rand(g) < 0.6 ? b : a), pick(g, pool));
  const sev = Math.max(0.3, (0.6 + 0.4 * rand(g) + 0.3 * Math.max(0, t - 1.5)) * shield(ci));
  const text = pick(g, d.text).replace('{r}', REGIONS[rid].name);
  g.regions[rid].pop *= 1 - 0.004 * sev;
  if (ci === g.player && !g.event) {
    g.event = {
      id: d.id, kind: 'climate', title: d.name, icon: d.icon, text: `${text} Ущерб тем больше, чем сильнее нагрелась планета.`,
      vals: [sev, rid],
      options: [
        { label: 'Восстановить за счёт казны', hint: `−${fmt(repairCost(g, sev))} 💰, стабильность +1: власть помогла` },
        { label: 'Попросить помощи у мира', hint: helpHint(g) },
        { label: 'Пусть справляются сами', hint: `производительность −${Math.round(8 * sev)}% на 150 дн., стабильность −${Math.round(5 * sev)}` },
      ],
    };
    sfx('alarm');
    return;
  }
  hit(g, ci, d, sev, 120);
  if (ci === g.player) log(g, `${d.icon} ${d.name}: ${text}`, 'bad');
  else if (rand(g) < 0.6) news(g, `${d.icon} ${d.name} в стране ${cname(g, ci)}: ${REGIONS[rid].name} пострадал`, 'bad');
}

function hit(g: GameState, i: number, d: DisasterDef, sev: number, days: number) {
  mod(g, i, 'prod', -0.07 * sev, days, d.name);
  mod(g, i, 'stab', -4 * sev, days, d.name);
  if (d.food) mod(g, i, 'food', -0.12 * sev, days, d.name);
}
const repairCost = (g: GameState, sev: number) => incomeNow(g, g.player) * 40 * sev;
/** Друзья, которые пришлют помощь после бедствия. */
const helpers = (g: GameState) => g.countries.filter((c) => c.alive && c.idx !== g.player && g.rel[g.player][c.idx] > 30 && enemiesOf(g, c.idx).length === 0).map((c) => c.idx).slice(0, 5);
function helpHint(g: GameState) {
  const h = helpers(g);
  return h.length ? `друзья пришлют ≈ ${fmt(h.length * incomeNow(g, g.player) * 8)} 💰, стабильность −2, производительность −${4}% на 90 дн.` : 'друзей, готовых помочь, у нас нет — ущерб останется';
}

export function resolveDisaster(g: GameState, option: number) {
  const ev = g.event;
  if (!ev) return;
  g.event = null;
  const d = DIS_BY_ID[ev.id];
  const sev = ev.vals?.[0] ?? 1;
  const me = g.player;
  const c = g.countries[me];
  if (!d) return;
  if (option === 0) {
    c.money -= repairCost(g, sev);
    mod(g, me, 'prod', -0.02, 30, d.name);
    mod(g, me, 'stab', 1, 90, 'Власть помогла пострадавшим');
    if (d.food) mod(g, me, 'food', -0.04 * sev, 60, d.name);
  } else if (option === 1) {
    const h = helpers(g);
    let got = 0;
    for (const k of h) {
      const v = Math.min(g.countries[k].money * 0.05, incomeNow(g, me) * 8);
      if (v <= 0) continue;
      g.countries[k].money -= v;
      got += v;
    }
    c.money += got;
    mod(g, me, 'stab', -2, 90, 'Страна просит помощи');
    mod(g, me, 'prod', -0.04, 90, d.name);
    if (d.food) mod(g, me, 'food', -0.08 * sev, 90, d.name);
    if (got) log(g, `🤝 Друзья прислали помощь: +${fmt(got)} 💰`, 'good');
  } else hit(g, me, d, sev, 150);
  g.counters.disasters = (g.counters.disasters ?? 0) + 1;
  log(g, `${d.icon} ${d.name}: «${ev.options[option]?.label ?? ''}»`, 'info', false);
  computeAll(g);
}

// ---------- решения правителя ----------
export interface ProgramDef { id: string; icon: string; name: string; days: number; expect: number; desc: string; apply: (g: GameState, i: number) => void }
/** Народные программы: дорого, но ожидания народа опускаются, а людям становится лучше. */
export const PROGRAMS: ProgramDef[] = [
  { id: 'housing', icon: '🏘️', name: 'Жильё для молодых семей', days: 90, expect: 7, desc: 'ожидания −7, рост 👥 +0.3%/год на год',
    apply: (g, i) => mod(g, i, 'growth', 0.3, 365, 'Жильё для молодых') },
  { id: 'medicine', icon: '🩺', name: 'Медицина для всех', days: 90, expect: 7, desc: 'ожидания −7, стабильность +3 на год',
    apply: (g, i) => mod(g, i, 'stab', 3, 365, 'Медицина для всех') },
  { id: 'education', icon: '🎓', name: 'Бесплатные университеты', days: 90, expect: 7, desc: 'ожидания −7, учёных +15% на год',
    apply: (g, i) => mod(g, i, 'sci', 0.15, 365, 'Бесплатные университеты') },
  { id: 'parks', icon: '🎡', name: 'Парки, стадионы, праздники', days: 35, expect: 4, desc: 'ожидания −4, стабильность +2 на полгода',
    apply: (g, i) => mod(g, i, 'stab', 2, 180, 'Парки и праздники') },
];
export const PROGRAM_CD = 540;
export const programCost = (g: GameState, i: number, p: ProgramDef) => incomeNow(g, i) * p.days;
export const cdLeft = (g: GameState, i: number, key: string) => Math.max(0, Math.ceil((g.countries[i].cd?.[key] ?? 0) - g.day));

export function programError(g: GameState, i: number, id: string): string | null {
  const p = PROGRAMS.find((x) => x.id === id);
  if (!p) return 'Нет такой программы';
  const wait = cdLeft(g, i, id);
  if (wait) return `Снова можно через ${wait} дн.`;
  if (g.countries[i].money < programCost(g, i, p)) return 'Не хватает денег';
  return null;
}
export function startProgram(g: GameState, i: number, id: string): string | null {
  const err = programError(g, i, id);
  if (err) return err;
  const p = PROGRAMS.find((x) => x.id === id)!;
  const c = g.countries[i];
  c.money -= programCost(g, i, p);
  c.expect = Math.max(0, (c.expect ?? 0) - p.expect);
  (c.cd ??= {})[id] = g.day + PROGRAM_CD;
  p.apply(g, i);
  if (i === g.player) {
    sfx('build');
    g.counters.programs = (g.counters.programs ?? 0) + 1;
    log(g, `${p.icon} Народная программа «${p.name}»: ${p.desc}`, 'good');
  }
  computeAll(g);
  return null;
}

export const REFORM_CD = 1095;
export function reformError(g: GameState, i: number): string | null {
  const c = g.countries[i];
  if ((c.pensionReform ?? 0) >= 2) return 'Пенсионный возраст уже подняли дважды';
  const wait = cdLeft(g, i, 'reform');
  if (wait) return `Снова можно через ${wait} дн.`;
  return null;
}
/** Пенсионная реформа: пенсии −15% навсегда, но народ возмущён. */
export function pensionReform(g: GameState, i: number): string | null {
  const err = reformError(g, i);
  if (err) return err;
  const c = g.countries[i];
  c.pensionReform = (c.pensionReform ?? 0) + 1;
  (c.cd ??= {}).reform = g.day + REFORM_CD;
  c.expect = Math.min(EXPECT_MAX, (c.expect ?? 0) + 3);
  mod(g, i, 'stab', free(g, i) ? -10 : -6, 300, 'Пенсионная реформа');
  if (i === g.player) {
    sfx('alarm');
    log(g, '👴 Пенсионный возраст повышен: пенсии −15%, но люди возмущены', 'info');
    if (g.elections) g.elections.trust = Math.max(-30, (g.elections.trust ?? 0) - 6);
  } else if (rand(g) < 0.5) news(g, `👴 ${cname(g, i)}: пенсионная реформа, на улицах протесты`, 'info');
  computeAll(g);
  return null;
}

export function setGreen(g: GameState, i: number, v: number) {
  const c = g.countries[i];
  if ((c.green ?? 0) === v) return;
  c.green = v;
  if (i === g.player) log(g, `${GREEN_LEVELS[v].icon} Зелёный курс: ${GREEN_LEVELS[v].name}`, 'info');
  computeAll(g);
}
export function setSafety(g: GameState, i: number, v: number) {
  const c = g.countries[i];
  if ((c.safety ?? 0) === v) return;
  c.safety = v;
  if (i === g.player) log(g, `🤖 Защита от безработицы: ${SAFETY_LEVELS[v].name}`, 'info');
  computeAll(g);
}

// ---------- боты ----------
/** Бот справляется с ценой процветания: зелёный курс, защита от роботов, народные программы, пенсии. */
export function botProsperity(g: GameState, i: number) {
  const c = g.countries[i];
  const s = STATS[i];
  const t = g.climate?.temp ?? 1.3;
  const poor = s.moneyRate < 0 || c.money < incomeNow(g, i) * 30;
  // зелёный курс: учёные, торговцы и демократии — когда потепление стало заметным
  const greenFan = c.personality === 'scientist' || c.personality === 'trader' || c.gov === 'democracy';
  let wantGreen = t > 2.3 && greenFan ? 2 : t > 1.75 && (greenFan || c.personality === 'cautious') ? 1 : 0;
  if (poor) wantGreen = Math.min(wantGreen, (c.green ?? 0) - 1);
  if (wantGreen >= 0 && wantGreen !== (c.green ?? 0)) setGreen(g, i, Math.max(0, wantGreen));
  // защита от безработицы: когда роботы стали отнимать работу
  let wantSafety = s.mods.auto >= 4 && free(g, i) && !poor ? 2 : s.mods.auto >= 2 ? 1 : 0;
  if (poor) wantSafety = Math.min(wantSafety, (c.safety ?? 0) - 1);
  if (wantSafety >= 0 && wantSafety !== (c.safety ?? 0)) setSafety(g, i, Math.max(0, wantSafety));
  if (poor || enemiesOf(g, i).length) return;
  // народные программы, когда люди избалованы
  if ((c.expect ?? 0) > 9) {
    const p = PROGRAMS.filter((x) => !programError(g, i, x.id) && c.money > programCost(g, i, x) * 3);
    if (p.length && rand(g) < 0.3) startProgram(g, i, pick(g, p).id);
  }
  // пенсии душат бюджет — поднимаем возраст (демократии решаются реже)
  if (s.pensionCost > s.taxIncome * 0.08 && c.stability > 60 && !reformError(g, i) && rand(g) < (free(g, i) ? 0.05 : 0.15)) pensionReform(g, i);
}
