import { describe, expect, it } from 'vitest';
import { normalizeEntry } from '../../src/core/entries';
import type { Entry, Settings } from '../../src/core/types';
import { RemoteError, type Remote } from '../../src/data/remote';
import { Store, type KV } from '../../src/data/store';

class MemoryKV implements KV {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}

/** サーバーの代わり。本物と同じく「編集時刻が古い書き込みは無視」「削除済みは返さない」。 */
class FakeServer implements Remote {
  rows = new Map<string, Entry>();
  settings: Settings | null = null;
  offline = false;
  pushes = 0;
  /** pullEntries の途中に割り込むための仕掛け */
  onPull: (() => void) | null = null;

  private check() {
    if (this.offline) throw new RemoteError('network', 'Failed to fetch');
  }
  async pushEntries(entries: Entry[]) {
    this.check();
    this.pushes++;
    for (const e of entries) {
      const old = this.rows.get(e.id);
      if (!old || e.editedAt >= old.editedAt) this.rows.set(e.id, structuredClone(e));
    }
  }
  async pullEntries() {
    this.check();
    const out = Array.from(this.rows.values()).filter((e) => e.deletedAt === null).map((e) => structuredClone(e));
    this.onPull?.();
    return out;
  }
  async pushSettings(s: Settings) {
    this.check();
    if (!this.settings || s.editedAt >= this.settings.editedAt) this.settings = structuredClone(s);
  }
  async pullSettings() {
    this.check();
    return this.settings ? structuredClone(this.settings) : null;
  }
}

function setup() {
  const server = new FakeServer();
  let t = 1_000_000;
  const clock = () => (t += 1000);
  const device = (name: string, kv = new MemoryKV()) => ({ kv, store: new Store(kv, 'k:' + name, server, clock) });
  return { server, device, clock };
}
const make = (company: string, over: Partial<Entry> = {}) => normalizeEntry({ company, ...over });
const names = (s: Store) => s.getSnapshot().entries.map((e) => e.company).sort();

describe('同期', () => {
  it('追加したものがサーバーに届き、別の端末に現れる', async () => {
    const { server, device } = setup();
    const a = device('a').store;
    const b = device('b').store;
    a.saveEntry(make('A社'));
    expect(a.getSnapshot().sync.pending).toBe(1);
    await a.sync();
    expect(a.getSnapshot().sync).toMatchObject({ phase: 'idle', pending: 0 });
    expect(server.rows.size).toBe(1);
    await b.sync();
    expect(names(b)).toEqual(['A社']);
  });

  it('オフラインの間の変更は端末にたまり、つながったら送られる', async () => {
    const { server, device } = setup();
    const a = device('a').store;
    server.offline = true;
    a.saveEntry(make('A社'));
    a.saveEntry(make('B社'));
    await a.sync();
    expect(a.getSnapshot().sync).toMatchObject({ phase: 'offline', pending: 2 });
    expect(names(a)).toEqual(['A社', 'B社']);
    server.offline = false;
    await a.sync();
    expect(a.getSnapshot().sync).toMatchObject({ phase: 'idle', pending: 0 });
    expect(server.rows.size).toBe(2);
  });

  it('未同期の変更は、アプリを開き直しても残る', async () => {
    const { server, device } = setup();
    const first = device('a');
    server.offline = true;
    first.store.saveEntry(make('A社'));
    await first.store.sync();
    const reopened = device('a', first.kv).store;
    expect(names(reopened)).toEqual(['A社']);
    expect(reopened.getSnapshot().sync.pending).toBe(1);
    server.offline = false;
    await reopened.sync();
    expect(server.rows.size).toBe(1);
  });

  it('削除は別の端末にも伝わる', async () => {
    const { device } = setup();
    const a = device('a').store;
    const b = device('b').store;
    const e = make('A社');
    a.saveEntry(e);
    await a.sync();
    await b.sync();
    b.deleteEntries([e.id]);
    expect(names(b)).toEqual([]);
    await b.sync();
    await a.sync();
    expect(names(a)).toEqual([]);
  });

  it('削除を同期した後でも保存内容ごと復元でき、別端末にも復元が伝わる', async () => {
    const { device } = setup();
    const a = device('a').store;
    const b = device('b').store;
    a.saveEntry(make('A社', { memo: '残したいメモ', esDrafts: [{ id: 'es1', title: '志望動機', limit: 400, text: '本文' }] }));
    await a.sync();
    const saved = structuredClone(a.getSnapshot().entries[0]);
    a.deleteEntries([saved.id]);
    await a.sync();
    await b.sync();
    expect(names(b)).toEqual([]);
    a.saveEntries([saved]);
    await a.sync();
    await b.sync();
    expect(b.getSnapshot().entries[0]).toMatchObject({ id: saved.id, memo: saved.memo, esDrafts: saved.esDrafts, deletedAt: null });
    a.dispose(); b.dispose();
  });

  it('同じエントリーを2台で編集したら、あとから編集したほうが残る', async () => {
    const { device } = setup();
    const a = device('a').store;
    const b = device('b').store;
    const e = make('A社');
    a.saveEntry(e);
    await a.sync();
    await b.sync();
    a.patchEntry(e.id, { memo: '先に編集' });
    b.patchEntry(e.id, { memo: 'あとで編集' });
    // あとで編集した b が先に同期しても、古い a の編集で上書きされない
    await b.sync();
    await a.sync();
    await b.sync();
    expect(a.getSnapshot().entries[0].memo).toBe('あとで編集');
    expect(b.getSnapshot().entries[0].memo).toBe('あとで編集');
  });

  it('削除より古い編集では復活しない', async () => {
    const { device } = setup();
    const a = device('a').store;
    const b = device('b').store;
    const e = make('A社');
    a.saveEntry(e);
    await a.sync();
    await b.sync();
    a.patchEntry(e.id, { memo: '古い編集' });
    b.deleteEntries([e.id]);
    await b.sync();
    await a.sync();
    expect(names(a)).toEqual([]);
  });

  it('同期の途中で編集した内容は、受け取ったデータで上書きされない', async () => {
    const { server, device } = setup();
    const a = device('a').store;
    const e = make('A社');
    a.saveEntry(e);
    await a.sync();
    server.onPull = () => {
      server.onPull = null;
      a.patchEntry(e.id, { memo: '同期中に編集' });
    };
    await a.sync();
    expect(a.getSnapshot().entries[0].memo).toBe('同期中に編集');
    expect(server.rows.get(e.id)!.memo).toBe('同期中に編集');
    expect(a.getSnapshot().sync.pending).toBe(0);
  });

  it('置き換えの読み込みは、元のデータを消して入れ替える', async () => {
    const { server, device } = setup();
    const a = device('a').store;
    a.saveEntries([make('古い1'), make('古い2')]);
    await a.sync();
    a.importEntries([make('新しい')], true);
    expect(names(a)).toEqual(['新しい']);
    await a.sync();
    expect(Array.from(server.rows.values()).filter((r) => r.deletedAt === null).map((r) => r.company)).toEqual(['新しい']);
  });

  it('設定も同期される', async () => {
    const { device } = setup();
    const a = device('a').store;
    const b = device('b').store;
    a.updateSettings({ pushOffsets: [60] });
    await a.sync();
    await b.sync();
    expect(b.getSnapshot().settings.pushOffsets).toEqual([60]);
  });

  it('サーバーのエラーは「同期エラー」として表示用に残す', async () => {
    const { server, device } = setup();
    const a = device('a').store;
    server.pushEntries = async () => {
      throw new RemoteError('other', 'サーバーでエラーが起きました');
    };
    a.saveEntry(make('A社'));
    await a.sync();
    expect(a.getSnapshot().sync).toMatchObject({ phase: 'error', pending: 1, message: 'サーバーでエラーが起きました' });
  });
});

describe('この端末だけに保存する場合', () => {
  it('同期せず、削除はその場で消える', () => {
    const kv = new MemoryKV();
    const s = new Store(kv, 'k', null);
    const e = make('A社');
    s.saveEntry(e);
    expect(s.getSnapshot().sync).toMatchObject({ phase: 'local', pending: 0 });
    s.deleteEntries([e.id]);
    expect(new Store(kv, 'k', null).getSnapshot().entries).toEqual([]);
  });
});

describe('同じミリ秒の連続編集', () => {
  it('送信中の追記を失わず、続けて同期する', async () => {
    const server = new FakeServer();
    const store = new Store(new MemoryKV(), 'race', server, () => 123456);
    const e = make('連続編集社');
    store.saveEntry(e);
    const push = server.pushEntries.bind(server);
    let first = true;
    server.pushEntries = async (rows) => {
      await push(rows);
      if (first) { first = false; store.patchEntry(e.id, { memo: '送信中の変更' }); }
    };
    await store.sync();
    expect(store.getSnapshot().entries[0].memo).toBe('送信中の変更');
    expect(server.rows.get(e.id)!.memo).toBe('送信中の変更');
    expect(server.pushes).toBe(2);
    store.dispose();
  });

  it('送信中の通知設定変更も保持する', async () => {
    const server = new FakeServer();
    const store = new Store(new MemoryKV(), 'settings-race', server, () => 123456);
    store.updateSettings({ pushOffsets: [60] });
    const push = server.pushSettings.bind(server);
    let first = true;
    server.pushSettings = async (settings) => {
      await push(settings);
      if (first) { first = false; store.updateSettings({ pushOffsets: [180] }); }
    };
    await store.sync();
    expect(store.getSnapshot().settings.pushOffsets).toEqual([180]);
    expect(server.settings!.pushOffsets).toEqual([180]);
    store.dispose();
  });
});
