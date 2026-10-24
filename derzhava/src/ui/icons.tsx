// Картинки вместо эмодзи: силуэт из iconData.ts, залитый градиентом своего цвета, с тёмной обводкой.
// Эмодзи в текстах интерфейса подменяются сами (хук Preact ниже) — в коде игры можно и дальше писать «💰 Деньги».
// Для карты (PixiJS) те же картинки рисуются на canvas.
import { options, type VNode } from 'preact';
import { EMOJI, PATHS } from './iconData';

/** Цвета заливки: блик сверху → основной → тень снизу. */
const TINTS: Record<string, [string, string, string]> = {
  gold: ['#fff3c4', '#f2c14e', '#b7791f'],
  yellow: ['#fffbd6', '#ffd43b', '#d9a400'],
  orange: ['#ffe1c2', '#ff9a3c', '#c2510c'],
  red: ['#ffc9c2', '#f0524a', '#a61e1e'],
  pink: ['#ffd9ea', '#f472a8', '#b8326e'],
  purple: ['#eadfff', '#a07cf5', '#5f3dc4'],
  blue: ['#d6ecff', '#5aa9f0', '#1f5fa8'],
  cyan: ['#d3f9fd', '#4fd1e2', '#0c7f94'],
  green: ['#d3f9d8', '#5fd38a', '#237a3b'],
  olive: ['#eef3c8', '#a3b545', '#5c6b1e'],
  steel: ['#ffffff', '#c3ccd8', '#6b7888'],
  ivory: ['#ffffff', '#f1ead8', '#b5a888'],
  parchment: ['#fff4d6', '#e9cf96', '#a87f3c'],
  brown: ['#f5d9b5', '#c98a4b', '#7a4a1c'],
};

// эмодзи вместе с вариантом (U+FE0F) и составные через U+200D: 🧑‍🔬, 🏴‍☠️
const SEQ = /\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*/gu;
const ANY = /\p{Extended_Pictographic}/u;
const find = (e: string) => EMOJI[e.replace(/️/g, '')] as [string, string] | undefined;

// ---------- общий спрайт: градиенты и силуэты, силуэт добавляется при первом показе ----------
const NS = 'http://www.w3.org/2000/svg';
let sprite: SVGSVGElement | null = null;
const added = new Set<string>();

function use(name: string) {
  if (added.has(name)) return;
  if (!sprite) {
    sprite = document.createElementNS(NS, 'svg');
    sprite.setAttribute('class', 'gi-sprite');
    sprite.setAttribute('aria-hidden', 'true');
    sprite.innerHTML = `<defs>${Object.entries(TINTS).map(([t, [a, b, c]]) =>
      `<linearGradient id="gt-${t}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".45" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`).join('')}</defs>`;
    document.body.prepend(sprite);
  }
  added.add(name);
  const sym = document.createElementNS(NS, 'symbol');
  sym.id = `gi-${name}`;
  sym.setAttribute('viewBox', '0 0 512 512');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', PATHS[name]);
  sym.appendChild(p);
  sprite.appendChild(sym);
}

function svg([name, tint]: [string, string], cls = 'gi', attrs?: Record<string, unknown>): VNode {
  use(name);
  return (
    <svg class={cls} fill={`url(#gt-${tint})`} aria-hidden="true" {...attrs}>
      <use href={`#gi-${name}`} />
    </svg>
  );
}

/**
 * Картинка для эмодзи (если её нет — сам эмодзи).
 * size — для вставки внутрь SVG-сцены: квадрат size×size с центром в x, y.
 */
export function Icon({ e, class: cls, x = 0, y = 0, size }: { e: string; class?: string; x?: number; y?: number; size?: number }) {
  const ic = find(e);
  if (!ic) return size ? <text x={x} y={y + size * 0.35} text-anchor="middle" font-size={size}>{e}</text> : <>{e}</>;
  if (size) return svg(ic, `gi-in ${cls ?? ''}`, { x: x - size / 2, y: y - size / 2, width: size, height: size });
  return svg(ic, cls ? `gi ${cls}` : 'gi');
}

/** Разметка картинки для эффектов, которые строятся в обход Preact. */
export function iconHTML(e: string) {
  const ic = find(e);
  if (!ic) return e;
  use(ic[0]);
  return `<svg class="gi" fill="url(#gt-${ic[1]})" aria-hidden="true"><use href="#gi-${ic[0]}"/></svg>`;
}

// ---------- подмена эмодзи в текстах интерфейса ----------
function split(s: string): string | (string | VNode)[] {
  const out: (string | VNode)[] = [];
  let last = 0;
  for (const m of s.matchAll(SEQ)) {
    const ic = find(m[0]);
    if (!ic) continue;
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(svg(ic));
    last = m.index + m[0].length;
  }
  if (!out.length) return s;
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function swap(c: unknown): unknown {
  if (typeof c === 'string') return ANY.test(c) ? split(c) : c;
  if (!Array.isArray(c)) return c;
  let out: unknown[] | null = null;
  for (let i = 0; i < c.length; i++) {
    const v = swap(c[i]);
    if (v !== c[i]) (out ??= c.slice())[i] = v;
  }
  return out ?? c;
}

// в этих элементах картинка не может стоять внутри текста
const PLAIN = new Set(['text', 'tspan', 'title', 'option', 'textarea', 'style', 'script']);

/** Все эмодзи, которые интерфейс выводит текстом, становятся картинками. */
export function initIcons() {
  const prev = options.vnode;
  options.vnode = (v) => {
    if (typeof v.type === 'string' && !PLAIN.has(v.type)) {
      const p = v.props as { children?: unknown };
      if (p.children != null) p.children = swap(p.children);
    }
    prev?.(v);
  };
}

// ---------- карта: та же картинка на canvas ----------
const paths = new Map<string, Path2D>();

/** Картинка size×size px на отдельном canvas; null — для эмодзи картинки нет. */
export function iconCanvas(e: string, size: number): HTMLCanvasElement | null {
  const ic = find(e);
  if (!ic) return null;
  const [name, tint] = ic;
  let p = paths.get(name);
  if (!p) paths.set(name, (p = new Path2D(PATHS[name])));
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  // обводка выходит за силуэт — оставляем ей поле
  const k = size / 560;
  ctx.translate(24 * k, 24 * k);
  ctx.scale(k, k);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  const [a, b, c] = TINTS[tint];
  g.addColorStop(0, a);
  g.addColorStop(0.45, b);
  g.addColorStop(1, c);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 34;
  ctx.strokeStyle = 'rgba(10, 16, 28, 0.85)';
  ctx.stroke(p);
  ctx.fillStyle = g;
  ctx.fill(p);
  return cv;
}
