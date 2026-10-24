import '@fontsource/pt-sans/cyrillic-400.css';
import '@fontsource/pt-sans/cyrillic-700.css';
import '@fontsource/pt-sans/latin-400.css';
import '@fontsource/pt-sans/latin-700.css';
import '@fontsource/cormorant-sc/cyrillic-700.css';
import '@fontsource/cormorant-sc/latin-700.css';
import './style.css';
import { render } from 'preact';
import { initAudio } from './audio';
import { MapView } from './map/MapView';
import { initPwa } from './pwa';
import { App } from './ui/App';
import { initFx } from './ui/fx';
import { initIcons } from './ui/icons';
import { startLoop } from './ui/store';

async function boot() {
  initPwa();
  initAudio();
  initFx();
  initIcons();
  // шрифты нужны до создания подписей на карте
  await Promise.race([
    Promise.all([document.fonts.load('700 20px "Cormorant SC"'), document.fonts.load('700 20px "PT Sans"')]),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  const map = new MapView();
  await map.init(document.getElementById('map')!);
  render(<App map={map} />, document.getElementById('app')!);
  startLoop();
}

boot();
