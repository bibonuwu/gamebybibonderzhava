import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { availableTechs, fundamentalCost, research, researchFundamental, techCost } from '../../game/actions';
import {
  BIRTH_POLICY, BUDGET_COST, BUDGET_INFO, BUDGET_LEVELS, GOVS, MIGRATION, RELIGIONS, TECHS, TECH_BRANCHES,
} from '../../game/defs';
import { IMF_BUDGET, IMF_TAX, pct } from '../../game/debt';
import { computeAll, STATS } from '../../game/economy';
import { coalitionBounds, coalitionParty, PARTY_BY_ID } from '../../game/elections';
import { fmt, fmtDate, fmtDays } from '../../game/format';
import { moodOf } from '../../game/people';
import { inviteInvestors, investorsCost, investorsError, richTax, richTaxError, richTaxGain } from '../../game/society';
import { emit, getGame, log } from '../../game/state';
import type { BudgetKey, GovType, ReligionPolicy } from '../../game/types';
import { Bar, Card, KV, More, Rate, Seg, Tabs } from '../common';
import { PanelHero } from '../PanelHero';
import { DebtCard } from './DebtCard';
import { ElectionsCard } from './ElectionsCard';
import { report, setUI, ui, useStore, type PolicyTab } from '../store';

type Sub = PolicyTab;

export function PolicyPanel() {
  useStore();
  const [sub, setSub] = useState<Sub>(() => {
    const v = ui.policyTab;
    ui.policyTab = 'econ';
    return v;
  });
  return (
    <>
      <PanelHero kind="policy" />
      <Tabs
        compact
        value={sub}
        onChange={setSub}
        options={[
          { v: 'econ', label: '💵 Экономика' },
          { v: 'people', label: '📢 Народ' },
          { v: 'society', label: '👥 Общество' },
          { v: 'power', label: '👑 Власть' },
          { v: 'science', label: '🔬 Наука' },
        ]}
      />
      {sub === 'econ' && <Economy />}
      {sub === 'society' && <Society />}
      {sub === 'people' && <People />}
      {sub === 'power' && <Power />}
      {sub === 'science' && <Science />}
    </>
  );
}

function refresh() {
  computeAll(getGame()!);
  emit();
}

export function IncomeTable() {
  const g = getGame()!;
  const s = STATS[g.player];
  const rows: [string, number][] = [
    ['🏛️ Налоги', s.taxIncome],
    ['🏭 Заводы', s.factoryIncome],
    ['⚓ Порты', s.portIncome],
    ['🤝 Торговля', s.tradeIncome],
    ['🏢 Мировые компании', s.corpIncome],
    ['💎 Инвестиции миллиардеров', s.investIncome],
    ['🌾 Торговля едой', s.foodMoney],
    ['📋 Расходы бюджета', -s.budgetCost],
    ['👶 Поддержка семей', -s.birthCost],
    ['🔧 Содержание зданий', -s.upkeepBuildings],
    ['💂 Содержание армии', -s.upkeepArmy],
    ['🔺 Взносы ложи', -s.lodgeDues],
    ['👁️ Десятина ложи', s.lodgeTithe],
    ['🏦 Проценты по долгу', -s.debtInterest],
    ['🕵️ Контрразведка', -s.intelCost],
  ];
  return (
    <KV
      rows={[
        ...rows.filter(([, v]) => Math.abs(v) > 0.01).map(([k, v]): [string, ComponentChildren] => [k, <Rate v={v} />]),
        [<b>Итого</b>, <Rate v={s.moneyRate} />],
        ...(s.sanctions > 0
          ? [[`🚫 Санкции ООН (−${Math.round(s.sanctions * 100)}% производства)`, <span class="down">−{fmt(s.sanctionLoss)}/сек</span>] as [string, ComponentChildren]]
          : []),
      ]}
    />
  );
}

function Economy() {
  const g = getGame()!;
  const c = g.countries[g.player];
  const s = STATS[g.player];
  const party = coalitionParty(g);
  const setBudget = (k: BudgetKey, v: number) => {
    // коалиция не даёт выйти за свои рамки, МВФ — предупреждает
    const [lo, hi] = coalitionBounds(g, k);
    if (v < lo || v > hi) return report(`Коалиция с партией «${PARTY_BY_ID[party!].name}» не позволит: ${PARTY_BY_ID[party!].terms}`);
    const apply = () => { c.budget[k] = v; refresh(); };
    if (c.imf && v > IMF_BUDGET && c.budget[k] <= IMF_BUDGET) {
      return setUI({ modal: { kind: 'confirm', danger: true, title: '🏦 Нарушить условия МВФ?', okText: 'Всё равно поднять',
        text: `По программе МВФ расходы не выше «${BUDGET_LEVELS[IMF_BUDGET]}». Если не вернуть как было за 30 дней, программу прервут: долг станет рыночным, рейтинг упадёт.`, ok: apply } });
    }
    apply();
  };
  const taxMax = Math.round(coalitionBounds(g, 'tax')[1] * 100);
  return (
    <>
      <Card title="🏛️ Налоги" sub={`${Math.round(c.tax * 100)}%`} hint="Выше 15% люди начинают злиться (сильнее при демократии).">
        <input
          type="range" min={0} max={taxMax} step={1} value={Math.round(c.tax * 100)}
          onInput={(e) => { c.tax = +(e.currentTarget as HTMLInputElement).value / 100; refresh(); }}
        />
        <div class="row between small">
          <span class="muted">Доход: <Rate v={s.taxIncome} /></span>
          <span class="muted">Стабильность: <b class={c.tax > 0.15 ? 'down' : 'up'}>{(s.stabParts.find((p) => p[0] === 'Налоги')?.[1] ?? 0).toFixed(1)}</b></span>
        </div>
        {taxMax < 50 && <div class="small muted" style={{ marginTop: '4px' }}>🤝 Коалиция: налог не выше {taxMax}%</div>}
        {c.imf && <div class={`small ${c.tax < IMF_TAX ? 'down' : 'muted'}`} style={{ marginTop: '4px' }}>🏦 МВФ: налог не ниже {pct(IMF_TAX)}</div>}
      </Card>
      <Card title="📋 Бюджет" hint={<>{(Object.keys(BUDGET_INFO) as BudgetKey[]).map((k) => <div key={k}>{BUDGET_INFO[k].icon} <b>{BUDGET_INFO[k].name}</b> — {BUDGET_INFO[k].hint}</div>)}<div>Процент — доля от налогов.</div></>}>
        <div class="col">
          {(Object.keys(BUDGET_INFO) as BudgetKey[]).map((k) => (
            <div key={k}>
              <div class="row between small" style={{ marginBottom: '4px' }}>
                <span>{BUDGET_INFO[k].icon} <b>{BUDGET_INFO[k].name}</b></span>
                <span class="muted">{Math.round(BUDGET_COST[c.budget[k]] * 100)}%</span>
              </div>
              <Seg value={c.budget[k]} onChange={(v) => setBudget(k, v)} options={BUDGET_LEVELS.map((l, i) => ({ v: i, label: l }))} />
            </div>
          ))}
        </div>
      </Card>
      <DebtCard />
    </>
  );
}

function Society() {
  const g = getGame()!;
  const c = g.countries[g.player];
  const s = STATS[g.player];
  return (
    <>
      <Card title="⛪ Религия" hint="Смена политики: стабильность −5 на 90 дней.">
        <div class="col">
          {(Object.keys(RELIGIONS) as ReligionPolicy[]).map((k) => (
            <button key={k} class={`option-card ${c.religion === k ? 'on' : ''}`} onClick={() => {
              if (c.religion === k) return;
              c.religion = k;
              c.mods.push({ kind: 'stab', value: -5, until: g.day + 90, label: 'Смена религиозной политики' });
              log(g, `${RELIGIONS[k].icon} Новая политика: ${RELIGIONS[k].name}`, 'info');
              refresh();
            }}>
              <span class="big-ic">{RELIGIONS[k].icon}</span>
              <span><div class="t">{RELIGIONS[k].name}</div>{c.religion === k && <div class="small muted">{RELIGIONS[k].desc}</div>}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="👶 Рождаемость" sub={`+${BIRTH_POLICY[c.birthPolicy].growth}%/год`} hint={`Стоит ${Math.round(BIRTH_POLICY[c.birthPolicy].cost * 100)}% налогов.`}>
        <Seg value={c.birthPolicy} onChange={(v) => { c.birthPolicy = v; refresh(); }} options={BIRTH_POLICY.map((b, i) => ({ v: i, label: b.name }))} />
      </Card>
      <Card title="✈️ Миграция" hint="Открытые границы дают рост населения, если страна богатая и стабильная, но снижают стабильность.">
        <Seg value={c.migration} onChange={(v) => { c.migration = v; refresh(); }} options={MIGRATION.map((m, i) => ({ v: i, label: m.name }))} />
      </Card>
      <Card title="👥 Население" sub={<Rate v={s.popRate} />} hint="Фермы и новые земли поднимают предел. Больницы, медицина и поддержка семей ускоряют рост.">
        <div class="row between small"><span>{fmt(s.civPop)}</span><span class="muted">предел {fmt(s.popCap)}</span></div>
        <div style={{ marginTop: '6px' }}><Bar value={s.civPop / Math.max(1, s.popCap)} /></div>
      </Card>
    </>
  );
}

/** Народ: страна в цифрах, о чём говорят люди, миллиардеры, решения по требованиям. */
function People() {
  const g = getGame()!;
  const c = g.countries[g.player];
  const s = STATS[g.player];
  const mood = moodOf(g, g.player).slice(0, 3);
  const decisions = g.log.filter((l) => !l.world && l.text.startsWith('📢')).slice(0, 8);
  const tile = (icon: string, label: string, value: string, sub: ComponentChildren, tab: 'sci' | 'corp') => (
    <button class="stat-tile" onClick={() => setUI({ tab: 'market', marketTab: tab })}>
      <span class="st-ic">{icon}</span>
      <span class="st-v">{value}</span>
      <span class="st-l">{label}</span>
      <span class="st-s">{sub}</span>
    </button>
  );
  return (
    <>
      <Card title="🏛️ Страна в цифрах" hint="Учёные дают 🧠, миллиардеры инвестируют и открывают новые компании, компании платят в казну и усиливают свою отрасль. Нажмите на плитку, чтобы открыть 🏪 рынок.">
        <div class="stat-tiles">
          {tile('🧑‍🔬', 'учёных', fmt(c.scientists), <>+{fmt(s.brainsSci)} 🧠/сек</>, 'sci')}
          {tile('💎', 'миллиардеров', String(Math.round(c.billionaires)), <>+{fmt(s.investIncome)} 💰/сек</>, 'corp')}
          {tile('🏢', 'мировых компаний', String(s.companies), <>+{fmt(s.corpIncome)} 💰/сек</>, 'corp')}
        </div>
      </Card>
      <Card title="📢 О чём говорит народ" hint="Чем громче проблема, тем скорее люди придут с требованием или выйдут на митинг. Решите её заранее — и требования не будет.">
        {mood.length === 0 && <div class="small muted">Народ доволен — жалоб почти нет.</div>}
        {mood.map((m) => (
          <div key={m.id} style={{ marginBottom: '8px' }}>
            <div class="row between small">
              <span>{m.icon} <b>{m.title}</b></span>
              <span class={m.pressure > 0.6 ? 'down' : 'muted'}>{Math.round(m.pressure * 100)}%</span>
            </div>
            <Bar value={m.pressure} color={m.pressure > 0.6 ? 'red' : m.pressure < 0.35 ? 'green' : undefined} />
          </div>
        ))}
      </Card>
      <Card title="💎 Миллиардеры" sub={`${Math.round(c.billionaires)} → ${Math.round(s.billTarget)}`} fold="policy-rich"
        hint={`Приезжают в богатую и спокойную страну с умеренными налогами, уезжают от высоких налогов, войн и голода. Каждый вкладывает +${fmt(s.investIncome / Math.max(1, c.billionaires))} 💰/сек.`}>
        <div class="grid2">
          <button class="btn sm" style={{ flexDirection: 'column', gap: 0 }} disabled={!!richTaxError(g, g.player)} title={richTaxError(g, g.player) ?? undefined}
            onClick={() => report(richTax(g, g.player))}>
            <span>Налог на сверхбогатых</span>
            <span class="small" style={{ fontWeight: 400 }}>+💰 {fmt(richTaxGain(g, g.player))}, 20% уедут</span>
          </button>
          <button class="btn sm ghost" style={{ flexDirection: 'column', gap: 0 }} disabled={!!investorsError(g, g.player)} title={investorsError(g, g.player) ?? undefined}
            onClick={() => report(inviteInvestors(g, g.player))}>
            <span>Льготы инвесторам</span>
            <span class="small" style={{ fontWeight: 400 }}>💰 {fmt(investorsCost(g, g.player))}, на год</span>
          </button>
        </div>
      </Card>
      <Card title="📜 Наши ответы народу" fold="policy-answers">
        {decisions.length === 0 && <div class="small muted">Народ ещё ни о чём не просил. Первое обращение — уже скоро.</div>}
        {decisions.map((l, i) => (
          <div class="small" key={i} style={{ marginBottom: '4px' }}><span class="muted">{fmtDate(l.day)}</span> {l.text.slice(3)}</div>
        ))}
      </Card>
    </>
  );
}

export function StabilityBreakdown({ compact }: { compact?: boolean }) {
  const g = getGame()!;
  const c = g.countries[g.player];
  const s = STATS[g.player];
  const parts = <KV rows={s.stabParts.map(([k, v]): [string, ComponentChildren] => [k, <span class={v >= 0 ? 'up' : 'down'}>{v > 0 ? '+' : ''}{v.toFixed(1)}</span>])} />;
  return (
    <>
      <div class="row between" style={{ marginBottom: '6px' }}>
        <span>Сейчас <b class="num">{c.stability.toFixed(1)}%</b></span>
        <span class="muted">стремится к <b class="num">{s.stabTarget.toFixed(0)}%</b></span>
      </div>
      <Bar value={c.stability / 100} color={c.stability < 35 ? 'red' : c.stability >= 60 ? 'green' : undefined} />
      {compact ? <More label="Из чего складывается">{parts}</More> : <><div class="sep" />{parts}</>}
      <div class="small muted" style={{ marginTop: '8px' }}>При 0% — революция и смена власти.</div>
    </>
  );
}

function Power() {
  const g = getGame()!;
  const c = g.countries[g.player];
  const s = STATS[g.player];
  const cooldown = 300 - (g.day - c.govChangedDay);
  const reformCost = Math.max(1000, s.taxIncome * 120);
  const change = (k: GovType) => {
    if (k === c.gov) return;
    if (cooldown > 0) return report(`Реформа возможна через ${fmtDays(cooldown)}`);
    setUI({
      modal: {
        kind: 'confirm',
        title: `${GOVS[k].icon} ${GOVS[k].name}`,
        text: `Реформа обойдётся в ${fmt(reformCost)} 💰 и снизит стабильность на 15. Продолжить?`,
        okText: 'Провести реформу',
        ok: () => {
          if (c.money < reformCost) return report('Не хватает денег');
          c.money -= reformCost;
          c.gov = k;
          c.govChangedDay = g.day;
          c.stability = Math.max(0, c.stability - 15);
          log(g, `${GOVS[k].icon} Новая форма правления: ${GOVS[k].name}`, 'info');
          refresh();
        },
      },
    });
  };
  return (
    <>
      <ElectionsCard />
      <Card title="👑 Форма правления" sub={cooldown > 0 ? `реформа через ${fmtDays(cooldown)}` : 'можно реформировать'}>
        <div class="col">
          {(Object.keys(GOVS) as GovType[]).map((k) => (
            <button key={k} class={`option-card ${c.gov === k ? 'on' : ''}`} onClick={() => change(k)}>
              <span class="big-ic">{GOVS[k].icon}</span>
              <span><div class="t">{GOVS[k].name}</div>{c.gov === k && <div class="small muted">{GOVS[k].desc}</div>}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="⚖️ Стабильность">
        <StabilityBreakdown compact />
      </Card>
      {c.mods.length > 0 && (
        <Card title="⏳ Временные эффекты" sub={`${c.mods.length}`} fold="policy-mods">
          <KV rows={c.mods.map((m): [string, ComponentChildren] => [m.label, `${MOD_ICON[m.kind]} ${m.value > 0 ? '+' : ''}${m.kind === 'stab' || m.kind === 'growth' ? m.value : Math.round(m.value * 100) + '%'} · ${fmtDays(m.until - g.day)}`])} />
        </Card>
      )}
    </>
  );
}

const MOD_ICON = { stab: '⚖️', growth: '👥', prod: '💰', brains: '🧠', food: '🌾', rich: '💎', sci: '🧑‍🔬' };

function Science() {
  const g = getGame()!;
  const c = g.countries[g.player];
  const avail = new Set(availableTechs(g, g.player).map((t) => t.id));
  const fcost = fundamentalCost(g, g.player);
  return (
    <>
      {TECH_BRANCHES.map((branch) => {
        const all = TECHS.filter((t) => t.branch === branch);
        const left = all.filter((t) => !c.techs.includes(t.id));
        return (
        <Card key={branch} title={branch} sub={`✓ ${all.length - left.length} из ${all.length}`}>
          {left.length === 0 && <div class="small up">Всё изучено ✓</div>}
          {left.map((t) => {
            const done = c.techs.includes(t.id);
            const cost = techCost(g, g.player, t.id);
            const can = avail.has(t.id);
            return (
              <div class="list-item" key={t.id} style={{ opacity: done || can ? 1 : 0.5 }}>
                <span class="big-ic">{t.icon}</span>
                <div class="grow">
                  <div><b>{t.name}</b> <span class="muted small">ур. {t.tier}</span></div>
                  <div class="small muted">{t.desc}</div>
                  {t.fact && <div class="small fact">📖 {t.fact}</div>}
                  {can && !done && <div style={{ marginTop: '4px' }}><Bar value={c.brains / cost} /></div>}
                </div>
                {done ? (
                  <span class="up">✓</span>
                ) : (
                  <button class="btn sm" disabled={!can || c.brains < cost} onClick={() => report(research(g, g.player, t.id))}>
                    🧠 {fmt(cost)}
                  </button>
                )}
              </div>
            );
          })}
        </Card>
        );
      })}
      <Card title="♾️ Фундаментальные исследования" sub={`уровень ${c.fundamental}`}>
        <div class="row">
          <div class="grow small muted">Каждый уровень: 💰 и 🧠 +3%.</div>
          <button class="btn sm" disabled={c.brains < fcost} onClick={() => report(researchFundamental(g, g.player))}>🧠 {fmt(fcost)}</button>
        </div>
        <div style={{ marginTop: '6px' }}><Bar value={c.brains / fcost} /></div>
      </Card>
    </>
  );
}
