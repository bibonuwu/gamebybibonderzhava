import { useState } from 'preact/hooks';
import { saveSettings, settings, type AudioSettings as Settings } from '../audio/engine';

/** Музыка и звуки: вкл/выкл и громкость (запоминается в браузере). */
export function AudioSettings() {
  const [, force] = useState(0);
  const upd = (patch: Partial<Settings>) => {
    Object.assign(settings, patch);
    saveSettings();
    force((x) => x + 1);
  };
  const row = (label: string, on: boolean, vol: number, toggle: () => void, setVol: (v: number) => void) => (
    <div class="audio-row">
      <div class="row between">
        <span>{label}</span>
        <button class={`toggle ${on ? 'on' : ''}`} onClick={toggle} aria-pressed={on}>
          {on ? 'Вкл' : 'Выкл'}
        </button>
      </div>
      <input
        type="range" min={0} max={100} value={Math.round(vol * 100)} disabled={!on}
        onInput={(e) => setVol(+(e.currentTarget as HTMLInputElement).value / 100)}
      />
    </div>
  );
  return (
    <div class="audio">
      {row('🎵 Музыка', settings.music, settings.musicVol, () => upd({ music: !settings.music }), (v) => upd({ musicVol: v }))}
      {row('🔊 Звуки', settings.sfx, settings.sfxVol, () => upd({ sfx: !settings.sfx }), (v) => upd({ sfxVol: v }))}
      <div class="small muted">Музыка меняется сама: спокойная в мирное время, тревожная с барабанами — во время войны.</div>
    </div>
  );
}
