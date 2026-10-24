import { START_YEAR } from './defs';

const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];

export function fmt(n: number, digits = 1): string {
  if (!isFinite(n)) return '∞';
  const sign = n < 0 ? '−' : '';
  let a = Math.abs(n);
  if (a < 1000) return sign + (a < 10 && a % 1 !== 0 ? a.toFixed(1) : Math.round(a).toString());
  let u = 0;
  while (a >= 1000 && u < UNITS.length - 1) {
    a /= 1000;
    u++;
  }
  return sign + (a >= 100 ? a.toFixed(0) : a.toFixed(digits)) + UNITS[u];
}

export function fmtRate(n: number): string {
  return (n >= 0 ? '+' : '') + fmt(n) + '/сек';
}

export const fmtPct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const START = Date.UTC(START_YEAR, 0, 1);
export function fmtDate(day: number): string {
  const d = new Date(START + Math.floor(day) * 86400000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export const fmtDays = (d: number) => (d >= 365 ? `${(d / 365).toFixed(1)} г.` : `${Math.ceil(d)} дн.`);
