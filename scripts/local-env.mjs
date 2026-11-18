// ローカルの Supabase（npm run supabase:start）につなぐための設定ファイルを作る。開発とテスト用。
//   node scripts/local-env.mjs
//  ・.env.local               … アプリ（Vite）用
//  ・supabase/functions/.env  … push 関数用（テスト用のVAPID鍵と、テスト用の送信先の許可）
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const status = JSON.parse(execSync('npx supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString());

const fnEnv = 'supabase/functions/.env';
let vapid;
if (existsSync(fnEnv)) {
  const text = readFileSync(fnEnv, 'utf8');
  const get = (k) => text.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1];
  if (get('VAPID_PUBLIC_KEY') && get('VAPID_PRIVATE_KEY')) vapid = { publicKey: get('VAPID_PUBLIC_KEY'), privateKey: get('VAPID_PRIVATE_KEY') };
}
vapid ??= JSON.parse(execSync('node scripts/generate-vapid.mjs --json').toString());

writeFileSync(
  fnEnv,
  [
    `VAPID_PUBLIC_KEY=${vapid.publicKey}`,
    `VAPID_PRIVATE_KEY=${vapid.privateKey}`,
    'VAPID_SUBJECT=https://example.com',
    '# テストで使う偽のプッシュサービス（本番では設定しない）',
    'PUSH_EXTRA_HOSTS=host.docker.internal:54399',
    '',
  ].join('\n'),
);
writeFileSync(
  '.env.local',
  [`VITE_SUPABASE_URL=${status.API_URL}`, `VITE_SUPABASE_ANON_KEY=${status.ANON_KEY}`, `VITE_VAPID_PUBLIC_KEY=${vapid.publicKey}`, ''].join('\n'),
);
console.log('.env.local と supabase/functions/.env を作りました');
