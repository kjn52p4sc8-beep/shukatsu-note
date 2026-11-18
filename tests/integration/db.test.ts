import { afterAll, describe, expect, it } from 'vitest';
import { newId, normalizeEntry } from '../../src/core/entries';
import type { Entry } from '../../src/core/types';
import { entryToRow, supabaseRemote } from '../../src/data/remote';
import { Store, type KV } from '../../src/data/store';
import { admin, anon, cleanupUsers, login, newUser } from './helpers';

afterAll(cleanupUsers);

const make = (company: string, over: Partial<Entry> = {}) => normalizeEntry({ company, ...over });

class MemoryKV implements KV {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}

describe('データの保護（RLS）', () => {
  it('ほかの人のエントリーは読めないし、書き換えられない', async () => {
    const alice = await newUser('alice');
    const bob = await newUser('bob');
    const e = make('アリスの会社', { memo: '秘密のメモ' });
    await supabaseRemote(alice.client).pushEntries([e]);

    expect(await supabaseRemote(alice.client).pullEntries()).toHaveLength(1);
    expect(await supabaseRemote(bob.client).pullEntries()).toHaveLength(0);

    // 直接IDを指定しても見えない・変えられない
    const read = await bob.client.from('entries').select('*').eq('id', e.id);
    expect(read.data).toEqual([]);
    const update = await bob.client.from('entries').update({ memo: '改ざん' }).eq('id', e.id).select();
    expect(update.data).toEqual([]);
    // 同じIDで上書きしようとしても拒否される
    await expect(supabaseRemote(bob.client).pushEntries([{ ...e, memo: '改ざん', editedAt: Date.now() + 1000 }])).rejects.toThrow();
    // 持ち主をすり替えた行は作れない
    const forged = await bob.client.from('entries').insert({ ...entryToRow(make('なりすまし')), user_id: alice.id });
    expect(forged.error).not.toBeNull();

    const { data } = await admin().from('entries').select('memo,user_id').eq('id', e.id).single();
    expect(data).toEqual({ memo: '秘密のメモ', user_id: alice.id });
  });

  it('ログインしていないと何も読めず、何も書けない', async () => {
    const alice = await newUser('alice');
    await supabaseRemote(alice.client).pushEntries([make('A社')]);
    const guest = anon();
    for (const table of ['entries', 'user_settings', 'push_subscriptions', 'reminder_log']) {
      const { data, error } = await guest.from(table).select('*');
      expect(error !== null || (data ?? []).length === 0, table).toBe(true);
    }
    const ins = await guest.from('entries').insert(entryToRow(make('ゲスト')));
    expect(ins.error).not.toBeNull();
  });

  it('利用者は送信記録や、通知の取り出し・定期実行の関数に触れない', async () => {
    const alice = await newUser('alice');
    expect((await alice.client.from('reminder_log').select('*')).error).not.toBeNull();
    for (const [fn, args] of [
      ['claim_due_reminders', {}],
      ['verify_cron_secret', { p_secret: 'x'.repeat(40) }],
      ['configure_reminders', { p_function_url: 'https://example.com' }],
      ['invoke_push_reminders', {}],
      ['purge_old_rows', {}],
    ] as const) {
      const { error } = await alice.client.rpc(fn, args);
      expect(error, fn).not.toBeNull();
    }
  });
});

describe('編集の勝ち負け', () => {
  it('古い編集は無視され、新しい編集だけが反映される', async () => {
    const u = await newUser();
    const remote = supabaseRemote(u.client);
    const t = Date.now() - 60000;
    const e = make('A社', { memo: '最初' });
    await remote.pushEntries([{ ...e, editedAt: t }]);
    await remote.pushEntries([{ ...e, memo: '新しい', editedAt: t + 2000 }]);
    await remote.pushEntries([{ ...e, memo: '古い', editedAt: t + 1000 }]);
    const [row] = await remote.pullEntries();
    expect(row.memo).toBe('新しい');
    expect(row.editedAt).toBe(t + 2000);
  });

  it('端末の時計が未来にずれていても、未来の時刻は記録しない', async () => {
    const u = await newUser();
    const remote = supabaseRemote(u.client);
    await remote.pushEntries([{ ...make('A社'), editedAt: Date.now() + 86400e3 }]);
    const [row] = await remote.pullEntries();
    expect(Math.abs(row.editedAt - Date.now())).toBeLessThan(60000);
  });

  it('削除済みの印が付いたものは取得されない', async () => {
    const u = await newUser();
    const remote = supabaseRemote(u.client);
    const e = make('A社');
    const t = Date.now() - 5000;
    await remote.pushEntries([{ ...e, editedAt: t }]);
    await remote.pushEntries([{ ...e, editedAt: t + 1000, deletedAt: t + 1000 }]);
    expect(await remote.pullEntries()).toEqual([]);
  });

  it('日付・時刻・チェックリストが往復しても変わらない', async () => {
    const u = await newUser();
    const remote = supabaseRemote(u.client);
    const e = make('往復テスト社', {
      kind: '本選考', platform: 'マイナビ', dDate: '2026-12-01', dTime: '09:30', eDate: '2026-12-05', eTime: '13:00',
      status: 'submitted', step: 'ES提出', url: 'https://example.com/mypage', memo: 'メモ\n2行目', sample: true,
      checklist: [{ id: newId(), text: 'ES', done: true }],
      esDrafts: [{ id: newId(), title: '自己PR', limit: 400, text: '私の強みは、粘り強さです。\n2行目' }],
      interviews: [{ id: newId(), date: '2026-12-03', round: '一次面接', question: '学生時代に力を入れたことは？', answer: 'ゼミ活動です。', reflection: '結論から話す' }],
      editedAt: Date.now() - 1000,
    });
    await remote.pushEntries([e]);
    expect(await remote.pullEntries()).toEqual([e]);
    const { data } = await admin().from('entries').select('deadline_at').eq('id', e.id).single();
    expect(Date.parse(data!.deadline_at)).toBe(Date.parse('2026-12-01T09:30:00+09:00'));
  });

  it('時刻未定の締切は、日本時間のその日の 23:59:59 として扱われる', async () => {
    const u = await newUser();
    const e = make('A社', { dDate: '2026-12-01' });
    await supabaseRemote(u.client).pushEntries([e]);
    const { data } = await admin().from('entries').select('deadline_at').eq('id', e.id).single();
    expect(Date.parse(data!.deadline_at)).toBe(Date.parse('2026-12-01T23:59:59+09:00'));
  });
});

describe('2台の端末での同期（本物のサーバー）', () => {
  it('スマホで追加・編集・削除した内容が、PCに反映される', async () => {
    const u = await newUser();
    const phone = new Store(new MemoryKV(), 'phone', supabaseRemote(u.client));
    const pc = new Store(new MemoryKV(), 'pc', supabaseRemote(await login(u.email, u.password)));
    const names = (s: Store) => s.getSnapshot().entries.map((x) => x.company).sort();

    const a = make('A社', { dDate: '2026-12-01' });
    const b = make('B社');
    phone.saveEntries([a, b]);
    await phone.sync();
    await pc.sync();
    expect(names(pc)).toEqual(['A社', 'B社']);

    // スマホで書いたESと面接の記録が、PCでも読める
    phone.patchEntry(a.id, {
      esDrafts: [{ id: newId(), title: '志望動機', limit: 300, text: '御社を志望する理由は…' }],
      interviews: [{ id: newId(), date: '2026-12-02', round: '一次面接', question: '志望理由は？', answer: '…', reflection: '次は具体例を' }],
    });
    await phone.sync();
    await pc.sync();
    const onPc = pc.getSnapshot().entries.find((x) => x.id === a.id)!;
    expect(onPc.esDrafts.map((d) => [d.title, d.limit, d.text])).toEqual([['志望動機', 300, '御社を志望する理由は…']]);
    expect(onPc.interviews.map((d) => [d.date, d.round, d.reflection])).toEqual([['2026-12-02', '一次面接', '次は具体例を']]);

    pc.patchEntry(a.id, { status: 'submitted' });
    pc.deleteEntries([b.id]);
    pc.updateSettings({ pushOffsets: [60], icsReminders: [1440] });
    await pc.sync();
    await phone.sync();
    expect(names(phone)).toEqual(['A社']);
    expect(phone.getSnapshot().entries[0].status).toBe('submitted');
    expect(phone.getSnapshot().settings).toMatchObject({ pushOffsets: [60], icsReminders: [1440] });
    expect(phone.getSnapshot().sync).toMatchObject({ phase: 'idle', pending: 0 });
    phone.dispose();
    pc.dispose();
  });
});

describe('企業の登録の削除と取り消し（本物のサーバー）', () => {
  it('削除は別の端末にも伝わり、元に戻すとES・面接ノートごと別の端末にも戻る。通知の対象からも外れる', async () => {
    const u = await newUser();
    const phone = new Store(new MemoryKV(), 'phone', supabaseRemote(u.client));
    const pc = new Store(new MemoryKV(), 'pc', supabaseRemote(await login(u.email, u.password)));
    const names = (s: Store) => s.getSnapshot().entries.map((x) => x.company).sort();

    const target = make('みらい商事', {
      dDate: '2031-03-10', dTime: '12:00', memo: '残したいメモ',
      esDrafts: [{ id: newId(), title: '志望動機', limit: 400, text: '御社を志望する理由は…' }],
      interviews: [{ id: newId(), date: '2031-03-01', round: '一次面接', question: '強みは？', answer: '粘り強さ', reflection: '具体例を' }],
    });
    const other = make('あおぞら銀行', { dDate: '2031-03-10', dTime: '12:00' });
    phone.saveEntries([target, other]);
    await phone.sync();
    await pc.sync();
    expect(names(pc)).toEqual(['あおぞら銀行', 'みらい商事']);
    const saved = structuredClone(phone.getSnapshot().entries.find((e) => e.id === target.id)!);

    // 削除 → PC からも消え、サーバーでは削除済みの印が付く（通知の対象外）
    phone.deleteEntries([target.id]);
    await phone.sync();
    await pc.sync();
    expect(names(pc)).toEqual(['あおぞら銀行']);
    const { data: row } = await admin().from('entries').select('deleted_at').eq('id', target.id).single();
    expect(row!.deleted_at).not.toBeNull();
    const { data: due } = await admin().rpc('claim_due_reminders', { p_now: new Date(Date.parse('2031-03-10T10:00:00+09:00')).toISOString() });
    expect((due as { entry_id: string }[]).map((r) => r.entry_id)).not.toContain(target.id);

    // 元に戻す（アプリの「元に戻す」と同じく、削除前の内容を保存し直す）→ PC にも ES・面接ノートごと戻る
    phone.saveEntries([saved]);
    await phone.sync();
    await pc.sync();
    expect(names(pc)).toEqual(['あおぞら銀行', 'みらい商事']);
    const back = pc.getSnapshot().entries.find((e) => e.id === target.id)!;
    expect(back.memo).toBe('残したいメモ');
    expect(back.esDrafts.map((d) => d.title)).toEqual(['志望動機']);
    expect(back.interviews.map((d) => d.round)).toEqual(['一次面接']);
    phone.dispose();
    pc.dispose();
  });
});

describe('アカウントの削除', () => {
  it('本人の操作で、アカウントとデータがすべて消える', async () => {
    const u = await newUser();
    const other = await newUser('other');
    await supabaseRemote(u.client).pushEntries([make('A社')]);
    await supabaseRemote(other.client).pushEntries([make('残る会社')]);
    await supabaseRemote(u.client).pushSettings({ icsReminders: [60], pushOffsets: [60], editedAt: Date.now() });

    const { error } = await u.client.rpc('delete_my_account');
    expect(error).toBeNull();

    expect((await admin().from('entries').select('id').eq('user_id', u.id)).data).toEqual([]);
    expect((await admin().from('user_settings').select('user_id').eq('user_id', u.id)).data).toEqual([]);
    expect((await admin().auth.admin.getUserById(u.id)).data.user).toBeNull();
    // ほかの人のデータは残る
    expect((await admin().from('entries').select('id').eq('user_id', other.id)).data).toHaveLength(1);
  });
});
