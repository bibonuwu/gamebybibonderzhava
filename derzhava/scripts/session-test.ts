// Проверка чрезвычайных сессий ООН и ложи без графики: npx tsx scripts/session-test.ts [дней] [страна] [сид]
// Игрок играет ботом: вступает в ложу, проводит ядерное испытание, отменяет выборы, заказывает тайные услуги,
// откликается на просьбы братьев — и смотрит, что скажет ООН. Есть проверки: при ошибке — код выхода 1.
import { aiTurn } from '../src/game/ai';
import { castVote, pending, resTitle } from '../src/game/assembly';
import { campaignAct } from '../src/game/elections';
import { STATS } from '../src/game/economy';
import { resolveEvent } from '../src/game/events';
import { isMember, OPS, opError, rankOf, RANKS, runOp } from '../src/game/lodge';
import { answerLetter } from '../src/game/mail';
import { newGame } from '../src/game/newGame';
import { startNuke } from '../src/game/nuclear';
import { exportText, parseSave } from '../src/game/save';
import { isSessionEvent, joinError, joinSanctions, playerComply, playerComplyError, SESSION_BY_ID } from '../src/game/session';
import { tick } from '../src/game/sim';
import type { GameState, UNResolution } from '../src/game/types';
import { embargoed, sanctions } from '../src/game/un';
import { COUNTRY_DEFS } from '../src/game/world';

const days = Number(process.argv[2] ?? 2500);
const player = COUNTRY_DEFS.findIndex((c) => c.id === (process.argv[3] ?? 'de'));
const g = newGame(player, 'normal', Number(process.argv[4] ?? 2024));
const me = g.player;
const name = (k: number) => COUNTRY_DEFS[k]?.name ?? '—';

let failed = 0;
function check(ok: boolean, what: string) {
  if (ok) console.log(`  ✓ ${what}`);
  else {
    failed++;
    console.log(`  ✗ ${what}`);
  }
}

/** Санкции сессий согласованы с миром: живые цели, живые участники, разумная сила. */
function sane(g: GameState): string | null {
  for (const s of g.assembly.sanctions) {
    if (!g.countries[s.target].alive) return `санкции против погибшей страны ${name(s.target)}`;
    if (s.by.some((k) => !g.countries[k].alive)) return `в санкциях против ${name(s.target)} — погибшая страна`;
    if (s.by.includes(s.target)) return `${name(s.target)} ввела санкции против самой себя`;
    if (s.by.some((k) => !sanctions(g, k, s.target))) return `sanctions() не видит санкций против ${name(s.target)}`;
    if (s.embargo && !embargoed(g, s.target)) return `embargoed() не видит эмбарго против ${name(s.target)}`;
  }
  for (const c of g.countries) {
    if (!c.alive) continue;
    const x = STATS[c.idx].sanctions;
    if (!Number.isFinite(x) || x < 0 || x > 0.25 + 1e-9) return `${name(c.idx)}: санкции ${x}`;
    if (!Number.isFinite(c.money)) return `${name(c.idx)}: казна ${c.money}`;
  }
  return null;
}

const seen = new Map<number, UNResolution>();
const lines: string[] = [];
let lastTop: object | undefined;
let insane: string | null = null;
let defenses = 0, cancelled = false, nukeStarted = false;
const t0 = Date.now();

for (let d = 1; d <= days && !g.gameOver; d++) {
  tick(g);
  if (g.day % 4 === 0) aiTurn(g, me);
  // окна: о нас — по очереди речь, выполнить требование, игнорировать; о брате — «против», об остальных — «за»
  if (g.event) {
    const ev = g.event;
    if (isSessionEvent(ev.id)) {
      const r = g.assembly.res.find((x) => `uns-${x.id}` === ev.id);
      if (r?.target === me) {
        const want = defenses++ % 3;
        const i = ev.options.findIndex((o) => o.idx === want);
        resolveEvent(g, i >= 0 ? i : 0);
      } else resolveEvent(g, r && isMember(g, r.target!) && g.lodge.status === 'member' ? 1 : 0);
    } else resolveEvent(g, ev.id === 'un-sg' ? 1 : 0);
  }
  for (const l of g.mail) if (l.replies && l.answered === undefined) answerLetter(g, l.id, 0);
  // ядерная программа: испытание соберёт сессию
  if (!nukeStarted && g.day === 300) {
    const c = g.countries[me];
    for (const t of ['nuclear_physics', 'nuclear_power', 'nuclear_bomb']) if (!c.techs.includes(t)) c.techs.push(t);
    c.money += 1e9;
    c.brains += 1e9;
    nukeStarted = !startNuke(g, me);
  }
  // выборы: кампанию начинаем пораньше и отменяем
  if (g.day === 700) g.elections.next = Math.min(g.elections.next, g.day + 30);
  if (!cancelled && g.elections.campaign && !campaignAct(g, 'cancel')) cancelled = true;
  // ложа: доступные услуги по кругу (кроме переворота) на первую цель
  if (g.lodge.status === 'member' && g.day % 10 === 0) {
    const from = (g.day / 10) % OPS.length;
    for (const op of [...OPS.slice(from), ...OPS.slice(0, from)]) {
      if (op.id === 'coup' || opError(g, op.id)) continue;
      const t = op.choices ? op.choices(g)[0]?.v ?? -1 : -1;
      const err = runOp(g, op.id, t);
      if (err) console.log(`  ! ${op.id}: ${err}`);
      break;
    }
  }
  if (g.day % 30 === 0) {
    // против нас — выполняем требование через два месяца; к чужим санкциям присоединяемся
    for (const s of [...g.assembly.sanctions]) {
      if (s.target === me && g.day - s.since > 60 && !playerComplyError(g, s.id)) playerComply(g, s.id);
      else if (s.target !== me && !joinError(g, s)) joinSanctions(g, s.id);
    }
    for (const r of pending(g)) if (r.by !== me && !r.myVote && r.target !== me) castVote(g, r.id, 'yes');
  }
  for (const r of g.assembly.res) if (r.session && !seen.has(r.id)) seen.set(r.id, r);
  if (!insane && g.day % 50 === 0) insane = sane(g);
  for (const l of g.log) {
    if (l === lastTop) break;
    if (/🌐|🎤|🙇|🚪 Наш посол|👁️ Братья|🤝|🗳️ Голоса|📜 Тайное/.test(l.text)) lines.push(`[${l.day}]${l.world ? ' 🌍' : ''} ${l.text}`);
  }
  lastTop = g.log[0];
  if (d % 500 === 0) {
    const r = rankOf(g);
    console.log(`день ${g.day}: сессий ${seen.size}, санкций сейчас ${g.assembly.sanctions.length} (против нас ${g.assembly.sanctions.filter((s) => s.target === me).length}), `
      + `ложа: ${g.lodge.status}${r >= 0 ? ` (${RANKS[r].name})` : ''}, просьб братьев выполнено ${g.counters.lodgePleas ?? 0}`);
  }
}

console.log(`\nЖурнал (${lines.length}), последние:`);
for (const l of lines.slice(-40)) console.log(' ', l);
const all = [...seen.values()];
const by = (kind: string) => all.filter((r) => r.kind === kind).length;
console.log(`\nСессии: ${all.length} — ${Object.keys(SESSION_BY_ID).map((k) => `${k} ${by(k)}`).join(', ')}`);
for (const r of all.slice(-12)) {
  const res = r.passed === undefined ? 'идёт' : r.complied ? 'требование выполнено' : r.passed ? `принята ${r.yes!.length}/${r.no!.length}` : `отклонена ${r.yes?.length ?? 0}/${r.no?.length ?? 0}`;
  console.log(`  [${r.day}] ${resTitle(g, r)} — созвала ${name(r.by)}: ${res}`);
}
console.log(`Санкции сейчас: ${g.assembly.sanctions.map((s) => `${SESSION_BY_ID[s.kind].icon} ${name(s.target)} (${s.by.length} стран, до ${s.until})`).join('; ') || '—'}`);
console.log(`Счётчики: сессий против нас ${g.counters.sessionsVsUs ?? 0}, отбились ${g.counters.sessionsWon ?? 0}, выполнили требований ${g.counters.unComplied ?? 0}, `
  + `речей ${g.counters.unSpeeches ?? 0}; услуг ложи ${g.counters.lodgeOps ?? 0}, просьб братьев ${g.counters.lodgePleas ?? 0}`);
console.log(`${days} дней за ${Date.now() - t0} мс`);

console.log('\n— проверки');
check(!insane, `санкции сессий согласованы с миром${insane ? `: ${insane}` : ''}`);
check(all.some((r) => r.kind === 'nuketest' && r.target === me), 'наше ядерное испытание созвало сессию');
check(!cancelled || all.some((r) => r.kind === 'democracy' && r.target === me), 'отмена выборов созвала сессию');
check(all.filter((r) => r.passed !== undefined).every((r) => r.complied || (r.yes !== undefined && r.no !== undefined)), 'у каждой решённой сессии есть итог голосования');
check(all.every((r) => r.target !== r.by), 'обвиняемая не созывает сессию сама о себе');
check(g.lodge.status !== 'member' || (g.counters.lodgeOps ?? 0) > 0, 'член ложи заказывал тайные услуги');
check(g.lodge.status !== 'member' || lines.some((l) => l.includes('Тайное знание')), 'услуга «Тайное знание» сработала');
const back = parseSave(exportText(g));
check('g' in back && back.g.assembly.sanctions.length === g.assembly.sanctions.length, 'санкции сессий переживают сохранение');
const old = JSON.parse(exportText(g));
delete old.game.assembly.sanctions;
const up = parseSave(JSON.stringify(old));
check('g' in up && Array.isArray(up.g.assembly.sanctions), 'старое сохранение без санкций сессий открывается');
console.log(failed ? `\n✗ Не прошло проверок: ${failed}` : '\n✓ Все проверки прошли');
process.exit(failed ? 1 : 0);
