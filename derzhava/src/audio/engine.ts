// Звуковой движок: общий AudioContext, шины музыки и эффектов, реверберация, настройки громкости.
// Все звуки синтезируются на лету — аудиофайлов нет.

const KEY = 'derzhava-audio-v1';

export interface AudioSettings {
  music: boolean;
  sfx: boolean;
  musicVol: number;
  sfxVol: number;
}
export const settings: AudioSettings = { music: true, sfx: true, musicVol: 0.6, sfxVol: 0.8 };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) Object.assign(settings, JSON.parse(raw));
} catch {
  /* хранилище недоступно — настройки по умолчанию */
}

/** Шина: сухой сигнал и посыл в ревербератор. */
export interface Bus {
  dry: GainNode;
  wet: GainNode;
}

export let ctx: AudioContext | null = null;
export let musicBus: Bus;
export let sfxBus: Bus;
let noise: AudioBuffer | null = null;
const readyListeners: (() => void)[] = [];

export function onAudioReady(cb: () => void) {
  if (ctx) cb();
  else readyListeners.push(cb);
}

function impulse(ac: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function build() {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  const ac = new AC();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  comp.connect(ac.destination);
  // общий ревербератор с мягким срезом верхов — «зал»
  const conv = ac.createConvolver();
  conv.buffer = impulse(ac, 3.2, 2.6);
  const warm = ac.createBiquadFilter();
  warm.type = 'lowpass';
  warm.frequency.value = 4200;
  conv.connect(warm).connect(comp);
  const mk = (): Bus => {
    const dry = ac.createGain();
    const wet = ac.createGain();
    dry.connect(comp);
    wet.connect(conv);
    return { dry, wet };
  };
  musicBus = mk();
  sfxBus = mk();
  ctx = ac;
  applyVolumes(true);
  readyListeners.splice(0).forEach((cb) => cb());
}

export function applyVolumes(instant = false) {
  if (!ctx) return;
  const m = settings.music ? settings.musicVol * 0.55 : 0;
  const s = settings.sfx ? settings.sfxVol * 0.9 : 0;
  const t = ctx.currentTime;
  for (const [bus, v] of [[musicBus, m], [sfxBus, s]] as [Bus, number][]) {
    for (const node of [bus.dry, bus.wet]) {
      if (instant) node.gain.setValueAtTime(v, t);
      else node.gain.setTargetAtTime(v, t, 0.08);
    }
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* не страшно */
  }
  applyVolumes();
}

/** Подключить узел к шине: сухой сигнал + доля в реверберацию. */
export function connectOut(node: AudioNode, bus: Bus, wet: number) {
  node.connect(bus.dry);
  if (wet > 0 && ctx) {
    const send = ctx.createGain();
    send.gain.value = wet;
    node.connect(send).connect(bus.wet);
  }
}

/** Белый шум (общий буфер на 2 секунды). */
export function noiseBuffer(): AudioBuffer {
  if (!noise && ctx) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise!;
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Браузеры разрешают звук только после касания/клика: создаём контекст при первом жесте
 * и усыпляем его, когда вкладка свёрнута (игра в это время тоже стоит).
 */
export function initAudioUnlock() {
  const unlock = () => {
    if (!ctx) build();
    if (ctx && ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
  });
}
