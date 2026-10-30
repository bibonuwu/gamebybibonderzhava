import type { ComponentChildren } from 'preact';
import {
  annex, annexCost, annexError, atWar, cancelTreaty, declareWar, demandTribute, DIPLO_NAME, diploError, gift, giftCost, maxTrade,
  peekPair, propose, reachableTargets, warError, type DiploKind,
} from '../../game/actions';
import { answerProposal, proposalText } from '../../game/ai';
import { GOVS, PERSONALITIES, RELIGIONS } from '../../game/defs';
import { STATS, tradeWith } from '../../game/economy';
import { fmt, fmtDays } from '../../game/format';
import { emit, getGame, toast } from '../../game/state';
import type { GameState, UNCase } from '../../game/types';
import {
  aidCost, countriesN, embargoed, forecast, isAggressor, P5, playerAid, playerSanctions, sanctions, victimsOf, warJustice,
} from '../../game/un';
import { RATINGS, rating } from '../../game/debt';
import { pending } from '../../game/assembly';
import { brothers, visibleMembers } from '../../game/lodge';
import { aidCost as devAidCost, aidDonors, aidError, AID_MEMORY, AID_NOT_POOR, aidLoyal, startAid } from '../../game/megaprojects';
import { inOrder, invite, inviteCost, inviteError, joinChance } from '../../game/order';
import { nearCollapse, rebelsIn } from '../../game/rebels';
import { hasDeposit, oilDepletion, REGION_LITH, REGION_OIL } from '../../game/resources';
import { dossier, netOf, watched } from '../../game/spy';
import { WONDER_BY_ID, wondersOf } from '../../game/wonders';
import { COUNTRY_DEFS, REGIONS, vb } from '../../game/world';
import { Bar, Card, Flag, KV, LiveNum, More, Rate, RelBar, relText } from '../common';
import { PeaceButton } from './ArmyPanel';
import { report, setUI, useStore } from '../store';
import type { MapView } from '../../map/MapView';

export function DiploPanel({ map }: { map: MapView }) {
  useStore();
  const g = getGame()!;
  const me = g.player;
  const others = g.countries.filter((c) => c.alive && c.idx !== me).sort((a, b) => g.rel[me][b.idx] - g.rel[me][a.idx]);
  const masons = new Set(visibleMembers(g));
  const neutral = reachableTargets(g, me, true)
    .map((t) => ({ ...t, cost: annexCost(g, me, t.rid) }))
    .sort((a, b) => Number(hasDeposit(b.rid)) - Number(hasDeposit(a.rid)) || a.cost - b.cost);
  return (
    <>
      {g.proposals.length > 0 && (
        <Card title="📨 Предложения">
          {g.proposals.map((p) => <ProposalRow key={p.id} id={p.id} />)}
        </Card>
      )}
      <UNLink />
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
                  {isAggressor(g, c.idx) && <span class="chip war" title="Напала на другую страну без причины — ООН её осудила">🌐 агрессор</span>}
                  {sanctions(g, me, c.idx) && <span class="chip">🚫 наши санкции</span>}
                  {masons.has(c.idx) && <LodgeChip id={c.idx} />}
                  {inOrder(g, c.idx) && <OrderChip />}
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
              <div class="small muted">
                👥 {fmt(g.regions[t.rid].pop)}
                {REGION_OIL[t.rid] > 0.05 && ` · ⛽ нефть ${(REGION_OIL[t.rid] * oilDepletion(g)).toFixed(1)}`}
                {REGION_LITH[t.rid] > 0.05 && ` · 🔋 литий ${REGION_LITH[t.rid].toFixed(1)}`}
              </div>
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
        <b>{COUNTRY_DEFS[p.from].name}</b> {proposalText(p)}
        {p.kind === 'tribute' && <> — <b>{fmt(p.amount ?? 0)} 💰</b></>}
        {p.kind === 'peace' && !!p.amount && <> за контрибуцию <b>{fmt(p.amount)} 💰</b></>}
        <div class="small muted">ответ нужен в течение {Math.ceil(p.expires - g.day)} дн.</div>
      </div>
      <button class="btn sm green" onClick={() => { answerProposal(g, id, true); emit(); }}>✓</button>
      <button class="btn sm ghost" onClick={() => { answerProposal(g, id, false); emit(); }}>✕</button>
    </div>
  );
}

export function CountryDialog({ id }: { id: number }) {
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
      {visibleMembers(g).includes(id) && (
        <p class="small" style={{ marginTop: '-6px' }}><LodgeChip id={id} /></p>
      )}
      {inOrder(g, id) && <p class="small" style={{ marginTop: '-6px' }}><OrderChip /></p>}
      {isAggressor(g, id) && (
        <p class="small down" style={{ marginTop: '-6px' }}>
          🌐 Агрессор: напала на {victimsOf(g, id).map((v) => COUNTRY_DEFS[v].name).join(', ')}{s.sanctions > 0 && ` · санкции −${Math.round(s.sanctions * 100)}% производства`}
        </p>
      )}
      {g.rebels.some((r) => r.country === me && r.sponsor === id && r.exposed) && (
        <p class="small down" style={{ marginTop: '-6px' }}>🔥 Вооружает мятежников у нас — война с ней будет справедливой</p>
      )}
      {nearCollapse(g, id) && <p class="small down" style={{ marginTop: '-6px' }}>💔 Глубокий кризис: страна на грани распада</p>}
      {aidDonors(g, id).length > 0 && (
        <p class="small" style={{ marginTop: '-6px' }}>🤲 Программы развития: {aidDonors(g, id).map((d) => (d === me ? 'наша' : COUNTRY_DEFS[d].name)).join(', ')}</p>
      )}
      {!aidDonors(g, id).includes(me) && aidLoyal(g, id, me) && (
        <p class="small up" style={{ marginTop: '-6px' }}>🤲 Помнит нашу помощь: в ООН голосует заодно с нами</p>
      )}
      {rebelsIn(g, id).length > 0 && (
        <p class="small" style={{ marginTop: '-6px' }}>✊ Мятежи: {rebelsIn(g, id).map((r) => REGIONS[r.region].name).join(', ')}</p>
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
            ...(s.oilProd > 0.05 || s.lithProd > 0.05 ? [['⛽ Нефть · 🔋 литий', `${s.oilProd.toFixed(1)} · ${s.lithProd.toFixed(1)} (нужно ${s.oilNeed.toFixed(1)} · ${s.lithNeed.toFixed(1)})`] as [string, string]] : []),
            ['🌾 Своей еды', s.hunger > 0 ? `голод ${Math.round(s.hunger * 100)}%` : `${Math.round((s.foodProd / Math.max(1, s.foodCons)) * 100)}% от нужного`],
            ...(wondersOf(g, id).length ? [['Чудеса света', wondersOf(g, id).map((w) => w.icon).join(' ')] as [string, string]] : []),
            ...(c.project ? [['Строит чудо', `${WONDER_BY_ID[c.project.id].icon} ${Math.round((1 - c.project.left / c.project.total) * 100)}%`] as [string, string]] : []),
            ['🏦 Кредитный рейтинг', RATINGS[rating(g, id)]],
          ]} />
        </More>
        {watched(g, id) && (
          <div class="spy-dossier">
            <div class="small muted" style={{ marginBottom: '4px' }}>🔍 Досье разведки</div>
            <KV rows={dossier(g, id)} />
          </div>
        )}
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
        {!p.war && aidError(g, me, id) !== AID_NOT_POOR && (
          <button class="btn ghost block" disabled={!!aidError(g, me, id)} title={aidError(g, me, id) ?? undefined}
            onClick={() => setUI({ modal: { kind: 'confirm', title: '🤲 Программа развития', okText: 'Начать',
              text: `Год вкладываться в страну ${COUNTRY_DEFS[id].name}: школы, дороги, больницы. Стоит ${fmt(devAidCost(g, me))} 💰 (40% сразу получит её казна). Ей — производительность +6% и стабильность +3 на год, нам — отношения +22, а в ООН она будет голосовать заодно с нами ещё ${Math.round(AID_MEMORY / 365)} года после программы.`,
              ok: () => report(startAid(g, me, id)) } })}>
            🤲 Программа развития · 💰 {fmt(devAidCost(g, me))}
          </button>
        )}
        {p.war ? (
          <PeaceButton enemy={id} block />
        ) : (
          <button
            class="btn danger block"
            disabled={!!warError(g, me, id)}
            onClick={() => setUI({
              modal: {
                kind: 'confirm', danger: true, title: '⚔️ Объявить войну?', okText: 'Объявить войну',
                text: warWarning(g, id),
                ok: () => report(declareWar(g, me, id)),
              },
            })}
          >
            ⚔️ Объявить войну {warError(g, me, id) ? `(${warError(g, me, id)})` : ''}
          </button>
        )}
        {!p.war && !warError(g, me, id) && (
          <div class="small muted" style={{ textAlign: 'center' }}>
            {warJustice(g, me, id).just ? `✅ Справедливая война: ${warJustice(g, me, id).reason}` : '⚠️ Без причины это агрессия — ООН осудит нас'}
          </div>
        )}
        {g.order && !inOrder(g, id) && (
          <button class="btn ghost block" disabled={!!inviteError(g, id)} title={inviteError(g, id) ?? undefined} onClick={() => {
            const err = invite(g, id);
            if (err) return report(err);
            toast(inOrder(g, id) ? `${g.order!.emblem} ${COUNTRY_DEFS[id].name} — наш брат!` : `🚪 ${COUNTRY_DEFS[id].name} ${vb(id, 'отказался')} от посвящения`, inOrder(g, id) ? 'good' : 'bad');
            emit();
          }}>
            {g.order.emblem} Позвать в ложу · шанс {Math.round(joinChance(g, id) * 100)}% · 💰 {fmt(inviteCost(g))}
          </button>
        )}
        <button class="btn ghost block" onClick={() => setUI({ modal: null, tab: 'army', armyTab: 'spy', spyTarget: id })}>
          🕵️ Разведка{netOf(g, me, id) >= 1 ? ` · сеть агентов ${Math.round(netOf(g, me, id))}%` : ''}
        </button>
        <button class="btn ghost block" onClick={close}>Закрыть</button>
      </div>
    </>
  );
}

/** Метка масона: брат по ложе (если мы в ней) или разоблачённый газетами. */
function LodgeChip({ id }: { id: number }) {
  const g = getGame()!;
  const master = g.lodge.master === id;
  if (brothers(g, g.player, id)) return <span class="chip lodge" title="Брат по тайной ложе: не нападёт на нас и охотнее подпишет договор">👁️ {master ? 'Великий мастер' : 'брат по ложе'}</span>;
  return <span class="chip lodge" title="Газеты раскрыли: член тайной ложи">👁️ масон</span>;
}

/** Метка брата нашей ложи. */
function OrderChip() {
  const g = getGame()!;
  return <span class="chip lodge" title={`Брат нашей ложи «${g.order!.name}»: не нападёт на нас, платит взносы`}>{g.order!.emblem} наш брат</span>;
}

/** ООН — теперь своя вкладка; здесь — короткая сводка и переход. */
function UNLink() {
  const g = getGame()!;
  const me = g.player;
  const cases = g.un.filter((cs) => cs.until === undefined);
  const votes = pending(g).filter((r) => r.by !== me && !r.myVote).length;
  const ours = cases.some((cs) => cs.aggressor === me || cs.victim === me);
  if (!cases.length && !votes) return null;
  return (
    <div class={`list-item tap un-link ${ours ? 'hot' : ''}`} onClick={() => setUI({ armyTab: 'un' })}>
      <span class="big-ic">🌐</span>
      <div class="grow">
        <b>ООН</b>
        <div class="small muted">
          {cases.length ? `дел об агрессии: ${cases.length}${ours ? ' (и наше)' : ''}` : ''}{cases.length && votes ? ' · ' : ''}{votes ? `ждут нашего голоса: ${votes}` : ''}
        </div>
      </div>
      <span class="muted">›</span>
    </div>
  );
}

const many = (n: number, one: string, more: string) => (n % 10 === 1 && n % 100 !== 11 ? one : more);

/** Предупреждение перед объявлением войны: правы ли мы и чем ответит мир. */
function warWarning(g: GameState, id: number): string {
  const me = g.player;
  const p = peekPair(g, me, id);
  const name = COUNTRY_DEFS[id].name;
  const tail = `${p.trade ? ' Торговый договор будет разорван.' : ''} Её союзники вступят в войну.`;
  const j = warJustice(g, me, id);
  if (j.just) return `${name}: справедливая война — ${j.reason}. Мир не осудит нас${isAggressor(g, id) ? ', а её жертвы станут нам ближе' : ''}.${tail}`;
  const f = forecast(g, me, id);
  const names = f.coalition.slice(0, 3).map((k) => COUNTRY_DEFS[k].name).join(', ') + (f.coalition.length > 3 ? ` и ещё ${f.coalition.length - 3}` : '');
  const n = f.coalition.length;
  const council = f.veto >= 0
    ? `${f.veto === me ? 'Мы сами наложим вето в Совбезе' : `${COUNTRY_DEFS[f.veto].name} наложит вето в Совбезе`} — коалиции не будет, но`
    : `Вето никто не наложит: ${n ? `${countriesN(n)} (${names}) ${many(n, 'объявит', 'объявят')} нам войну, ` : ''}будет эмбарго на оружие,`;
  return `${name} нам не угрожает — это агрессия${p.pact ? ' и нарушение пакта о ненападении' : ''}. ООН осудит нас. ${council} `
    + `санкции введут ${countriesN(f.sanctions.length)} (−${Math.round(f.loss * 100)}% производства), а ${name} получит деньги и оружие от всего мира.${tail}`;
}

/** ООН: дела об агрессии — кто напал, что решил Совбез, кто помогает жертве. Со стороны можно помочь. */
export function UNCard() {
  const g = getGame()!;
  const me = g.player;
  if (!g.un.length) return null;
  const mine = (cs: UNCase) => (cs.aggressor === me || cs.victim === me ? 1 : 0);
  const list = [...g.un].sort((x, y) => mine(y) - mine(x) || y.since - x.since);
  return (
    <Card
      title="🌐 ООН" sub={`${list.length}`}
      hint={`Кто напал без причины — агрессор. Справедливая война — только помощь жертве агрессии или удар по тому, кто сам готовил нападение. `
        + `Совбез (${P5.map((k) => COUNTRY_DEFS[k].name).join(', ')}) голосует: без вето соседи-добровольцы воюют с агрессором, весь мир вводит санкции и эмбарго на оружие; `
        + 'при вето санкции вводят только несогласные. Жертва каждый месяц получает деньги и оружие. Мир с жертвой снимает санкции, а за удержанные земли — ещё два года санкций.'}
    >
      {list.map((cs) => <UNRow key={cs.id} cs={cs} />)}
    </Card>
  );
}

function UNRow({ cs }: { cs: UNCase }) {
  const g = getGame()!;
  const me = g.player;
  const { aggressor: a, victim: b } = cs;
  const A = COUNTRY_DEFS[a].name, B = COUNTRY_DEFS[b].name;
  const active = cs.until === undefined;
  const status = !active
    ? `🏴 Захват ${cs.taken} рег. не признан — санкции ещё ${fmtDays(cs.until! - g.day)}`
    : !cs.resolved
      ? cs.vote > g.day ? `⏳ Совбез соберётся через ${Math.ceil(cs.vote - g.day)} дн.` : '🗳️ Совбез голосует'
      : cs.veto === undefined
        ? `✅ Резолюция принята · ⚔️ коалиция: ${cs.coalition.length} · 🚫 санкции: ${cs.sanctions.length} · 🔒 эмбарго`
        : `❌ Вето: ${COUNTRY_DEFS[cs.veto].name} · 🚫 санкции: ${cs.sanctions.length}`;
  const side = active && cs.resolved && me !== a && me !== b && g.countries[b].alive;
  const join = side && cs.veto === undefined && !atWar(g, me, a);
  const cost = aidCost(g);
  return (
    <div class="un-case">
      <div class="row wrap" style={{ gap: '6px' }}>
        <Flag id={a} /><b>{A}</b><span class="small muted">напала на</span><Flag id={b} /><b>{B}</b>
      </div>
      <div class="small muted">{status}</div>
      {cs.aid.money > 0 && <div class="small">📦 Жертве передано: 💰 {fmt(cs.aid.money)}{cs.aid.arms >= 1 && <> · 🔫 {fmt(cs.aid.arms)}</>}</div>}
      {a === me && (
        <div class="small down">
          Против нас: −{Math.round(STATS[me].sanctions * 100)}% производства{embargoed(g, me) ? ', оружие на рынке нам не продают' : ''}.
          {active && ` Санкции снимут после мира с ${B}${cs.taken ? `; за удержанные земли (${cs.taken} рег.) — только через 2 года` : ''}.`}
        </div>
      )}
      {a === me && active && atWar(g, me, b) && <PeaceButton enemy={b} block />}
      {b === me && active && cs.resolved && (
        <div class="small up">Нам помогают {countriesN(cs.donors.length)} — следующая помощь через {Math.max(0, Math.ceil(cs.nextAid - g.day))} дн.</div>
      )}
      {side && (
        <div class="grid2" style={join ? { gridTemplateColumns: '1fr 1fr 1fr' } : undefined}>
          <button class="btn sm" disabled={sanctions(g, me, a)} onClick={() => report(playerSanctions(g, cs.id), `🚫 Санкции против страны ${A} введены`)}>
            {sanctions(g, me, a) ? '🚫 Введены' : '🚫 Санкции'}
          </button>
          <button class="btn sm green" disabled={g.countries[me].money < cost} onClick={() => report(playerAid(g, cs.id), `📦 ${B} благодарит за помощь`)}>
            📦 {fmt(cost)}
          </button>
          {join && (
            <button
              class="btn sm danger" disabled={!!warError(g, me, a)}
              onClick={() => setUI({ modal: { kind: 'confirm', danger: true, title: '⚔️ В коалицию ООН?', okText: 'Вступить', text: warWarning(g, a), ok: () => report(declareWar(g, me, a)) } })}
            >
              ⚔️ В коалицию
            </button>
          )}
        </div>
      )}
    </div>
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
