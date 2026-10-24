import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fmt, fmtRate } from '../game/format';
import { COUNTRY_DEFS } from '../game/world';
import { ui } from './store';

// какие сворачиваемые карточки открыты — запоминаем между запусками
const FOLD_KEY = 'derzhava-fold';
const folds: Record<string, boolean> = (() => {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}');
  } catch {
    return {};
  }
})();

/**
 * Карточка. hint — пояснение, спрятанное под кнопку «?».
 * fold — ключ сворачиваемой карточки (по умолчанию закрыта, open — открыта).
 */
export function Card({ title, sub, hint, fold, open, children }: {
  title?: ComponentChildren; sub?: ComponentChildren; hint?: ComponentChildren; fold?: string; open?: boolean; children: ComponentChildren;
}) {
  const [showHint, setShowHint] = useState(false);
  const [, force] = useState(0);
  const isOpen = fold ? (folds[fold] ?? !!open) : true;
  const toggle = () => {
    folds[fold!] = !isOpen;
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(folds));
    } catch { /* без хранилища просто не запомним */ }
    force((x) => x + 1);
  };
  return (
    <div class={`card ${isOpen ? '' : 'closed'}`}>
      {title && (
        <h3 class={fold ? 'tap' : ''} onClick={fold ? toggle : undefined}>
          <span class="h-title">{title}</span>
          <span class="h-right">
            {sub !== undefined && <span class="sub">{sub}</span>}
            {hint && isOpen && (
              <button class={`hint-btn ${showHint ? 'on' : ''}`} aria-label="Подсказка" onClick={(e) => { e.stopPropagation(); setShowHint(!showHint); }}>?</button>
            )}
            {fold && <span class={`chev ${isOpen ? 'on' : ''}`}>▾</span>}
          </span>
        </h3>
      )}
      {isOpen && showHint && <div class="hint">{hint}</div>}
      {isOpen && children}
    </div>
  );
}

/** Скрытые подробности: показываются по кнопке «Подробнее». */
export function More({ children, label = 'Подробнее' }: { children: ComponentChildren; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && <div class="more-body">{children}</div>}
      <button class="more-btn" onClick={() => setOpen(!open)}>{open ? 'Скрыть ▴' : `${label} ▾`}</button>
    </>
  );
}

export function Seg<T extends string | number>({ options, value, onChange }: { options: { v: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div class="seg">
      {options.map((o) => (
        <button key={String(o.v)} class={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ options, value, onChange }: { options: { v: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div class="tabs">
      {options.map((o) => (
        <button key={o.v} class={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Bar({ value, color }: { value: number; color?: 'green' | 'red' }) {
  return (
    <div class={`bar ${color ?? ''}`}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export const Rate = ({ v, suffix = '/сек' }: { v: number; suffix?: string }) => (
  <span class={`num ${v >= 0 ? 'up' : 'down'}`}>{suffix === '/сек' ? fmtRate(v) : `${v >= 0 ? '+' : ''}${fmt(v)}${suffix}`}</span>
);

export const Flag = ({ id }: { id: number }) => <span class="flagdot" style={{ background: id >= 0 ? COUNTRY_DEFS[id].color : '#8a8f99' }} />;

export function RelBar({ v }: { v: number }) {
  const w = Math.abs(v) / 2;
  const color = relColor(v);
  return (
    <span class="relbar">
      <i style={{ left: v >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: color }} />
    </span>
  );
}

export const relColor = (v: number) => (v >= 50 ? '#5fd38a' : v >= 0 ? '#d8b45c' : v > -50 ? '#ff9b5a' : '#ff5a5a');

export const relText = (v: number) =>
  v >= 60 ? 'Дружба' : v >= 25 ? 'Тёплые' : v >= -10 ? 'Нейтральные' : v >= -50 ? 'Прохладные' : 'Враждебные';

export function KV({ rows }: { rows: [ComponentChildren, ComponentChildren][] }) {
  return (
    <div class="kv">
      {rows.map(([k, v], i) => [
        <span key={`k${i}`} class="muted">{k}</span>,
        <span key={`v${i}`} class="v">{v}</span>,
      ])}
    </div>
  );
}

/** Число, которое плавно растёт между тиками: base + rate × доля секунды. */
export function LiveNum({ base, rate }: { base: number; rate: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const v = useRef({ base, rate });
  v.current = { base, rate };
  useEffect(() => {
    let id = 0;
    const loop = () => {
      id = requestAnimationFrame(loop);
      const f = ui.paused ? 0 : ui.frac;
      if (ref.current) ref.current.textContent = fmt(v.current.base + v.current.rate * f);
    };
    loop();
    return () => cancelAnimationFrame(id);
  }, []);
  return <span ref={ref}>{fmt(base)}</span>;
}

/** Плавный счёт от from до to (для праздничных окон). */
export function CountUp({ from, to, format = fmt, ms = 1400, delay = 350 }: { from: number; to: number; format?: (v: number) => string; ms?: number; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let id = 0;
    const t0 = performance.now() + delay;
    const step = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - t0) / ms));
      const e = 1 - Math.pow(1 - k, 3);
      if (ref.current) ref.current.textContent = format(from + (to - from) * e);
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [from, to]);
  return <span ref={ref}>{format(from)}</span>;
}
