// プッシュ通知用の鍵（VAPID）を新しく作って表示する。
//   npm run vapid
// 公開鍵はアプリ側（.env の VITE_VAPID_PUBLIC_KEY）と Supabase のシークレットの両方に、
// 秘密鍵は Supabase のシークレットだけに設定する。秘密鍵は人に見せない・リポジトリに入れない。
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ publicKey, privateKey }));
} else {
  console.log('公開鍵（VITE_VAPID_PUBLIC_KEY / VAPID_PUBLIC_KEY）:');
  console.log(publicKey);
  console.log('');
  console.log('秘密鍵（VAPID_PRIVATE_KEY。Supabase のシークレットにだけ設定する）:');
  console.log(privateKey);
}
