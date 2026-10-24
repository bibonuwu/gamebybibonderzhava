// Генерация гексагональной карты мира из Natural Earth (world-atlas).
// Запуск: npm run map  →  src/data/world.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const topo = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/world-atlas/countries-50m.json'), 'utf8'));
const countries = JSON.parse(fs.readFileSync(path.join(root, 'src/data/countries.json'), 'utf8'));

const COLS = 160;
const DLON = 360 / COLS;
const DLAT = (DLON * Math.sqrt(3)) / 2;
const LAT_TOP = 80;
const ROWS = 70;
const N = COLS * ROWS;

// ---------- геометрия стран ----------
const fc = feature(topo, topo.objects.countries);
const polys = [];
fc.features.forEach((f, fi) => {
  const g = f.geometry;
  if (!g) return;
  const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (let rings of list) {
    // полигоны через 180-й меридиан (Чукотка, Фиджи) делаем непрерывными: 179 → 181
    const spans = rings[0].some(([x]) => x > 170) && rings[0].some(([x]) => x < -170);
    if (spans) rings = rings.map((ring) => ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of rings[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    polys.push({ fi, minX, maxX, minY, maxY, rings });
  }
});

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function featureAt(lon0, lat) {
  for (const p of polys) {
    let lon = lon0;
    if (p.maxX > 180 && lon < p.minX) lon += 360;
    if (lon < p.minX || lon > p.maxX || lat < p.minY || lat > p.maxY) continue;
    if (!inRing(lon, lat, p.rings[0])) continue;
    let hole = false;
    for (let h = 1; h < p.rings.length; h++) if (inRing(lon, lat, p.rings[h])) { hole = true; break; }
    if (!hole) return p.fi;
  }
  return -1;
}

const countryByFeature = new Map();
fc.features.forEach((f, fi) => {
  const ci = countries.findIndex((c) => c.iso === String(f.id).padStart(3, '0'));
  if (ci >= 0) countryByFeature.set(fi, ci);
});
for (let ci = 0; ci < countries.length; ci++) {
  if (![...countryByFeature.values()].includes(ci)) console.warn('⚠ не найдена геометрия для', countries[ci].name);
}

// ---------- сетка ----------
const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const tileLon = (c, r) => -180 + (c + 0.5 + 0.5 * (r & 1)) * DLON;
const tileLat = (r) => LAT_TOP - r * DLAT;
function tileAt(lat, lon) {
  const r = Math.min(ROWS - 1, Math.max(0, Math.round((LAT_TOP - lat) / DLAT)));
  let c = Math.round((lon + 180) / DLON - 0.5 - 0.5 * (r & 1));
  c = ((c % COLS) + COLS) % COLS;
  return r * COLS + c;
}
const DIRS_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const DIRS_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
function neighbors(i) {
  const r = Math.floor(i / COLS), c = i % COLS;
  const out = [];
  for (const [dc, dr] of r & 1 ? DIRS_ODD : DIRS_EVEN) {
    const rr = r + dr;
    if (rr < 0 || rr >= ROWS) continue;
    out.push(rr * COLS + ((c + dc + COLS) % COLS));
  }
  return out;
}
function tileXY(i) {
  const r = Math.floor(i / COLS), c = i % COLS;
  return [c + 0.5 * (r & 1), r * 0.866];
}
function tileDist(a, b) {
  const [ax, ay] = tileXY(a), [bx, by] = tileXY(b);
  let dx = Math.abs(ax - bx);
  if (dx > COLS / 2) dx = COLS - dx;
  return Math.hypot(dx, ay - by);
}

// ---------- суша и владельцы ----------
const owner = new Int16Array(N).fill(-2); // -2 вода, -1 нейтральная суша, >=0 страна
const SAMPLES = [[0, 0], [0.5, 0], [-0.5, 0], [0.25, 0.45], [-0.25, 0.45], [0.25, -0.45], [-0.25, -0.45]];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const lon0 = tileLon(c, r), lat0 = tileLat(r);
    const tally = new Map();
    let land = 0, centerF = -1;
    SAMPLES.forEach(([ox, oy], k) => {
      const fi = featureAt(wrapLon(lon0 + ox * DLON), lat0 + oy * DLAT * 1.1);
      if (k === 0) centerF = fi;
      if (fi >= 0) {
        land++;
        tally.set(fi, (tally.get(fi) || 0) + 1);
      }
    });
    if (land < 2) continue;
    let best = -1, bestN = 0;
    for (const [fi, n] of tally) if (n > bestN || (n === bestN && fi === centerF)) { best = fi; bestN = n; }
    owner[r * COLS + c] = countryByFeature.has(best) ? countryByFeature.get(best) : -1;
  }
}

// города всегда на своей суше
const cityTiles = countries.map(() => []);
countries.forEach((cty, ci) => {
  for (const [name, lat, lon] of cty.cities) {
    let t = tileAt(lat, lon);
    if (owner[t] !== ci) {
      if (owner[t] < 0) owner[t] = ci;
      else {
        // ищем ближайшую клетку своей страны
        let best = -1, bd = Infinity;
        for (let i = 0; i < N; i++) if (owner[i] === ci) { const d = tileDist(i, t); if (d < bd) { bd = d; best = i; } }
        if (best < 0 || bd > 3) { console.warn('пропущен город', name); continue; }
        t = best;
      }
    }
    if (cityTiles[ci].some((x) => x.t === t)) continue;
    cityTiles[ci].push({ t, name });
  }
});

// ---------- рельеф ----------
function hash(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s) => 0.6 * vnoise(x / 3.5, y / 3.5, s) + 0.4 * vnoise(x / 1.6, y / 1.6, s + 11);
const chance = (n, p) => n < 0.28 + p * 0.44; // fbm ~ [0.28..0.72] → вероятность p

const box = (lat, lon, [a, b, c, d]) => lat >= a && lat <= b && lon >= c && lon <= d;
const MOUNTAINS = [
  [[27, 37, 72, 100], 0.7], [[35, 45, 66, 88], 0.45], [[46, 54, 84, 100], 0.4], [[44.5, 47.5, 6, 14], 0.85],
  [[42, 43.3, -1.5, 3], 0.6], [[41, 44, 40, 48], 0.7], [[45, 49.5, 22, 26], 0.35], [[50, 68, 56.5, 61], 0.5],
  [[27, 38, 45, 60], 0.3], [[37, 41, 36, 44], 0.45], [[6, 14, 36, 41], 0.5], [[30, 36, -8, 10], 0.35],
  [[58, 70, 125, 172], 0.35], [[60, 70, 6, 18], 0.4], [[34, 45, -84, -72], 0.2], [[-38, -16, 145, 152.5], 0.25],
  [[33, 44, 130, 145], 0.35], [[-31, -27, 27, 31], 0.3], [[17, 30, -110, -98], 0.35], [[58, 66, -158, -138], 0.45],
  [[35, 49, -123, -119], 0.45], [[50, 60, -132, -122], 0.5], [[38, 42, 19, 24], 0.3], [[42, 46.5, 10, 14], 0.25],
];
const DESERTS = [
  [[16, 31.5, -17, 34], 0.9], [[15, 31, 36, 56], 0.85], [[28, 36, 52, 62], 0.55], [[24, 30, 69, 75], 0.6],
  [[36.5, 42, 76, 91], 0.85], [[38, 46, 90, 115], 0.6], [[38, 46.5, 52, 68], 0.55], [[-32, -19, 118, 143], 0.7],
  [[-28, -18, 12, 24], 0.55], [[-28, -16, -71, -68], 0.6], [[30, 38, -118, -107], 0.45], [[2, 11, 40, 51], 0.45],
  [[12, 17, -17, 38], 0.35],
];
const FORESTS = [
  [[50, 64, 20, 165], 0.6], [[50, 62, -165, -55], 0.6], [[-15, 5, -76, -45], 0.85], [[-8, 5, 9, 30], 0.8],
  [[-10, 20, 95, 152], 0.65], [[30, 48, -95, -65], 0.4], [[43, 58, -5, 40], 0.3], [[22, 32, 100, 122], 0.35],
  [[5, 12, -80, -60], 0.5], [[45, 50, 125, 140], 0.5],
];
const ANDES = [[12, -72], [5, -75.5], [0, -78], [-5, -79], [-10, -76.5], [-15, -72.5], [-20, -68.5], [-25, -68.5], [-30, -70], [-35, -70.3], [-40, -71.3], [-45, -72], [-50, -73], [-56, -70]];
function andesLon(lat) {
  for (let i = 0; i < ANDES.length - 1; i++) {
    const [la, lo] = ANDES[i], [lb, lob] = ANDES[i + 1];
    if (lat <= la && lat >= lb) return lo + ((lat - la) / (lb - la)) * (lob - lo);
  }
  return null;
}

function terrainAt(i) {
  const r = Math.floor(i / COLS), c = i % COLS;
  const lat = tileLat(r), lon = tileLon(c, r);
  const n1 = fbm(c, r, 1), n2 = fbm(c, r, 2), n3 = fbm(c, r, 3), n4 = fbm(c, r, 4);
  const greenland = box(lat, lon, [59, 84, -74, -11]) && owner[i] === -1;
  if (greenland) return lat > 62 && chance(n1, 0.8) ? 's' : 't';
  if (lat > 74) return chance(n1, 0.6) ? 's' : 't';
  // горы
  const al = andesLon(lat);
  if (al !== null && Math.abs(lon - al) < 2.3 && chance(n2, 0.85)) return 'm';
  if (lat > 31 && lat < 60) {
    const rl = -106 - (lat - 31) * 0.6;
    if (Math.abs(lon - rl) < 2.6 && chance(n2, 0.6)) return 'm';
  }
  for (const [b, p] of MOUNTAINS) if (box(lat, lon, b) && chance(n2, p)) return 'm';
  // плодородные долины среди пустынь
  if (box(lat, lon, [22, 31.6, 30.3, 33]) || box(lat, lon, [30, 37, 40, 48.5])) return 'p';
  for (const [b, p] of DESERTS) if (box(lat, lon, b) && chance(n3, p)) return 'd';
  if (lat > 64) return chance(n1, 0.25) && lat < 68 ? 'f' : 't';
  if (lat < -52) return 't';
  for (const [b, p] of FORESTS) if (box(lat, lon, b) && chance(n4, p)) return 'f';
  if (chance(n4, 0.1)) return 'f';
  const tropical = Math.abs(lat) < 23;
  return chance(n1, tropical ? 0.4 : 0.6) ? 'g' : 'p';
}

const terrain = new Array(N);
for (let i = 0; i < N; i++) terrain[i] = owner[i] === -2 ? 'o' : terrainAt(i);
for (let i = 0; i < N; i++) {
  if (terrain[i] !== 'o') continue;
  if (neighbors(i).some((j) => owner[j] !== -2)) terrain[i] = 'c';
}
// города не в горах — иначе негде строить
countries.forEach((_, ci) => cityTiles[ci].forEach(({ t }) => { if (terrain[t] === 'm' || terrain[t] === 's') terrain[t] = 'p'; }));

// ---------- регионы ----------
const regionOf = new Int32Array(N).fill(-1);
const regions = [];

function bfsAssign(tiles, seeds) {
  const set = new Set(tiles);
  const q = [];
  for (const { t, rid } of seeds) { regionOf[t] = rid; q.push(t); }
  for (let h = 0; h < q.length; h++) {
    const t = q[h];
    for (const n of neighbors(t)) if (set.has(n) && regionOf[n] === -1) { regionOf[n] = regionOf[t]; q.push(n); }
  }
  for (const t of tiles) {
    if (regionOf[t] !== -1) continue;
    let best = seeds[0], bd = Infinity;
    for (const s of seeds) { const d = tileDist(t, s.t); if (d < bd) { bd = d; best = s; } }
    regionOf[t] = best.rid;
  }
}

countries.forEach((cty, ci) => {
  const tiles = [];
  for (let i = 0; i < N; i++) if (owner[i] === ci) tiles.push(i);
  const seeds = cityTiles[ci].map(({ t, name }, k) => {
    const rid = regions.length;
    regions.push({ n: name, o: ci, c: t, cap: k === 0 ? 1 : 0 });
    return { t, rid };
  });
  bfsAssign(tiles, seeds);
});

function continentOf(lat, lon) {
  if (box(lat, lon, [58, 84, -75, -10])) return 'Гренландия';
  if (lon < -25) return lat > 10 ? 'Сев. Америка' : 'Юж. Америка';
  if (lat > 35 && lon < 42 && lon > -25) return 'Европа';
  if (lat >= 12 && lat <= 42 && lon >= 34 && lon <= 63) return 'Ближний Восток';
  if (lat < 38 && lon < 52) return 'Африка';
  if (lat > 35 && lon < 90) return 'Средняя Азия';
  if (lat < -10 || (lon > 140 && lat < 0)) return 'Океания';
  return 'Азия';
}
const contCount = new Map();

const seen = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  if (owner[i] !== -1 || seen[i]) continue;
  const comp = [];
  const q = [i];
  seen[i] = 1;
  for (let h = 0; h < q.length; h++) {
    const t = q[h];
    comp.push(t);
    for (const n of neighbors(t)) if (owner[n] === -1 && !seen[n]) { seen[n] = 1; q.push(n); }
  }
  const k = Math.max(1, Math.round(comp.length / 16));
  // первая затравка — ближе к центру компоненты, остальные — максимально удалённые
  let sx = 0, sy = 0;
  for (const t of comp) { const [x, y] = tileXY(t); sx += x; sy += y; }
  sx /= comp.length; sy /= comp.length;
  let first = comp[0], fd = Infinity;
  for (const t of comp) { const [x, y] = tileXY(t); const d = Math.hypot(x - sx, y - sy); if (d < fd) { fd = d; first = t; } }
  const seedTiles = [first];
  const compSet = new Set(comp);
  while (seedTiles.length < k) {
    const dist = new Map();
    const qq = [...seedTiles];
    seedTiles.forEach((s) => dist.set(s, 0));
    for (let h = 0; h < qq.length; h++) {
      const t = qq[h];
      for (const n of neighbors(t)) if (compSet.has(n) && !dist.has(n)) { dist.set(n, dist.get(t) + 1); qq.push(n); }
    }
    let far = -1, fdist = -1;
    for (const [t, d] of dist) if (d > fdist) { fdist = d; far = t; }
    if (fdist < 3) break;
    seedTiles.push(far);
  }
  const seeds = seedTiles.map((t) => {
    const r = Math.floor(t / COLS);
    const cont = continentOf(tileLat(r), tileLon(t % COLS, r));
    const num = (contCount.get(cont) || 0) + 1;
    contCount.set(cont, num);
    const rid = regions.length;
    regions.push({ n: `Вольные земли — ${cont} ${num}`, o: -1, c: t, cap: 0 });
    return { t, rid };
  });
  bfsAssign(comp, seeds);
}

// ---------- вывод ----------
const out = {
  cols: COLS,
  rows: ROWS,
  latTop: LAT_TOP,
  dlon: DLON,
  dlat: DLAT,
  terrain: terrain.join(''),
  region: Array.from(regionOf),
  regions,
};
fs.writeFileSync(path.join(root, 'src/data/world.json'), JSON.stringify(out));

// отчёт
const stats = countries.map((c, ci) => {
  let n = 0;
  for (let i = 0; i < N; i++) if (owner[i] === ci) n++;
  return `${c.name}: ${n} клеток, ${regions.filter((r) => r.o === ci).length} регионов`;
});
console.log(stats.join('\n'));
console.log('нейтральных регионов:', regions.filter((r) => r.o === -1).length, '| всего регионов:', regions.length);
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let ascii = '';
for (let r = 0; r < ROWS; r += 1) {
  let line = r & 1 ? ' ' : '';
  for (let c = 0; c < COLS; c++) {
    const o = owner[r * COLS + c];
    line += o === -2 ? '.' : o === -1 ? '#' : letters[o];
  }
  ascii += line + '\n';
}
fs.writeFileSync(path.join(root, 'scripts/map-preview.txt'), ascii);
console.log('превью: scripts/map-preview.txt');
