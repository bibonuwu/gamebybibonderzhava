import {
  annex, annexCost, annexError, atWar, attackError, buildCost, buildTime, demolish, placeError, reach, startBuild,
  startUpgrade, upgradeError,
} from '../game/actions';
import { BUILDINGS, BUILDING_TYPES, LEVEL_EFFECT } from '../game/defs';
import { REGION_FARM, regionDefense, regionWeight, STATS } from '../game/economy';
import { fmt } from '../game/format';
import { getGame } from '../game/state';
import { COUNTRY_DEFS, REGIONS, REGION_OF, isWater, terrainOf } from '../game/world';
import { inFallout } from '../game/nuclear';
import { Bar, Flag, RelBar, relText } from './common';
import { report, setUI, useStore } from './store';
import type { MapView } from '../map/MapView';

const TERRAIN_NAME: Record<string, string> = {
  o: '🌊 Океан', c: '🌊 Прибрежные воды', p: '🌾 Равнина', g: '🌿 Луга', f: '🌲 Лес', d: '🏜️ Пустыня', t: '🧊 Тундра', s: '❄️ Вечные льды', m: '⛰️ Горы',
};

export function TileSheet({ map }: { map: MapView }) {
  useStore();
  const g = getGame()!;
  const me = g.player;
  const tile = map.selectedTile;
  if (tile < 0) return null;
  const close = () => { setUI({ tile: -1 }); map.select(-1); };
  if (isWater(tile)) {
    return (
      <div class="sheet">
        <button class="close" onClick={close}>✕</button>
        <b>{TERRAIN_NAME[terrainOf(tile)]}</b>
        <div class="small muted">Морские пути. Постройте ⚓ порт на побережье, чтобы торговать и высаживаться с моря.</div>
      </div>
    );
  }
  const rid = REGION_OF[tile];
  const reg = REGIONS[rid];
  const rs = g.regions[rid];
  const owner = rs.owner;
  const c = g.countries[me];
  const mine = owner === me;
  const b = mine ? g.buildings[tile] : undefined; // чужие здания не показываем
  const isCenter = reg.center === tile;
  const cap = rs.cap0 * (1 + 0.15 * REGION_FARM[rid]) * (owner >= 0 ? STATS[owner].mods.cap : 1);
  const buildable = mine && !b && !isCenter ? BUILDING_TYPES.filter((t) => !placeError(g, me, tile, t)) : [];

  return (
    <div class="sheet">
      <button class="close" onClick={close}>✕</button>
      <div class="row" style={{ paddingRight: '40px' }}>
        <Flag id={owner} />
        <div class="grow">
          <div><b style={{ fontSize: '17px' }}>{reg.name}</b>{owner >= 0 && g.countries[owner].capital === rid && ' ★'}</div>
          <div class="small muted">
            {owner >= 0 ? COUNTRY_DEFS[owner].name : 'Нейтральные земли'} · {TERRAIN_NAME[terrainOf(tile)]}{isCenter ? ' · центр региона' : ''}
          </div>
        </div>
      </div>
      <div class="row small" style={{ marginTop: '8px', gap: '14px' }}>
        <span>👥 <b class="num">{fmt(rs.pop)}</b> <span class="muted">/ {fmt(cap)}</span></span>
        <span>🗺️ {reg.tiles.length} клеток</span>
        {owner !== me && <span>🛡️ оборона {fmt(regionDefense(g, rid).strength)}</span>}
      </div>
      <div style={{ marginTop: '6px' }}><Bar value={rs.pop / cap} /></div>
      {inFallout(g, rid) && (
        <div class="small fallout-note">☢️ Радиоактивное заражение ещё {Math.ceil(g.fallout[rid] - g.day)} дн.: люди болеют и уезжают</div>
      )}

      {b && (
        <div class="build-opt" style={{ marginTop: '10px' }}>
          <span class="big-ic">{BUILDINGS[b.type].icon}</span>
          <div class="grow">
            <b>{BUILDINGS[b.type].name}</b> · ур. {b.progress > 0 && b.level > 1 ? `${b.level - 1} → ${b.level}` : b.level}
            <div class="small muted">{BUILDINGS[b.type].desc}</div>
            {b.progress > 0 && <><div class="small">Строится: {Math.ceil(b.progress)} сек</div><Bar value={1 - b.progress / b.total} /></>}
          </div>
          {mine && b.progress === 0 && b.level < 3 && (
            <button class="btn sm" disabled={!!upgradeError(g, me, tile) || c.money < buildCost(g, me, b.type, b.level + 1, rid)} onClick={() => report(startUpgrade(g, me, tile), '⬆️ Улучшение началось')}>
              ⬆️ {fmt(buildCost(g, me, b.type, b.level + 1, rid))}
            </button>
          )}
        </div>
      )}
      {b && mine && b.progress === 0 && b.level < 3 && upgradeError(g, me, tile) && <div class="small muted">{upgradeError(g, me, tile)}</div>}
      {b && mine && (
        <button class="btn ghost sm" style={{ marginTop: '4px' }} onClick={() => setUI({ modal: { kind: 'confirm', title: 'Снести здание?', text: 'Деньги не вернутся.', danger: true, okText: 'Снести', ok: () => demolish(g, me, tile) } })}>🧨 Снести</button>
      )}

      {buildable.length > 0 && (
        <div style={{ marginTop: '10px' }}>
          <div class="small muted" style={{ marginBottom: '6px' }}>Построить здесь · мест для стройки {STATS[me].slots - STATS[me].constructing} из {STATS[me].slots}</div>
          {buildable.map((t) => {
            const cost = buildCost(g, me, t, 1, rid);
            const out = t === 'factory' ? 4 * LEVEL_EFFECT[1] * regionWeight(rs.pop) * c.baseProd * STATS[me].mods.factory : 0;
            return (
              <div class="build-opt" key={t}>
                <span class="big-ic">{BUILDINGS[t].icon}</span>
                <div class="grow">
                  <b>{BUILDINGS[t].name}</b>
                  <div class="small muted">{t === 'factory' ? `≈ +${fmt(out)} 💰/сек` : BUILDINGS[t].desc} · {buildTime(t, 1)} сек</div>
                </div>
                <button class="btn sm" disabled={c.money < cost || STATS[me].constructing >= STATS[me].slots} onClick={() => report(startBuild(g, me, tile, t), `🔨 ${BUILDINGS[t].name}: стройка началась`)}>
                  💰 {fmt(cost)}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {mine && !b && !isCenter && buildable.length === 0 && <div class="small muted" style={{ marginTop: '8px' }}>На этой клетке строить нечего — попробуйте соседнюю (заводы и университеты — ближе к центру региона).</div>}
      {mine && isCenter && <div class="small muted" style={{ marginTop: '8px' }}>Центр региона. Университеты и больницы ставятся на соседние клетки, заводы — до 2 клеток от центра.</div>}

      {owner === -1 && (
        <div class="grid2" style={{ marginTop: '10px' }}>
          <button class="btn green" disabled={!!annexError(g, me, rid)} onClick={() => report(annex(g, me, rid))}>🕊️ Присоединить {fmt(annexCost(g, me, rid))}</button>
          <button class="btn danger" disabled={!!attackError(g, me, rid)} onClick={() => setUI({ modal: { kind: 'attack', rid } })}>⚔️ Захватить</button>
        </div>
      )}
      {owner === -1 && !reach(g, me, rid) && <div class="small muted" style={{ marginTop: '6px' }}>Нет общей границы. Морем можно добраться, если рядом есть ваш порт.</div>}
      {owner >= 0 && owner !== me && (
        <>
          <div class="row small" style={{ marginTop: '10px', gap: '8px' }}>
            <span class="muted">Отношения:</span> <RelBar v={g.rel[me][owner]} /> <span>{relText(g.rel[me][owner])}</span>
          </div>
          <div class="grid2" style={{ marginTop: '8px' }}>
            <button class="btn ghost" onClick={() => setUI({ modal: { kind: 'country', id: owner } })}>🤝 Дипломатия</button>
            {atWar(g, me, owner) ? (
              <button class="btn danger" disabled={!!attackError(g, me, rid)} onClick={() => setUI({ modal: { kind: 'attack', rid } })}>⚔️ Атаковать</button>
            ) : (
              <button class="btn ghost" disabled>⚔️ Не в войне</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
