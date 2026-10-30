// Чудеса света: уникальные великие проекты. Каждое строится один раз на весь мир — гонка с ботами.
import type { TechMods } from './defs';
import { TECH_BY_ID } from './defs';
import { banner, fx, log, mapDirty, news, sfx } from './state';
import type { GameState, Personality } from './types';
import { COUNTRY_DEFS, REGIONS, vb } from './world';

export interface WonderDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  days: number;
  money: number; // × доход страны в начале партии
  brains: number; // × масштаб науки страны
  tech?: string;
  mods: Partial<TechMods>;
  pref: Personality[];
}

export const WONDERS: WonderDef[] = [
  { id: 'liberty', name: 'Статуя Свободы', icon: '🗽', desc: 'Стабильность +5, рост населения +0.2%/год', days: 60, money: 150, brains: 120, mods: { stab: 5, growth: 0.2 }, pref: ['trader', 'cautious'] },
  { id: 'wall', name: 'Великая стена', icon: '🏯', desc: 'Оборона всех регионов +35%', days: 75, money: 180, brains: 150, mods: { defense: 1.35 }, pref: ['cautious'] },
  { id: 'stadium', name: 'Олимпийский стадион', icon: '🏟️', desc: 'Стабильность +6', days: 60, money: 170, brains: 100, mods: { stab: 6 }, pref: ['fanatic', 'trader'] },
  { id: 'exchange', name: 'Мировая биржа', icon: '🏦', desc: 'Производительность +10%, торговля +30%', days: 90, money: 260, brains: 250, tech: 'smart_factories', mods: { prod: 1.1, trade: 1.3 }, pref: ['trader'] },
  { id: 'cathedral', name: 'Великий собор', icon: '🕍', desc: 'Стабильность +9', days: 80, money: 220, brains: 200, tech: 'dialogue', mods: { stab: 9 }, pref: ['fanatic'] },
  { id: 'seedvault', name: 'Всемирное семенохранилище', icon: '🌾', desc: 'Лимит населения +15%, урожай +10%, рост +0.2%/год', days: 80, money: 220, brains: 250, tech: 'vertical_farms', mods: { cap: 1.15, growth: 0.2, food: 1.1 }, pref: ['cautious', 'fanatic'] },
  { id: 'staff', name: 'Генеральный штаб', icon: '🎖️', desc: 'Вооружение +25%', days: 90, money: 260, brains: 300, tech: 'drones', mods: { weapons: 1.25 }, pref: ['aggressor'] },
  { id: 'gigafactory', name: 'Гигафабрика', icon: '🏭', desc: 'Заводы +35%, +1 стройка одновременно', days: 100, money: 300, brains: 400, tech: 'robotics', mods: { factory: 1.35, slots: 1 }, pref: ['aggressor', 'trader'] },
  { id: 'cosmodrome', name: 'Космодром', icon: '🚀', desc: '🧠 +20%, стабильность +2', days: 110, money: 320, brains: 500, tech: 'supercomputers', mods: { brains: 1.2, stab: 2 }, pref: ['scientist'] },
  { id: 'longevity', name: 'Институт долголетия', icon: '🧬', desc: 'Рост населения +0.5%/год', days: 110, money: 320, brains: 500, tech: 'gene_therapy', mods: { growth: 0.5 }, pref: ['scientist', 'cautious'] },
  { id: 'collider', name: 'Адронный коллайдер', icon: '⚛️', desc: '🧠 +30%', days: 140, money: 420, brains: 900, tech: 'ai', mods: { brains: 1.3 }, pref: ['scientist'] },
  { id: 'orbital', name: 'Орбитальная станция', icon: '🛰️', desc: 'Производительность +10%, оборона +15%, вооружение +10%', days: 160, money: 500, brains: 1200, tech: 'space', mods: { prod: 1.1, defense: 1.15, weapons: 1.1 }, pref: ['aggressor', 'scientist'] },
];
export const WONDER_BY_ID = Object.fromEntries(WONDERS.map((w) => [w.id, w])) as Record<string, WonderDef>;

export function wonderCost(g: GameState, ci: number, id: string) {
  const w = WONDER_BY_ID[id];
  const c = g.countries[ci];
  return { money: w.money * Math.max(30, c.moneyScale), brains: w.brains * c.techScale };
}

/** Владелец чуда (по региону, где оно стоит): -1 — ещё не построено или регион нейтральный. */
export function wonderOwner(g: GameState, id: string): number {
  const w = g.wonders[id];
  return w ? g.regions[w.region].owner : -1;
}
export const wondersOf = (g: GameState, ci: number) => WONDERS.filter((w) => g.wonders[w.id] && wonderOwner(g, w.id) === ci);
export const wonderInRegion = (g: GameState, rid: number) => WONDERS.find((w) => g.wonders[w.id]?.region === rid);

/** Кто ещё строит это чудо (доля готовности). */
export function rivals(g: GameState, ci: number, id: string) {
  const out: { ci: number; pct: number }[] = [];
  g.countries.forEach((c, i) => {
    if (i !== ci && c.alive && c.project?.id === id) out.push({ ci: i, pct: 1 - c.project.left / c.project.total });
  });
  return out.sort((a, b) => b.pct - a.pct);
}

export function wonderError(g: GameState, ci: number, id: string): string | null {
  const w = WONDER_BY_ID[id];
  const c = g.countries[ci];
  if (g.wonders[id]) return 'Уже построено';
  if (c.project) return 'Уже идёт великий проект';
  if (w.tech && !c.techs.includes(w.tech)) return `Нужна технология «${TECH_BY_ID[w.tech].name}»`;
  const cost = wonderCost(g, ci, id);
  if (c.money < cost.money) return 'Не хватает денег';
  if (c.brains < cost.brains) return 'Не хватает 🧠';
  return null;
}

export function startWonder(g: GameState, ci: number, id: string): string | null {
  const err = wonderError(g, ci, id);
  if (err) return err;
  const c = g.countries[ci];
  const w = WONDER_BY_ID[id];
  const cost = wonderCost(g, ci, id);
  c.money -= cost.money;
  c.brains -= cost.brains;
  c.project = { id, left: w.days, total: w.days, money: cost.money, brains: cost.brains };
  if (ci === g.player) {
    sfx('build');
    log(g, `🏛️ Начато строительство: ${w.icon} ${w.name}`, 'good');
  } else if (rivals(g, ci, id).some((r) => r.ci === g.player)) {
    log(g, `⚠️ ${COUNTRY_DEFS[ci].name} тоже строит ${w.icon} ${w.name}!`, 'bad');
  }
  return null;
}

/** Отмена проекта: возвращается половина вложенного. */
export function cancelWonder(g: GameState, ci: number, reason?: string) {
  const c = g.countries[ci];
  const p = c.project;
  if (!p) return;
  c.money += p.money * 0.5;
  c.brains += p.brains * 0.5;
  c.project = undefined;
  if (ci === g.player && reason) log(g, reason, 'bad');
}

/** Ход великих проектов (раз в день). */
export function tickWonders(g: GameState) {
  g.countries.forEach((c, i) => {
    const p = c.project;
    if (!p || !c.alive) return;
    p.left -= 1;
    if (p.left > 0) return;
    const w = WONDER_BY_ID[p.id];
    c.project = undefined;
    g.wonders[p.id] = { region: c.capital, day: g.day, builder: i };
    mapDirty.buildings = true;
    fx({ kind: 'float', tile: REGIONS[c.capital].center, text: w.icon });
    if (i === g.player) {
      g.counters.wonders = (g.counters.wonders ?? 0) + 1;
      sfx('wonder');
      log(g, `🏛️ Чудо света построено: ${w.icon} ${w.name}! ${w.desc}`, 'good', false);
      banner({ icon: w.icon, title: 'Чудо света построено', text: w.name, kind: 'gold' });
    } else {
      news(g, `🏛️ ${COUNTRY_DEFS[i].name} ${vb(i, 'построил')} чудо света: ${w.icon} ${w.name}`, 'info');
    }
    // остальные проиграли гонку
    g.countries.forEach((o, j) => {
      if (j !== i && o.project?.id === p.id) {
        cancelWonder(g, j, `😞 ${COUNTRY_DEFS[i].name} ${vb(i, 'первым', 'первой', 'первыми')} ${vb(i, 'достроил')} ${w.icon} ${w.name}. Половина вложений возвращена.`);
        if (j === g.player) sfx('defeat');
      }
    });
  });
}

/** Бонусы чудес, которыми владеет страна. */
export function wonderMods(g: GameState): Partial<TechMods>[][] {
  const out: Partial<TechMods>[][] = g.countries.map(() => []);
  for (const id in g.wonders) {
    const owner = g.regions[g.wonders[id].region].owner;
    if (owner >= 0 && WONDER_BY_ID[id]) out[owner].push(WONDER_BY_ID[id].mods);
  }
  return out;
}

export const wonderProgress = (g: GameState, ci: number) => {
  const p = g.countries[ci].project;
  return p ? 1 - p.left / p.total : 0;
};
