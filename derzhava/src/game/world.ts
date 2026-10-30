// Статическая карта мира: клетки, регионы, соседство.
import data from '../data/world.json';
import countriesData from '../data/countries.json';
import type { CountryDef, Terrain } from './types';

export const COLS: number = data.cols;
export const ROWS: number = data.rows;
export const N = COLS * ROWS;
export const TERRAIN: string = data.terrain;
export const REGION_OF: Int32Array = Int32Array.from(data.region);
export const COUNTRY_DEFS = countriesData as unknown as CountryDef[];

/** Род названия страны: Китай, Египет… — мужской, США — множественное число, остальные — женский. */
const GENDER: Record<string, 'm' | 'pl'> = { cn: 'm', eg: 'm', kz: 'm', pk: 'm', ir: 'm', dz: 'm', us: 'pl' };
/**
 * Слово, согласованное с названием страны: vb(i, 'взял') → «взял» / «взяла» / «взяли».
 * Возвратные глаголы — тоже: vb(i, 'отказался') → «отказалась». Неправильные — тремя формами: vb(i, 'ушёл', 'ушла', 'ушли').
 */
export function vb(i: number, m: string, f?: string, pl?: string): string {
  const g = GENDER[COUNTRY_DEFS[i]?.id] ?? 'f';
  if (g === 'm') return m;
  if (f === undefined) {
    const base = m.endsWith('ся') ? m.slice(0, -2) : m;
    f = m.endsWith('ся') ? `${base}ась` : `${m}а`;
    pl = m.endsWith('ся') ? `${base}ись` : `${m}и`;
  }
  return g === 'pl' ? pl ?? f : f;
}

const DIRS_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const DIRS_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

/** Соседи клетки по направлениям E, NE, NW, W, SW, SE (-1 — за краем карты). */
export const NEIGH = new Int32Array(N * 6).fill(-1);
for (let i = 0; i < N; i++) {
  const r = Math.floor(i / COLS), c = i % COLS;
  const dirs = r & 1 ? DIRS_ODD : DIRS_EVEN;
  for (let d = 0; d < 6; d++) {
    const rr = r + dirs[d][1];
    if (rr < 0 || rr >= ROWS) continue;
    NEIGH[i * 6 + d] = rr * COLS + ((c + dirs[d][0] + COLS) % COLS);
  }
}

export const terrainOf = (t: number) => TERRAIN[t] as Terrain;
export const isWater = (t: number) => TERRAIN[t] === 'o' || TERRAIN[t] === 'c';

export function isCoastalTile(t: number): boolean {
  if (isWater(t)) return false;
  for (let d = 0; d < 6; d++) {
    const n = NEIGH[t * 6 + d];
    if (n >= 0 && isWater(n)) return true;
  }
  return false;
}

export function hexDist(a: number, b: number): number {
  const ra = Math.floor(a / COLS), ca = a % COLS;
  const rb = Math.floor(b / COLS), cb = b % COLS;
  const qa = ca - (ra - (ra & 1)) / 2;
  let best = Infinity;
  for (const shift of [0, COLS, -COLS]) {
    const qb = cb + shift - (rb - (rb & 1)) / 2;
    const dq = qb - qa, dr = rb - ra;
    best = Math.min(best, (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2);
  }
  return best;
}

/** Номер водоёма для каждой клетки воды (океан, Каспий и т. д.), -1 — суша. */
export const WATER_COMP = new Int32Array(N).fill(-1);
{
  let comp = 0;
  for (let i = 0; i < N; i++) {
    if (!isWater(i) || WATER_COMP[i] >= 0) continue;
    const q = [i];
    WATER_COMP[i] = comp;
    for (let h = 0; h < q.length; h++) {
      const t = q[h];
      for (let d = 0; d < 6; d++) {
        const n = NEIGH[t * 6 + d];
        if (n >= 0 && isWater(n) && WATER_COMP[n] < 0) {
          WATER_COMP[n] = comp;
          q.push(n);
        }
      }
    }
    comp++;
  }
}
/** Водоёмы, к которым примыкает клетка суши. */
export function adjacentWaters(t: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < 6; d++) {
    const n = NEIGH[t * 6 + d];
    if (n >= 0 && WATER_COMP[n] >= 0 && !out.includes(WATER_COMP[n])) out.push(WATER_COMP[n]);
  }
  return out;
}

export interface RegionInfo {
  id: number;
  name: string;
  center: number;
  origOwner: number;
  isCity: boolean;
  capital: boolean;
  tiles: number[];
  neighbors: number[];
  coastal: boolean;
  waters: number[];
  mountainShare: number;
  forestShare: number;
  density: number; // относительная пригодность для жизни
}

const DENSITY: Record<string, number> = { p: 1, g: 1.1, f: 0.5, d: 0.12, t: 0.06, s: 0.01, m: 0.3 };

export const REGIONS: RegionInfo[] = data.regions.map((r, id) => ({
  id,
  name: r.n,
  center: r.c,
  origOwner: r.o,
  isCity: r.o >= 0,
  capital: r.cap === 1,
  tiles: [],
  neighbors: [],
  coastal: false,
  waters: [],
  mountainShare: 0,
  forestShare: 0,
  density: 0,
}));

for (let t = 0; t < N; t++) {
  const r = REGION_OF[t];
  if (r >= 0) REGIONS[r].tiles.push(t);
}
for (const reg of REGIONS) {
  const nb = new Set<number>();
  let m = 0, f = 0, dens = 0;
  for (const t of reg.tiles) {
    const ter = TERRAIN[t];
    if (ter === 'm') m++;
    if (ter === 'f') f++;
    dens += DENSITY[ter] ?? 0;
    if (isCoastalTile(t)) {
      reg.coastal = true;
      for (const w of adjacentWaters(t)) if (!reg.waters.includes(w)) reg.waters.push(w);
    }
    for (let d = 0; d < 6; d++) {
      const n = NEIGH[t * 6 + d];
      if (n < 0) continue;
      const rn = REGION_OF[n];
      if (rn >= 0 && rn !== reg.id) nb.add(rn);
    }
  }
  reg.neighbors = [...nb];
  reg.mountainShare = m / Math.max(1, reg.tiles.length);
  reg.forestShare = f / Math.max(1, reg.tiles.length);
  reg.density = dens;
}

/** Множитель плотности населения нейтральных земель по части света. */
export function continentFactor(name: string): number {
  if (name.includes('Гренландия')) return 0.02;
  if (name.includes('Средняя Азия')) return 0.6;
  if (name.includes('Азия')) return 2.2;
  if (name.includes('Европа')) return 1.3;
  if (name.includes('Африка')) return 1.1;
  if (name.includes('Ближний Восток')) return 0.9;
  if (name.includes('Юж. Америка')) return 0.8;
  if (name.includes('Сев. Америка')) return 0.8;
  if (name.includes('Океания')) return 0.5;
  return 1;
}
