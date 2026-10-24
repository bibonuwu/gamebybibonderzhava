import { BASE_RATE } from './debt';
import { initElections } from './elections';
import { initLodge } from './lodge';
import { SAVE_VERSION } from './newGame';
import { initSociety } from './society';
import { initIntel } from './spy';
import type { GameState } from './types';
import { REGIONS } from './world';

const KEY = 'derzhava-save-v1';

export function saveGame(g: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* хранилище недоступно — играем без сохранения */
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as GameState;
    if (g.version !== SAVE_VERSION || g.regions.length !== REGIONS.length) return null;
    // поля, появившиеся позже: старые сохранения продолжают работать
    g.wonders ??= {};
    g.quests ??= [];
    g.missiles ??= [];
    g.fallout ??= {};
    g.un ??= [];
    g.lodge ??= initLodge(g);
    g.elections ??= initElections(g);
    g.intel ??= initIntel(g);
    g.finance ??= { base: BASE_RATE, shock: 0, nextCrisis: g.day + 1800 };
    // санкции и коалиции прежней версии ООН: без дела в g.un они не кончились бы никогда
    for (const c of g.countries) c.mods = c.mods.filter((m) => m.label !== 'Санкции ООН');
    for (const p of Object.values(g.pairs)) if (p.war?.un !== undefined && !g.un.some((cs) => cs.aggressor === p.war!.un)) delete p.war.un;
    g.mail ??= [];
    g.mailSeen ??= [];
    g.nextMailDay ??= g.day + 20;
    for (const c of g.countries) c.moneyScale ??= Math.max(30, c.lastGross);
    initSociety(g, !g.market);
    return g;
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function deleteSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ничего */
  }
}
