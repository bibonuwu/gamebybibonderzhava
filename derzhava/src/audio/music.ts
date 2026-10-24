// Фоновая музыка: генеративный оркестровый эмбиент в ре миноре (без файлов, всё синтезируется).
// Три настроения: меню, мир, война. Смена настроения — на границе такта.
import { connectOut, ctx, mtof, musicBus, noiseBuffer, onAudioReady, settings } from './engine';

export type Mood = 'menu' | 'peace' | 'war';

interface Chord {
  root: number; // MIDI, третья октава
  minor: boolean;
}
const chord = (root: number, minor: boolean): Chord => ({ root, minor });
const Dm = chord(50, true), Bb = chord(46, false), F = chord(53, false), C = chord(48, false);
const Gm = chord(55, true), A = chord(57, false), Am = chord(57, true);

const PROGS: Record<Mood, Chord[][]> = {
  menu: [[Dm, Bb, F, C], [Dm, Gm, Bb, A], [Bb, F, C, Dm]],
  peace: [[Dm, Bb, F, C], [F, C, Dm, Bb], [Bb, F, C, Dm], [Dm, F, Gm, Bb], [Dm, Am, Bb, C]],
  war: [[Dm, Bb, C, A], [Dm, C, Bb, A], [Dm, Dm, Bb, C], [Gm, Dm, A, Dm]],
};
const TEMPO: Record<Mood, number> = { menu: 62, peace: 70, war: 96 };

// ре минор: ступени от D4 (MIDI 62)
const SCALE = [0, 2, 3, 5, 7, 8, 10];
function degToMidi(deg: number, ch: Chord) {
  let m = 62 + Math.floor(deg / 7) * 12 + SCALE[((deg % 7) + 7) % 7];
  if (ch.root % 12 === 9 && !ch.minor && m % 12 === 0) m += 1; // на ля мажоре — до-диез
  return m;
}
const rootDeg = (ch: Chord) => SCALE.indexOf((((ch.root % 12) - 2) % 12 + 12) % 12);
const chordDegs = (ch: Chord) => [0, 2, 4].map((k) => rootDeg(ch) + k);
/** Ближайшая к deg ступень аккорда. */
function nearestChordDeg(deg: number, ch: Chord) {
  let best = deg, bd = Infinity;
  for (const base of chordDegs(ch)) {
    for (const oct of [-7, 0, 7, 14]) {
      const d = base + oct;
      if (Math.abs(d - deg) < bd) { bd = Math.abs(d - deg); best = d; }
    }
  }
  return best;
}
/** Аккорд в тесном расположении от lo вверх. */
function voicing(ch: Chord, lo: number) {
  return [0, ch.minor ? 3 : 4, 7].map((x) => {
    const pc = (ch.root + x) % 12;
    return lo + ((pc - (lo % 12) + 12) % 12);
  }).sort((a, b) => a - b);
}
const rnd = Math.random;
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

// ---------- инструменты ----------
const out = (node: AudioNode, wet: number) => connectOut(node, musicBus, wet);

function osc(type: OscillatorType, freq: number, t: number, end: number, dest: AudioNode, detune = 0) {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.connect(dest);
  o.start(t);
  o.stop(end);
  return o;
}
function lowpass(freq: number, q = 0.7) {
  const f = ctx!.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Струнный пэд: пары расстроенных пил через мягкий фильтр, медленная атака. */
function pad(notes: number[], t: number, dur: number, bright: number) {
  const c = ctx!;
  const f = lowpass(bright * 0.6, 0.6);
  f.frequency.setValueAtTime(bright * 0.6, t);
  f.frequency.linearRampToValueAtTime(bright, t + dur * 0.5);
  f.frequency.linearRampToValueAtTime(bright * 0.75, t + dur);
  const g = c.createGain();
  const a = Math.min(1.2, dur * 0.3), r = 1.4, vol = 0.032;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.setValueAtTime(vol, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + r);
  f.connect(g);
  out(g, 0.55);
  for (const n of notes) for (const det of [-7, 7]) osc('sawtooth', mtof(n), t, t + dur + r + 0.05, f, det);
}

function bass(midi: number, t: number, dur: number, vol = 0.15) {
  const c = ctx!;
  const f = lowpass(520);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(vol * 0.4, t + dur * 0.85);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.12);
  f.connect(g);
  out(g, 0.12);
  osc('triangle', mtof(midi), t, t + dur + 0.2, f);
  osc('sine', mtof(midi), t, t + dur + 0.2, f);
}

/** Арфа: щипок с быстрым затуханием. */
function harp(midi: number, t: number, vol = 0.045) {
  const c = ctx!;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
  out(g, 0.45);
  osc('triangle', mtof(midi), t, t + 1.8, g);
  const h = c.createGain();
  h.gain.value = 0.3;
  h.connect(g);
  osc('sine', mtof(midi) * 2, t, t + 1.8, h);
}

/** Флейта/валторна мирной темы — синус с вибрато. */
function flute(midi: number, t: number, dur: number, vol = 0.06) {
  const c = ctx!;
  const f = lowpass(3000);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.09);
  g.gain.linearRampToValueAtTime(vol * 0.8, t + dur * 0.8);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
  f.connect(g);
  out(g, 0.5);
  const freq = mtof(midi);
  const o1 = osc('sine', freq, t, t + dur + 0.35, f);
  const tri = c.createGain();
  tri.gain.value = 0.3;
  tri.connect(f);
  const o2 = osc('triangle', freq, t, t + dur + 0.35, tri);
  const lfo = c.createOscillator();
  lfo.frequency.value = 5.2;
  const depth = c.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(freq * 0.006, t + Math.min(0.4, dur));
  lfo.connect(depth);
  depth.connect(o1.frequency);
  depth.connect(o2.frequency);
  lfo.start(t);
  lfo.stop(t + dur + 0.35);
}

/** Медь военной темы: пилы с «раскрывающимся» фильтром. */
function brass(midi: number, t: number, dur: number, vol = 0.045) {
  const c = ctx!;
  const f = lowpass(500, 1.4);
  f.frequency.setValueAtTime(500, t);
  f.frequency.linearRampToValueAtTime(2400, t + 0.08);
  f.frequency.linearRampToValueAtTime(1300, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.06);
  g.gain.linearRampToValueAtTime(vol * 0.8, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.2);
  f.connect(g);
  out(g, 0.4);
  for (const det of [-5, 5]) osc('sawtooth', mtof(midi), t, t + dur + 0.25, f, det);
}

/** Отрывистые струнные (остинато). */
function stacc(midi: number, t: number, vol = 0.03) {
  const c = ctx!;
  const f = lowpass(1400);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  f.connect(g);
  out(g, 0.25);
  osc('sawtooth', mtof(midi), t, t + 0.25, f);
}

function noiseSrc(t: number, dur: number, dest: AudioNode) {
  const s = ctx!.createBufferSource();
  s.buffer = noiseBuffer();
  s.connect(dest);
  s.start(t, Math.random());
  s.stop(t + dur);
}

/** Большой барабан: синус с падающим тоном + глухой шум. */
function drum(t: number, vol: number, f0 = 95) {
  const c = ctx!;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  out(g, 0.3);
  const o = osc('sine', f0, t, t + 0.95, g);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.47, t + 0.4);
  const ng = c.createGain();
  ng.gain.setValueAtTime(vol * 0.6, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  const f = lowpass(240);
  f.connect(ng);
  out(ng, 0.2);
  noiseSrc(t, 0.2, f);
}

function clack(t: number, vol: number) {
  const c = ctx!;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1800;
  f.Q.value = 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  f.connect(g);
  out(g, 0.3);
  noiseSrc(t, 0.15, f);
}

/** Нарастающий шелест тарелки перед сменой настроения. */
function swell(t: number, dur: number, vol = 0.05) {
  const c = ctx!;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 5000;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
  f.connect(g);
  out(g, 0.6);
  noiseSrc(t, dur + 0.35, f);
}

/** Колокольчик (челеста): негармонические обертоны и долгое затухание. */
function bell(midi: number, t: number, vol = 0.035) {
  const c = ctx!;
  const freq = mtof(midi);
  for (const [k, v, d] of [[1, 1, 3], [2.76, 0.3, 1.6], [5.4, 0.1, 0.8]]) {
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    out(g, 0.7);
    osc('sine', freq * k, t, t + d + 0.05, g);
  }
}

// ---------- композиция ----------
const RHYTHMS = [[1, 1, 2], [2, 1, 1], [1.5, 0.5, 2], [3, 1], [1, 1, 1, 1], [2, 2], [0.5, 0.5, 1, 2]];
const WAR_RHYTHMS = [[1, 0.5, 0.5, 2], [1.5, 0.5, 1, 1], [0.5, 0.5, 0.5, 0.5, 2], [2, 1, 1], [1, 1, 2]];
const DRUMS = [[1, 0, 0, 1, 1, 0, 0, 0], [1, 0, 1, 0, 1, 0, 0, 1], [1, 0, 0, 1, 0, 0, 1, 0]];
const ARPS = [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 1], [0, 1, 2, 1, 3, 2, 4, 2]];

let mood: Mood = 'menu';
let wanted: Mood = 'menu';
let nextBar = 0;
let bar = 0;
let prog = PROGS.menu[0];
let layers = { bass: true, arp: true, melody: false, bells: true, drums: false, ostinato: false, soft: false };
let motif = { rh: [1, 1, 2], steps: [0, 1, -1] };
let arp = ARPS[0];
let drumPat = DRUMS[0];
let melDeg = 4;

function newSection() {
  const options = PROGS[mood].filter((p) => p !== prog);
  prog = pick(options.length ? options : PROGS[mood]);
  const r = () => rnd();
  if (mood === 'war') layers = { bass: true, arp: r() < 0.3, melody: r() < 0.65, bells: false, drums: true, ostinato: r() < 0.8, soft: false };
  else if (mood === 'peace') layers = { bass: r() < 0.85, arp: r() < 0.65, melody: r() < 0.6, bells: r() < 0.45, drums: false, ostinato: false, soft: r() < 0.3 };
  else layers = { bass: r() < 0.6, arp: r() < 0.5, melody: r() < 0.45, bells: r() < 0.7, drums: false, ostinato: false, soft: false };
  if (mood !== 'war' && !layers.arp && !layers.melody) layers.arp = true;
  const rh = pick(mood === 'war' ? WAR_RHYTHMS : RHYTHMS);
  motif = { rh, steps: rh.map((_, k) => (k === 0 ? 0 : pick([-2, -1, -1, 1, 1, 2]))) };
  arp = pick(ARPS);
  drumPat = pick(DRUMS);
}

function melodyBar(ch: Chord, t: number, beat: number, phraseBar: number) {
  const play = mood === 'war' ? brass : flute;
  const vol = mood === 'war' ? 0.042 : mood === 'menu' ? 0.05 : 0.058;
  let rh: number[], steps: number[] | null = null;
  if (phraseBar === 3) rh = pick([[3, 1], [4], [2, 2]]); // каденция
  else if (phraseBar === 0 || phraseBar === 2) { rh = motif.rh; steps = motif.steps; } // мотив повторяется
  else rh = pick(mood === 'war' ? WAR_RHYTHMS : RHYTHMS);
  let pos = 0;
  rh.forEach((dur, k) => {
    if (k === 0) melDeg = nearestChordDeg(melDeg + pick([-1, 0, 0, 1]), ch);
    else if (steps) melDeg += steps[k];
    else if (phraseBar === 3) melDeg = nearestChordDeg(melDeg, ch);
    else melDeg += pick([-1, 1, -1, 1, 2, -2]);
    if (melDeg > 11) melDeg -= 2;
    if (melDeg < 0) melDeg += 2;
    const rest = k > 0 && phraseBar !== 3 && rnd() < 0.12;
    if (!rest) play(degToMidi(melDeg, ch), t + pos * beat, dur * beat * 0.92, vol);
    pos += dur;
  });
}

function playBar(t: number, beat: number) {
  const ch = prog[bar % 4];
  const phraseBar = bar % 4;
  const bright = mood === 'war' ? 1350 : mood === 'menu' ? 750 : 950;
  pad(voicing(ch, 55), t, beat * 4, bright);
  if (layers.bass) {
    const b = ch.root - 12;
    if (mood === 'war') [0, 1.5, 2, 3].forEach((k) => bass(b, t + k * beat, beat * (k === 1.5 ? 0.5 : 1), 0.13));
    else {
      bass(b, t, beat * 2);
      bass(rnd() < 0.3 ? b + 7 : b, t + beat * 2, beat * 2, 0.12);
    }
  }
  if (layers.arp) {
    const v = voicing(ch, 62);
    const notes = [...v, v[0] + 12, v[1] + 12];
    arp.forEach((k, s) => { if (rnd() > 0.1) harp(notes[k], t + s * beat * 0.5, mood === 'menu' ? 0.035 : 0.042); });
  }
  if (layers.melody) melodyBar(ch, t, beat, phraseBar);
  if (layers.bells && rnd() < 0.4) bell(pick(voicing(ch, 74)), t + beat * pick([0, 1, 2, 3, 1.5]));
  if (layers.soft) { drum(t, 0.1, 70); drum(t + beat * 2.5, 0.05, 70); }
  if (layers.drums) {
    const roll = bar % 8 === 7;
    const pat = roll ? [1, 0, 1, 0, 1, 1, 1, 1] : drumPat;
    pat.forEach((hit, s) => { if (hit) drum(t + s * beat * 0.5, (s === 0 ? 0.34 : 0.2) * (roll ? 0.7 + s * 0.06 : 1)); });
    clack(t + beat, 0.05);
    clack(t + beat * 3, 0.05);
  }
  if (layers.ostinato) {
    const r = ch.root;
    [r, r, r + 12, r, r, r + 7, r + 12, r].forEach((m, s) => stacc(m, t + s * beat * 0.5));
  }
}

function transition(to: Mood, t: number) {
  if (to === 'war') {
    const s = Math.max(ctx!.currentTime, t - 1.2);
    swell(s, Math.max(0.05, t - s), 0.06);
    drum(t, 0.45, 80);
    drum(t + 0.02, 0.3, 120);
  } else {
    bell(74, t, 0.04);
    bell(81, t + 0.3, 0.03);
  }
}

function schedule() {
  const c = ctx;
  if (!c || c.state !== 'running') return;
  if (nextBar < c.currentTime - 0.5) nextBar = c.currentTime + 0.1; // после долгого простоя — с текущего момента
  while (nextBar < c.currentTime + 0.4) {
    if (wanted !== mood) {
      mood = wanted;
      bar = 0;
      newSection();
      if (settings.music) transition(mood, nextBar);
    } else if (bar % 8 === 0) newSection();
    const beat = 60 / TEMPO[mood];
    if (settings.music) playBar(nextBar, beat);
    nextBar += beat * 4;
    bar++;
  }
}

export function setMood(m: Mood) {
  wanted = m;
}

let started = false;
export function startMusic() {
  if (started) return;
  started = true;
  onAudioReady(() => {
    nextBar = ctx!.currentTime + 0.3;
    newSection();
    window.setInterval(schedule, 80);
  });
}
