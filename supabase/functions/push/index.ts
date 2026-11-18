// Edge Function「push」
//
// 2つの使い方がある。
//  1. データベースの定期実行（5分おき）から呼ばれ、締切が近いエントリーの通知を送る
//     → x-cron-secret ヘッダーの合言葉で、本当に定期実行からの呼び出しかを確かめる
//  2. アプリの「テスト通知を送る」ボタンから呼ばれ、ログイン中の本人の端末にテスト通知を送る
//     → Authorization ヘッダーのログイン情報で本人を確かめる
//
// 必要なシークレット: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
import { isAllowedPushEndpoint, sendWebPush, type VapidKeys } from '../_shared/webpush.ts';
import { reminderMessage, testMessage, type PushMessage, type ReminderRow } from '../_shared/message.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
// テスト用: 追加で送信を許可するホスト（カンマ区切り）。本番では設定しない
const EXTRA_HOSTS = (Deno.env.get('PUSH_EXTRA_HOSTS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Subscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function vapidKeys(): VapidKeys | null {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`データベースの呼び出しに失敗しました (${res.status}): ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

const rpc = <T>(name: string, args: unknown) => db<T>(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });

function subscriptionsOf(userIds: string[]): Promise<Subscription[]> {
  const list = userIds.map((id) => `"${id}"`).join(',');
  return db<Subscription[]>(`push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(${list})`);
}

interface Job {
  sub: Subscription;
  message: PushMessage;
  ttl: number;
}

/** まとめて送り、もう存在しない宛先は登録から消す */
async function deliver(jobs: Job[], vapid: VapidKeys) {
  let sent = 0;
  let failed = 0;
  const gone = new Set<string>();
  const queue = jobs.slice();
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (!isAllowedPushEndpoint(job.sub.endpoint, EXTRA_HOSTS)) {
        gone.add(job.sub.id);
        failed++;
        continue;
      }
      const r = await sendWebPush(job.sub, JSON.stringify(job.message), vapid, {
        ttl: job.ttl,
        urgency: 'high',
      });
      if (r.ok) sent++;
      else {
        failed++;
        if (r.gone) gone.add(job.sub.id);
        else console.warn('push failed', r.status, new URL(job.sub.endpoint).host);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(10, jobs.length) }, worker));
  if (gone.size) {
    const list = Array.from(gone).map((id) => `"${id}"`).join(',');
    await db(`push_subscriptions?id=in.(${list})`, { method: 'DELETE' });
  }
  return { sent, failed, removed: gone.size };
}

async function runReminders(vapid: VapidKeys) {
  const now = Date.now();
  const rows = await rpc<ReminderRow[]>('claim_due_reminders', {});
  if (!rows.length) return { reminders: 0, sent: 0, failed: 0, removed: 0 };
  const subs = await subscriptionsOf(Array.from(new Set(rows.map((r) => r.user_id))));
  const jobs: Job[] = [];
  for (const row of rows) {
    const message = reminderMessage(row, now);
    // 締切を過ぎたら届ける意味がないので、預かり時間は締切まで
    const ttl = Math.max(60, Math.min(24 * 3600, Math.floor((Date.parse(row.deadline_at) - now) / 1000)));
    for (const sub of subs) if (sub.user_id === row.user_id) jobs.push({ sub, message, ttl });
  }
  return { reminders: rows.length, ...(await deliver(jobs, vapid)) };
}

async function userIdFromToken(authorization: string | null): Promise<string | null> {
  if (!authorization?.toLowerCase().startsWith('bearer ')) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: authorization },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.id === 'string' ? user.id : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST で呼び出してください' }, 405);

  try {
    const vapid = vapidKeys();
    if (!vapid) return json({ error: 'VAPID の鍵が設定されていません' }, 500);

    const body = await req.json().catch(() => ({}));
    const cronSecret = req.headers.get('x-cron-secret');

    if (cronSecret !== null) {
      const ok = await rpc<boolean>('verify_cron_secret', { p_secret: cronSecret });
      if (!ok) return json({ error: '認証に失敗しました' }, 401);
      return json(await runReminders(vapid));
    }

    if (body?.action === 'test') {
      const userId = await userIdFromToken(req.headers.get('Authorization'));
      if (!userId) return json({ error: 'ログインが必要です' }, 401);
      const subs = await subscriptionsOf([userId]);
      const result = await deliver(subs.map((sub) => ({ sub, message: testMessage(), ttl: 300 })), vapid);
      return json({ devices: subs.length, ...result });
    }

    return json({ error: '認証に失敗しました' }, 401);
  } catch (e) {
    console.error(e);
    return json({ error: '通知の送信中にエラーが起きました' }, 500);
  }
});
