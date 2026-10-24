// Вода и суша на шейдере: глубина моря, рябь и блики солнца, волны, бегущие к берегу и разбивающиеся в пену,
// барашки и арктические льды; на суше — рельеф, хребты со снежными шапками, кроны лесов, барханы, пляжи
// и мягкие переходы между ландшафтами. Берег идёт точно по краям клеток — меняется только картинка.
import { BufferImageSource, Geometry, Mesh, Shader, UniformGroup, type Renderer, type WebGLRenderer } from 'pixi.js';
import { COLS, N, NEIGH, REGIONS, REGION_OF, ROWS, TERRAIN, isWater } from '../game/world';

export interface SurfaceEnv {
  /** Радиус гекса. */
  s: number;
  width: number;
  height: number;
  /** Клетка под точкой карты (-1 — за краем). */
  tileAt: (x: number, y: number) => number;
}

const KINDS = 'ocpgfdtsm'; // порядок важен: шейдер узнаёт ландшафт по номеру, суша — с 2
const FS = 3; // мировых единиц на тексель поля расстояний до берега
const NOISE = 256;
const DLAT = (360 / COLS) * (Math.sqrt(3) / 2); // широта на ряд клеток (как в scripts/build-map.mjs)

function hash(i: number) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Бесшовный fbm-шум, выровненный по гистограмме: доля точек выше порога v равна 1 − v. */
function fbm(seed: number): Float32Array {
  const out = new Float32Array(NOISE * NOISE);
  let amp = 1;
  for (let o = 0; o < 5; o++) {
    const cells = 4 << o, cs = NOISE / cells;
    const gx = new Float32Array(cells * cells), gy = new Float32Array(cells * cells);
    for (let i = 0; i < cells * cells; i++) {
      const a = hash(seed * 7919 + o * 104729 + i) * Math.PI * 2;
      gx[i] = Math.cos(a);
      gy[i] = Math.sin(a);
    }
    for (let y = 0; y < NOISE; y++) {
      const fy = y / cs, y0 = Math.floor(fy), ty = fy - y0, y1 = (y0 + 1) % cells;
      const v = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      for (let x = 0; x < NOISE; x++) {
        const fx = x / cs, x0 = Math.floor(fx), tx = fx - x0, x1 = (x0 + 1) % cells;
        const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        const a = y0 * cells + x0, b = y0 * cells + x1, c = y1 * cells + x0, d = y1 * cells + x1;
        const n00 = gx[a] * tx + gy[a] * ty, n10 = gx[b] * (tx - 1) + gy[b] * ty;
        const n01 = gx[c] * tx + gy[c] * (ty - 1), n11 = gx[d] * (tx - 1) + gy[d] * (ty - 1);
        const top = n00 + (n10 - n00) * u, bot = n01 + (n11 - n01) * u;
        out[y * NOISE + x] += (top + (bot - top) * v) * amp;
      }
    }
    amp *= 0.5;
  }
  const order = Array.from(out.keys()).sort((a, b) => out[a] - out[b]);
  order.forEach((i, rank) => (out[i] = rank / (order.length - 1)));
  return out;
}

/** Бесшовное размытие квадратом (2r+1)², дважды — почти гаусс. */
function blur(src: Float32Array, r: number) {
  let a: Float32Array = src, b: Float32Array = new Float32Array(src.length);
  for (let pass = 0; pass < 4; pass++) {
    const horiz = pass % 2 === 0;
    for (let y = 0; y < NOISE; y++) {
      for (let x = 0; x < NOISE; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          const xx = horiz ? (x + k + NOISE) % NOISE : x, yy = horiz ? y : (y + k + NOISE) % NOISE;
          sum += a[yy * NOISE + xx];
        }
        b[y * NOISE + x] = sum / (2 * r + 1);
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

/** Текстура шума: R — высота, G/B — её наклон по x/y, A — второй, независимый шум. */
function makeNoise() {
  const h = fbm(1), h2 = fbm(2);
  // наклон считаем по сглаженной высоте: мелкие октавы иначе превращают свет в «мятую фольгу»
  const hs = blur(h, 2);
  const gx = new Float32Array(h.length), gy = new Float32Array(h.length);
  let max = 1e-6;
  for (let y = 0; y < NOISE; y++) {
    for (let x = 0; x < NOISE; x++) {
      const at = (xx: number, yy: number) => hs[((yy + NOISE) % NOISE) * NOISE + ((xx + NOISE) % NOISE)];
      const i = y * NOISE + x;
      gx[i] = (at(x + 1, y) - at(x - 1, y)) / 2;
      gy[i] = (at(x, y + 1) - at(x, y - 1)) / 2;
      max = Math.max(max, Math.abs(gx[i]), Math.abs(gy[i]));
    }
  }
  const k = 0.5 / max;
  const data = new Uint8Array(h.length * 4);
  for (let i = 0; i < h.length; i++) {
    data[i * 4] = Math.round(h[i] * 255);
    data[i * 4 + 1] = Math.round((0.5 + gx[i] * k) * 255);
    data[i * 4 + 2] = Math.round((0.5 + gy[i] * k) * 255);
    data[i * 4 + 3] = Math.round(h2[i] * 255);
  }
  // наклон на единицу текстурных координат = (G − 0.5) · grad
  return { data, grad: NOISE / k };
}

/** Точное евклидово расстояние до ближайшего нуля (Felzenszwalb–Huttenlocher), одна строка. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Поле расстояний от воды до суши в мировых единицах, 16 бит: R — старший байт, G — младший (в 1/16). */
function makeField(env: SurfaceEnv) {
  const w = Math.ceil(env.width / FS), h = Math.ceil(env.height / FS);
  const grid = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = env.tileAt((x + 0.5) * FS, (y + 0.5) * FS);
      grid[y * w + x] = t >= 0 && !isWater(t) ? 0 : 1e20;
    }
  }
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const dist = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    // берег лежит посередине между клеткой суши и воды — полтекселя
    for (let x = 0; x < w; x++) dist[y * w + x] = d[x] > 0 ? Math.max(0, Math.sqrt(d[x]) - 0.5) * FS : 0;
  }
  // лёгкое размытие убирает ступеньки сетки
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          sum += dist[yy * w + xx];
          cnt++;
        }
      }
      const i = y * w + x;
      const val = Math.round(Math.min(4095, dist[i] > 0 ? sum / cnt : 0) * 16);
      data[i * 4] = val >> 8;
      data[i * 4 + 1] = val & 255;
      data[i * 4 + 3] = 255;
    }
  }
  return { data, w, h };
}

let cityLandCache: Uint8Array | null = null;
/** Земля городов: 2 — сам город (середина региона), 1 — поля вокруг на лугах и в степи. */
export function cityLand(): Uint8Array {
  if (cityLandCache) return cityLandCache;
  const out = new Uint8Array(N);
  for (const reg of REGIONS) {
    if (!reg.isCity) continue;
    out[reg.center] = 2;
    const near = new Set<number>();
    const grow = (t: number) => {
      for (let d = 0; d < 6; d++) if (NEIGH[t * 6 + d] >= 0) near.add(NEIGH[t * 6 + d]);
    };
    grow(reg.center);
    // столицу кормят поля пошире
    if (reg.capital) for (const t of [...near]) grow(t);
    for (const t of near) {
      if (out[t] === 0 && REGION_OF[t] === reg.id && (TERRAIN[t] === 'p' || TERRAIN[t] === 'g') && hash(t + 31) > 0.45) out[t] = 1;
    }
  }
  return (cityLandCache = out);
}

/** Клетки: R — номер ландшафта · 16, G — случайный оттенок клетки, B — поля (150) и город (255). */
function makeTiles() {
  const land = cityLand();
  const data = new Uint8Array(COLS * ROWS * 4);
  for (let t = 0; t < COLS * ROWS; t++) {
    data[t * 4] = Math.max(0, KINDS.indexOf(TERRAIN[t])) * 16;
    data[t * 4 + 1] = Math.floor(hash(t + 5) * 255);
    data[t * 4 + 2] = land[t] === 2 ? 255 : land[t] === 1 ? 150 : 0;
    data[t * 4 + 3] = 255;
  }
  return data;
}

const VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
out vec2 vPos;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vPos = aPosition;
}
`;

function header(s: number, field: { w: number; h: number }, grad: number) {
  const f = (v: number) => v.toFixed(6);
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vPos;
out vec4 finalColor;
uniform sampler2D uTiles;
uniform sampler2D uField;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uPx;

const float S = ${f(s)};
const float RI = ${f((s * Math.sqrt(3)) / 2)};
const float HW = RI * 2.0;
const int COLS = ${COLS};
const int ROWS = ${ROWS};
const vec2 FIELD = vec2(${f(field.w * FS)}, ${f(field.h * FS)});
const float GRAD = ${f(grad)};
const float DLAT = ${f(DLAT)};
const vec3 LIGHT = vec3(-0.5212, -0.6516, 0.5512);

float latOf(vec2 p) { return 80.0 - (p.y - S) / (1.5 * S) * DLAT; }

/** Наклон шума (канал R) в мировых единицах для выборки с периодом per. */
vec2 nGrad(vec4 n, float per) { return (n.yz - 0.5) * GRAD / per; }

float fieldDist(vec2 p) {
  vec2 e = texture(uField, p / FIELD).rg;
  return (e.r * 65280.0 + e.g * 255.0) / 16.0;
}

/** Осевые координаты клетки под точкой (как MapView.tileAtWorld). */
vec2 hexOf(vec2 p) {
  vec2 q = p - vec2(RI, S);
  float fq = (0.5773502692 * q.x - q.y / 3.0) / S;
  float fr = (2.0 / 3.0) * q.y / S;
  float fs = -fq - fr;
  float rq = round(fq), rr = round(fr), rs = round(fs);
  float dq = abs(rq - fq), dr = abs(rr - fr), ds = abs(rs - fs);
  if (dq > ds && dq > dr) rq = -rs - rr;
  else if (!(ds > dr)) rr = -rq - rs;
  return vec2(rq, rr);
}

vec2 hexCenter(vec2 a) { return vec2(HW * (a.x + a.y * 0.5) + RI, 1.5 * S * a.y + S); }

vec4 tileAt(vec2 a) {
  int r = int(a.y);
  if (r < 0 || r >= ROWS) return vec4(0.0);
  int c = int(a.x) + (r - (r & 1)) / 2;
  if (c < 0 || c >= COLS) return vec4(0.0);
  return texelFetch(uTiles, ivec2(c, r), 0);
}

int kindOf(vec4 t) { return int(t.r * 255.0 / 16.0 + 0.5); }

/** Знаковое расстояние до шестиугольника «остриём вверх» с центром в нуле. */
float sdHex(vec2 p) {
  const vec3 k = vec3(-0.8660254038, 0.5, 0.5773502692);
  p = abs(p.yx);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * RI, k.z * RI), RI);
  return length(p) * sign(p.y);
}
`;
}

const WATER_FRAG = /* glsl */ `
void main() {
  vec2 p = vPos;
  float t = uTime;
  float d = fieldDist(p);
  float lat = latOf(p);
  float warm = 1.0 - smoothstep(18.0, 48.0, abs(lat));
  float polar = smoothstep(52.0, 72.0, abs(lat));
  // цвет по глубине: бирюзовое мелководье, шельф, открытый океан; неровный шельф
  vec4 nS = texture(uNoise, p / 170.0);
  float dd = d * (0.7 + 0.6 * nS.w);
  vec3 shallow = mix(vec3(0.15, 0.40, 0.54), vec3(0.13, 0.52, 0.62), warm);
  vec3 mid = mix(vec3(0.08, 0.21, 0.41), vec3(0.07, 0.27, 0.50), warm);
  vec3 deep = mix(vec3(0.05, 0.10, 0.25), vec3(0.05, 0.12, 0.30), warm);
  vec3 col = mix(shallow, mid, smoothstep(0.0, 16.0, dd));
  col = mix(col, deep, smoothstep(12.0, 70.0, dd));
  col = mix(col, vec3(0.035, 0.065, 0.18), smoothstep(70.0, 220.0, dd));
  // светлое песчаное дно у самого берега тёплых морей
  col = mix(col, vec3(0.38, 0.62, 0.62), (1.0 - smoothstep(0.0, 5.0, d)) * 0.3 * warm);
  // холодные моря — серее
  col = mix(col, col * vec3(0.84, 0.9, 0.94) + vec3(0.025, 0.03, 0.04), polar);
  // тень приподнятой суши падает на воду к юго-востоку
  float shade = 1.0 - smoothstep(0.5, 4.5, fieldDist(p + vec2(-3.2, -4.0)));
  col *= 1.0 - 0.4 * shade;

  // рябь: два слоя волн бегут в разные стороны
  float detail = 1.0 - smoothstep(1.8, 3.6, uPx);
  vec4 w1 = texture(uNoise, p / 90.0 + vec2(t * 0.008, t * 0.004));
  vec4 w2 = texture(uNoise, vec2(p.y, -p.x) / 53.0 + vec2(-t * 0.006, t * 0.009));
  vec2 g2 = nGrad(w2, 53.0);
  vec2 g = (nGrad(w1, 90.0) + vec2(-g2.y, g2.x)) * 0.7 * detail;
  vec3 nrm = normalize(vec3(-g, 1.0));
  col *= mix(1.0, dot(nrm, LIGHT) / LIGHT.z, 0.45);
  // солнечные блики на гребнях
  vec3 hv = normalize(LIGHT + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(nrm, hv), 0.0), 300.0);
  col += vec3(1.0, 0.96, 0.86) * spec * 0.35 * detail * (1.0 - 0.6 * polar);
  // каустика: светлая сетка на мелководье
  float sh = 1.0 - smoothstep(1.0, 15.0, d);
  if (sh > 0.0 && detail > 0.0) {
    vec4 c1 = texture(uNoise, p / 14.0 + vec2(t * 0.021, t * 0.012));
    vec4 c2 = texture(uNoise, p / 11.0 - vec2(t * 0.016, -t * 0.019));
    float ca = pow(max(0.0, 1.0 - abs(c1.x - c2.w) * 4.0), 6.0);
    col += vec3(0.55, 0.85, 0.8) * ca * 0.16 * sh * detail * (0.4 + 0.6 * warm);
  }
  finalColor = vec4(col, 1.0);
}
`;

const LAND_FRAG = /* glsl */ `
const vec2 OFF[7] = vec2[7](vec2(0.0), vec2(1.0, 0.0), vec2(1.0, -1.0), vec2(0.0, -1.0), vec2(-1.0, 0.0), vec2(-1.0, 1.0), vec2(0.0, 1.0));

/** Базовый цвет ландшафта и сила его рельефа. */
vec4 kindLook(int k, float warm) {
  if (k == 2) return vec4(mix(vec3(0.66, 0.63, 0.33), vec3(0.72, 0.64, 0.34), warm), 1.2); // степь, саванна
  if (k == 3) return vec4(mix(vec3(0.45, 0.62, 0.22), vec3(0.36, 0.60, 0.18), warm), 1.2); // луга
  if (k == 4) return vec4(mix(vec3(0.25, 0.41, 0.16), vec3(0.18, 0.39, 0.13), warm), 1.4); // лес (деревья — спрайты)
  if (k == 5) return vec4(0.90, 0.76, 0.52, 1.0);                                           // пустыня
  if (k == 6) return vec4(0.56, 0.57, 0.45, 1.8);                                           // тундра
  if (k == 7) return vec4(0.93, 0.95, 0.98, 1.6);                                           // снега
  return vec4(0.56, 0.50, 0.40, 2.2);                                                       // горы
}

/** Пена, барашки и льды поверх воды (премультиплицированная альфа). dd — расстояние до берега. */
vec4 sea(vec2 p, float dd, float lat, vec4 nw) {
  float t = uTime;
  float detail = 1.0 - smoothstep(1.8, 3.6, uPx);
  vec4 nf = texture(uNoise, p / 6.0 + vec2(t * 0.013, -t * 0.008));
  // накат и откат у самой кромки
  float swash = 2.1 + 1.3 * sin(t * 0.9 + nw.w * 9.0);
  float rim = (1.0 - smoothstep(swash * 0.35, swash, dd)) * (0.6 + 0.4 * nf.x);
  float line = 1.0 - smoothstep(0.2, 0.7 + uPx, dd);
  // волны идут из океана к берегу и разбиваются: острый гребень со стороны берега, пенный след за ним
  float dw = dd + (nw.x - 0.5) * 3.0;
  float ph = (dw + t * 2.2) / 12.0;
  float f = fract(ph);
  float power = 0.6 + 0.4 * fract(sin(floor(ph) * 78.233) * 43758.5453);
  float crest = (exp(-f * 13.0) + 0.4 * exp(-f * 3.5)) * smoothstep(1.0, 0.94, f);
  float seg = smoothstep(0.35, 0.6, texture(uNoise, p / 64.0 + vec2(t * 0.003, 0.0)).w * 0.8 + nf.w * 0.2);
  float near = 1.0 - smoothstep(3.0, 12.0, dd);
  float env = smoothstep(0.8, 3.5, dd) * (1.0 - smoothstep(10.0, 26.0, dd));
  float breaker = min(1.0, crest * env * power * mix(seg, 1.0, near) * (0.5 + 0.7 * near) * (0.75 + 0.25 * nf.x)) * detail;
  // барашки в открытом море
  vec4 c1 = texture(uNoise, p / 29.0 + vec2(t * 0.010, t * 0.004));
  vec4 c2 = texture(uNoise, p / 23.0 - vec2(t * 0.006, -t * 0.009));
  float caps = smoothstep(0.9, 0.95, min(c1.x, c2.w)) * smoothstep(28.0, 70.0, dd) * (1.0 - smoothstep(0.7, 1.4, uPx)) * 0.45;
  float foam = max(max(rim, line), max(breaker, caps)) * 0.92;
  vec4 res = vec4(vec3(0.93, 0.97, 1.0) * foam, foam);
  // дрейфующие льды Арктики
  float ice = smoothstep(65.0, 77.0, lat);
  if (ice > 0.0) {
    // крупный период и искажение координат: иначе повтор текстуры рисует ровный «горошек»
    vec4 i2 = texture(uNoise, vec2(p.y, -p.x) / 47.0 + vec2(0.0, t * 0.001));
    vec4 i1 = texture(uNoise, p / 230.0 + (i2.xw - 0.5) * 0.12 + vec2(t * 0.0004, 0.0));
    float v = i1.x * 0.7 + i2.w * 0.25 + nf.x * 0.05;
    float thr = mix(1.02, 0.3, ice);
    float floe = smoothstep(thr, thr + 0.03, v);
    vec3 ic = mix(vec3(0.74, 0.84, 0.9), vec3(0.95, 0.97, 0.99), smoothstep(thr + 0.02, thr + 0.12, v));
    res = res * (1.0 - floe) + vec4(ic * floe, floe);
  }
  return res;
}

/** catC — поля и город; farm — середина и поворот клетки с полями (xy, z), town — середина города. */
vec3 landColor(vec2 p, vec3 base, float relief, vec4 catA, vec3 catB, vec2 catC, vec3 farm, vec2 town, float cd, float lat) {
  float wF = catA.x, wD = catA.y, wM = catA.z, wS = catA.w, wT = catB.x, wP = catB.y, wG = catB.z;
  float warm = 1.0 - smoothstep(18.0, 48.0, abs(lat));
  vec4 nA = texture(uNoise, p / 96.0);
  vec4 nB = texture(uNoise, p / 31.0 + vec2(0.37, 0.11));
  vec4 nC = texture(uNoise, p / 8.0 + vec2(0.71, 0.53));
  vec2 gA = nGrad(nA, 96.0), gB = nGrad(nB, 31.0), gC = nGrad(nC, 8.0);

  vec3 col = base;
  // мягкая, «живописная» пестрота: крупные пятна, мелочь едва заметна
  col *= 0.93 + 0.07 * nC.w + 0.08 * (nB.w - 0.5) * (1.0 - 0.7 * wS);
  col = mix(col, col * vec3(1.1, 1.05, 0.78), (wP + wG) * 0.5 * smoothstep(0.45, 0.85, nB.w));
  col = mix(col, col * vec3(0.78, 0.9, 0.72), (wG + wP * 0.5) * smoothstep(0.7, 0.95, nA.w) * 0.7);
  // земля под деревьями
  col = mix(col, col * (0.78 + 0.35 * nB.x), wF);
  // тундра: мох, камни, снежники
  col = mix(col, mix(vec3(0.46, 0.48, 0.36), vec3(0.64, 0.61, 0.52), nB.w), wT * 0.5);
  col = mix(col, vec3(0.9, 0.92, 0.95), wT * smoothstep(0.8, 0.9, nB.w * 0.45 + nA.x * 0.55));
  // горы: каменистые склоны вокруг вершин-спрайтов
  vec2 gm = vec2(0.0);
  if (wM > 0.0) {
    // сглаженные уровни мипмапа: без мелких октав гребни ветвятся, а не мнутся
    vec4 nM = texture(uNoise, p / 64.0 + vec2(0.19, 0.83), 2.0);
    vec4 nR = texture(uNoise, p / 27.0 + vec2(0.61, 0.29), 1.5);
    vec2 gM = nGrad(nM, 64.0), gR = nGrad(nR, 27.0);
    float sM = sign(2.0 * nM.x - 1.0), sR = sign(2.0 * nR.x - 1.0);
    float mh = (1.0 - abs(2.0 * nM.x - 1.0)) * 0.7 + (1.0 - abs(2.0 * nR.x - 1.0)) * 0.3;
    gm = -2.0 * (sM * gM * 0.7 + sR * gR * 0.3);
    vec3 rock = mix(vec3(0.46, 0.41, 0.34), vec3(0.62, 0.56, 0.47), nB.w) * (0.82 + 0.25 * mh);
    col = mix(col, rock, wM * 0.7);
    float snowLine = mix(0.86, 0.66, smoothstep(30.0, 62.0, abs(lat)));
    float high = mh * 0.6 + nA.x * 0.4;
    col = mix(col, vec3(0.95, 0.96, 0.98), wM * smoothstep(snowLine, snowLine + 0.08, high) * smoothstep(0.45, 0.7, mh));
  }
  // поля вокруг городов: лоскуты пшеницы, зелени и пашни, повёрнутые вместе с клеткой
  float wFarm = catC.x;
  if (wFarm > 0.01) {
    vec2 q = p - farm.xy;
    float ca = cos(farm.z), sa = sin(farm.z);
    q = vec2(q.x * ca - q.y * sa, q.x * sa + q.y * ca) / vec2(4.6, 3.2);
    vec2 cell = floor(q), fq = fract(q);
    float hc = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 fc = hc < 0.38 ? vec3(0.89, 0.75, 0.28) : hc < 0.6 ? vec3(0.55, 0.68, 0.24) : hc < 0.8 ? vec3(0.77, 0.71, 0.37) : vec3(0.58, 0.46, 0.30);
    float edge = min(min(fq.x, 1.0 - fq.x), min(fq.y, 1.0 - fq.y));
    fc *= (0.8 + 0.2 * smoothstep(0.0, 0.1, edge)) * (0.93 + 0.07 * sin(q.y * 18.0)) * (0.95 + 0.1 * nC.w);
    col = mix(col, fc, wFarm * 0.85 * smoothstep(10.5, 6.0, length(p - farm.xy) + (nB.w - 0.5) * 4.0));
  }
  // город: утоптанная земля и мостовые
  col = mix(col, vec3(0.62, 0.57, 0.46) * (0.9 + 0.15 * nC.w), catC.y * 0.7 * smoothstep(9.5, 4.0, length(p - town) + (nB.w - 0.5) * 5.0));
  // барханы
  float dph = dot(p, vec2(0.5, 0.19)) + nA.x * 11.0;
  vec2 gd = cos(dph) * (vec2(0.5, 0.19) + 11.0 * gA);
  // свет с северо-запада по наклонам рельефа
  vec2 g = (gA * 0.65 + gB * 0.35) * relief * 0.9 + gm * wM * 2.0 + gC * wF * 0.25 + gd * wD * 0.18;
  vec3 nrm = normalize(vec3(-g, 1.0));
  float lit = dot(nrm, LIGHT) / LIGHT.z;
  col *= clamp(mix(1.0, lit, 0.8), 0.5, 1.4);
  col = mix(col, col * vec3(0.84, 0.9, 1.06), wS * clamp(1.0 - lit, 0.0, 1.0));
  // пляж, мокрый песок у воды; у скал и льдов — тёмная кромка
  float sandy = 1.0 - clamp(wM + wS + wT, 0.0, 1.0);
  float bw = 1.3 + 2.0 * nB.w;
  float beach = (1.0 - smoothstep(bw * 0.45, bw, cd)) * sandy;
  vec3 sand = mix(vec3(0.84, 0.77, 0.58), vec3(0.95, 0.88, 0.68), warm) * (0.94 + 0.08 * nC.x);
  col = mix(col, sand, beach);
  col *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, 0.9, cd)) * sandy;
  col *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 1.8, cd)) * (1.0 - sandy);
  return col;
}

void main() {
  vec2 p = vPos;
  vec4 nw = texture(uNoise, p / 19.0);
  float wob = (nw.x - 0.5) * 2.4; // берег чуть неровный, не по линейке
  float dFar = fieldDist(p);
  float lat = latOf(p);
  vec2 a = hexOf(p);
  vec4 own = tileAt(a);
  bool ownLand = kindOf(own) >= 2;
  // открытое море: только пена и льды
  if (!ownLand && dFar > 11.0) {
    finalColor = sea(p, dFar + wob, lat, nw);
    return;
  }
  // клетка и шесть соседей: точное расстояние до берега и смешение соседних ландшафтов
  float warm = 1.0 - smoothstep(18.0, 48.0, abs(lat));
  vec2 wn = vec2(nw.x, nw.w) - 0.5;
  float dL = 1e3, dW = 1e3, wsum = 0.0, relief = 0.0, best = 1e3, farmBest = 0.0;
  vec3 base = vec3(0.0), bestCol = vec3(0.5), farm = vec3(0.0);
  vec2 town = vec2(-1e4);
  vec4 catA = vec4(0.0);
  vec3 catB = vec3(0.0);
  vec2 catC = vec2(0.0);
  for (int i = 0; i < 7; i++) {
    vec2 ai = a + OFF[i];
    vec4 td = i == 0 ? own : tileAt(ai);
    int k = kindOf(td);
    float d = sdHex(p - hexCenter(ai));
    if (k < 2) {
      dW = min(dW, d);
      continue;
    }
    dL = min(dL, d);
    vec4 look = kindLook(k, warm);
    vec3 c = look.rgb * (0.96 + 0.08 * td.g);
    if (d < best) {
      best = d;
      bestCol = c;
    }
    // у каждой клетки свой изгиб границы — ландшафты заходят друг в друга
    float ang = td.g * 6.2832;
    float w = clamp(0.5 - (d + dot(wn, vec2(cos(ang), sin(ang))) * 6.0) / 6.0, 0.0, 1.0);
    wsum += w;
    base += c * w;
    relief += look.a * w;
    catA += w * vec4(float(k == 4), float(k == 5), float(k == 8), float(k == 7));
    catB += w * vec3(float(k == 6), float(k == 2), float(k == 3));
    float fw = float(td.b > 0.4 && td.b < 0.9) * w;
    catC += vec2(fw, float(td.b >= 0.9) * w);
    if (fw > farmBest) {
      farmBest = fw;
      farm = vec3(hexCenter(ai), td.g * 3.1416);
    }
    if (td.b >= 0.9) town = hexCenter(ai);
  }
  float norm = 1.0 / (wsum + 0.001);
  base = (base + bestCol * 0.001) * norm;
  // < 0 — суша; дальше от берега — поле расстояний
  float sd = ownLand ? -dW : (dL < 500.0 ? mix(dL, dFar, smoothstep(7.0, 10.0, dFar)) : dFar);
  sd += wob;
  float aa = max(uPx, 0.25) * 0.8;
  float aL = smoothstep(aa, -aa, sd);
  vec4 below = vec4(0.0);
  if (aL < 1.0) {
    // суша приподнята над морем: где вода южнее (ближе к зрителю), видна каменная стенка обрыва,
    // а прибой бьёт в её подножие
    vec2 e = vec2(1.5, 0.0);
    vec2 fg = vec2(fieldDist(p + e.xy) - fieldDist(p - e.xy), fieldDist(p + e.yx) - fieldDist(p - e.yx));
    float face = smoothstep(0.1, 0.65, fg.y / max(length(fg), 0.001));
    float cw = (2.0 + 1.8 * nw.w) * face;
    float sw = max(sd, 0.0);
    below = sea(p, max(sw - cw * (1.0 - smoothstep(4.0, 9.0, sw)), 0.0), lat, nw);
    if (cw > 0.0) {
      float u = clamp(sw / cw, 0.0, 1.0);
      vec4 st = texture(uNoise, vec2(p.x / 2.5, p.y / 16.0) + vec2(0.3, 0.7));
      vec3 rock = mix(vec3(0.44, 0.36, 0.27), vec3(0.63, 0.57, 0.48), st.x * 0.7 + nw.w * 0.3);
      rock *= (1.0 - 0.5 * u) * (0.85 + 0.3 * st.w);
      // наверху — кромка травы или песка
      rock = mix(rock, base * 0.85, (1.0 - smoothstep(0.0, 0.3, u)) * 0.7);
      below = mix(below, vec4(rock, 1.0), smoothstep(cw + aa, cw - aa, sw));
    }
  }
  if (aL <= 0.0) {
    finalColor = below;
    return;
  }
  vec3 land = landColor(p, base, relief * norm, catA * norm, catB * norm, catC * norm, farm, town, max(-sd, 0.0), lat);
  finalColor = mix(below, vec4(land, 1.0), aL);
}
`;

export class Surface {
  /** Толща воды — под рыбами и китами. */
  readonly water: Mesh<Geometry, Shader>;
  /** Суша, пена и льды — над ними. */
  readonly land: Mesh<Geometry, Shader>;
  private uniforms = new UniformGroup({ uTime: { value: 0, type: 'f32' }, uPx: { value: 1, type: 'f32' } });

  /** Нужен WebGL 2; на старых устройствах MapView рисует воду и сушу по-старому. */
  static supported(renderer: Renderer) {
    return typeof WebGL2RenderingContext !== 'undefined' && (renderer as WebGLRenderer).gl instanceof WebGL2RenderingContext;
  }

  constructor(env: SurfaceEnv) {
    const field = makeField(env);
    const noise = makeNoise();
    const buf = (data: Uint8Array, width: number, height: number, opts: Partial<ConstructorParameters<typeof BufferImageSource>[0]>) =>
      new BufferImageSource({ resource: data, width, height, format: 'rgba8unorm', alphaMode: 'no-premultiply-alpha', ...opts });
    const resources = {
      uTiles: buf(makeTiles(), COLS, ROWS, { scaleMode: 'nearest', addressMode: 'clamp-to-edge' }),
      uField: buf(field.data, field.w, field.h, { scaleMode: 'linear', addressMode: 'clamp-to-edge' }),
      uNoise: buf(noise.data, NOISE, NOISE, { scaleMode: 'linear', addressMode: 'repeat', autoGenerateMipmaps: true }),
      surface: this.uniforms,
    };
    const head = header(env.s, field, noise.grad);
    // с запасом за края мира: камера может показать полоску над и под картой
    const m = 300, x0 = -m, y0 = -m, x1 = env.width + m, y1 = env.height + m;
    const quad = () => new Geometry({ attributes: { aPosition: [x0, y0, x1, y0, x1, y1, x0, y1] }, indexBuffer: [0, 1, 2, 0, 2, 3] });
    const mesh = (frag: string) => new Mesh({ geometry: quad(), shader: Shader.from({ gl: { vertex: VERTEX, fragment: head + frag }, resources }) });
    this.water = mesh(WATER_FRAG);
    this.land = mesh(LAND_FRAG);
  }

  /** zoom — масштаб карты, res — плотность пикселей; animate = false — волны замирают. */
  update(now: number, zoom: number, res: number, animate: boolean) {
    const u = this.uniforms.uniforms;
    if (animate) u.uTime = (now / 1000) % 20000;
    u.uPx = 1 / (zoom * res);
  }
}
