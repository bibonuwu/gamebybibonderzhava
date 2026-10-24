import { useEffect, useRef, useState } from 'preact/hooks';
import { ACHIEVEMENTS } from '../../game/achievements';
import { STATS } from '../../game/economy';
import { fmt, fmtDate } from '../../game/format';
import { getGame } from '../../game/state';
import type { Sample } from '../../game/types';
import { COUNTRY_DEFS } from '../../game/world';
import { Card, Flag, More, Seg, Tabs } from '../common';
import { PanelHero } from '../PanelHero';
import { setUI, useStore } from '../store';

type Metric = 'money' | 'brains' | 'pop' | 'mr' | 'br' | 'pr';
const METRICS: { v: Metric; label: string; color: string }[] = [
  { v: 'mr', label: '💰/сек', color: '#f2d78b' },
  { v: 'br', label: '🧠/сек', color: '#7cc7ff' },
  { v: 'pop', label: '👥', color: '#7ee0a0' },
  { v: 'money', label: '💰 казна', color: '#e9b44c' },
  { v: 'brains', label: '🧠 запас', color: '#9aa8ff' },
];

function Chart({ data, metric, color }: { data: Sample[]; metric: Metric; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 46, r: 8, t: 10, b: 20 };
    ctx.font = '11px "PT Sans", sans-serif';
    if (data.length < 2) {
      ctx.fillStyle = '#9db0cc';
      ctx.textAlign = 'center';
      ctx.fillText('Данные копятся… поиграйте немного', w / 2, h / 2);
      return;
    }
    const vals = data.map((d) => d[metric]);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < Math.abs(max) * 0.02 + 1e-6) { max += Math.abs(max) * 0.05 + 1; min -= Math.abs(min) * 0.05 + 1; }
    const x = (i: number) => pad.l + (i / (data.length - 1)) * (w - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
    ctx.strokeStyle = 'rgba(157,176,204,0.15)';
    ctx.fillStyle = '#9db0cc';
    ctx.textAlign = 'right';
    for (let k = 0; k <= 3; k++) {
      const v = min + ((max - min) * k) / 3;
      ctx.beginPath();
      ctx.moveTo(pad.l, y(v));
      ctx.lineTo(w - pad.r, y(v));
      ctx.stroke();
      ctx.fillText(fmt(v), pad.l - 6, y(v) + 4);
    }
    ctx.textAlign = 'left';
    ctx.fillText(fmtDate(data[0].d), pad.l, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText(fmtDate(data[data.length - 1].d), w - pad.r, h - 4);
    const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    grad.addColorStop(0, color + '55');
    grad.addColorStop(1, color + '00');
    ctx.beginPath();
    data.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d[metric])) : ctx.moveTo(x(i), y(d[metric]))));
    ctx.lineTo(x(data.length - 1), h - pad.b);
    ctx.lineTo(x(0), h - pad.b);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    data.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d[metric])) : ctx.moveTo(x(i), y(d[metric]))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
  return <canvas class="chart" ref={ref} />;
}

type Rank = 'pop' | 'money' | 'brains' | 'power' | 'regions' | 'sci' | 'rich' | 'corp';

export function StatsPanel() {
  useStore();
  const g = getGame()!;
  const [metric, setMetric] = useState<Metric>('mr');
  const [range, setRange] = useState<'s' | 'm' | 'l'>('s');
  const [rank, setRank] = useState<Rank>('power');
  const data = g.hist[range];
  const m = METRICS.find((x) => x.v === metric)!;
  const val = (i: number) => {
    const s = STATS[i];
    const c = g.countries[i];
    if (rank === 'sci') return c.scientists;
    if (rank === 'rich') return Math.round(c.billionaires);
    if (rank === 'corp') return s.companies;
    return rank === 'pop' ? s.civPop : rank === 'money' ? s.moneyRate : rank === 'brains' ? s.brainsRate : rank === 'power' ? s.power : s.regions.length;
  };
  const ranking = g.countries.filter((c) => c.alive).map((c) => c.idx).sort((a, b) => val(b) - val(a));
  const myPlace = ranking.indexOf(g.player) + 1;
  const row = (i: number, k: number) => (
    <div class="list-item" key={i} style={i === g.player ? { background: 'rgba(216,180,92,.12)', borderRadius: '8px', paddingLeft: '6px' } : undefined}>
      <span class="num" style={{ width: '22px', color: k < 3 ? '#f2d78b' : undefined }}>{k + 1}</span>
      <Flag id={i} />
      <span class="grow">{COUNTRY_DEFS[i].name}{i === g.player ? ' (вы)' : ''}</span>
      <span class="num">{fmt(val(i))}{rank === 'money' || rank === 'brains' ? '/с' : ''}</span>
    </div>
  );
  return (
    <>
      <PanelHero kind="stats" />
      <Card title="📈 Развитие">
        <Tabs value={metric} onChange={setMetric} options={METRICS.map((x) => ({ v: x.v, label: x.label }))} />
        <Chart data={data} metric={metric} color={m.color} />
        <div style={{ marginTop: '8px' }}>
          <Seg value={range} onChange={setRange} options={[{ v: 's', label: '5 минут' }, { v: 'm', label: '1 час' }, { v: 'l', label: 'Всё время' }]} />
        </div>
      </Card>
      <Card title="🏆 Рейтинг стран" sub={`вы на ${myPlace} месте`}>
        <Tabs
          compact
          value={rank}
          onChange={setRank}
          options={[
            { v: 'power', label: '⚔️ Мощь' },
            { v: 'money', label: '💰 Доход' },
            { v: 'brains', label: '🧠 Наука' },
            { v: 'pop', label: '👥 Люди' },
            { v: 'regions', label: '🗺️ Земли' },
            { v: 'sci', label: '🧑‍🔬 Учёные' },
            { v: 'rich', label: '💎 Миллиардеры' },
            { v: 'corp', label: '🏢 Компании' },
          ]}
        />
        {ranking.slice(0, 5).map(row)}
        {myPlace > 5 && row(g.player, myPlace - 1)}
        <More label="Все страны">{ranking.slice(5).map((i, k) => (i === g.player ? null : row(i, k + 5)))}</More>
      </Card>
      <Card title="🏅 Достижения" sub={`${g.achievements.length} / ${ACHIEVEMENTS.length}`} fold="stats-ach">
        <div class="grid2">
          {ACHIEVEMENTS.map((a) => {
            const got = g.achievements.includes(a.id);
            return (
              <div key={a.id} class="option-card" style={{ opacity: got ? 1 : 0.45, cursor: 'default', padding: '7px 8px' }}>
                <span style={{ fontSize: '22px', filter: got ? 'none' : 'grayscale(1)' }}>{a.icon}</span>
                <span><div class="t small">{a.name}</div><div class="small muted" style={{ fontSize: '11px' }}>{a.desc}</div></span>
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="📜 Журнал" fold="stats-log">
        <button class="btn ghost sm block" style={{ marginBottom: '8px' }} onClick={() => setUI({ modal: { kind: 'news' } })}>📰 Мировые новости</button>
        {g.log.filter((l) => !l.world).slice(0, 30).map((l, i) => (
          <div class="small" key={i} style={{ marginBottom: '4px' }}>
            <span class="muted">{fmtDate(l.day)}</span> <span class={l.kind === 'bad' ? 'down' : l.kind === 'good' ? 'up' : ''}>{l.text}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
