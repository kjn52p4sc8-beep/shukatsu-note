import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEntry } from '../core/entries';
import { DEFAULT_SETTINGS, REMINDERS, type Entry, type Settings } from '../core/types';

/** 同期先（サーバー）とのやりとり。テストでは偽物に差し替える。 */
export interface Remote {
  /** 変更をまとめて送る（削除済みの印が付いたものも含む） */
  pushEntries(entries: Entry[]): Promise<void>;
  /** 削除されていないエントリーをすべて取得する */
  pullEntries(): Promise<Entry[]>;
  pushSettings(settings: Settings): Promise<void>;
  pullSettings(): Promise<Settings | null>;
}

export class RemoteError extends Error {
  constructor(
    public kind: 'network' | 'auth' | 'other',
    message: string,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

interface EntryRow {
  id: string;
  company: string;
  kind: string;
  platform: string;
  deadline_date: string | null;
  deadline_time: string | null;
  event_date: string | null;
  event_time: string | null;
  status: string;
  step: string;
  checklist: unknown;
  url: string;
  memo: string;
  es_drafts?: unknown;
  interviews?: unknown;
  is_sample: boolean;
  edited_at: string;
  deleted_at: string | null;
}

const ENTRY_COLS =
  'id,company,kind,platform,deadline_date,deadline_time,event_date,event_time,status,step,checklist,url,memo,es_drafts,interviews,is_sample,edited_at,deleted_at';

export function entryToRow(e: Entry): EntryRow {
  return {
    id: e.id,
    company: e.company,
    kind: e.kind,
    platform: e.platform,
    deadline_date: e.dDate || null,
    deadline_time: e.dDate && e.dTime ? e.dTime : null,
    event_date: e.eDate || null,
    event_time: e.eDate && e.eTime ? e.eTime : null,
    status: e.status,
    step: e.step,
    checklist: e.checklist,
    url: e.url,
    memo: e.memo,
    es_drafts: e.esDrafts,
    interviews: e.interviews,
    is_sample: e.sample,
    edited_at: new Date(e.editedAt).toISOString(),
    deleted_at: e.deletedAt === null ? null : new Date(e.deletedAt).toISOString(),
  };
}

export function rowToEntry(r: EntryRow): Entry {
  return normalizeEntry({
    id: r.id,
    company: r.company,
    kind: r.kind,
    platform: r.platform,
    dDate: r.deadline_date ?? '',
    dTime: (r.deadline_time ?? '').slice(0, 5),
    eDate: r.event_date ?? '',
    eTime: (r.event_time ?? '').slice(0, 5),
    status: r.status,
    step: r.step,
    checklist: r.checklist,
    url: r.url,
    memo: r.memo,
    esDrafts: r.es_drafts,
    interviews: r.interviews,
    sample: r.is_sample,
    editedAt: Date.parse(r.edited_at),
    deletedAt: r.deleted_at ? Date.parse(r.deleted_at) : null,
  });
}

const validOffsets = (v: unknown, fallback: number[]) =>
  Array.isArray(v) ? v.filter((n) => REMINDERS.some((r) => r[0] === n)) : fallback;

interface ErrorLike {
  message?: string;
  code?: string;
}

function toRemoteError(error: ErrorLike, status: number): RemoteError {
  const msg = error.message || '通信に失敗しました';
  if (!status || /failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) return new RemoteError('network', msg);
  if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') return new RemoteError('auth', msg);
  return new RemoteError('other', msg);
}

const PAGE = 1000;
const CHUNK = 200;

export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async pushEntries(entries) {
      for (let i = 0; i < entries.length; i += CHUNK) {
        const rows = entries.slice(i, i + CHUNK).map(entryToRow);
        const { error, status } = await client.from('entries').upsert(rows, { onConflict: 'id' });
        if (error) throw toRemoteError(error, status);
      }
    },

    async pullEntries() {
      const out: Entry[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error, status } = await client
          .from('entries')
          .select(ENTRY_COLS)
          .is('deleted_at', null)
          .order('id')
          .range(from, from + PAGE - 1)
          // 再試行は Store 側で行う（ここで待つと「同期中」のまま止まって見える）
          .retry(false);
        if (error) throw toRemoteError(error, status);
        const rows = (data ?? []) as EntryRow[];
        for (const r of rows) out.push(rowToEntry(r));
        if (rows.length < PAGE) break;
      }
      return out;
    },

    async pushSettings(settings) {
      const { error, status } = await client.from('user_settings').upsert(
        {
          ics_reminders: settings.icsReminders,
          push_offsets: settings.pushOffsets,
          edited_at: new Date(settings.editedAt || Date.now()).toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (error) throw toRemoteError(error, status);
    },

    async pullSettings() {
      const { data, error, status } = await client
        .from('user_settings')
        .select('ics_reminders,push_offsets,edited_at')
        .retry(false)
        .maybeSingle();
      if (error) throw toRemoteError(error, status);
      if (!data) return null;
      return {
        icsReminders: validOffsets(data.ics_reminders, DEFAULT_SETTINGS.icsReminders),
        pushOffsets: validOffsets(data.push_offsets, DEFAULT_SETTINGS.pushOffsets),
        editedAt: Date.parse(data.edited_at),
      };
    },
  };
}
