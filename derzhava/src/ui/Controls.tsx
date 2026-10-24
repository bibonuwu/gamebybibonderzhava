// Управление картой с клавиатуры (ПК).
import { useEffect } from 'preact/hooks';
import { resolveEvent } from '../game/events';
import { emit, getGame } from '../game/state';
import type { MapView } from '../map/MapView';
import { prefs, setPrefs, setUI, ui, type Speed, type Tab } from './store';

const TAB_KEYS: Tab[] = ['map', 'policy', 'build', 'army', 'market', 'stats'];
const PAN: Record<string, string> = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};

/** Горячие клавиши. Коды клавиш (e.code) — работают и в русской раскладке. */
export function useHotkeys(map: MapView) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
      const g = getGame();
      if (!g) return;
      const free = !g.event && !g.gameOver && !ui.modal;
      const dir = PAN[e.code];
      if (dir) {
        if (free && ui.tab === 'map') {
          e.preventDefault();
          map.keyPan(dir, true);
        }
        return;
      }
      if (e.repeat) return;
      switch (e.code) {
        case 'Escape':
          if (g.event) return;
          if (ui.modal) setUI({ modal: null });
          else if (ui.tile >= 0) {
            map.select(-1);
            setUI({ tile: -1 });
          } else if (ui.tab !== 'map') setUI({ tab: 'map' });
          else setUI({ modal: { kind: 'menu' } });
          return;
        case 'Space':
          e.preventDefault();
          if (!g.gameOver) setUI({ paused: !ui.paused });
          return;
        case 'Equal': case 'NumpadAdd':
          setPrefs({ speed: Math.min(3, prefs.speed + 1) as Speed });
          return;
        case 'Minus': case 'NumpadSubtract':
          setPrefs({ speed: Math.max(1, prefs.speed - 1) as Speed });
          return;
      }
      // окно события: цифра — номер варианта ответа
      const opt = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (g.event && opt) {
        const i = +opt[2] - 1;
        if (i < g.event.options.length) {
          resolveEvent(g, i);
          emit();
        }
        return;
      }
      if (!free) return;
      const n = /^(Digit|Numpad)([1-6])$/.exec(e.code);
      if (n) {
        const tab = TAB_KEYS[+n[2] - 1];
        setUI({ tab, tile: tab === 'map' ? ui.tile : -1 });
        return;
      }
      switch (e.code) {
        case 'KeyQ': if (ui.tab === 'map') map.zoomBy(1 / 1.5); break;
        case 'KeyE': if (ui.tab === 'map') map.zoomBy(1.5); break;
        case 'KeyH': setUI({ tab: 'map' }); map.home(); break;
        case 'KeyJ': setUI({ modal: { kind: 'quests' } }); break;
        case 'KeyN': setUI({ modal: { kind: 'news' } }); break;
        case 'KeyM': setUI({ modal: { kind: 'mail' } }); break;
        default: return;
      }
      emit();
    };
    const up = (e: KeyboardEvent) => {
      const dir = PAN[e.code];
      if (dir) map.keyPan(dir, false);
    };
    const blur = () => map.clearKeys();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
}
