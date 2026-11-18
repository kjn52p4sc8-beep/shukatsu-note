# 就活しめきりボード

最新の追加機能と更新手順は [機能追加と使い方](機能追加と使い方.md) を参照してください。ES・面接ノートのクラウド同期には追加マイグレーションが必要です。

今回の改善内容・確認結果・起動方法は [修正内容と使い方](修正内容と使い方.md) を参照してください。

複数の就活サイトのエントリーと締切を1画面で管理する Web アプリ（PWA）です。

- ログインして使い、スマホと PC で同じデータを見られます（クラウド同期）
- オフラインでも開いて編集でき、つながったときに自動で同期します
- 未提出のまま締切が近づくと、アプリを閉じていてもプッシュ通知が届きます
- カレンダー（Google / .ics）への書き出し、JSON・CSV のバックアップと読み込みができます
- 以前のブラウザ保存版で書き出したバックアップも読み込めます

## しくみ

| 部分 | 使っているもの | 場所 |
| --- | --- | --- |
| 画面 | React + TypeScript + Vite（PWA） | `src/` |
| ログイン・データ保存 | Supabase（Auth / Postgres） | `supabase/migrations/` |
| 通知の送信 | Supabase Edge Function + pg_cron（5分おき） | `supabase/functions/push/` |

データは Supabase の Postgres に保存し、行レベルセキュリティ（RLS）で**本人だけ**が読み書きできます。
同期は「端末の変更を送る → サーバーの全件を受け取る」方式で、同じエントリーを2台で編集した場合は
あとから編集したほうが残ります。

## まず動かしてみる（ログインなし・この端末だけに保存）

Supabase の設定をしなくても、端末保存だけの版として動きます。Node.js 22 以上が必要です。

```bash
npm install
```

```bash
npm run dev
```

表示された URL（http://localhost:5173）を開きます。この状態では同期とプッシュ通知は使えません。

## 本番用のセットアップ

Supabase（無料枠あり）のアカウントと、公開先（Vercel / Netlify / Cloudflare Pages など、静的サイトを置ける
サービス）が必要です。コマンドはこのフォルダで実行します。

### 1. Supabase のプロジェクトを作る

<https://supabase.com> でプロジェクトを作ります（リージョンは Tokyo がおすすめ）。
作成後、Project Settings で次の2つを控えます。

- **Project URL**（`https://xxxx.supabase.co`）と、その `xxxx` の部分（プロジェクトID）
- **公開用キー**（anon key または publishable key）

### 2. データベースの定義を反映する

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <プロジェクトID>
```

```bash
npx supabase db push
```

> `npx supabase config push` は実行しないでください。`supabase/config.toml` は手元での開発用の設定です。

### 3. プッシュ通知の鍵を作って登録する

```bash
npm run vapid
```

表示された公開鍵と秘密鍵を、Supabase のシークレットに登録します。`VAPID_SUBJECT` には公開するサイトの
URL（または `mailto:` で始まる連絡先）を入れます。**秘密鍵は人に見せず、ファイルにも残さないでください。**

```bash
npx supabase secrets set VAPID_PUBLIC_KEY=<公開鍵> VAPID_PRIVATE_KEY=<秘密鍵> VAPID_SUBJECT=https://<公開するサイトのURL>
```

### 4. 通知を送る関数を公開する

```bash
npx supabase functions deploy push
```

### 5. 5分おきの締切チェックを有効にする

Supabase の管理画面の SQL Editor で、次の1行を実行します（1回だけ）。

```sql
select public.configure_reminders('https://<プロジェクトID>.supabase.co/functions/v1/push');
```

### 6. ログインまわりの設定（Supabase 管理画面 → Authentication）

- **URL Configuration**: Site URL に公開するサイトの URL を入れる（確認メールやパスワード再設定の戻り先になります）
- **パスワードの最小文字数**: 8 にする（アプリ側の案内と合わせる）
- **メール送信**: Supabase 標準のメール送信は1時間あたりの通数がごく少ないため、自分以外にも使ってもらう
  場合は独自の SMTP（Resend など）を設定する
- Google ログインを使う場合は、Google プロバイダーを設定して `.env` に `VITE_AUTH_GOOGLE=true` を足す

### 7. アプリをビルドして公開する

`.env.example` を `.env` という名前でコピーし、手順1の URL・公開用キーと、手順3の**公開鍵**を入れます。

```bash
npm run build
```

できあがった `dist` フォルダの中身を公開先に置きます。Vercel などにリポジトリをつないで自動ビルドする場合は、
`.env` と同じ3つの値を公開先の環境変数に設定し、ビルドコマンドを `npm run build`、出力フォルダを `dist` にします。
プッシュ通知とオフライン機能には **https** が必要です（上記のサービスはどれも https です）。

### 8. 使い始める

- 公開した URL を開いて「はじめての方」から登録します
- 設定 →「締切の通知」→「この端末で通知を受け取る」→「テスト通知を送る」で届くか確かめます
- **iPhone / iPad** は、Safari の共有ボタン →「ホーム画面に追加」で追加したアプリから開いたときだけ通知を
  受け取れます（iOS 16.4 以降）
- 以前のブラウザ保存版のデータは、旧アプリの「JSONで書き出す」→ 新アプリの「ファイルから読み込む」で移せます

## 通知のしくみ

1. pg_cron が5分おきに `invoke_push_reminders()` を実行し、Edge Function `push` を呼びます
2. 関数は `claim_due_reminders()` で「いま送るべき通知」を取り出します（同時に送信済みとして記録するので、
   同じ通知は二度送られません）
3. 利用者が登録した端末へ Web Push（暗号化）で送ります。届かなくなった宛先は自動で登録から消します

通知の対象は「状態が未定のまま、締切がまだ来ていないエントリー」です。タイミング（前日 / 3時間前 / 1時間前）
は設定画面で選べます。時刻が未定の締切は 23:59 締切とみなし、「前日」は前日の朝9時に送ります。

## テスト

```bash
npm test
```

締切計算・書き出し・同期の手順・通知の暗号化（RFC 8291 のテストベクトル）を確かめる単体テストです。

結合テストと E2E テストは、手元で Supabase を動かして行います（Docker が必要）。

```bash
npm run supabase:start
```

```bash
node scripts/local-env.mjs
```

別のターミナルで、通知用の関数を起動したままにします。

```bash
npm run supabase:functions
```

```bash
npm run test:integration
```

```bash
npm run test:e2e
```

- 結合テスト: 本人以外が読み書きできないこと、編集の勝ち負け、通知を送るタイミング、
  定期実行 → 関数 → 端末 までの通知の流れ（偽のプッシュサービスで受け取って復号）
- E2E テスト: 登録、別端末への同期、オフラインでの編集、パスワード再設定、旧データの読み込み、アカウント削除

## フォルダ構成

```
src/
  core/        締切の計算、並べ替え、カレンダー・CSV・JSON の書き出しと読み込み（画面に依存しない）
  data/        端末への保存と同期（store.ts）、Supabase とのやりとり（remote.ts）、ログイン（auth.ts）
  push/        この端末の通知のオン・オフ
  components/  画面の部品
  ui/          ダイアログ、トースト、ファイル保存など
  sw.ts        Service Worker（オフライン対応と通知の表示）
supabase/
  migrations/  テーブル、RLS、通知の判定、定期実行
  functions/   push 関数と Web Push の送信処理
tests/         unit / integration / e2e
scripts/       通知用の鍵の作成、手元テスト用の設定ファイル作成
```

## 知っておくこと

- 通知は最大で5分ほど遅れることがあります（5分おきに確認しているため）
- Supabase の無料プランは、しばらくアクセスがないとプロジェクトが一時停止します。停止中は同期も通知も
  止まるので、管理画面から再開してください
- 就活サイトの ID やパスワードは保存しません（マイページの URL だけ保存します）
- 設定画面の「アカウントを削除」で、アカウントと登録したデータをすべて消せます

## 応募メールから締切を取り込む

Gmailの読み取り連携と、iCloudなどからの転送メール受信を追加しています。抽出した候補を確認してから締切へ登録・更新できます。実際の接続にはサーバー設定が必要です。[設定手順とデータの扱い](docs/mail-setup.md)をご覧ください。

## 企業の登録を削除する

企業一覧の詳細、または編集画面の「削除」から対象を確認できます。同じ企業の複数登録は、チェックした場合だけまとめて削除します。ES・面接ノートも対象となり、直後のお知らせから8秒間は復元できます。外部の応募やメール・カレンダー予定は削除しません。[Claudeへの引き継ぎプロンプトと反映状況](docs/claude-handoff.md)も同梱しています。
