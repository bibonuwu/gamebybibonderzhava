import {
  bestTileFor, buildCost, builderCost, builderError, builderLevel, startBuild, startUpgrade, upgradeBuilders, upgradeError, upgradeGrowth,
} from '../../game/actions';
import { advise, applyAdvice, applyAllAdvice, GAIN, GOOD, optionFor, sectors, WEAK } from '../../game/advisor';
import { BUILDER_NAMES, BUILDER_SPEED, BUILDERS_MAX, BUILDINGS, BUILDING_TYPES, FOOTPRINT, TECH_BY_ID } from '../../game/defs';
import { STATS } from '../../game/economy';
import { fmt, fmtTiles } from '../../game/format';
import { cancelMega, MEGA_BY_ID, megaError, megaNext, MEGAS, megaStages, startMega } from '../../game/megaprojects';
import { buildingSize, emit, getGame } from '../../game/state';
import {
  cancelWonder, rivals, startWonder, WONDER_BY_ID, wonderCost, wonderError, wonderOwner, wonderProgress, WONDERS,
} from '../../game/wonders';
import { COUNTRY_DEFS, REGIONS, REGION_OF } from '../../game/world';
import { Bar, Card, Flag } from '../common';
import { PanelHero } from '../PanelHero';
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
  const errs = mine.map((x) => upgradeError(g, g.player, x.tile));
  const upgradable = mine
    .filter((_, k) => !errs[k] || errs[k]!.startsWith('Одновременно'))
    .map((x) => ({ ...x, cost: buildCost(g, g.player, x.b.type, x.b.level + 1, REGION_OF[x.tile]), grow: upgradeGrowth(g, x.tile) }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, 4);
  // комплексы, которым некуда расти: вокруг всё занято
  const cramped = errs.filter((e) => e?.startsWith('Тесно')).length;

  const show = (tile: number) => {
    setUI({ tab: 'map', tile });
    map.select(tile);
    map.focusTile(tile, 2);
  };

  return (
    <>
      <PanelHero kind="build" />
      <Advisor show={show} />
      <Builders />
      <Card title="🔨 Строится" sub={`${s.constructing} / ${s.slots} мест`}>
        {building.length === 0 && <div class="small muted">Сейчас ничего не строится.</div>}
        {building.map(({ tile, b }) => (
          <div class="list-item tap" key={tile} onClick={() => show(tile)}>
            <span class="big-ic">{BUILDINGS[b.type].icon}</span>
            <div class="grow">
              <div class="row between"><b>{BUILDINGS[b.type].name} ур. {b.level}</b><span class="small muted">{Math.ceil(b.progress / s.buildSpeed)} сек</span></div>
              <div class="small muted">{REGIONS[REGION_OF[tile]].name} · {fmtTiles(buildingSize(b))}</div>
              <Bar value={1 - b.progress / b.total} />
            </div>
          </div>
        ))}
      </Card>
      <Card title="🏗️ Новые здания" sub={`💰 ${fmt(c.money)}`}
        hint={`Каждое здание — комплекс: сразу занимает ${fmtTiles(FOOTPRINT[1])} рядом, а каждое улучшение пристраивает ещё одну (до ${FOOTPRINT[3]}). Каждая клетка комплекса работает как отдельное здание. Земля ограничена — оставляйте место для роста. Кнопка с ценой сама выберет лучшее место; можно и вручную: нажмите на клетку своей страны на карте.`}>
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
                {tile < 0 && <div class="small muted">{def.where} — и {FOOTPRINT[1] - 1} свободная клетка рядом</div>}
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
      <Megaprojects />
      <Card title="⬆️ Улучшения" hint="Уровни 2 и 3 открываются технологиями во вкладке «Политика → Наука». Улучшение поднимает уровень всех клеток комплекса и пристраивает к нему ещё клетку — рядом должно быть свободно.">
        {upgradable.length === 0 && <div class="small muted">Пока нечего улучшать.</div>}
        {upgradable.map(({ tile, b, cost, grow }) => (
          <div class="list-item" key={tile}>
            <span class="big-ic">{BUILDINGS[b.type].icon}</span>
            <div class="grow tap" onClick={() => show(tile)}>
              <div><b>{BUILDINGS[b.type].name}</b> ур. {b.level} → {b.level + 1}</div>
              <div class="small muted">{REGIONS[REGION_OF[tile]].name} · {fmtTiles(buildingSize(b))}{grow > 0 && <span class="up"> +{grow}</span>}</div>
            </div>
            <button class="btn sm" disabled={c.money < cost || s.constructing >= s.slots} onClick={() => report(startUpgrade(g, g.player, tile), `⬆️ Улучшение началось`)}>
              💰 {fmt(cost)}
            </button>
          </div>
        ))}
        {cramped > 0 && (
          <div class="small muted" style={{ marginTop: '6px' }}>
            🧱 Тесно: {cramped} {cramped === 1 ? 'зданию' : 'зданиям'} некуда расти — вокруг всё занято. Снесите соседнее здание или присоедините новую землю.
          </div>
        )}
      </Card>
    </>
  );
}

/** Строители: уровень 1…10, каждый — ещё одна стройплощадка и стройка быстрее. */
function Builders() {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const s = STATS[me];
  const lvl = builderLevel(g, me);
  const max = lvl >= BUILDERS_MAX;
  const cost = builderCost(g, me);
  const err = builderError(g, me);
  const speed = (l: number) => Math.round(BUILDER_SPEED * (l - 1) * 100);
  return (
    <Card title="👷 Строители" sub={`ур. ${lvl} из ${BUILDERS_MAX}`}
      hint="Каждый новый уровень строителей даёт ещё одно место для стройки и ускоряет все стройки на 6%. Технологии и чудеса света добавляют места сверху.">
      <div class={`crew ${max ? 'max' : ''}`}>
        <div class="crew-head">
          <span class="crew-badge" key={lvl}><b>{lvl}</b></span>
          <div class="grow">
            <div class="crew-name">{BUILDER_NAMES[lvl]}</div>
            <div class="small muted">мест для стройки: <b class="up">{s.slots}</b> · скорость: <b class="up">+{speed(lvl)}%</b></div>
          </div>
        </div>
        <div class="crew-track" aria-label={`Уровень ${lvl} из ${BUILDERS_MAX}`}>
          {Array.from({ length: BUILDERS_MAX }, (_, i) => (
            <i key={i} class={i < lvl ? 'on' : i === lvl ? 'next' : ''} style={{ animationDelay: `${i * 0.04}s` }}>{i < lvl ? '👷' : i + 1}</i>
          ))}
        </div>
        {max ? (
          <div class="crew-done">🏆 Лучшие строители в мире — {BUILDER_NAMES[lvl]}</div>
        ) : (
          <div class="crew-next">
            <div class="grow small">
              <div>Дальше: <b>{BUILDER_NAMES[lvl + 1]}</b></div>
              <div class="muted">места {s.slots} → <b class="up">{s.slots + 1}</b> · скорость +{speed(lvl)}% → <b class="up">+{speed(lvl + 1)}%</b></div>
            </div>
            <button class="btn sm shine" disabled={!!err} title={err ?? undefined}
              onClick={() => report(upgradeBuilders(g, me), `👷 ${BUILDER_NAMES[lvl + 1]}: мест для стройки — ${STATS[me].slots}`)}>
              ⬆️ 💰 {fmt(cost)}
            </button>
          </div>
        )}
        {!max && c.money < cost && <div class="small muted" style={{ marginTop: '4px' }}>Не хватает {fmt(cost - c.money)} 💰</div>}
      </div>
    </Card>
  );
}

const level = (score: number) => (score < WEAK ? 'weak' : score < GOOD ? 'mid' : 'good');

/** Шкала отраслей страны: что ослаблено — и что построить, чтобы подтянуть. Клетку выбирать не нужно. */
function Advisor({ show }: { show: (tile: number) => void }) {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const s = STATS[me];
  const list = sectors(g, me);
  const advice = advise(g, me, list);
  const free = s.slots - s.constructing;
  const canAll = free > 0 && advice.some((a) => c.money >= a.cost);
  return (
    <Card title="🧭 Советник" sub={`мест для стройки ${free} из ${s.slots}`}
      hint="Шкала показывает, насколько крепка каждая сторона страны. Красное — ослаблено. Советник сам выберет лучшее место и предложит, что построить или улучшить.">
      <div class="adv-scales">
        {list.map((sec) => (
          <div class={`adv-row ${level(sec.score)}`} key={sec.id}>
            <span class="adv-name">{sec.icon} {sec.name}</span>
            <span class="adv-scale"><i style={{ width: `${Math.round(sec.score * 100)}%` }} /></span>
            <span class="adv-pct num">{Math.round(sec.score * 100)}%</span>
            <span class="adv-note small muted">
              {sec.score < WEAK && <b class="adv-tag">ослаблено</b>}
              {sec.note}
              {sec.score < WEAK && !advice.some((a) => a.sector === sec) && !optionFor(g, me, sec) && ' · строить негде: нет подходящих клеток'}
            </span>
          </div>
        ))}
      </div>
      <div class="sep" />
      <div class="small muted" style={{ marginBottom: '2px' }}>💡 Советую построить</div>
      {advice.length === 0 && <div class="small muted">Свободных клеток под нужные здания нет — улучшайте старые или расширяйте страну.</div>}
      {advice.map((a) => {
        const def = BUILDINGS[a.type];
        const b = g.buildings[a.tile];
        return (
          <div class="list-item" key={a.sector.id}>
            <span class="big-ic">{def.icon}</span>
            <div class="grow tap" onClick={() => show(a.tile)}>
              <div><b>{a.upgrade ? `Улучшить: ${def.name} ур. ${b.level} → ${b.level + 1}` : def.name}</b></div>
              <div class="small muted">{REGIONS[REGION_OF[a.tile]].name} · {GAIN[a.type]}</div>
              <div class={`small adv-why ${level(a.sector.score)}`}>{a.sector.icon} {a.sector.name}: {Math.round(a.sector.score * 100)}%</div>
            </div>
            <button
              class="btn sm" disabled={free <= 0 || c.money < a.cost}
              onClick={() => report(applyAdvice(g, me, a), `🔨 ${def.name}: стройка началась — ${REGIONS[REGION_OF[a.tile]].name}`)}
            >
              💰 {fmt(a.cost)}
            </button>
          </div>
        );
      })}
      <button
        class="btn block shine" style={{ marginTop: '10px' }} disabled={!canAll}
        onClick={() => {
          const n = applyAllAdvice(g, me);
          report(n ? null : 'Не хватает денег или мест для стройки', n ? `🔨 Начато строек по совету: ${n}` : undefined);
        }}
      >
        🔨 Построить всё по совету
      </button>
      {free <= 0 && <div class="small muted" style={{ marginTop: '6px', textAlign: 'center' }}>Все места заняты — дождитесь окончания стройки.</div>}
    </Card>
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

/** Мегапроекты: национальные стройки в три этапа — главная трата больших денег. */
function Megaprojects() {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const cur = c.mega;
  const def = cur ? MEGA_BY_ID[cur.id] : null;
  const done = MEGAS.reduce((a, m) => a + megaStages(c, m.id), 0);
  const total = MEGAS.reduce((a, m) => a + m.stages.length, 0);
  const firsts = g.firsts ?? {};
  // кто ещё летит в космос прямо сейчас
  const flying = g.countries.filter((o) => o.alive && o.idx !== me && o.mega?.id === 'space');
  return (
    <Card title="🏗️ Мегапроекты" sub={cur && def ? `${def.icon} ${Math.round((1 - cur.left / cur.total) * 100)}%` : `${done} из ${total} этапов`} fold="build-megas"
      hint="Национальные стройки в три этапа. Цена — в днях нынешнего дохода: чем богаче страна, тем дороже. Одновременно строится один этап, в войну — вдвое медленнее. Отмена вернёт половину денег. Космос — гонка: кто первым высадится на Луну и основает колонию на Марсе, прославится на весь мир.">
      {cur && def && (
        <div class="list-item wonder-now">
          <span class="big-ic">{def.icon}</span>
          <div class="grow">
            <div class="row between"><b>{def.stages[cur.stage - 1].name}</b><span class="small muted">{Math.ceil(cur.left)} дн.</span></div>
            <Bar value={1 - cur.left / cur.total} />
            {cur.id === 'space' && flying.some((o) => o.mega!.stage === cur.stage) && (
              <div class="small down" style={{ marginTop: '3px' }}>
                🚀 Гонка: {flying.filter((o) => o.mega!.stage === cur.stage).map((o) => `${COUNTRY_DEFS[o.idx].name} ${Math.round((1 - o.mega!.left / o.mega!.total) * 100)}%`).join(', ')}
              </div>
            )}
          </div>
          <button class="btn sm ghost" aria-label="Отменить этап"
            onClick={() => setUI({ modal: { kind: 'confirm', title: 'Отменить этап?', text: 'Вернётся половина вложенных денег.', danger: true, okText: 'Отменить', ok: () => { cancelMega(g, me); emit(); } } })}>
            ✕
          </button>
        </div>
      )}
      {MEGAS.map((m) => {
        const n = megaStages(c, m.id);
        const next = megaNext(g, me, m.id);
        const err = megaError(g, me, m.id);
        return (
          <div class="list-item" key={m.id}>
            <span class="big-ic">{m.icon}</span>
            <div class="grow">
              <div><b>{m.name}</b> <span class="small muted">· {n} из {m.stages.length}</span></div>
              <div class="small muted">{m.desc}</div>
              {next && cur?.id !== m.id && (
                <div class="small">
                  Этап {next.stage}: «{next.st.name}» · {next.st.days} дн.
                  {next.st.tech && <span class={c.techs.includes(next.st.tech) ? 'up' : 'down'}> · нужна «{TECH_BY_ID[next.st.tech].name}»{c.techs.includes(next.st.tech) ? ' ✓' : ''}</span>}
                </div>
              )}
              {m.id === 'space' && (
                <div class="small muted">
                  🌕 Луна: {firsts.moon === undefined ? 'пока никто' : firsts.moon === me ? 'мы первые!' : COUNTRY_DEFS[firsts.moon].name}
                  {' · '}🔴 Марс: {firsts.mars === undefined ? 'пока никто' : firsts.mars === me ? 'мы первые!' : COUNTRY_DEFS[firsts.mars].name}
                  {flying.length > 0 && cur?.id !== 'space' && <span class="down"> · летят: {flying.map((o) => COUNTRY_DEFS[o.idx].name).join(', ')}</span>}
                </div>
              )}
            </div>
            {!next ? <span class="up">✓</span> : cur?.id !== m.id && (
              <button class="btn sm wonder-btn" disabled={!!err} title={err ?? undefined} onClick={() => report(startMega(g, me, m.id))}>
                <span>💰 {fmt(next.money)}</span>
                {next.brains > 0 && <span>🧠 {fmt(next.brains)}</span>}
              </button>
            )}
          </div>
        );
      })}
    </Card>
  );
}
