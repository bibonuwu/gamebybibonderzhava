// Разведка: контрразведка и зачистка, сети агентов в чужих странах, операции, досье и сводка.
import { STATS } from '../../game/economy';
import { fmt, fmtDate, fmtDays } from '../../game/format';
import {
  counterOf, detected, dossier, INTEL_LEVELS, netOf, plant, plantCost, plantError, setCounterIntel, SPY_OPS, spyChance, spyCost,
  spyError, spyRun, sweep, sweepCost, sweepError, watched, type SpyOp,
} from '../../game/spy';
import { proxyCost, proxyError, proxyFee, proxyTarget, PROXY_NET, sponsorRebels } from '../../game/rebels';
import { emit, getGame } from '../../game/state';
import { COUNTRY_DEFS, REGIONS } from '../../game/world';
import { Bar, Card, Flag, KV, Rate, RelBar, Seg } from '../common';
import { report, setUI, ui, useStore } from '../store';

const guard = (v: number) => (v < 0.3 ? 'слабая' : v < 0.55 ? 'средняя' : 'сильная');

export function SpyPanel() {
  useStore();
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const s = STATS[me];
  const lvl = c.counterIntel ?? 1;
  const found = detected(g, me);
  const others = g.countries.filter((o) => o.alive && o.idx !== me).map((o) => o.idx);
  const nets = others.filter((k) => netOf(g, me, k) >= 1).sort((a, b) => netOf(g, me, b) - netOf(g, me, a));
  const target = others.includes(ui.spyTarget) ? ui.spyTarget : nets[0] ?? -1;
  const swErr = sweepError(g);
  return (
    <>
      <div class="spy-hero">
        <span class="spy-ic">🕵️</span>
        <div class="grow">
          <div class="spy-t">Спецслужбы</div>
          <div class="small muted">Резидентур: {nets.length} · успешных операций: {g.counters.spyWins ?? 0} · поймано чужих агентов: {g.counters.spiesCaught ?? 0}</div>
        </div>
      </div>
      <Card title="🛡️ Контрразведка" sub={INTEL_LEVELS[lvl]}
        hint="Ловит чужих агентов при внедрении и на операциях, разрушает их сети у нас. Средняя и сильная видят, кто за нами шпионит. Диктатура следит строже, демократия — мягче. Стоит долю налогов. Зачистка разом громит чужие сети в стране, а самых наглых высылает (раз в полгода).">
        <Seg value={lvl} onChange={(v) => { setCounterIntel(g, me, v); emit(); }} options={INTEL_LEVELS.map((l, i) => ({ v: i, label: l }))} />
        <div class="row between small" style={{ marginTop: '6px' }}>
          <span class="muted">Стоит: <Rate v={-s.intelCost} /></span>
          <span class="muted">защита: {Math.round(counterOf(g, me) * 100)}%</span>
        </div>
        <div class="sep" />
        {lvl < 2 ? (
          <div class="small muted">Чтобы видеть чужие сети агентов в стране, нужна контрразведка «Средняя» или «Сильная».</div>
        ) : found.length === 0 ? (
          <div class="small muted">Чужих сетей агентов не видно — пока.</div>
        ) : (
          <>
            <div class="small muted" style={{ marginBottom: '4px' }}>🔦 У нас работают агенты:</div>
            {found.map(({ a, net }) => (
              <div class="spy-row" key={a}>
                <Flag id={a} /><span class="grow">{COUNTRY_DEFS[a].name}</span>
                <span class="spy-net"><Bar value={net / 100} color="red" /></span><span class="small num">{Math.round(net)}%</span>
              </div>
            ))}
          </>
        )}
        <button class="btn ghost block" style={{ marginTop: '8px' }} disabled={!!swErr} title={swErr ?? undefined} onClick={() => report(sweep(g))}>
          🧹 Зачистка · 💰 {fmt(sweepCost(g))}
        </button>
        {swErr && swErr !== 'Не хватает денег' && <div class="small muted" style={{ marginTop: '4px' }}>{swErr}</div>}
      </Card>
      <Card title="🎯 Операции" hint="Сначала внедрите агентов — сеть растёт на 20% за раз, но сама тает и под чужой контрразведкой. Чем крепче сеть и слабее их контрразведка, тем выше шанс. Провал — агентов ловят, сеть разгромлена, отношения портятся.">
        <select class="spy-select" value={target} onChange={(e) => setUI({ spyTarget: +(e.currentTarget as HTMLSelectElement).value })}>
          {target < 0 && <option value={-1}>— выберите страну —</option>}
          {[...nets, ...others.filter((k) => !nets.includes(k)).sort((a, b) => COUNTRY_DEFS[a].name.localeCompare(COUNTRY_DEFS[b].name, 'ru'))].map((k) => (
            <option key={k} value={k}>{COUNTRY_DEFS[k].name}{netOf(g, me, k) >= 1 ? ` · сеть ${Math.round(netOf(g, me, k))}%` : ''}</option>
          ))}
        </select>
        {target >= 0 && <Target b={target} />}
      </Card>
      <Card title="📁 Сводка" fold="spy-log" open>
        {g.log.filter((l) => !l.world && l.text.startsWith('🕵️')).slice(0, 10).map((l, i) => (
          <div class={`small ${l.kind === 'bad' ? 'down' : l.kind === 'good' ? 'up' : ''}`} key={i} style={{ marginBottom: '4px' }}>
            <span class="muted">{fmtDate(l.day)}</span> {l.text.replace(/^🕵️\s*/u, '')}
          </div>
        ))}
        {!g.log.some((l) => !l.world && l.text.startsWith('🕵️')) && <div class="small muted">Пока тихо.</div>}
      </Card>
    </>
  );
}

function Target({ b }: { b: number }) {
  const g = getGame()!;
  const me = g.player;
  const net = netOf(g, me, b);
  const perr = plantError(g, me, b);
  const guardV = counterOf(g, b);
  return (
    <div class="spy-target">
      <div class="row" style={{ gap: '8px', marginTop: '10px' }}>
        <Flag id={b} />
        <b class="grow tap" onClick={() => setUI({ modal: { kind: 'country', id: b } })}>{COUNTRY_DEFS[b].name}</b>
        <RelBar v={g.rel[me][b]} />
      </div>
      <div class="row between small" style={{ marginTop: '8px' }}>
        <span>🕵️ Сеть агентов</span>
        <span class="num">{Math.round(net)}%</span>
      </div>
      <Bar value={net / 100} />
      <div class="small muted" style={{ marginTop: '4px' }}>Их контрразведка — {guard(guardV)}</div>
      <button class="btn block" style={{ marginTop: '8px' }} disabled={!!perr} title={perr ?? undefined} onClick={() => report(plant(g, me, b))}>
        🕵️ Внедрить агентов (+20%) · 💰 {fmt(plantCost(g, me, b))}
      </button>
      {perr && perr !== 'Не хватает денег' && <div class="small muted" style={{ marginTop: '4px' }}>{perr}</div>}
      <div class="sep" />
      {SPY_OPS.map((op) => <OpRow key={op.id} op={op} b={b} />)}
      <ProxyRow b={b} />
      {watched(g, b) && (
        <div class="spy-dossier">
          <div class="small muted" style={{ marginBottom: '4px' }}>🔍 Досье — ещё {fmtDays((g.intel.watch[b] ?? 0) - g.day)}</div>
          <KV rows={dossier(g, b)} />
        </div>
      )}
    </div>
  );
}

/** Война чужими руками: оружие и инструкторы мятежникам в стране b. */
function ProxyRow({ b }: { b: number }) {
  const g = getGame()!;
  const me = g.player;
  const ready = netOf(g, me, b) >= PROXY_NET;
  const err = proxyError(g, me, b);
  const t = proxyTarget(g, me, b);
  const where = t ? REGIONS[t.rid].name : '';
  const go = () => setUI({ modal: { kind: 'confirm', danger: true, okText: 'Отправить оружие', title: `🔥 Вооружить повстанцев: ${COUNTRY_DEFS[b].name}?`,
    text: `${t?.rebel ? `Мятеж в регионе ${where} уже идёт — поддержим его` : `Поднимем мятеж в регионе ${where}`}. Содержание — 💰 ${fmt(proxyFee(g, me))} в месяц. Если след раскроют, отношения упадут на 25, а ${COUNTRY_DEFS[b].name} получит законный повод для войны с нами.`,
    ok: () => report(sponsorRebels(g, me, b)) } });
  return (
    <div class={`lodge-op ${ready ? '' : 'locked'}`}>
      <div class="row">
        <span class="big-ic">🔥</span>
        <div class="grow">
          <b>Вооружить повстанцев</b>
          <div class="small muted">Война чужими руками — даже с ядерной державой. Две победы мятежников над гарнизоном — регион отделится, а присоединить его нам будет дешевле</div>
          <div class="small lo-meta">
            {ready ? `${where ? `${t?.rebel ? 'мятеж' : 'регион'}: ${where} · ` : ''}💰 ${fmt(proxyCost(g, me))} + ${fmt(proxyFee(g, me))}/мес` : `🔒 нужна сеть ${PROXY_NET}%`}
          </div>
        </div>
        {ready && <button class="btn sm" disabled={!!err} title={err ?? undefined} onClick={go}>Начать</button>}
      </div>
      {ready && err && err !== 'Не хватает денег' && <div class="small muted" style={{ marginTop: '4px' }}>{err}</div>}
    </div>
  );
}

function OpRow({ op, b }: { op: SpyOp; b: number }) {
  const g = getGame()!;
  const me = g.player;
  const err = spyError(g, me, b, op.id);
  const ready = netOf(g, me, b) >= op.need;
  const chance = Math.round(spyChance(g, me, b, op) * 100);
  const go = () => {
    const run = () => report(spyRun(g, me, b, op.id));
    if (!op.heavy) return run();
    setUI({ modal: { kind: 'confirm', danger: true, title: `${op.icon} ${op.name}: ${COUNTRY_DEFS[b].name}?`, okText: 'Начать операцию',
      text: `Шанс успеха — ${chance}%. Если агентов поймают, сеть разгромят, а отношения упадут на 25.`, ok: run } });
  };
  return (
    <div class={`lodge-op ${ready ? '' : 'locked'}`}>
      <div class="row">
        <span class="big-ic">{op.icon}</span>
        <div class="grow">
          <b>{op.name}</b>
          <div class="small muted">{op.desc}</div>
          <div class="small lo-meta">
            {ready ? `шанс ${chance}% · 💰 ${fmt(spyCost(g, me, op))}` : `🔒 нужна сеть ${op.need}%`}
          </div>
        </div>
        {ready && <button class="btn sm" disabled={!!err} title={err ?? undefined} onClick={go}>{err?.startsWith('Снова') ? err.replace('Снова можно через ', '⏳ ') : 'Начать'}</button>}
      </div>
    </div>
  );
}
