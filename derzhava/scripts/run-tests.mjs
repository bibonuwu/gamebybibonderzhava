// npm test — быстрая проверка всей логики без графики: каждый прогон должен дойти до конца без ошибок,
// а late-test ещё и проверяет числа поздней игры, сохранения и их обновление. Подробный вывод — только при ошибке.
import { spawnSync } from 'node:child_process';

const RUNS = [
  ['scripts/late-test.ts', '2500', 'de'],
  ['scripts/sim-test.ts', '2000', 'kz', 'bot'],
  ['scripts/sim-test.ts', '1500', 'ua', 'bot', 'coldwar'],
  ['scripts/sim-test.ts', '1500', 'ng', 'bot', 'turmoil'],
  ['scripts/politics-test.ts', '2000', 'de'],
  ['scripts/lodge-test.ts', '2000', 'fr', 'join'],
  ['scripts/order-un-test.ts', '2000', 'gb'],
  ['scripts/nuke-test.ts', '3000', 'us'],
];

let failed = 0;
const t0 = Date.now();
for (const args of RUNS) {
  const t = Date.now();
  const r = spawnSync('npx', ['tsx', ...args], { encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, SEED: '12345' } });
  const ok = r.status === 0;
  console.log(`${ok ? '✓' : '✗'} ${args.join(' ')}  (${((Date.now() - t) / 1000).toFixed(1)} с)`);
  if (!ok) {
    failed++;
    console.log((r.stdout ?? '').split('\n').slice(-30).join('\n'));
    console.log(r.stderr ?? '');
  }
}
console.log(`\n${failed ? `✗ Не прошло: ${failed} из ${RUNS.length}` : `✓ Все ${RUNS.length} прогонов прошли`} за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
process.exit(failed ? 1 : 0);
