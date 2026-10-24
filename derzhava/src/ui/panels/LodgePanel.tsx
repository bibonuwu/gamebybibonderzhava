// Тайная ложа: посвящение, степень и влияние, подозрение газет, поручения, тайные услуги, братья и выборы.
import { useState } from 'preact/hooks';
import { STATS } from '../../game/economy';
import { fmt, fmtDays } from '../../game/format';
import {
  BAN_STAB, banLodge, buyVotesCost, coupChance, declineTask, infRate, joinLodge, knock, knockCost, knockError, leaveLodge,
  liftBan, LODGE_NAME, OPS, opCost, opError, opWait, rankOf, RANKS, refuseLodge, runOp, taskDef, taskProgress, taskText,
  visibleMembers, type OpDef,
} from '../../game/lodge';
import { getGame } from '../../game/state';
import { P5 } from '../../game/un';
import { COUNTRY_DEFS } from '../../game/world';
import { Bar, Card, Flag, Rate, RelBar } from '../common';
import { report, setUI, useStore } from '../store';

/** Герб ложи: всевидящее око в треугольнике, циркуль и наугольник. */
export function LodgeCrest({ size = 76 }: { size?: number }) {
  return (
    <svg class="lodge-crest" viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="lc-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffe9a8" />
          <stop offset="1" stop-color="#b8862e" />
        </linearGradient>
        <radialGradient id="lc-glow" cx="0.5" cy="0.55" r="0.5">
          <stop offset="0" stop-color="#f2d78b" stop-opacity="0.45" />
          <stop offset="1" stop-color="#f2d78b" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="64" r="58" fill="url(#lc-glow)" />
      <g class="lc-rays">
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i * Math.PI) / 8;
          return <line key={i} x1={60 + Math.cos(a) * 30} y1={64 + Math.sin(a) * 30} x2={60 + Math.cos(a) * 56} y2={64 + Math.sin(a) * 56} stroke="#f2d78b" stroke-width={i % 2 ? 1 : 2} opacity="0.35" />;
        })}
      </g>
      {/* циркуль и наугольник */}
      <path d="M60 10 L28 108 M60 10 L92 108" stroke="#c99a3d" stroke-width="3" stroke-linecap="round" opacity="0.55" />
      <circle cx="60" cy="10" r="4" fill="#c99a3d" opacity="0.7" />
      <path d="M22 96 L60 116 L98 96" stroke="#c99a3d" stroke-width="4" fill="none" stroke-linejoin="round" opacity="0.55" />
      <path d="M60 24 L100 92 L20 92 Z" fill="#14100a" stroke="url(#lc-gold)" stroke-width="3.5" stroke-linejoin="round" />
      <g class="lc-eye">
        <path d="M36 70 Q60 46 84 70 Q60 92 36 70 Z" fill="#fff6dc" stroke="#d8b45c" stroke-width="1.5" />
        <g class="lc-iris">
          <circle cx="60" cy="70" r="9" fill="#5b3d12" />
          <circle cx="60" cy="70" r="4" fill="#0b0805" />
          <circle cx="57" cy="67" r="2" fill="#fff" />
        </g>
      </g>
    </svg>
  );
}

export function LodgePanel() {
  useStore();
  const g = getGame()!;
  return g.lodge.status === 'member' ? <Member /> : <Outsider />;
}

// ---------- член ложи ----------
function Member() {
  const g = getGame()!;
  const L = g.lodge;
  const me = g.player;
  const r = rankOf(g);
  const R = RANKS[r];
  const next = r < 2 ? RANKS[r + 1] : null;
  const s = STATS[me];
  const susp = L.suspicion;
  const suspText = L.open
    ? '📢 Членство открыто: разоблачать нечего, но каждая тайная услуга злит народ'
    : susp < 25 ? 'Тайна в безопасности' : susp < 50 ? 'Журналисты что-то пронюхали' : 'Разоблачение может случиться в любой день';
  return (
    <>
      <div class="lodge-hero">
        <LodgeCrest />
        <div class="lh-main">
          <div class="lh-name">Ложа «{LODGE_NAME}»</div>
          <div class="lh-rank"><span class="lh-pill">{R.icon} {R.name}</span><span class="small muted">степень {r + 1} из {RANKS.length}</span></div>
          <div class="lh-inf">
            <b class="num">🔺 {fmt(L.inf[me])}</b>
            <span class="small muted"> влияния · +{infRate(g, me).toFixed(2)}/день</span>
          </div>
        </div>
      </div>
      <Card title="🪜 Путь посвящения" sub={next ? `${fmt(L.merit)} / ${fmt(next.merit)}` : r === 2 ? 'дальше — выборы' : 'вершина пути'}
        hint="Заслуги копятся от взносов, поручений ложи и пожертвований и не тратятся. Каждая новая степень открывает тайные услуги. Великого мастера раз в два года избирают братья — побеждает самый влиятельный (🔺).">
        <div class="lodge-steps">
          {RANKS.map((x, i) => (
            <div key={x.name} class={`ls-step ${i <= r ? 'on' : ''} ${i === r ? 'cur' : ''}`}>
              <span class="ls-ic">{x.icon}</span>
              <span class="ls-n">{x.name}</span>
            </div>
          ))}
        </div>
        {next && <div style={{ marginTop: '8px' }}><Bar value={(L.merit - R.merit) / (next.merit - R.merit)} /></div>}
        {!next && r === 2 && <div class="small muted" style={{ marginTop: '6px' }}>Выше — только Великий мастер: его избирают братья через {fmtDays(L.nextElection - g.day)}.</div>}
        <div class="row between small" style={{ marginTop: '8px' }}>
          <span class="muted">🔺 Взносы ложи (1% налогов)</span>
          <Rate v={-s.lodgeDues} />
        </div>
        {s.lodgeTithe > 0 && (
          <div class="row between small">
            <span class="muted">👁️ Десятина Великому мастеру</span>
            <Rate v={s.lodgeTithe} />
          </div>
        )}
      </Card>
      <Card title="🕵️ Подозрение газет" sub={L.open ? 'открыто' : `${Math.round(susp)}%`}
        hint="Каждая тайная услуга поднимает подозрение, со временем оно забывается (при свободной прессе — медленнее). Чем оно выше, тем вероятнее, что газеты нас разоблачат.">
        {!L.open && <Bar value={susp / 100} color={susp >= 50 ? 'red' : susp < 25 ? 'green' : undefined} />}
        <div class={`small ${!L.open && susp >= 50 ? 'down' : 'muted'}`} style={{ marginTop: '6px' }}>{suspText}</div>
        {(L.shield ?? 0) > g.day && <div class="small up" style={{ marginTop: '4px' }}>🌐 Кулуары ООН: братья прикрывают нас ещё {fmtDays(L.shield! - g.day)}</div>}
      </Card>
      <TaskCard />
      <OpsCard />
      <Brothers />
      <button
        class="btn ghost block"
        onClick={() => setUI({ modal: { kind: 'confirm', danger: true, title: '🚪 Выйти из ложи?', okText: 'Выйти',
          text: 'Всё 🔺 влияние и заслуги сгорят, братья обидятся (отношения −15). Вернуться можно, но начинать придётся с Ученика.',
          ok: () => leaveLodge(g) } })}
      >
        🚪 Выйти из ложи
      </button>
    </>
  );
}

function TaskCard() {
  const g = getGame()!;
  const t = g.lodge.task;
  if (!t) {
    return (
      <Card title="📜 Поручение ложи">
        <div class="small muted">Новое поручение — через {Math.max(1, Math.ceil(g.lodge.nextTask - g.day))} дн. Исполненные поручения дают 🔺 и заслуги.</div>
      </Card>
    );
  }
  const def = taskDef(t);
  const left = Math.max(0, Math.ceil(t.until - g.day));
  return (
    <Card title="📜 Поручение ложи" sub={`🔺 +${t.reward}`} hint="Не успеете в срок — ложа отнимет 🔺10. Отказ стоит 🔺5.">
      <div class="lodge-task">
        <span class="big-ic">{def?.icon ?? '📜'}</span>
        <div class="grow">
          <b>{taskText(g, t)}</b>
          <div style={{ marginTop: '6px' }}><Bar value={taskProgress(g, t)} /></div>
          <div class="small muted" style={{ marginTop: '4px' }}>⏳ срок: {left} дн.</div>
        </div>
      </div>
      <button class="btn ghost sm" style={{ marginTop: '8px' }} onClick={() => { declineTask(g); report(null, '📜 Мы отказались от поручения (−🔺5)'); }}>Отказаться</button>
    </Card>
  );
}

function OpsCard() {
  const g = getGame()!;
  const [open, setOpen] = useState<string | null>(null);
  const r = rankOf(g);
  return (
    <Card title="🗝️ Тайные услуги" sub={`🔺 ${fmt(g.lodge.inf[g.player])}`}
      hint="Услуги оплачиваются 🔺 влиянием и поднимают 🕵️ подозрение. Новые услуги открываются с каждой степенью. Великому мастеру всё обходится на 30% дешевле.">
      {OPS.map((op) => (
        <OpRow key={op.id} op={op} locked={r < op.rank} open={open === op.id} onToggle={() => setOpen(open === op.id ? null : op.id)} />
      ))}
    </Card>
  );
}

function OpRow({ op, locked, open, onToggle }: { op: OpDef; locked: boolean; open: boolean; onToggle: () => void }) {
  const g = getGame()!;
  const err = opError(g, op.id);
  const wait = opWait(g, op);
  const cost = opCost(g, op);
  const go = (t = -1) => {
    const run = () => report(runOp(g, op.id, t));
    if (op.id === 'coup') {
      setUI({ modal: { kind: 'confirm', danger: true, title: `🔥 Переворот: ${COUNTRY_DEFS[t].name}?`, okText: 'Начать заговор',
        text: `Шанс успеха — ${Math.round(coupChance(g, t) * 100)}%. Удастся — новое правительство станет нам другом и вступит в ложу. Провалится — подозрение +20 сверх обычного, отношения −35.`,
        ok: run } });
    } else run();
  };
  const meta = [cost ? `🔺${cost}` : '', op.money ? `💰${fmt(op.money(g))}` : '', op.susp ? `🕵️+${op.susp}` : ''].filter(Boolean).join(' · ');
  return (
    <div class={`lodge-op ${locked ? 'locked' : ''}`}>
      <div class="row">
        <span class="big-ic">{op.icon}</span>
        <div class="grow">
          <b>{op.name}</b>
          <div class="small muted">{op.desc}</div>
          <div class="small lo-meta">{locked ? `🔒 степень «${RANKS[op.rank].name}»` : meta}{!locked && wait > 0 ? ` · ⏳ ${wait} дн.` : ''}</div>
        </div>
        {!locked && (
          <button class="btn sm" disabled={!!err} title={err ?? undefined} onClick={() => (op.choices ? onToggle() : go())}>
            {op.choices ? (open ? 'Скрыть' : 'Цель ▾') : 'Заказать'}
          </button>
        )}
      </div>
      {open && !err && op.choices && (
        <div class="lo-targets">
          {op.choices(g).map((c) => (
            <button key={c.v} class="lo-target" onClick={() => go(c.v)}>
              {c.flag !== undefined && <Flag id={c.flag} />}
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Brothers() {
  const g = getGame()!;
  const L = g.lodge;
  const me = g.player;
  const list = visibleMembers(g).sort((a, b) => L.inf[b] - L.inf[a]);
  const fav = list[0];
  return (
    <Card title="🤝 Братья" sub={`${list.length}`}
      hint="Братья дружат между собой, охотнее подписывают договоры и не нападают друг на друга. Поднять меч на брата — значит быть изгнанным навсегда. 🔺 — влияние в ложе, от него зависят выборы Великого мастера.">
      <div class="small muted" style={{ marginBottom: '6px' }}>
        🗳️ Выборы Великого мастера через {fmtDays(Math.max(0, L.nextElection - g.day))}
        {fav !== undefined && <> · у нас 🔺{fmt(L.inf[me])}, у фаворита 🔺{fmt(L.inf[fav])}</>}
        {L.master !== me && <> · купить голоса: 💰{fmt(buyVotesCost(g))}</>}
      </div>
      {L.master === me && <div class="lodge-gm">👁️ Великий мастер — мы</div>}
      {list.map((k) => (
        <div class="list-item tap" key={k} onClick={() => setUI({ modal: { kind: 'country', id: k } })}>
          <Flag id={k} />
          <div class="grow">
            <div class="row wrap" style={{ gap: '6px' }}>
              <b>{COUNTRY_DEFS[k].name}</b>
              {L.master === k && <span class="chip lodge" title="Великий мастер ложи">👁️ мастер</span>}
              {P5.includes(k) && <span class="chip" title="Постоянный член Совбеза ООН">🌐 Совбез</span>}
              {L.known.includes(k) && <span class="chip" title="Газеты раскрыли его членство">📰 раскрыт</span>}
            </div>
            <div class="small muted">🔺 {fmt(L.inf[k])}</div>
          </div>
          <RelBar v={g.rel[me][k]} />
        </div>
      ))}
    </Card>
  );
}

// ---------- вне ложи ----------
function Outsider() {
  const g = getGame()!;
  const L = g.lodge;
  const me = g.player;
  const known = visibleMembers(g);
  const total = L.members.filter((k) => k !== me && g.countries[k].alive).length;
  const relig = g.countries[me].religion;
  const head: Record<string, [string, string]> = {
    none: ['Приглашение', 'Нам прислали письмо: ложа зовёт нас в свои ряды. Решение — за нами.'],
    refused: ['Двери ещё открыты', 'Мы отказались от посвящения. Ложа помнит, но готова принять нас, если постучимся сами.'],
    banned: ['Ложа под запретом', 'Мы запретили ложу в стране. Народ доволен, но братья мстят: газеты, бойкоты, забастовки.'],
    expelled: ['Изгнаны навсегда', 'Мы подняли меч на брата. Двери ложи для нас закрыты.'],
  };
  const [title, text] = head[L.status] ?? head.none;
  const kerr = knockError(g);
  return (
    <>
      <div class="lodge-hero">
        <LodgeCrest />
        <div class="lh-main">
          <div class="lh-name">Ложа «{LODGE_NAME}»</div>
          <div class="lh-rank"><span class="lh-pill">{title}</span></div>
          <div class="small muted">{text}</div>
        </div>
      </div>
      <Card title="👁️ Что это за ложа" fold="lodge-about" open>
        <div class="small col" style={{ gap: '4px' }}>
          <div>🤝 Вольные каменщики — тайный союз правителей. Братья дружат, охотнее подписывают договоры и не воюют друг с другом.</div>
          <div>🪜 Степени: Ученик → Подмастерье → Мастер → Великий мастер. Влияние (🔺) — за взносы, поручения ложи и пожертвования.</div>
          <div>🗝️ Тайные услуги: касса взаимопомощи, биржевой сговор, компромат, кулуары ООН, переворот в чужой стране.</div>
          <div>🕵️ Но каждое тайное дело поднимает подозрение газет — и однажды о нём узнает вся страна.</div>
        </div>
      </Card>
      {L.status === 'none' && (
        <Card title="✉️ Ответ ложе">
          <div class="col">
            <button class="btn block shine" onClick={() => report(joinLodge(g))}>🕯️ Принять посвящение</button>
            <button class="btn ghost block" onClick={() => { refuseLodge(g); report(null); }}>🚪 Вежливо отказаться</button>
            <button class="btn danger block" onClick={() => report(banLodge(g))}>🚫 Запретить ложу (стабильность +{BAN_STAB[relig]} на год, братья будут мстить)</button>
            <button class="btn ghost block" onClick={() => setUI({ modal: { kind: 'mail' } })}>📬 Перечитать письмо</button>
          </div>
        </Card>
      )}
      {L.status === 'refused' && (
        <Card title="🚪 Постучать в дверь">
          <div class="col">
            <button class="btn block" disabled={!!kerr} title={kerr ?? undefined} onClick={() => report(knock(g))}>🕯️ Попросить о посвящении · 💰 {fmt(knockCost(g))}</button>
            {kerr && kerr !== 'Не хватает денег' && <div class="small muted">{kerr}</div>}
            <button class="btn danger block" onClick={() => report(banLodge(g))}>🚫 Запретить ложу</button>
          </div>
        </Card>
      )}
      {L.status === 'banned' && (
        <Card title="⚖️ Запрет">
          <button class="btn ghost block" onClick={() => report(liftBan(g), '⚖️ Запрет на ложу снят')}>Снять запрет (стабильность −3, братья смягчатся)</button>
        </Card>
      )}
      <Card title="📰 Известные масоны" sub={`${known.length} из ~${total}`}
        hint="Членство в ложе — тайна. Здесь только те, кого разоблачили газеты.">
        {known.length === 0 && <div class="small muted">Газеты пока никого не разоблачили. По слухам, в ложе правители {total} стран.</div>}
        {known.map((k) => (
          <div class="list-item tap" key={k} onClick={() => setUI({ modal: { kind: 'country', id: k } })}>
            <Flag id={k} />
            <div class="grow"><b>{COUNTRY_DEFS[k].name}</b>{L.master === k && <span class="small muted"> · по слухам, Великий мастер</span>}</div>
            <RelBar v={g.rel[me][k]} />
          </div>
        ))}
      </Card>
    </>
  );
}
