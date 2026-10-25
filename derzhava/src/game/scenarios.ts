// Сценарии партии: стартовые условия поверх обычного мира.
// «Холодная война» — два блока с ядерным оружием: в открытую не воюют, зато вооружают чужих мятежников (rebels.ts).
// «Эпоха потрясений» — мировой кризис: стабильность у всех ниже, у слабых стран бунты, державы могут распасться.
import { pair, setRel } from './actions';
import { BOMB_TECH } from './nuclear';
import { shockMarket } from './market';
import { seedRebellion } from './rebels';
import { log, rand } from './state';
import type { GameState, Scenario } from './types';
import { COUNTRY_DEFS } from './world';

export interface ScenarioDef {
  name: string;
  short: string; // для переключателя на стартовом экране
  icon: string;
  desc: string;
}
export const SCENARIOS: Record<Scenario, ScenarioDef> = {
  classic: { name: 'Наше время', short: 'Наше время', icon: '🌍', desc: 'Мир как сейчас: каждый сам за себя.' },
  coldwar: { name: 'Холодная война', short: 'Холодная война', icon: '🧊', desc: 'Два блока с атомными бомбами. В открытую воюют редко — вооружают чужих мятежников.' },
  turmoil: { name: 'Эпоха потрясений', short: 'Потрясения', icon: '🔥', desc: 'Мировой кризис: у слабых стран бунты, державы на грани распада. Ничьих земель будет много.' },
};
export const SCENARIO_KEYS = Object.keys(SCENARIOS) as Scenario[];

/** Блоки холодной войны: первый в списке — лидер, с ним у каждого союз. */
const BLOCS: { name: string; ids: string[] }[] = [
  { name: 'Западный блок', ids: ['us', 'gb', 'fr', 'de', 'it', 'es', 'ca', 'jp', 'au', 'tr'] },
  { name: 'Восточный блок', ids: ['ru', 'cn', 'ir', 'kz'] },
];
/** Ядерные державы холодной войны и размер их арсенала. */
const ARSENAL: Record<string, number> = { us: 8, ru: 8, cn: 3, gb: 2, fr: 2 };
const ATOM_TECHS = ['nuclear_physics', 'nuclear_power', BOMB_TECH];

const idxOf = (id: string) => COUNTRY_DEFS.findIndex((d) => d.id === id);

/** Блок страны (-1 — неприсоединившаяся). */
export function blocOf(ci: number): number {
  const id = COUNTRY_DEFS[ci]?.id;
  return BLOCS.findIndex((b) => b.ids.includes(id));
}
export const blocName = (k: number) => BLOCS[k]?.name ?? 'Неприсоединившиеся';

export function applyScenario(g: GameState, sc: Scenario) {
  g.scenario = sc;
  if (sc === 'coldwar') coldWar(g);
  else if (sc === 'turmoil') turmoil(g);
}

function coldWar(g: GameState) {
  const blocs = BLOCS.map((b) => b.ids.map(idxOf).filter((i) => i >= 0));
  blocs.forEach((members) => {
    const [lead, ...rest] = members;
    for (const a of members) {
      for (const b of members) {
        if (a >= b) continue;
        setRel(g, a, b, 50 + rand(g) * 15);
        pair(g, a, b).pact = true;
      }
    }
    for (const m of rest) {
      const p = pair(g, lead, m);
      p.alliance = true;
      p.trade = true;
      p.tradeSince = 0;
    }
  });
  // через «железный занавес» — вражда
  for (const a of blocs[0]) for (const b of blocs[1]) setRel(g, a, b, -50 - rand(g) * 15);
  for (const [id, n] of Object.entries(ARSENAL)) {
    const c = g.countries[idxOf(id)];
    if (!c) continue;
    for (const t of ATOM_TECHS) if (!c.techs.includes(t)) c.techs.push(t);
    c.nukes = n;
    c.nukeTested = true;
  }
  shockMarket(g, 'arms', 0.3); // гонка вооружений
  const mine = blocOf(g.player);
  log(g, `🧊 Холодная война: мир расколот на два блока. ${mine >= 0 ? `Мы — ${blocName(mine)}` : 'Мы не примкнули ни к кому'}. Открытой войны боятся все — воюют чужими руками`, 'war', false);
}

function turmoil(g: GameState) {
  g.finance.shock = Math.max(g.finance.shock, 0.04);
  g.finance.nextCrisis = g.day + 1500;
  shockMarket(g, 'food', 0.5);
  g.countries.forEach((c, i) => {
    const me = i === g.player;
    // бедным странам хуже всех: казна пустеет, кризис тянется давно, на окраинах уже бунтуют
    const poor = !me && COUNTRY_DEFS[i].gdp < 15;
    const hit = me ? 8 : poor ? 24 : 12;
    c.mods.push({ kind: 'stab', value: -hit, until: 540, label: 'Мировой кризис' });
    c.mods.push({ kind: 'prod', value: -0.1, until: 365, label: 'Мировой кризис' });
    c.stability -= hit;
    if (poor) {
      c.money *= 0.3;
      c.aiFlags.crisis = Math.round(40 + rand(g) * 50);
      seedRebellion(g, i);
    }
  });
  log(g, '🔥 Эпоха потрясений: мир накрыл кризис. У слабых стран бунты — кто-то из соседей может распасться', 'war', false);
}
