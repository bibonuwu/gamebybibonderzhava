// Отрисовка гекс-карты (PixiJS): рельеф, границы, города, здания, бои, управление пальцами.
import { Application, BlurFilter, Container, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js';
import { BUILDINGS } from '../game/defs';
import { mapDirty, mapFx } from '../game/state';
import { WONDER_BY_ID } from '../game/wonders';
import type { BuildingType, GameState } from '../game/types';
import { COLS, COUNTRY_DEFS, N, NEIGH, REGIONS, REGION_OF, ROWS, TERRAIN, isWater } from '../game/world';

const S = 12; // радиус гекса
const HW = Math.sqrt(3) * S; // ширина гекса
const WORLD_W = HW * (COLS + 0.5);
const WORLD_H = 1.5 * S * (ROWS - 1) + 2 * S;
const CORNERS: [number, number][] = [0, 1, 2, 3, 4, 5].map((i) => {
  const a = ((60 * i - 30) * Math.PI) / 180;
  return [S * Math.cos(a), S * Math.sin(a)];
});
// направление соседа (E, NE, NW, W, SW, SE) → пара углов общей грани
const EDGE: [number, number][] = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];

export function tileCenter(t: number): [number, number] {
  const r = Math.floor(t / COLS), c = t % COLS;
  return [HW * (c + 0.5 * (r & 1)) + HW / 2, 1.5 * S * r + S];
}

const TERRAIN_COLOR: Record<string, number> = {
  o: 0x1b4a73, c: 0x2c74a3, p: 0xc4b36b, g: 0x80ad4f, f: 0x5a8f40, d: 0xe3c98d, t: 0x9ba68f, s: 0xe8eef2, m: 0x8f826e,
};
const DEEP_SEA = 0x163c5e;
const hexColor = (s: string) => parseInt(s.slice(1), 16);
const COUNTRY_COLORS = COUNTRY_DEFS.map((d) => hexColor(d.color));

function hash(i: number) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Смешение двух цветов: t = 0 — первый, 1 — второй. */
function mixColor(a: number, b: number, t: number) {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
function shade(color: number, k: number) {
  const r = Math.min(255, Math.max(0, ((color >> 16) & 255) * k));
  const g = Math.min(255, Math.max(0, ((color >> 8) & 255) * k));
  const b = Math.min(255, Math.max(0, (color & 255) * k));
  return (r << 16) | (g << 8) | b;
}

const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

const backOut = (p: number) => 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2);

export class MapView {
  app = new Application();
  world = new Container();
  /** Красивости: облака, волны, пульсации. Выключаются в настройках для слабых телефонов. */
  fancy = true;
  private waterG = new Graphics();
  private waveA = new Graphics();
  private waveB = new Graphics();
  private coastG = new Graphics();
  private glowG = new Graphics();
  private previewG = new Graphics();
  private hoverG = new Graphics();
  private selRing = new Graphics();
  private pingG = new Graphics();
  private progressG = new Graphics();
  private cloudLayer = new Container();
  private clouds: { sp: Sprite; shadow: Sprite; v: number }[] = [];
  private hoverTile = -1;
  private vel = { x: 0, y: 0, t: 0 }; // инерция после перетаскивания (пикс/мс)
  private zoomGoal: { z: number; sx: number; sy: number } | null = null;
  private panKeys = new Set<string>();
  private lastTap = { t: 0, x: 0, y: 0 };
  private popIn = false; // новые здания появляются с анимацией (но не при загрузке партии)
  private buildKeys = new Map<number, string>();
  private progressTiles: number[] = [];
  private shownProgress = new Map<number, number>();
  private terrainG = new Graphics();
  private ownerG = new Graphics();
  private borderG = new Graphics();
  private selG = new Graphics();
  private cityG = new Graphics();
  private cityLabels = new Container();
  private countryLabels = new Container();
  private buildLayer = new Container();
  private battleLayer = new Container();
  private wonderLayer = new Container();
  private fxLayer = new Container();
  private wonderSprites = new Map<string, Sprite>();
  /** Живые эффекты: всплывающие значки, вспышки регионов, взрывы над боями, ракеты и ядерные грибы. */
  private effects: { obj: Container; t: number; life: number; kind: 'float' | 'flash' | 'boom' | 'anim'; y0: number; upd?: (p: number) => void; keep?: boolean }[] = [];
  private falloutG = new Graphics();
  private falloutSprites = new Map<number, Sprite>();
  private falloutKey = '';
  private screenFlash = new Graphics();
  private shake = 0;
  private boomTimer = 0;
  private labelByRegion = new Map<number, Text>();
  private countryText = new Map<number, Text>();
  private buildSprites = new Map<number, Sprite>();
  private battleSprites = new Map<number, Sprite>();
  private textures = new Map<string, Texture>();
  private game: GameState | null = null;
  private selected = -1;
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; t: number; moved: boolean } | null = null;
  private pinchDist = 0;
  private tween: { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; t: number; dur: number } | null = null;
  onTap: ((tile: number) => void) | null = null;
  ready = false;

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host,
      antialias: true,
      background: 0x0f2f4f,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';
    this.app.canvas.style.cursor = 'grab';
    this.app.stage.addChild(this.world);
    const ocean = new Graphics().rect(-WORLD_W, -200, WORLD_W * 3, WORLD_H + 400).fill(DEEP_SEA);
    this.world.addChild(
      ocean, this.waterG, this.waveA, this.waveB, this.coastG, this.terrainG, this.ownerG, this.previewG, this.falloutG, this.fxLayer,
      this.glowG, this.borderG, this.selG, this.hoverG, this.selRing, this.pingG, this.cityG, this.buildLayer, this.progressG,
      this.wonderLayer, this.battleLayer, this.cloudLayer, this.cityLabels, this.countryLabels,
    );
    this.screenFlash.alpha = 0;
    this.app.stage.addChild(this.screenFlash);
    this.drawWater();
    this.drawTerrain();
    this.makeClouds();
    this.bindInput();
    this.app.ticker.add(() => this.frame());
    window.addEventListener('resize', () => this.clamp());
    this.ready = true;
  }

  // ---------- вода: глубина, пена у берегов, волны ----------
  private drawWater() {
    // расстояние до суши (в клетках) — чем дальше от берега, тем темнее море
    const depth = new Int16Array(N).fill(99);
    const queue: number[] = [];
    for (let t = 0; t < N; t++) {
      if (!isWater(t)) {
        depth[t] = 0;
        queue.push(t);
      }
    }
    for (let h = 0; h < queue.length; h++) {
      const t = queue[h];
      for (let d = 0; d < 6; d++) {
        const n = NEIGH[t * 6 + d];
        if (n >= 0 && depth[n] > depth[t] + 1) {
          depth[n] = depth[t] + 1;
          queue.push(n);
        }
      }
    }
    const w = this.waterG;
    for (let t = 0; t < N; t++) {
      if (TERRAIN[t] !== 'o') continue;
      const [cx, cy] = tileCenter(t);
      const k = 1.1 - Math.min(depth[t], 9) * 0.032 + (hash(t + 3) - 0.5) * 0.05;
      w.poly(CORNERS.flatMap(([x, y]) => [cx + x * 1.01, cy + y * 1.01])).fill(shade(TERRAIN_COLOR.o, k));
    }
    // пена прибоя: мягкое мелководье и светлая линия по кромке берега
    const c = this.coastG;
    const edge = (k: number) => {
      for (let t = 0; t < N; t++) {
        if (!isWater(t)) continue;
        const [cx, cy] = tileCenter(t);
        for (let d = 0; d < 6; d++) {
          const n = NEIGH[t * 6 + d];
          if (n < 0 || isWater(n)) continue;
          const [a, b] = EDGE[d];
          c.moveTo(cx + CORNERS[a][0] * k, cy + CORNERS[a][1] * k).lineTo(cx + CORNERS[b][0] * k, cy + CORNERS[b][1] * k);
        }
      }
    };
    edge(0.78);
    c.stroke({ width: 4.5, color: 0x9fe3f5, alpha: 0.2, cap: 'round' });
    edge(0.95);
    c.stroke({ width: 1.1, color: 0xeefaff, alpha: 0.7, cap: 'round' });
    // барашки в открытом море — два слоя мерцают по очереди
    for (let t = 0; t < N; t++) {
      if (TERRAIN[t] !== 'o' || depth[t] < 3 || hash(t + 11) < 0.88) continue;
      const g = hash(t + 13) > 0.5 ? this.waveA : this.waveB;
      const [cx, cy] = tileCenter(t);
      const x = cx + (hash(t + 17) - 0.5) * 8, y = cy + (hash(t + 19) - 0.5) * 6;
      g.moveTo(x - 4.5, y).quadraticCurveTo(x - 2.25, y - 2.2, x, y).quadraticCurveTo(x + 2.25, y - 2.2, x + 4.5, y);
    }
    for (const g of [this.waveA, this.waveB]) g.stroke({ width: 0.9, color: 0xcfeaff, alpha: 0.6, cap: 'round' });
  }

  /** Облака плывут над картой и видны, когда карта отдалена. */
  private makeClouds() {
    for (let i = 0; i < 18; i++) {
      const g = new Graphics();
      const puffs = 6 + Math.floor(hash(i * 31 + 1) * 6);
      const w = 70 + hash(i * 7 + 3) * 90;
      for (let k = 0; k < puffs; k++) {
        const u = k / (puffs - 1);
        const r = (12 + hash(i * 97 + k * 7) * 16) * (1 - Math.abs(u - 0.5) * 0.9);
        g.circle((u - 0.5) * w, (hash(i * 53 + k * 11) - 0.5) * 14 - r * 0.3, r).fill({ color: 0xffffff, alpha: 0.4 });
      }
      g.ellipse(0, 4, w * 0.42, 12).fill({ color: 0xffffff, alpha: 0.5 });
      g.filters = [new BlurFilter({ strength: 7, quality: 3 })];
      const pad = 30;
      const frame = new Rectangle(-w / 2 - 40 - pad, -50 - pad, w + 80 + pad * 2, 90 + pad * 2);
      const tex = this.app.renderer.generateTexture({ target: g, resolution: 1, frame });
      g.destroy();
      const shadow = new Sprite(tex);
      shadow.tint = 0x000000;
      shadow.alpha = 0.16;
      const sp = new Sprite(tex);
      for (const s of [shadow, sp]) s.anchor.set(0.5);
      sp.position.set(hash(i * 5 + 9) * WORLD_W, 40 + hash(i * 3 + 5) * (WORLD_H - 80));
      this.cloudLayer.addChild(shadow);
      this.clouds.push({ sp, shadow, v: 0.004 + hash(i + 77) * 0.006 });
    }
    for (const c of this.clouds) this.cloudLayer.addChild(c.sp);
  }

  // ---------- рельеф ----------
  private drawTerrain() {
    const g = this.terrainG;
    for (let t = 0; t < N; t++) {
      const ter = TERRAIN[t];
      if (ter === 'o') continue;
      const [cx, cy] = tileCenter(t);
      const color = shade(TERRAIN_COLOR[ter], 0.93 + hash(t) * 0.14);
      g.poly(CORNERS.flatMap(([x, y]) => [cx + x * 1.01, cy + y * 1.01])).fill(color);
    }
    // декор местности
    for (let t = 0; t < N; t++) {
      const ter = TERRAIN[t];
      const [cx, cy] = tileCenter(t);
      const h = hash(t + 7);
      if (ter === 'm') {
        g.poly([cx - 7, cy + 5, cx - 1, cy - 6, cx + 5, cy + 5]).fill(0x6d6152);
        g.poly([cx - 3.2, cy - 1.5, cx - 1, cy - 6, cx + 1.2, cy - 1.5]).fill(0xf4f4f0);
        g.poly([cx + 1, cy + 5, cx + 4.5, cy - 2, cx + 8, cy + 5]).fill(0x7c6f5d);
        g.poly([cx + 3.4, cy + 0.6, cx + 4.5, cy - 2, cx + 5.6, cy + 0.6]).fill(0xf4f4f0);
      } else if (ter === 'f') {
        const pts = [[-4, -1], [3, -3], [0, 4], [5, 3]];
        for (const [dx, dy] of pts.slice(0, 3 + (h > 0.5 ? 1 : 0))) {
          const x = cx + dx, y = cy + dy;
          g.poly([x - 2.6, y + 2.5, x, y - 3.5, x + 2.6, y + 2.5]).fill(0x2f6a2c);
        }
      } else if (ter === 'd' && h > 0.45) {
        g.ellipse(cx - 2 + h * 4, cy + 2, 4, 1.3).fill(0xcfb173);
      } else if (ter === 't') {
        g.circle(cx - 3, cy + 1, 0.9).fill(0x6f7b67);
        g.circle(cx + 2.5, cy - 2, 0.9).fill(0x6f7b67);
      } else if (ter === 'g' && h > 0.7) {
        g.poly([cx - 1, cy + 2, cx, cy - 1, cx + 1, cy + 2]).fill(0x5f8f3a);
      }
    }
    // сетка на суше
    for (let t = 0; t < N; t++) {
      if (isWater(t)) continue;
      const [cx, cy] = tileCenter(t);
      for (const [a, b] of [[0, 1], [1, 2], [2, 3]]) {
        g.moveTo(cx + CORNERS[a][0], cy + CORNERS[a][1]).lineTo(cx + CORNERS[b][0], cy + CORNERS[b][1]);
      }
    }
    g.stroke({ width: 0.5, color: 0x000000, alpha: 0.13 });
  }

  // ---------- границы и города ----------
  private ownerOf(t: number): number {
    if (t < 0 || isWater(t)) return -2;
    return this.game!.regions[REGION_OF[t]].owner;
  }

  private drawOwnership() {
    const fill = this.ownerG;
    const border = this.borderG;
    fill.clear();
    border.clear();
    const segs = new Map<number, number[]>();
    for (let t = 0; t < N; t++) {
      if (isWater(t)) continue;
      const owner = this.ownerOf(t);
      const [cx, cy] = tileCenter(t);
      if (owner >= 0) fill.poly(CORNERS.flatMap(([x, y]) => [cx + x, cy + y])).fill({ color: COUNTRY_COLORS[owner], alpha: 0.3 });
      for (let d = 0; d < 6; d++) {
        const n = NEIGH[t * 6 + d];
        const on = this.ownerOf(n);
        const [a, b] = EDGE[d];
        if (on !== owner && owner >= 0) {
          let arr = segs.get(owner);
          if (!arr) segs.set(owner, (arr = []));
          const k = 0.86;
          arr.push(cx + CORNERS[a][0] * k, cy + CORNERS[a][1] * k, cx + CORNERS[b][0] * k, cy + CORNERS[b][1] * k);
        } else if (on === owner && n >= 0 && REGION_OF[n] !== REGION_OF[t] && d < 3) {
          border.moveTo(cx + CORNERS[a][0], cy + CORNERS[a][1]).lineTo(cx + CORNERS[b][0], cy + CORNERS[b][1]);
        }
      }
    }
    border.stroke({ width: 0.8, color: 0xffffff, alpha: 0.3 });
    for (const arr of segs.values()) {
      for (let i = 0; i < arr.length; i += 4) border.moveTo(arr[i], arr[i + 1]).lineTo(arr[i + 2], arr[i + 3]);
    }
    border.stroke({ width: 3.6, color: 0x000000, alpha: 0.3, cap: 'round' });
    for (const [owner, arr] of segs) {
      for (let i = 0; i < arr.length; i += 4) border.moveTo(arr[i], arr[i + 1]).lineTo(arr[i + 2], arr[i + 3]);
      border.stroke({ width: 2.2, color: shade(COUNTRY_COLORS[owner], 1.15), cap: 'round' });
    }
    // своя страна — в золотом ореоле
    const glow = this.glowG.clear();
    const mine = segs.get(this.game!.player) ?? [];
    for (let i = 0; i < mine.length; i += 4) glow.moveTo(mine[i], mine[i + 1]).lineTo(mine[i + 2], mine[i + 3]);
    glow.stroke({ width: 8, color: 0xf2cf6b, alpha: 0.55, cap: 'round' });
    glow.stroke({ width: 4.5, color: 0xfff1c2, alpha: 0.6, cap: 'round' });
    this.drawCities();
    this.drawCountryLabels();
  }

  private drawCities() {
    const gm = this.game!;
    const g = this.cityG;
    g.clear();
    REGIONS.forEach((reg) => {
      const owner = gm.regions[reg.id].owner;
      if (owner < 0) return;
      const [cx, cy] = tileCenter(reg.center);
      const isCap = gm.countries[owner].capital === reg.id;
      const color = COUNTRY_COLORS[owner];
      if (isCap) {
        g.circle(cx, cy, 6).fill(0x1a1408).stroke({ width: 2, color: 0xf2cf6b });
        g.star(cx, cy, 5, 4.2, 1.9).fill(0xf2cf6b);
      } else {
        g.circle(cx, cy, 4.2).fill(color).stroke({ width: 1.4, color: 0xffffff });
      }
      if (!reg.isCity) return;
      let label = this.labelByRegion.get(reg.id);
      if (!label) {
        label = new Text({
          text: reg.name,
          style: { fontFamily: 'PT Sans, sans-serif', fontSize: 30, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x0b1626, width: 6 } },
          resolution: 2,
        });
        label.anchor.set(0.5, 0);
        label.position.set(cx, cy + 6);
        this.cityLabels.addChild(label);
        this.labelByRegion.set(reg.id, label);
      }
      label.tint = isCap ? 0xffe9a8 : 0xffffff;
    });
    this.cullZoom = 0;
  }

  /** Подписи городов одного экранного размера; пересекающиеся прячем (столицы и крупные — важнее). */
  private cullZoom = 0;
  private cullLabels() {
    const gm = this.game;
    if (!gm) return;
    const z = this.world.scale.x;
    this.cullZoom = z;
    const sc = 0.4 / z;
    const items = [...this.labelByRegion.entries()].map(([rid, label]) => {
      const owner = gm.regions[rid].owner;
      const cap = owner >= 0 && gm.countries[owner].capital === rid;
      return { label, owner, pri: (cap ? 1e15 : 0) + gm.regions[rid].pop };
    });
    items.sort((a, b) => b.pri - a.pri);
    const placed: number[] = [];
    const pad = 2 / z;
    for (const { label, owner } of items) {
      label.scale.set(sc);
      if (owner < 0) {
        label.visible = false;
        continue;
      }
      const w = label.width, h = label.height;
      const x1 = label.x - w / 2 - pad, x2 = label.x + w / 2 + pad, y1 = label.y - pad, y2 = label.y + h + pad;
      let hit = false;
      for (let i = 0; i < placed.length; i += 4) {
        if (x1 < placed[i + 2] && x2 > placed[i] && y1 < placed[i + 3] && y2 > placed[i + 1]) {
          hit = true;
          break;
        }
      }
      label.visible = !hit;
      if (!hit) placed.push(x1, y1, x2, y2);
    }
    // страны: своя всегда видна, дальше — по размеру
    const cs = Math.min(1.2, 0.3 / z);
    const boxes: number[] = [];
    const size = (i: number) => (i === gm.player ? 1e9 : this.countrySize.get(i) ?? 0);
    const list = [...this.countryText.entries()].filter(([i]) => gm.countries[i].alive && size(i) > 0).sort((a, b) => size(b[0]) - size(a[0]));
    for (const [, label] of list) {
      label.scale.set(cs);
      const w = label.width / 2 + 4 / z, h = label.height / 2;
      const hit = boxes.some((_, k) => k % 4 === 0 && label.x - w < boxes[k + 2] && label.x + w > boxes[k] && label.y - h < boxes[k + 3] && label.y + h > boxes[k + 1]);
      label.visible = !hit;
      if (!hit) boxes.push(label.x - w, label.y - h, label.x + w, label.y + h);
    }
  }

  private countrySize = new Map<number, number>();
  private drawCountryLabels() {
    const gm = this.game!;
    gm.countries.forEach((c, i) => {
      let label = this.countryText.get(i);
      if (!c.alive) {
        if (label) label.visible = false;
        this.countrySize.set(i, 0);
        return;
      }
      const xs: number[] = [], ys: number[] = [];
      gm.regions.forEach((r, rid) => {
        if (r.owner !== i) return;
        for (const t of REGIONS[rid].tiles) {
          const [x, y] = tileCenter(t);
          xs.push(x);
          ys.push(y);
        }
      });
      this.countrySize.set(i, xs.length);
      if (!xs.length) return;
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      if (!label) {
        label = new Text({
          text: COUNTRY_DEFS[i].name.toUpperCase(),
          style: { fontFamily: '"Cormorant SC", Georgia, serif', fontSize: 64, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x0b1626, width: 8 }, letterSpacing: 4 },
          resolution: 2,
        });
        label.anchor.set(0.5);
        this.countryLabels.addChild(label);
        this.countryText.set(i, label);
      }
      label.visible = true;
      label.position.set(xs[xs.length >> 1], ys[ys.length >> 1]);
    });
  }

  // ---------- здания ----------
  private texture(key: string, emoji: string, level: number, building: boolean): Texture {
    let tex = this.textures.get(key);
    if (tex) return tex;
    const c = new Container();
    const bg = new Graphics()
      .circle(32, 32, 28)
      .fill({ color: 0x0e1c30, alpha: 0.88 })
      .stroke({ width: 4, color: level >= 3 ? 0xf2cf6b : level === 2 ? 0xd9dee8 : 0xb07a43, alpha: building ? 0.5 : 1 });
    const txt = new Text({ text: emoji, style: { fontFamily: EMOJI_FONT, fontSize: 32 }, resolution: 2 });
    txt.anchor.set(0.5);
    txt.position.set(32, 33);
    txt.alpha = building ? 0.45 : 1;
    c.addChild(bg, txt);
    for (let i = 0; i < level; i++) {
      c.addChild(new Graphics().circle(32 + (i - (level - 1) / 2) * 11, 62, 4.5).fill(0xf2cf6b).stroke({ width: 1.5, color: 0x0e1c30 }));
    }
    if (building) {
      const h = new Text({ text: '🔨', style: { fontFamily: EMOJI_FONT, fontSize: 22 }, resolution: 2 });
      h.anchor.set(0.5);
      h.position.set(48, 16);
      c.addChild(h);
    }
    tex = this.app.renderer.generateTexture({ target: c, resolution: 2 });
    this.textures.set(key, tex);
    c.destroy({ children: true });
    return tex;
  }

  private syncBuildings() {
    const gm = this.game!;
    const seen = new Set<number>();
    for (const key in gm.buildings) {
      const tile = +key;
      const b = gm.buildings[tile];
      seen.add(tile);
      const building = b.progress > 0;
      const shownLevel = building && b.level > 1 ? b.level - 1 : b.level;
      const tkey = `${b.type}-${shownLevel}-${building ? 1 : 0}`;
      const tex = this.texture(tkey, BUILDINGS[b.type as BuildingType].icon, shownLevel, building);
      let sp = this.buildSprites.get(tile);
      if (!sp) {
        sp = new Sprite(tex);
        sp.anchor.set(0.5);
        const [cx, cy] = tileCenter(tile);
        sp.position.set(cx, cy);
        sp.scale.set(0.2);
        this.buildLayer.addChild(sp);
        this.buildSprites.set(tile, sp);
        if (this.popIn && this.fancy) this.bounce(sp, 'in');
      } else if (sp.texture !== tex) {
        // стройка закончилась — здание подпрыгивает, расходится золотое кольцо
        if (this.buildKeys.get(tile)?.endsWith('-1') && !building && this.fancy) {
          this.bounce(sp, 'done');
          this.ring(tile, 0xf2cf6b);
        }
        sp.texture = tex;
      }
      this.buildKeys.set(tile, tkey);
    }
    for (const [tile, sp] of this.buildSprites) {
      if (!seen.has(tile)) {
        sp.destroy();
        this.buildSprites.delete(tile);
        this.buildKeys.delete(tile);
      }
    }
  }

  /** Свои стройки — для колец прогресса. */
  private syncProgress() {
    const gm = this.game!;
    this.progressTiles = [];
    for (const key in gm.buildings) {
      if (gm.buildings[+key].progress > 0 && gm.regions[REGION_OF[+key]].owner === gm.player) this.progressTiles.push(+key);
    }
  }

  private drawProgress(dt: number) {
    const g = this.progressG.clear();
    const gm = this.game;
    if (!gm || this.world.scale.x < 0.8) return;
    for (const tile of this.progressTiles) {
      const b = gm.buildings[tile];
      if (!b || b.progress <= 0) {
        this.shownProgress.delete(tile);
        continue;
      }
      const target = 1 - b.progress / b.total;
      let v = this.shownProgress.get(tile) ?? target;
      v += (target - v) * Math.min(1, dt / 350);
      this.shownProgress.set(tile, v);
      const [cx, cy] = tileCenter(tile);
      g.circle(cx, cy, 7.6).stroke({ width: 1.8, color: 0x0e1c30, alpha: 0.7 });
      // без moveTo дуга тянула бы линию от начала координат
      if (v > 0.01) g.moveTo(cx, cy - 7.6).arc(cx, cy, 7.6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v).stroke({ width: 1.5, color: 0xf2cf6b, cap: 'round' });
    }
  }

  /** Здание «выпрыгивает» на карту (in) или подпрыгивает по готовности (done). */
  private bounce(sp: Sprite, mode: 'in' | 'done') {
    this.effects.push({
      obj: sp, t: 0, life: mode === 'in' ? 600 : 700, kind: 'anim', y0: 0, keep: true,
      upd: (p) => {
        if (sp.destroyed) return;
        sp.scale.set(mode === 'in' ? 0.2 * Math.max(0, backOut(p)) : 0.2 * (1 + 0.45 * Math.sin(p * Math.PI) * (1 - p)));
      },
    });
  }

  /** Расходящееся кольцо от клетки. */
  private ring(tile: number, color: number) {
    const g = new Graphics();
    const [cx, cy] = tileCenter(tile);
    g.position.set(cx, cy);
    this.battleLayer.addChild(g);
    this.effects.push({
      obj: g, t: 0, life: 900, kind: 'anim', y0: 0,
      upd: (p) => {
        const e = 1 - Math.pow(1 - p, 3);
        g.clear().circle(0, 0, 5 + e * 18).stroke({ width: 2.4 * (1 - p) + 0.4, color, alpha: 1 - p });
      },
    });
  }

  /** Эмодзи без подложки (для эффектов). */
  private plainTexture(key: string, emoji: string): Texture {
    let tex = this.textures.get(key);
    if (tex) return tex;
    const txt = new Text({ text: emoji, style: { fontFamily: EMOJI_FONT, fontSize: 48 }, resolution: 2 });
    tex = this.app.renderer.generateTexture({ target: txt, resolution: 2 });
    this.textures.set(key, tex);
    txt.destroy();
    return tex;
  }

  /** Значок чуда света: золотое двойное кольцо. */
  private wonderTexture(id: string, emoji: string): Texture {
    const key = `wonder-${id}`;
    let tex = this.textures.get(key);
    if (tex) return tex;
    const c = new Container();
    c.addChild(new Graphics().circle(34, 34, 31).fill({ color: 0x1a1408, alpha: 0.92 }).stroke({ width: 5, color: 0xf2cf6b }));
    c.addChild(new Graphics().circle(34, 34, 24).stroke({ width: 1.5, color: 0xf2cf6b, alpha: 0.6 }));
    const txt = new Text({ text: emoji, style: { fontFamily: EMOJI_FONT, fontSize: 32 }, resolution: 2 });
    txt.anchor.set(0.5);
    txt.position.set(34, 35);
    c.addChild(txt);
    tex = this.app.renderer.generateTexture({ target: c, resolution: 2 });
    this.textures.set(key, tex);
    c.destroy({ children: true });
    return tex;
  }

  private syncWonders() {
    const gm = this.game!;
    for (const [id, w] of Object.entries(gm.wonders)) {
      const def = WONDER_BY_ID[id];
      if (!def || this.wonderSprites.has(id)) continue;
      const sp = new Sprite(this.wonderTexture(id, def.icon));
      sp.anchor.set(0.5);
      const [cx, cy] = tileCenter(REGIONS[w.region].center);
      sp.position.set(cx + 9, cy - 9);
      sp.scale.set(0.24);
      this.wonderLayer.addChild(sp);
      this.wonderSprites.set(id, sp);
    }
  }

  // ---------- эффекты ----------
  private spawnEffects() {
    while (mapFx.length) {
      const e = mapFx.shift()!;
      if (e.tile < 0) continue;
      if (e.kind === 'flash') {
        this.flashRegion(e.tile, e.color ?? 0xffffff);
      } else if (e.kind === 'missile') {
        this.spawnMissile(e.from ?? e.tile, e.tile);
      } else if (e.kind === 'nuke') {
        this.spawnNuke(e.tile, !!e.big, !!e.near);
      } else {
        const sp = new Sprite(this.plainTexture(`fx-${e.text}`, e.text ?? '✨'));
        sp.anchor.set(0.5, 1);
        const [cx, cy] = tileCenter(e.tile);
        sp.position.set(cx, cy - 4);
        this.battleLayer.addChild(sp);
        this.effects.push({ obj: sp, t: 0, life: 1900, kind: 'float', y0: cy - 4 });
      }
    }
  }

  private flashRegion(tile: number, color: number) {
    const g = new Graphics();
    for (const t of REGIONS[REGION_OF[tile]].tiles) {
      const [cx, cy] = tileCenter(t);
      g.poly(CORNERS.flatMap(([x, y]) => [cx + x, cy + y])).fill(color);
    }
    g.alpha = 0;
    this.fxLayer.addChild(g);
    this.effects.push({ obj: g, t: 0, life: 1600, kind: 'flash', y0: 0 });
  }

  /** Ракета летит по дуге от столицы к цели и оставляет след. */
  private spawnMissile(from: number, to: number) {
    const [x0, y0] = tileCenter(from), [x1, y1] = tileCenter(to);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - Math.max(30, Math.hypot(x1 - x0, y1 - y0) * 0.35);
    const at = (t: number): [number, number] => {
      const u = 1 - t;
      return [u * u * x0 + 2 * u * t * mx + t * t * x1, u * u * y0 + 2 * u * t * my + t * t * y1];
    };
    const c = new Container();
    const trail = new Graphics();
    const head = new Graphics()
      .circle(0, 0, 13).fill({ color: 0xff5a36, alpha: 0.18 })
      .circle(0, 0, 8).fill({ color: 0xffb24a, alpha: 0.45 })
      .circle(0, 0, 4).fill(0xfff2c8);
    head.blendMode = 'add';
    c.addChild(trail, head);
    this.battleLayer.addChild(c);
    const fly = 0.85; // остаток жизни эффекта — след тает
    this.effects.push({
      obj: c, t: 0, life: 3000, kind: 'anim', y0: 0,
      upd: (p) => {
        const k = Math.min(1, p / fly);
        trail.clear().moveTo(x0, y0);
        for (let i = 1; i <= 28; i++) {
          const [x, y] = at((i / 28) * k);
          trail.lineTo(x, y);
        }
        const fade = p < fly ? 1 : 1 - (p - fly) / (1 - fly);
        trail.stroke({ width: 6, color: 0xff8a3c, alpha: 0.18 * fade });
        trail.stroke({ width: 2.2, color: 0xffe0b0, alpha: 0.85 * fade });
        const [hx, hy] = at(k);
        head.position.set(hx, hy);
        head.visible = p < fly;
        head.scale.set(1 + Math.sin(p * 70) * 0.18);
      },
    });
  }

  /** Ядерный взрыв: вспышка, огненный шар, ударные волны и поднимающийся гриб. */
  private spawnNuke(tile: number, big: boolean, near: boolean) {
    const [cx, cy] = tileCenter(tile);
    const R = big ? 34 : 22;
    this.flashRegion(tile, 0xfff4d0);
    const c = new Container();
    c.position.set(cx, cy);
    const rings = new Graphics();
    const fire = new Graphics()
      .circle(0, 0, R).fill({ color: 0xff5a36, alpha: 0.35 })
      .circle(0, 0, R * 0.72).fill({ color: 0xff9a3c, alpha: 0.6 })
      .circle(0, 0, R * 0.45).fill({ color: 0xffd27a, alpha: 0.9 })
      .circle(0, 0, R * 0.22).fill(0xffffff);
    fire.blendMode = 'add';
    const stem = new Graphics(), cap = new Graphics();
    for (let i = 0; i < 7; i++) {
      stem.circle((hash(i + tile) - 0.5) * R * 0.12, -i * R * 0.22, R * (0.16 + i * 0.012)).fill(shade(0xffffff, 0.75 + hash(i * 3 + tile) * 0.25));
    }
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2, rr = R * (0.55 + hash(i + tile * 7) * 0.25);
      cap.circle(Math.cos(a) * rr * 0.95, -R * 1.55 + Math.sin(a) * rr * 0.32, R * (0.28 + hash(i * 5 + tile) * 0.14)).fill(shade(0xffffff, 0.7 + hash(i * 11 + tile) * 0.3));
    }
    cap.circle(0, -R * 1.55, R * 0.55).fill(0xffffff);
    const cloud = new Container();
    cloud.addChild(stem, cap);
    cloud.alpha = 0;
    c.addChild(rings, cloud, fire);
    this.battleLayer.addChild(c);
    this.effects.push({
      obj: c, t: 0, life: big ? 6500 : 5200, kind: 'anim', y0: 0,
      upd: (p) => {
        const cp = Math.max(0, (p - 0.04) / 0.96);
        const rise = 1 - Math.pow(1 - Math.min(1, cp / 0.6), 3);
        // огненный шар вспыхивает, всплывает и остывает
        fire.scale.set(0.3 + 0.9 * Math.min(1, p / 0.08) + p * 0.4);
        fire.alpha = p < 0.08 ? 1 : Math.max(0, 1 - (p - 0.08) / 0.35);
        fire.y = -R * 1.4 * rise;
        // две ударные волны
        rings.clear();
        for (const [delay, w] of [[0.02, 2.4], [0.1, 1.4]]) {
          const q = (p - delay) / 0.5;
          if (q <= 0 || q >= 1) continue;
          rings.circle(0, 0, R * (0.6 + q * (big ? 6 : 4.5))).stroke({ width: w, color: 0xfff2d8, alpha: 0.8 * (1 - q) });
        }
        // гриб растёт из земли, темнеет и рассеивается
        cloud.alpha = Math.min(1, cp / 0.08) * (p > 0.75 ? (1 - p) / 0.25 : 1);
        cloud.scale.set(0.35 + rise * 0.75, 0.2 + rise * 0.85);
        cloud.tint = mixColor(0xffaa5a, 0x968c87, Math.min(1, cp / 0.5));
      },
    });
    if (near) {
      this.screenFlash.clear().rect(0, 0, this.app.screen.width, this.app.screen.height).fill(0xfff6e0);
      this.screenFlash.alpha = 0.95;
      this.shake = 800;
      this.focusTile(tile, Math.max(1.3, this.world.scale.x));
    }
  }

  /** Метки радиоактивного заражения: зеленоватая заливка региона и значок радиации. */
  private syncFallout() {
    const gm = this.game!;
    const live = Object.keys(gm.fallout).filter((k) => gm.fallout[+k] > gm.day);
    const key = live.join(',');
    if (key === this.falloutKey) return;
    this.falloutKey = key;
    const set = new Set(live.map(Number));
    const g = this.falloutG.clear();
    for (const rid of set) {
      for (const t of REGIONS[rid].tiles) {
        const [cx, cy] = tileCenter(t);
        g.poly(CORNERS.flatMap(([x, y]) => [cx + x, cy + y])).fill({ color: 0xb6f36a, alpha: 0.22 });
      }
      if (this.falloutSprites.has(rid)) continue;
      const sp = new Sprite(this.plainTexture('fx-rad', '\u2622\ufe0f'));
      sp.anchor.set(0.5);
      const [cx, cy] = tileCenter(REGIONS[rid].center);
      sp.position.set(cx - 9, cy - 9);
      sp.scale.set(0.2);
      this.battleLayer.addChild(sp);
      this.falloutSprites.set(rid, sp);
    }
    for (const [rid, sp] of this.falloutSprites) {
      if (set.has(rid)) continue;
      sp.destroy();
      this.falloutSprites.delete(rid);
    }
  }

  private animateEffects(dt: number) {
    const z = this.world.scale.x;
    // взрывы над идущими боями
    this.boomTimer -= dt;
    if (this.boomTimer <= 0 && this.battleSprites.size && z >= 0.6) {
      this.boomTimer = 260;
      const sprites = [...this.battleSprites.values()];
      const at = sprites[Math.floor(Math.random() * sprites.length)];
      const sp = new Sprite(this.plainTexture('fx-boom', Math.random() < 0.7 ? '💥' : '🔥'));
      sp.anchor.set(0.5);
      sp.position.set(at.x + (Math.random() - 0.5) * 18, at.y + 10 + (Math.random() - 0.5) * 14);
      this.battleLayer.addChildAt(sp, 0);
      this.effects.push({ obj: sp, t: 0, life: 520, kind: 'boom', y0: sp.y });
    }
    for (let k = this.effects.length - 1; k >= 0; k--) {
      const f = this.effects[k];
      f.t += dt;
      const p = f.t / f.life;
      if (p >= 1) {
        if (f.keep) f.upd?.(1);
        else f.obj.destroy({ children: true });
        this.effects.splice(k, 1);
        continue;
      }
      if (f.kind === 'anim') {
        f.upd!(p);
      } else if (f.kind === 'flash') {
        // вспыхивает и плавно гаснет
        f.obj.alpha = p < 0.12 ? (p / 0.12) * 0.65 : 0.65 * (1 - (p - 0.12) / 0.88);
      } else if (f.kind === 'float') {
        const sc = Math.min(1.2, 0.45 / z) * (p < 0.15 ? 0.5 + (p / 0.15) * 0.5 : 1);
        f.obj.scale.set(sc);
        f.obj.y = f.y0 - (p * 26) / Math.max(0.6, z);
        f.obj.alpha = p > 0.65 ? (1 - p) / 0.35 : 1;
      } else {
        f.obj.scale.set(0.12 + p * 0.12);
        f.obj.alpha = 1 - p;
      }
    }
  }

  private syncBattles() {
    const gm = this.game!;
    const seen = new Set<number>();
    for (const bt of gm.battles) {
      seen.add(bt.id);
      if (this.battleSprites.has(bt.id)) continue;
      const tex = this.texture('battle', '⚔️', 0, false);
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      const [cx, cy] = tileCenter(REGIONS[bt.region].center);
      sp.position.set(cx, cy - 10);
      sp.scale.set(0.3);
      this.battleLayer.addChild(sp);
      this.battleSprites.set(bt.id, sp);
    }
    for (const [id, sp] of this.battleSprites) {
      if (!seen.has(id)) {
        sp.destroy();
        this.battleSprites.delete(id);
      }
    }
  }

  // ---------- выделение ----------
  select(tile: number) {
    this.selected = tile;
    const g = this.selG;
    g.clear();
    this.selRing.clear();
    if (tile < 0 || isWater(tile)) return;
    const rid = REGION_OF[tile];
    for (const t of REGIONS[rid].tiles) {
      const [cx, cy] = tileCenter(t);
      g.poly(CORNERS.flatMap(([x, y]) => [cx + x, cy + y])).fill({ color: 0xffffff, alpha: 0.15 });
    }
    const [cx, cy] = tileCenter(tile);
    const hex = CORNERS.flatMap(([x, y]) => [x * 0.92, y * 0.92]);
    this.selRing.position.set(cx, cy);
    this.selRing.poly(hex).stroke({ width: 3.6, color: 0x000000, alpha: 0.35 });
    this.selRing.poly(hex).stroke({ width: 2.2, color: 0xffffff });
    this.selAt = performance.now();
  }
  private selAt = 0;

  /** Подсветка страны на стартовом экране: заливка, граница и камера на неё. */
  preview(ci: number, area?: { x: number; y: number; w: number; h: number }) {
    const g = this.previewG.clear();
    if (ci < 0) return;
    const set = new Set<number>();
    REGIONS.forEach((r) => { if (r.origOwner === ci) for (const t of r.tiles) set.add(t); });
    if (!set.size) return;
    const color = COUNTRY_COLORS[ci];
    const xs: number[] = [], ys: number[] = [];
    for (const t of set) {
      const [cx, cy] = tileCenter(t);
      g.poly(CORNERS.flatMap(([x, y]) => [cx + x, cy + y])).fill({ color, alpha: 0.5 });
      xs.push(cx);
      ys.push(cy);
    }
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const q = (arr: number[], k: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * k))];
    const x0 = q(xs, 0.05), x1 = q(xs, 0.95), y0 = q(ys, 0.05), y1 = q(ys, 0.95);
    for (const t of set) {
      const [cx, cy] = tileCenter(t);
      for (let d = 0; d < 6; d++) {
        const n = NEIGH[t * 6 + d];
        if (set.has(n)) continue;
        const [a, b] = EDGE[d];
        g.moveTo(cx + CORNERS[a][0] * 0.9, cy + CORNERS[a][1] * 0.9).lineTo(cx + CORNERS[b][0] * 0.9, cy + CORNERS[b][1] * 0.9);
      }
    }
    g.stroke({ width: 7, color: 0xf2cf6b, alpha: 0.35, cap: 'round' });
    g.stroke({ width: 2.6, color: shade(color, 1.3), cap: 'round' });
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const a = area ?? { x: 0, y: 0, w: sw, h: sh };
    const bw = x1 - x0 + 60, bh = y1 - y0 + 60;
    const z = Math.max(this.minZoom(), Math.min(1.3, (a.w * 0.8) / bw, (a.h * 0.8) / bh));
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const [tx, ty] = this.clampPos(a.x + a.w / 2 - mx * z, a.y + a.h / 2 - my * z, z);
    this.tween = { fx: this.world.x, fy: this.world.y, fz: this.world.scale.x, tx, ty, tz: z, t: 0, dur: 900 };
    this.zoomGoal = null;
  }
  get selectedTile() {
    return this.selected;
  }

  // ---------- игра ----------
  setGame(g: GameState | null) {
    this.game = g;
    this.select(-1);
    for (const sp of this.buildSprites.values()) sp.destroy();
    this.buildSprites.clear();
    for (const sp of this.battleSprites.values()) sp.destroy();
    this.battleSprites.clear();
    for (const sp of this.wonderSprites.values()) sp.destroy();
    this.wonderSprites.clear();
    for (const f of this.effects) if (!f.keep) f.obj.destroy({ children: true });
    this.effects = [];
    this.buildKeys.clear();
    this.shownProgress.clear();
    this.progressTiles = [];
    this.popIn = false;
    this.preview(-1);
    for (const sp of this.falloutSprites.values()) sp.destroy();
    this.falloutSprites.clear();
    this.falloutG.clear();
    this.falloutKey = '';
    mapFx.length = 0;
    if (!g) return;
    mapDirty.territory = true;
    mapDirty.buildings = true;
    this.update();
  }

  update() {
    if (!this.game || !this.ready) return;
    const dirty = mapDirty.territory || mapDirty.buildings;
    if (mapDirty.territory) {
      mapDirty.territory = false;
      this.drawOwnership();
    }
    if (mapDirty.buildings) {
      mapDirty.buildings = false;
      this.syncBuildings();
      this.syncWonders();
      this.popIn = true;
    }
    if (dirty) this.syncProgress();
    this.syncBattles();
    this.syncFallout();
    this.spawnEffects();
  }

  focusTile(tile: number, zoom = 1.6, animate = true) {
    const [cx, cy] = tileCenter(tile);
    const sw = this.app.screen.width, sh = this.app.screen.height;
    zoom = this.clampZoom(zoom);
    const [tx, ty] = this.clampPos(sw / 2 - cx * zoom, sh * 0.42 - cy * zoom, zoom);
    if (!animate) {
      this.world.scale.set(zoom);
      this.world.position.set(tx, ty);
      this.clamp();
      return;
    }
    this.tween = { fx: this.world.x, fy: this.world.y, fz: this.world.scale.x, tx, ty, tz: zoom, t: 0, dur: 550 };
    this.zoomGoal = null;
    this.vel.x = this.vel.y = 0;
  }

  /** Кнопки и клавиши: плавно приблизить/отдалить вокруг центра экрана. */
  zoomBy(factor: number) {
    const z = this.zoomGoal?.z ?? this.world.scale.x;
    this.tween = null;
    this.zoomGoal = { z: this.clampZoom(z * factor), sx: this.app.screen.width / 2, sy: this.app.screen.height * 0.45 };
  }

  /** К своей столице. */
  home() {
    const gm = this.game;
    if (!gm) return;
    const cap = REGIONS[gm.countries[gm.player].capital];
    if (cap) this.focusTile(cap.center, Math.max(1.5, this.world.scale.x));
  }

  /** Стрелки/WASD: dir — up/down/left/right, пока клавиша зажата. */
  keyPan(dir: string, down: boolean) {
    if (down) {
      this.panKeys.add(dir);
      this.tween = null;
    } else this.panKeys.delete(dir);
  }
  clearKeys() {
    this.panKeys.clear();
  }

  // ---------- кадр ----------
  private frame() {
    const dt = this.app.ticker.deltaMS;
    const now = performance.now();
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - Math.pow(-2 * tw.t + 2, 3) / 2;
      this.world.scale.set(tw.fz + (tw.tz - tw.fz) * e);
      this.world.position.set(tw.fx + (tw.tx - tw.fx) * e, tw.fy + (tw.ty - tw.fy) * e);
      if (tw.t >= 1) {
        this.tween = null;
        this.clamp();
      }
    }
    this.moveCamera(dt);
    this.update();
    const z = this.world.scale.x;
    if (Math.abs(z - this.cullZoom) / z > 0.03) this.cullLabels();
    this.buildLayer.visible = z >= 0.8;
    this.cityLabels.visible = z >= 0.95;
    this.countryLabels.visible = z < 0.75;
    const pulse = 0.3 + Math.sin(now / 180) * 0.04;
    for (const sp of this.battleSprites.values()) sp.scale.set(pulse);
    const glow = 0.65 + Math.sin(now / 400) * 0.25;
    for (const sp of this.falloutSprites.values()) sp.alpha = glow;
    this.animateWorld(now, dt, z);
    this.drawProgress(dt);
    if (this.screenFlash.alpha > 0) this.screenFlash.alpha = Math.max(0, this.screenFlash.alpha - dt / 1100);
    if (this.shake > 0) {
      this.shake -= dt;
      const a = Math.max(0, this.shake / 800) * 7;
      this.app.stage.position.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      if (this.shake <= 0) this.app.stage.position.set(0, 0);
    }
    this.animateEffects(dt);
  }

  /** Живая карта: море, облака, ореол своей страны, пульс выделения, «радар» над столицей. */
  private animateWorld(now: number, dt: number, z: number) {
    const fancy = this.fancy;
    const s = Math.sin(now / 1500);
    this.waveA.visible = this.waveB.visible = z >= 0.45;
    this.waveA.alpha = fancy ? 0.2 + 0.4 * (0.5 + 0.5 * s) : 0.4;
    this.waveB.alpha = fancy ? 0.2 + 0.4 * (0.5 - 0.5 * s) : 0.4;
    this.waveA.x = fancy ? Math.sin(now / 2300) * 1.4 : 0;
    this.waveB.x = -this.waveA.x;
    this.coastG.alpha = fancy ? 0.8 + 0.2 * Math.sin(now / 1100) : 0.9;
    // облака видны, только когда карта отдалена
    const ca = fancy ? Math.max(0, Math.min(1, (1.3 - z) / 0.6)) * 0.85 : 0;
    this.cloudLayer.visible = ca > 0.01;
    this.cloudLayer.alpha = ca;
    for (const c of this.clouds) {
      c.sp.x += c.v * dt;
      if (c.sp.x > WORLD_W + 160) c.sp.x = -160;
      c.shadow.position.set(c.sp.x + 12, c.sp.y + 16);
    }
    this.glowG.alpha = fancy ? 0.55 + 0.3 * Math.sin(now / 650) : 0.7;
    this.previewG.alpha = fancy ? 0.85 + 0.15 * Math.sin(now / 500) : 1;
    // выделение: кольцо влетает и мягко пульсирует
    if (this.selected >= 0) {
      const k = fancy ? Math.min(1, (now - this.selAt) / 260) : 1;
      const e = backOut(k);
      const beat = fancy ? Math.sin(now / 260) * 0.04 : 0;
      this.selRing.scale.set(1.45 - 0.45 * e + beat);
      this.selRing.alpha = Math.min(1, k * 1.5) * (0.8 + beat * 5);
      this.selG.alpha = 0.85 + (fancy ? Math.sin(now / 520) * 0.15 : 0);
    }
    // волна «радара» над своей столицей
    const ping = this.pingG.clear();
    const gm = this.game;
    if (fancy && gm && !gm.gameOver && z >= 0.5) {
      const cap = REGIONS[gm.countries[gm.player].capital];
      if (cap) {
        const [cx, cy] = tileCenter(cap.center);
        for (const off of [0, 0.5]) {
          const p = ((now / 2600) + off) % 1;
          ping.circle(cx, cy, 6 + p * 22).stroke({ width: 2.2 * (1 - p) + 0.3, color: 0xf2cf6b, alpha: (1 - p) * 0.75 });
        }
      }
    }
  }

  /** Инерция после перетаскивания, плавный зум колесом и движение клавишами. */
  private moveCamera(dt: number) {
    if (this.zoomGoal) {
      const gl = this.zoomGoal;
      const z0 = this.world.scale.x;
      const z = z0 + (gl.z - z0) * (1 - Math.exp(-dt / 70));
      this.zoomAt(gl.sx, gl.sy, z / z0);
      if (Math.abs(gl.z - this.world.scale.x) < gl.z * 0.002) this.zoomGoal = null;
    }
    if (this.panKeys.size) {
      const v = 0.75 * dt;
      const k = this.panKeys;
      this.world.x += ((k.has('left') ? 1 : 0) - (k.has('right') ? 1 : 0)) * v;
      this.world.y += ((k.has('up') ? 1 : 0) - (k.has('down') ? 1 : 0)) * v;
      this.clamp();
    }
    if (!this.pointers.size && (this.vel.x || this.vel.y)) {
      const x0 = this.world.x, y0 = this.world.y;
      this.world.x += this.vel.x * dt;
      this.world.y += this.vel.y * dt;
      this.clamp();
      // упёрлись в край — гасим скорость по этой оси
      if (Math.abs(this.world.x - x0) < Math.abs(this.vel.x * dt) * 0.5) this.vel.x = 0;
      if (Math.abs(this.world.y - y0) < Math.abs(this.vel.y * dt) * 0.5) this.vel.y = 0;
      const f = Math.exp(-dt / 260);
      this.vel.x *= f;
      this.vel.y *= f;
      if (Math.hypot(this.vel.x, this.vel.y) < 0.02) this.vel.x = this.vel.y = 0;
    }
  }

  // ---------- управление ----------
  private minZoom() {
    return Math.max(this.app.screen.width / WORLD_W, this.app.screen.height / WORLD_H) * 0.98;
  }
  private clampZoom(z: number) {
    return Math.max(this.minZoom(), Math.min(4, z));
  }
  /** Допустимое положение карты при масштабе z. */
  private clampPos(x: number, y: number, z: number): [number, number] {
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const w = WORLD_W * z, h = WORLD_H * z;
    return [
      w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, x)),
      h <= sh ? (sh - h) / 2 : Math.min(80, Math.max(sh - h - 120, y)),
    ];
  }
  private clamp() {
    const z = this.clampZoom(this.world.scale.x);
    this.world.scale.set(z);
    const [x, y] = this.clampPos(this.world.x, this.world.y, z);
    this.world.position.set(x, y);
  }
  private zoomAt(sx: number, sy: number, factor: number) {
    const z0 = this.world.scale.x;
    const z = Math.max(this.minZoom(), Math.min(4, z0 * factor));
    const wx = (sx - this.world.x) / z0, wy = (sy - this.world.y) / z0;
    this.world.scale.set(z);
    this.world.position.set(sx - wx * z, sy - wy * z);
    this.clamp();
  }

  private bindInput() {
    const el = this.app.canvas;
    const pos = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const p = pos(e);
      this.pointers.set(e.pointerId, p);
      this.tween = null;
      this.zoomGoal = null;
      this.vel = { x: 0, y: 0, t: performance.now() };
      el.style.cursor = 'grabbing';
      this.hover(-1);
      if (this.pointers.size === 1) this.down = { ...p, t: performance.now(), moved: false };
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.down) this.down.moved = true;
      }
    });
    el.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      const p = pos(e);
      if (!prev) {
        // мышь без нажатия — подсвечиваем клетку под курсором
        if (e.pointerType === 'mouse' && !this.pointers.size) this.hover(this.tileAt(p.x, p.y));
        return;
      }
      if (this.pointers.size === 1) {
        this.world.x += p.x - prev.x;
        this.world.y += p.y - prev.y;
        // скорость для инерции — сглаженная
        const now = performance.now();
        const ms = Math.max(1, now - this.vel.t);
        this.vel.x = this.vel.x * 0.5 + ((p.x - prev.x) / ms) * 0.5;
        this.vel.y = this.vel.y * 0.5 + ((p.y - prev.y) / ms) * 0.5;
        this.vel.t = now;
        if (this.down && Math.hypot(p.x - this.down.x, p.y - this.down.y) > 8) this.down.moved = true;
        this.clamp();
      } else if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
        const d = Math.hypot(p.x - other.x, p.y - other.y);
        if (this.pinchDist > 0) {
          const midX = (p.x + other.x) / 2, midY = (p.y + other.y) / 2;
          this.world.x += (p.x - prev.x) / 2;
          this.world.y += (p.y - prev.y) / 2;
          this.zoomAt(midX, midY, d / this.pinchDist);
        }
        this.pinchDist = d;
      }
      this.pointers.set(e.pointerId, p);
    });
    const up = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const now = performance.now();
      if (this.pointers.size === 0 && this.down && !this.down.moved && now - this.down.t < 500) {
        const { x, y } = this.down;
        // двойной тап — приблизить к этому месту
        if (now - this.lastTap.t < 320 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 30) {
          this.lastTap.t = 0;
          this.zoomGoal = { z: this.clampZoom(this.world.scale.x * 1.9), sx: x, sy: y };
        } else {
          this.lastTap = { t: now, x, y };
          const tile = this.tileAt(x, y);
          if (tile >= 0) this.onTap?.(tile);
        }
      }
      // отпустили неподвижно — без инерции
      if (now - this.vel.t > 80 || !this.down?.moved) this.vel.x = this.vel.y = 0;
      if (this.pointers.size === 0) {
        this.down = null;
        el.style.cursor = 'grab';
      }
      this.pinchDist = 0;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => this.hover(-1));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.tween = null;
      this.vel.x = this.vel.y = 0;
      // колесо копит цель, камера плавно догоняет; тачпад (мелкие шаги) — сразу
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
      const z = this.zoomGoal?.z ?? this.world.scale.x;
      this.zoomGoal = { z: this.clampZoom(z * k), sx: e.offsetX, sy: e.offsetY };
    }, { passive: false });
  }

  private hover(tile: number) {
    if (tile === this.hoverTile) return;
    this.hoverTile = tile;
    const g = this.hoverG.clear();
    if (tile < 0 || isWater(tile)) return;
    const [cx, cy] = tileCenter(tile);
    g.poly(CORNERS.flatMap(([x, y]) => [cx + x * 0.94, cy + y * 0.94])).fill({ color: 0xffffff, alpha: 0.1 }).stroke({ width: 1.2, color: 0xffffff, alpha: 0.55 });
  }

  tileAt(sx: number, sy: number): number {
    const z = this.world.scale.x;
    const x = (sx - this.world.x) / z - HW / 2;
    const y = (sy - this.world.y) / z - S;
    // пиксели → осевые координаты (pointy-top), затем округление куба
    const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / S;
    const r = ((2 / 3) * y) / S;
    let rx = Math.round(q), rz = Math.round(r);
    const ry = Math.round(-q - r);
    const dx = Math.abs(rx - q), dy = Math.abs(ry - (-q - r)), dz = Math.abs(rz - r);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (!(dy > dz)) rz = -rx - ry;
    const row = rz;
    const col = rx + (row - (row & 1)) / 2;
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return -1;
    return row * COLS + col;
  }
}
