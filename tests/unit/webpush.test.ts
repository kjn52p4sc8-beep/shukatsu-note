import crypto from 'node:crypto';
import ece from 'http_ece';
import { describe, expect, it } from 'vitest';
import { dateLabel, leftText, reminderMessage } from '../../supabase/functions/_shared/message.ts';
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  vapidAuthorization,
} from '../../supabase/functions/_shared/webpush.ts';

describe('Web Push の暗号化', () => {
  it('RFC 8291 付録A のテストベクトルと一致する', async () => {
    const body = await encryptPayload(
      new TextEncoder().encode('When I grow up, I want to be a watermelon'),
      {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      {
        salt: b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw'),
        localPrivateKey: b64urlDecode('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
        localPublicKey: b64urlDecode('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
      },
    );
    expect(b64urlEncode(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('別の実装（http_ece）で復号できる', async () => {
    const ua = crypto.createECDH('prime256v1');
    ua.generateKeys();
    const auth = crypto.randomBytes(16);
    const text = JSON.stringify({ title: '締切まであと3時間です', body: 'サンプル商事（本選考）' });
    const body = await encryptPayload(new TextEncoder().encode(text), {
      p256dh: b64urlEncode(ua.getPublicKey()),
      auth: b64urlEncode(auth),
    });
    const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
    expect(plain.toString('utf8')).toBe(text);
  });
});

describe('VAPID', () => {
  it('署名を公開鍵で検証できる', async () => {
    const keys = await generateVapidKeys();
    expect(b64urlDecode(keys.publicKey)).toHaveLength(65);
    expect(b64urlDecode(keys.privateKey)).toHaveLength(32);
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'https://example.com' }, 1_800_000_000);
    const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 12 * 3600, sub: 'https://example.com' });
    const pub = b64urlDecode(keys.publicKey);
    const key = crypto.createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)) },
      format: 'jwk',
    });
    const ok = crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
    expect(ok).toBe(true);
  });
});

describe('送信先の制限', () => {
  it('プッシュサービス以外のURLには送らない', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-pn1p.notify.windows.com/w/?token=x')).toBe(true);
    expect(isAllowedPushEndpoint('https://evil.example.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('http://169.254.169.254/latest')).toBe(false);
    expect(isAllowedPushEndpoint('not a url')).toBe(false);
    expect(isAllowedPushEndpoint('http://localhost:9999/x', ['localhost:9999'])).toBe(true);
  });
});

describe('通知の文面', () => {
  const now = Date.parse('2026-11-16T09:00:00+09:00');
  const row = { entry_id: 'e1', user_id: 'u1', company: 'サンプル商事', kind: '本選考', offset_min: 180 };

  it('時刻ありの締切は残り時間を伝える', () => {
    const m = reminderMessage({ ...row, deadline_date: '2026-11-16', deadline_time: '12:00:00', deadline_at: '2026-11-16T03:00:00+00:00' }, now);
    expect(m.title).toBe('締切まであと3時間です');
    expect(m.body).toBe('サンプル商事（本選考）\n締切 11/16(月) 12:00');
    expect(m.tag).toBe('entry-e1');
  });

  it('時刻未定の締切は「今日」「明日」で伝える', () => {
    const at = (d: string) => ({ ...row, deadline_date: d, deadline_time: null, deadline_at: d + 'T14:59:59+00:00' });
    expect(reminderMessage(at('2026-11-17'), now).title).toBe('明日が締切です');
    expect(reminderMessage(at('2026-11-16'), now).title).toBe('今日が締切です');
    expect(reminderMessage(at('2026-11-17'), now).body).toContain('締切 11/17(火) （時刻未定）');
  });

  it('残り時間と日付の表示', () => {
    expect(leftText(now + 24 * 3600e3, now)).toBe('あと1日');
    expect(leftText(now + 59 * 60e3, now)).toBe('あと59分');
    expect(dateLabel('2026-11-20')).toBe('11/20(金)');
  });
});
