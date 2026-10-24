// Почта: кнопка на карте, летящий конверт при новом письме, ящик писем и само письмо — с картинкой, маркой и сургучом.
import { useEffect, useState } from 'preact/hooks';
import { fmtDate } from '../game/format';
import { answerLetter, claimLetter, giftParts, readLetter, unreadMail } from '../game/mail';
import { emit, getGame, sfx, toast } from '../game/state';
import type { GameState, Letter } from '../game/types';
import { Effects } from './common';
import { LetterArt } from './mailArt';
import { prefs, report, setUI, ui, useStore } from './store';

const open = (id?: number) => setUI({ modal: { kind: 'mail', id } });

/** Конверт перелетает от верха экрана в кнопку почты. */
function flyEnvelope(color: string) {
  if (!prefs.fx) return;
  const target = document.querySelector('.mail-fab');
  const el = document.createElement('div');
  el.className = 'fx-envelope';
  el.style.setProperty('--seal', color);
  document.body.appendChild(el);
  const sx = window.innerWidth / 2, sy = window.innerHeight * 0.32;
  const r = target?.getBoundingClientRect();
  const tx = r ? r.left + r.width / 2 : sx, ty = r ? r.top + r.height / 2 : -40;
  const anim = el.animate(
    [
      { transform: `translate(${sx}px, ${sy - 80}px) translate(-50%, -50%) scale(0.3) rotate(-30deg)`, opacity: 0 },
      { transform: `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(1.25) rotate(6deg)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(1.1) rotate(-4deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${tx}px, ${ty}px) translate(-50%, -50%) scale(0.35) rotate(18deg)`, opacity: 0.9 },
    ],
    { duration: 1500, easing: 'cubic-bezier(.45,0,.4,1)' },
  );
  anim.onfinish = () => {
    el.remove();
    target?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(0.95)' }, { transform: 'scale(1)' }], { duration: 480, easing: 'ease-out' });
  };
  setTimeout(() => el.remove(), 2500);
}

// какое письмо уже показывали как «новое» (по партии)
let seenGame: GameState | null = null;
let seenTop = -1;

/** Кнопка почты на карте и всплывающее «Новое письмо». */
export function MailButton() {
  useStore();
  const g = getGame();
  const [fresh, setFresh] = useState<Letter | null>(null);
  const top = g?.mail[0];
  useEffect(() => {
    if (!g) return;
    if (seenGame !== g) {
      seenGame = g;
      seenTop = top?.id ?? -1;
      return;
    }
    if (!top || top.id <= seenTop) return;
    seenTop = top.id;
    if (top.read) return;
    setFresh(top);
    flyEnvelope(top.seal);
  }, [g, top?.id]);
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), 6000);
    return () => clearTimeout(t);
  }, [fresh?.id]);
  if (!g || g.gameOver) return null;
  const n = unreadMail(g);
  const gifts = g.mail.filter((l) => l.gift && !l.claimed).length;
  const onMap = ui.tab === 'map';
  return (
    <>
      {onMap && (
        <button class={`mail-fab ${n ? 'has' : ''}`} onClick={() => open(g.mail.find((l) => !l.read)?.id)} title="Почта (M)">
          <span class="mi">{n ? '📬' : '📭'}</span>
          <span class="ml">Почта</span>
          {n > 0 && <span class="badge">{n}</span>}
          {gifts > 0 && <span class="mail-gift" aria-label="Есть подарки">🎁</span>}
        </button>
      )}
      {fresh && !fresh.read && !ui.modal && (
        <button class="mail-pop" key={fresh.id} onClick={() => { setFresh(null); open(fresh.id); }} style={{ '--seal': fresh.seal }}>
          <span class="mp-env"><i />{fresh.icon}</span>
          <span class="mp-body">
            <span class="mp-t">✉️ Новое письмо{fresh.gift ? ' · 🎁 с подарком' : ''}</span>
            <span class="mp-s">{fresh.from}: «{fresh.subject}»</span>
          </span>
          <span class="mp-go">Открыть</span>
        </button>
      )}
    </>
  );
}

export function MailModal({ id, quick }: { id?: number; quick?: boolean }) {
  useStore();
  const g = getGame()!;
  const L = id !== undefined ? g.mail.find((l) => l.id === id) : undefined;
  const close = () => setUI({ modal: null });
  return (
    <div class="modal-bg mail-bg" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      {L ? <LetterView key={L.id} L={L} quick={quick} /> : <Inbox />}
    </div>
  );
}

function Inbox() {
  const g = getGame()!;
  const n = unreadMail(g);
  const close = () => setUI({ modal: null });
  return (
    <div class="modal inbox">
      <div class="m-ic">📬</div>
      <h2>Почта</h2>
      <p class="small muted">{g.mail.length ? (n ? `Непрочитанных: ${n}` : 'Всё прочитано') : 'Писем пока нет — они скоро придут.'}</p>
      <div class="inbox-list">
        {g.mail.map((l, i) => (
          <button key={l.id} class={`env-row ${l.read ? '' : 'unread'}`} style={{ '--seal': l.seal, animationDelay: `${Math.min(i, 8) * 0.04}s` }} onClick={() => open(l.id)}>
            <span class="er-seal">{l.icon}</span>
            <span class="er-body">
              <span class="er-from">{l.from}</span>
              <span class="er-subj">{l.subject}</span>
              <span class="er-tags">
                {l.gift && !l.claimed && <span class="chip er-chip gift">🎁 подарок</span>}
                {l.replies && l.answered === undefined && <span class="chip er-chip">✍️ ждёт ответа</span>}
              </span>
            </span>
            <span class="er-side">
              <span class="er-stamp">{l.stamp}</span>
              <span class="er-date">{fmtDate(l.day)}</span>
            </span>
          </button>
        ))}
      </div>
      <button class="btn ghost block" style={{ marginTop: '10px' }} onClick={close}>Закрыть</button>
    </div>
  );
}

/** quick — письмо открыто сразу после ответа на предыдущее: без конверта и анимаций. */
function LetterView({ L, quick }: { L: Letter; quick?: boolean }) {
  const g = getGame()!;
  // непрочитанное письмо сначала приходит в конверте
  const [opening, setOpening] = useState(() => !L.read && prefs.fx && !quick);
  useEffect(() => {
    if (!L.read) {
      readLetter(g, L.id);
      sfx('paper');
      emit();
    }
    if (!opening) return;
    const t = setTimeout(() => setOpening(false), 1500);
    return () => clearTimeout(t);
  }, []);
  const nextUnread = g.mail.find((l) => !l.read && l.id !== L.id);
  const gift = L.gift;
  // ждёт ли письмо ответа или подарок ещё не забран
  const pending = (L.replies && L.answered === undefined) || (gift && !L.claimed);
  // ответили или забрали подарок — письмо сразу уходит: к следующему непрочитанному (без анимации) или закрывается
  const leave = () => {
    const next = g.mail.find((l) => !l.read && l.id !== L.id);
    setUI({ modal: next ? { kind: 'mail', id: next.id, quick: true } : null });
  };
  const answer = (i: number) => {
    const err = answerLetter(g, L.id, i);
    if (err) return report(err);
    // подарок не пропадёт вместе с письмом: забираем его заодно с ответом
    if (gift && !L.claimed && !claimLetter(g, L.id)) toast(`🎁 ${gift.label}`, 'good');
    if (L.result) toast(`✉️ ${L.result}`, 'info');
    leave();
  };
  const claim = () => {
    const err = claimLetter(g, L.id);
    report(err, `🎁 ${gift!.label}`);
    if (!err && (!L.replies || L.answered !== undefined)) leave();
  };
  return (
    <div class={`letter-stage ${opening ? 'opening' : ''} ${quick ? 'instant' : ''}`}>
      {opening && (
        <div class="envelope" style={{ '--seal': L.seal }} aria-hidden="true">
          <i class="env-back" />
          <i class="env-flap" />
          <i class="env-front" />
          <span class="env-seal">{L.icon}</span>
        </div>
      )}
      <article class={`letter paper-${L.paper}`}>
        <div class="lt-top">
          <button class="lt-back" onClick={() => open()} aria-label="Все письма">← Все письма</button>
          <span class="lt-postmark">{fmtDate(L.day)}</span>
          <span class="lt-stamp"><span>{L.stamp}</span></span>
        </div>
        <div class="lt-art"><LetterArt kind={L.art} hint={L.stamp} /></div>
        <div class="lt-from">
          <span class="lt-ava">{L.icon}</span>
          <span class="grow">
            <span class="lt-who">{L.from}</span>
            <span class="lt-subj">{L.subject}</span>
          </span>
        </div>
        <div class="lt-body">
          {L.body.map((p, i) => <p key={i} style={{ animationDelay: `${(opening ? 1.1 : 0.1) + i * 0.12}s` }}>{p}</p>)}
        </div>
        <div class="lt-sign">
          <span>{L.sign}</span>
          <span class="lt-wax" style={{ background: L.seal }}>{L.icon}</span>
        </div>
        {gift && (
          <div class={`lt-gift ${L.claimed ? 'done' : ''}`}>
            <span class="lg-ic">{L.claimed ? '✅' : '🎁'}</span>
            <span class="grow">
              <b>📎 {gift.label}</b>
              <span class="small">{giftParts(gift).join(' · ')}</span>
            </span>
            {!L.claimed && <button class="btn sm green shine" onClick={claim}>Забрать</button>}
          </div>
        )}
        {L.replies && (
          <div class="lt-replies">
            <div class="lr-title">✍️ {L.answered === undefined ? 'Ваш ответ' : 'Вы ответили'}</div>
            {L.answered === undefined ? (
              L.replies.map((r, i) => (
                <button key={i} class="btn ev-opt lr-opt" style={{ animationDelay: `${(opening ? 1.3 : 0.2) + i * 0.07}s` }} onClick={() => answer(i)}>
                  <span>{r.label}</span>
                  <Effects hint={r.hint} />
                </button>
              ))
            ) : (
              <div class="lr-done">
                <b>«{L.replies[L.answered].label}»</b>
                {L.result && <div class="lr-result">{L.result}</div>}
              </div>
            )}
          </div>
        )}
      </article>
      {/* письмо без ответа и подарка: «прочитано» — и сразу следующее */}
      {!pending && (
        <div class="lt-actions">
          <button class="btn ghost block" onClick={leave}>{nextUnread ? `✓ Прочитано · ещё ${unreadMail(g)}` : 'Закрыть'}</button>
        </div>
      )}
    </div>
  );
}
