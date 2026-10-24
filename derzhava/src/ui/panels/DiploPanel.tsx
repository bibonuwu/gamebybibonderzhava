import type { ComponentChildren } from 'preact';
import {
  annex, annexCost, annexError, cancelTreaty, declareWar, demandTribute, DIPLO_NAME, diploError, gift, giftCost, maxTrade,
  peekPair, propose, reachableTargets, warError, type DiploKind,
} from '../../game/actions';
import { answerProposal, PROPOSAL_TEXT } from '../../game/ai';
import { GOVS, PERSONALITIES, RELIGIONS } from '../../game/defs';
import { STATS, tradeWith } from '../../game/economy';
import { fmt, fmtDays } from '../../game/format';
import { emit, getGame, toast } from '../../game/state';
import { WONDER_BY_ID, wondersOf } from '../../game/wonders';
import { COUNTRY_DEFS, REGIONS } from '../../game/world';
import { Bar, Card, Flag, KV, LiveNum, More, Rate, RelBar, relText } from '../common';
import { PeaceButton } from './ArmyPanel';
import { report, setUI, useStore } from '../store';
import type { MapView } from '../../map/MapView';

export function DiploPanel({ map }: { map: MapView }) {
  useStore();
  const g = getGame()!;
  const me = g.player;
  const others = g.countries.filter((c) => c.alive && c.idx !== me).sort((a, b) => g.rel[me][b.idx] - g.rel[me][a.idx]);
  const neutral = reachableTargets(g, me, true)
    .map((t) => ({ ...t, cost: annexCost(g, me, t.rid) }))
    .sort((a, b) => a.cost - b.cost);
  return (
    <>
      <h2 class="ptitle">Дипломатия</h2>
      {g.proposals.length > 0 && (
        <Card title="📨 Предложения">
          {g.proposals.map((p) => <ProposalRow key={p.id} id={p.id} />)}
        </Card>
      )}
      <Treaties />
      <Card title="🌍 Страны мира" hint="Нажмите на страну, чтобы предложить договор, сделать подарок или объявить войну. Полоска справа — отношения с вами.">
        {others.map((c) => {
          const p = peekPair(g, me, c.idx);
          const rel = g.rel[me][c.idx];
          return (
            <div class="list-item tap" key={c.idx} onClick={() => setUI({ modal: { kind: 'country', id: c.idx } })}>
              <Flag id={c.idx} />
              <div class="grow">
                <div class="row" style={{ gap: '6px' }}>
                  <b>{COUNTRY_DEFS[c.idx].name}</b>
                  <span title={PERSONALITIES[c.personality].name}>{PERSONALITIES[c.personality].icon}</span>
                </div>
                <div class="row wrap" style={{ gap: '4px', marginTop: '3px' }}>
                  {p.war && <span class="chip war">⚔️ война</span>}
                  {p.alliance && <span class="chip ally">🛡️ союз</span>}
                  {p.pact && !p.alliance && <span class="chip">📜 пакт</span>}
                  {p.trade && <span class="chip">🤝 торговля</span>}
                  {c.aiFlags.prepTarget === me && <span class="chip war">🪖 готовит нападение!</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <RelBar v={rel} />
              </div>
            </div>
          );
        })}
      </Card>
      <Card title="🕊️ Нейтральные земли" sub={`${neutral.length}`} fold="diplo-neutral" hint="Земли без хозяина можно купить. Постройте ⚓ порт — до побережий можно добраться морем.">
        {neutral.length === 0 && <div class="small muted">Рядом нет нейтральных земель.</div>}
        {neutral.slice(0, 8).map((t) => (
          <div class="list-item" key={t.rid}>
            <span class="big-ic">{t.via === 'sea' ? '⛵' : '🏕️'}</span>
            <div class="grow tap" onClick={() => { setUI({ tab: 'map', tile: REGIONS[t.rid].center }); map.select(REGIONS[t.rid].center); map.focusTile(REGIONS[t.rid].center, 1.6); }}>
              <div><b>{REGIONS[t.rid].name}</b></div>
              <div class="small muted">👥 {fmt(g.regions[t.rid].pop)}</div>
            </div>
            <button class="btn sm" disabled={!!annexError(g, me, t.rid)} onClick={() => report(annex(g, me, t.rid))}>💰 {fmt(t.cost)}</button>
          </div>
        ))}
      </Card>
    </>
  );
}

export function ProposalRow({ id }: { id: number }) {
  const g = getGame()!;
  const p = g.proposals.find((x) => x.id === id);
  if (!p) return null;
  return (
    <div class="list-item">
      <Flag id={p.from} />
      <div class="grow">
        <b>{COUNTRY_DEFS[p.from].name}</b> {PROPOSAL_TEXT[p.kind]}
        {p.kind === 'tribute' && <> — <b>{fmt(p.amount ?? 0)} 💰</b></>}
        {p.kind === 'peace' && !!p.amount && <> за контрибуцию <b>{fmt(p.amount)} 💰</b></>}
        <div class="small muted">ответ нужен в течение {Math.ceil(p.expires - g.day)} дн.</div>
      </div>
      <button class="btn sm green" onClick={() => { answerProposal(g, id, true); emit(); }}>✓</button>
      <button class="btn sm ghost" onClick={() => { answerProposal(g, id, false); emit(); }}>✕</button>
    </div>
  );
}

export function CountryDialog({ id, map }: { id: number; map: MapView }) {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[id];
  const s = STATS[id];
  const p = peekPair(g, me, id);
  const rel = g.rel[me][id];
  // при согласии покажется праздничное окно договора, при отказе — уведомление
  const act = (kind: DiploKind) => {
    const msg = propose(g, me, id, kind);
    if (!peekPair(g, me, id)[kind]) toast(msg, 'bad');
  };
  const close = () => setUI({ modal: null });
  return (
    <>
      <div class="row" style={{ justifyContent: 'center', gap: '8px' }}>
        <Flag id={id} />
        <h2 style={{ margin: 0 }}>{COUNTRY_DEFS[id].name}</h2>
      </div>
      <p class="small muted" style={{ marginTop: '4px' }}>
        {PERSONALITIES[c.personality].icon} {PERSONALITIES[c.personality].name}
      </p>
      {c.aiFlags.prepTarget !== undefined && (
        <p class="small down" style={{ marginTop: '-6px' }}>
          🕵️ Разведка: {c.aiFlags.prepTarget === me ? 'скупает оружие и готовит нападение на нас!' : `мобилизуется против страны ${COUNTRY_DEFS[c.aiFlags.prepTarget].name}`}
        </p>
      )}
      <div class="card">
        <KV rows={[
          ['Отношения', <span>{relText(rel)} ({rel > 0 ? '+' : ''}{rel.toFixed(0)})</span>],
          ['Доход', `${fmt(s.moneyRate)}/сек`],
          ['Военная мощь', `${fmt(s.power)} (у вас ${fmt(STATS[me].power)})`],
          ...(p.trade ? [['🤝 Торговля даёт нам', <Rate v={tradeWith(g, me, id)} />] as [string, ComponentChildren]] : []),
        ]} />
        <More>
          <KV rows={[
            ['Население', fmt(s.civPop)],
            ['Правление', `${GOVS[c.gov].icon} ${GOVS[c.gov].name}`],
            ['Религия', `${RELIGIONS[c.religion].icon} ${RELIGIONS[c.religion].name}`],
            ['Наука', `${fmt(s.brainsRate)}/сек`],
            ['Регионов', s.regions.length],
            ['🧑‍🔬 Учёных', fmt(c.scientists)],
            ['💎 Миллиардеров', Math.round(c.billionaires)],
            ['🏢 Мировых компаний', s.companies],
            ['🔫 Оснащение армии', `${Math.round(s.equip * 100)}%`],
            ['🌾 Своей еды', s.hunger > 0 ? `голод ${Math.round(s.hunger * 100)}%` : `${Math.round((s.foodProd / Math.max(1, s.foodCons)) * 100)}% от нужного`],
            ...(wondersOf(g, id).length ? [['Чудеса света', wondersOf(g, id).map((w) => w.icon).join(' ')] as [string, string]] : []),
            ...(c.project ? [['Строит чудо', `${WONDER_BY_ID[c.project.id].icon} ${Math.round((1 - c.project.left / c.project.total) * 100)}%`] as [string, string]] : []),
          ]} />
        </More>
      </div>
      <div class="col">
        {(['trade', 'pact', 'alliance'] as DiploKind[]).map((k) =>
          p[k] ? (
            <button key={k} class="btn ghost block" onClick={() => { cancelTreaty(g, me, id, k); emit(); }}>Расторгнуть: {DIPLO_NAME[k].toLowerCase()}</button>
          ) : (
            <button key={k} class="btn block" disabled={!!diploError(g, me, id, k)} onClick={() => { act(k); emit(); }}>
              {k === 'trade' ? '🤝' : k === 'pact' ? '📜' : '🛡️'} Предложить: {DIPLO_NAME[k].toLowerCase()}
            </button>
          ),
        )}
        <div class="grid2">
          <button class="btn" disabled={g.countries[me].money < giftCost(g, id)} onClick={() => { toast(gift(g, me, id), 'good'); emit(); }}>🎁 {fmt(giftCost(g, id))}</button>
          <button class="btn ghost" disabled={!!p.war} onClick={() => { toast(demandTribute(g, me, id), 'info'); emit(); }}>💰 Требовать дань</button>
        </div>
        {p.war ? (
          <PeaceButton enemy={id} block />
        ) : (
          <button
            class="btn danger block"
            disabled={!!warError(g, me, id)}
            onClick={() => setUI({
              modal: {
                kind: 'confirm', danger: true, title: '⚔️ Объявить войну?', okText: 'Объявить войну',
                text: `${COUNTRY_DEFS[id].name}${p.pact ? ' — у вас пакт о ненападении! Нарушение испортит отношения со всем миром.' : ''}${p.trade ? ' Торговый договор будет разорван.' : ''} Её союзники вступят в войну.`,
                ok: () => report(declareWar(g, me, id)),
              },
            })}
          >
            ⚔️ Объявить войну {warError(g, me, id) ? `(${warError(g, me, id)})` : ''}
          </button>
        )}
        <div class="grid2">
          <button class="btn ghost" onClick={() => { const cap = REGIONS[c.capital].center; close(); setUI({ tab: 'map', tile: cap }); map.select(cap); map.focusTile(cap, 1.3); }}>🗺️ На карте</button>
          <button class="btn ghost" onClick={close}>Закрыть</button>
        </div>
      </div>
    </>
  );
}

/** Наши договоры: с кем, сколько уже принесла торговля — счётчик растёт на глазах. */
function Treaties() {
  const g = getGame()!;
  const me = g.player;
  const s = STATS[me];
  const list = g.countries
    .filter((c) => c.alive && c.idx !== me)
    .map((c) => ({ i: c.idx, p: peekPair(g, me, c.idx), rate: tradeWith(g, me, c.idx) }))
    .filter((x) => x.p.trade || x.p.pact || x.p.alliance)
    .sort((a, b) => (b.p.trade ? b.rate : -1) - (a.p.trade ? a.rate : -1));
  const trades = list.filter((x) => x.p.trade);
  const total = trades.reduce((sum, x) => sum + (x.p.earned ?? 0), 0);
  const share = s.moneyRate > 0 ? s.tradeIncome / s.moneyRate : 0;
  if (!list.length) {
    return (
      <Card title="📜 Наши договоры">
        <div class="treaty-empty">
          <span class="big-ic">🤝</span>
          <span class="small">Договоров пока нет. Нажмите на страну ниже и предложите <b>торговый договор</b> — доход вырастет сразу.</span>
        </div>
      </Card>
    );
  }
  return (
    <Card title="📜 Наши договоры" sub={`${list.length}`}>
      {trades.length > 0 && (
        <div class="treaty-total">
          <div class="tt-l">Торговля уже принесла</div>
          <div class="tt-v">💰 <LiveNum base={total} rate={s.tradeIncome} /></div>
          <div class="tt-s">
            <Rate v={s.tradeIncome} />
            {share >= 0.005 && <span class="muted"> · {Math.round(share * 100)}% всего дохода</span>}
            <span class="muted"> · {trades.length} из {maxTrade(g, me)}</span>
          </div>
        </div>
      )}
      {list.map(({ i, p, rate }) => (
        <div class="list-item tap treaty" key={i} onClick={() => setUI({ modal: { kind: 'country', id: i } })}>
          <Flag id={i} />
          <div class="grow">
            <div class="row" style={{ gap: '6px' }}>
              <b>{COUNTRY_DEFS[i].name}</b>
              {p.trade && <span title="Торговый договор">🤝</span>}
              {p.alliance ? <span title="Военный союз">🛡️</span> : p.pact && <span title="Пакт о ненападении">📜</span>}
            </div>
            {p.trade ? (
              <>
                <div class="small muted">
                  <Rate v={rate} />{p.tradeSince !== undefined && <> · {fmtDays(g.day - p.tradeSince)}</>}
                </div>
                <div style={{ marginTop: '4px' }}><Bar value={s.tradeIncome > 0 ? rate / s.tradeIncome : 0} color="green" /></div>
              </>
            ) : (
              <div class="small muted">{p.alliance ? 'военный союз' : 'пакт о ненападении'}</div>
            )}
          </div>
          {p.trade && (
            <div class="tr-earned">
              <b class="up">+<LiveNum base={p.earned ?? 0} rate={rate} /></b>
              <span class="small muted">заработано</span>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
