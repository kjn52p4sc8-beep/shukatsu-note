import { DAY, HOUR, deadlineMs, isDate, isTime, jst, jstDateStr, pad } from './dates';
import { ES_LIMITS, STATUS_LABEL, STEPS, type CheckItem, type Entry, type Status } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID がない古い環境向け（http で開いた場合など）
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** http(s) のURLだけを通す。スキームなしのドメインには https:// を補う。 */
export function safeUrl(u: unknown): string {
  const s = String(u ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\/\S+$/i.test(s)) return s.slice(0, 2000);
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i.test(s)) return ('https://' + s).slice(0, 2000);
  return '';
}

type Raw = Record<string, unknown> | null | undefined;
const str = (v: unknown, n: number) => String(v == null ? '' : v).slice(0, n);

/** 外から来たデータ（読み込みファイル・保存データ）を必ずこの形に直す。 */
export function normalizeEntry(raw: Raw, now: number = Date.now()): Entry {
  const r = raw || {};
  const status = (Object.keys(STATUS_LABEL) as Status[]).includes(r.status as Status) ? (r.status as Status) : 'undecided';
  const list = Array.isArray(r.checklist) ? (r.checklist as Raw[]) : [];
  const checklist: CheckItem[] = list
    .filter((c) => c && String(c.text ?? '').trim())
    .slice(0, 50)
    .map((c) => ({ id: str(c!.id, 40) || newId(), text: str(c!.text, 60).trim(), done: !!c!.done }));
  const dDate = isDate(r.dDate) ? r.dDate : '';
  const eDate = isDate(r.eDate) ? r.eDate : '';
  const editedAt = typeof r.editedAt === 'number' && Number.isFinite(r.editedAt) ? r.editedAt : now;
  const deletedAt = typeof r.deletedAt === 'number' && Number.isFinite(r.deletedAt) ? r.deletedAt : null;
  return {
    id: isUuid(r.id) ? r.id.toLowerCase() : newId(),
    company: str(r.company, 100).trim(),
    kind: str(r.kind, 40).trim(),
    platform: str(r.platform, 40).trim(),
    dDate,
    dTime: dDate && isTime(r.dTime) ? r.dTime : '',
    eDate,
    eTime: eDate && isTime(r.eTime) ? r.eTime : '',
    status,
    step: STEPS.includes(r.step as string) ? (r.step as string) : '',
    checklist,
    url: safeUrl(r.url),
    memo: str(r.memo, 2000),
    esDrafts: (Array.isArray(r.esDrafts) ? r.esDrafts : []).filter((v) => v && typeof v === 'object').slice(0, 50).map((v) => ({
      id: isUuid(v.id) ? v.id : newId(), title: str(v.title, 100),
      limit: ES_LIMITS.includes(v.limit) ? v.limit : 400, text: str(v.text, 20000),
    })),
    interviews: (Array.isArray(r.interviews) ? r.interviews : []).filter((v) => v && typeof v === 'object').slice(0, 50).map((v) => ({
      id: isUuid(v.id) ? v.id : newId(), date: isDate(v.date) ? v.date : '', round: str(v.round, 100),
      question: str(v.question, 10000), answer: str(v.answer, 10000), reflection: str(v.reflection, 10000),
    })),
    sample: !!r.sample,
    editedAt,
    deletedAt,
  };
}

/** 締切が近い順 → 期限切れ（新しい順）→ 締切なし */
export function sortEntries(items: Entry[], now: number): Entry[] {
  const rank = (it: Entry) => {
    const ms = deadlineMs(it);
    return ms === null ? 2 : ms < now ? 1 : 0;
  };
  return items.slice().sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return deadlineMs(a)! - deadlineMs(b)! || a.company.localeCompare(b.company, 'ja');
    if (ra === 1) return deadlineMs(b)! - deadlineMs(a)! || a.company.localeCompare(b.company, 'ja');
    return a.company.localeCompare(b.company, 'ja');
  });
}

/** 未提出で、まだ締切が来ていないもの（締切が近い順） */
export function pendingEntries(items: Entry[], now: number): Entry[] {
  return sortEntries(items, now).filter((it) => {
    const ms = deadlineMs(it);
    return it.status === 'undecided' && ms !== null && ms >= now;
  });
}

export function checkProgress(it: Pick<Entry, 'checklist'>) {
  const c = it.checklist || [];
  const done = c.filter((x) => x.done).length;
  return { total: c.length, done, complete: c.length > 0 && done === c.length };
}

export function platformCounts(items: Entry[]): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = it.platform || '未設定';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
}

/** 使い方を見せるためのサンプル（架空の企業）。now を基準に締切をずらして作る。 */
export function sampleEntries(now: number): Entry[] {
  const at = (offset: number, time?: string) => {
    const ms = now + offset;
    return { date: jstDateStr(ms), time: time === 'same' ? pad(jst(ms).h) + ':00' : time || '' };
  };
  const memo = 'これは使い方のサンプルです（架空の企業）。';
  const a = at(20 * HOUR, 'same');
  const b = at(3 * DAY);
  const c = at(9 * DAY, '12:00');
  const ce = at(12 * DAY, '13:00');
  const d = at(-2 * DAY, '23:59');
  const e = at(16 * DAY, '17:00');
  const rows: Raw[] = [
    {
      company: 'サンプル商事（架空）', kind: '本選考', platform: 'マイナビ', dDate: a.date, dTime: a.time,
      status: 'undecided', step: 'ES提出',
      checklist: [{ text: 'ES', done: true }, { text: '顔写真', done: false }, { text: '適性検査', done: false }],
      url: 'https://example.com/mypage', memo: memo + '締切が24時間以内だと赤で表示されます。',
    },
    {
      company: 'サンプル製作所（架空）', kind: 'インターン', platform: 'ワンキャリア', dDate: b.date, dTime: '',
      status: 'submitted', step: 'エントリー',
      checklist: [{ text: 'ES', done: true }, { text: '顔写真', done: true }],
      memo: memo + '時刻が分からない締切は日付だけで登録できます。',
    },
    {
      company: 'サンプル銀行（架空）', kind: '説明会', platform: 'リクナビ', dDate: c.date, dTime: c.time,
      eDate: ce.date, eTime: ce.time, status: 'undecided', step: '', checklist: [],
      memo: memo + '申込締切とは別に開催日時を登録できます。',
    },
    {
      company: 'サンプルコンサルティング（架空）', kind: '本選考', platform: '外資就活ドットコム', dDate: d.date, dTime: d.time,
      status: 'undecided', step: 'エントリー', checklist: [{ text: 'ES', done: false }],
      memo: memo + '期限切れは消さずにグレーで残します。',
    },
    {
      company: 'サンプル食品（架空）', kind: '本選考', platform: '企業マイページ・直接応募', dDate: e.date, dTime: e.time,
      status: 'skipped', step: '', checklist: [], memo,
    },
  ];
  return rows.map((x) => normalizeEntry({ ...x, sample: true }, now));
}
