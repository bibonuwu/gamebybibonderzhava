// Текущая партия, подписки интерфейса, уведомления.
import type { Building, GameState, LogEntry } from './types';
import { N, REGION_OF } from './world';

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
  | 'nuke' | 'siren' | 'mail' | 'paper';
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

// ---------- здания: быстрый обход ----------
// for…in по g.buildings на тысячах зданий медленный (каждый ключ — строка), а здания обходят много раз за день.
// Поэтому держим готовый список клеток по возрастанию — в том же порядке, что и for…in, — и пересобираем его,
// только когда здание появилось, исчезло или поменяло клетки. Ставить, сносить и перекраивать здания — только через
// putBuilding / removeBuilding / setBuildingTiles / ruinTile.
let indexed: GameState['buildings'] | null = null;
const index = { tiles: [] as number[], list: [] as Building[] };
/** Клетка → главная клетка комплекса, который на ней стоит (-1 — свободна). */
const occupied = new Int32Array(N).fill(-1);

/** Все здания: tiles[k] — главная клетка, list[k] — здание на ней. Внутри обхода здания не ставить и не сносить. */
export function allBuildings(g: GameState): { readonly tiles: readonly number[]; readonly list: readonly Building[] } {
  if (indexed !== g.buildings) {
    indexed = g.buildings;
    index.tiles = Object.keys(g.buildings).map(Number);
    index.list = index.tiles.map((t) => g.buildings[t]);
    occupied.fill(-1);
    for (let k = 0; k < index.tiles.length; k++) {
      const t = index.tiles[k];
      occupied[t] = t;
      for (const x of index.list[k].tiles ?? []) occupied[x] = t;
    }
  }
  return index;
}
/** Главная клетка здания-комплекса, которое занимает клетку (-1 — клетка свободна). */
export function buildingAt(g: GameState, tile: number): number {
  allBuildings(g);
  return tile >= 0 ? occupied[tile] : -1;
}
/** Все клетки комплекса: главная и пристройки. */
export const buildingTiles = (tile: number, b: Building): number[] => (b.tiles?.length ? [tile, ...b.tiles] : [tile]);
export const buildingSize = (b: Building) => 1 + (b.tiles?.length ?? 0);
/** Сколько клеток комплекса уже работает: пристройки, которые ещё строятся, не в счёт. */
export const buildingWorking = (b: Building) => buildingSize(b) - (b.progress > 0 ? b.add ?? 0 : 0);

export function putBuilding(g: GameState, tile: number, b: Building) {
  g.buildings[tile] = b;
  indexed = null;
}
export function removeBuilding(g: GameState, tile: number) {
  delete g.buildings[tile];
  indexed = null;
}
/** Новые пристройки комплекса; add — сколько последних из них ещё строится. */
export function setBuildingTiles(g: GameState, tile: number, tiles: number[], add = 0) {
  const b = g.buildings[tile];
  if (tiles.length) b.tiles = tiles;
  else delete b.tiles;
  if (add > 0) b.add = add;
  else delete b.add;
  indexed = null;
}

/** Разрушить одну клетку комплекса: он её теряет, а последняя клетка — и есть всё здание. false — клетка была свободна. */
export function ruinTile(g: GameState, tile: number): boolean {
  const at = buildingAt(g, tile);
  if (at < 0) return false;
  const b = g.buildings[at];
  const rest = b.tiles ?? [];
  if (!rest.length) {
    removeBuilding(g, at);
    return true;
  }
  const keep = rest.filter((x) => x !== tile);
  // пристройки после индекса work ещё строятся
  const work = rest.length - (b.add ?? 0);
  const add = (b.add ?? 0) - (rest.indexOf(tile) >= work ? 1 : 0);
  if (at === tile) {
    // разрушена главная клетка — главной становится первая пристройка
    removeBuilding(g, at);
    putBuilding(g, keep[0], { ...b });
    setBuildingTiles(g, keep[0], keep.slice(1), Math.min(add, keep.length - 1));
  } else setBuildingTiles(g, at, keep, add);
  return true;
}

/** Пристройки на земле, которая отошла к другой стране (или стала ничьей), отпадают от комплекса. */
export function trimBuildings(g: GameState) {
  const { tiles, list } = allBuildings(g);
  const cut: number[] = [];
  for (let k = 0; k < tiles.length; k++) {
    const own = g.regions[REGION_OF[tiles[k]]].owner;
    for (const t of list[k].tiles ?? []) if (g.regions[REGION_OF[t]].owner !== own) cut.push(t);
  }
  for (const t of cut) ruinTile(g, t);
}

export function rand(g: GameState): number {
  g.rng = (g.rng + 0x6d2b79f5) | 0;
  let t = g.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const pick = <T,>(g: GameState, arr: T[]): T => arr[Math.floor(rand(g) * arr.length)];
