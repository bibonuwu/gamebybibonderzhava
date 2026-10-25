// Мятежи: у нас (подавить или договориться) и те, что мы вооружаем за границей.
import { regionDefense } from '../../game/economy';
import { fmt } from '../../game/format';
import {
  autonomy, autonomyCost, autonomyError, crackdown, crackdownChance, crackdownError, crackdownNeed, proxyFee, rebelsIn, rebelsOf,
  rebelThreat, stopSponsor,
} from '../../game/rebels';
import { getGame } from '../../game/state';
import type { Rebellion } from '../../game/types';
import { COUNTRY_DEFS, REGIONS } from '../../game/world';
import type { MapView } from '../../map/MapView';
import { Bar, Card, Flag } from '../common';
import { report, setUI } from '../store';

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function RebelsCard({ map }: { map: MapView }) {
  const g = getGame()!;
  const me = g.player;
  const home = rebelsIn(g, me);
  const ours = rebelsOf(g, me);
  if (!home.length && !ours.length) return null;
  const show = (rid: number) => {
    const tile = REGIONS[rid].center;
    setUI({ tab: 'map', tile });
    map.select(tile);
    map.focusTile(tile, 1.8);
  };
  return (
    <>
      {home.length > 0 && (
        <Card title="✊ Мятежи" sub={`${home.length}`}
          hint="Повстанцы растут, когда в стране плохо: низкая стабильность, голод, недовольство на захваченных землях. Раз в месяц они бьются с гарнизоном — две победы подряд, и регион отделится. Подавить: шанс зависит от числа солдат, народ не любит жестокость. Автономия: деньги и уступки — мятеж кончится миром. Кто тайно вооружает мятежников, может выяснить досье или сильная контрразведка — тогда война с ним будет справедливой.">
          {home.map((r) => <HomeRebel key={r.id} r={r} show={show} />)}
        </Card>
      )}
      {ours.length > 0 && (
        <Card title="🔥 Наши повстанцы" sub={`💰 ${fmt(proxyFee(g, me) * ours.length)} в месяц`}
          hint="Мятежники в чужих странах, которых мы тайно вооружаем. Две победы над гарнизоном подряд — регион отделится, и присоединить его нам будет дешевле. Если след раскроют, отношения упадут, а у жертвы появится законный повод для войны с нами.">
          {ours.map((r) => (
            <div class="list-item" key={r.id}>
              <Flag id={r.country} />
              <div class="grow tap" onClick={() => show(r.region)}>
                <b>{REGIONS[r.region].name}</b>
                <div class="small muted">
                  {COUNTRY_DEFS[r.country].name} · ~{fmt(r.fighters)} бойцов · стычка через {Math.max(0, Math.ceil(r.nextClash - g.day))} дн.
                </div>
                <div class="small">
                  шанс в стычке {pct(rebelThreat(g, r))}{r.wins ? ' · 🔥 ещё победа — и регион отделится' : ''}{r.exposed ? <span class="down"> · след раскрыт</span> : ''}
                </div>
              </div>
              <button class="btn sm ghost" onClick={() => { stopSponsor(g, me, r.id); report(null); }}>Прекратить</button>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function HomeRebel({ r, show }: { r: Rebellion; show: (rid: number) => void }) {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const p = rebelThreat(g, r);
  const n = Math.min(Math.floor(c.soldiers), crackdownNeed(g, me, r, 0.8));
  const chance = crackdownChance(g, me, r, n);
  const cErr = crackdownError(g, me, r);
  const aErr = autonomyError(g, me, r);
  const cost = autonomyCost(g, me, r);
  const sponsor = r.sponsor >= 0 && r.exposed ? r.sponsor : -1;
  const ask = () => setUI({ modal: {
    kind: 'confirm', danger: true, okText: 'Начать операцию', title: `⚔️ Подавить мятеж: ${REGIONS[r.region].name}?`,
    text: `Отправить ${fmt(n)} солдат. Шанс — ${pct(chance)}. Победа покончит с мятежом, но народ не любит жестокость (стабильность −2, в демократии −5). Провал — потери и повстанцы смелее.`,
    ok: () => report(crackdown(g, me, r.id, n)),
  } });
  return (
    <div class="rebel-row">
      <div class="row">
        <span class="big-ic">✊</span>
        <div class="grow tap" onClick={() => show(r.region)}>
          <b>{REGIONS[r.region].name}</b>
          <div class="small muted">
            ~{fmt(r.fighters)} повстанцев · гарнизон ~{fmt(regionDefense(g, r.region).garrison)} · стычка через {Math.max(0, Math.ceil(r.nextClash - g.day))} дн.
          </div>
        </div>
      </div>
      <div class="row between small" style={{ marginTop: '6px' }}>
        <span>Шанс повстанцев в стычке</span>
        <b class={`num ${p >= 0.4 ? 'down' : p < 0.15 ? 'up' : ''}`}>{pct(p)}</b>
      </div>
      <Bar value={p} color={p >= 0.4 ? 'red' : undefined} />
      {r.wins > 0 && <div class="small down" style={{ marginTop: '4px' }}>⚠️ Гарнизон уже разбит — ещё одна победа повстанцев, и регион отделится!</div>}
      <div class="small muted" style={{ marginTop: '4px' }}>
        {sponsor >= 0
          ? <span class="down"><Flag id={sponsor} /> Оружие — от страны {COUNTRY_DEFS[sponsor].name}. Война с ней будет справедливой</span>
          : '🕵️ Откуда у них оружие — неизвестно'}
      </div>
      <div class="grid2" style={{ marginTop: '8px' }}>
        <button class="btn sm danger rebel-act" disabled={!!cErr || n < 1} title={cErr ?? undefined} onClick={ask}>
          <span>⚔️ Подавить</span>
          <span class="small">{cErr?.startsWith('Войска') ? `⏳ ещё ${Math.ceil((r.cd ?? 0) - g.day)} дн.` : `${fmt(n)} солдат · ${pct(chance)}`}</span>
        </button>
        <button class="btn sm green rebel-act" disabled={!!aErr} title={aErr ?? undefined} onClick={() => report(autonomy(g, me, r.id))}>
          <span>🤝 Автономия</span>
          <span class="small">💰 {fmt(cost)}</span>
        </button>
      </div>
    </div>
  );
}
