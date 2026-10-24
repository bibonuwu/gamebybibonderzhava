// Текущая партия, подписки интерфейса, уведомления.
import type { GameState, LogEntry } from './types';

let current: GameState | null = null;
export const getGame = () => current;
export function setGame(g: GameState | null) {
  current = g;
  headlines.length = 0;
  deals.length = 0;
  banners.length = 0;
  emit();
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function emit() {
  listeners.forEach((l) => l());
}

export interface Toast {
  id: number;
  text: string;
  kind: LogEntry['kind'];
  leaving?: boolean; // уезжает — интерфейс проигрывает анимацию ухода
}
export const toasts: Toast[] = [];
let toastId = 1;
export function toast(text: string, kind: LogEntry['kind'] = 'info') {
  const t: Toast = { id: toastId++, text, kind };
  toasts.push(t);
  if (toasts.length > 4) toasts.shift();
  setTimeout(() => dismissToast(t.id), 4200);
  emit();
}
/** Убрать уведомление (по таймеру или нажатию) — сначала анимация ухода. */
export function dismissToast(id: number) {
  const t = toasts.find((x) => x.id === id);
  if (!t || t.leaving) return;
  t.leaving = true;
  emit();
  setTimeout(() => {
    const i = toasts.indexOf(t);
    if (i >= 0) toasts.splice(i, 1);
    emit();
  }, 260);
}

/** Крупный баннер по центру сверху: достижения, победы, война, чудеса света. */
export interface Banner {
  id: number;
  icon: string;
  title: string;
  text: string;
  kind: 'gold' | 'good' | 'war';
}
export const banners: Banner[] = [];
let bannerId = 1;
export function banner(b: Omit<Banner, 'id'>) {
  banners.push({ ...b, id: bannerId++ });
  if (banners.length > 4) banners.splice(1, 1);
  emit();
}

const LOG_MAX = 150;

/** Запись в журнал игрока (и всплывающее уведомление). */
export function log(g: GameState, text: string, kind: LogEntry['kind'] = 'info', popup = true) {
  g.log.unshift({ day: g.day, text, kind });
  if (g.log.length > LOG_MAX) g.log.length = LOG_MAX;
  if (popup) toast(text, kind);
}

export interface Headline {
  id: number;
  text: string;
  kind: LogEntry['kind'];
}
/** Свежие мировые новости для бегущей строки. */
export const headlines: Headline[] = [];
let headlineId = 1;

/** Мировая новость: события между ботами (в журнал «Мир» и бегущую строку). */
export function news(g: GameState, text: string, kind: LogEntry['kind'] = 'info') {
  g.log.unshift({ day: g.day, text, kind, world: true });
  if (g.log.length > LOG_MAX) g.log.length = LOG_MAX;
  headlines.push({ id: headlineId++, text, kind });
  if (headlines.length > 6) headlines.shift();
}

/** Подписанный игроком договор: что было до и что стало после — интерфейс показывает это красиво. */
export interface Deal {
  id: number;
  kind: 'trade' | 'pact' | 'alliance' | 'peace';
  partner: number;
  rateBefore: number; // 💰/сек
  rateAfter: number;
  relBefore: number;
  relAfter: number;
  powerBefore: number; // ⚔️ (у союза — вместе с союзником)
  powerAfter: number;
  soldiersBack?: number; // мир: вернулись с фронта
}
export const deals: Deal[] = [];
let dealId = 1;
export function celebrate(d: Omit<Deal, 'id'>) {
  deals.push({ ...d, id: dealId++ });
  if (deals.length > 3) deals.shift();
}

// ---------- звук и эффекты на карте: логика только сообщает, интерфейс решает, как показать ----------
export type Sfx =
  | 'click' | 'build' | 'done' | 'research' | 'coins' | 'war' | 'attack' | 'alarm' | 'victory' | 'defeat' | 'peace'
  | 'treaty' | 'notify' | 'event' | 'achievement' | 'error' | 'annex' | 'revolution' | 'recruit' | 'wonder' | 'quest'
  | 'nuke' | 'siren';
let sfxHandler: ((s: Sfx) => void) | null = null;
export const setSfxHandler = (h: typeof sfxHandler) => {
  sfxHandler = h;
};
export const sfx = (s: Sfx) => sfxHandler?.(s);

export interface MapFx {
  kind: 'float' | 'flash' | 'missile' | 'nuke';
  tile: number;
  text?: string;
  color?: number;
  from?: number; // клетка старта ракеты
  big?: boolean; // термоядерный взрыв
  near?: boolean; // взрыв касается игрока: вспышка на весь экран
}
export const mapFx: MapFx[] = [];
export function fx(e: MapFx) {
  if (mapFx.length < 60) mapFx.push(e);
}

/** Флаг: территория изменилась — карте нужно перерисовать границы. */
export const mapDirty = { territory: true, buildings: true };

export function rand(g: GameState): number {
  g.rng = (g.rng + 0x6d2b79f5) | 0;
  let t = g.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const pick = <T,>(g: GameState, arr: T[]): T => arr[Math.floor(rand(g) * arr.length)];
