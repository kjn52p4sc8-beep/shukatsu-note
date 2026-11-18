import { pad } from './dates';
import { isUuid, normalizeEntry } from './entries';
import { STATUS_LABEL, type Entry, type Status } from './types';

export const CSV_COLS = [
  'ID', '企業名', '内容', '応募プラットフォーム', '申込締切日', '申込締切時刻', '開催日', '開催時刻',
  '状態', '選考ステップ', '提出物', 'マイページURL', 'メモ', 'サンプル', 'ES原稿JSON', '面接記録JSON',
];

function csvCell(v: unknown) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(items: Entry[]) {
  const rows: unknown[][] = [CSV_COLS];
  for (const it of items) {
    rows.push([
      it.id, it.company, it.kind, it.platform, it.dDate, it.dTime, it.eDate, it.eTime,
      STATUS_LABEL[it.status], it.step,
      it.checklist.map((c) => (c.done ? '[x] ' : '[ ] ') + c.text).join('\n'),
      it.url, it.memo, it.sample ? 'サンプル' : '', JSON.stringify(it.esDrafts), JSON.stringify(it.interviews),
    ]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function parseCSV(input: string): string[][] {
  const text = String(input).replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ''));
}

const normDateCell = (v: string) => {
  const m = String(v || '').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  return m ? m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) : '';
};
const normTimeCell = (v: string) => {
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})(:\d{2})?$/);
  return m ? pad(m[1]) + ':' + m[2] : '';
};

/** 読み込んだ1件。legacyId は旧バージョン（ブラウザ保存版）のIDで、UUIDでないもの。 */
export interface Imported {
  entry: Entry;
  legacyId: string;
}

function toImported(raw: Record<string, unknown>, now: number): Imported {
  const rawId = String(raw.id ?? '').trim();
  const entry = normalizeEntry({ ...raw, editedAt: now, deletedAt: null }, now);
  return { entry, legacyId: rawId && !isUuid(rawId) ? rawId : '' };
}

export function itemsFromCSV(text: string, now: number = Date.now()): Imported[] {
  const rows = parseCSV(text);
  if (rows.length < 1) return [];
  const head = rows[0].map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  if (col('企業名') < 0) throw new Error('「企業名」の列が見つかりません');
  const get = (r: string[], name: string) => {
    const i = col(name);
    return i < 0 ? '' : r[i] || '';
  };
  const statusKey = (label: string) =>
    (Object.keys(STATUS_LABEL) as Status[]).find((k) => STATUS_LABEL[k] === label.trim()) || 'undecided';
  return rows
    .slice(1)
    .map((r) =>
      toImported(
        {
          id: get(r, 'ID'),
          company: get(r, '企業名'),
          kind: get(r, '内容'),
          platform: get(r, '応募プラットフォーム'),
          dDate: normDateCell(get(r, '申込締切日')),
          dTime: normTimeCell(get(r, '申込締切時刻')),
          eDate: normDateCell(get(r, '開催日')),
          eTime: normTimeCell(get(r, '開催時刻')),
          status: statusKey(get(r, '状態')),
          step: get(r, '選考ステップ').trim(),
          checklist: get(r, '提出物')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => {
              const m = l.match(/^\[( |x|X)\]\s*(.*)$/);
              return m ? { text: m[2], done: m[1] !== ' ' } : { text: l, done: false };
            }),
          url: get(r, 'マイページURL'),
          memo: get(r, 'メモ'),
          esDrafts: get(r, 'ES原稿JSON') ? JSON.parse(get(r, 'ES原稿JSON')) : [],
          interviews: get(r, '面接記録JSON') ? JSON.parse(get(r, '面接記録JSON')) : [],
          sample: get(r, 'サンプル').trim() === 'サンプル',
        },
        now,
      ),
    )
    .filter((x) => x.entry.company);
}

export function itemsFromJSON(text: string, now: number = Date.now()): Imported[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
  if (!arr) throw new Error('このアプリのバックアップ形式ではありません');
  return (arr as Record<string, unknown>[])
    .filter((x) => x && typeof x === 'object')
    .map((x) => toImported(x, now))
    .filter((x) => x.entry.company);
}

export function parseBackup(fileName: string, text: string, now: number = Date.now()): Imported[] {
  const asCsv = /\.csv$/i.test(fileName) || !/^\s*[[{]/.test(text);
  return asCsv ? itemsFromCSV(text, now) : itemsFromJSON(text, now);
}

/**
 * 旧バージョンのID（UUIDでない文字列）から、利用者ごとに決まったUUIDを作る。
 * 同じバックアップを2回読み込んでも二重登録にならないようにするため。
 */
export async function legacyIdToUuid(scope: string, legacyId: string): Promise<string> {
  const data = new TextEncoder().encode('shimekiri:' + scope + ':' + legacyId);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const b = hash.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function toBackupJSON(items: Entry[], exportedAt: number) {
  return JSON.stringify(
    { app: 'shukatsu-shimekiri', version: 3, exportedAt: new Date(exportedAt).toISOString(), items },
    null,
    2,
  );
}
