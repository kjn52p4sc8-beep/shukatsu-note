// Web Push の送信（RFC 8030 / 8291 / 8292）。
// 標準の Web Crypto と fetch だけで書いてあり、Deno（Edge Functions）でも Node でも動く。

export interface PushSubscriptionKeys {
  endpoint: string;
  /** 端末の公開鍵（base64url, 65バイト） */
  p256dh: string;
  /** 端末の認証用シークレット（base64url, 16バイト） */
  auth: string;
}

export interface VapidKeys {
  /** base64url, 65バイト（未圧縮のP-256公開鍵） */
  publicKey: string;
  /** base64url, 32バイト */
  privateKey: string;
  /** 連絡先。mailto: か https: のURL */
  subject: string;
}

export interface PushOptions {
  /** 端末がオフラインのとき、プッシュサービスが預かっておく秒数 */
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** 同じ topic の未配信メッセージは新しいもので置き換えられる */
  topic?: string;
}

const enc = new TextEncoder();

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// TypeScript の BufferSource 型に合わせるための変換（中身はコピーしない）
const buf = (u: Uint8Array) => u as unknown as BufferSource;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

function rawPublicToJwk(raw: Uint8Array): JsonWebKey {
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('公開鍵の形式が正しくありません');
  return { kty: 'EC', crv: 'P-256', x: b64urlEncode(raw.slice(1, 33)), y: b64urlEncode(raw.slice(33, 65)), ext: true };
}

/** テスト用に、乱数（salt と一時鍵）を外から差し替えられる */
export interface EncryptOverrides {
  salt?: Uint8Array;
  /** 一時鍵の秘密鍵（32バイト）と公開鍵（65バイト） */
  localPrivateKey?: Uint8Array;
  localPublicKey?: Uint8Array;
}

/** メッセージ本文を aes128gcm で暗号化する（RFC 8291） */
export async function encryptPayload(
  payload: Uint8Array,
  sub: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  overrides: EncryptOverrides = {},
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (authSecret.length !== 16) throw new Error('auth の長さが正しくありません');
  if (payload.length > 3993) throw new Error('メッセージが長すぎます');

  let localPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (overrides.localPrivateKey && overrides.localPublicKey) {
    asPublic = overrides.localPublicKey;
    localPrivate = await crypto.subtle.importKey(
      'jwk',
      { ...rawPublicToJwk(asPublic), d: b64urlEncode(overrides.localPrivateKey) },
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    localPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }

  const uaKey = await crypto.subtle.importKey('jwk', rawPublicToJwk(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, localPrivate, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = overrides.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  // 0x02 は「これが最後のレコード」の印
  const plaintext = concat(payload, new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, aesKey, buf(plaintext)));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** VAPID（RFC 8292）の Authorization ヘッダーを作る */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, nowSec: number): Promise<string> {
  const pub = b64urlDecode(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    'jwk',
    { ...rawPublicToJwk(pub), d: vapid.privateKey },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: vapid.subject })),
  );
  const unsigned = header + '.' + claims;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, buf(enc.encode(unsigned))));
  return 'vapid t=' + unsigned + '.' + b64urlEncode(sig) + ', k=' + vapid.publicKey;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** 宛先がもう存在しない（端末側で通知を解除した・アプリを消した）。登録を消してよい */
  gone: boolean;
}

export async function sendWebPush(
  sub: PushSubscriptionKeys,
  payload: string,
  vapid: VapidKeys,
  options: PushOptions = {},
): Promise<PushResult> {
  const body = await encryptPayload(enc.encode(payload), sub);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid, Math.floor(Date.now() / 1000)),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(Math.max(0, Math.floor(options.ttl ?? 3600))),
    Urgency: options.urgency ?? 'normal',
  };
  if (options.topic) headers.Topic = options.topic;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(sub.endpoint, { method: 'POST', headers, body: buf(body), signal: ctrl.signal });
    await res.body?.cancel();
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { ok: false, status: 0, gone: false };
  } finally {
    clearTimeout(timer);
  }
}

/** プッシュサービスとして知られているホストだけに送る（任意のURLへ送らされるのを防ぐ） */
const PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  '.push.services.mozilla.com',
  '.push.apple.com',
  '.notify.windows.com',
];

export function isAllowedPushEndpoint(endpoint: string, extraHosts: string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (extraHosts.includes(url.host)) return true;
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((s) => (s.startsWith('.') ? host.endsWith(s) : host === s));
}

/** VAPID の鍵ペアを新しく作る */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d! };
}
