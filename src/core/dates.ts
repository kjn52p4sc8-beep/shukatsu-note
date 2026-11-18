import type { Entry } from './types';

export const JST = 9 * 3600e3;
export const DAY = 864e5;
export const HOUR = 36e5;
export const MIN = 6e4;

export const pad = (n: number | string) => String(n).padStart(2, '0');
export const isDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith('0000')) return false;
  const ms = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
};
export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** 日付と時刻（日本時間）を UTC ミリ秒に。時刻なしは endOfDay ならその日の 23:59:59。 */
export function toMs(date: string, time: string, endOfDay: boolean): number | null {
  if (!isDate(date) || (time !== '' && !isTime(time))) return null;
  const t = isTime(time) ? time + ':00' : endOfDay ? '23:59:59' : '00:00:00';
  const ms = Date.parse(date + 'T' + t + '+09:00');
  return Number.isNaN(ms) ? null : ms;
}
export const deadlineMs = (it: Pick<Entry, 'dDate' | 'dTime'>) => toMs(it.dDate, it.dTime, true);
export const eventMs = (it: Pick<Entry, 'eDate' | 'eTime'>) => toMs(it.eDate, it.eTime, false);

export function jst(ms: number) {
  const d = new Date(ms + JST);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    w: d.getUTCDay(),
  };
}
export function jstDateStr(ms: number) {
  const p = jst(ms);
  return p.y + '-' + pad(p.m) + '-' + pad(p.d);
}
export function jstTimeStr(ms: number) {
  const p = jst(ms);
  return pad(p.h) + ':' + pad(p.mi);
}

/** 今週＝月曜0:00〜日曜24:00（日本時間） */
export function weekRange(now: number) {
  const d = new Date(now + JST);
  const mid = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - JST;
  const toSun = (7 - d.getUTCDay()) % 7;
  const end = mid + (toSun + 1) * DAY;
  return { start: end - 7 * DAY, end };
}

export type Urgency = 'none' | 'expired' | 'red' | 'orange' | 'normal';
export function urgency(it: Pick<Entry, 'dDate' | 'dTime'>, now: number): Urgency {
  const ms = deadlineMs(it);
  if (ms === null) return 'none';
  if (ms < now) return 'expired';
  if (ms - now <= DAY) return 'red';
  if (ms < weekRange(now).end) return 'orange';
  return 'normal';
}

export function countdownParts(ms: number, now: number) {
  const diff = Math.max(0, ms - now);
  return { d: Math.floor(diff / DAY), h: Math.floor((diff % DAY) / HOUR), m: Math.floor((diff % HOUR) / MIN) };
}
export function countdownText(ms: number, now: number) {
  if (ms < now) {
    const n = Math.floor((now - ms) / DAY);
    return n >= 1 ? '期限切れ（' + n + '日前）' : '期限切れ';
  }
  const p = countdownParts(ms, now);
  if (p.d > 0) return 'あと' + p.d + '日' + p.h + '時間';
  if (p.h > 0) return 'あと' + p.h + '時間' + p.m + '分';
  return 'あと' + p.m + '分';
}
export function shortLeft(ms: number, now: number) {
  const p = countdownParts(ms, now);
  return p.d >= 1 ? 'あと' + p.d + '日' : p.h >= 1 ? 'あと' + p.h + '時間' : 'あと' + p.m + '分';
}
export function fmtDate(date: string, now: number) {
  const a = date.split('-').map(Number);
  const w = '日月火水木金土'[new Date(Date.UTC(a[0], a[1] - 1, a[2])).getUTCDay()];
  return (a[0] !== jst(now).y ? a[0] + '/' : '') + a[1] + '/' + a[2] + '(' + w + ')';
}
export function nextDay(date: string) {
  const a = date.split('-').map(Number);
  const n = new Date(Date.UTC(a[0], a[1] - 1, a[2] + 1));
  return n.getUTCFullYear() + '-' + pad(n.getUTCMonth() + 1) + '-' + pad(n.getUTCDate());
}
