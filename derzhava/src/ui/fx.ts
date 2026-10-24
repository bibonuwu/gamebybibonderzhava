// Эффекты интерфейса поверх всего: волна от нажатия, всплывающие «+/−» у ресурсов, монеты, летящие в казну.
// Работают с DOM напрямую, в обход Preact: свой слой в <body>, у кнопок меняются только CSS-переменные.
import { STATS } from '../game/economy';
import { fmt } from '../game/format';
import { getGame, subscribe } from '../game/state';
import type { GameState } from '../game/types';
import { prefs } from './store';

let layer: HTMLDivElement | null = null;
function fxLayer() {
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

/** Элемент живёт, пока идёт его анимация. */
function spawn(cls: string, text: string, x: number, y: number) {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  fxLayer().appendChild(el);
  return el;
}

const RIPPLE = '.btn, .nav button, .tabs button, .seg button, .country-btn, .option-card, .res, .toggle, .map-ctl button, .st-chip, .time-ctl button';
// без поддержки анимации псевдоэлементов волна анимировала бы саму кнопку — тогда обходимся без неё
const PSEUDO_ANIM = typeof KeyframeEffect !== 'undefined' && 'pseudoElement' in KeyframeEffect.prototype;

function ripple(e: PointerEvent) {
  if (!PSEUDO_ANIM || !prefs.fx) return;
  const el = (e.target as Element | null)?.closest?.(RIPPLE) as HTMLElement | null;
  if (!el || (el as HTMLButtonElement).disabled) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--rx', `${e.clientX - r.left}px`);
  el.style.setProperty('--ry', `${e.clientY - r.top}px`);
  el.style.setProperty('--rs', `${Math.max(r.width, r.height) * 2.4}px`);
  el.animate(
    [{ transform: 'scale(0)', opacity: 0.32 }, { transform: 'scale(1)', opacity: 0 }],
    { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)', pseudoElement: '::after' },
  );
}

const lastPress = { x: 0, y: 0, t: -1e9 };

/** «+1.2K» / «−500» под плиткой ресурса. */
function chip(target: Element, text: string, good: boolean) {
  const r = target.getBoundingClientRect();
  const el = spawn(`fx-chip ${good ? 'good' : 'bad'}`, text, r.left + r.width / 2, r.bottom - 8);
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 2000);
}

function bump(target: Element, good: boolean) {
  const val = target.querySelector('.val');
  val?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
  const glow = good ? 'rgba(95, 211, 138, 0.6)' : 'rgba(255, 122, 122, 0.55)';
  target.animate(
    [{ boxShadow: `0 0 0 0 ${glow}` }, { boxShadow: `0 0 0 3px ${glow}` }, { boxShadow: '0 0 0 0 rgba(0,0,0,0)' }],
    { duration: 650, easing: 'ease-out' },
  );
}

/** Монеты (или мозги) разлетаются от точки нажатия и слетаются в плитку ресурса. */
export function flyTo(x: number, y: number, target: Element, icon: string, count = 9) {
  if (!prefs.fx) return;
  const r = target.getBoundingClientRect();
  const tx = r.left + r.width / 2 - x, ty = r.top + r.height / 2 - y;
  for (let i = 0; i < count; i++) {
    const el = spawn('fx-coin', icon, x, y);
    const a = Math.random() * Math.PI * 2;
    const spread = 30 + Math.random() * 50;
    const mx = Math.cos(a) * spread, my = Math.sin(a) * spread - 40;
    const anim = el.animate(
      [
        { transform: 'translate(-50%, -50%) translate(0, 0) scale(0.4)', opacity: 0 },
        { transform: `translate(-50%, -50%) translate(${mx}px, ${my}px) scale(1.15)`, opacity: 1, offset: 0.3 },
        { transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(0.55)`, opacity: 0.9 },
      ],
      { duration: 820 + Math.random() * 260, delay: i * 35, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'backwards' },
    );
    anim.onfinish = () => el.remove();
    setTimeout(() => el.remove(), 2400);
  }
}

// ---------- изменения казны и интеллекта не от обычного дохода: покупки, награды, продажи ----------
let prev: { g: GameState; day: number; money: number; brains: number } | null = null;

function check(res: 'money' | 'brains', d: number, rate: number) {
  if (Math.abs(d) <= Math.max(Math.abs(rate) * 1.5, 1)) return;
  const tile = document.querySelector(`[data-res="${res}"]`);
  if (!tile || !prefs.fx) return;
  const good = d > 0;
  chip(tile, `${good ? '+' : ''}${fmt(d)}`, good);
  const fromClick = performance.now() - lastPress.t < 1500;
  if (good && fromClick) {
    flyTo(lastPress.x, lastPress.y, tile, res === 'money' ? '🪙' : '🧠');
    setTimeout(() => bump(tile, true), 800);
  } else bump(tile, good);
}

function watch() {
  const g = getGame();
  const s = g && STATS[g.player];
  if (!g || !s) {
    prev = null;
    return;
  }
  const c = g.countries[g.player];
  if (prev && prev.g === g) {
    const days = g.day - prev.day;
    check('money', c.money - prev.money - days * s.moneyRate, s.moneyRate);
    check('brains', c.brains - prev.brains - days * s.brainsRate, s.brainsRate);
  }
  prev = { g, day: g.day, money: c.money, brains: c.brains };
}

export function initFx() {
  document.addEventListener('pointerdown', (e) => {
    lastPress.x = e.clientX;
    lastPress.y = e.clientY;
    lastPress.t = performance.now();
    ripple(e);
  }, true);
  subscribe(watch);
}
