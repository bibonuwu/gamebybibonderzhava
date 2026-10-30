// Состояние интерфейса и игровой цикл (автопауза при сворачивании).
import { useEffect, useState } from 'preact/hooks';
import { saveGame } from '../game/save';
import { tick } from '../game/sim';
import { emit, getGame, sfx, subscribe, toast } from '../game/state';

export type Tab = 'map' | 'policy' | 'build' | 'army' | 'market' | 'stats';
export type ArmyTab = 'army' | 'diplo' | 'lodge' | 'spy' | 'un';
export type MarketTab = 'food' | 'arms' | 'res' | 'trade' | 'sci' | 'corp';
export type PolicyTab = 'econ' | 'society' | 'people' | 'power' | 'future' | 'science';
export type Modal =
  | { kind: 'country'; id: number }
  | { kind: 'attack'; rid: number }
  | { kind: 'details'; res: 'money' | 'brains' | 'pop' | 'stab' }
  | { kind: 'confirm'; title: string; text: string; ok: () => void; danger?: boolean; okText?: string }
  | { kind: 'menu' }
  | { kind: 'quests' }
  | { kind: 'news' }
  | { kind: 'mail'; id?: number; quick?: boolean }; // без id — ящик, с id — письмо; quick — без анимации (после ответа)

export const ui = {
  tab: 'map' as Tab,
  tile: -1,
  paused: false,
  modal: null as Modal | null,
  frac: 0,
  marketTab: 'food' as MarketTab,
  tradeShare: 0.25, // биржа: купить на эту долю казны, продать эту долю запаса
  armyTab: 'army' as ArmyTab, // «Армия», «Дипломатия», «Разведка», «Ложа» и «ООН» — одна вкладка
  spyTarget: -1, // страна, выбранная во вкладке «Разведка»
  policyTab: 'econ' as PolicyTab, // какую подвкладку «Политики» открыть
};

export function setUI(patch: Partial<typeof ui>) {
  Object.assign(ui, patch);
  emit();
}

// настройки игрока: скорость времени и эффекты — запоминаем между запусками
export type Speed = 1 | 2 | 3;
const PREFS_KEY = 'derzhava-ui-v1';
export const prefs = { speed: 1 as Speed, fx: true };
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'));
} catch { /* хранилище недоступно — по умолчанию */ }
if (![1, 2, 3].includes(prefs.speed)) prefs.speed = 1;

export function setPrefs(patch: Partial<typeof prefs>) {
  Object.assign(prefs, patch);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* не запомним */ }
  applyPrefs();
  emit();
}
export function applyPrefs() {
  document.documentElement.classList.toggle('no-fx', !prefs.fx);
}
export const cycleSpeed = () => setPrefs({ speed: (prefs.speed % 3) + 1 as Speed });

/** Перерисовка компонента на каждое изменение игры/интерфейса. */
export function useStore() {
  const [, set] = useState(0);
  useEffect(() => subscribe(() => set((x) => x + 1)), []);
}

/** Показать результат действия: null — успех. */
export function report(err: string | null, okText?: string) {
  if (err) {
    sfx('error');
    toast(err, 'bad');
  }
  else if (okText) toast(okText, 'good');
  emit();
}

let acc = 0;
let last = 0;
let lastSave = 0;
export function startLoop() {
  applyPrefs();
  last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(now - last, 1500);
    last = now;
    const g = getGame();
    if (!g || g.gameOver || ui.paused || document.hidden) return;
    acc += dt * prefs.speed;
    if (acc >= 1000) {
      acc -= 1000;
      if (acc > 1000) acc = 0;
      tick(g);
      emit();
    }
    ui.frac = acc / 1000;
    if (now - lastSave > 10000) {
      saveGame(g);
      lastSave = now;
    }
  };
  requestAnimationFrame(frame);
  // автопауза: свернули вкладку — сохраняем, время стоит
  document.addEventListener('visibilitychange', () => {
    const g = getGame();
    if (document.hidden && g) saveGame(g);
    last = performance.now();
    emit();
  });
  window.addEventListener('pagehide', () => {
    const g = getGame();
    if (g) saveGame(g);
  });
}
