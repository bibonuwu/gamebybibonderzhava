// Морская жизнь на карте: косяки рыб, киты с фонтанами, дельфины и рыбы, выпрыгивающие из воды, парусники и чайки.
// Чистое украшение — на игру не влияет. Тап по воде: расходятся круги, рыбы разбегаются, кто-нибудь выпрыгивает.
import { Container, Graphics, Sprite, type Renderer, type Texture } from 'pixi.js';

export interface SeaEnv {
  renderer: Renderer;
  /** Расстояние от клетки до суши в клетках (0 — суша). */
  depth: Int16Array;
  /** Клетка под точкой карты (-1 — за краем). */
  tileAt: (x: number, y: number) => number;
  center: (t: number) => [number, number];
  width: number;
  height: number;
  /** Цвета флажков на парусах. */
  flags: number[];
}

export interface View { x0: number; y0: number; x1: number; y1: number }

/** fade — проявление после переселения поближе к игроку (0…1). */
interface Swimmer { x: number; y: number; a: number; goal: number; wait: number; v: number; min: number; flee: number; fade: number }
interface Fish { sp: Sprite; ox: number; oy: number; ph: number }
interface School extends Swimmer { fish: Fish[] }
interface Whale extends Swimmer { sp: Sprite; spout: number; ph: number }
interface Ship extends Swimmer { sp: Sprite; ph: number; base: number }
interface Gull { sp: Sprite; shadow: Sprite; cx: number; cy: number; r: number; w: number; ph: number; fade: number }
interface Jump { sp: Sprite; x0: number; y0: number; dx: number; h: number; t: number; life: number; base: number; landed: boolean }
interface Drop { x: number; y: number; vx: number; vy: number; t: number; life: number; r: number }
interface Ring { x: number; y: number; t: number; life: number; r: number }

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const GRAVITY = 0.00012; // мировых единиц / мс²

const FISH_COLORS = [0xffa94d, 0xffd43b, 0x63e6be, 0xff8787, 0x74c0fc, 0xf783ac];

export class SeaLife {
  /** Под водой: тени китов и косяки рыб. */
  readonly under = new Container();
  /** Над водой: корабли, брызги, прыжки, чайки. */
  readonly over = new Container();
  private whaleLayer = new Container();
  private fishLayer = new Container();
  private wakeG = new Graphics();
  private shipLayer = new Container();
  private splashG = new Graphics();
  private jumpLayer = new Container();
  private gullLayer = new Container();
  private tex: Record<string, Texture> = {};
  private schools: School[] = [];
  private whales: Whale[] = [];
  private ships: Ship[] = [];
  private gulls: Gull[] = [];
  private jumps: Jump[] = [];
  private drops: Drop[] = [];
  private rings: Ring[] = [];
  private nextJump = 2500;
  private recycleIn = 0;

  constructor(private env: SeaEnv) {
    this.under.addChild(this.whaleLayer, this.fishLayer);
    this.over.addChild(this.wakeG, this.shipLayer, this.splashG, this.jumpLayer, this.gullLayer);
    this.makeTextures();
    const water = (min: number) => {
      const out: number[] = [];
      for (let t = 0; t < env.depth.length; t++) if (env.depth[t] >= min && env.depth[t] < 99) out.push(t);
      return out;
    };
    const shallow = water(1), deep = water(3), open = water(2);
    const at = (pool: number[]) => {
      const [x, y] = env.center(pool[Math.floor(Math.random() * pool.length)]);
      return { x: x + rnd(-4, 4), y: y + rnd(-4, 4) };
    };
    const swimmer = (pool: number[], v: number, min: number): Swimmer => {
      const a = rnd(-Math.PI, Math.PI);
      return { ...at(pool), a, goal: a, wait: rnd(0, 3000), v, min, flee: 0, fade: 1 };
    };
    if (!shallow.length) return;
    // косяки рыб: у берегов и в открытом море (уплывшие далеко от взгляда игрока переселяются поближе)
    for (let i = 0; i < 36; i++) {
      const s: School = { ...swimmer(shallow, rnd(0.008, 0.014), 1), fish: [] };
      const n = 4 + Math.floor(Math.random() * 4);
      const color = FISH_COLORS[i % FISH_COLORS.length];
      for (let k = 0; k < n; k++) {
        const sp = new Sprite(this.tex[`fish-${color}`]);
        sp.anchor.set(0.5);
        const sc = rnd(0.2, 0.27);
        sp.scale.set(sc);
        sp.alpha = 0.85;
        this.fishLayer.addChild(sp);
        s.fish.push({ sp, ox: rnd(-9, 9), oy: rnd(-6, 6), ph: rnd(0, 6.28) });
      }
      this.schools.push(s);
    }
    // киты — медленные тени в глубине, иногда пускают фонтан
    for (let i = 0; i < 5 && deep.length; i++) {
      const sp = new Sprite(this.tex.whale);
      sp.anchor.set(0.5);
      sp.scale.set(rnd(0.3, 0.36));
      sp.alpha = 0.5;
      this.whaleLayer.addChild(sp);
      this.whales.push({ ...swimmer(deep, rnd(0.003, 0.005), 3), sp, spout: rnd(2000, 9000), ph: rnd(0, 6.28) });
    }
    // парусники в открытом море
    for (let i = 0; i < 8 && open.length; i++) {
      const sp = new Sprite(this.tex[`ship-${i % env.flags.length}`]);
      sp.anchor.set(0.5, 0.85);
      const base = rnd(0.42, 0.5);
      sp.scale.set(base);
      this.shipLayer.addChild(sp);
      this.ships.push({ ...swimmer(open, rnd(0.0035, 0.006), 2), sp, ph: rnd(0, 6.28), base });
    }
    // чайки кружат над прибрежными водами
    const coast = shallow.filter((t) => env.depth[t] === 1);
    for (let i = 0; i < 14 && coast.length; i++) {
      const { x, y } = at(coast);
      const shadow = new Sprite(this.tex.gull);
      shadow.anchor.set(0.5);
      shadow.tint = 0x000000;
      shadow.alpha = 0.22;
      const sp = new Sprite(this.tex.gull);
      sp.anchor.set(0.5);
      this.gullLayer.addChild(shadow, sp);
      this.gulls.push({ sp, shadow, cx: x, cy: y, r: rnd(6, 16), w: rnd(0.0007, 0.0013) * (Math.random() < 0.5 ? -1 : 1), ph: rnd(0, 6.28), fade: 1 });
    }
  }

  // ---------- текстуры: рисуем один раз ----------
  private bake(key: string, draw: (g: Graphics) => void) {
    const g = new Graphics();
    draw(g);
    this.tex[key] = this.env.renderer.generateTexture({ target: g, resolution: 3, antialias: true });
    g.destroy();
  }

  private makeTextures() {
    // рыбка сверху: хвост веером, плавники, глазки
    for (const color of FISH_COLORS) {
      this.bake(`fish-${color}`, (g) => {
        g.poly([-8, 0, -16, -6, -14, 0, -16, 6]).fill(color);
        g.ellipse(0, 0, 11, 4.6).fill(color);
        g.ellipse(1, 0, 7, 1.6).fill({ color: 0xffffff, alpha: 0.35 });
        g.poly([-1, -3.5, -6, -8, -5, -3]).fill({ color, alpha: 0.85 });
        g.poly([-1, 3.5, -6, 8, -5, 3]).fill({ color, alpha: 0.85 });
        g.circle(7, -2.2, 1.1).fill(0x10202e);
        g.circle(7, 2.2, 1.1).fill(0x10202e);
      });
    }
    // рыбка сбоку — для прыжков
    this.bake('jfish', (g) => {
      g.poly([-8, 0, -15, -6, -13, 0, -15, 6]).fill(0xffb347);
      g.ellipse(0, 0, 10, 4.4).fill(0xffb347);
      g.ellipse(1, 1.6, 7, 1.8).fill(0xfff1d6);
      g.poly([-2, -4, 3, -4, -4, -8]).fill(0xff922b);
      g.circle(6, -1, 1.3).fill(0x10202e);
    });
    // дельфин сбоку: спинной плавник, светлое брюхо, хвост
    this.bake('dolphin', (g) => {
      g.poly([-17, 0, -26, -7, -23, 0, -26, 7]).fill(0x4f7593);
      g.ellipse(0, 0, 19, 5.8).fill(0x5b84a3);
      g.ellipse(2, 2.6, 15, 2.6).fill(0xd8e7f0);
      g.ellipse(19, 1.2, 5, 2.2).fill(0x5b84a3);
      g.poly([-3, -5, 5, -5, -6, -13]).fill(0x4f7593);
      g.poly([4, 3, 9, 3, 2, 9]).fill(0x4f7593);
      g.circle(12, -1.2, 1.2).fill(0x0d1b26);
    });
    // кит сверху — тёмная тень в глубине
    this.bake('whale', (g) => {
      g.poly([-34, 0, -48, -12, -42, 0, -48, 12]).fill(0x0c2638);
      g.ellipse(0, 0, 36, 12).fill(0x0f2d44);
      g.ellipse(-4, -12, 9, 3.5).fill(0x0c2638);
      g.ellipse(-4, 12, 9, 3.5).fill(0x0c2638);
      g.ellipse(6, 0, 22, 4).fill({ color: 0x3e6f8f, alpha: 0.35 });
    });
    // парусник сбоку с флажком страны
    this.env.flags.forEach((flag, i) => {
      this.bake(`ship-${i}`, (g) => {
        g.poly([-13, 0, 13, 0, 9, 6, -10, 6]).fill(0x7a4a26).stroke({ width: 1, color: 0x4a2a12 });
        g.rect(-11, 1.5, 22, 1.2).fill({ color: 0xf2cf6b, alpha: 0.8 });
        g.rect(-0.6, -24, 1.2, 24).fill(0x5a3a1c);
        g.poly([1.5, -1.5, 1.5, -22, 13, -1.5]).fill(0xfbfbf4).stroke({ width: 0.8, color: 0xc9c3ad });
        g.poly([-1.5, -1.5, -1.5, -17, -10, -1.5]).fill(0xf1ecdc).stroke({ width: 0.8, color: 0xc9c3ad });
        g.poly([0.6, -24, 8, -22, 0.6, -20]).fill(flag);
      });
    });
    // чайка: крылья «галочкой»
    this.bake('gull', (g) => {
      g.moveTo(-10, 1).quadraticCurveTo(-5, -5, 0, 0.5).quadraticCurveTo(5, -5, 10, 1).stroke({ width: 2.4, color: 0xffffff, cap: 'round', join: 'round' });
      g.moveTo(-10, 1).lineTo(-8, -1.4).stroke({ width: 2.4, color: 0x495057, cap: 'round' });
      g.moveTo(10, 1).lineTo(8, -1.4).stroke({ width: 2.4, color: 0x495057, cap: 'round' });
      g.circle(0, 0.8, 1.4).fill(0xffffff);
    });
  }

  // ---------- поведение ----------
  private wet(x: number, y: number, min: number) {
    const t = this.env.tileAt(x, y);
    return t >= 0 && this.env.depth[t] >= min;
  }

  /** Плывёт, понемногу меняя курс; впереди берег — разворачивается. */
  private swim(s: Swimmer, dt: number, look: number) {
    s.wait -= dt;
    if (s.wait <= 0) {
      s.wait = rnd(1500, 4500);
      s.goal = s.a + rnd(-1.1, 1.1);
    }
    s.a = wrap(s.a + wrap(s.goal - s.a) * Math.min(1, dt / (s.flee > 0 ? 160 : 500)));
    const ca = Math.cos(s.a), sa = Math.sin(s.a);
    if (!this.wet(s.x + ca * look, s.y + sa * look, s.min)) {
      if (Math.abs(wrap(s.goal - s.a)) < 0.3) {
        s.goal = s.a + Math.PI * rnd(0.6, 1.4);
        s.wait = rnd(900, 1600);
      }
      return;
    }
    const v = s.v * (s.flee > 0 ? 3.4 : 1);
    if (s.flee > 0) s.flee -= dt;
    s.x += ca * v * dt;
    s.y += sa * v * dt;
  }

  private splash(x: number, y: number, power: number) {
    this.rings.push({ x, y, t: 0, life: 900, r: 3 * power });
    for (let i = 0; i < 6 * power; i++) {
      this.drops.push({ x, y, vx: rnd(-0.018, 0.018) * power, vy: rnd(-0.045, -0.025) * power, t: 0, life: rnd(450, 700), r: rnd(0.6, 1.2) });
    }
  }

  private spout(w: Whale) {
    const hx = w.x + Math.cos(w.a) * 8, hy = w.y + Math.sin(w.a) * 8;
    this.rings.push({ x: hx, y: hy, t: 0, life: 1100, r: 4 });
    for (let i = 0; i < 22; i++) {
      this.drops.push({ x: hx, y: hy, vx: rnd(-0.008, 0.008), vy: rnd(-0.06, -0.04), t: rnd(-300, 0), life: rnd(800, 1100), r: rnd(0.7, 1.5) });
    }
  }

  /** Прыжок дельфина или рыбы по дуге: брызги при выходе и при входе в воду. */
  private jump(x: number, y: number, kind: 'dolphin' | 'jfish', delay = 0) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    const big = kind === 'dolphin';
    const dx = dir * (big ? rnd(18, 26) : rnd(8, 12));
    if (!this.wet(x + dx, y, 1)) return;
    const sp = new Sprite(this.tex[kind]);
    sp.anchor.set(0.5);
    sp.visible = false;
    this.jumpLayer.addChild(sp);
    this.jumps.push({ sp, x0: x, y0: y, dx, h: big ? rnd(10, 15) : rnd(5, 8), t: -delay, life: big ? 1150 : 750, base: big ? 0.2 : 0.17, landed: false });
  }

  /** Тап по воде. */
  poke(x: number, y: number) {
    this.rings.push({ x, y, t: 0, life: 1000, r: 2 }, { x, y, t: -180, life: 1000, r: 2 });
    for (const s of this.schools) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d > 60) continue;
      s.a = s.goal = Math.atan2(s.y - y, s.x - x);
      s.flee = 900 + (60 - d) * 15;
    }
    if (Math.random() < 0.6) this.jump(x + rnd(-6, 6), y + rnd(-4, 4), Math.random() < 0.3 ? 'dolphin' : 'jfish', 250);
  }

  /** Уплывшие далеко от экрана переселяются в воду рядом с тем местом, куда смотрит игрок, и плавно проявляются. */
  private recycle(view: View) {
    const w = view.x1 - view.x0, h = view.y1 - view.y0;
    const far = Math.max(w, h) * 0.75;
    const away = (x: number, y: number) => x < view.x0 - far || x > view.x1 + far || y < view.y0 - far || y > view.y1 + far;
    const spot = (min: number, exact = false) => {
      for (let k = 0; k < 10; k++) {
        const x = rnd(view.x0 - w * 0.15, view.x1 + w * 0.15), y = rnd(view.y0 - h * 0.15, view.y1 + h * 0.15);
        const t = this.env.tileAt(x, y);
        if (t >= 0 && (exact ? this.env.depth[t] === min : this.env.depth[t] >= min)) return { x, y };
      }
      return null;
    };
    for (const s of [...this.schools, ...this.whales, ...this.ships] as Swimmer[]) {
      if (!away(s.x, s.y)) continue;
      const p = spot(s.min);
      if (!p) continue;
      s.x = p.x;
      s.y = p.y;
      s.fade = 0;
    }
    for (const b of this.gulls) {
      if (!away(b.cx, b.cy)) continue;
      const p = spot(1, true);
      if (!p) continue;
      b.cx = p.x;
      b.cy = p.y;
      b.fade = 0;
    }
  }

  update(dt: number, now: number, z: number, view: View, on: boolean) {
    this.under.visible = this.over.visible = on;
    if (!on) return;
    dt = Math.min(dt, 60);
    this.recycleIn -= dt;
    if (this.recycleIn <= 0) {
      this.recycleIn = 500;
      this.recycle(view);
    }
    const fadeIn = (o: { fade: number }) => (o.fade = Math.min(1, o.fade + dt / 1200));
    const inView = (x: number, y: number, m = 30) => x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m;

    // под водой: видно, когда карта приближена
    const ua = Math.max(0, Math.min(1, (z - 0.55) / 0.35));
    this.under.alpha = ua;
    if (ua > 0) {
      for (const s of this.schools) {
        this.swim(s, dt, 9);
        const ca = Math.cos(s.a), sa = Math.sin(s.a);
        const wag = s.flee > 0 ? 55 : 150;
        const alpha = 0.9 * fadeIn(s);
        for (const f of s.fish) {
          f.sp.alpha = alpha;
          const ox = f.ox + Math.sin(now / 650 + f.ph) * 1.4, oy = f.oy + Math.cos(now / 820 + f.ph) * 1.1;
          f.sp.position.set(s.x + ox * ca - oy * sa, s.y + ox * sa + oy * ca);
          f.sp.rotation = s.a + Math.sin(now / wag + f.ph) * 0.22;
        }
      }
    }
    for (const w of this.whales) {
      this.swim(w, dt, 20);
      w.sp.position.set(w.x, w.y);
      w.sp.rotation = w.a + Math.sin(now / 900 + w.ph) * 0.06;
      w.sp.alpha = 0.5 * fadeIn(w);
      w.spout -= dt;
      if (w.spout <= 0) {
        w.spout = rnd(7000, 15000);
        if (z >= 0.7 && inView(w.x, w.y)) this.spout(w);
      }
    }

    // корабли и кильватерный след
    const shipA = Math.max(0, Math.min(1, (z - 0.4) / 0.25));
    this.shipLayer.alpha = this.wakeG.alpha = shipA;
    const wake = this.wakeG.clear();
    for (const s of this.ships) {
      this.swim(s, dt, 14);
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      s.sp.position.set(s.x, s.y);
      s.sp.scale.set(ca >= 0 ? s.base : -s.base, s.base);
      s.sp.rotation = Math.sin(now / 700 + s.ph) * 0.07;
      s.sp.alpha = fadeIn(s);
      if (shipA > 0 && s.fade > 0.5 && inView(s.x, s.y)) {
        const bx = s.x - ca * 4, by = s.y - sa * 4, px = -sa, py = ca;
        wake.moveTo(bx + px * 5 - ca * 12, by + py * 5 - sa * 12).lineTo(bx, by).lineTo(bx - px * 5 - ca * 12, by - py * 5 - sa * 12);
      }
    }
    wake.stroke({ width: 1.1, color: 0xeefaff, alpha: 0.45, cap: 'round', join: 'round' });

    // чайки
    const ga = Math.max(0, Math.min(1, (z - 0.9) / 0.3));
    this.gullLayer.alpha = ga;
    if (ga > 0) {
      for (const b of this.gulls) {
        const ang = now * b.w + b.ph;
        const x = b.cx + Math.cos(ang) * b.r, y = b.cy + Math.sin(ang) * b.r * 0.6 - 6;
        const flap = 0.3 + 0.7 * Math.abs(Math.sin(now / 150 + b.ph));
        b.sp.position.set(x, y);
        b.sp.scale.set(0.28, 0.28 * flap);
        b.sp.alpha = fadeIn(b);
        b.shadow.alpha = 0.22 * b.fade;
        b.sp.rotation = Math.cos(ang) * 0.25 * Math.sign(b.w);
        b.shadow.position.set(x + 3, y + 8);
        b.shadow.scale.copyFrom(b.sp.scale);
        b.shadow.rotation = b.sp.rotation;
      }
    }

    // дельфины и рыбы иногда выпрыгивают там, куда смотрит игрок
    this.nextJump -= dt;
    if (this.nextJump <= 0) {
      this.nextJump = rnd(2200, 5000);
      if (z >= 0.8) {
        for (let k = 0; k < 12; k++) {
          const x = rnd(view.x0, view.x1), y = rnd(view.y0, view.y1);
          if (!this.wet(x, y, 2)) continue;
          if (Math.random() < 0.55) {
            const pod = 1 + Math.floor(Math.random() * 3);
            for (let i = 0; i < pod; i++) this.jump(x + i * 3, y + rnd(-3, 3), 'dolphin', i * 260);
          } else this.jump(x, y, 'jfish');
          break;
        }
      }
    }
    for (let i = this.jumps.length - 1; i >= 0; i--) {
      const j = this.jumps[i];
      j.t += dt;
      if (j.t < 0) continue;
      const p = j.t / j.life;
      if (p >= 1) {
        j.sp.destroy();
        this.jumps.splice(i, 1);
        continue;
      }
      if (!j.sp.visible) {
        j.sp.visible = true;
        this.splash(j.x0, j.y0, j.base > 0.18 ? 1 : 0.6);
      }
      const x = j.x0 + j.dx * p, y = j.y0 - j.h * 4 * p * (1 - p);
      const vx = j.dx, vy = -j.h * 4 * (1 - 2 * p);
      j.sp.position.set(x, y);
      j.sp.scale.set(j.dx > 0 ? j.base : -j.base, j.base);
      j.sp.rotation = j.dx > 0 ? Math.atan2(vy, vx) : Math.atan2(-vy, -vx);
      j.sp.alpha = Math.min(1, p / 0.08, (1 - p) / 0.08);
      if (!j.landed && p > 0.92) {
        j.landed = true;
        this.splash(j.x0 + j.dx, j.y0, j.base > 0.18 ? 1 : 0.6);
      }
    }

    // брызги и круги на воде
    const sg = this.splashG.clear();
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t < 0) continue;
      const p = r.t / r.life;
      if (p >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - p, 2);
      const rad = r.r + e * 10;
      sg.ellipse(r.x, r.y, rad, rad * 0.5).stroke({ width: 1.2 * (1 - p) + 0.3, color: 0xeefaff, alpha: 0.75 * (1 - p) });
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      if (d.t < 0) continue;
      if (d.t >= d.life) {
        this.drops.splice(i, 1);
        continue;
      }
      d.vy += GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      sg.circle(d.x, d.y, d.r).fill({ color: 0xf4fbff, alpha: 0.9 * (1 - d.t / d.life) });
    }
  }
}
