// Картинки для писем: маленькие живые сцены на SVG (анимации — в style.css, классы .a-*).
// Каждая сцена 320×150; id градиентов с префиксом сцены, чтобы не путались между собой.
import type { ComponentChildren } from 'preact';
import { Icon } from './icons';

const d = (s: number) => ({ animationDelay: `${s}s` });

function Cloud({ x, y, s = 1, delay = 0, o = 0.9, color = '#fff' }: { x: number; y: number; s?: number; delay?: number; o?: number; color?: string }) {
  return (
    <g class="a-drift" style={d(delay)}>
      <g transform={`translate(${x} ${y}) scale(${s})`} opacity={o} fill={color}>
        <ellipse cx="0" cy="6" rx="26" ry="9" />
        <circle cx="-10" cy="0" r="10" />
        <circle cx="6" cy="-4" r="13" />
        <circle cx="18" cy="3" r="8" />
      </g>
    </g>
  );
}

function Sun({ x, y, r = 16, color = '#ffd43b' }: { x: number; y: number; r?: number; color?: string }) {
  return (
    <g>
      <g class="a-spin slow">
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return <line key={i} x1={x + Math.cos(a) * (r + 4)} y1={y + Math.sin(a) * (r + 4)} x2={x + Math.cos(a) * (r + 11)} y2={y + Math.sin(a) * (r + 11)} stroke={color} stroke-width="3" stroke-linecap="round" opacity="0.8" />;
        })}
      </g>
      <circle cx={x} cy={y} r={r} fill={color} />
      <circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.35} fill="#fff" opacity="0.35" />
    </g>
  );
}

function Bird({ x, y, delay = 0, s = 1, color = '#343a40' }: { x: number; y: number; delay?: number; s?: number; color?: string }) {
  return (
    <g class="a-fly" style={d(delay)}>
      <path class="a-flap" d={`M${x - 6 * s} ${y} q${3 * s} ${-4 * s} ${6 * s} 0 q${3 * s} ${-4 * s} ${6 * s} 0`} fill="none" stroke={color} stroke-width="1.8" stroke-linecap="round" />
    </g>
  );
}

/** Волны, бегущие по кругу (период 40 — сцена 320 делится без шва). */
function Waves({ y, color, amp = 5, speed = '' }: { y: number; color: string; amp?: number; speed?: string }) {
  let p = `M0 ${y}`;
  for (let x = 0; x < 640; x += 40) p += ` q10 ${-amp} 20 0 t20 0`;
  return <path class={`a-wave ${speed}`} d={`${p} L640 150 L0 150 Z`} fill={color} />;
}

function Stars({ n = 18, h = 80, seed = 1 }: { n?: number; h?: number; seed?: number }) {
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const x = ((i * 73 + seed * 31) % 310) + 5, y = ((i * 41 + seed * 17) % h) + 4;
        return <circle key={i} class="a-twinkle" style={d((i * 0.37) % 2.4)} cx={x} cy={y} r={i % 4 === 0 ? 1.6 : 1} fill="#fff" />;
      })}
    </g>
  );
}

function Fish({ y, color, delay = 0, dur = 9, s = 1, rev = false }: { y: number; color: string; delay?: number; dur?: number; s?: number; rev?: boolean }) {
  return (
    <g class={rev ? 'a-swimr' : 'a-swim'} style={{ animationDelay: `${delay}s`, animationDuration: `${dur}s` }}>
      <g transform={`translate(0 ${y}) scale(${rev ? -s : s} ${s})`}>
        <g class="a-wiggle">
          <path d="M-12 0 L-20 -6 L-18 0 L-20 6 Z" fill={color} />
          <ellipse cx="0" cy="0" rx="13" ry="6" fill={color} />
          <ellipse cx="2" cy="2" rx="8" ry="2.4" fill="#fff" opacity="0.4" />
          <circle cx="7" cy="-1.5" r="1.6" fill="#212529" />
        </g>
      </g>
    </g>
  );
}

function Smoke({ x, y, n = 3, color = '#ced4da', delay = 0 }: { x: number; y: number; n?: number; color?: string; delay?: number }) {
  return (
    <g>
      {Array.from({ length: n }, (_, i) => (
        <circle key={i} class="a-smoke" style={d(delay + i * 1.1)} cx={x} cy={y} r={6 + i} fill={color} />
      ))}
    </g>
  );
}

function Flag({ x, y, color, h = 22 }: { x: number; y: number; color: string; h?: number }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - h} stroke="#495057" stroke-width="1.6" />
      <path class="a-flag" d={`M${x} ${y - h} q8 -4 16 0 v9 q-8 -4 -16 0 Z`} fill={color} />
    </g>
  );
}

const Ground = ({ y, color, children }: { y: number; color: string; children?: ComponentChildren }) => (
  <g>
    <path d={`M0 ${y} Q80 ${y - 10} 160 ${y} T320 ${y} V150 H0 Z`} fill={color} />
    {children}
  </g>
);

function Sky({ id, top, bottom }: { id: string; top: string; bottom: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={top} />
          <stop offset="1" stop-color={bottom} />
        </linearGradient>
      </defs>
      <rect width="320" height="150" fill={`url(#${id}-sky)`} />
    </>
  );
}

// ---------- сцены ----------
const SCENES: Record<string, (hint?: string) => ComponentChildren> = {
  palace: () => (
    <>
      <Sky id="pa" top="#ffc078" bottom="#fff4e6" />
      <Sun x={250} y={42} r={18} />
      <Cloud x={70} y={34} s={0.9} />
      <Cloud x={190} y={22} s={0.6} delay={-8} />
      <Ground y={128} color="#8ce99a" />
      <g>
        <rect x="104" y="72" width="112" height="56" fill="#f8f0e3" stroke="#d6b88a" />
        <rect x="88" y="62" width="22" height="66" fill="#f1e3cc" stroke="#d6b88a" />
        <rect x="210" y="62" width="22" height="66" fill="#f1e3cc" stroke="#d6b88a" />
        <path d="M88 62 L99 44 L110 62 Z M210 62 L221 44 L232 62 Z" fill="#c92a2a" />
        <path d="M128 72 Q160 28 192 72 Z" fill="#fcc419" stroke="#e67700" />
        <circle cx="160" cy="40" r="3" fill="#e67700" />
        {[116, 136, 176, 196].map((x) => <rect key={x} x={x} y="84" width="9" height="14" rx="4" fill="#4dabf7" class="a-blink soft" style={d(x / 50)} />)}
        <path d="M150 128 v-20 a10 10 0 0 1 20 0 v20 Z" fill="#a0522d" />
        {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={108 + i * 24} y="66" width="8" height="6" fill="#f1e3cc" stroke="#d6b88a" />)}
      </g>
      <Flag x={99} y={44} color="#1c7ed6" h={16} />
      <Flag x={221} y={44} color="#1c7ed6" h={16} />
      <Flag x={160} y={37} color="#f03e3e" h={18} />
      <Bird x={40} y={60} delay={-2} />
      <Bird x={60} y={52} delay={-5} s={0.8} />
    </>
  ),
  factory: () => (
    <>
      <Sky id="fa" top="#a5d8ff" bottom="#e7f5ff" />
      <Cloud x={60} y={30} />
      <Ground y={130} color="#adb5bd" />
      <rect x="196" y="40" width="16" height="64" fill="#868e96" />
      <rect x="226" y="52" width="14" height="52" fill="#868e96" />
      <rect x="196" y="40" width="16" height="6" fill="#f03e3e" />
      <rect x="226" y="52" width="14" height="5" fill="#f03e3e" />
      <Smoke x={204} y={36} n={4} />
      <Smoke x={233} y={48} n={4} delay={0.6} />
      <path d="M80 130 V86 L110 70 V86 L140 70 V86 L170 70 V86 L200 70 V104 H260 V130 Z" fill="#495057" />
      {[90, 120, 150, 180, 212, 236].map((x, i) => <rect key={x} x={x} y="100" width="12" height="10" fill="#ffe066" class="a-blink" style={d(i * 0.4)} />)}
      <g transform="translate(46 104)">
        <g class="a-spin">
          <circle r="14" fill="none" stroke="#f59f00" stroke-width="6" stroke-dasharray="5 4" />
          <circle r="8" fill="#f59f00" />
          <circle r="3" fill="#495057" />
        </g>
      </g>
      <g transform="translate(286 116)">
        <g class="a-spin rev">
          <circle r="9" fill="none" stroke="#fab005" stroke-width="4" stroke-dasharray="4 3" />
          <circle r="5" fill="#fab005" />
        </g>
      </g>
    </>
  ),
  school: () => (
    <>
      <Sky id="sc" top="#74c0fc" bottom="#e7f5ff" />
      <Sun x={44} y={36} r={14} />
      <Cloud x={250} y={30} s={0.8} />
      <Ground y={128} color="#69db7c" />
      <rect x="100" y="66" width="120" height="62" fill="#ffc9c9" stroke="#e03131" stroke-opacity="0.4" />
      <path d="M92 68 L160 36 L228 68 Z" fill="#c92a2a" />
      <circle cx="160" cy="56" r="8" fill="#fff" stroke="#495057" />
      <g transform="translate(160 56)">
        <g class="a-orbit"><line x1="0" y1="0" x2="0" y2="-6" stroke="#212529" stroke-width="1.5" /></g>
        <line x1="0" y1="0" x2="4" y2="0" stroke="#212529" stroke-width="1.5" />
      </g>
      {[110, 134, 178, 202].map((x) => <rect key={x} x={x} y="78" width="14" height="14" fill="#a5d8ff" stroke="#fff" stroke-width="2" />)}
      <rect x="150" y="100" width="20" height="28" fill="#862e9c" />
      <Flag x={228} y={68} color="#fcc419" h={18} />
      <g class="a-plane"><path d="M0 0 l14 4 l-14 4 l3 -4 Z" fill="#fff" stroke="#adb5bd" transform="translate(30 80)" /></g>
      {[60, 72, 254, 266].map((x, i) => (
        <g key={x} class="a-hop" style={d(i * 0.3)}>
          <circle cx={x} cy="116" r="4" fill="#ffd8a8" />
          <rect x={x - 4} y="120" width="8" height="10" rx="3" fill={['#f06595', '#4dabf7', '#51cf66', '#fcc419'][i]} />
        </g>
      ))}
    </>
  ),
  front: () => (
    <>
      <Sky id="fr" top="#e8590c" bottom="#ffd8a8" />
      <circle cx="250" cy="70" r="22" fill="#ffec99" opacity="0.8" />
      <g class="a-blink flash" style={d(0.3)}><circle cx="70" cy="96" r="10" fill="#fff3bf" opacity="0.8" /></g>
      <g class="a-blink flash" style={d(1.6)}><circle cx="290" cy="92" r="8" fill="#fff3bf" opacity="0.8" /></g>
      <Smoke x={70} y={92} n={3} color="#868e96" />
      <Smoke x={290} y={88} n={3} color="#868e96" delay={0.9} />
      <path d="M0 108 Q70 96 140 106 T320 102 V150 H0 Z" fill="#5c6b3a" />
      <path d="M0 124 Q90 116 180 124 T320 122 V150 H0 Z" fill="#3f4a28" />
      <path d="M110 108 L132 84 L154 108 Z" fill="#94a36b" stroke="#5c6b3a" />
      <path d="M180 112 L198 92 L216 112 Z" fill="#a9b77a" stroke="#5c6b3a" />
      <Flag x={240} y={110} color="#c92a2a" h={30} />
      {[30, 60, 90].map((x) => <path key={x} d={`M${x} 126 l8 -6 l8 6`} stroke="#212529" stroke-width="2" fill="none" />)}
    </>
  ),
  dove: () => (
    <>
      <Sky id="do" top="#4dabf7" bottom="#e7f5ff" />
      {['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa'].map((c, i) => (
        <path key={c} d={`M20 150 A140 120 0 0 1 300 150`} fill="none" stroke={c} stroke-width="6" opacity="0.55" transform={`translate(${i * 6} ${i * 7}) scale(${1 - i * 0.04})`} />
      ))}
      <Cloud x={50} y={120} s={1.2} />
      <Cloud x={270} y={124} s={1.1} delay={-6} />
      {[0, 1].map((i) => (
        <g key={i} class="a-float" style={d(i * 1.2)}>
          <g transform={`translate(${130 + i * 70} ${50 + i * 14}) scale(${1 - i * 0.25})`}>
            <path d="M-18 4 Q-4 -6 10 2 Q20 -2 24 -6 Q22 4 12 8 Q-4 14 -18 4 Z" fill="#fff" stroke="#ced4da" />
            <path class="a-wing" d="M-4 2 Q2 -24 16 -22 Q8 -10 6 2 Z" fill="#f8f9fa" stroke="#ced4da" />
            <circle cx="18" cy="-3" r="1.4" fill="#212529" />
            <path d="M23 -5 l5 1 l-5 2 Z" fill="#fab005" />
            {i === 0 && <path d="M26 -3 q10 2 14 10 M32 0 q4 -4 8 -2 M36 4 q4 -2 7 1" stroke="#2b8a3e" stroke-width="1.6" fill="none" />}
          </g>
        </g>
      ))}
      {[[60, 40], [270, 30], [100, 92]].map(([x, y], i) => <path key={i} class="a-heart" style={d(i * 0.8)} d={`M${x} ${y} c-4 -5 -10 0 0 7 c10 -7 4 -12 0 -7 Z`} fill="#ff8787" />)}
    </>
  ),
  harbor: () => (
    <>
      <Sky id="ha" top="#74c0fc" bottom="#d0ebff" />
      <Sun x={60} y={38} r={14} />
      <Cloud x={200} y={30} s={0.8} />
      <Bird x={140} y={40} />
      <Bird x={160} y={34} delay={-3} s={0.8} />
      <rect x="250" y="56" width="5" height="54" fill="#f76707" />
      <path d="M252 58 H300 M296 58 V72" stroke="#f76707" stroke-width="4" fill="none" />
      <rect x="292" y="72" width="10" height="8" fill="#495057" class="a-float" />
      <rect x="230" y="96" width="90" height="16" fill="#868e96" />
      {[236, 252, 268, 284].map((x, i) => <rect key={x} x={x} y="84" width="14" height="12" fill={['#e03131', '#1c7ed6', '#f59f00', '#2f9e44'][i]} />)}
      <Waves y={112} color="#339af0" />
      {[[70, 104, '#c92a2a'], [160, 108, '#1971c2']].map(([x, y, c], i) => (
        <g key={i} class="a-bob" style={d(i * 0.7)}>
          <g transform={`translate(${x} ${y})`}>
            <path d="M-26 0 H26 L20 10 H-20 Z" fill="#7a4a26" />
            <line x1="0" y1="0" x2="0" y2="-34" stroke="#5a3a1c" stroke-width="2" />
            <path d="M2 -2 V-32 L22 -2 Z" fill="#fff" />
            <path d="M-2 -2 V-26 L-18 -2 Z" fill="#f1ecdc" />
            <path d="M0 -34 l10 3 l-10 3 Z" fill={c as string} />
          </g>
        </g>
      ))}
      <Waves y={126} color="#1c7ed6" speed="fast" />
    </>
  ),
  sea: () => (
    <>
      <Sky id="se" top="#99e9f2" bottom="#e3fafc" />
      <Sun x={270} y={26} r={13} />
      <Cloud x={70} y={22} s={0.7} />
      <g class="a-bob">
        <g transform="translate(110 54)">
          <path d="M-22 0 H22 L16 9 H-16 Z" fill="#a0522d" />
          <line x1="0" y1="0" x2="0" y2="-26" stroke="#5a3a1c" stroke-width="2" />
          <path d="M2 -2 V-24 L18 -2 Z" fill="#fff" />
          <path d="M14 0 q10 -14 22 -8" stroke="#495057" stroke-width="1" fill="none" />
        </g>
      </g>
      <defs>
        <linearGradient id="se-deep" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3bc9db" />
          <stop offset="1" stop-color="#0b7285" />
        </linearGradient>
      </defs>
      <rect x="0" y="62" width="320" height="88" fill="url(#se-deep)" />
      <Waves y={64} color="#66d9e8" amp={4} />
      <rect x="0" y="66" width="320" height="84" fill="url(#se-deep)" opacity="0.9" />
      {[20, 60, 240, 290].map((x, i) => (
        <path key={x} class="a-sway" style={d(i * 0.5)} d={`M${x} 150 q-6 -14 0 -26 q6 -12 0 -24`} stroke="#2b8a3e" stroke-width="4" fill="none" stroke-linecap="round" />
      ))}
      <Fish y={92} color="#ffa94d" dur={10} />
      <Fish y={100} color="#ffa94d" dur={10} delay={-0.6} s={0.8} />
      <Fish y={86} color="#ffa94d" dur={10} delay={-1.1} s={0.7} />
      <Fish y={118} color="#ffd43b" dur={13} delay={-5} rev />
      <Fish y={126} color="#ff8787" dur={11} delay={-3} s={0.9} rev />
      <Fish y={134} color="#63e6be" dur={8} delay={-2} s={0.7} />
      {[50, 150, 220].map((x, i) => <circle key={x} class="a-bubble" style={d(i * 1.3)} cx={x} cy="140" r="2.5" fill="none" stroke="#e3fafc" />)}
      <g class="a-jump"><path d="M-14 0 Q0 -8 14 0 Q4 4 -14 0 Z M-4 -5 l4 -6 l3 6 Z M-14 0 l-6 -5 v10 Z" fill="#4f7593" transform="translate(220 66)" /></g>
    </>
  ),
  lighthouse: () => (
    <>
      <Sky id="li" top="#1b2a4a" bottom="#3b5bdb" />
      <Stars n={22} h={70} seed={3} />
      <circle cx="60" cy="30" r="12" fill="#fff3bf" />
      <circle cx="65" cy="27" r="11" fill="#1b2a4a" />
      <g transform="translate(244 50) scale(1 0.4)">
        <g class="a-orbit">
          <path d="M0 0 L120 -30 L120 30 Z" fill="#fff3bf" opacity="0.35" />
          <path d="M0 0 L-120 -30 L-120 30 Z" fill="#fff3bf" opacity="0.2" />
        </g>
      </g>
      <path d="M220 150 L226 116 L262 116 L268 150 Z" fill="#495057" />
      <path d="M234 116 L238 56 L250 56 L254 116 Z" fill="#fff" />
      <path d="M236 92 h16 v8 h-16 Z M237 72 h14 v8 h-14 Z" fill="#e03131" />
      <rect x="236" y="44" width="16" height="12" fill="#ffd43b" class="a-blink soft" />
      <path d="M234 44 L244 34 L254 44 Z" fill="#e03131" />
      <Waves y={118} color="#1864ab" amp={4} />
      <g class="a-float slow">
        <ellipse cx="110" cy="124" rx="30" ry="7" fill="#0b1a33" />
        <path d="M80 124 l-10 -8 l2 8 l-2 8 Z" fill="#0b1a33" />
      </g>
      {[0, 1, 2, 3, 4].map((i) => <circle key={i} class="a-spout" style={d(i * 0.12)} cx={126 + (i - 2) * 2} cy="116" r="2" fill="#d0ebff" />)}
      <Waves y={132} color="#1c3d7a" speed="fast" />
    </>
  ),
  village: () => (
    <>
      <Sky id="vi" top="#91a7ff" bottom="#fff9db" />
      <Sun x={60} y={40} r={15} />
      <Cloud x={200} y={30} s={0.8} />
      <Cloud x={290} y={44} s={0.5} delay={-10} />
      <path d="M0 100 Q160 80 320 100 V150 H0 Z" fill="#94d82d" />
      {[0, 1, 2, 3].map((i) => <path key={i} d={`M0 ${108 + i * 11} Q160 ${92 + i * 11} 320 ${108 + i * 11}`} stroke={i % 2 ? '#fab005' : '#82c91e'} stroke-width="6" fill="none" />)}
      <g transform="translate(236 66)">
        <path d="M-8 44 L-5 0 H5 L8 44 Z" fill="#e9ecef" stroke="#adb5bd" />
        <g class="a-spin">
          {[0, 90, 180, 270].map((a) => <rect key={a} x="-2" y="-30" width="4" height="30" fill="#a0522d" transform={`rotate(${a})`} />)}
          {[0, 90, 180, 270].map((a) => <rect key={`s${a}`} x="2" y="-28" width="8" height="22" fill="#fff" opacity="0.85" transform={`rotate(${a})`} />)}
        </g>
        <circle r="3" fill="#495057" />
      </g>
      <rect x="100" y="78" width="44" height="30" fill="#ffe8cc" stroke="#d9480f" stroke-opacity="0.4" />
      <path d="M94 80 L122 58 L150 80 Z" fill="#d9480f" />
      <rect x="134" y="58" width="7" height="14" fill="#868e96" />
      <Smoke x={137} y={54} n={3} />
      <rect x="108" y="86" width="10" height="9" fill="#ffd43b" />
      <rect x="126" y="90" width="10" height="18" fill="#a0522d" />
      <circle cx="40" cy="82" r="14" fill="#2f9e44" />
      <rect x="38" y="90" width="4" height="16" fill="#795548" />
      <Bird x={170} y={50} delay={-1} />
    </>
  ),
  storm: () => (
    <>
      <Sky id="st" top="#495057" bottom="#adb5bd" />
      <g class="a-lightning"><path d="M200 30 L188 62 L200 62 L186 96 L214 54 L202 54 L212 30 Z" fill="#ffe066" /></g>
      <Cloud x={90} y={26} s={1.4} o={1} color="#343a40" />
      <Cloud x={220} y={22} s={1.3} delay={-7} o={1} color="#343a40" />
      {Array.from({ length: 24 }, (_, i) => (
        <line key={i} class="a-rain" style={d((i * 0.13) % 1)} x1={(i * 37) % 320} y1="40" x2={((i * 37) % 320) - 4} y2="50" stroke="#a5d8ff" stroke-width="1.5" stroke-linecap="round" />
      ))}
      <path d="M0 126 Q160 118 320 126 V150 H0 Z" fill="#5c6b7a" />
      {[80, 220].map((x, i) => <ellipse key={x} class="a-ripple" style={d(i * 0.6)} cx={x} cy="134" rx="10" ry="3" fill="none" stroke="#d0ebff" />)}
      <g transform="translate(150 106)">
        <path d="M0 0 v24" stroke="#212529" stroke-width="1.6" />
        <path d="M-18 2 Q0 -14 18 2 Z" fill="#e03131" />
      </g>
    </>
  ),
  fireworks: () => (
    <>
      <Sky id="fw" top="#0b1a33" bottom="#364fc7" />
      <Stars n={14} h={60} seed={5} />
      {[[70, 44, '#ff6b6b', 0], [160, 30, '#ffd43b', 0.7], [250, 46, '#69db7c', 1.4], [116, 64, '#74c0fc', 2.1], [214, 22, '#f783ac', 1]].map(([x, y, c, dl], i) => (
        <g key={i} class="a-burst" style={{ ...d(dl as number), transformOrigin: `${x}px ${y}px` }}>
          {Array.from({ length: 12 }, (_, k) => {
            const a = (k * Math.PI) / 6;
            return <line key={k} x1={(x as number) + Math.cos(a) * 6} y1={(y as number) + Math.sin(a) * 6} x2={(x as number) + Math.cos(a) * 20} y2={(y as number) + Math.sin(a) * 20} stroke={c as string} stroke-width="2.4" stroke-linecap="round" />;
          })}
          <circle cx={x as number} cy={y as number} r="3" fill="#fff" />
        </g>
      ))}
      <path d="M0 150 V104 h20 v-14 h18 v22 h14 v-34 h22 v30 h16 v-18 h20 v26 h12 v-44 h24 v40 h18 v-22 h16 v30 h20 v-16 h18 v-28 h22 v40 h16 v-12 h22 V150 Z" fill="#141c2e" />
      {Array.from({ length: 16 }, (_, i) => <rect key={i} class="a-blink soft" style={d((i * 0.31) % 3)} x={(i * 19 + 8) % 310} y={112 + ((i * 7) % 26)} width="3" height="4" fill="#ffe066" />)}
    </>
  ),
  space: () => (
    <>
      <rect width="320" height="150" fill="#0b0f24" />
      <Stars n={34} h={140} seed={7} />
      <defs>
        <radialGradient id="sp-earth" cx="0.5" cy="0.2" r="0.7">
          <stop offset="0" stop-color="#4dabf7" />
          <stop offset="1" stop-color="#1864ab" />
        </radialGradient>
      </defs>
      <ellipse cx="160" cy="230" rx="230" ry="110" fill="#74c0fc" opacity="0.25" />
      <ellipse cx="160" cy="232" rx="220" ry="104" fill="url(#sp-earth)" />
      <path d="M40 150 q30 -26 70 -20 q20 -18 50 -10 q16 -10 40 4 q30 -8 60 26 Z" fill="#40c057" opacity="0.8" />
      <g class="a-comet"><path d="M0 0 L-40 -10 L-40 -4 Z" fill="#fff" opacity="0.6" /><circle r="3" fill="#fff" /></g>
      <g transform="translate(160 150) scale(1 0.45)">
        <g class="a-orbit slow">
          <g transform="translate(150 0)">
            <rect x="-4" y="-6" width="8" height="12" fill="#ced4da" />
            <rect x="-16" y="-4" width="10" height="8" fill="#4c6ef5" />
            <rect x="6" y="-4" width="10" height="8" fill="#4c6ef5" />
          </g>
        </g>
      </g>
      <g class="a-rocket">
        <g transform="translate(70 70) rotate(40)">
          <path d="M0 -18 Q8 -8 6 10 H-6 Q-8 -8 0 -18 Z" fill="#f8f9fa" />
          <circle cy="-4" r="3" fill="#4dabf7" />
          <path d="M-6 6 l-6 8 h6 Z M6 6 l6 8 h-6 Z" fill="#e03131" />
          <path class="a-flame down" d="M-4 10 Q0 24 4 10 Z" fill="#ffa94d" />
        </g>
      </g>
    </>
  ),
  lab: () => (
    <>
      <rect width="320" height="150" fill="#e7f5ff" />
      {Array.from({ length: 9 }, (_, i) => <line key={i} x1={i * 40} y1="0" x2={i * 40} y2="150" stroke="#a5d8ff" stroke-width="0.6" />)}
      {Array.from({ length: 5 }, (_, i) => <line key={i} x1="0" y1={i * 40} x2="320" y2={i * 40} stroke="#a5d8ff" stroke-width="0.6" />)}
      <rect x="0" y="116" width="320" height="34" fill="#868e96" />
      <rect x="0" y="112" width="320" height="6" fill="#adb5bd" />
      <g transform="translate(80 112)">
        <path d="M-6 -50 h12 v18 l18 32 h-48 l18 -32 Z" fill="#fff" stroke="#495057" stroke-width="1.5" />
        <path d="M-17 -14 l-7 14 h48 l-7 -14 Z" fill="#51cf66" />
        {[0, 1, 2].map((i) => <circle key={i} class="a-bubble" style={d(i * 0.7)} cx={-6 + i * 6} cy="-6" r="2" fill="#d3f9d8" />)}
      </g>
      <g transform="translate(140 112)">
        <rect x="-8" y="-40" width="16" height="40" rx="8" fill="#fff" stroke="#495057" stroke-width="1.5" />
        <rect x="-6" y="-22" width="12" height="20" rx="6" fill="#f06595" />
        {[0, 1].map((i) => <circle key={i} class="a-bubble" style={d(0.4 + i * 0.9)} cx={-2 + i * 4} cy="-8" r="1.8" fill="#ffdeeb" />)}
      </g>
      <g transform="translate(240 60)">
        <circle r="6" fill="#7950f2" />
        {[0, 60, 120].map((a, i) => (
          <g key={a} transform={`rotate(${a})`}>
            <ellipse rx="34" ry="11" fill="none" stroke="#7950f2" stroke-width="1.4" opacity="0.7" />
            <g transform="scale(1 0.33)">
              <g class="a-orbit fast" style={d(-i * 0.8)}><circle cx="34" cy="0" r="4" fill="#f59f00" /></g>
            </g>
          </g>
        ))}
      </g>
      <text x="170" y="40" font-size="14" fill="#1971c2" font-family="Georgia, serif" class="a-float">E = mc²</text>
    </>
  ),
  city: () => (
    <>
      <Sky id="ci" top="#f783ac" bottom="#ffd8a8" />
      <circle cx="160" cy="104" r="34" fill="#ffd43b" opacity="0.9" />
      <Bird x={60} y={40} />
      <Bird x={78} y={34} delay={-4} s={0.8} />
      <path d="M0 150 V96 h24 v-20 h20 v30 h18 v-44 h24 v44 h14 v-26 h22 v40 h20 v-18 h18 v-34 h26 v52 h16 v-22 h22 v28 h18 v-40 h20 v40 h18 V150 Z" fill="#862e9c" opacity="0.55" />
      <path d="M0 150 V118 h30 v-12 h26 v18 h34 v-26 h20 v30 h40 v-14 h28 v20 h30 v-30 h22 v26 h36 v-10 h24 V150 Z" fill="#5f3dc4" opacity="0.8" />
      {Array.from({ length: 14 }, (_, i) => <rect key={i} class="a-blink soft" style={d((i * 0.43) % 3)} x={(i * 23 + 6) % 310} y={124 + ((i * 5) % 18)} width="3" height="4" fill="#ffec99" />)}
      <g class="a-float slow">
        <ellipse cx="260" cy="42" rx="13" ry="16" fill="#ff6b6b" />
        <path d="M249 50 L271 50 L265 62 H255 Z" fill="#e03131" opacity="0.6" />
        <rect x="255" y="62" width="10" height="7" fill="#a0522d" />
      </g>
    </>
  ),
  winter: () => (
    <>
      <Sky id="wi" top="#1b2a4a" bottom="#4c6ef5" />
      <Stars n={16} h={60} seed={9} />
      <circle cx="260" cy="30" r="13" fill="#fff9db" />
      <g class="a-sleigh">
        <g transform="translate(0 40)">
          <path d="M0 0 h18 q4 0 6 -6 M2 4 h22" stroke="#ffd43b" stroke-width="2" fill="none" />
          <rect x="2" y="-8" width="16" height="8" rx="2" fill="#e03131" />
          <path d="M28 -4 l8 -4 l2 4 l-2 6 Z M40 -6 l8 -4 l2 4 l-2 6 Z" fill="#a0522d" />
        </g>
      </g>
      <path d="M0 110 Q80 96 160 110 T320 106 V150 H0 Z" fill="#f8f9fa" />
      {[30, 62, 270, 298].map((x, i) => (
        <g key={x} transform={`translate(${x} ${118 - (i % 2) * 6})`}>
          <path d="M0 -40 L14 -12 H6 L18 6 H-18 L-6 -12 H-14 Z" fill="#2b8a3e" />
          <path d="M0 -40 L8 -24 H-8 Z" fill="#fff" opacity="0.8" />
          <rect x="-3" y="6" width="6" height="8" fill="#795548" />
        </g>
      ))}
      <rect x="130" y="84" width="58" height="34" fill="#a0522d" />
      <path d="M124 86 L159 62 L194 86 Z" fill="#f8f9fa" />
      <rect x="142" y="94" width="12" height="11" fill="#ffd43b" class="a-blink soft" />
      <rect x="164" y="94" width="12" height="11" fill="#ffd43b" class="a-blink soft" style={d(1.3)} />
      {Array.from({ length: 26 }, (_, i) => <circle key={i} class="a-snow" style={{ animationDelay: `${(i * 0.47) % 6}s`, animationDuration: `${5 + (i % 4)}s` }} cx={(i * 47) % 320} cy="-4" r={1 + (i % 3) * 0.6} fill="#fff" />)}
    </>
  ),
  kid: () => (
    <>
      <defs>
        <filter id="kid-wobble"><feTurbulence baseFrequency="0.04" numOctaves="2" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="3" /></filter>
      </defs>
      <rect width="320" height="150" fill="#fff" />
      <g filter="url(#kid-wobble)" stroke-linecap="round" stroke-linejoin="round">
        <g class="a-spin slow">
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i * Math.PI) / 5;
            return <line key={i} x1={262 + Math.cos(a) * 22} y1={36 + Math.sin(a) * 22} x2={262 + Math.cos(a) * 32} y2={36 + Math.sin(a) * 32} stroke="#fab005" stroke-width="4" />;
          })}
        </g>
        <circle cx="262" cy="36" r="17" fill="#ffe066" stroke="#fab005" stroke-width="3" />
        <circle cx="256" cy="32" r="2" fill="#212529" />
        <circle cx="268" cy="32" r="2" fill="#212529" />
        <path d="M255 41 q7 7 14 0" stroke="#212529" stroke-width="2.4" fill="none" />
        <path d="M20 40 q14 -14 28 0 q14 -12 26 2" stroke="#74c0fc" stroke-width="4" fill="none" />
        <rect x="70" y="72" width="62" height="50" fill="none" stroke="#e03131" stroke-width="4" />
        <path d="M62 74 L101 40 L140 74 Z" fill="none" stroke="#f76707" stroke-width="4" />
        <rect x="80" y="84" width="16" height="14" fill="#74c0fc" stroke="#1c7ed6" stroke-width="3" />
        <rect x="106" y="94" width="14" height="28" fill="#cc5de8" stroke="#862e9c" stroke-width="3" />
        <path d="M0 126 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8 l10 -8 l10 8" stroke="#40c057" stroke-width="4" fill="none" />
        {[[170, '#f06595'], [200, '#4dabf7'], [228, '#fcc419']].map(([x, c], i) => (
          <g key={i} class="a-hop" style={d(i * 0.4)}>
            <circle cx={x as number} cy={i === 2 ? 98 : 78} r={i === 2 ? 6 : 8} fill="none" stroke={c as string} stroke-width="3" />
            <path d={`M${x} ${i === 2 ? 104 : 86} v${i === 2 ? 12 : 20} M${(x as number) - 10} ${i === 2 ? 108 : 94} h20 M${x} ${i === 2 ? 116 : 106} l-7 ${i === 2 ? 8 : 12} M${x} ${i === 2 ? 116 : 106} l7 ${i === 2 ? 8 : 12}`} stroke={c as string} stroke-width="3" fill="none" />
          </g>
        ))}
        <path class="a-heart" d="M200 50 c-6 -8 -16 0 0 11 c16 -11 6 -19 0 -11 Z" fill="#ff8787" stroke="#e03131" stroke-width="2" />
      </g>
    </>
  ),
  kitchen: () => (
    <>
      <rect width="320" height="150" fill="#fff4e6" />
      <rect x="200" y="16" width="80" height="60" fill="#a5d8ff" stroke="#d9480f" stroke-width="4" />
      <path d="M240 16 v60 M200 46 h80" stroke="#d9480f" stroke-width="3" />
      <Cloud x={232} y={36} s={0.45} />
      <rect x="0" y="96" width="320" height="54" fill="#fff" />
      {Array.from({ length: 16 }, (_, i) => <rect key={i} x={i * 20} y={96 + (i % 2) * 14} width="10" height="14" fill="#ff8787" opacity="0.7" />)}
      {Array.from({ length: 16 }, (_, i) => <rect key={`b${i}`} x={i * 20 + 10} y={110 - (i % 2) * 14} width="10" height="14" fill="#ff8787" opacity="0.7" />)}
      <ellipse cx="120" cy="100" rx="58" ry="12" fill="#e9ecef" />
      <path d="M68 96 Q120 60 172 96 Z" fill="#f59f00" />
      <path d="M70 96 Q120 76 170 96" stroke="#d9480f" stroke-width="3" fill="none" />
      {[96, 120, 144].map((x) => <path key={x} d={`M${x - 6} 84 l12 0`} stroke="#ffe8cc" stroke-width="3" stroke-linecap="round" />)}
      {[100, 120, 140].map((x, i) => <path key={x} class="a-steam" style={d(i * 0.6)} d={`M${x} 70 q-6 -8 0 -16 q6 -8 0 -16`} stroke="#adb5bd" stroke-width="2.4" fill="none" stroke-linecap="round" />)}
      <g transform="translate(240 92)">
        <path d="M-18 0 Q-20 -24 0 -26 Q20 -24 18 0 Z" fill="#4dabf7" />
        <path d="M18 -16 q12 -2 10 10" stroke="#4dabf7" stroke-width="4" fill="none" />
        <path d="M-18 -14 l-12 -6" stroke="#4dabf7" stroke-width="4" />
        <circle cy="-28" r="3" fill="#1971c2" />
        <path class="a-steam" d="M-30 -24 q-4 -6 0 -12" stroke="#adb5bd" stroke-width="2" fill="none" />
      </g>
    </>
  ),
  balloon: () => (
    <>
      <Sky id="ba" top="#74c0fc" bottom="#fff9db" />
      <Cloud x={50} y={40} />
      <Cloud x={260} y={70} s={0.8} delay={-9} />
      <path d="M0 126 Q160 108 320 126 V150 H0 Z" fill="#94d82d" />
      {[0, 1, 2].map((i) => <path key={i} d={`M${i * 110} 150 L${i * 110 + 60} 118 L${i * 110 + 110} 150`} fill={['#fab005', '#82c91e', '#ffd43b'][i]} opacity="0.6" />)}
      <g class="a-float slow">
        <g transform="translate(170 56)">
          <path d="M0 -40 C30 -40 34 -6 12 14 L-12 14 C-34 -6 -30 -40 0 -40 Z" fill="#ff922b" />
          <path d="M0 -40 C12 -40 14 -6 5 14 L-5 14 C-14 -6 -12 -40 0 -40 Z" fill="#ffe066" />
          <path d="M-12 14 L-7 30 M12 14 L7 30" stroke="#5a3a1c" stroke-width="1.4" />
          <rect x="-9" y="30" width="18" height="12" rx="2" fill="#a0522d" />
          <circle cx="0" cy="26" r="4" fill="#ffd8a8" />
          <path class="a-flame" d="M-3 20 Q0 10 3 20 Z" fill="#ff6b6b" />
        </g>
      </g>
      <Bird x={90} y={66} delay={-2} />
    </>
  ),
  night: () => (
    <>
      <Sky id="ni" top="#0b1a33" bottom="#3b5bdb" />
      <Stars n={30} h={90} seed={11} />
      <g class="a-shoot"><path d="M0 0 L-30 -8" stroke="#fff" stroke-width="1.6" stroke-linecap="round" /><circle r="1.8" fill="#fff" /></g>
      <circle cx="250" cy="40" r="20" fill="#fff9db" />
      <circle cx="258" cy="34" r="18" fill="#152447" />
      <path d="M0 150 V112 h18 v-16 h14 v20 h22 v-32 h12 v-10 h4 v10 h12 v42 h20 v-24 h26 v30 h14 v-40 h24 v36 h20 v-18 h18 v24 h22 v-34 h16 v30 h22 v-12 h20 V150 Z" fill="#0d1526" />
      {Array.from({ length: 14 }, (_, i) => <rect key={i} class="a-blink soft" style={d((i * 0.53) % 3)} x={(i * 21 + 10) % 300} y={118 + ((i * 7) % 22)} width="3" height="4" fill="#ffe066" />)}
      <g transform="translate(60 72)">
        <ellipse rx="11" ry="13" fill="#5c3d2e" />
        <circle cx="-4" cy="-4" r="4" fill="#fff" /><circle cx="4" cy="-4" r="4" fill="#fff" />
        <circle cx="-4" cy="-4" r="2" fill="#212529" class="a-blink eyes" /><circle cx="4" cy="-4" r="2" fill="#212529" class="a-blink eyes" />
        <path d="M-2 1 l2 3 l2 -3 Z" fill="#fab005" />
        <path d="M-9 -12 l3 5 M9 -12 l-3 5" stroke="#5c3d2e" stroke-width="3" />
      </g>
    </>
  ),
  treasure: () => (
    <>
      <rect width="320" height="150" fill="#f3d9a4" />
      <rect width="320" height="150" fill="none" stroke="#c08a4a" stroke-width="10" opacity="0.4" />
      {[0, 1, 2].map((i) => <path key={i} d={`M${10 + i * 100} ${30 + i * 40} q20 -6 40 0 t40 0`} stroke="#74c0fc" stroke-width="1.6" fill="none" opacity="0.7" />)}
      <path d="M150 40 C210 26 260 50 250 86 C246 118 196 128 160 118 C120 112 100 90 112 66 C118 52 132 44 150 40 Z" fill="#d8b46a" stroke="#8b5a2b" stroke-width="2" />
      <path d="M180 60 l-4 -18 M176 42 q-8 -4 -14 2 M176 42 q6 -8 14 -4 M176 42 q-2 -8 4 -12" stroke="#2f9e44" stroke-width="2.4" fill="none" />
      <path d="M176 60 v6" stroke="#795548" stroke-width="3" />
      <path class="a-dash" d="M40 120 Q80 90 120 104 T200 92 L218 92" stroke="#c92a2a" stroke-width="2.4" stroke-dasharray="6 6" fill="none" />
      <g class="a-pulse"><path d="M212 84 l12 12 M224 84 l-12 12" stroke="#c92a2a" stroke-width="4" stroke-linecap="round" /></g>
      <g transform="translate(60 44)">
        <circle r="20" fill="#fff4e6" stroke="#8b5a2b" stroke-width="2" />
        <g class="a-spin slow">
          <path d="M0 -17 L4 0 L0 17 L-4 0 Z" fill="#c92a2a" />
          <path d="M-17 0 L0 4 L17 0 L0 -4 Z" fill="#495057" />
        </g>
        <text y="-22" text-anchor="middle" font-size="9" fill="#8b5a2b" font-family="Georgia, serif">N</text>
      </g>
      <g class="a-bob" style={d(0.4)}>
        <path d="M270 120 q8 -10 16 0 q8 -10 16 0" stroke="#2b8a3e" stroke-width="4" fill="none" stroke-linecap="round" />
      </g>
    </>
  ),
  zoo: (hint) => (hint && hint !== '🐼') ? (
    <>
      <Sky id="zo" top="#b2f2bb" bottom="#ebfbee" />
      <Sun x={40} y={30} r={12} />
      <Cloud x={250} y={30} s={0.7} />
      <path d="M0 120 Q160 108 320 120 V150 H0 Z" fill="#8ce99a" />
      {[[40, 96], [276, 92]].map(([x, y], i) => (
        <g key={i} class="a-sway" style={d(i * 0.7)}>
          <rect x={x - 3} y={y} width="6" height="30" fill="#795548" />
          <circle cx={x} cy={y - 8} r="18" fill="#40c057" />
        </g>
      ))}
      <ellipse cx="160" cy="128" rx="40" ry="6" fill="#2b8a3e" opacity="0.3" />
      <g class="a-hop slow"><Icon e={hint} x={160} y={98} size={58} /></g>
      {[[110, 70], [210, 60], [130, 46]].map(([x, y], i) => <path key={i} class="a-heart" style={d(i * 0.9)} d={`M${x} ${y} c-4 -5 -10 0 0 7 c10 -7 4 -12 0 -7 Z`} fill="#ff8787" />)}
    </>
  ) : (
    <>
      <Sky id="zo" top="#b2f2bb" bottom="#ebfbee" />
      <Sun x={40} y={30} r={12} />
      {[250, 266, 282, 298].map((x, i) => (
        <g key={x} class="a-sway" style={d(i * 0.3)}>
          <rect x={x} y={20 + i * 6} width="6" height="130" fill="#82c91e" />
          {[40, 70, 100].map((y) => <rect key={y} x={x - 1} y={y + i * 6} width="8" height="3" fill="#5c940d" />)}
          <path d={`M${x + 6} ${46 + i * 6} q14 -4 18 6`} stroke="#51cf66" stroke-width="3" fill="none" />
        </g>
      ))}
      <path d="M0 120 Q160 108 320 120 V150 H0 Z" fill="#8ce99a" />
      <g class="a-hop slow">
        <g transform="translate(150 96)">
          <ellipse cx="0" cy="18" rx="24" ry="18" fill="#fff" stroke="#212529" stroke-width="1.4" />
          <ellipse cx="-16" cy="30" rx="8" ry="6" fill="#212529" />
          <ellipse cx="16" cy="30" rx="8" ry="6" fill="#212529" />
          <circle cx="0" cy="-8" r="20" fill="#fff" stroke="#212529" stroke-width="1.4" />
          <circle cx="-16" cy="-24" r="7" fill="#212529" />
          <circle cx="16" cy="-24" r="7" fill="#212529" />
          <ellipse cx="-8" cy="-8" rx="6" ry="7" fill="#212529" transform="rotate(-20 -8 -8)" />
          <ellipse cx="8" cy="-8" rx="6" ry="7" fill="#212529" transform="rotate(20 8 -8)" />
          <circle cx="-7" cy="-8" r="2" fill="#fff" class="a-blink eyes" />
          <circle cx="7" cy="-8" r="2" fill="#fff" class="a-blink eyes" />
          <ellipse cx="0" cy="2" rx="3" ry="2" fill="#212529" />
          <path d="M-3 6 q3 3 6 0" stroke="#212529" stroke-width="1.2" fill="none" />
          <circle cx="-13" cy="0" r="3" fill="#ffc9c9" /><circle cx="13" cy="0" r="3" fill="#ffc9c9" />
        </g>
      </g>
      {[[110, 70], [196, 64], [130, 50]].map(([x, y], i) => <path key={i} class="a-heart" style={d(i * 0.9)} d={`M${x} ${y} c-4 -5 -10 0 0 7 c10 -7 4 -12 0 -7 Z`} fill="#ff8787" />)}
    </>
  ),
  stadium: () => (
    <>
      <Sky id="sd" top="#1c7ed6" bottom="#a5d8ff" />
      <path d="M0 40 Q160 10 320 40 V90 H0 Z" fill="#495057" />
      {Array.from({ length: 60 }, (_, i) => <circle key={i} class="a-blink crowd" style={d((i * 0.17) % 1.5)} cx={(i * 37) % 320} cy={44 + ((i * 13) % 40)} r="2.4" fill={['#ff6b6b', '#ffd43b', '#fff', '#74c0fc', '#69db7c'][i % 5]} />)}
      <rect x="0" y="90" width="320" height="60" fill="#2f9e44" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={i} x={i * 40} y="90" width="20" height="60" fill="#37b24d" />)}
      <circle cx="160" cy="120" r="18" fill="none" stroke="#fff" stroke-width="2" />
      <line x1="160" y1="90" x2="160" y2="150" stroke="#fff" stroke-width="2" />
      <g class="a-ball"><g transform="translate(110 120)"><circle r="7" fill="#fff" stroke="#212529" /><path d="M-3 -3 l3 -2 l3 2 l-1 3 h-4 Z" fill="#212529" /></g></g>
      <g transform="translate(250 104)" class="a-float">
        <path d="M-12 -24 h24 v8 q0 14 -12 16 q-12 -2 -12 -16 Z" fill="#fcc419" stroke="#e67700" />
        <path d="M-12 -18 q-8 0 -6 8 q2 4 8 4 M12 -18 q8 0 6 8 q-2 4 -8 4" stroke="#e67700" stroke-width="2" fill="none" />
        <rect x="-3" y="0" width="6" height="8" fill="#e67700" />
        <rect x="-9" y="8" width="18" height="5" fill="#a0522d" />
      </g>
      {Array.from({ length: 18 }, (_, i) => <rect key={i} class="a-confetti" style={{ animationDelay: `${(i * 0.29) % 3}s`, animationDuration: `${2.6 + (i % 3) * 0.5}s` }} x={(i * 53) % 320} y="-6" width="4" height="6" fill={['#ff6b6b', '#ffd43b', '#fff', '#74c0fc', '#69db7c'][i % 5]} />)}
    </>
  ),
  monument: () => (
    <>
      <Sky id="mo" top="#e8590c" bottom="#ffe8cc" />
      <circle cx="160" cy="112" r="40" fill="#ffd43b" opacity="0.5" />
      <Bird x={60} y={40} />
      <Bird x={250} y={50} delay={-6} />
      <path d="M0 122 Q160 112 320 122 V150 H0 Z" fill="#868e96" />
      <path d="M152 116 L156 26 L164 26 L168 116 Z" fill="#e9ecef" stroke="#adb5bd" />
      <path d="M156 26 L160 14 L164 26 Z" fill="#fcc419" />
      <rect x="130" y="112" width="60" height="12" fill="#ced4da" />
      <g class="a-flame">
        <path d="M152 112 Q160 88 168 112 Z" fill="#ff922b" />
        <path d="M156 112 Q160 98 164 112 Z" fill="#ffe066" />
      </g>
      {[124, 136, 184, 196].map((x, i) => (
        <g key={x}>
          <line x1={x} y1="124" x2={x + (i < 2 ? 4 : -4)} y2="108" stroke="#2b8a3e" stroke-width="1.6" />
          <circle cx={x + (i < 2 ? 4 : -4)} cy="106" r="4" fill={i % 2 ? '#e03131' : '#f03e3e'} />
        </g>
      ))}
    </>
  ),
  // тайная ложа: зал с шахматным полом, колонны, алтарь со свечами и всевидящее око
  lodge: () => (
    <>
      <Sky id="lo" top="#07060c" bottom="#21190d" />
      <Stars n={14} h={56} seed={13} />
      <defs>
        <pattern id="lo-check" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="#e9dfc8" />
          <rect width="8" height="8" fill="#15120c" />
          <rect x="8" y="8" width="8" height="8" fill="#15120c" />
        </pattern>
        <radialGradient id="lo-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#f2d78b" stop-opacity="0.55" />
          <stop offset="1" stop-color="#f2d78b" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="160" cy="50" r="62" fill="url(#lo-glow)" class="a-blink soft" />
      <g class="a-spin slow">
        {Array.from({ length: 18 }, (_, i) => {
          const a = (i * Math.PI) / 9;
          return <line key={i} x1={160 + Math.cos(a) * 26} y1={50 + Math.sin(a) * 26} x2={160 + Math.cos(a) * 72} y2={50 + Math.sin(a) * 72} stroke="#f2d78b" stroke-width="2" opacity="0.2" />;
        })}
      </g>
      <path d="M20 150 L84 110 L236 110 L300 150 Z" fill="url(#lo-check)" />
      <path d="M84 110 L236 110" stroke="#c99a3d" stroke-width="2" />
      {[64, 256].map((x, i) => (
        <g key={x}>
          <rect x={x - 9} y="44" width="18" height="76" fill="#d9c9a3" />
          <rect x={x - 13} y="38" width="26" height="8" rx="2" fill="#c99a3d" />
          <rect x={x - 13} y="118" width="26" height="8" rx="2" fill="#c99a3d" />
          <circle cx={x} cy="30" r="9" fill="#c99a3d" />
          <text x={x} y="88" text-anchor="middle" font-size="13" font-weight="700" fill="#7a5418" font-family="Georgia, serif">{i ? 'J' : 'B'}</text>
        </g>
      ))}
      <rect x="134" y="104" width="52" height="16" rx="2" fill="#3b2a12" stroke="#c99a3d" />
      <path d="M146 104 l14 -6 l14 6 Z" fill="#f3e2b8" />
      {[140, 160, 180].map((x, i) => (
        <g key={x}>
          <rect x={x - 2.5} y={86 - (i === 1 ? 6 : 0)} width="5" height={18 + (i === 1 ? 6 : 0)} fill="#f8f0e3" />
          <path class="a-flame" style={d(i * 0.13)} d={`M${x} ${78 - (i === 1 ? 6 : 0)} q4 5 0 9 q-4 -4 0 -9 Z`} fill="#ffc94d" />
        </g>
      ))}
      <path d="M160 18 L188 66 L132 66 Z" fill="#14100a" stroke="#f2d78b" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M146 52 Q160 38 174 52 Q160 64 146 52 Z" fill="#fff6dc" />
      <circle cx="160" cy="52" r="5.5" fill="#5b3d12" />
      <circle cx="160" cy="52" r="2.4" fill="#0b0805" />
    </>
  ),
  cat: () => (
    <>
      <Sky id="ca" top="#1b2a4a" bottom="#5f3dc4" />
      <Stars n={14} h={70} seed={13} />
      <circle cx="230" cy="44" r="22" fill="#fff9db" />
      <rect x="0" y="112" width="320" height="38" fill="#a0522d" />
      <rect x="0" y="108" width="320" height="6" fill="#d9480f" />
      <g transform="translate(150 108)">
        <path class="a-tail" d="M18 -4 q26 -2 22 -30 q-2 -8 -8 -6" stroke="#212529" stroke-width="6" fill="none" stroke-linecap="round" />
        <ellipse cx="0" cy="-18" rx="20" ry="18" fill="#212529" />
        <circle cx="0" cy="-44" r="14" fill="#212529" />
        <path d="M-12 -52 l2 -14 l8 8 Z M12 -52 l-2 -14 l-8 8 Z" fill="#212529" />
        <ellipse cx="-5" cy="-46" rx="3" ry="4" fill="#ffe066" class="a-blink eyes" />
        <ellipse cx="5" cy="-46" rx="3" ry="4" fill="#ffe066" class="a-blink eyes" />
        <path d="M-14 -40 h-10 M-14 -38 l-9 3 M14 -40 h10 M14 -38 l9 3" stroke="#adb5bd" stroke-width="0.8" />
      </g>
      <g class="a-roll"><g transform="translate(70 104)"><circle r="8" fill="#f06595" /><path d="M-6 -4 q6 4 12 0 M-7 2 q7 4 14 0" stroke="#c2255c" stroke-width="1.2" fill="none" /></g></g>
      {[[40, 130], [56, 140], [250, 132], [268, 142]].map(([x, y], i) => (
        <g key={i} fill="#ffd8a8" opacity="0.6">
          <ellipse cx={x} cy={y} rx="4" ry="3" />
          <circle cx={x - 4} cy={y - 4} r="1.4" /><circle cx={x} cy={y - 5} r="1.4" /><circle cx={x + 4} cy={y - 4} r="1.4" />
        </g>
      ))}
    </>
  ),
};

/** Картинка письма; неизвестная сцена — дворец. hint — эмодзи с марки (какого зверя рисовать в зоопарке). */
export function LetterArt({ kind, hint }: { kind: string; hint?: string }) {
  const scene = SCENES[kind] ?? SCENES.palace;
  return (
    <svg class="art" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {scene(hint)}
    </svg>
  );
}
