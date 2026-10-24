// Советник стройки: какие стороны страны ослаблены и что построить, чтобы их подтянуть.
import { availableTechs, startBuild, startUpgrade, techCost } from './actions';
import { assessThreat, bestBuildOption } from './ai';
import { STATS } from './economy';
import { fmt, fmtDays, fmtRate } from './format';
import type { BuildingType, GameState } from './types';

export type SectorId = 'economy' | 'science' | 'stability' | 'food' | 'growth' | 'defense';

export interface Sector {
  id: SectorId;
  icon: string;
  name: string;
  score: number; // 0…1: 0 — совсем плохо, 1 — крепко
  note: string; // почему такая оценка
  build: BuildingType[]; // что строить — по порядку предпочтения
}

export interface Advice {
  sector: Sector;
  type: BuildingType;
  tile: number;
  cost: number;
  upgrade: boolean;
}

/** Ниже — «ослаблен», выше WEAK..GOOD — «средне». */
export const WEAK = 0.35;
export const GOOD = 0.65;

/** Что даёт здание — для подписи совета. */
export const GAIN: Record<BuildingType, string> = {
  factory: 'больше денег',
  university: 'наука быстрее',
  temple: 'выше стабильность',
  hospital: 'население растёт быстрее',
  farm: 'больше еды и места для людей',
  barracks: 'армия дешевле',
  port: 'доход от торговли',
  fortress: 'крепче оборона',
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
// оценка: больше половины — положение дел, остальное — сколько уже построено (каждое здание заметно сдвигает шкалу)
const blend = (state: number, coverage: number, target: number) => 0.6 * clamp01(state) + 0.4 * clamp01(coverage / target);

export function sectors(g: GameState, ci: number): Sector[] {
  const c = g.countries[ci];
  const s = STATS[ci];
  const n = s.counts;

  const gross = s.taxIncome + s.factoryIncome + s.portIncome + s.tradeIncome + s.corpIncome + s.investIncome;
  const margin = c.money < 0 || gross <= 0 ? 0 : s.moneyRate / gross;

  const next = Math.min(Infinity, ...availableTechs(g, ci).map((t) => techCost(g, ci, t.id)));
  const techDays = isFinite(next) ? next / Math.max(1e-9, s.brainsRate) : 0;

  const foodRatio = s.foodProd / Math.max(1, s.foodCons);
  const fill = s.popCap > 0 ? s.civPop / s.popCap : 0;
  const foodState = s.hunger > 0 ? 0 : Math.min(foodRatio / 1.15, (1 - fill) / 0.25);

  const th = assessThreat(g, ci);
  const threatened = th.danger > s.power * 0.25;

  return [
    {
      id: 'economy', icon: '💰', name: 'Казна',
      score: blend(margin / 0.6, s.coverage.factory, 1),
      note: `доход ${fmtRate(s.moneyRate)} · заводов ${n.factory}`,
      build: ['factory', 'port'],
    },
    {
      id: 'science', icon: '🧠', name: 'Наука',
      score: isFinite(next) ? blend((300 - techDays) / 240, s.coverage.university, 0.6) : 1,
      note: isFinite(next) ? `технология раз в ~${fmtDays(techDays)} · университетов ${n.university}` : 'все технологии изучены',
      build: ['university'],
    },
    {
      id: 'stability', icon: '⚖️', name: 'Стабильность',
      score: blend((c.stability - 20) / 55, s.coverage.temple, 0.6),
      note: `${c.stability.toFixed(0)}% · храмов ${n.temple}`,
      build: ['temple'],
    },
    {
      id: 'food', icon: '🌾', name: 'Еда и земля',
      score: blend(foodState, s.coverage.farm, 0.6),
      note: s.hunger > 0 ? `голод: не хватает ${Math.round(s.hunger * 100)}% еды`
        : fill > 0.9 ? `людям тесно: занято ${Math.round(fill * 100)}% места`
        : `урожай ${Math.round(foodRatio * 100)}% от нужд · ферм ${n.farm}`,
      build: ['farm'],
    },
    {
      id: 'growth', icon: '👥', name: 'Рост населения',
      score: blend((s.growthYear + 0.5) / 2, s.coverage.hospital, 0.6),
      note: `${s.growthYear >= 0 ? '+' : ''}${s.growthYear.toFixed(1)}% в год · больниц ${n.hospital}`,
      build: ['hospital'],
    },
    {
      id: 'defense', icon: '🛡️', name: 'Оборона',
      score: threatened ? blend(s.power / th.danger, s.coverage.fortress, 0.5) : 1,
      note: threatened ? `наша мощь ${fmt(s.power)} против угрозы ${fmt(th.danger)} · крепостей ${n.fortress}` : 'серьёзных угроз нет',
      build: ['fortress', 'barracks'],
    },
  ];
}

/** Лучшее место (или улучшение) для первого подходящего здания отрасли; null — строить негде. */
export function optionFor(g: GameState, ci: number, sector: Sector): Advice | null {
  for (const type of sector.build) {
    const opt = bestBuildOption(g, ci, type, true);
    if (opt) return { sector, type, ...opt };
  }
  return null;
}

/** Советы: самые слабые отрасли — первыми, по одному зданию на отрасль. */
export function advise(g: GameState, ci: number, list = sectors(g, ci), max = 3): Advice[] {
  const all = [...list].sort((a, b) => a.score - b.score);
  const out: Advice[] = [];
  for (const sec of all) {
    if (out.length >= max) break;
    // крепкие отрасли советуем, только если больше нечего
    if (sec.score >= 0.9 && out.length > 0) break;
    const a = optionFor(g, ci, sec);
    if (a) out.push(a);
  }
  return out;
}

export function applyAdvice(g: GameState, ci: number, a: Advice): string | null {
  return a.upgrade ? startUpgrade(g, ci, a.tile) : startBuild(g, ci, a.tile, a.type);
}

/** Запустить все советы, на которые хватает денег и мест. Возвращает число начатых строек. */
export function applyAllAdvice(g: GameState, ci: number): number {
  let started = 0;
  for (const a of advise(g, ci)) {
    const s = STATS[ci];
    if (s.constructing >= s.slots) break;
    // после каждой стройки цены и лучшие клетки меняются — пересчитываем
    const fresh = optionFor(g, ci, a.sector);
    if (!fresh || g.countries[ci].money < fresh.cost) continue;
    if (!applyAdvice(g, ci, fresh)) started++;
  }
  return started;
}
