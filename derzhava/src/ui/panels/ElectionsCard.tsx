// Выборы во вкладке «Власть»: рейтинг власти, оппозиция, обещание, кампания и коалиция.
import type { ComponentChildren } from 'preact';
import {
  actError, approvalParts, approvalTarget, CAMPAIGN, CAMPAIGN_ACTS, campaignAct, coalitionParty, CYCLE, debateChance, isFree,
  PARTY_BY_ID, promiseIcon, promiseOk, promiseText, rallyCost, rivalParty,
} from '../../game/elections';
import { GOVS } from '../../game/defs';
import { fmt, fmtDate, fmtDays } from '../../game/format';
import { getGame } from '../../game/state';
import { Bar, Card, KV, More } from '../common';
import { report, setUI } from '../store';

export function ElectionsCard() {
  const g = getGame()!;
  const c = g.countries[g.player];
  const E = g.elections;
  const coal = coalitionParty(g);
  if (!isFree(c.gov)) {
    return (
      <Card title="🗳️ Выборы" sub="не проводятся" fold="policy-elections">
        <div class="small muted">
          При форме правления «{GOVS[c.gov].name}» власть не спрашивает народ. Демократия выбирает раз в {Math.round(CYCLE.democracy! / 365)} года,
          республика — раз в {Math.round(CYCLE.republic! / 365)} лет: можно выиграть мандат доверия — или проиграть оппозиции.
        </div>
      </Card>
    );
  }
  const party = E.campaign ? PARTY_BY_ID[E.party] ?? rivalParty(g) : rivalParty(g);
  const left = Math.max(0, Math.ceil(E.next - g.day));
  const target = approvalTarget(g);
  const ap = Math.round(E.approval);
  const trend = target - E.approval;
  return (
    <Card title="🗳️ Выборы" sub={E.campaign ? `кампания · ${left} дн.` : `через ${fmtDays(left)}`}
      hint={`Выборы — раз в ${Math.round((CYCLE[c.gov] ?? 1460) / 365)} года; за ${CAMPAIGN} дней до них начинается кампания. Рейтинг власти растёт от стабильности, роста экономики, низких налогов и сдержанных обещаний, падает от голода, войн, долгов и усталости от одной и той же власти. Победа — мандат доверия, поражение — год коалиции с победившей партией.`}>
      <div class="el-head">
        <div class={`el-ap ${ap >= 50 ? 'up' : 'down'}`}>
          <b class="num">{ap}%</b>
          <span class="small muted">рейтинг власти {Math.abs(trend) >= 1 ? (trend > 0 ? '▲' : '▼') : ''}</span>
        </div>
        <div class="el-date small muted">🗓️ {fmtDate(E.next)}</div>
      </div>
      <div class="el-bar">
        <Bar value={E.approval / 100} color={ap >= 55 ? 'green' : ap < 48 ? 'red' : undefined} />
        <i class="el-half" title="50% — порог победы" />
      </div>
      <div class="small muted" style={{ marginTop: '4px' }}>Чтобы победить, нужно больше 50%. Рейтинг стремится к {Math.round(target)}%.</div>
      <More label="Из чего складывается">
        <KV rows={approvalParts(g).map(([k, v]): [string, ComponentChildren] => [k, <span class={v >= 0 ? 'up' : 'down'}>{v > 0 ? '+' : ''}{v.toFixed(1)}</span>])} />
      </More>
      <div class="el-rival">
        <span class="big-ic">{party.icon}</span>
        <div class="grow">
          <div><b>{party.name}</b>{E.campaign && <span class="muted"> · {E.leader}</span>}</div>
          <div class="small">«{party.slogan}»</div>
          <div class="small muted">{E.campaign ? 'Если победят' : 'Главная оппозиция сейчас; если победит'} — условия на год: {party.terms}</div>
        </div>
      </div>
      {E.promise && <PromiseLine title="Наше обещание" icon={promiseIcon(E.promise)} text={promiseText(g, E.promise)} ok={promiseOk(g, E.promise)} note="выполнить за год после победы" />}
      {E.mandate && (
        <PromiseLine title="Обещание избирателям" icon={promiseIcon(E.mandate)} text={promiseText(g, E.mandate)} ok={promiseOk(g, E.mandate)}
          note={`срок — ${fmtDays(Math.max(0, (E.mandate.until ?? g.day) - g.day))}`} />
      )}
      {coal && E.coalition && (
        <div class="el-coal small">🤝 Коалиция с партией «{PARTY_BY_ID[coal].name}»: {PARTY_BY_ID[coal].terms} — ещё {fmtDays(E.coalition.until - g.day)}</div>
      )}
      {E.campaign && <Campaign />}
      {E.last && (
        <div class="small muted" style={{ marginTop: '8px' }}>
          Прошлые выборы ({fmtDate(E.last.day)}): {E.last.ours}% — {E.last.won ? 'победа' : 'поражение'} · побед всего: {g.counters.electionsWon ?? 0}
        </div>
      )}
    </Card>
  );
}

function PromiseLine({ title, icon, text, ok, note }: { title: string; icon: string; text: string; ok: boolean; note: string }) {
  return (
    <div class={`el-promise ${ok ? 'ok' : ''}`}>
      <span class="big-ic">{icon}</span>
      <div class="grow">
        <div class="small muted">{title} · {note}</div>
        <b>{text}</b>
      </div>
      <span class={ok ? 'up' : 'muted'}>{ok ? '✓' : '…'}</span>
    </div>
  );
}

function Campaign() {
  const g = getGame()!;
  const hint: Record<string, string> = {
    rally: `💰 ${fmt(rallyCost(g))}, раз в 15 дней`,
    debate: `шанс блеснуть ${Math.round(debateChance(g) * 100)}%, раз за кампанию`,
    rig: g.countries[g.player].gov === 'democracy' ? 'вскроется с шансом 45%' : 'вскроется с шансом 35%',
    cancel: 'выборы перенесут на год',
  };
  const act = (id: string, name: string, desc: string) => {
    const run = () => report(campaignAct(g, id));
    if (id === 'rig' || id === 'cancel') setUI({ modal: { kind: 'confirm', danger: true, title: name, okText: id === 'rig' ? 'Подтасовать' : 'Отменить выборы', text: `${desc}.`, ok: run } });
    else run();
  };
  return (
    <div class="el-acts">
      <div class="small muted" style={{ margin: '10px 0 6px' }}>📣 Предвыборная кампания</div>
      <div class="grid2">
        {CAMPAIGN_ACTS.map((a) => {
          const err = actError(g, a.id);
          return (
            <button key={a.id} class={`btn sm el-act ${a.id === 'rig' || a.id === 'cancel' ? 'danger' : a.id === 'debate' ? 'ghost' : ''}`} disabled={!!err} title={err ?? a.desc}
              onClick={() => act(a.id, `${a.icon} ${a.name}`, a.desc)}>
              <span>{a.icon} {a.name}</span>
              <span class="el-act-h">{err ?? hint[a.id]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
