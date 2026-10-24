import { bestTileFor, buildCost, startBuild, startUpgrade, upgradeError } from '../../game/actions';
import { BUILDINGS, BUILDING_TYPES, TECH_BY_ID } from '../../game/defs';
import { STATS } from '../../game/economy';
import { fmt } from '../../game/format';
import { emit, getGame } from '../../game/state';
import {
  cancelWonder, rivals, startWonder, WONDER_BY_ID, wonderCost, wonderError, wonderOwner, wonderProgress, WONDERS,
} from '../../game/wonders';
import { COUNTRY_DEFS, REGIONS, REGION_OF } from '../../game/world';
import { Bar, Card, Flag } from '../common';
import { report, setUI, useStore } from '../store';
import type { MapView } from '../../map/MapView';

export function BuildPanel({ map }: { map: MapView }) {
  useStore();
  const g = getGame()!;
  const c = g.countries[g.player];
  const s = STATS[g.player];
  const mine = Object.entries(g.buildings)
    .map(([k, b]) => ({ tile: +k, b }))
    .filter(({ tile }) => g.regions[REGION_OF[tile]].owner === g.player);
  const building = mine.filter((x) => x.b.progress > 0);
  const upgradable = mine
    .filter((x) => !upgradeError(g, g.player, x.tile) || upgradeError(g, g.player, x.tile)?.startsWith('Одновременно'))
    .map((x) => ({ ...x, cost: buildCost(g, g.player, x.b.type, x.b.level + 1, REGION_OF[x.tile]) }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, 4);

  const show = (tile: number) => {
    setUI({ tab: 'map', tile });
    map.select(tile);
    map.focusTile(tile, 2);
  };

  return (
    <>
      <h2 class="ptitle">Стройка</h2>
      <Card title="🔨 Строится" sub={`${s.constructing} / ${s.slots} мест`}>
        {building.length === 0 && <div class="small muted">Сейчас ничего не строится.</div>}
        {building.map(({ tile, b }) => (
          <div class="list-item tap" key={tile} onClick={() => show(tile)}>
            <span class="big-ic">{BUILDINGS[b.type].icon}</span>
            <div class="grow">
              <div class="row between"><b>{BUILDINGS[b.type].name} ур. {b.level}</b><span class="small muted">{Math.ceil(b.progress)} сек</span></div>
              <div class="small muted">{REGIONS[REGION_OF[tile]].name}</div>
              <Bar value={1 - b.progress / b.total} />
            </div>
          </div>
        ))}
      </Card>
      <Card title="🏗️ Новые здания" sub={`💰 ${fmt(c.money)}`} hint="Кнопка с ценой сама выберет лучшее место. Можно и вручную: нажмите на клетку своей страны на карте.">
        {BUILDING_TYPES.map((type) => {
          const def = BUILDINGS[type];
          const tile = bestTileFor(g, g.player, type);
          const cost = tile >= 0 ? buildCost(g, g.player, type, 1, REGION_OF[tile]) : 0;
          const full = s.constructing >= s.slots;
          return (
            <div class="list-item" key={type}>
              <span class="big-ic">{def.icon}</span>
              <div class="grow">
                <div><b>{def.name}</b> <span class="muted small">· есть {s.counts[type]}</span></div>
                <div class="small muted">{def.desc}</div>
                {tile < 0 && <div class="small muted">{def.where}</div>}
              </div>
              <button
                class="btn sm"
                disabled={tile < 0 || full || c.money < cost}
                onClick={() => {
                  const err = startBuild(g, g.player, tile, type);
                  report(err, err ? undefined : `🔨 ${def.name}: стройка началась — ${REGIONS[REGION_OF[tile]].name}`);
                }}
              >
                {tile < 0 ? 'Нет места' : `💰 ${fmt(cost)}`}
              </button>
            </div>
          );
        })}
      </Card>
      <Wonders />
      <Card title="⬆️ Улучшения" hint="Уровни 2 и 3 открываются технологиями во вкладке «Политика → Наука».">
        {upgradable.length === 0 && <div class="small muted">Пока нечего улучшать.</div>}
        {upgradable.map(({ tile, b, cost }) => (
          <div class="list-item" key={tile}>
            <span class="big-ic">{BUILDINGS[b.type].icon}</span>
            <div class="grow tap" onClick={() => show(tile)}>
              <div><b>{BUILDINGS[b.type].name}</b> ур. {b.level} → {b.level + 1}</div>
              <div class="small muted">{REGIONS[REGION_OF[tile]].name}</div>
            </div>
            <button class="btn sm" disabled={c.money < cost || s.constructing >= s.slots} onClick={() => report(startUpgrade(g, g.player, tile), `⬆️ Улучшение началось`)}>
              💰 {fmt(cost)}
            </button>
          </div>
        ))}
      </Card>
      <Card title="📖 Уровни зданий" fold="build-levels">
        {BUILDING_TYPES.map((type) => {
          const def = BUILDINGS[type];
          return (
            <div class="small" key={type} style={{ marginBottom: '3px' }}>
              {def.icon} <b>{def.name}</b>: ур. 2 — {TECH_BY_ID[def.techFor[2]].name}{c.techs.includes(def.techFor[2]) ? ' ✓' : ''}, ур. 3 — {TECH_BY_ID[def.techFor[3]].name}{c.techs.includes(def.techFor[3]) ? ' ✓' : ''}
            </div>
          );
        })}
      </Card>
    </>
  );
}

function Wonders() {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const proj = c.project;
  const pw = proj ? WONDER_BY_ID[proj.id] : null;
  const projRivals = proj ? rivals(g, me, proj.id) : [];
  return (
    <Card title="🏛️ Чудеса света" sub={proj && pw ? `${pw.icon} ${Math.round(wonderProgress(g, me) * 100)}%` : `${Object.keys(g.wonders).length} из ${WONDERS.length}`} fold="build-wonders"
      hint="Каждое чудо существует в одном экземпляре на весь мир. Опередил соперник — вернётся половина вложений. Чудо стоит в столице: кто захватит регион, тот его и получит.">
      {proj && pw && (
        <div class="list-item wonder-now">
          <span class="big-ic">{pw.icon}</span>
          <div class="grow">
            <div class="row between"><b>{pw.name}</b><span class="small muted">{Math.ceil(proj.left)} дн.</span></div>
            <Bar value={wonderProgress(g, me)} />
            {projRivals.length > 0 && (
              <div class="small down" style={{ marginTop: '3px' }}>
                ⚠️ Гонка: {projRivals.map((r) => `${COUNTRY_DEFS[r.ci].name} ${Math.round(r.pct * 100)}%`).join(', ')}
              </div>
            )}
          </div>
          <button
            class="btn sm ghost" aria-label="Отменить проект"
            onClick={() => setUI({ modal: { kind: 'confirm', title: 'Отменить проект?', text: 'Вернётся половина вложенных денег и интеллекта.', danger: true, okText: 'Отменить', ok: () => { cancelWonder(g, me); emit(); } } })}
          >
            ✕
          </button>
        </div>
      )}
      {WONDERS.map((w) => {
        const built = g.wonders[w.id];
        const owner = built ? wonderOwner(g, w.id) : -1;
        const cost = wonderCost(g, me, w.id);
        const err = wonderError(g, me, w.id);
        const rv = built ? [] : rivals(g, me, w.id);
        return (
          <div class="list-item" key={w.id} style={{ opacity: built && owner !== me ? 0.55 : 1 }}>
            <span class="big-ic">{w.icon}</span>
            <div class="grow">
              <div>
                <b>{w.name}</b>
                {built && (owner === me ? <span class="small up"> · ваше</span> : owner >= 0 ? <span class="small"> · <Flag id={owner} /> {COUNTRY_DEFS[owner].name}</span> : null)}
              </div>
              <div class="small muted">{w.desc}</div>
              {!built && (
                <div class="small muted">
                  {w.days} дн.{w.tech ? ` · нужна «${TECH_BY_ID[w.tech].name}»${c.techs.includes(w.tech) ? ' ✓' : ''}` : ''}
                  {rv.length > 0 && <span class="down"> · строят: {rv.map((r) => COUNTRY_DEFS[r.ci].name).join(', ')}</span>}
                </div>
              )}
            </div>
            {!built && proj?.id !== w.id && (
              <button class="btn sm wonder-btn" disabled={!!err} title={err ?? undefined} onClick={() => report(startWonder(g, me, w.id))}>
                <span>💰 {fmt(cost.money)}</span>
                <span>🧠 {fmt(cost.brains)}</span>
              </button>
            )}
          </div>
        );
      })}
    </Card>
  );
}
