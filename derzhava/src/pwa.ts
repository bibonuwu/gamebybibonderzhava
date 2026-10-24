// Установка сайта как приложения (PWA): ловим предложение браузера «Установить» и включаем офлайн-кэш.
import { emit } from './game/state';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;
let installed = false;

/** Уже открыто как приложение (с иконки на экране/рабочем столе). */
function standalone() {
  const mode = (m: string) => matchMedia(`(display-mode: ${m})`).matches;
  return mode('standalone') || mode('minimal-ui') || (mode('fullscreen') && !document.fullscreenElement)
    || (navigator as { standalone?: boolean }).standalone === true;
}

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // своя кнопка в настройках вместо всплывашки браузера
    deferred = e as InstallPrompt;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
  // офлайн-кэш — только в собранной игре на сайте (в программе для Windows он не нужен)
  if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const reg = () => navigator.serviceWorker.register('./sw.js').catch(() => { /* без офлайна */ });
    if (document.readyState === 'complete') reg();
    else window.addEventListener('load', reg, { once: true });
  }
}

/**
 * prompt — браузер готов установить по кнопке; ios — только через «Поделиться»;
 * manual — через меню браузера; insecure — сайт открыт не по https; none — это программа для Windows.
 */
export type InstallMode = 'installed' | 'prompt' | 'ios' | 'manual' | 'insecure' | 'none';

export function installMode(): InstallMode {
  if (installed) return 'installed';
  if (deferred) return 'prompt';
  if (standalone()) return 'installed';
  if (/Electron/.test(navigator.userAgent)) return 'none';
  if (!window.isSecureContext) return 'insecure';
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios ? 'ios' : 'manual';
}

export async function promptInstall() {
  const e = deferred;
  if (!e) return;
  deferred = null; // предложение одноразовое
  await e.prompt();
  if ((await e.userChoice).outcome === 'accepted') installed = true;
  emit();
}
