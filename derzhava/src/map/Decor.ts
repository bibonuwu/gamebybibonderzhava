// Объёмные украшения поверх рельефа в духе «Цивилизации»: горы со снежными вершинами, леса и рощи, пальмы,
// домики городов и дворцы столиц. Каждая картинка рисуется один раз в текстуру; свет с северо-запада,
// тени ложатся на юго-восток — как у шейдерного рельефа.
import { Container, Graphics, Sprite, type Renderer, type Texture } from 'pixi.js';
import { COLS, N, REGIONS, TERRAIN, isCoastalTile } from '../game/world';
import { cityLand } from './Surface';

export interface DecorEnv {
  renderer: Renderer;
  center: (t: number) => [number, number];
}

type G = Graphics;
type Rnd = () => number;
/** Запечённая картинка и точка привязки (подножие) в долях её размера. */
interface Art { tex: Texture; ax: number; ay: number }

const DLAT = (360 / COLS) * (Math.sqrt(3) / 2);
const latOf = (t: number) => 80 - Math.floor(t / COLS) * DLAT;

function rng(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Тень на земле — вытянута вправо-вниз, от солнца. */
function shadow(g: G, x: number, y: number, rx: number, ry: number, alpha = 0.24) {
  g.ellipse(x + rx * 0.45, y + ry * 0.25, rx, ry).fill({ color: 0x0b1408, alpha });
}

const LEAVES = {
  temperate: [0x2b5a1e, 0x417a28, 0x67a03a],
  tropical: [0x1b4a18, 0x2b6c22, 0x4c9a32],
};

function broadleaf(g: G, x: number, y: number, s: number, [dark, mid, light]: number[]) {
  shadow(g, x, y, s * 1.2, s * 0.45);
  g.rect(x - s * 0.12, y - s * 1.0, s * 0.24, s * 1.0).fill(0x5b3a1e);
  const cy = y - s * 1.55;
  g.circle(x + s * 0.12, cy + s * 0.1, s).fill(dark);
  g.circle(x - s * 0.55, cy + s * 0.15, s * 0.6).fill(dark);
  g.circle(x + s * 0.55, cy + s * 0.25, s * 0.55).fill(dark);
  g.circle(x - s * 0.12, cy - s * 0.12, s * 0.82).fill(mid);
  g.circle(x - s * 0.38, cy - s * 0.4, s * 0.42).fill(light);
}

function conifer(g: G, x: number, y: number, s: number) {
  shadow(g, x, y, s * 0.9, s * 0.35);
  g.rect(x - s * 0.1, y - s * 0.6, s * 0.2, s * 0.6).fill(0x4a3018);
  for (let k = 0; k < 3; k++) {
    const by = y - s * (0.45 + k * 0.72), w = s * (1.0 - k * 0.24), ty = by - s * 1.15;
    g.poly([x - w, by, x + w, by, x, ty]).fill(0x1d4628);
    g.poly([x - w, by, x, by + s * 0.05, x, ty]).fill(0x2e6637);
  }
}

function palm(g: G, x: number, y: number, s: number) {
  shadow(g, x, y, s * 1.1, s * 0.35);
  const tx = x + s * 0.35, ty = y - s * 2.6;
  g.moveTo(x, y).quadraticCurveTo(x + s * 0.5, y - s * 1.3, tx, ty).stroke({ width: s * 0.22, color: 0x8b6b42 });
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i - 2.5) * 0.62;
    const dx = Math.cos(a) * s * 1.3, dy = Math.sin(a) * s * 0.7 + s * 0.35;
    g.moveTo(tx, ty)
      .quadraticCurveTo(tx + dx * 0.55, ty + dy * 0.2 - s * 0.45, tx + dx, ty + dy)
      .stroke({ width: s * 0.3, color: i < 3 ? 0x4f9a33 : 0x3a7a28, cap: 'round' });
  }
}

/** Часть ломаной от вершины вниз, пока она выше линии y, плюс точка пересечения. */
function above(line: [number, number][], y: number): [number, number][] {
  const out: [number, number][] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i];
    if (y1 <= y) {
      out.push(line[i]);
      continue;
    }
    const k = (y - y0) / (y1 - y0);
    out.push([x0 + (x1 - x0) * k, y]);
    break;
  }
  return out;
}

/** Снежная кромка «языками» между двумя точками. */
function fringe(a: [number, number], b: [number, number], depth: number, r: Rnd): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= 4; i++) {
    const u = i / 5;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + (i % 2 ? r() * depth : -r() * depth * 0.3)]);
  }
  return out;
}

/** Гора: освещённый и теневой склоны, гребень, снежная шапка, предгорья у подножия. snow — доля высоты под снегом. */
function mountain(g: G, r: Rnd, w: number, h: number, snow: number) {
  const px = (r() - 0.5) * w * 0.25;
  const left: [number, number][] = [[-w / 2, 0]];
  const right: [number, number][] = [];
  for (let i = 1; i <= 3; i++) {
    const u = i / 4;
    left.push([-w / 2 + (px + w / 2) * u + (r() - 0.5) * w * 0.07, -h * Math.pow(u, 1.5) * (0.88 + r() * 0.2)]);
  }
  const peak: [number, number] = [px, -h];
  for (let i = 1; i <= 3; i++) {
    const u = i / 4;
    right.push([px + (w / 2 - px) * u + (r() - 0.5) * w * 0.07, -h * Math.pow(1 - u, 1.5) * (0.88 + r() * 0.2)]);
  }
  right.push([w / 2, 0]);
  const spine: [number, number][] = [peak, [px + w * 0.06 + (r() - 0.5) * w * 0.05, -h * 0.55], [px * 0.4 + w * 0.1, 0]];
  shadow(g, w * 0.08, 0, w * 0.62, h * 0.16, 0.3);
  // склоны
  g.poly([...left, peak, ...spine.slice(1).reverse()].flat()).fill(0x9a8b76);
  g.poly([peak, ...right, ...spine.slice(1).reverse()].flat()).fill(0x5d5245);
  // каменные пласты
  for (let i = 0; i < 3; i++) {
    const y = -h * (0.18 + i * 0.17 + r() * 0.06), x0 = px * 0.3 + w * 0.05;
    g.moveTo(x0, y).lineTo(x0 - w * (0.12 + r() * 0.1), y + h * (0.08 + r() * 0.05)).stroke({ width: 0.45, color: 0x7a6c5a });
  }
  // снег
  const ys = -h * (1 - snow);
  const lw = above([peak, ...left.slice().reverse()], ys);
  const rw = above([peak, ...right], ys);
  const sw = above(spine, ys);
  const depth = h * 0.13;
  g.poly([...lw, ...fringe(lw[lw.length - 1], sw[sw.length - 1], depth, r), ...sw.slice().reverse()].flat()).fill(0xf3f6fa);
  g.poly([...sw, ...fringe(sw[sw.length - 1], rw[rw.length - 1], depth, r), ...rw.slice().reverse()].flat()).fill(0xb9c6d6);
  // предгорья прячут ровный низ
  g.ellipse(-w * 0.22, -h * 0.02, w * 0.24, h * 0.09).fill(0x7c7158);
  g.ellipse(w * 0.2, -h * 0.01, w * 0.22, h * 0.08).fill(0x5a5143);
}

interface Pal { wall: number; side: number; roofs: [number, number][]; flat: boolean }
const HOUSES: Record<string, Pal> = {
  temperate: { wall: 0xf0e6d2, side: 0xc9b99c, roofs: [[0xb8503a, 0x8a3a2a], [0xa5452f, 0x7a3020], [0x5d6b7d, 0x46515f]], flat: false },
  cold: { wall: 0xe0dbcf, side: 0xb3ab9b, roofs: [[0x5a4a44, 0x40342f], [0x4e5a66, 0x3a434c], [0x4f6b4a, 0x3a5036]], flat: false },
  arid: { wall: 0xead8b0, side: 0xc4ad82, roofs: [[0xd8c191, 0xd8c191], [0xe4d3ab, 0xe4d3ab]], flat: true },
  tropic: { wall: 0xf3e6c6, side: 0xcdb98f, roofs: [[0xc9763c, 0x9a5528], [0xb8643a, 0x8a4626]], flat: false },
};

function house(g: G, x: number, y: number, s: number, p: Pal, r: Rnd) {
  const w = s * (1.6 + r() * 0.8), h = s * (1.0 + r() * 0.5), d = s * 0.7;
  const [roof, roofSide] = p.roofs[Math.floor(r() * p.roofs.length)];
  shadow(g, x + w * 0.25, y, w * 0.8, s * 0.35, 0.3);
  g.poly([x + w / 2, y, x + w / 2 + d, y - d * 0.5, x + w / 2 + d, y - h - d * 0.5, x + w / 2, y - h]).fill(p.side);
  g.rect(x - w / 2, y - h, w, h).fill(p.wall);
  if (p.flat) {
    g.poly([x - w / 2, y - h, x + w / 2, y - h, x + w / 2 + d, y - h - d * 0.5, x - w / 2 + d, y - h - d * 0.5]).fill(roof);
    g.poly([x - w / 2, y - h, x + w / 2, y - h]).stroke({ width: 0.25, color: 0xb59c6c });
  } else {
    const rh = s * 0.95, e = s * 0.15;
    g.poly([x - w / 2 - e, y - h, x + w / 2 + e, y - h, x + w / 2 + d * 0.5, y - h - rh, x - w / 2 + d * 0.5, y - h - rh]).fill(roof);
    g.poly([x + w / 2 + e, y - h, x + w / 2 + d, y - h - d * 0.5, x + w / 2 + d * 0.5, y - h - rh]).fill(roofSide);
  }
  g.rect(x - s * 0.15, y - h * 0.6, s * 0.3, h * 0.6).fill({ color: 0x3a2a1c, alpha: 0.55 });
}

/** Дворец столицы: широкое здание, золотой купол и башенка. */
function palace(g: G, x: number, y: number, s: number, p: Pal) {
  const w = s * 4, h = s * 2.4, d = s * 1.1;
  shadow(g, x + w * 0.3, y, w * 0.8, s * 0.6, 0.32);
  g.poly([x + w / 2, y, x + w / 2 + d, y - d * 0.5, x + w / 2 + d, y - h - d * 0.5, x + w / 2, y - h]).fill(p.side);
  g.rect(x - w / 2, y - h, w, h).fill(p.wall);
  g.poly([x - w / 2, y - h, x + w / 2, y - h, x + w / 2 + d, y - h - d * 0.5, x - w / 2 + d, y - h - d * 0.5]).fill(0xd8ccb4);
  for (let i = 0; i < 4; i++) g.rect(x - w / 2 + s * (0.5 + i * 0.95), y - h * 0.75, s * 0.35, h * 0.55).fill({ color: 0x3a2a1c, alpha: 0.45 });
  // купол
  const cx = x + d * 0.5, cy = y - h - d * 0.25;
  g.rect(cx - s * 0.9, cy - s * 0.8, s * 1.8, s * 0.8).fill(p.wall);
  g.circle(cx, cy - s * 0.8, s * 0.95).fill(0xc9932e);
  g.circle(cx - s * 0.3, cy - s * 1.1, s * 0.4).fill(0xf2cf6b);
  g.rect(cx - s * 0.06, cy - s * 2.3, s * 0.12, s * 0.6).fill(0xc9932e);
  // башня
  const tx = x - w / 2 + s * 0.4;
  g.rect(tx - s * 0.45, y - h - s * 2.2, s * 0.9, s * 2.2).fill(p.wall);
  g.poly([tx - s * 0.6, y - h - s * 2.2, tx + s * 0.6, y - h - s * 2.2, tx, y - h - s * 3.6]).fill(0x8a3a2a);
}

function grove(g: G, r: Rnd, kind: 'temperate' | 'boreal' | 'tropical') {
  const pts: [number, number][] = [];
  for (let row = -3; row <= 3; row++) {
    for (let col = -3; col <= 3; col++) {
      const x = col * 3.3 + (row & 1 ? 1.65 : 0) + (r() - 0.5) * 2, y = row * 3 + (r() - 0.5) * 2;
      // внутри шестиугольника: соседние рощи смыкаются в сплошной лес
      if (Math.abs(x) > 9.6 || Math.abs(x) * 0.5 + Math.abs(y) * 0.866 > 9.6) continue;
      pts.push([x, y]);
    }
  }
  pts.sort((a, b) => a[1] - b[1]);
  for (const [x, y] of pts) {
    const s = 1.45 + r() * 0.55, k = r();
    if (kind === 'boreal') {
      if (k < 0.88) conifer(g, x, y, s * 1.1);
      else broadleaf(g, x, y, s * 0.9, LEAVES.temperate);
    } else if (kind === 'tropical') {
      if (k < 0.18) palm(g, x, y, s * 0.95);
      else broadleaf(g, x, y, s * 1.05, LEAVES.tropical);
    } else if (k < 0.3) conifer(g, x, y, s);
    else broadleaf(g, x, y, s, LEAVES.temperate);
  }
}

/** Отдельные деревья на лугах, в степи, тундре и пустыне. */
function copse(g: G, r: Rnd, kind: 'temperate' | 'boreal' | 'tropical' | 'palm', n: number) {
  const pts: [number, number][] = [];
  const ox = (r() - 0.5) * 8, oy = (r() - 0.5) * 6;
  for (let i = 0; i < n; i++) pts.push([ox + (r() - 0.5) * 6, oy + (r() - 0.5) * 4]);
  pts.sort((a, b) => a[1] - b[1]);
  for (const [x, y] of pts) {
    const s = 1.4 + r() * 0.5;
    if (kind === 'palm') palm(g, x, y, s);
    else if (kind === 'boreal') conifer(g, x, y, s);
    else broadleaf(g, x, y, s, kind === 'tropical' ? LEAVES.tropical : LEAVES.temperate);
  }
}

function city(g: G, r: Rnd, p: Pal, capital: boolean) {
  const items: { x: number; y: number; k: 'house' | 'tree' | 'palace' }[] = [];
  const n = capital ? 14 : 8 + Math.floor(r() * 4);
  // кольцо вокруг середины: там стоит значок города
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, rad = 4.6 + r() * 4.2;
    items.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.85 + 1, k: 'house' });
  }
  for (let i = 0; i < 2; i++) {
    const a = r() * Math.PI * 2;
    items.push({ x: Math.cos(a) * 8.5, y: Math.sin(a) * 7, k: 'tree' });
  }
  if (capital) items.push({ x: 4.5, y: -4.5, k: 'palace' });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) {
    if (it.k === 'palace') palace(g, it.x, it.y, 1.4, p);
    else if (it.k === 'tree') broadleaf(g, it.x, it.y, 1.3, p.flat ? LEAVES.tropical : LEAVES.temperate);
    else house(g, it.x, it.y, 1.45, p, r);
  }
}

export class Decor {
  readonly layer = new Container();
  private tex = new Map<string, Art[]>();

  constructor(private env: DecorEnv) {
    const items: { sp: Sprite; y: number }[] = [];
    const put = (art: Art, x: number, y: number, scale = 1) => {
      const sp = new Sprite(art.tex);
      sp.anchor.set(art.ax, art.ay);
      sp.position.set(x, y);
      sp.scale.set(scale);
      items.push({ sp, y });
    };
    const pick = (key: string, count: number, draw: (g: G, r: Rnd) => void, h: number) => {
      let list = this.tex.get(key);
      if (!list) {
        list = [];
        for (let i = 0; i < count; i++) list.push(this.bake((g) => draw(g, rng(key.length * 7919 + i * 104729 + 17))));
        this.tex.set(key, list);
      }
      return list[Math.floor(h * list.length) % list.length];
    };
    const land = cityLand();
    const capitals = new Set(REGIONS.filter((r) => r.capital).map((r) => r.center));
    for (let t = 0; t < N; t++) {
      const ter = TERRAIN[t];
      const [cx, cy] = env.center(t);
      const r = rng(t * 2654435761);
      const h = r();
      const lat = Math.abs(latOf(t));
      if (land[t] === 2) {
        // город: домики по климату
        const pal = lat > 55 ? 'cold' : ter === 'd' || (lat < 35 && ter === 'p') ? 'arid' : lat < 23 ? 'tropic' : 'temperate';
        const cap = capitals.has(t);
        put(pick(`city-${pal}-${cap}`, cap ? 3 : 6, (g, rr) => city(g, rr, HOUSES[pal], cap), h), cx, cy);
        continue;
      }
      if (land[t] === 1) continue; // поля
      if (ter === 'm') {
        const snow = lat > 40 ? 0.5 : lat > 25 ? 0.4 : 0.3;
        const peak = (g: G, rr: Rnd) => mountain(g, rr, 24 + rr() * 8, 18 + rr() * 6, snow);
        put(pick(`mount-${snow}`, 6, peak, h), cx + (r() - 0.5) * 5, cy + 7 + (r() - 0.5) * 2);
        // иногда рядом вершина пониже
        if (r() < 0.55) {
          const side = r() < 0.5 ? -1 : 1;
          put(pick(`mount-${snow}`, 6, peak, r()), cx + side * (6 + r() * 3), cy + 9 + r() * 2, 0.6 + r() * 0.12);
        }
      } else if (ter === 'f') {
        const kind = lat > 50 ? 'boreal' : lat < 22 ? 'tropical' : 'temperate';
        put(pick(`grove-${kind}`, 4, (g, rr) => grove(g, rr, kind), h), cx, cy);
      } else if (ter === 'g' && h < 0.4) {
        const kind = lat > 50 ? 'boreal' : lat < 22 ? 'tropical' : 'temperate';
        put(pick(`copse-${kind}`, 5, (g, rr) => copse(g, rr, kind, 2 + Math.floor(rr() * 3)), r()), cx, cy);
      } else if (ter === 'p' && h < 0.22) {
        const kind = lat < 25 ? 'palm' : 'temperate';
        put(pick(`copse-p-${kind}`, 4, (g, rr) => copse(g, rr, kind, 1 + Math.floor(rr() * 2)), r()), cx, cy);
      } else if (ter === 't' && h < 0.3) {
        put(pick('copse-tundra', 4, (g, rr) => copse(g, rr, 'boreal', 1 + Math.floor(rr() * 3)), r()), cx, cy, 0.8);
      } else if (ter === 'd' && h < 0.12 && isCoastalTile(t)) {
        put(pick('copse-oasis', 3, (g, rr) => copse(g, rr, 'palm', 2 + Math.floor(rr() * 2)), r()), cx, cy);
      }
    }
    // дальние — раньше: ближние к зрителю перекрывают их
    items.sort((a, b) => a.y - b.y);
    for (const { sp } of items) this.layer.addChild(sp);
  }

  /** Рисунок → текстура; якорь там, где у рисунка начало координат (подножие). */
  private bake(draw: (g: G) => void): Art {
    const g = new Graphics();
    draw(g);
    const b = g.getLocalBounds();
    const tex = this.env.renderer.generateTexture({ target: g, resolution: 4, antialias: true });
    g.destroy();
    return { tex, ax: -b.x / b.width, ay: -b.y / b.height };
  }
}
