// Управление картой кнопками и клавиатурой (ПК).
import { useEffect } from 'preact/hooks';
import { emit, getGame } from '../game/state';
import type { MapView } from '../map/MapView';
import { prefs, setPrefs, setUI, ui, useStore, type Speed, type Tab } from './store';

/** ＋ / − / к столице — справа на карте. */
export function MapControls({ map }: { map: MapView }) {
  useStore();
  const g = getGame();
  if (!g || ui.tab !== 'map' || g.gameOver) return null;
  return (
    <div class="map-ctl">
      <button onClick={() => map.zoomBy(1.6)} aria-label="Приблизить" title="Приблизить (E)">＋</button>
      <button onClick={() => map.zoomBy(1 / 1.6)} aria-label="Отдалить" title="Отдалить (Q)">−</button>
      <button onClick={() => map.home()} aria-label="К столице" title="К столице (H)">🏛️</button>
    </div>
  );
}

const TAB_KEYS: Tab[] = ['map', 'policy', 'build', 'diplo', 'army', 'market', 'stats'];
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
      if (!free) return;
      const n = /^(Digit|Numpad)([1-7])$/.exec(e.code);
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
