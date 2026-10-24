// Подключение звука к игре: эффекты по сигналам логики, настроение музыки по обстановке.
import { enemiesOf } from '../game/actions';
import { getGame, setSfxHandler, subscribe } from '../game/state';
import { initAudioUnlock } from './engine';
import { setMood, startMusic } from './music';
import { playSfx } from './sfx';

export function initAudio() {
  setSfxHandler(playSfx);
  initAudioUnlock();
  startMusic();
  // негромкий щелчок на любую активную кнопку
  document.addEventListener(
    'click',
    (e) => {
      const b = (e.target as Element | null)?.closest?.('button');
      if (b && !b.disabled) playSfx('click');
    },
    true,
  );
  const update = () => {
    const g = getGame();
    if (!g || g.gameOver) return setMood('menu');
    const war = enemiesOf(g, g.player).length > 0 || g.battles.some((b) => b.def === g.player || b.att === g.player);
    setMood(war ? 'war' : 'peace');
  };
  subscribe(update);
  update();
}
