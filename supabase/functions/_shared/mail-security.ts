const bytes = (s: string) => new TextEncoder().encode(s);
export const b64 = (b: Uint8Array) => btoa(Array.from(b, n => String.fromCharCode(n)).join(''));
export const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const base64url = (b: Uint8Array) => b64(b).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
export const randomSecret = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(s: string) { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(s)))); }
export async function seal(value: string, keyText: string) {
  const key = await crypto.subtle.importKey('raw', unb64(keyText), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes(value));
  return `${b64(iv)}.${b64(new Uint8Array(data))}`;
}
export async function unseal(value: string, keyText: string) {
  const [iv, data] = value.split('.');
  const key = await crypto.subtle.importKey('raw', unb64(keyText), 'AES-GCM', false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(data)));
}
/** Resend/Svixの署名。JSONを解析する前に生の本文を検証する。 */
export async function verifyWebhook(raw: string, headers: Headers, secret: string, now = Date.now()): Promise<boolean> {
  try {
    const id = headers.get('svix-id'); const timestamp = headers.get('svix-timestamp');
    if (!id || !timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
    const key = await crypto.subtle.importKey('raw', unb64(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    for (const sig of (headers.get('svix-signature') ?? '').split(' ')) {
      const [version, value] = sig.split(',');
      if (version === 'v1' && value && await crypto.subtle.verify('HMAC', key, unb64(value), bytes(`${id}.${timestamp}.${raw}`))) return true;
    }
  } catch { /* malformed signatures are rejected */ }
  return false;
}
