import { initAssembly } from './assembly';
import { ARMS_BASE, FOOD_BASE, PERSONALITY_KEYS } from './defs';
import { computeAll, STATS } from './economy';
import { BASE_RATE } from './debt';
import { initElections } from './elections';
import { initLodge } from './lodge';
import { newGood } from './market';
import { applyScenario } from './scenarios';
import { initSociety } from './society';
import { initIntel } from './spy';
import { log, rand } from './state';
import type { Country, Difficulty, GameState, Personality, Scenario } from './types';
import { COUNTRY_DEFS, REGIONS, continentFactor } from './world';

export const SAVE_VERSION = 1;

export function newGame(player: number, difficulty: Difficulty, seed = Date.now(), scenario: Scenario = 'classic'): GameState {
  const g: GameState = {
    version: SAVE_VERSION,
    day: 0,
    player,
    difficulty,
    countries: [],
    regions: [],
    buildings: {},
    rel: [],
    pairs: {},
    battles: [],
    rebels: [],
    missiles: [],
    fallout: {},
    un: [],
    lodge: null!, // ложа, ООН, выборы и разведка создаются ниже, когда известны страны
    assembly: null!,
    elections: null!,
    intel: null!,
    finance: { base: BASE_RATE, shock: 0, nextCrisis: 1800 + Math.floor((seed >>> 3) % 1200) },
    nextId: 1,
    log: [],
    proposals: [],
    event: null,
    nextEventDay: 140,
    achievements: [],
    wonders: {},
    quests: [],
    mail: [],
    mailSeen: [],
    nextMailDay: 45,
    companies: [],
    geniuses: [],
    market: { food: newGood(FOOD_BASE), arms: newGood(ARMS_BASE), sciPool: 0, sciNorm: 1, nextGenius: 20, nextShock: 400 },
    nextDemandDay: 60,
    counters: {},
    hist: { s: [], m: [], l: [] },
    rng: seed | 0,
    gameOver: false,
  };

  // характеры ботов — случайно, но поровну
  const pool: Personality[] = [];
  while (pool.length < COUNTRY_DEFS.length) pool.push(...PERSONALITY_KEYS);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand(g) * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  g.countries = COUNTRY_DEFS.map((d, i): Country => ({
    idx: i,
    alive: true,
    personality: pool[i],
    money: 0,
    brains: 0,
    soldiers: d.army * 1000,
    tax: 0.2,
    budget: { edu: 2, health: 2, infra: 2, military: 1 },
    religion: 'freedom',
    gov: d.gov,
    armyType: d.gdp > 20 ? 'contract' : 'conscript',
    birthPolicy: 0,
    migration: 1,
    stability: 60,
    weariness: 0,
    unrest: 0,
    capital: REGIONS.findIndex((r) => r.origOwner === i && r.capital),
    techs: [],
    fundamental: 0,
    baseProd: Math.pow(d.gdp / 10, 0.75),
    eduIndex: d.edu,
    growthBase: d.growth,
    weaponsBase: d.weapons,
    techScale: 1,
    annexCount: 0,
    govChangedDay: -9999,
    mods: [],
    lastGross: 0,
    moneyScale: 0,
    scientists: 0,
    billionaires: 0,
    food: 0,
    foodReserve: 90,
    foodAuto: true,
    arms: d.army * 1000,
    aiFlags: {},
  }));

  g.lodge = initLodge(g);
  g.assembly = initAssembly(g);
  g.elections = initElections(g);
  g.intel = initIntel(g);

  // население регионов
  g.regions = REGIONS.map((r) => ({ owner: r.origOwner, pop: 0, cap0: 0, agri: 0 }));
  COUNTRY_DEFS.forEach((d, i) => {
    const regs = REGIONS.filter((r) => r.origOwner === i);
    const w = regs.map((r) => (r.density + 1.5) * (r.capital ? 2.5 : 1));
    const sum = w.reduce((a, b) => a + b, 0);
    regs.forEach((r, k) => {
      g.regions[r.id].pop = (d.pop * 1e6 * w[k]) / sum;
    });
  });
  REGIONS.forEach((r) => {
    const st = g.regions[r.id];
    if (r.origOwner < 0) st.pop = Math.max(5000, r.density * 1.2e6 * continentFactor(r.name));
    st.cap0 = st.pop * 1.25 + r.tiles.length * 30000;
  });

  // отношения
  const n = g.countries.length;
  g.rel = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      let v = (rand(g) - 0.5) * 20;
      if (g.countries[a].gov === g.countries[b].gov) v += 10;
      g.rel[a][b] = g.rel[b][a] = v;
    }
  }

  computeAll(g);
  // учёные, миллиардеры, компании, запасы еды и мировой рынок
  g.countries.forEach((c, i) => {
    c.moneyScale = Math.max(30, STATS[i].taxIncome);
  });
  initSociety(g, true);
  g.countries.forEach((c, i) => {
    const s = STATS[i];
    c.lastGross = s.taxIncome;
    c.moneyScale = Math.max(30, s.taxIncome);
    c.money = s.taxIncome * 200 + 5000 * c.baseProd;
    c.techScale = Math.max(1, s.brainsRate);
    c.brains = c.techScale * 60;
  });
  computeAll(g);
  g.countries.forEach((c, i) => {
    c.stability = STATS[i].stabTarget;
  });
  computeAll(g);
  log(g, `👑 Вы приняли власть: ${COUNTRY_DEFS[player].name}. Удачи, правитель!`, 'good', false);
  if (scenario !== 'classic') {
    applyScenario(g, scenario);
    computeAll(g);
  }
  return g;
}
