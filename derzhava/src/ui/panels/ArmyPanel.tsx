import { useState } from 'preact/hooks';
import {
  armyLimit, atWar, attackError, disband, enemiesOf, launchAttack, peaceTerms, peekPair, proposePeace, reachableTargets, recruit,
  recruitCost, soldiersFor, winChance,
} from '../../game/actions';
import { BATTLE_DAYS, BUDGET_INFO, BUDGET_LEVELS } from '../../game/defs';
import { computeAll, equipFactor, regionDefense, STATS } from '../../game/economy';
import { fmt, fmtDays } from '../../game/format';
import { emit, getGame, toast } from '../../game/state';
import { victimsOf } from '../../game/un';
import { COUNTRY_DEFS, REGIONS } from '../../game/world';
import { Bar, Card, Flag, KV, More, Rate, Seg } from '../common';
import { NuclearCard } from './NuclearCard';
import { report, setUI, useStore } from '../store';
import type { MapView } from '../../map/MapView';

export function ArmyPanel({ map }: { map: MapView }) {
  useStore();
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const s = STATS[me];
  const enemies = enemiesOf(g, me);
  const myBattles = g.battles.filter((b) => b.att === me || b.def === me);
  const targets = reachableTargets(g, me)
    .map((t) => ({ ...t, def: regionDefense(g, t.rid), need: soldiersFor(g, me, t.rid, 0.75) }))
    .sort((a, b) => a.need - b.need)
    .slice(0, 6);
  const limit = armyLimit(g, me);
  const steps = [0.001, 0.005, 0.01].map((k) => Math.floor(s.civPop * k));
  return (
    <>
      <Card title="💂 Вооружённые силы" sub={`мощь ⚔️ ${fmt(s.power)}`} hint="Контракт: сильнее и дороже. Призыв: дёшево и много, но хуже качество и злит людей. Военный бюджет поднимает мораль.">
        <KV rows={[
          ['Солдат', `${fmt(c.soldiers)} / ${fmt(limit)}`],
          ['🔫 Оснащение', <span class={s.equip < 0.95 ? 'down' : s.equip > 1.05 ? 'up' : ''}>{Math.round(s.equip * 100)}%</span>],
          ['Содержание', <Rate v={-s.upkeepArmy} />],
        ]} />
        <More>
          <KV rows={[
            ['🔧 Вооружение', `×${s.weapons.toFixed(2)}`],
            ['🔫 Сила от оснащения', `×${equipFactor(s.equip).toFixed(2)}`],
            ['💪 Мораль', `×${s.morale.toFixed(2)}`],
            ['🎖️ Качество', `×${s.quality.toFixed(2)} (${c.armyType === 'contract' ? 'контракт' : 'призыв'})`],
            ['Усталость от войны', `${c.weariness.toFixed(0)}%`],
          ]} />
        </More>
        <div class="sep" />
        <div class="small muted" style={{ marginBottom: '4px' }}>Тип армии</div>
        <Seg
          value={c.armyType}
          onChange={(v) => { c.armyType = v; computeAll(g); emit(); }}
          options={[{ v: 'contract', label: '🎖️ Контракт' }, { v: 'conscript', label: '📋 Призыв' }]}
        />
        <div class="small muted" style={{ margin: '10px 0 4px' }}>{BUDGET_INFO.military.icon} Военный бюджет</div>
        <Seg value={c.budget.military} onChange={(v) => { c.budget.military = v; computeAll(g); emit(); }} options={BUDGET_LEVELS.map((l, i) => ({ v: i, label: l }))} />
      </Card>
      <Card title="📣 Набор" sub={`💰 ${fmt(c.money)}`}>
        <div class="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          {steps.map((n) => (
            <button key={n} class="btn sm" style={{ flexDirection: 'column', gap: 0 }} disabled={n < 1 || c.money < recruitCost(g, me, n) || c.soldiers + n > limit} onClick={() => report(recruit(g, me, n), `💂 Призвано ${fmt(n)} солдат`)}>
              <span>+{fmt(n)}</span>
              <span class="small" style={{ fontWeight: 400 }}>💰 {fmt(recruitCost(g, me, n))}</span>
            </button>
          ))}
        </div>
        <button class="btn ghost block" style={{ marginTop: '8px' }} disabled={c.soldiers < 10} onClick={() => { disband(g, me, c.soldiers * 0.1); toast('Часть армии распущена по домам', 'info'); emit(); }}>
          Распустить 10% армии
        </button>
        <button class="btn ghost block" style={{ marginTop: '8px' }} onClick={() => setUI({ tab: 'market', marketTab: 'arms' })}>
          🏪 Купить или продать оружие{s.equip < 0.95 ? ' — новобранцам не хватает!' : ''}
        </button>
      </Card>
      <NuclearCard map={map} />
      {enemies.length > 0 && (
        <Card title="🔥 Войны">
          {enemies.map((e) => {
            const p = peekPair(g, me, e);
            return (
              <div class="list-item" key={e}>
                <Flag id={e} />
                <div class="grow tap" onClick={() => setUI({ modal: { kind: 'country', id: e } })}>
                  <b>{COUNTRY_DEFS[e].name}</b>
                  <div class="small muted">идёт {fmtDays(g.day - (p.war?.since ?? g.day))} · их мощь ⚔️ {fmt(STATS[e].power)}</div>
                </div>
                <PeaceButton enemy={e} />
              </div>
            );
          })}
        </Card>
      )}
      {myBattles.length > 0 && (
        <Card title="⚔️ Сражения">
          {myBattles.map((b) => (
            <div class="list-item" key={b.id}>
              <span class="big-ic">{b.att === me ? '🗡️' : '🛡️'}</span>
              <div class="grow">
                <div class="row between">
                  <b>{REGIONS[b.region].name}</b>
                  <span class="small muted">{Math.max(0, Math.ceil(b.end - g.day))} сек</span>
                </div>
                <div class="small muted">
                  {b.att === me ? `Наступаем: ${fmt(b.soldiers)} солдат против ${b.def >= 0 ? COUNTRY_DEFS[b.def].name : 'местного ополчения'}` : `Наступает ${COUNTRY_DEFS[b.att].name}: ${fmt(b.soldiers)} солдат`}
                </div>
                <Bar value={(g.day - b.start) / BATTLE_DAYS} color={b.att === me ? undefined : 'red'} />
              </div>
            </div>
          ))}
        </Card>
      )}
      <Card title="🎯 Цели" hint="Враги и нейтральные земли рядом. Чтобы напасть на страну, сначала объявите ей войну на соседней вкладке «Дипломатия». Порт позволяет высаживаться с моря.">
        {targets.length === 0 && <div class="small muted">Нет доступных целей.</div>}
        {targets.map((t) => (
          <div class="list-item" key={t.rid}>
            <Flag id={t.owner} />
            <div class="grow tap" onClick={() => { const tile = REGIONS[t.rid].center; setUI({ tab: 'map', tile }); map.select(tile); map.focusTile(tile, 1.8); }}>
              <b>{REGIONS[t.rid].name}</b>
              <div class="small muted">
                {t.owner >= 0 ? COUNTRY_DEFS[t.owner].name : 'нейтральные'}{t.via === 'sea' ? ' · ⛵ морем' : ''} · нужно ~{fmt(t.need)} солдат
              </div>
            </div>
            <button class="btn sm danger" disabled={!!attackError(g, me, t.rid)} onClick={() => setUI({ modal: { kind: 'attack', rid: t.rid } })}>Атака</button>
          </div>
        ))}
      </Card>
      <Card title="📜 Военная хроника" fold="army-log">
        {g.log.filter((l) => !l.world).filter((l) => l.kind === 'war' || l.text.includes('⚔️') || l.text.includes('🛡️') || l.text.includes('🏆') || l.text.includes('💥')).slice(0, 12).map((l, i) => (
          <div class="small" key={i} style={{ marginBottom: '3px' }}><span class="muted">д.{l.day}</span> {l.text}</div>
        ))}
      </Card>
    </>
  );
}

/** Мир даром, за выкуп или «не хотят» — по оценке противника. */
export function PeaceButton({ enemy, block }: { enemy: number; block?: boolean }) {
  const g = getGame()!;
  const t = peaceTerms(g, g.player, enemy);
  const cls = `btn green ${block ? 'block' : 'sm'}`;
  if (peekPair(g, g.player, enemy).war?.un === g.player) {
    const v = victimsOf(g, g.player).map((x) => COUNTRY_DEFS[x].name).join(', ');
    return <button class={cls} disabled>🌐 Коалиция ООН: сначала мир с {v || 'жертвой'}</button>;
  }
  if (t === null) return <button class={cls} disabled>🕊️ Мира не хотят</button>;
  const ask = () => {
    const msg = proposePeace(g, g.player, enemy, t > 0);
    if (atWar(g, g.player, enemy)) toast(msg, 'bad');
    emit();
  };
  if (t === 0) return <button class={cls} onClick={ask}>🕊️ Мир</button>;
  return (
    <button class={cls} disabled={g.countries[g.player].money < t} onClick={ask}>
      🕊️ Мир за 💰 {fmt(t)}
    </button>
  );
}

export function AttackDialog({ rid }: { rid: number }) {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const need = soldiersFor(g, me, rid, 0.75);
  const [n, setN] = useState(Math.min(c.soldiers, Math.max(1, need)));
  const owner = g.regions[rid].owner;
  const chance = winChance(g, me, rid, n);
  const err = attackError(g, me, rid);
  const def = regionDefense(g, rid);
  return (
    <>
      <div class="m-ic">⚔️</div>
      <h2>{REGIONS[rid].name}</h2>
      <p class="small muted">{owner >= 0 ? `Владелец: ${COUNTRY_DEFS[owner].name}` : 'Нейтральные земли'} · защитников ~{fmt(def.garrison)} · население {fmt(g.regions[rid].pop)}</p>
      <div class="card">
        <div class="row between"><span>Отправить солдат</span><b class="num">{fmt(n)}</b></div>
        <input type="range" min={1} max={Math.max(1, Math.floor(c.soldiers))} step={Math.max(1, Math.floor(c.soldiers / 200))} value={n} onInput={(e) => setN(+(e.currentTarget as HTMLInputElement).value)} />
        <div class="row between small"><span class="muted">свободно {fmt(c.soldiers)}</span><span class="muted">рекомендуется {fmt(need)}</span></div>
        <div class="sep" />
        <div class="row between"><span>Шанс победы</span><b class={`num ${chance >= 0.6 ? 'up' : chance < 0.4 ? 'down' : ''}`}>{Math.round(chance * 100)}%</b></div>
        <div style={{ marginTop: '6px' }}><Bar value={chance} color={chance >= 0.6 ? 'green' : chance < 0.4 ? 'red' : undefined} /></div>
      </div>
      {err && <p class="small down">{err}</p>}
      <div class="grid2">
        <button class="btn ghost" onClick={() => setUI({ modal: null })}>Отмена</button>
        <button class="btn danger" disabled={!!err || n < 1} onClick={() => { const e = launchAttack(g, me, rid, n); report(e, e ? undefined : `🗡️ Наступление на ${REGIONS[rid].name} началось`); if (!e) setUI({ modal: null }); }}>
          В атаку!
        </button>
      </div>
    </>
  );
}
