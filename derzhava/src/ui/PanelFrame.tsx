// Окно вкладки: въезжает с той стороны, куда листают; свайп влево/вправо — соседняя вкладка; кнопка «наверх».
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { setUI, type Tab } from './store';

const ORDER: Tab[] = ['map', 'policy', 'build', 'army', 'market', 'stats'];
let shown: Tab = 'map';
let dir: 'up' | 'left' | 'right' = 'up';

/** Вызывать при каждой отрисовке: запоминает, откуда въезжать вкладке (с карты — снизу, с соседней — сбоку). */
export function trackTab(tab: Tab) {
  if (tab === shown) return;
  const a = ORDER.indexOf(shown), b = ORDER.indexOf(tab);
  dir = a <= 0 ? 'up' : b > a ? 'right' : 'left';
  shown = tab;
}

// где свайп не листает вкладки: ползунки, ленты подвкладок, графики
const NO_SWIPE = 'input, .tabs, .seg, canvas, .no-swipe';

export function PanelFrame({ tab, children }: { tab: Tab; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const [up, setUp] = useState(false);
  const [from] = useState(dir);
  const go = (step: number) => {
    const next = ORDER[ORDER.indexOf(tab) + step];
    if (next) setUI({ tab: next, tile: -1 });
  };
  return (
    <div
      class={`panel from-${from}`} ref={ref}
      onScroll={(e) => {
        const v = (e.currentTarget as HTMLDivElement).scrollTop > 500;
        if (v !== up) setUp(v);
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = e.touches.length === 1 && !(e.target as Element).closest?.(NO_SWIPE) ? { x: t.clientX, y: t.clientY, t: performance.now() } : null;
      }}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        const t = e.changedTouches[0];
        if (!s || !t || performance.now() - s.t > 700) return;
        const dx = t.clientX - s.x, dy = t.clientY - s.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) go(dx < 0 ? 1 : -1);
      }}
    >
      <div class="panel-inner">{children}</div>
      {up && <button class="to-top" aria-label="Наверх" onClick={() => ref.current?.scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>}
    </div>
  );
}
