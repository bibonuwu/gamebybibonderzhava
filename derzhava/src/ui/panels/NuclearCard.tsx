import { enemiesOf } from '../../game/actions';
import { TECHS } from '../../game/defs';
import { STATS } from '../../game/economy';
import { fmt } from '../../game/format';
import {
  BLAST, FLIGHT_DAYS, hasBomb, interceptChance, isNuclear, isThermo, launchNuke, NUKE_DAYS, nukeBuildError, nukeCost, nukesOf,
  startNuke, strikeError,
} from '../../game/nuclear';
import { getGame } from '../../game/state';
import type { GameState, Missile } from '../../game/types';
import { COUNTRY_DEFS, REGIONS } from '../../game/world';
import type { MapView } from '../../map/MapView';
import { Bar, Card, Flag, KV } from '../common';
import { report, setUI } from '../store';

const ATOM = TECHS.filter((t) => t.branch === 'Атом');

/** Вкладка «Армия»: ядерная программа — путь исследований, арсенал, удары, ядерный клуб. */
export function NuclearCard({ map }: { map: MapView }) {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const club = g.countries.map((_, i) => i).filter((i) => i !== me && (isNuclear(g, i) || g.countries[i].nukeBuild));
  const inbound = g.missiles.filter((m) => g.regions[m.region].owner === me);
  const outbound = g.missiles.filter((m) => m.from === me);

  if (!hasBomb(g, me)) {
    const known = ATOM.filter((t) => c.techs.includes(t.id)).length;
    return (
      <Card title="☢️ Ядерная программа" sub={`изучено ${known} из ${ATOM.length}`}>
        <div class="atom-path">
          {ATOM.map((t) => (
            <div key={t.id} class={`atom-step ${c.techs.includes(t.id) ? 'done' : ''}`}>
              <span class="ic">{t.icon}</span>
              <span class="nm">{t.name}</span>
            </div>
          ))}
        </div>
        <div class="small muted" style={{ margin: '8px 0' }}>Изучите ветку «Атом»: после «Атомной бомбы» здесь откроется сборка боеголовок. Ядерную державу боты боятся трогать.</div>
        <button class="btn block" onClick={() => setUI({ tab: 'policy', policyTab: 'science' })}>🔬 К исследованиям</button>
        <InboundAlert g={g} list={inbound} />
        <Club g={g} list={club} />
      </Card>
    );
  }

  const n = nukesOf(g, me);
  const thermo = isThermo(g, me);
  const b = thermo ? BLAST.thermo : BLAST.atomic;
  const cost = nukeCost(g, me);
  const buildErr = nukeBuildError(g, me);
  const targets = enemiesOf(g, me)
    .flatMap((e) => STATS[e].regions.map((rid) => ({ rid, owner: e })))
    .sort((x, y) => g.regions[y.rid].pop - g.regions[x.rid].pop)
    .slice(0, 6);

  const strike = (rid: number, owner: number) => {
    const shield = interceptChance(g, owner);
    const pop = g.regions[rid].pop;
    setUI({
      modal: {
        kind: 'confirm',
        danger: true,
        okText: '🚀 Пуск',
        title: `☢️ Ядерный удар: ${REGIONS[rid].name}`,
        text: `Погибнет около ${fmt(pop * b.kill)} человек, до ${Math.round(b.ruin * 100)}% зданий будут разрушены, регион останется заражённым ${b.fallout} дней. `
          + 'Весь мир осудит вас: отношения со всеми странами упадут, стабильность тоже.'
          + (isNuclear(g, owner) ? ` У страны ${COUNTRY_DEFS[owner].name} есть ядерное оружие — она ответит ударом на удар.` : '')
          + (shield > 0 ? ` ПРО противника может сбить ракету (${Math.round(shield * 100)}%).` : ''),
        ok: () => {
          const err = launchNuke(g, me, rid);
          report(err);
          if (!err) map.focusTile(REGIONS[rid].center, 1.3);
        },
      },
    });
  };

  return (
    <Card title="☢️ Ядерный арсенал" sub={thermo ? 'термоядерные' : 'атомные'}>
      <div class="warheads">
        {n === 0 ? <span class="small muted">Боеголовок пока нет</span> : Array.from({ length: Math.min(n, 12) }, (_, i) => <span key={i} class="wh">☢️</span>)}
        {n > 12 && <span class="small">+{n - 12}</span>}
      </div>
      <KV rows={[
        ['Готово боеголовок', <b class="num">{n}</b>],
        ['Мощность', thermo ? '≈ 1 Мт, термоядерная' : '≈ 15 кт, как над Хиросимой'],
        ['Гибель в регионе', `${Math.round(b.kill * 100)}% населения`],
        ['Сдерживание', n > 0 ? <span class="up">боты в 2,5 раза реже нападают</span> : <span class="muted">нужна хотя бы одна боеголовка</span>],
      ]} />
      <div class="sep" />
      {c.nukeBuild ? (
        <div>
          <div class="row between small"><span>☢️ Сборка боеголовки</span><span class="muted">{Math.ceil(c.nukeBuild.left)} дн.</span></div>
          <div class="nuke-bar"><Bar value={1 - c.nukeBuild.left / c.nukeBuild.total} /></div>
        </div>
      ) : (
        <button class="btn block" disabled={!!buildErr} onClick={() => report(startNuke(g, me))}>
          ☢️ Собрать боеголовку · 💰 {fmt(cost.money)} · 🧠 {fmt(cost.brains)} · {NUKE_DAYS} дн.
        </button>
      )}
      {buildErr && !c.nukeBuild && <div class="small muted" style={{ marginTop: '4px' }}>{buildErr}</div>}
      <InboundAlert g={g} list={inbound} />
      {outbound.length > 0 && (
        <>
          <div class="sep" />
          {outbound.map((m) => (
            <div class="list-item" key={m.id}>
              <span class="big-ic missile-ic">🚀</span>
              <div class="grow">
                <b>{REGIONS[m.region].name}</b>
                <div class="small muted">подлёт через {Math.max(0, m.arrive - g.day)} дн.</div>
                <Bar value={(g.day - m.launch) / FLIGHT_DAYS} color="red" />
              </div>
            </div>
          ))}
        </>
      )}
      <div class="sep" />
      <div class="small muted" style={{ marginBottom: '4px' }}>🎯 Цели для удара</div>
      {targets.length === 0 && <div class="small muted">Удар возможен только по стране, с которой идёт война.</div>}
      {targets.map(({ rid, owner }) => {
        const shield = interceptChance(g, owner);
        return (
          <div class="list-item" key={rid}>
            <Flag id={owner} />
            <div class="grow">
              <b>{REGIONS[rid].name}</b>{g.countries[owner].capital === rid && ' ★'}
              <div class="small muted">
                {COUNTRY_DEFS[owner].name} · 👥 {fmt(g.regions[rid].pop)}{shield > 0 && ` · 🛰️ ПРО ${Math.round(shield * 100)}%`}{isNuclear(g, owner) && ' · ☢️ ответит'}
              </div>
            </div>
            <button class="btn sm danger" disabled={!!strikeError(g, me, rid)} onClick={() => strike(rid, owner)}>🚀 Удар</button>
          </div>
        );
      })}
      <Club g={g} list={club} />
    </Card>
  );
}

function InboundAlert({ g, list }: { g: GameState; list: Missile[] }) {
  if (!list.length) return null;
  return (
    <div class="inbound">
      {list.map((m) => (
        <div key={m.id}>🚨 <b>{COUNTRY_DEFS[m.from].name}</b>: ракета летит на {REGIONS[m.region].name} — {Math.max(0, m.arrive - g.day)} дн.</div>
      ))}
    </div>
  );
}

/** Разведка: кто ещё обладает бомбой или собирает её. */
function Club({ g, list }: { g: GameState; list: number[] }) {
  if (!list.length) return null;
  return (
    <>
      <div class="sep" />
      <div class="small muted" style={{ marginBottom: '4px' }}>🕵️ Ядерный клуб, по данным разведки</div>
      {list.map((i) => (
        <div class="row small" key={i} style={{ padding: '3px 0' }}>
          <Flag id={i} />
          <span class="grow">{COUNTRY_DEFS[i].name}</span>
          <span class="num">☢️ {nukesOf(g, i)}</span>
          {g.countries[i].nukeBuild && <span class="muted">+ собирает</span>}
        </div>
      ))}
    </>
  );
}
