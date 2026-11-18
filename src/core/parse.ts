import { isDate, isTime, jst, pad } from './dates';

/**
 * 打ち込まれた日付を YYYY-MM-DD に直す。直せなければ null。
 * 受け付ける形：2026-11-20 / 2026/11/20 / 2026.11.20 / 2026年11月20日 / 20261120 / 11/20 / 11月20日 / 1120
 * 全角数字・前後の空白・曜日の「(金)」も受け付ける。年を省いたときは、今日から見て近い将来の日付にする
 * （今日より30日以上前になる場合は翌年とみなす）。
 */
export function parseDateInput(input: string, now: number = Date.now()): string | null {
  const s = input.normalize('NFKC').trim().replace(/[（(][^)）]*[)）]\s*$/, '').trim();
  if (!s) return null;
  let y: number | null = null;
  let m: number;
  let d: number;
  let r = s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{4})(\d{2})(\d{2})$/))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/))) [m, d] = [Number(r[1]), Number(r[2])];
  else if ((r = s.match(/^(\d{2})(\d{2})$/))) [m, d] = [Number(r[1]), Number(r[2])];
  else return null;

  if (y === null) {
    const today = jst(now);
    y = today.y;
    const candidate = `${y}-${pad(m)}-${pad(d)}`;
    const todayStr = `${today.y}-${pad(today.m)}-${pad(today.d)}`;
    if (isDate(candidate) && Date.parse(candidate) < Date.parse(todayStr) - 30 * 864e5) y += 1;
  }
  const out = `${y}-${pad(m)}-${pad(d)}`;
  return isDate(out) ? out : null;
}

/**
 * 打ち込まれた時刻を HH:MM に直す。直せなければ null。
 * 受け付ける形：18:00 / 18：00 / 18時 / 18時30分 / 1830 / 18 / 9:5（→09:05）
 */
export function parseTimeInput(input: string): string | null {
  const s = input.normalize('NFKC').trim();
  if (!s) return null;
  let h: number;
  let mi = 0;
  let r = s.match(/^(\d{1,2})\s*[:時]\s*(\d{1,2})\s*分?$/);
  if (r) [h, mi] = [Number(r[1]), Number(r[2])];
  else if ((r = s.match(/^(\d{1,2})\s*時?$/))) h = Number(r[1]);
  else if ((r = s.match(/^(\d{1,2})(\d{2})$/))) [h, mi] = [Number(r[1]), Number(r[2])];
  else return null;
  const out = `${pad(h)}:${pad(mi)}`;
  return isTime(out) ? out : null;
}

/** 欄に表示する形（2026/11/20） */
export const formatDateInput = (v: string) => (isDate(v) ? v.replace(/-/g, '/') : v);
