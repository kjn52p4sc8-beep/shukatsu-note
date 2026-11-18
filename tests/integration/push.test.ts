import crypto from 'node:crypto';
import http from 'node:http';
import ece from 'http_ece';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeEntry } from '../../src/core/entries';
import type { Entry } from '../../src/core/types';
import { supabaseRemote } from '../../src/data/remote';
import { admin, anon, cleanupUsers, newUser, stack, type TestUser } from './helpers';

// 偽のプッシュサービス。関数（Dockerの中）から届いた通知を受け取って復号する。
// supabase/functions/.env の PUSH_EXTRA_HOSTS=host.docker.internal:54399 と対になっている。
const PORT = 54399;
const HOST = `http://host.docker.internal:${PORT}`;

interface Received {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}
const received: Received[] = [];
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = req.url?.startsWith('/gone') ? 410 : 201;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, '0.0.0.0', resolve));
});
afterAll(async () => {
  // 関数側が接続を開いたままにしていることがあるので、先に切ってから閉じる
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await cleanupUsers();
});

/** ブラウザの代わりに、通知の受け取り口（鍵つき）を作って登録する */
async function subscribe(user: TestUser, path: string, base = HOST) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const endpoint = `${base}/${path}-${crypto.randomUUID()}`;
  const { error } = await user.client.rpc('register_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: ecdh.getPublicKey().toString('base64url'),
    p_auth: auth.toString('base64url'),
    p_user_agent: 'integration-test',
  });
  if (error) throw error;
  const decrypt = (r: Received) =>
    JSON.parse(ece.decrypt(r.body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString('utf8'));
  return { endpoint, path: new URL(endpoint).pathname, decrypt };
}

async function waitFor(path: string, timeoutMs = 20000): Promise<Received> {
  const start = Date.now();
  for (;;) {
    const hit = received.find((r) => r.path === path);
    if (hit) return hit;
    if (Date.now() - start > timeoutMs) throw new Error('通知が届きませんでした: ' + path);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const make = (company: string, over: Partial<Entry> = {}) => normalizeEntry({ company, ...over });
const jst = (s: string) => Date.parse(s + '+09:00');
const iso = (ms: number) => new Date(ms).toISOString();

/** 指定した時刻に「いま送るべき通知」を取り出す（この利用者の分だけ見る） */
async function claim(user: TestUser, nowMs: number) {
  const { data, error } = await admin().rpc('claim_due_reminders', { p_now: iso(nowMs) });
  if (error) throw error;
  return (data as { user_id: string; company: string; offset_min: number }[])
    .filter((r) => r.user_id === user.id)
    .map((r) => `${r.company}:${r.offset_min}`)
    .sort();
}

describe('通知先の登録', () => {
  it('同じ端末で別の人がログインし直したら、通知先はその人のものになる', async () => {
    const alice = await newUser('alice');
    const bob = await newUser('bob');
    const sub = await subscribe(alice, 'shared');
    const again = await bob.client.rpc('register_push_subscription', {
      p_endpoint: sub.endpoint, p_p256dh: 'B'.repeat(87), p_auth: 'A'.repeat(22), p_user_agent: 'bob',
    });
    expect(again.error).toBeNull();
    expect((await alice.client.from('push_subscriptions').select('id')).data).toEqual([]);
    expect((await bob.client.from('push_subscriptions').select('endpoint')).data).toEqual([{ endpoint: sub.endpoint }]);
  });

  it('ログインしていないと登録できない', async () => {
    const { error } = await anon().rpc('register_push_subscription', {
      p_endpoint: 'https://fcm.googleapis.com/x', p_p256dh: 'B'.repeat(87), p_auth: 'A'.repeat(22),
    });
    expect(error).not.toBeNull();
  });
});

describe('いつ通知するかの判定', () => {
  it('時刻ありの締切: 24時間前と3時間前に1回ずつ', async () => {
    const u = await newUser();
    await subscribe(u, 'timed');
    await supabaseRemote(u.client).pushEntries([make('A社', { dDate: '2031-03-10', dTime: '12:00' })]);
    const D = jst('2031-03-10T12:00:00');
    expect(await claim(u, D - 25 * 3600e3)).toEqual([]);
    expect(await claim(u, D - 24 * 3600e3)).toEqual(['A社:1440']);
    expect(await claim(u, D - 23 * 3600e3)).toEqual([]); // 同じ通知は二度送らない
    expect(await claim(u, D - 3 * 3600e3)).toEqual(['A社:180']);
    expect(await claim(u, D - 1 * 3600e3)).toEqual([]);
    expect(await claim(u, D + 1000)).toEqual([]); // 締切を過ぎたら送らない
  });

  it('締切の直前に登録した場合は、まとめて1通だけ', async () => {
    const u = await newUser();
    await subscribe(u, 'late');
    await supabaseRemote(u.client).pushEntries([make('B社', { dDate: '2031-03-10', dTime: '12:00' })]);
    const D = jst('2031-03-10T12:00:00');
    expect(await claim(u, D - 2 * 3600e3)).toEqual(['B社:180']);
    expect(await claim(u, D - 2 * 3600e3 + 60000)).toEqual([]);
  });

  it('時刻未定の締切: 前日の朝9時と、当日の21時', async () => {
    const u = await newUser();
    await subscribe(u, 'allday');
    await supabaseRemote(u.client).pushEntries([make('C社', { dDate: '2031-03-10' })]);
    expect(await claim(u, jst('2031-03-09T08:59:00'))).toEqual([]);
    expect(await claim(u, jst('2031-03-09T09:00:00'))).toEqual(['C社:1440']);
    expect(await claim(u, jst('2031-03-10T20:59:00'))).toEqual([]);
    expect(await claim(u, jst('2031-03-10T21:00:00'))).toEqual(['C社:180']);
  });

  it('提出済み・見送り・削除済みには送らない。通知先がない人にも送らない', async () => {
    const u = await newUser();
    const noDevice = await newUser('nodevice');
    await subscribe(u, 'skip');
    const t = Date.now() - 5000;
    const gone = make('削除済み', { dDate: '2031-03-10', dTime: '12:00' });
    await supabaseRemote(u.client).pushEntries([
      make('提出済み', { dDate: '2031-03-10', dTime: '12:00', status: 'submitted' }),
      make('見送り', { dDate: '2031-03-10', dTime: '12:00', status: 'skipped' }),
      { ...gone, editedAt: t, deletedAt: t },
      make('未定', { dDate: '2031-03-10', dTime: '12:00' }),
    ]);
    await supabaseRemote(noDevice.client).pushEntries([make('端末なし', { dDate: '2031-03-10', dTime: '12:00' })]);
    const now = jst('2031-03-10T10:00:00');
    expect(await claim(u, now)).toEqual(['未定:180']);
    expect(await claim(noDevice, now)).toEqual([]);
  });

  it('通知のタイミングの設定に従う。締切を変更したら、新しい締切でもう一度知らせる', async () => {
    const u = await newUser();
    await subscribe(u, 'settings');
    const remote = supabaseRemote(u.client);
    await remote.pushSettings({ icsReminders: [], pushOffsets: [60], editedAt: Date.now() });
    const e = make('D社', { dDate: '2031-03-10', dTime: '12:00', editedAt: Date.now() - 5000 });
    await remote.pushEntries([e]);
    const D = jst('2031-03-10T12:00:00');
    expect(await claim(u, D - 3 * 3600e3)).toEqual([]);
    expect(await claim(u, D - 3600e3)).toEqual(['D社:60']);
    await remote.pushEntries([{ ...e, dDate: '2031-03-11', editedAt: Date.now() }]);
    expect(await claim(u, D + 86400e3 - 3600e3)).toEqual(['D社:60']);
  });
});

describe('push 関数', () => {
  const fn = () => `${stack().API_URL}/functions/v1/push`;

  it('ログインしていない呼び出しや、合言葉が違う呼び出しは断る', async () => {
    const post = (headers: Record<string, string>, body: unknown) =>
      fetch(fn(), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    expect((await post({}, { action: 'test' })).status).toBe(401);
    expect((await post({}, { action: 'reminders' })).status).toBe(401);
    expect((await post({ 'x-cron-secret': 'x'.repeat(64) }, { action: 'reminders' })).status).toBe(401);
    expect((await post({ Authorization: 'Bearer ' + stack().ANON_KEY }, { action: 'test' })).status).toBe(401);
  });

  it('テスト通知: 本人の端末にだけ、暗号化されて届く', async () => {
    const u = await newUser();
    const other = await newUser('other');
    const mine = await subscribe(u, 'test');
    const theirs = await subscribe(other, 'test-other');

    const { data, error } = await u.client.functions.invoke('push', { body: { action: 'test' } });
    expect(error).toBeNull();
    expect(data).toMatchObject({ devices: 1, sent: 1, failed: 0 });

    const r = await waitFor(mine.path);
    expect(mine.decrypt(r)).toMatchObject({ title: 'テスト通知です', tag: 'test' });
    expect(r.headers['content-encoding']).toBe('aes128gcm');
    expect(r.headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(Number(r.headers.ttl)).toBeGreaterThan(0);
    expect(received.some((x) => x.path === theirs.path)).toBe(false);
  });

  it('もう存在しない宛先や、プッシュサービスでない宛先は登録から消す', async () => {
    const u = await newUser();
    const ok = await subscribe(u, 'alive');
    await subscribe(u, 'gone');
    await subscribe(u, 'x', 'https://evil.example.com');
    const { data } = await u.client.functions.invoke('push', { body: { action: 'test' } });
    expect(data).toMatchObject({ devices: 3, sent: 1, failed: 2, removed: 2 });
    expect((await u.client.from('push_subscriptions').select('endpoint')).data).toEqual([{ endpoint: ok.endpoint }]);
  });

  it('定期実行 → 関数 → 端末 まで、締切の通知が通しで届く', async () => {
    const u = await newUser();
    const sub = await subscribe(u, 'cron');
    // いまから2時間後が締切（「3時間前」の通知がすぐ対象になる）
    const deadline = Date.now() + 2 * 3600e3;
    const d = new Date(deadline + 9 * 3600e3).toISOString();
    await supabaseRemote(u.client).pushEntries([make('通し確認社', { kind: '本選考', dDate: d.slice(0, 10), dTime: d.slice(11, 16) })]);

    // データベースから見た関数のURL（Docker の中での名前）を登録して、定期実行と同じ処理を呼ぶ
    const conf = await admin().rpc('configure_reminders', { p_function_url: 'http://kong:8000/functions/v1/push' });
    expect(conf.error).toBeNull();
    const run = await admin().rpc('invoke_push_reminders');
    expect(run.error).toBeNull();

    const r = await waitFor(sub.path);
    const msg = sub.decrypt(r);
    expect(msg.title).toMatch(/^締切まであと1時間\d+分です$/);
    expect(msg.body).toContain('通し確認社（本選考）');
    expect(r.headers.urgency).toBe('high');

    // もう一度呼んでも、同じ通知は送られない
    received.length = 0;
    await admin().rpc('invoke_push_reminders');
    await new Promise((res) => setTimeout(res, 3000));
    expect(received.filter((x) => x.path === sub.path)).toEqual([]);
  });
});
