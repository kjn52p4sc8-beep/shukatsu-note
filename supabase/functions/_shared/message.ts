// リマインダー通知の文面を作る（日本時間で表示）

const JST = 9 * 3600e3;
const DAY = 864e5;
const HOUR = 36e5;
const MIN = 6e4;

export interface ReminderRow {
  entry_id: string;
  user_id: string;
  company: string;
  kind: string;
  /** YYYY-MM-DD */
  deadline_date: string;
  /** HH:MM:SS。時刻未定は null */
  deadline_time: string | null;
  /** ISO 8601 */
  deadline_at: string;
  offset_min: number;
}

export interface PushMessage {
  title: string;
  body: string;
  /** 同じ tag の通知は新しいもので置き換わる */
  tag: string;
  url: string;
}

export function leftText(deadlineMs: number, now: number): string {
  const diff = Math.max(0, deadlineMs - now);
  const d = Math.floor(diff / DAY);
  const h = Math.floor((diff % DAY) / HOUR);
  const m = Math.floor((diff % HOUR) / MIN);
  if (d >= 1) return h >= 1 ? `あと${d}日${h}時間` : `あと${d}日`;
  if (h >= 1) return m >= 1 ? `あと${h}時間${m}分` : `あと${h}時間`;
  return `あと${m}分`;
}

export function dateLabel(date: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const w = '日月火水木金土'[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${mo}/${d}(${w})`;
}

export function reminderMessage(row: ReminderRow, now: number): PushMessage {
  const deadline = Date.parse(row.deadline_at);
  const today = new Date(now + JST).toISOString().slice(0, 10);
  const allDay = !row.deadline_time;
  let title: string;
  if (allDay) {
    // 時刻未定の締切は「日」の単位で伝える（23:59 までの残り時間を出すと紛らわしい）
    const days = Math.round((Date.parse(row.deadline_date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY);
    title = days <= 0 ? '今日が締切です' : days === 1 ? '明日が締切です' : `締切まであと${days}日です`;
  } else {
    title = `締切まで${leftText(deadline, now)}です`;
  }
  const who = row.company + (row.kind ? `（${row.kind}）` : '');
  const when = `締切 ${dateLabel(row.deadline_date)} ${allDay ? '（時刻未定）' : row.deadline_time!.slice(0, 5)}`;
  return { title, body: `${who}\n${when}`, tag: 'entry-' + row.entry_id, url: './' };
}

export function testMessage(): PushMessage {
  return {
    title: 'テスト通知です',
    body: 'この端末で締切のお知らせを受け取れます。',
    tag: 'test',
    url: './',
  };
}
