import { installMode, promptInstall, type InstallMode } from '../pwa';
import { useStore } from './store';

const HINT: Record<Exclude<InstallMode, 'none'>, string> = {
  installed: 'Игра открыта как приложение. Иконка «Держава» — на главном экране или рабочем столе.',
  prompt: 'Иконка появится на главном экране (или рабочем столе) — игра откроется на весь экран, без браузера, и будет работать без интернета.',
  ios: 'В Safari нажмите «Поделиться» ⬆️ внизу экрана, затем «На экран «Домой»».',
  manual: 'Откройте меню браузера (⋮ или ⋯) и выберите «Установить приложение» или «Добавить на главный экран».',
  insecure: 'Установить можно только с сайта по адресу https://… Сейчас игра открыта по простому http.',
};

/** Скачать сайт как приложение — кнопка в настройках. */
export function InstallApp() {
  useStore();
  const mode = installMode();
  if (mode === 'none') return null;
  return (
    <div class="card">
      <div class="row between audio-row">
        <span>📲 Приложение</span>
        {mode === 'installed' ? (
          <button class="toggle on" disabled>✓ Установлено</button>
        ) : mode === 'prompt' ? (
          <button class="toggle on" onClick={promptInstall}>Установить</button>
        ) : null}
      </div>
      <div class="small muted">{HINT[mode]}</div>
    </div>
  );
}
