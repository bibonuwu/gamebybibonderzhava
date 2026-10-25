// Сохранения: три слота в localStorage, корзина и файлы.
// Ничего не пропадает молча: сохранение, которое эта версия не может открыть, остаётся в слоте (его можно скачать
// файлом), а перед удалением или перезаписью слот уходит в корзину — последнее удалённое можно восстановить.
import { initAssembly } from './assembly';
import { BASE_RATE } from './debt';
import { initElections } from './elections';
import { initLodge } from './lodge';
import { SAVE_VERSION } from './newGame';
import { initSociety } from './society';
import { initIntel } from './spy';
import type { GameState } from './types';
import { COUNTRY_DEFS, REGIONS } from './world';

export const SLOTS = 3;
const KEY = 'derzhava-save-v1'; // слот 1 — прежний ключ: старые сохранения на месте
const slotKey = (k: number) => (k === 1 ? KEY : `${KEY}-s${k}`);
const ACTIVE_KEY = 'derzhava-slot';
const TRASH_KEY = 'derzhava-trash-v1';
const TRASH_META_KEY = 'derzhava-trash-meta-v1';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
    return true;
  } catch {
    return false; // хранилище недоступно или переполнено
  }
};
const remove = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ничего */
  }
};

let active = (() => {
  const v = Number(read(ACTIVE_KEY));
  return v >= 1 && v <= SLOTS ? v : 1;
})();
/** Слот, в который идёт автосохранение текущей партии. */
export const activeSlot = () => active;
export function setActiveSlot(k: number) {
  active = k;
  write(ACTIVE_KEY, String(k));
}

/** false — сохранить не удалось (хранилище недоступно или переполнено). */
export function saveGame(g: GameState): boolean {
  return write(slotKey(active), JSON.stringify(g));
}

// ---------- чтение ----------
export type Parsed = { g: GameState } | { error: string };

/** Разобрать сохранение (из слота или файла) и дополнить полями, появившимися позже. */
export function parseSave(raw: string): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: 'Файл повреждён — это не сохранение «Державы»' };
  }
  // скачанный из игры файл — в обёртке с подписью
  const d = data as { app?: string; game?: unknown } | null;
  const g = (d && d.app === 'derzhava' ? d.game : data) as GameState | null;
  if (!g || typeof g !== 'object' || !Array.isArray(g.countries) || !Array.isArray(g.regions) || typeof g.day !== 'number') {
    return { error: 'Это не сохранение «Державы»' };
  }
  if (g.version > SAVE_VERSION) return { error: 'Сохранение из более новой версии игры — обновите игру' };
  if (g.version !== SAVE_VERSION) return { error: 'Сохранение из старой версии игры — эта версия его не откроет' };
  if (g.regions.length !== REGIONS.length || g.countries.length !== COUNTRY_DEFS.length) {
    return { error: 'Сохранение сделано на другой карте мира — эта версия его не откроет' };
  }
  try {
    migrate(g);
  } catch {
    return { error: 'Сохранение повреждено' };
  }
  return { g };
}

/** Поля, появившиеся позже: старые сохранения продолжают работать. */
function migrate(g: GameState) {
  g.wonders ??= {};
  g.quests ??= [];
  g.missiles ??= [];
  g.fallout ??= {};
  g.un ??= [];
  g.rebels ??= [];
  g.lodge ??= initLodge(g);
  g.assembly ??= initAssembly(g);
  g.elections ??= initElections(g);
  g.intel ??= initIntel(g);
  g.finance ??= { base: BASE_RATE, shock: 0, nextCrisis: g.day + 1800 };
  // санкции и коалиции прежней версии ООН: без дела в g.un они не кончились бы никогда
  for (const c of g.countries) c.mods = c.mods.filter((m) => m.label !== 'Санкции ООН');
  for (const p of Object.values(g.pairs)) if (p.war?.un !== undefined && !g.un.some((cs) => cs.aggressor === p.war!.un)) delete p.war.un;
  g.mail ??= [];
  g.mailSeen ??= [];
  g.nextMailDay ??= g.day + 20;
  for (const c of g.countries) c.moneyScale ??= Math.max(30, c.lastGross);
  // раньше термояд улучшал все боеголовки — теперь это отдельные бомбы
  for (const c of g.countries) {
    if (c.hbombs === undefined && c.nukes && c.techs.includes('thermonuclear')) {
      c.hbombs = c.nukes;
      c.nukes = 0;
      c.hbombTested = true;
    }
  }
  initSociety(g, !g.market);
}

export interface SlotInfo {
  slot: number;
  raw?: string; // нет — слот пуст
  g?: GameState;
  error?: string; // есть сохранение, но открыть его нельзя
}
export function slotInfo(k: number): SlotInfo {
  const raw = read(slotKey(k));
  if (!raw) return { slot: k };
  const p = parseSave(raw);
  return 'g' in p ? { slot: k, raw, g: p.g } : { slot: k, raw, error: p.error };
}
export const allSlots = () => Array.from({ length: SLOTS }, (_, k) => slotInfo(k + 1));

export function loadGame(k = active): GameState | null {
  return slotInfo(k).g ?? null;
}
export function hasSave(): boolean {
  return allSlots().some((s) => s.raw);
}

// ---------- запись и корзина ----------
export interface TrashMeta {
  when: number; // Date.now()
  slot: number;
  player?: number;
  day?: number;
  error?: string;
}

function toTrash(k: number) {
  const info = slotInfo(k);
  if (!info.raw) return;
  const meta: TrashMeta = { when: Date.now(), slot: k, player: info.g?.player, day: info.g?.day, error: info.error };
  if (write(TRASH_KEY, info.raw)) write(TRASH_META_KEY, JSON.stringify(meta));
}

/** Удалить слот: сохранение уходит в корзину, а не исчезает. */
export function deleteSave(k = active) {
  toTrash(k);
  remove(slotKey(k));
}

/** Записать партию в слот (старое содержимое — в корзину) и сделать его текущим. */
export function writeSlot(k: number, g: GameState): boolean {
  toTrash(k);
  setActiveSlot(k);
  return saveGame(g);
}

export function trashInfo(): (TrashMeta & { raw: string; g?: GameState }) | null {
  const raw = read(TRASH_KEY);
  if (!raw) return null;
  let meta: TrashMeta = { when: 0, slot: 0 };
  try {
    meta = { ...meta, ...JSON.parse(read(TRASH_META_KEY) ?? '{}') };
  } catch { /* без подписи */ }
  const p = parseSave(raw);
  return { ...meta, raw, g: 'g' in p ? p.g : undefined };
}
/** Вернуть сохранение из корзины в пустой слот k. */
export function restoreTrash(k: number): string | null {
  const raw = read(TRASH_KEY);
  if (!raw) return 'Корзина пуста';
  if (read(slotKey(k))) return 'Слот занят';
  if (!write(slotKey(k), raw)) return 'Не удалось записать — хранилище переполнено?';
  remove(TRASH_KEY);
  remove(TRASH_META_KEY);
  return null;
}

// ---------- файлы ----------
/** Текст файла сохранения: партия в обёртке с подписью игры. */
export const exportText = (g: GameState) => JSON.stringify({ app: 'derzhava', format: 1, saved: new Date().toISOString(), game: g });
export function saveFileName(g: GameState) {
  return `derzhava-${COUNTRY_DEFS[g.player]?.id ?? 'save'}-day${g.day}.json`;
}
