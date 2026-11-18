# 応募メールから締切を取り込む

Gmailの読み取り連携と、iCloudなどからのメール転送に対応します。コードを配置しただけでは受信は始まりません。以下のサーバー設定と、利用者本人の接続操作が必要です。

## 利用者の操作

1. 公開版にログインし、ホームの「応募メールから締切を取り込む」を開きます。
2. Gmailを接続するか、専用の転送先を発行して応募メールを転送します。iCloudのパスワードは使いません。
3. 確認待ち一覧で、原文・企業名・募集コース・締切日時を確認します。
4. 「確認して登録」で締切を追加します。期限変更の場合は既存の登録を選び「確認して締切を更新」を押します。既存のESや面接ノートは保持します。

同じメールの再取得・Webhookの再送・登録ボタンの再送では重複登録しません。Gmailと転送の両方で届いたメール、別メールとして再送された案内は別候補になるため、同じ企業の登録を確認してください。

年のない日付、相対日付、海外時間、複数日付の記載は確認が必要です。公式サイトの巡回・公式情報との照合は行いません。抽出候補は「応募メール由来」として表示し、確認前は締切通知の対象にしません。登録後の通知には既存の通知設定・端末の通知許可・push関数の設定が必要です。

## 1. 公開URLとSupabase

Vercelのプロジェクトで **Visit** を押して開く、実際の公開URLを使います。`vercel.com/チーム名` や `所有者/リポジトリ名` は認証の戻り先に使えません。

既存の[README](../README.md)に従い、SupabaseログインとVercelの `VITE_SUPABASE_URL` / 公開用キーを設定してください。メール機能にサービスロールキーをフロントへ渡す必要はありません。

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

`20261118000000_mail_import.sql` が適用されることを確認します。既存データの削除はありません。

## 2. Gmailの設定

Google CloudでGmail APIを有効にし、OAuth同意画面と「ウェブアプリケーション」のOAuthクライアントを作成します。

- 承認済みリダイレクトURI：`https://YOUR_APP.vercel.app/?mail_callback=1`
- スコープ：`https://www.googleapis.com/auth/gmail.readonly`
- テスト中は、実際に接続するGoogleアカウントをテストユーザーとして追加します。
- Googleで要求される読み取り権限はメールボックス全体に対する権限です。アプリの取得対象は就活キーワードまたは指定ラベルで絞ります。ラベル限定のOAuth権限ではありません。
- 一般公開には、Googleの制限付きスコープに対する審査や、構成によってセキュリティ評価が必要になります。テストモードにはユーザー数・更新トークンの有効期間などの制限があります。開発テスト完了を一般公開の承認と混同しないでください。

`supabase/functions/.env.example` を `supabase/functions/.env` にコピーし、実際の値を設定します。秘密値はGitHubやチャットへ貼り付けず、SupabaseのSecretsへ登録してください。

```sh
# MAIL_TOKEN_KEY と MAIL_CRON_SECRET はそれぞれ別に生成
openssl rand -base64 32
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy mail-bridge
```

`MAIL_TOKEN_KEY` は更新トークンと認証途中の情報を暗号化する32バイトのBase64鍵です。紛失・変更すると既存のGmail接続は再接続が必要になります。`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` はホストされたEdge Functionに自動提供される値を利用します。

`MAIL_APP_URL` と `GOOGLE_MAIL_REDIRECT_URI` は同じ公開オリジンにしてください。プレビュー用の別URLで試す場合は、別のテスト用バックエンドを使うか、この2項目とGoogle側の許可URLを揃えます。

`verify_jwt=false` はGoogle以外からのWebhook・定期実行にも同じ関数を使うための設定です。通常操作は関数内でSupabaseのJWTを検証し、Webhookは署名、定期実行は専用の秘密値を検証します。

## 3. iCloudなどからの転送

1. 自分が管理する受信用サブドメイン（例：`inbox.example.com`）をResendの受信機能に設定します。既存の個人メール用ドメインのMXを置き換える必要はありません。
2. Resendに表示されるDNSレコードを設定し、受信可能になったことを確認します。
3. `email.received` イベントのWebhook送信先を次に設定します。
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/mail-bridge?hook=resend`
4. 受信メールを取得できるResend APIキー、Webhook署名シークレット、受信ドメインをSecretsへ登録して関数を再配置します。
5. アプリで専用転送先を発行し、iCloud Mailなどから応募メールを転送します。自動転送ルールを使う場合も、就活関連のメールに対象を絞ってください。

転送先は利用者ごとにランダムに発行します。このアドレスを知る人はメールを送信できるので、公開しないでください。不要になったらアプリで受信停止できます。停止しても、メールサービス側で設定した転送ルールは別途解除が必要です。

## 4. Gmailを定期取得する

手動の「今すぐ取り込む」だけでも動きます。バックグラウンド取得には、Supabase DashboardのVaultに次の2つを登録し、[mail-cron.sql](../supabase/mail-cron.sql)をSQL Editorで実行します。

| Vaultの名前 | 値 |
| --- | --- |
| `mail_bridge_url` | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/mail-bridge?cron=1` |
| `mail_cron_secret` | Secretsに設定した `MAIL_CRON_SECRET` と同じ値 |

毎分、最近試行していない5アカウントを選び、各10通まで取得します。初回は過去30日分、次回から差分を取り込みます。続きは次回の実行で取得します。利用者数・メール量によって同期間隔は延びるので、即時受信は保証しません。50アカウントなら全員を一度ずつ処理するのに目安で10分、古いメールの続きがあるとさらにかかります。転送メールはWebhook受信時に処理します。

停止する場合：

```sql
select cron.unschedule('shukatsu-mail-sync');
```

## 保存するデータと解除

- アプリのDBには件名、差出人、受信日時、最大500文字の根拠文とURLなどの候補情報、処理状態を保存します。取得時は本文をメモリで読み取りますが、本文全体と添付ファイルはDBに保存しません。
- Resend側には転送されたメールが届きます。Resendの保持条件・契約と、アプリのプライバシーポリシーを公開前に確認してください。
- Gmailの更新トークンはサーバーで暗号化して保存し、ブラウザへ返しません。候補は本人だけが読めます。
- 連携解除は今後の取得を停止します。登録済み締切と確認待ち候補は残ります。「非表示」もデータの削除ではありません。
- 処理済み候補は再取得時の重複防止のため保持します。現時点では候補の自動削除期限・利用者用の一括削除画面はありません。アカウントを管理者が削除すると関連データは外部キーで削除されます。一般公開までに、利用規約に保持期間・削除依頼の窓口を定めてください。
- GmailとiCloudのどちらについてもメール送信・返信の機能はありません。

## 公開前の実機確認

自動テストは抽出・暗号化・Webhook署名・DBの所有者制限・重複防止・UIを対象にしています。Google/Resendの実アカウントを使った接続確認は設定後に行います。

1. テストアカウントでGoogleに接続し、リロード後も接続状態が見える。
2. 自分で用意した架空の応募メールから複数の締切が確認待ちに出る。
3. 同期を繰り返しても同じ候補が増えず、「確認して登録」で一度だけ締切が増える。
4. 同じ企業の期限変更を既存行へ反映し、ES・面接ノートが残る。
5. 専用アドレスへの転送が取り込まれ、停止後は新しい転送が取り込まれない。
6. 連携解除と通知設定をそれぞれ確認する。Googleアカウント側でも連携の削除状態を確認できる。

```sh
npm ci
npm test
npm run build
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config playwright.release.config.ts
```

SQLの自動テストはPGlite（PostgreSQL）で実際の追加マイグレーションを実行します。Supabaseの認証契約はテスト用に再現するため、上記の公開環境での接続確認を置き換えるものではありません。
