import { normalizeEntry } from '../core/entries';
import { DEFAULT_SETTINGS, REMINDERS, type Entry, type Settings } from '../core/types';
import { RemoteError, type Remote } from './remote';

/** localStorage と同じ形の保存先。テストではメモリ上の偽物を使う。 */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SyncPhase =
  /** クラウド同期なし（この端末だけに保存） */
  | 'local'
  | 'idle'
  | 'syncing'
  /** 通信できない。変更は端末にためてあり、つながったら送る */
  | 'offline'
  | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  /** まだサーバーに送れていない変更の数 */
  pending: number;
  lastSyncAt: number | null;
  message: string;
}

export interface Snapshot {
  /** 削除されていないエントリー */
  entries: Entry[];
  settings: Settings;
  sync: SyncStatus;
  /** 端末に保存できているか（プライベートブラウズなどでは false） */
  storageOK: boolean;
  /** 一度でも読み込みが終わったか（初回同期が終わるまでの表示用） */
  ready: boolean;
}

interface Persisted {
  v: 1;
  entries: Record<string, Entry>;
  settings: Settings;
  dirty: string[];
  settingsDirty: boolean;
  lastSyncAt: number | null;
}

const cleanOffsets = (v: unknown, fallback: number[]) =>
  Array.isArray(v) ? (v as unknown[]).filter((n): n is number => REMINDERS.some((r) => r[0] === n)) : fallback.slice();

function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  return {
    icsReminders: cleanOffsets(raw?.icsReminders, DEFAULT_SETTINGS.icsReminders),
    pushOffsets: cleanOffsets(raw?.pushOffsets, DEFAULT_SETTINGS.pushOffsets),
    editedAt: typeof raw?.editedAt === 'number' ? raw.editedAt : 0,
  };
}

/**
 * エントリーと設定の置き場所。
 *
 * 変更はまず端末に保存して画面に反映し、そのあとサーバーに送る（オフラインでも使える）。
 * 同期は「変更を送る → サーバーの全件を受け取る」の2段階。まだ送れていない変更（dirty）は
 * 受け取った内容で上書きしない。どちらの編集が勝つかはサーバー側が編集時刻で決める。
 */
export class Store {
  private entries: Record<string, Entry> = {};
  private settings: Settings = normalizeSettings(null);
  private dirty = new Set<string>();
  private settingsDirty = false;
  private lastSyncAt: number | null = null;

  private phase: SyncPhase;
  private message = '';
  private storageOK = true;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private cleared = false;

  constructor(
    private storage: KV,
    readonly key: string,
    private remote: Remote | null,
    private clock: () => number = Date.now,
    /** 通信できる状態か。圏外と分かっているときは、送受信を試みずに待つ */
    private online: () => boolean = () => true,
  ) {
    this.phase = remote ? 'idle' : 'local';
    this.load();
  }

  // ---- 読み取り ----

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): Snapshot => {
    if (!this.snapshot) {
      this.snapshot = {
        entries: Object.values(this.entries).filter((e) => e.deletedAt === null),
        settings: this.settings,
        sync: {
          phase: this.phase,
          pending: this.dirty.size + (this.settingsDirty ? 1 : 0),
          lastSyncAt: this.lastSyncAt,
          message: this.message,
        },
        storageOK: this.storageOK,
        ready: !this.remote || this.lastSyncAt !== null || this.phase === 'offline' || this.phase === 'error',
      };
    }
    return this.snapshot;
  };

  get pendingCount() {
    return this.dirty.size + (this.settingsDirty ? 1 : 0);
  }

  // ---- 変更 ----

  /** 追加または上書き。編集時刻はここで付ける。 */
  saveEntry(entry: Entry) {
    this.put([entry]);
  }

  saveEntries(entries: Entry[]) {
    this.put(entries);
  }

  patchEntry(id: string, patch: Partial<Entry>) {
    const cur = this.entries[id];
    if (!cur || cur.deletedAt !== null) return;
    this.put([{ ...cur, ...patch, id }]);
  }

  deleteEntries(ids: string[]) {
    const now = this.clock();
    for (const id of ids) {
      const cur = this.entries[id];
      if (!cur) continue;
      if (this.remote) {
        // ほかの端末にも削除を伝えるため、いったん「削除済み」の印を付けて同期する
        this.entries[id] = { ...cur, editedAt: now, deletedAt: now };
        this.dirty.add(id);
      } else {
        delete this.entries[id];
      }
    }
    this.changed();
  }

  /** 読み込み。replace なら今あるものをすべて消してから入れる。 */
  importEntries(entries: Entry[], replace: boolean) {
    if (replace) {
      const keep = new Set(entries.map((e) => e.id));
      this.deleteEntries(Object.keys(this.entries).filter((id) => !keep.has(id)));
    }
    this.put(entries);
  }

  updateSettings(patch: Partial<Pick<Settings, 'icsReminders' | 'pushOffsets'>>) {
    this.settings = normalizeSettings({ ...this.settings, ...patch, editedAt: this.clock() });
    if (this.remote) this.settingsDirty = true;
    this.changed();
  }

  private put(list: Entry[]) {
    const now = this.clock();
    for (const e of list) {
      const next = normalizeEntry({ ...e, editedAt: now, deletedAt: null }, now);
      if (!next.company) continue;
      this.entries[next.id] = next;
      if (this.remote) this.dirty.add(next.id);
    }
    this.changed();
  }

  private changed() {
    this.persist();
    this.emit();
    this.scheduleSync(600);
  }

  // ---- 同期 ----

  scheduleSync(delay = 0) {
    if (!this.remote || this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, delay);
  }

  /** いますぐ同期する。実行中に呼ばれたら、終わったあとにもう一度だけ行う。 */
  sync(): Promise<void> {
    if (!this.remote || this.disposed) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runSync().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runSync() {
    const remote = this.remote!;
    do {
      this.again = false;
      if (!this.online()) {
        this.setPhase('offline', '');
        return;
      }
      this.setPhase('syncing', '');
      try {
        // 1. 端末の変更を送る
        const batch = Array.from(this.dirty)
          .map((id) => this.entries[id])
          .filter(Boolean);
        const sentEntries = new Map(batch.map((e) => [e.id, e] as const));
        if (batch.length) await remote.pushEntries(batch);
        for (const [id, sentEntry] of sentEntries) {
          // 送っている間にもう一度編集されたものは、次の同期まで残す
          if (this.entries[id] === sentEntry) this.dirty.delete(id);
        }
        for (const id of Array.from(this.dirty)) if (!this.entries[id]) this.dirty.delete(id);

        if (this.settingsDirty) {
          const sent = this.settings;
          await remote.pushSettings(this.settings);
          if (this.settings === sent) this.settingsDirty = false;
        }

        // 2. サーバーの内容を受け取る
        const rows = await remote.pullEntries();
        const serverSettings = await remote.pullSettings();
        if (this.disposed) return;

        const next: Record<string, Entry> = {};
        for (const r of rows) next[r.id] = this.dirty.has(r.id) && this.entries[r.id] ? this.entries[r.id] : r;
        for (const id of this.dirty) if (!next[id] && this.entries[id]) next[id] = this.entries[id];
        this.entries = next;
        if (!this.settingsDirty && serverSettings) this.settings = serverSettings;

        this.lastSyncAt = this.clock();
        this.persist();
        this.setPhase('idle', '');
        // 同期している間に編集されたものがあれば、続けてもう一度送る
        if (this.dirty.size || this.settingsDirty) this.again = true;
      } catch (e) {
        if (this.disposed) return;
        const kind = e instanceof RemoteError ? e.kind : 'other';
        if (kind === 'network') this.setPhase('offline', '');
        else if (kind === 'auth') this.setPhase('error', 'ログインの有効期限が切れました。ログインし直してください。');
        else this.setPhase('error', e instanceof Error ? e.message : '同期に失敗しました');
        return;
      }
    } while (this.again && !this.disposed);
  }

  private setPhase(phase: SyncPhase, message: string) {
    if (this.phase === phase && this.message === message && phase !== 'idle') return;
    this.phase = phase;
    this.message = message;
    this.emit();
  }

  // ---- 保存 ----

  private load() {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      this.storageOK = false;
    }
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as Partial<Persisted>;
      const entries: Record<string, Entry> = {};
      for (const v of Object.values(d.entries ?? {})) {
        const e = normalizeEntry(v as unknown as Record<string, unknown>);
        if (e.company) entries[e.id] = e;
      }
      this.entries = entries;
      this.settings = normalizeSettings(d.settings);
      this.dirty = new Set(this.remote ? (d.dirty ?? []).filter((id) => entries[id]) : []);
      this.settingsDirty = !!this.remote && !!d.settingsDirty;
      this.lastSyncAt = typeof d.lastSyncAt === 'number' ? d.lastSyncAt : null;
    } catch {
      // 壊れた保存データは使わない（サーバーから取り直す）
    }
  }

  /** ほかのタブが保存した内容を読み直す */
  reloadFromStorage() {
    if (this.running) return;
    this.load();
    this.emit();
  }

  private persist() {
    if (this.cleared) return;
    const data: Persisted = {
      v: 1,
      entries: this.entries,
      settings: this.settings,
      dirty: Array.from(this.dirty),
      settingsDirty: this.settingsDirty,
      lastSyncAt: this.lastSyncAt,
    };
    try {
      this.storage.setItem(this.key, JSON.stringify(data));
      this.storageOK = true;
    } catch {
      this.storageOK = false;
    }
  }

  /** 端末に保存してある内容を消す（ログアウト時） */
  clearLocal() {
    // 進行中の同期があとから書き戻さないようにする
    this.cleared = true;
    try {
      this.storage.removeItem(this.key);
    } catch {
      // 消せなくても続行する
    }
  }

  private emit() {
    this.snapshot = null;
    for (const fn of Array.from(this.listeners)) fn();
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }
}
