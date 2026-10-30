import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { enemiesOf } from '../../game/actions';
import { TECHS } from '../../game/defs';
import { STATS } from '../../game/economy';
import { fmt } from '../../game/format';
import {
  BLAST, FLIGHT_DAYS, HBOMB_DAYS, hasBomb, hbombsOf, interceptChance, isNuclear, isThermo, launchNuke, NUKE_DAYS, nukeBuildError,
  nukeCost, nukesOf, startNuke, strikeError, THERMO_SPILL, THERMO_TECH,
} from '../../game/nuclear';
import { sessionPreview } from '../../game/session';
import { getGame } from '../../game/state';
import type { GameState, Missile } from '../../game/types';
import { COUNTRY_DEFS, REGIONS } from '../../game/world';
import type { MapView } from '../../map/MapView';
import { Bar, Card, Flag, KV, Seg } from '../common';
import { report, setUI } from '../store';

const ATOM = TECHS.filter((t) => t.branch === 'Атом');
type Warhead = 'atom' | 'thermo';

/** Вкладка «Армия»: ядерная программа — путь исследований, арсенал, удары, ядерный клуб. */
export function NuclearCard({ map }: { map: MapView }) {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const [chosen, setChosen] = useState<Warhead | null>(null);
  const club = g.countries.map((_, i) => i).filter((i) => i !== me && (isNuclear(g, i) || g.countries[i].nukeBuild));
  const inbound = g.missiles.filter((m) => g.regions[m.region].owner === me);
  const outbound = g.missiles.filter((m) => m.from === me);

  if (!hasBomb(g, me)) {
    const known = ATOM.filter((t) => c.techs.includes(t.id)).length;
    return (
      <Card title="☢️ Ядерная программа" sub={`изучено ${known} из ${ATOM.length}`}>
        <AtomPath g={g} />
        <div class="small muted" style={{ margin: '8px 0' }}>Изучите ветку «Атом»: после «Атомной бомбы» здесь откроется сборка боеголовок, а после «Термоядерной бомбы» — сборка бомб в десятки раз мощнее. Ядерную державу боты боятся трогать.</div>
        <button class="btn block" onClick={() => setUI({ tab: 'policy', policyTab: 'science' })}>🔬 К исследованиям</button>
        <InboundAlert g={g} list={inbound} />
        <Club g={g} list={club} />
      </Card>
    );
  }

  const n = nukesOf(g, me);
  const h = hbombsOf(g, me);
  const thermoKnown = isThermo(g, me);
  // чем бить: выбор игрока, а если его нет на складе — то, что есть (термоядерная мощнее)
  const warhead: Warhead = chosen === 'thermo' && h > 0 ? 'thermo' : chosen === 'atom' && n > 0 ? 'atom' : h > 0 ? 'thermo' : 'atom';
  const thermo = warhead === 'thermo';
  const b = thermo ? BLAST.thermo : BLAST.atomic;
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
        okText: thermo ? '💥 Пуск' : '🚀 Пуск',
        title: `${thermo ? '💥 Термоядерный' : '☢️ Ядерный'} удар: ${REGIONS[rid].name}`,
        text: `Погибнет около ${fmt(pop * b.kill)} человек, до ${Math.round(b.ruin * 100)}% зданий будут разрушены, регион останется заражённым ${b.fallout} дней. `
          + (thermo ? `Радиация накроет и соседние регионы (−${Math.round(THERMO_SPILL.kill * 100)}% населения, заражение ${THERMO_SPILL.fallout} дн.) — даже если они наши. ` : '')
          + 'Весь мир осудит вас: отношения со всеми странами упадут, стабильность тоже.'
          + (isNuclear(g, owner) ? ` У страны ${COUNTRY_DEFS[owner].name} есть ядерное оружие — она ответит ударом на удар.` : '')
          + (shield > 0 ? ` ПРО противника может сбить ракету (${Math.round(shield * 100)}%).` : '')
          + ` ${sessionPreview(g, 'nukestrike', me, owner)}`,
        ok: () => {
          const err = launchNuke(g, me, rid, false, thermo);
          report(err);
          if (!err) map.focusTile(REGIONS[rid].center, 1.3);
        },
      },
    });
  };

  return (
    <Card title="☢️ Ядерный арсенал" sub={h ? `${n} + 💥${h}` : `${n}`}>
      <div class="warheads">
        {n + h === 0 ? <span class="small muted">Боеголовок пока нет</span> : (
          <>
            {Array.from({ length: Math.min(h, 8) }, (_, i) => <span key={`h${i}`} class="wh hb" title="Термоядерная бомба">💥</span>)}
            {h > 8 && <span class="small">+{h - 8}</span>}
            {Array.from({ length: Math.min(n, 12) }, (_, i) => <span key={`a${i}`} class="wh" title="Атомная боеголовка">☢️</span>)}
            {n > 12 && <span class="small">+{n - 12}</span>}
          </>
        )}
      </div>
      <KV rows={[
        ['☢️ Атомных боеголовок', <b class="num">{n}</b>],
        ...(thermoKnown ? [['💥 Термоядерных бомб', <b class="num">{h}</b>] as [string, ComponentChildren]] : []),
        ['Мощность', thermoKnown ? '☢️ ≈ 15 кт · 💥 ≈ 1–50 Мт' : '≈ 15 кт, как над Хиросимой'],
        ['Гибель в регионе', thermoKnown
          ? `☢️ ${Math.round(BLAST.atomic.kill * 100)}% · 💥 ${Math.round(BLAST.thermo.kill * 100)}% и соседи −${Math.round(THERMO_SPILL.kill * 100)}%`
          : `${Math.round(BLAST.atomic.kill * 100)}% населения`],
        ['Сдерживание', n + h > 0 ? <span class="up">боты в 2,5 раза реже нападают</span> : <span class="muted">нужна хотя бы одна боеголовка</span>],
      ]} />
      <div class="sep" />
      {c.nukeBuild ? (
        <div>
          <div class="row between small"><span>{c.nukeBuild.thermo ? '💥 Сборка термоядерной бомбы' : '☢️ Сборка боеголовки'}</span><span class="muted">{Math.ceil(c.nukeBuild.left)} дн.</span></div>
          <div class="nuke-bar"><Bar value={1 - c.nukeBuild.left / c.nukeBuild.total} /></div>
        </div>
      ) : (
        <div class="col">
          <BuildButton thermo={false} />
          {thermoKnown ? <BuildButton thermo /> : (
            <div class="hbomb-lock">
              <span class="big-ic">💥</span>
              <div class="grow small">
                <b>Термоядерная бомба</b>
                <div class="muted">Изучите «{TECHS.find((t) => t.id === THERMO_TECH)!.name}» в ветке «Атом» — откроется сборка бомб, которые стирают регион и заражают соседние.</div>
              </div>
              <button class="btn sm" onClick={() => setUI({ tab: 'policy', policyTab: 'science' })}>🔬</button>
            </div>
          )}
        </div>
      )}
      <InboundAlert g={g} list={inbound} />
      {outbound.length > 0 && (
        <>
          <div class="sep" />
          {outbound.map((m) => (
            <div class="list-item" key={m.id}>
              <span class="big-ic missile-ic">{m.thermo ? '💥' : '🚀'}</span>
              <div class="grow">
                <b>{REGIONS[m.region].name}</b>
                <div class="small muted">{m.thermo ? 'термоядерная · ' : ''}подлёт через {Math.max(0, m.arrive - g.day)} дн.</div>
                <Bar value={(g.day - m.launch) / FLIGHT_DAYS} color="red" />
              </div>
            </div>
          ))}
        </>
      )}
      <div class="sep" />
      <div class="small muted" style={{ marginBottom: '4px' }}>🎯 Цели для удара</div>
      {n > 0 && h > 0 && (
        <div style={{ marginBottom: '6px' }}>
          <Seg<Warhead> value={warhead} onChange={setChosen} options={[{ v: 'thermo', label: `💥 Термоядерная (${h})` }, { v: 'atom', label: `☢️ Атомная (${n})` }]} />
        </div>
      )}
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
            <button class="btn sm danger" disabled={!!strikeError(g, me, rid, thermo)} onClick={() => strike(rid, owner)}>{thermo ? '💥 Удар' : '🚀 Удар'}</button>
          </div>
        );
      })}
      <Club g={g} list={club} />
    </Card>
  );
}

/** Кнопка сборки: атомная боеголовка или термоядерная бомба. */
function BuildButton({ thermo }: { thermo: boolean }) {
  const g = getGame()!;
  const me = g.player;
  const cost = nukeCost(g, me, thermo);
  const err = nukeBuildError(g, me, thermo);
  const c = g.countries[me];
  // первая бомба взорвётся на полигоне — и ООН соберёт чрезвычайную сессию
  const test = thermo ? !c.hbombTested : !c.nukeTested;
  return (
    <>
      <button class={`btn block nuke-build ${thermo ? 'danger' : ''}`} disabled={!!err} onClick={() => report(startNuke(g, me, thermo))}>
        <span>{thermo ? '💥 Собрать термоядерную бомбу' : '☢️ Собрать атомную боеголовку'}</span>
        <span class="h">💰 {fmt(cost.money)} · 🧠 {fmt(cost.brains)} · {thermo ? HBOMB_DAYS : NUKE_DAYS} дн.</span>
      </button>
      {err && <div class="small muted">{err}</div>}
      {!err && test && <div class="small down">Первая бомба — испытание на полигоне. {sessionPreview(g, 'nuketest', me)}</div>}
    </>
  );
}

function AtomPath({ g }: { g: GameState }) {
  const c = g.countries[g.player];
  return (
    <div class="atom-path">
      {ATOM.map((t) => (
        <div key={t.id} class={`atom-step ${c.techs.includes(t.id) ? 'done' : ''}`}>
          <span class="ic">{t.icon}</span>
          <span class="nm">{t.name}</span>
        </div>
      ))}
    </div>
  );
}

function InboundAlert({ g, list }: { g: GameState; list: Missile[] }) {
  if (!list.length) return null;
  return (
    <div class="inbound">
      {list.map((m) => (
        <div key={m.id}>🚨 <b>{COUNTRY_DEFS[m.from].name}</b>: {m.thermo ? 'термоядерная ракета' : 'ракета'} летит на {REGIONS[m.region].name} — {Math.max(0, m.arrive - g.day)} дн.</div>
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
          <span class="num">☢️ {nukesOf(g, i)}{hbombsOf(g, i) > 0 && <> · 💥 {hbombsOf(g, i)}</>}</span>
          {g.countries[i].nukeBuild && <span class="muted">+ собирает</span>}
        </div>
      ))}
    </>
  );
}
