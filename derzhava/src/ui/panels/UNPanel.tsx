// Вкладка «ООН»: Генеральный секретарь, Генеральная Ассамблея (голосование и свои резолюции),
// дела об агрессии, Совет Безопасности и архив решений.
import { useState } from 'preact/hooks';
import {
  castVote, draft, forecastRes, isSG, pending, proposeError, proposeRes, RES_BY_ID, resCost, RESOLUTIONS, resWait, type ResDef,
} from '../../game/assembly';
import { fmt, fmtDate, fmtDays } from '../../game/format';
import { isMember } from '../../game/lodge';
import { inOrder } from '../../game/order';
import { getGame } from '../../game/state';
import type { GAVote, UNResolution } from '../../game/types';
import { P5 } from '../../game/un';
import { COUNTRY_DEFS } from '../../game/world';
import { Card, Flag, RelBar, Seg } from '../common';
import { report, setUI, useStore } from '../store';
import { UNCard } from './DiploPanel';

/** Эмблема: земной шар в оливковых ветвях. */
export function UNEmblem({ size = 76 }: { size?: number }) {
  // листья по дуге снизу вверх; правая ветвь — зеркало левой
  const leaves = (s: 1 | -1) => Array.from({ length: 7 }, (_, i) => {
    const deg = 100 + i * 18;
    const a = (deg * Math.PI) / 180;
    const x = 60 + s * 46 * Math.cos(a), y = 60 + 46 * Math.sin(a);
    const rot = s === 1 ? deg + 90 : 90 - deg;
    return <ellipse key={`${s}${i}`} cx={x} cy={y} rx="7.5" ry="3.2" transform={`rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})`} fill="#9cc3f5" opacity="0.85" />;
  });
  return (
    <svg class="un-emblem" viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
      <defs>
        <radialGradient id="un-sea" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stop-color="#4f8fe0" />
          <stop offset="1" stop-color="#173a6e" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="58" r="54" fill="rgba(91, 146, 229, 0.12)" />
      {leaves(1)}
      {leaves(-1)}
      <g class="un-globe">
        <circle cx="60" cy="56" r="32" fill="url(#un-sea)" stroke="#cfe2ff" stroke-width="2" />
        <ellipse cx="60" cy="56" rx="13" ry="32" fill="none" stroke="#cfe2ff" stroke-width="1.2" opacity="0.7" />
        <ellipse cx="60" cy="56" rx="25" ry="32" fill="none" stroke="#cfe2ff" stroke-width="1" opacity="0.45" />
        <line x1="28" y1="56" x2="92" y2="56" stroke="#cfe2ff" stroke-width="1.2" opacity="0.7" />
        <path d="M32 42 H88 M32 70 H88" stroke="#cfe2ff" stroke-width="1" opacity="0.45" />
        <line x1="60" y1="24" x2="60" y2="88" stroke="#cfe2ff" stroke-width="1.2" opacity="0.7" />
      </g>
      <path d="M48 104 Q60 96 72 104" stroke="#9cc3f5" stroke-width="3" fill="none" stroke-linecap="round" />
    </svg>
  );
}

export function UNPanel() {
  useStore();
  const g = getGame()!;
  const A = g.assembly;
  const me = g.player;
  const members = g.countries.filter((c) => c.alive).length;
  const friends = g.countries.filter((c) => c.alive && c.idx !== me && g.rel[c.idx][me] > 10).length;
  return (
    <>
      <div class="un-hero">
        <UNEmblem />
        <div class="lh-main">
          <div class="un-name">Организация Объединённых Наций</div>
          <div class="small muted">Государств-членов: {members} · к нам расположены: {friends}</div>
          <div class="un-sg">
            {A.sg >= 0 && g.countries[A.sg].alive ? (
              <>
                <Flag id={A.sg} />
                <span>Генсек: <b>{A.sg === me ? 'мы' : COUNTRY_DEFS[A.sg].name}</b></span>
              </>
            ) : <span>Генсек не избран</span>}
          </div>
          <div class="small muted">🗳️ Выборы Генсека через {fmtDays(Math.max(0, A.nextSG - g.day))}</div>
        </div>
      </div>
      {isSG(g) && <div class="un-sg-banner">🌐 Генеральный секретарь — мы: стабильность +3, резолюции вдвое дешевле и чаще, наш голос весомее</div>}
      <VotingCard />
      <ProposeCard />
      {g.un.length ? <UNCard /> : (
        <Card title="⚖️ Дела об агрессии">
          <div class="small muted">Мир спокоен: дел нет. Кто нападёт без причины, того осудит Совбез — санкции, эмбарго, а без вето и коалиция.</div>
        </Card>
      )}
      <CouncilCard />
      <ArchiveCard />
    </>
  );
}

const VOTE_LABEL: Record<GAVote, string> = { yes: '✅ За', no: '❌ Против', abstain: '🤐 Воздержаться' };

/** Название резолюции без значка, с флагами сторон. */
function ResName({ r }: { r: UNResolution }) {
  const def = RES_BY_ID[r.kind];
  return (
    <span class="row wrap" style={{ gap: '5px' }}>
      <b>{def?.name ?? 'Резолюция'}</b>
      {r.target !== undefined && <><Flag id={r.target} /><span>{COUNTRY_DEFS[r.target].name}</span></>}
      {r.target2 !== undefined && <><span class="muted">—</span><Flag id={r.target2} /><span>{COUNTRY_DEFS[r.target2].name}</span></>}
    </span>
  );
}

function VotingCard() {
  const g = getGame()!;
  const list = pending(g);
  return (
    <Card title="🗳️ Генассамблея голосует" sub={`${list.length}`}
      hint="Голосуют все страны: по отношению к автору и к цели. Решает большинство, нужно хотя бы 3 «за». Не проголосовали — значит, воздержались. Автор помнит, кто его поддержал.">
      {!list.length && <div class="small muted">Сейчас ничего не голосуется. Внесите свою резолюцию — ниже.</div>}
      {list.map((r) => <ResVote key={r.id} r={r} />)}
    </Card>
  );
}

function ResVote({ r }: { r: UNResolution }) {
  const g = getGame()!;
  const me = g.player;
  const def = RES_BY_ID[r.kind];
  const f = forecastRes(g, r);
  const mine = r.by === me;
  const vsUs = r.kind === 'condemn' && r.target === me;
  return (
    <div class={`un-res ${vsUs ? 'vs-us' : ''}`}>
      <div class="row" style={{ gap: '8px', alignItems: 'flex-start' }}>
        <span class="big-ic">{def.icon}</span>
        <div class="grow">
          <ResName r={r} />
          <div class="small muted">
            вносит {mine ? 'наша страна' : COUNTRY_DEFS[r.by].name} · голосование через {Math.max(0, r.vote - g.day)} дн.
          </div>
          <div class="small muted">{def.desc}</div>
        </div>
      </div>
      <div class="un-forecast small">
        <span class="up">✅ {f.yes}</span>
        <span class="down">❌ {f.no}</span>
        <span class="muted">🤐 {f.abstain}</span>
        <span class={f.pass ? 'up' : 'down'}>прогноз: {f.pass ? 'примут' : 'отклонят'}</span>
      </div>
      {mine ? <div class="small up">Это наша резолюция — мы, конечно, «за»</div> : (
        <>
          <Seg<GAVote> value={r.myVote ?? 'abstain'} onChange={(v) => report(castVote(g, r.id, v))}
            options={(['yes', 'no', 'abstain'] as GAVote[]).map((v) => ({ v, label: VOTE_LABEL[v] }))} />
          {def.yesHint && <div class="small muted" style={{ marginTop: '4px' }}>Если «за» и примут: {def.yesHint(g, r)}</div>}
        </>
      )}
    </div>
  );
}

function ProposeCard() {
  const g = getGame()!;
  const [open, setOpen] = useState<string | null>(null);
  const busy = pending(g).some((r) => r.by === g.player);
  return (
    <Card title="📜 Внести резолюцию" sub={isSG(g) ? 'Генсеку −50%' : undefined}
      hint="Через 5 дней резолюцию голосуют все страны. Справа у каждой цели — прогноз «за : против». Братья нашей ложи голосуют вместе с нами, а официальная ложа (наблюдатель ООН) — ровно как мы.">
      {busy && <div class="small muted" style={{ marginBottom: '4px' }}>Наша резолюция уже на голосовании — дождитесь итога.</div>}
      {RESOLUTIONS.map((def) => (
        <ProposeRow key={def.id} def={def} open={open === def.id} onToggle={() => setOpen(open === def.id ? null : def.id)} />
      ))}
    </Card>
  );
}

function ProposeRow({ def, open, onToggle }: { def: ResDef; open: boolean; onToggle: () => void }) {
  const g = getGame()!;
  const me = g.player;
  const err = proposeError(g, def.id);
  const wait = resWait(g, def);
  const go = (t?: number, t2?: number) => {
    report(proposeRes(g, def.id, t, t2), '🌐 Резолюция внесена — голосование через 5 дн.');
    if (def.targets) onToggle();
  };
  const fc = (t?: number, t2?: number) => forecastRes(g, draft(g, def.id, t, t2));
  const plain = !def.targets && !err ? fc() : null;
  return (
    <div class="lodge-op">
      <div class="row">
        <span class="big-ic">{def.icon}</span>
        <div class="grow">
          <b>{def.name}</b>
          <div class="small muted">{def.desc}</div>
          <div class="small lo-meta">
            💰{fmt(resCost(g, def))}{wait > 0 ? ` · ⏳ ${wait} дн.` : ''}
            {plain && <> · прогноз <span class={plain.pass ? 'up' : 'down'}>{plain.yes} : {plain.no}</span></>}
          </div>
        </div>
        <button class="btn sm" disabled={!!err} title={err ?? undefined} onClick={() => (def.targets ? onToggle() : go())}>
          {def.targets ? (open ? 'Скрыть' : 'Цель ▾') : 'Внести'}
        </button>
      </div>
      {open && !err && def.targets && (
        <div class="lo-targets">
          {def.targets(g, me).map((x) => {
            const f = fc(x.t, x.t2);
            return (
              <button key={`${x.t}-${x.t2 ?? ''}`} class="lo-target" onClick={() => go(x.t, x.t2)}>
                <Flag id={x.t} />
                {x.t2 !== undefined && <Flag id={x.t2} />}
                <span>{x.label}</span>
                <span class={f.pass ? 'up' : 'down'}>{f.yes}:{f.no}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CouncilCard() {
  const g = getGame()!;
  const me = g.player;
  return (
    <Card title="🏛️ Совет Безопасности" sub="5 постоянных членов" fold="un-council"
      hint="Постоянные члены Совбеза голосуют по делам об агрессии: одно вето блокирует резолюцию (коалицию и эмбарго), но не санкции несогласных. На выборах Генсека любой из них может наложить вето на кандидата, к которому плохо относится.">
      {P5.map((k) => (
        <div class="list-item tap" key={k} onClick={() => (k === me ? undefined : setUI({ modal: { kind: 'country', id: k } }))}>
          <Flag id={k} />
          <div class="grow">
            <div class="row wrap" style={{ gap: '6px' }}>
              <b>{COUNTRY_DEFS[k].name}</b>
              {k === me && <span class="chip ally">это мы · право вето</span>}
              {!g.countries[k].alive && <span class="chip war">страны больше нет</span>}
              {inOrder(g, k) && <span class="chip lodge">{g.order!.emblem} брат</span>}
              {g.lodge.status === 'member' && isMember(g, k) && k !== me && <span class="chip lodge">👁️ брат</span>}
            </div>
          </div>
          {k !== me && g.countries[k].alive && <RelBar v={g.rel[me][k]} />}
        </div>
      ))}
    </Card>
  );
}

function ArchiveCard() {
  const g = getGame()!;
  const me = g.player;
  const done = g.assembly.res.filter((r) => r.passed !== undefined);
  if (!done.length) return null;
  return (
    <Card title="📚 Архив резолюций" sub={`${done.length}`} fold="un-archive">
      {done.map((r) => (
        <div class="un-arch" key={r.id}>
          <span class="big-ic">{r.passed ? '✅' : '❌'}</span>
          <div class="grow">
            <div class="row wrap" style={{ gap: '5px' }}>{RES_BY_ID[r.kind]?.icon} <ResName r={r} /></div>
            <div class="small muted">
              {r.by === me ? 'наша' : COUNTRY_DEFS[r.by].name} · {fmtDate(r.vote)} · {r.yes?.length ? `${r.yes.length} за, ${r.no?.length ?? 0} против` : 'снята с голосования'}
              {r.myVote && r.by !== me && ` · мы: ${VOTE_LABEL[r.myVote].slice(2).toLowerCase()}`}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}
