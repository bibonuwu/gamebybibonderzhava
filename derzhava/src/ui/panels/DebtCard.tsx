// Госдолг во вкладке «Экономика»: кредитный рейтинг, облигации, погашение, программа МВФ.
import type { ComponentChildren } from 'preact';
import {
  BORROW_DAYS, borrow, borrowError, borrowRoom, IMF_BUDGET, IMF_RATE, IMF_TAX, imfBreaches, imfError, imfLoanSize, joinImf,
  marketRate, pct, RATINGS, rating, ratingParts, repay, revenue, totalDebt, worldRate,
} from '../../game/debt';
import { BUDGET_LEVELS } from '../../game/defs';
import { STATS } from '../../game/economy';
import { fmt, fmtDate, fmtDays } from '../../game/format';
import { getGame } from '../../game/state';
import { Card, KV, More, Rate } from '../common';
import { report, setUI } from '../store';

/** Цвет рейтинга: AAA–A зелёный, BBB–BB жёлтый, ниже — красный. */
export const ratingTone = (r: number) => (r <= 2 ? 'good' : r <= 4 ? 'warn' : 'bad');

export function DebtCard() {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const s = STATS[me];
  const r = rating(g, me);
  const debt = totalDebt(c);
  const R = revenue(g, me);
  const room = borrowRoom(g, me);
  const imfErr = imfError(g, me);
  const breaches = c.imf ? imfBreaches(c) : [];
  const crisis = g.finance.shock > 0.004;
  const askImf = () => setUI({
    modal: {
      kind: 'confirm', title: '🏦 Программа МВФ', okText: 'Подписать',
      text: `МВФ даст ${fmt(imfLoanSize(g, me))} 💰 под ${pct(IMF_RATE)} на 2 года. Условия: налог не ниже ${pct(IMF_TAX)}, все расходы бюджета не выше «${BUDGET_LEVELS[IMF_BUDGET]}» — они вступят в силу сразу. Нарушим — через 30 дней программу прервут, долг станет рыночным, а рейтинг упадёт.`,
      ok: () => report(joinImf(g, me)),
    },
  });
  return (
    <Card title="🏦 Госдолг" sub={<span class={`rate-badge ${ratingTone(r)}`}>{RATINGS[r]}</span>}
      hint="Облигации дают деньги сразу, но каждый день на долг капают проценты. Ставка зависит от кредитного рейтинга: долг к доходам, дефицит, стабильность, войны, санкции. Чем лучше рейтинг, тем дешевле и больше дадут. В кризис — МВФ (дёшево, но с условиями) или дефолт.">
      <div class="debt-top">
        <div class={`debt-rating ${ratingTone(r)}`}>
          <b>{RATINGS[r]}</b>
          <span>рейтинг</span>
        </div>
        <div class="grow">
          <KV rows={[
            ['Долг', <span>{fmt(debt)} <span class="muted small">≈ {fmtDays(debt / R)} дохода</span></span>],
            ['Ставка', r >= 7 ? <span class="down">не дают</span> : pct(marketRate(g, me))],
            ...(s.debtInterest > 0.005 ? [['Проценты', <Rate v={-s.debtInterest} />] as [string, ComponentChildren]] : []),
            ['Ещё дадут', fmt(room)],
          ]} />
        </div>
      </div>
      <div class="small muted" style={{ marginTop: '6px' }}>
        🌍 Мировая ставка {pct(worldRate(g))}{crisis && <span class="down"> — финансовый кризис</span>}
      </div>
      <More label="Из чего складывается рейтинг">
        <KV rows={ratingParts(g, me).map(([k, v]): [string, ComponentChildren] => [k, <span class={v >= 0 ? 'up' : 'down'}>{v > 0 ? '+' : ''}{v.toFixed(1)}</span>])} />
        <div class="small muted" style={{ marginTop: '4px' }}>AAA — от 85 баллов, AA — 75, A — 65, BBB — 55, BB — 45, B — 35, ниже — CCC.</div>
      </More>
      {r >= 7 ? (
        <div class="small down" style={{ marginTop: '8px' }}>💥 Дефолт: в долг не дают ещё {fmtDays((c.defaulted ?? g.day) - g.day)}</div>
      ) : (
        <>
          <div class="small muted" style={{ margin: '10px 0 6px' }}>Выпустить облигации:</div>
          <div class="debt-btns">
            {BORROW_DAYS.map((d) => {
              const amount = R * d;
              const err = borrowError(g, me, amount);
              return (
                <button key={d} class="btn sm" disabled={!!err} title={err ?? undefined} onClick={() => report(borrow(g, me, amount))}>
                  <span>+{fmt(amount)}</span>
                  <span class="el-act-h">{d} дн. дохода</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {debt > 0 && (
        <div class="grid2" style={{ marginTop: '8px' }}>
          <button class="btn sm ghost" disabled={c.money <= 0} onClick={() => report(repay(g, me, debt * 0.25))}>Погасить четверть · {fmt(Math.min(debt * 0.25, Math.max(0, c.money)))}</button>
          <button class="btn sm ghost" disabled={c.money <= 0} onClick={() => report(repay(g, me, debt))}>Погасить {c.money >= debt ? 'всё' : 'сколько есть'}</button>
        </div>
      )}
      {c.imf ? (
        <div class={`debt-imf ${breaches.length ? 'warn' : ''}`}>
          <div><b>🏦 Программа МВФ</b> до {fmtDate(c.imf.until)}: долг МВФ {fmt(c.imf.loan)} 💰 под {pct(IMF_RATE)}</div>
          <div class="small muted">Условия: налог не ниже {pct(IMF_TAX)}, расходы бюджета не выше «{BUDGET_LEVELS[IMF_BUDGET]}».</div>
          {breaches.length > 0 && (
            <div class="small down">⚠️ Нарушено: {breaches.join(', ')} — программу прервут через {Math.max(0, 30 - (g.day - (c.imf.warn ?? g.day)))} дн.</div>
          )}
        </div>
      ) : (
        <>
          <button class="btn ghost block" style={{ marginTop: '8px' }} disabled={!!imfErr} onClick={askImf}>🏦 Обратиться в МВФ · +{fmt(imfLoanSize(g, me))}</button>
          {imfErr && <div class="small muted" style={{ marginTop: '4px' }}>{imfErr}</div>}
        </>
      )}
    </Card>
  );
}
