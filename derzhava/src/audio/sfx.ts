// Звуковые эффекты: синтез на лету (стройка, наука, монеты, война, фанфары и т. д.).
import type { Sfx } from '../game/state';
import { connectOut, ctx, noiseBuffer, settings, sfxBus } from './engine';

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  attack?: number;
  to?: number; // скольжение частоты к концу
  wet?: number;
  lp?: number;
}

function tone(f: number, t: number, dur: number, o: ToneOpts = {}) {
  const c = ctx!;
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.vol ?? 0.15, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = osc;
  if (o.lp) {
    const f2 = c.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.value = o.lp;
    osc.connect(f2);
    node = f2;
  }
  node.connect(g);
  connectOut(g, sfxBus, o.wet ?? 0.15);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(t: number, dur: number, o: { vol: number; type: BiquadFilterType; f: number; q?: number; to?: number; attack?: number; wet?: number }) {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer();
  const f = c.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.f, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.vol, t + (o.attack ?? 0.003));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g);
  connectOut(g, sfxBus, o.wet ?? 0.15);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

const bell = (f: number, t: number, dur: number, vol: number) => {
  tone(f, t, dur, { vol, wet: 0.4 });
  tone(f * 2.76, t, dur * 0.5, { vol: vol * 0.25, wet: 0.4 });
  tone(f * 5.4, t, dur * 0.25, { vol: vol * 0.1, wet: 0.4 });
};

/** Медный духовой: две пилы с открывающимся фильтром. */
function brass(freqs: number[], t: number, dur: number, vol = 0.07) {
  const c = ctx!;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(350, t);
  f.frequency.linearRampToValueAtTime(2200, t + 0.1);
  f.frequency.linearRampToValueAtTime(900, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.07);
  g.gain.setValueAtTime(vol, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0, t + dur);
  f.connect(g);
  connectOut(g, sfxBus, 0.35);
  for (const fr of freqs) {
    for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
}

function boom(t: number, vol = 0.5, f0 = 110) {
  tone(f0, t, 0.8, { vol, to: f0 * 0.4, wet: 0.3 });
  noise(t, 0.18, { vol: vol * 0.5, type: 'lowpass', f: 300 });
}

function shimmer(t: number, dur = 0.7, vol = 0.03) {
  noise(t, dur, { vol, type: 'highpass', f: 6000, attack: dur * 0.3, wet: 0.6 });
}

const arp = (freqs: number[], t: number, step: number, dur: number, vol: number, type: OscillatorType = 'sine') =>
  freqs.forEach((f, k) => tone(f, t + k * step, dur, { vol, type, wet: 0.45 }));

// частоты нот
const N = { C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2, G4: 392, A4: 440, C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784, A5: 880, C6: 1046.5, D6: 1174.7, E6: 1318.5, G6: 1568, A6: 1760 };

const SOUNDS: Record<Sfx, (t: number) => void> = {
  click: (t) => tone(1150, t, 0.05, { type: 'triangle', vol: 0.05, to: 720, wet: 0 }),
  build: (t) => {
    for (let k = 0; k < 3; k++) {
      noise(t + k * 0.13, 0.07, { vol: 0.16, type: 'bandpass', f: 1700, q: 2.5, wet: 0.1 });
      tone(240, t + k * 0.13, 0.08, { type: 'square', vol: 0.04, lp: 900, to: 150, wet: 0.1 });
    }
  },
  done: (t) => {
    bell(N.C6, t, 1.0, 0.1);
    bell(N.G6, t + 0.11, 1.3, 0.08);
  },
  research: (t) => {
    arp([N.A5, N.C6, N.D6, N.E6, N.G6, N.A6], t, 0.055, 0.6, 0.06);
    shimmer(t + 0.1, 0.8, 0.025);
  },
  coins: (t) => {
    for (let k = 0; k < 4; k++) {
      const f = 2100 + Math.random() * 1400;
      tone(f, t + k * 0.06, 0.28, { type: 'triangle', vol: 0.06, wet: 0.2 });
      tone(f * 1.5, t + k * 0.06, 0.15, { vol: 0.025 });
    }
  },
  war: (t) => {
    boom(t, 0.55, 100);
    brass([110, 164.8], t + 0.05, 1.5, 0.08);
    boom(t + 0.75, 0.4, 90);
  },
  attack: (t) => {
    noise(t, 0.2, { vol: 0.18, type: 'highpass', f: 3000, wet: 0.2 });
    tone(2600, t, 0.5, { type: 'square', vol: 0.02, lp: 5000 });
    tone(3900, t, 0.35, { vol: 0.035 });
    boom(t + 0.05, 0.3, 120);
  },
  alarm: (t) => {
    for (const k of [0, 0.42]) {
      brass([110, 116.5], t + k, 0.35, 0.07);
      boom(t + k, 0.3, 90);
    }
  },
  victory: (t) => {
    brass([N.C4], t, 0.14, 0.06);
    brass([N.E4], t + 0.13, 0.14, 0.06);
    brass([N.G4], t + 0.26, 0.14, 0.06);
    brass([N.C4, N.E4, N.G4, N.C5], t + 0.4, 1.2, 0.05);
    boom(t + 0.4, 0.35, 100);
    shimmer(t + 0.4, 1.1, 0.03);
  },
  defeat: (t) => {
    brass([196], t, 0.5, 0.06);
    brass([155.6], t + 0.45, 0.5, 0.06);
    brass([130.8, 155.6], t + 0.9, 1.4, 0.055);
    boom(t + 0.9, 0.3, 70);
  },
  peace: (t) => {
    arp([N.F4, N.A4, N.C5, N.F5], t, 0.09, 1.4, 0.06, 'triangle');
    bell(N.C6, t + 0.4, 1.6, 0.05);
  },
  treaty: (t) => arp([N.F4, N.A4, N.C5, N.F5], t, 0.07, 1.1, 0.06, 'triangle'),
  notify: (t) => {
    bell(N.A5, t, 0.6, 0.08);
    bell(N.E6, t + 0.12, 0.8, 0.07);
  },
  event: (t) => {
    tone(N.D4, t, 1.8, { type: 'triangle', vol: 0.06, attack: 0.3, wet: 0.6 });
    tone(N.A4, t, 1.8, { type: 'triangle', vol: 0.05, attack: 0.3, wet: 0.6 });
    bell(N.D6, t + 0.25, 1.8, 0.06);
  },
  achievement: (t) => {
    arp([N.C5, N.E5, N.G5, N.C6, N.E6], t, 0.06, 0.7, 0.07, 'triangle');
    bell(N.G6, t + 0.32, 1.4, 0.06);
    shimmer(t + 0.3, 1, 0.03);
  },
  error: (t) => {
    tone(150, t, 0.14, { type: 'square', vol: 0.045, lp: 700, wet: 0 });
    tone(112, t + 0.08, 0.16, { type: 'square', vol: 0.045, lp: 700, wet: 0 });
  },
  annex: (t) => {
    arp([N.D5, N.F5, N.A5], t, 0.08, 1.0, 0.06, 'triangle');
    bell(N.D6, t + 0.25, 1.4, 0.06);
  },
  revolution: (t) => {
    brass([98, 103.8, 146.8], t, 1.3, 0.07);
    boom(t, 0.5, 80);
    noise(t, 1.3, { vol: 0.05, type: 'bandpass', f: 800, to: 3000, attack: 0.6, wet: 0.4 });
  },
  recruit: (t) => {
    for (let k = 0; k < 4; k++) noise(t + k * 0.08, 0.06, { vol: 0.08 + k * 0.03, type: 'bandpass', f: 2400, q: 1.2, wet: 0.1 });
    boom(t + 0.34, 0.3, 120);
  },
  wonder: (t) => {
    SOUNDS.victory(t);
    arp([N.G5, N.C6, N.E6, N.G6], t + 1.1, 0.1, 1.6, 0.05);
  },
  quest: (t) => {
    bell(N.E6, t, 0.9, 0.08);
    bell(N.A6, t + 0.1, 1.1, 0.06);
    shimmer(t, 0.6, 0.025);
  },
  nuke: (t) => {
    // вспышка, глухой удар и долгий раскат ударной волны
    noise(t, 0.35, { vol: 0.25, type: 'highpass', f: 2500, wet: 0.5 });
    boom(t, 0.7, 70);
    tone(45, t, 3.5, { vol: 0.35, to: 22, attack: 0.05, wet: 0.5 });
    noise(t + 0.1, 4.5, { vol: 0.3, type: 'lowpass', f: 900, to: 120, attack: 0.4, wet: 0.6 });
    boom(t + 1.2, 0.4, 55);
  },
  siren: (t) => {
    // воздушная тревога: два воя вверх-вниз
    for (const k of [0, 1.1]) {
      tone(330, t + k, 0.55, { type: 'sawtooth', vol: 0.05, to: 700, attack: 0.15, lp: 2200, wet: 0.4 });
      tone(700, t + k + 0.5, 0.55, { type: 'sawtooth', vol: 0.05, to: 330, attack: 0.02, lp: 2200, wet: 0.4 });
    }
  },
};

const last: Partial<Record<Sfx, number>> = {};
export function playSfx(name: Sfx) {
  const c = ctx;
  if (!c || !settings.sfx || c.state !== 'running') return;
  const now = c.currentTime;
  // одинаковые звуки подряд не наслаиваем
  if (now - (last[name] ?? -1) < (name === 'click' ? 0.04 : 0.12)) return;
  last[name] = now;
  SOUNDS[name](now + 0.01);
}
