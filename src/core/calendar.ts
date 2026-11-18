import { HOUR, MIN, isDate, isTime, nextDay, pad, toMs } from './dates';
import type { Entry } from './types';

export interface CalEvent {
  uid: string;
  type: 'deadline' | 'event';
  title: string;
  desc: string;
  allDay: boolean;
  date: string;
  start?: number;
  end?: number;
}

export function utcStamp(ms: number) {
  const d = new Date(ms);
  return (
    d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'
  );
}
const whenText = (date: string, time: string) =>
  date ? date.replace(/-/g, '/') + (time ? ' ' + time : '（時刻未定）') : '';

/**
 * 時刻ありの締切は「締切の時刻に始まる予定」にする（最長30分。日付をまたがない）。
 * 予定の開始＝締切なので、.ics の通知もカレンダー側の既定の通知も、締切の時刻から数えて鳴る。
 */
export function calEvent(it: Entry, type: 'deadline' | 'event'): CalEvent | null {
  const isD = type === 'deadline';
  const date = isD ? it.dDate : it.eDate;
  const time = isD ? it.dTime : it.eTime;
  if (!isDate(date)) return null;
  const name = [it.company, it.kind].filter(Boolean).join(' ');
  const desc: string[] = [];
  if (it.platform) desc.push('応募プラットフォーム: ' + it.platform);
  if (it.dDate) desc.push('申込締切: ' + whenText(it.dDate, it.dTime) + '（日本時間）');
  if (it.eDate) desc.push('開催日時: ' + whenText(it.eDate, it.eTime) + '（日本時間）');
  if (it.url) desc.push('マイページ: ' + it.url);
  if (it.memo) desc.push('メモ: ' + it.memo);
  const ev: CalEvent = {
    uid: it.id + '-' + type + '@shukatsu-shimekiri',
    type,
    desc: desc.join('\n'),
    allDay: !isTime(time),
    date,
    title: '',
  };
  if (ev.allDay) {
    ev.title = (isD ? '【締切】' : '【開催】') + name;
  } else if (isD) {
    ev.start = toMs(date, time, true)!;
    ev.end = Math.min(ev.start + 30 * MIN, toMs(date, '', true)!);
    if (ev.end <= ev.start) ev.end = ev.start + MIN;
    ev.title = '【締切 ' + time + '】' + name;
  } else {
    ev.start = toMs(date, time, false)!;
    ev.end = ev.start + HOUR;
    ev.title = '【開催】' + name;
  }
  return ev;
}

/**
 * リマインダー（分）→ iCalendar の TRIGGER（予定の開始から数える）。
 * - 時刻ありの予定：開始（＝締切・開催の時刻）の r 分前。
 * - 時刻なしの締切：その日の 24:00 締切とみなす。日単位（前日・3日前・7日前）は、その日の朝9:00。
 *   時間単位（3時間前・1時間前）は当日の 21:00・23:00（予定の開始＝その日の0:00より後なので、正の値になる）。
 * - 時刻なしの開催：日単位だけを、その日の朝9:00に鳴らす。
 */
export function alarmTriggers(ev: CalEvent, reminders: number[]): string[] {
  const out: string[] = [];
  for (const r of reminders || []) {
    if (!ev.allDay) out.push('-PT' + r + 'M');
    else if (r >= 1440) out.push('-PT' + (Math.round(r / 1440) * 24 - 9) + 'H');
    else if (ev.type === 'deadline') out.push('PT' + (1440 - r) + 'M');
  }
  return Array.from(new Set(out));
}

const icsEsc = (s: string) =>
  String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function utf8Len(ch: string) {
  const c = ch.codePointAt(0)!;
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
}
/** 1行75オクテットで折り返す（マルチバイト文字の途中では切らない） */
export function foldLine(line: string) {
  let out = '';
  let len = 0;
  for (const ch of line) {
    const n = utf8Len(ch);
    if (len + n > 75) {
      out += '\r\n ';
      len = 1;
    }
    out += ch;
    len += n;
  }
  return out;
}

function vevent(ev: CalEvent, reminders: number[], stamp: number): string[] {
  const L = ['BEGIN:VEVENT', 'UID:' + ev.uid, 'DTSTAMP:' + utcStamp(stamp)];
  if (ev.allDay) {
    L.push('DTSTART;VALUE=DATE:' + ev.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + nextDay(ev.date).replace(/-/g, ''));
  } else {
    L.push('DTSTART:' + utcStamp(ev.start!), 'DTEND:' + utcStamp(ev.end!));
  }
  L.push('SUMMARY:' + icsEsc(ev.title));
  if (ev.desc) L.push('DESCRIPTION:' + icsEsc(ev.desc));
  for (const t of alarmTriggers(ev, reminders)) {
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc(ev.title), 'TRIGGER:' + t, 'END:VALARM');
  }
  L.push('END:VEVENT');
  return L;
}

export function buildICS(events: CalEvent[], reminders: number[], stamp: number) {
  let L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shukatsu Shimekiri Board//JA',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:就活しめきり',
  ];
  for (const ev of events) L = L.concat(vevent(ev, reminders, stamp));
  L.push('END:VCALENDAR');
  return L.map(foldLine).join('\r\n') + '\r\n';
}

export function googleUrl(ev: CalEvent) {
  const dates = ev.allDay
    ? ev.date.replace(/-/g, '') + '/' + nextDay(ev.date).replace(/-/g, '')
    : utcStamp(ev.start!) + '/' + utcStamp(ev.end!);
  return (
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(ev.title) +
    '&dates=' + dates +
    '&details=' + encodeURIComponent(ev.desc) +
    '&ctz=Asia%2FTokyo'
  );
}

export function allEvents(items: Entry[]): CalEvent[] {
  const out: CalEvent[] = [];
  for (const it of items) {
    if (it.status === 'skipped') continue;
    for (const t of ['deadline', 'event'] as const) {
      const ev = calEvent(it, t);
      if (ev) out.push(ev);
    }
  }
  return out;
}
