import type { ComponentChildren } from 'preact';
import { BUILDINGS, GENIUS_FIELDS, GENIUS_LEVEL, SECTORS, SECTOR_KEYS } from '../../game/defs';
import { computeAll, equipFactor, sectorMods, STATS } from '../../game/economy';
import { fmt, fmtDays } from '../../game/format';
import {
  armsWarMod, buyArms, buyFood, buyQuote, foodDays, maxBuy, priceTrend, sellArms, sellFood, sellQuote, showPrice,
} from '../../game/market';
import {
  buyCompany, buyCompanyError, companiesOf, companyIncome, companyOwner, companyPrice, companyTarget, foundCompany, foundCost,
  foundError, geniusError, geniusPrice, geniusText, grantCost, grantError, hireGenius, hireScientists, sciGrant, sciPrice,
} from '../../game/society';
import {
  activeCrises, CRISIS_BY_ID, freeDeposits, hasDeposit, oilDepletion, REGION_LITH, REGION_OIL, RES_INFO, resPriceRatio, topProducers, type Res,
} from '../../game/resources';
import { emit, getGame } from '../../game/state';
import type { Genius } from '../../game/types';
import { COUNTRY_DEFS, REGIONS } from '../../game/world';
import { Bar, Card, Flag, KV, More, Rate, Seg, Tabs } from '../common';
import { PanelHero } from '../PanelHero';
import { report, setUI, ui, useStore, type MarketTab } from '../store';

export function MarketPanel() {
  useStore();
  return (
    <>
      <PanelHero kind="market" />
      <Tabs<MarketTab>
        compact
        value={ui.marketTab}
        onChange={(v) => setUI({ marketTab: v })}
        options={[
          { v: 'food', label: '🌾 Еда' },
          { v: 'arms', label: '🔫 Оружие' },
          { v: 'res', label: '⛽ Сырьё' },
          { v: 'sci', label: '🧑‍🔬 Учёные' },
          { v: 'corp', label: '🏢 Компании' },
        ]}
      />
      {ui.marketTab === 'food' && <FoodTab />}
      {ui.marketTab === 'arms' && <ArmsTab />}
      {ui.marketTab === 'res' && <ResTab />}
      {ui.marketTab === 'sci' && <SciTab />}
      {ui.marketTab === 'corp' && <CorpTab />}
    </>
  );
}

function refresh() {
  computeAll(getGame()!);
  emit();
}
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <div class="spark-empty small muted">история цены копится…</div>;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * 100).toFixed(1)},${(28 - ((v - min) / span) * 24).toFixed(1)}`).join(' ');
  return (
    <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

/** Цена товара, её тренд и почему она такая. */
function PriceCard({ good }: { good: 'food' | 'arms' }) {
  const g = getGame()!;
  const m = g.market[good];
  const trend = priceTrend(m);
  const why: string[] = [];
  const stockPct = m.stock / m.norm;
  if (stockPct > 1.25) why.push(`на рынке избыток (${pct(stockPct)} от нормы) — цена ниже`);
  else if (stockPct < 0.8) why.push(`на рынке дефицит (${pct(stockPct)} от нормы) — цена выше`);
  if (m.shock > 0.05) why.push(good === 'food' ? 'мировой неурожай' : 'гонка вооружений');
  if (m.shock < -0.05) why.push(good === 'food' ? 'рекордный мировой урожай' : 'мировое разоружение');
  if (good === 'arms') {
    const wars = Math.round((armsWarMod(g) - 1) / 0.05);
    if (wars > 0) why.push(`в мире идёт войн: ${wars}`);
  }
  return (
    <Card title={good === 'food' ? '📈 Цена еды' : '📈 Цена оружия'}
      hint={<>Цена {good === 'food' ? 'за 1M т' : 'за 1K комплектов'}. Обычная — {fmt(m.base * (good === 'food' ? 1e6 : 1e3))}.{why.length ? ` Сейчас: ${why.join(', ')}.` : ' Сейчас рынок спокоен.'}</>}>
      <div class="row between">
        <span class="price-big">💰 {fmt(showPrice(g, good))}</span>
        <span class={`num ${trend > 0.005 ? 'down' : trend < -0.005 ? 'up' : 'muted'}`}>
          {trend > 0 ? '▲' : trend < 0 ? '▼' : '•'} {Math.abs(trend * 100).toFixed(0)}% за 50 дн.
        </span>
      </div>
      <Spark data={m.hist} color={good === 'food' ? '#7ee0a0' : '#ff9b5a'} />
    </Card>
  );
}

function TradeButton({ label, cost, sell, disabled, onClick }: { label: string; cost: number; sell?: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button class={`btn sm ${sell ? 'ghost' : ''}`} style={{ flexDirection: 'column', gap: 0 }} disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      <span class="small" style={{ fontWeight: 400 }}>{sell ? '+' : ''}💰 {fmt(cost)}</span>
    </button>
  );
}

// ---------- еда ----------
function FoodTab() {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const s = STATS[me];
  const m = g.market.food;
  const bal = s.foodProd - s.foodCons;
  const days = foodDays(g, me);
  const buys = [30, 90].map((d) => Math.floor(s.foodCons * d));
  const sells = [0.25, 0.5].map((k) => Math.floor(c.food * k));
  return (
    <>
      <PriceCard good="food" />
      <Card title="🌾 Наша еда" sub={s.hunger > 0 ? '⚠️ голод' : `запаса на ${Math.floor(days)} дн.`}
        hint="Урожай растёт от 🌾 ферм, технологий «Вертикальные фермы» и «ГМО», агрохолдингов и звёзд-агрономов. Голод бьёт по стабильности, росту и учёным.">
        <KV rows={[
          ['Свой урожай покрывает', <span class={bal >= 0 ? 'up' : 'down'}>{pct(s.foodProd / Math.max(1, s.foodCons))}</span>],
          ...(s.hunger > 0 ? [['Голодают', <b class="down">{pct(s.hunger)}</b>] as [string, ComponentChildren]] : []),
        ]} />
        <div style={{ marginTop: '8px' }}><Bar value={days / Math.max(1, c.foodReserve * 1.3)} color={s.hunger > 0 || days < 20 ? 'red' : 'green'} /></div>
        <More>
          <KV rows={[
            ['Урожай', `${fmt(s.foodProd)} т/день`],
            ['Едят люди и армия', `${fmt(s.foodCons)} т/день`],
            ['Запас', `${fmt(c.food)} т`],
            ['Торговля едой', <Rate v={s.foodMoney} />],
          ]} />
        </More>
      </Card>
      <Card title="⚙️ Автоторговля и резерв" sub={c.foodAuto ? 'вкл' : 'выкл'} fold="market-food-policy"
        hint="Когда цена низкая — поднимите резерв и закупите впрок, когда высокая — продайте запасы.">
        <div class="row between">
          <span><b>Автоторговля</b><div class="small muted">докупает при нехватке, продаёт излишки</div></span>
          <button class={`toggle ${c.foodAuto ? 'on' : ''}`} onClick={() => { c.foodAuto = !c.foodAuto; refresh(); }}>{c.foodAuto ? 'ВКЛ' : 'ВЫКЛ'}</button>
        </div>
        <div class="small muted" style={{ margin: '10px 0 4px' }}>Госрезерв — сколько дней держать в запасе</div>
        <Seg value={c.foodReserve} onChange={(v) => { c.foodReserve = v; refresh(); }} options={[30, 60, 90, 180, 365].map((d) => ({ v: d, label: `${d}` }))} />
      </Card>
      <Card title="🤝 Сделки" sub={`💰 ${fmt(c.money)}`}>
        <div class="grid2">
          {buys.map((q, k) => {
            const cost = buyQuote(m, q);
            return <TradeButton key={`b${k}`} label={`Купить на ${k ? 90 : 30} дн.`} cost={cost} disabled={q < 1 || q > maxBuy(m) || c.money < cost} onClick={() => report(buyFood(g, me, q), `🌾 Куплено ${fmt(q)} т`)} />;
          })}
          {sells.map((q, k) => (
            <TradeButton key={`s${k}`} sell label={`Продать ${k ? '50' : '25'}% запаса`} cost={sellQuote(m, q)} disabled={q < 1} onClick={() => report(sellFood(g, me, q), `🌾 Продано ${fmt(q)} т`)} />
          ))}
        </div>
      </Card>
    </>
  );
}

// ---------- сырьё: нефть и литий ----------
const RES_HINT: Record<Res, string> = {
  oil: 'Нефть нужна экономике: чем она больше, тем больше нефти. Своя добыча продаётся по мировой цене, недостающее покупаем. Когда нефти в мире не хватает, импортёры недополучают её — производство падает (до −20%). Нефти нужно меньше с зелёным курсом, технологиями «Зелёная энергетика», «Ториевые реакторы», «Термоядерная энергия», «Вакуумные поезда» и мегапроектами «Энергопереход» и «Скоростные магистрали». Старые месторождения понемногу иссякают.',
  lith: 'Литий и редкие металлы нужны роботам, электромобилям и батареям: спрос растёт с автоматизацией и зелёным курсом, а добыча почти не растёт. Нехватка лития отнимает до 10% производства. Лития нужно меньше с «Переработкой батарей».',
};

function ResCard({ k }: { k: Res }) {
  const g = getGame()!;
  const s = STATS[g.player];
  const mk = g.res![k];
  const info = RES_INFO[k];
  const prod = k === 'oil' ? s.oilProd : s.lithProd;
  const need = k === 'oil' ? s.oilNeed : s.lithNeed;
  const bal = prod - need;
  const ratio = resPriceRatio(g, k);
  const trend = mk.hist.length > 10 ? mk.price / mk.hist[mk.hist.length - 11] - 1 : 0;
  const tops = topProducers(g, k);
  return (
    <Card title={`${info.icon} ${info.name}`} sub={`цена ×${ratio.toFixed(2)} к обычной`} hint={RES_HINT[k]}>
      <div class="row between">
        <span><span class="price-big">💰 {fmt(mk.price)}</span> <span class="small muted">за {k === 'oil' ? '1 млн барр.' : '1 тыс. т'}</span></span>
        <span class={`num ${trend > 0.005 ? 'down' : trend < -0.005 ? 'up' : 'muted'}`}>
          {trend > 0 ? '▲' : trend < 0 ? '▼' : '•'} {Math.abs(trend * 100).toFixed(0)}% за 50 дн.
        </span>
      </div>
      <Spark data={mk.hist} color={k === 'oil' ? '#d8b45c' : '#7fd3e8'} />
      <KV rows={[
        ['В мире нужно / добывается', <span class={mk.demand > mk.supply ? 'down' : 'up'}>{pct(mk.demand / Math.max(1e-9, mk.supply))}</span>],
        ...(mk.avail < 0.995 ? [['Импортёрам достаётся', <b class="down">{pct(mk.avail)} нужного</b>] as [string, ComponentChildren]] : []),
        ['Наша добыча', `${prod.toFixed(1)} ${info.unit}`],
        ['Нам нужно', `${need.toFixed(1)} ${info.unit}`],
        [bal >= 0 ? 'Продаём излишки' : 'Докупаем', <Rate v={bal * (bal >= 0 ? mk.sell : mk.avail) * mk.price} />],
      ]} />
      {tops.length > 0 && (
        <More label="Кто добывает">
          <KV rows={tops.map(([i, v]): [ComponentChildren, ComponentChildren] => [<span><Flag id={i} /> {COUNTRY_DEFS[i].name}</span>, `${v.toFixed(1)} ${info.unit}`])} />
        </More>
      )}
    </Card>
  );
}

function ResTab() {
  const g = getGame()!;
  const me = g.player;
  const s = STATS[me];
  if (!g.res) return <Card><div class="small muted">Мировой рынок сырья открывается…</div></Card>;
  const crises = activeCrises(g);
  const mine = s.regions.filter(hasDeposit);
  const free = freeDeposits(g);
  const depl = oilDepletion(g);
  const amounts = (rid: number) => [
    REGION_OIL[rid] > 0.05 ? `⛽ ${(REGION_OIL[rid] * depl).toFixed(1)}` : '',
    REGION_LITH[rid] > 0.05 ? `🔋 ${REGION_LITH[rid].toFixed(1)}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <>
      {crises.length > 0 && (
        <Card title="🌍 Мировой кризис" sub={`${crises.length}`}>
          {crises.map((a) => (
            <div class="small" key={a.id} style={{ marginBottom: '4px' }}>
              <b>{CRISIS_BY_ID[a.id]?.icon} {CRISIS_BY_ID[a.id]?.name}</b> <span class="muted">· ещё {Math.ceil(a.until - g.day)} дн.</span>
            </div>
          ))}
        </Card>
      )}
      {s.resShort > 0.005 && (
        <Card><div class="small down">⚠️ Сырья в мире не хватает: наше производство −{pct(s.resShort)}. Помогут свои месторождения, зелёная энергетика и переработка.</div></Card>
      )}
      <ResCard k="oil" />
      <ResCard k="lith" />
      <Card title="🗺️ Наши месторождения" sub={`${mine.length}`} fold="market-deposits">
        {mine.length === 0 && <div class="small muted">Своих месторождений нет — всё сырьё покупаем на мировом рынке.</div>}
        {mine.map((rid) => <div class="row between small" key={rid} style={{ marginBottom: '3px' }}><span>{REGIONS[rid].name}</span><span>{amounts(rid)}</span></div>)}
      </Card>
      <Card title="🏜️ Ничьи месторождения" sub={`${free.length}`} fold="market-free-deposits"
        hint="Ничьи земли с нефтью и литием можно купить или занять войсками (вкладка «Армия → Дипломатия → Нейтральные земли»). Когда сырья в мире не хватает, за ними охотятся все.">
        {free.length === 0 && <div class="small muted">Все месторождения мира уже кому-то принадлежат.</div>}
        {free.map((rid) => <div class="row between small" key={rid} style={{ marginBottom: '3px' }}><span>{REGIONS[rid].name}</span><span>{amounts(rid)}</span></div>)}
      </Card>
    </>
  );
}

// ---------- оружие ----------
function ArmsTab() {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const s = STATS[me];
  const m = g.market.arms;
  const troops = c.soldiers + s.deployed;
  const buys = [0.1, 0.25, 0.5].map((k) => Math.floor(troops * k));
  const spare = Math.max(0, Math.floor((s.equip - 1) * troops * 0.5));
  const mobilizing = g.countries.filter((x) => x.alive && x.aiFlags.prepTarget !== undefined);
  const producers = g.countries.filter((x) => x.alive).map((x) => x.idx).sort((a, b) => STATS[b].armsProd - STATS[a].armsProd).slice(0, 5);
  return (
    <>
      <PriceCard good="arms" />
      <Card title="🔫 Наше оружие" sub={`оснащение ${pct(s.equip)}`}
        hint="100% — у каждого солдата есть оружие. Без него армия слабее (до −30%), запас сверх нормы даёт до +20%. Больше оружия выпускают при высоком военном бюджете, с 🏰 казармами и оборонными компаниями. Новобранцам оружие нужно тоже.">
        <KV rows={[
          ['Сила армии от оснащения', <span class={s.equip >= 1 ? 'up' : 'down'}>×{equipFactor(s.equip).toFixed(2)}</span>],
        ]} />
        <div style={{ marginTop: '8px' }}><Bar value={s.equip / 2} color={s.equip < 0.9 ? 'red' : s.equip >= 1 ? 'green' : undefined} /></div>
        <More>
          <KV rows={[
            ['Комплектов оружия', fmt(c.arms)],
            ['Солдат (с фронтом)', fmt(troops)],
            ['Свои заводы выпускают', `+${fmt(s.armsProd)} в день`],
          ]} />
        </More>
      </Card>
      <Card title="🤝 Сделки" sub={`💰 ${fmt(c.money)}`} hint="Когда в мире войны, оружие дорожает — хорошее время продать излишки.">
        <div class="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          {buys.map((q, k) => {
            const cost = buyQuote(m, q);
            return <TradeButton key={k} label={`+${[10, 25, 50][k]}%`} cost={cost} disabled={q < 1 || q > maxBuy(m) || c.money < cost} onClick={() => report(buyArms(g, me, q), `🔫 Куплено ${fmt(q)} комплектов`)} />;
          })}
        </div>
        <div class="grid2" style={{ marginTop: '8px' }}>
          <TradeButton sell label="Продать излишки" cost={sellQuote(m, spare)} disabled={spare < 1} onClick={() => report(sellArms(g, me, spare), `🔫 Продано ${fmt(spare)} комплектов`)} />
          <TradeButton sell label="Продать 10% склада" cost={sellQuote(m, Math.floor(c.arms * 0.1))} disabled={c.arms < 10} onClick={() => report(sellArms(g, me, Math.floor(c.arms * 0.1)), '🔫 Оружие продано')} />
        </div>
      </Card>
      <Card title="🕵️ Разведка">
        {mobilizing.length === 0 && <div class="small muted">Никто не готовится к войне.</div>}
        {mobilizing.map((x) => (
          <div class="list-item tap" key={x.idx} onClick={() => setUI({ modal: { kind: 'country', id: x.idx } })}>
            <Flag id={x.idx} />
            <span class="grow"><b>{COUNTRY_DEFS[x.idx].name}</b> <span class="small muted">скупает оружие и мобилизуется</span></span>
            {x.aiFlags.prepTarget === me && <span class="chip war">против нас!</span>}
          </div>
        ))}
        <More label="Кто больше всех делает оружие">
          {producers.map((i) => (
            <div class="small row" key={i} style={{ gap: '5px', marginBottom: '2px' }}>
              <Flag id={i} /><span class="grow">{COUNTRY_DEFS[i].name}{i === me ? ' (мы)' : ''}</span>
              <span class="num">{fmt(STATS[i].armsProd)}/день · {pct(STATS[i].equip)}</span>
            </div>
          ))}
        </More>
      </Card>
    </>
  );
}

// ---------- учёные ----------
function GeniusRow({ gen, action }: { gen: Genius; action?: ComponentChildren }) {
  const g = getGame()!;
  const f = GENIUS_FIELDS[gen.field];
  return (
    <div class="list-item">
      <span class="big-ic">{f.icon}</span>
      <div class="grow">
        <div><b>{gen.name}</b> {'⭐'.repeat(gen.level)}</div>
        <div class="small muted">{GENIUS_LEVEL[gen.level]} · {f.name.toLowerCase()}</div>
        <div class="small up">{geniusText(gen)}</div>
        {gen.employer < 0 && <div class="small muted">ждёт предложений ещё {fmtDays(gen.until - g.day)}</div>}
        {gen.employer === g.player && <div class="small muted">на пенсию через {fmtDays(gen.until - g.day)}</div>}
      </div>
      {action}
    </div>
  );
}

function SciTab() {
  const g = getGame()!;
  const me = g.player;
  const c = g.countries[me];
  const s = STATS[me];
  const pool = g.market.sciPool;
  const per = s.brainsSci / Math.max(1, c.scientists);
  const batches = [0.05, 0.15].map((k) => Math.floor(Math.min(pool, Math.max(200, c.scientists * k))));
  const listed = g.geniuses.filter((x) => x.employer < 0);
  const mine = g.geniuses.filter((x) => x.employer === me);
  const others = g.geniuses.filter((x) => x.employer >= 0 && x.employer !== me).sort((a, b) => b.level - a.level).slice(0, 8);
  const hire = (gen: Genius, poach: boolean) => {
    const err = geniusError(g, me, gen);
    const price = geniusPrice(g, me, gen);
    return (
      <button class={`btn sm ${poach ? 'ghost' : ''}`} style={{ flexDirection: 'column', gap: 0 }} disabled={!!err} title={err ?? undefined}
        onClick={() => report(hireGenius(g, me, gen.id))}>
        <span>{poach ? 'Переманить' : 'Нанять'}</span>
        <span class="small" style={{ fontWeight: 400 }}>💰 {fmt(price)}</span>
      </button>
    );
  };
  return (
    <>
      <Card title="🧑‍🔬 Наши учёные" sub={fmt(c.scientists)}
        hint="Учёных растят бюджет образования, 🎓 университеты, светская политика и стабильность. При кризисе, голоде и долгой войне они уезжают за границу.">
        <KV rows={[
          ['Дают интеллекта', <Rate v={s.brainsSci} />],
          ['Страна может вырастить', <span class={s.sciTarget >= c.scientists ? 'up' : 'down'}>{fmt(s.sciTarget)} {s.sciTarget >= c.scientists ? '↗' : '↘'}</span>],
        ]} />
        {c.scientists > s.sciTarget * 1.02 && <div class="small down" style={{ marginTop: '4px' }}>Учёных больше, чем страна может занять, — часть уедет. Постройте университеты или поднимите бюджет образования.</div>}
      </Card>
      <Card title="✈️ Нанять учёных" sub={`свободно ${fmt(pool)}`}
        hint="Гранты: страна вырастит на 15% больше учёных. Цена переезда зависит от того, сколько учёных свободно в мире.">
        <div class="grid2">
          {batches.map((n, k) => {
            const cost = n * sciPrice(g, me);
            return (
              <button key={k} class="btn sm" style={{ flexDirection: 'column', gap: 0 }} disabled={n < 1 || c.money < cost} onClick={() => report(hireScientists(g, me, n))}>
                <span>+{fmt(n)} учёных</span>
                <span class="small" style={{ fontWeight: 400 }}>💰 {fmt(cost)} · +{fmt(n * per)} 🧠/сек</span>
              </button>
            );
          })}
        </div>
        <button class="btn ghost block" style={{ marginTop: '8px' }} disabled={!!grantError(g, me)} onClick={() => report(sciGrant(g, me))}>
          🎓 Научные гранты на 300 дн. — 💰 {fmt(grantCost(g, me))}
        </button>
      </Card>
      <Card title="🌟 Звёзды науки" sub={`${listed.length}`}
        hint="Новые звёзды появляются раз в 1–3 месяца. Гонорар зависит от богатства страны. В диктатуру и теократию звёзды едут неохотно (дороже), в нестабильную страну — не едут вовсе.">
        {listed.length === 0 && <div class="small muted">Сейчас никто не ищет работу.</div>}
        {listed.map((gen) => <GeniusRow key={gen.id} gen={gen} action={hire(gen, false)} />)}
      </Card>
      {mine.length > 0 && (
        <Card title="🧑‍🔬 Работают у нас" sub={`${mine.length}`} hint="Если в стране кризис или тяжёлая война, звезду могут переманить.">
          {mine.map((gen) => <GeniusRow key={gen.id} gen={gen} />)}
        </Card>
      )}
      {others.length > 0 && (
        <Card title="🌍 Звёзды в других странах" fold="market-sci-world" hint="Переманить можно, но в 1.8 раза дороже, и страна обидится.">
          {others.map((gen) => (
            <GeniusRow key={gen.id} gen={gen} action={<div class="col" style={{ gap: '4px', alignItems: 'flex-end' }}><span class="row small" style={{ gap: '4px' }}><Flag id={gen.employer} />{COUNTRY_DEFS[gen.employer].name}</span>{hire(gen, true)}</div>} />
          ))}
        </Card>
      )}
    </>
  );
}

// ---------- компании ----------
function sectorBonus(k: keyof typeof SECTORS, mods: ReturnType<typeof sectorMods>): string {
  const p = (x?: number) => `+${Math.round(((x ?? 1) - 1) * 100)}%`;
  switch (k) {
    case 'tech': return `🧠 ${p(mods.brains)}`;
    case 'energy': return `производительность ${p(mods.prod)}`;
    case 'finance': return `торговля ${p(mods.trade)}`;
    case 'industry': return `заводы ${p(mods.factory)}`;
    case 'defense': return `вооружение ${p(mods.weapons)}, выпуск оружия`;
    case 'agro': return `урожай ${p(mods.food)}`;
    case 'pharma': return `рост 👥 +${(mods.growth ?? 0).toFixed(2)}%/год`;
  }
}

function CorpTab() {
  const g = getGame()!;
  const me = g.player;
  const s = STATS[me];
  const mine = companiesOf(g, me);
  const priv = mine.filter((co) => !co.state).length;
  const room = Math.floor(companyTarget(g, me)) - priv;
  const mods = sectorMods(s.sectorUnits);
  const active = SECTOR_KEYS.filter((k) => s.sectorUnits[k] > 0.01);
  const top = g.companies.filter((co) => companyOwner(g, co) >= 0).sort((a, b) => b.value - a.value).slice(0, 15);
  const cost = foundCost(g, me);
  return (
    <>
      <Card title="🏢 Наши компании" sub={`${mine.length} · +${fmt(s.corpIncome)}/сек`}
        hint={<>{room > 0 ? `Экономика «тянет» ещё ${room} частн. компани${room === 1 ? 'ю' : 'й'} — скоро появятся сами.` : 'Чтобы появлялись новые частные компании, нужно больше миллиардеров, учёных и технологий.'} Компании дорожают, когда в стране спокойно, и дешевеют в войну, долги и при налогах выше 30%.</>}>
        {mine.length === 0 && <div class="small muted">Компаний пока нет. Они появляются сами, когда в стране много миллиардеров и учёных, — или основайте госкорпорацию.</div>}
        {mine.map((co) => (
          <div class="list-item" key={co.id}>
            <span class="big-ic">{SECTORS[co.sector].icon}</span>
            <div class="grow">
              <div><b>{co.name}</b> {co.state && <span class="chip">гос</span>}</div>
              <div class="small muted">{SECTORS[co.sector].name} · стоит {fmt(co.value)}</div>
            </div>
            <Rate v={companyIncome(g, co)} />
          </div>
        ))}
      </Card>
      {active.length > 0 && (
        <Card title="📈 Бонусы отраслей" fold="market-corp-bonus">
          <KV rows={active.map((k): [ComponentChildren, ComponentChildren] => [`${SECTORS[k].icon} ${SECTORS[k].name}`, sectorBonus(k, mods)])} />
        </Card>
      )}
      <Card title="🏗️ Основать госкорпорацию" sub={`💰 ${fmt(cost)}`} fold="market-corp-found"
        hint="Вся прибыль госкорпорации идёт в казну, но растёт она медленнее частной. Каждая следующая дороже.">
        <div class="col">
          {SECTOR_KEYS.map((k) => {
            const err = foundError(g, me, k);
            const need = BUILDINGS[SECTORS[k].need];
            return (
              <button key={k} class="option-card" disabled={!!err} style={{ opacity: err ? 0.55 : 1 }} onClick={() => report(foundCompany(g, me, k))}>
                <span class="big-ic">{SECTORS[k].icon}</span>
                <span class="grow">
                  <div class="t">{SECTORS[k].name}</div>
                  <div class="small muted">{SECTORS[k].desc} · нужно: {need.icon} {need.name}</div>
                  {err && err !== 'Не хватает денег' && <div class="small down">{err}</div>}
                </span>
              </button>
            );
          })}
        </div>
      </Card>
      <Card title="🌍 Крупнейшие компании мира" fold="market-corp-top" hint="Купленная компания переезжает в нашу столицу. Продавец немного обидится.">
        {top.map((co, k) => {
          const owner = companyOwner(g, co);
          const err = owner === me ? null : buyCompanyError(g, me, co);
          return (
            <div class="list-item" key={co.id} style={owner === me ? { background: 'rgba(216,180,92,.12)', borderRadius: '8px', paddingLeft: '6px' } : undefined}>
              <span class="num" style={{ width: '22px', color: k < 3 ? '#f2d78b' : undefined }}>{k + 1}</span>
              <Flag id={owner} />
              <div class="grow">
                <div class="small"><b>{co.name}</b> {SECTORS[co.sector].icon}</div>
                <div class="small muted">{COUNTRY_DEFS[owner].name} · {fmt(co.value)}</div>
              </div>
              {owner !== me && !co.state && (
                <button class="btn sm ghost" disabled={!!err} title={err ?? undefined} onClick={() => report(buyCompany(g, me, co.id))}>Купить {fmt(companyPrice(co))}</button>
              )}
            </div>
          );
        })}
      </Card>
    </>
  );
}
