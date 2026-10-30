// Шапка вкладки: живая сцена на фоне, крупный значок и главные показатели — что важно прямо сейчас.
import type { ComponentChildren } from 'preact';
import { ACHIEVEMENTS } from '../game/achievements';
import { enemiesOf, peekPair } from '../game/actions';
import { TECHS } from '../game/defs';
import { STATS } from '../game/economy';
import { fmt, fmtDays } from '../game/format';
import { foodDays } from '../game/market';
import { getGame } from '../game/state';
import type { GameState } from '../game/types';
import { REGION_OF } from '../game/world';
import { setUI } from './store';

export type HeroKind = 'policy' | 'build' | 'army' | 'market' | 'stats';

interface Stat { ic: string; v: string; l: string; tone?: 'good' | 'bad' | 'warn'; go?: () => void }

const d = (s: number) => ({ animationDelay: `${s}s` });

/** Сцены справа в шапке (SVG 200×90), анимации — классы .hs-* в style.css. */
const SCENES: Record<HeroKind, () => ComponentChildren> = {
  policy: () => (
    <>
      <g class="hs-spin slow" style={{ transformOrigin: '150px 45px' }}>
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i * Math.PI) / 8;
          return <line key={i} x1={150 + Math.cos(a) * 18} y1={45 + Math.sin(a) * 18} x2={150 + Math.cos(a) * 60} y2={45 + Math.sin(a) * 60} stroke="#f2d78b" stroke-width="2" opacity="0.18" />;
        })}
      </g>
      <g class="hs-float">
        <rect x="110" y="26" width="80" height="44" rx="3" fill="#f3e2b8" />
        <rect x="104" y="22" width="10" height="52" rx="5" fill="#c99a3d" />
        <rect x="186" y="22" width="10" height="52" rx="5" fill="#c99a3d" />
        {[0, 1, 2, 3].map((i) => <line key={i} class="hs-write" style={d(i * 0.6)} x1="122" y1={36 + i * 9} x2={176 - (i % 2) * 14} y2={36 + i * 9} stroke="#7a5418" stroke-width="2" stroke-linecap="round" />)}
        <circle cx="168" cy="62" r="6" fill="#c92a2a" />
      </g>
      <g class="hs-quill"><path d="M70 64 Q86 30 104 18 Q96 40 74 66 Z" fill="#fff" opacity="0.85" /><line x1="70" y1="66" x2="64" y2="74" stroke="#f2d78b" stroke-width="2" /></g>
    </>
  ),
  build: () => (
    <>
      <rect x="150" y="10" width="5" height="80" fill="#f2b84b" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => <path key={i} d={`M150 ${14 + i * 11} l5 6 M155 ${14 + i * 11} l-5 6`} stroke="#b88a33" stroke-width="1" />)}
      <rect x="90" y="8" width="100" height="5" fill="#f2b84b" />
      <rect x="182" y="13" width="10" height="10" fill="#495057" />
      <g class="hs-swing" style={{ transformOrigin: '110px 13px' }}>
        <line x1="110" y1="13" x2="110" y2="46" stroke="#ced4da" stroke-width="1" />
        <rect x="100" y="46" width="20" height="12" fill="#e8590c" />
      </g>
      {[[20, 30, 0], [44, 46, 0.5], [68, 24, 1]].map(([x, h, dl], i) => (
        <g key={i} class="hs-rise" style={{ ...d(dl as number), transformOrigin: `${(x as number) + 9}px 90px` }}>
          <rect x={x as number} y={90 - (h as number)} width="18" height={h as number} fill="#3b5b8c" />
          {Array.from({ length: Math.floor((h as number) / 10) }, (_, k) => <rect key={k} x={(x as number) + 4} y={93 - (h as number) + k * 10} width="4" height="4" fill="#ffe066" class="hs-blink" style={d(k * 0.4 + i)} />)}
        </g>
      ))}
      {[0, 1, 2].map((i) => <circle key={i} class="hs-spark" style={d(i * 0.5)} cx="110" cy="60" r="1.6" fill="#ffd43b" />)}
    </>
  ),
  army: () => (
    <>
      <circle cx="150" cy="46" r="36" fill="none" stroke="#5fd38a" stroke-opacity="0.25" />
      <circle cx="150" cy="46" r="22" fill="none" stroke="#5fd38a" stroke-opacity="0.25" />
      <line x1="114" y1="46" x2="186" y2="46" stroke="#5fd38a" stroke-opacity="0.2" />
      <line x1="150" y1="10" x2="150" y2="82" stroke="#5fd38a" stroke-opacity="0.2" />
      <g class="hs-spin" style={{ transformOrigin: '150px 46px' }}>
        <path d="M150 46 L150 10 A36 36 0 0 1 182 30 Z" fill="#5fd38a" opacity="0.3" />
      </g>
      {[[166, 28], [134, 60], [172, 58]].map(([x, y], i) => <circle key={i} class="hs-blink" style={d(i * 0.7)} cx={x} cy={y} r="2.4" fill={i === 1 ? '#ff7a7a' : '#5fd38a'} />)}
      <g class="hs-fly">
        <g transform="translate(40 40)">
          <path d="M-12 3 Q-2 -4 7 1 Q13 -1 16 -4 Q15 3 8 5 Q-2 9 -12 3 Z" fill="#fff" />
          <path class="hs-wing" d="M-3 1 Q1 -16 11 -14 Q5 -6 4 1 Z" fill="#e7f5ff" />
          <path d="M16 -3 q7 1 9 6" stroke="#5fd38a" stroke-width="1.4" fill="none" />
        </g>
      </g>
      <g transform="translate(70 70)" class="hs-wave-flag">
        <line x1="0" y1="18" x2="0" y2="-14" stroke="#ced4da" stroke-width="1.6" />
        <path d="M0 -14 q8 -4 16 0 v10 q-8 -4 -16 0 Z" fill="#d8b45c" />
      </g>
    </>
  ),
  market: () => (
    <>
      {[[100, 30, 22], [118, 20, 34], [136, 36, 18], [154, 14, 44], [172, 24, 30]].map(([x, y, h], i) => (
        <g key={i} class="hs-candle" style={{ ...d(i * 0.3), transformOrigin: `${(x as number) + 5}px ${(y as number) + (h as number) / 2}px` }}>
          <line x1={(x as number) + 5} y1={(y as number) - 6} x2={(x as number) + 5} y2={(y as number) + (h as number) + 6} stroke={i % 2 ? '#ff7a7a' : '#5fd38a'} stroke-width="1.2" />
          <rect x={x as number} y={y as number} width="10" height={h as number} rx="1" fill={i % 2 ? '#ff7a7a' : '#5fd38a'} opacity="0.8" />
        </g>
      ))}
      <path class="hs-draw" d="M90 70 L110 60 L128 66 L146 44 L164 52 L190 28" stroke="#f2d78b" stroke-width="2" fill="none" stroke-linecap="round" />
      {[[30, 0], [52, 0.8], [74, 1.6], [42, 2.3]].map(([x, dl], i) => (
        <g key={i} class="hs-coin" style={d(dl)}>
          <circle cx={x} cy="0" r="7" fill="#f2cf6b" stroke="#b88a33" stroke-width="1.5" />
          <text x={x} y="3.5" text-anchor="middle" font-size="9" font-weight="700" fill="#7a5418">$</text>
        </g>
      ))}
    </>
  ),
  stats: () => (
    <>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} class="hs-bar" style={{ ...d(i * 0.15), transformOrigin: `${92 + i * 17}px 84px` }} x={86 + i * 17} y={84 - (18 + i * 10)} width="12" height={18 + i * 10} rx="2" fill={i === 5 ? '#f2d78b' : '#7cc7ff'} opacity={0.5 + i * 0.08} />
      ))}
      <path class="hs-draw" d="M86 70 C110 64 120 50 140 46 S170 26 192 14" stroke="#5fd38a" stroke-width="2" fill="none" />
      <g class="hs-pop" style={d(1.2)}>
        <path d="M192 4 l3 7 l7 1 l-5 5 l1 7 l-6 -3 l-6 3 l1 -7 l-5 -5 l7 -1 Z" fill="#f2d78b" />
      </g>
      {[[30, 30], [56, 60], [44, 14]].map(([x, y], i) => <circle key={i} class="hs-blink" style={d(i * 0.6)} cx={x} cy={y} r="1.6" fill="#f2d78b" />)}
    </>
  ),
};

const TITLE: Record<HeroKind, [string, string]> = {
  policy: ['📜', 'Политика'],
  build: ['🏗️', 'Стройка'],
  army: ['⚔️', 'Армия и дипломатия'],
  market: ['🏪', 'Рынок'],
  stats: ['📊', 'Статистика'],
};

function stats(g: GameState, kind: HeroKind): { sub: string; list: Stat[] } {
  const me = g.player;
  const c = g.countries[me];
  const s = STATS[me];
  const others = g.countries.filter((o) => o.alive && o.idx !== me).map((o) => o.idx);
  switch (kind) {
    case 'policy':
      return {
        sub: 'Налоги, бюджет, народ, вызовы и наука',
        list: [
          { ic: '⚖️', v: `${Math.round(c.stability)}%`, l: 'стабильность', tone: c.stability >= 60 ? 'good' : c.stability < 35 ? 'bad' : 'warn', go: () => setUI({ modal: { kind: 'details', res: 'stab' } }) },
          { ic: '🏛️', v: `${Math.round(c.tax * 100)}%`, l: 'налог', tone: c.tax > 0.3 ? 'bad' : undefined },
          { ic: '🔬', v: `${c.techs.length}/${TECHS.length}`, l: 'технологий' },
        ],
      };
    case 'build': {
      const mine = Object.keys(g.buildings).filter((t) => g.regions[REGION_OF[+t]].owner === me).length;
      const wonders = Object.values(g.wonders).filter((w) => g.regions[w.region].owner === me).length;
      const free = s.slots - s.constructing;
      return {
        sub: free > 0 ? `Свободных мест для стройки: ${free}` : 'Все стройплощадки заняты',
        list: [
          { ic: '🔨', v: `${s.constructing}/${s.slots}`, l: 'строится', tone: free > 0 ? 'good' : undefined },
          { ic: '🏢', v: String(mine), l: 'зданий' },
          { ic: '🏛️', v: String(wonders), l: 'чудес света', tone: wonders ? 'good' : undefined },
        ],
      };
    }
    case 'army': {
      const wars = enemiesOf(g, me).length;
      const friends = others.filter((i) => { const p = peekPair(g, me, i); return p.alliance || p.pact || p.trade; }).length;
      return {
        sub: wars ? `Идёт война: противников ${wars}` : 'Мирное время',
        list: [
          { ic: '💪', v: fmt(s.power), l: 'военная мощь' },
          { ic: wars ? '🔥' : '🕊️', v: String(wars), l: 'войн', tone: wars ? 'bad' : 'good' },
          { ic: '🤝', v: String(friends), l: 'договоров', tone: friends ? 'good' : undefined },
        ],
      };
    }
    case 'market': {
      const days = foodDays(g, me);
      return {
        sub: s.hunger > 0 ? '⚠️ В стране голод — купите еду' : s.resShort > 0.005 ? `⚠️ Не хватает сырья: производство −${Math.round(s.resShort * 100)}%` : 'Еда, оружие, сырьё, биржа, учёные и компании',
        list: [
          { ic: '🌾', v: days > 999 ? '999+' : `${Math.floor(days)} дн.`, l: 'запас еды', tone: s.hunger > 0 ? 'bad' : days < 30 ? 'warn' : 'good', go: () => setUI({ marketTab: 'food' }) },
          { ic: '🔫', v: `${Math.round(s.equip * 100)}%`, l: 'оснащение', tone: s.equip < 0.95 ? 'warn' : undefined, go: () => setUI({ marketTab: 'arms' }) },
          { ic: '🧑‍🔬', v: fmt(c.scientists), l: 'учёных', go: () => setUI({ marketTab: 'sci' }) },
        ],
      };
    }
    case 'stats': {
      const place = others.filter((i) => STATS[i].power > s.power).length + 1;
      return {
        sub: `У власти ${fmtDays(g.day)}`,
        list: [
          { ic: place <= 3 ? '🥇' : '🏆', v: `№${place}`, l: 'по мощи', tone: place <= 3 ? 'good' : undefined },
          { ic: '🏅', v: `${g.achievements.length}/${ACHIEVEMENTS.length}`, l: 'достижений' },
          { ic: '🗺️', v: String(s.regions.length), l: 'регионов' },
        ],
      };
    }
  }
}

/** Шапка вкладки вместо простого заголовка. */
export function PanelHero({ kind }: { kind: HeroKind }) {
  const g = getGame()!;
  const [icon, title] = TITLE[kind];
  const { sub, list } = stats(g, kind);
  return (
    <div class={`phero ph-${kind}`}>
      <svg class="ph-scene" viewBox="0 0 200 90" preserveAspectRatio="xMaxYMid meet" aria-hidden="true">{SCENES[kind]()}</svg>
      <div class="ph-main">
        <span class="ph-ic">{icon}</span>
        <div class="ph-txt">
          <h2>{title}</h2>
          <div class="ph-sub">{sub}</div>
        </div>
      </div>
      <div class="ph-stats">
        {list.map((st, i) => (
          <button key={st.l} class={`ph-stat ${st.tone ?? ''} ${st.go ? 'tap' : ''}`} style={d(0.1 + i * 0.06)} onClick={st.go} disabled={!st.go}>
            <span class="ps-ic">{st.ic}</span>
            <b key={st.v}>{st.v}</b>
            <span class="ps-l">{st.l}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
