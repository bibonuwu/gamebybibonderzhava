// Игровой тик: 1 секунда = 1 день.
import { checkAchievements } from './achievements';
import { cname, enemiesOf, resolveBattle } from './actions';
import { aiTurn, driftRelations, expireProposals } from './ai';
import { BUILDINGS, GOVS } from './defs';
import { computeAll, pairKey, REGION_DELTA, STATS, tradeWith } from './economy';
import { triggerEvent } from './events';
import { tickDebt } from './debt';
import { tickElections } from './elections';
import { tickLodge } from './lodge';
import { tickNuclear } from './nuclear';
import { tickMail } from './mail';
import { tickMarket } from './market';
import { triggerDemand } from './people';
import { checkQuests } from './quests';
import { tickSociety } from './society';
import { tickSpy } from './spy';
import { banner, fx, log, mapDirty, news, pick, sfx, toast } from './state';
import type { GameState, GovType, Sample } from './types';
import { tickUN } from './un';
import { tickWonders } from './wonders';
import { REGIONS, REGION_OF } from './world';

export function tick(g: GameState) {
  if (g.gameOver) return;
  computeAll(g);
  // сколько уже принесли торговые договоры игрока
  for (let j = 0; j < g.countries.length; j++) {
    const p = j === g.player ? undefined : g.pairs[pairKey(g.player, j)];
    if (p?.trade && g.countries[j].alive) p.earned = (p.earned ?? 0) + tradeWith(g, g.player, j);
  }

  g.countries.forEach((c, i) => {
    if (!c.alive) return;
    const s = STATS[i];
    c.money += s.moneyRate;
    c.brains += s.brainsRate;
    c.lastGross = s.taxIncome;
    c.stability = Math.max(0, Math.min(100, c.stability + (s.stabTarget - c.stability) * 0.03));
    if (enemiesOf(g, i).length) c.weariness = Math.min(100, c.weariness + 0.03 * GOVS[c.gov].weariness);
    else c.weariness = Math.max(0, c.weariness - 0.08);
    c.unrest *= 0.992;
    if (c.mods.length) c.mods = c.mods.filter((m) => m.until > g.day);
    // казна в глубоком минусе — солдаты дезертируют
    if (c.money < -Math.max(1000, s.taxIncome * 60)) c.soldiers *= 0.99;
    if (c.stability < 0.5 && g.day - c.govChangedDay > 60) revolution(g, i);
  });
  // запасы еды и оружия, рынок, учёные, миллиардеры, компании
  tickMarket(g);
  tickSociety(g);

  g.regions.forEach((r, id) => {
    r.pop = Math.max(1000, r.pop + REGION_DELTA[id]);
  });

  for (const key in g.buildings) {
    const b = g.buildings[+key];
    if (b.progress <= 0) continue;
    b.progress -= 1;
    if (b.progress <= 0) {
      b.progress = 0;
      mapDirty.buildings = true;
      if (g.regions[REGION_OF[+key]].owner === g.player) {
        sfx('done');
        fx({ kind: 'float', tile: +key, text: b.level > 1 ? '⬆️' : '✅' });
        toast(`✅ ${BUILDINGS[b.type].name}${b.level > 1 ? ` ур. ${b.level}` : ''} готов — ${REGIONS[REGION_OF[+key]].name}`, 'good');
      }
    }
  }

  const done = g.battles.filter((b) => b.end <= g.day);
  if (done.length) {
    g.battles = g.battles.filter((b) => b.end > g.day);
    computeAll(g);
    for (const b of done) resolveBattle(g, b);
  }

  tickWonders(g);
  tickNuclear(g);
  tickUN(g);
  tickLodge(g);
  tickDebt(g);
  tickSpy(g);
  tickElections(g);
  if (g.day % 5 === 0) driftRelations(g);
  for (let i = 0; i < g.countries.length; i++) {
    if (i !== g.player && g.countries[i].alive && (g.day + i) % 4 === 0) aiTurn(g, i);
  }
  expireProposals(g);
  if (g.day >= g.nextEventDay && !g.event) triggerEvent(g);
  if (g.day >= g.nextDemandDay && !g.event) triggerDemand(g);
  if (g.day % 5 === 0) checkAchievements(g);
  checkQuests(g);
  tickMail(g);

  g.day++;
  computeAll(g);
  if (g.day % 5 === 0) sample(g);
}

function revolution(g: GameState, i: number) {
  const c = g.countries[i];
  const options = (Object.keys(GOVS) as GovType[]).filter((k) => k !== c.gov);
  c.gov = pick(g, options);
  c.money *= c.money > 0 ? 0.7 : 1;
  c.stability = 35;
  c.tax = Math.min(c.tax, 0.15);
  c.govChangedDay = g.day;
  if (i === g.player) {
    sfx('revolution');
    log(g, `🔥 Революция! Новая форма правления: ${GOVS[c.gov].name}`, 'bad', false);
    banner({ icon: '🔥', title: 'Революция!', text: `Новая форма правления: ${GOVS[c.gov].name}`, kind: 'war' });
  } else news(g, `🔥 Революция в стране ${cname(g, i)}: теперь ${GOVS[c.gov].name}`, 'bad');
}

function sample(g: GameState) {
  const c = g.countries[g.player];
  const s = STATS[g.player];
  const x: Sample = { d: g.day, pop: s.civPop, money: c.money, brains: c.brains, mr: s.moneyRate, br: s.brainsRate, pr: s.popRate };
  g.hist.s.push(x);
  if (g.hist.s.length > 60) g.hist.s.shift();
  if (g.day % 60 === 0) {
    g.hist.m.push(x);
    if (g.hist.m.length > 60) g.hist.m.shift();
  }
  if (g.day % 120 === 0) {
    g.hist.l.push(x);
    if (g.hist.l.length > 240) g.hist.l = g.hist.l.filter((_, k) => k % 2 === 0);
  }
}
