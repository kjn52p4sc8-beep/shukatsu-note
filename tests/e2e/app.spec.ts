import { expect, test, type Browser, type Page } from '@playwright/test';

const MAILPIT = 'http://127.0.0.1:54324';
const PASSWORD = 'e2e-password-123';
const newEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

/** 数日先の日付（YYYY-MM-DD, 日本時間） */
function dayFromNow(days: number) {
  return new Date(Date.now() + days * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
}

async function signUp(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'はじめての方' }).click();
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel(/パスワード/).fill(PASSWORD);
  await page.getByRole('button', { name: '登録して始める' }).click();
  await expect(page.locator('#btn-add')).toBeVisible();
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel(/パスワード/).fill(password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
}

async function addEntry(page: Page, company: string, date: string, time = '') {
  await page.locator('#btn-add').click();
  await page.locator('#f-company').fill(company);
  await page.locator('#f-ddate').fill(date);
  if (time) await page.locator('#f-dtime').fill(time);
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.locator('.card', { hasText: company })).toBeVisible();
}

const synced = (page: Page) => expect(page.locator('.sync')).toHaveText('同期済み');

async function secondDevice(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email);
  await expect(page.locator('#btn-add')).toBeVisible();
  return { ctx, page };
}

test('登録して追加したエントリーが、別の端末にも同期される', async ({ page, browser }) => {
  const email = newEmail();
  await signUp(page, email);
  await expect(page.getByText('まだ何も登録されていません')).toBeVisible();

  await addEntry(page, 'E2E商事', dayFromNow(2), '12:00');
  await expect(page.locator('.board .who')).toHaveText('E2E商事');
  await expect(page.locator('.board .count')).toContainText('あと');
  await synced(page);

  const pc = await secondDevice(browser, email);
  await expect(pc.page.locator('.card', { hasText: 'E2E商事' })).toBeVisible();

  // PCで提出済みにすると、スマホ側にも反映される
  await pc.page.locator('.card').getByRole('button', { name: '提出済みにする' }).click();
  await synced(pc.page);
  await page.locator('.sync').click();
  await expect(page.locator('.card', { hasText: 'E2E商事' }).locator('.pill.s-submitted')).toBeVisible();
  await expect(page.locator('.board')).toContainText('未提出の締切はありません');

  // 削除も伝わる
  await page.locator('.card', { hasText: 'E2E商事' }).getByRole('button', { name: '編集' }).click();
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await synced(page);
  await pc.page.locator('.sync').click();
  await expect(pc.page.locator('.card')).toHaveCount(0);
  await pc.ctx.close();
});

test('オフラインでも開けて編集でき、つながったら同期される', async ({ page, context, browser }) => {
  const email = newEmail();
  await signUp(page, email);
  await addEntry(page, '先に登録した会社', dayFromNow(5));
  await synced(page);
  // アプリ本体が端末に保存される（Service Worker）のを待つ
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect(page.locator('.card', { hasText: '先に登録した会社' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.card', { hasText: '先に登録した会社' })).toBeVisible();
  await addEntry(page, '圏外で追加した会社', dayFromNow(3));
  await expect(page.locator('.sync')).toHaveText('オフライン（未同期1件）');

  // 圏外のまま開き直しても、未同期の変更は残っている
  await page.reload();
  await expect(page.locator('.card', { hasText: '圏外で追加した会社' })).toBeVisible();
  await expect(page.locator('.sync')).toContainText('未同期1件');

  await context.setOffline(false);
  await page.locator('.sync').click();
  await synced(page);

  const pc = await secondDevice(browser, email);
  await expect(pc.page.locator('.card', { hasText: '圏外で追加した会社' })).toBeVisible();
  await pc.ctx.close();
});

test('ログインの失敗は日本語で伝え、ログアウトすると端末の控えが消える', async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await addEntry(page, 'ログアウト確認社', dayFromNow(4));
  await synced(page);

  await page.locator('#btn-settings').click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();
  await expect(async () => {
    const leftover = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('shimekiri')));
    expect(leftover).toEqual([]);
  }).toPass({ timeout: 10000 });

  await signIn(page, email, 'wrong-password');
  await expect(page.getByRole('alert')).toHaveText('メールアドレスかパスワードが違います。');

  await page.getByLabel(/パスワード/).fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.locator('.card', { hasText: 'ログアウト確認社' })).toBeVisible();
});

test('パスワードを忘れたら、メールのリンクから再設定できる', async ({ page, request }) => {
  const email = newEmail();
  await signUp(page, email);
  await page.locator('#btn-settings').click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();

  await page.getByRole('button', { name: 'パスワードを忘れた' }).click();
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByRole('button', { name: '再設定メールを送る' }).click();
  await expect(page.getByRole('status').filter({ hasText: '再設定のメールを送りました' })).toBeVisible();

  // 届いたメール（ローカルのメール受信箱）からリンクを取り出して開く
  let link = '';
  await expect(async () => {
    const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:' + email)}`)).json();
    const id = list.messages[0].ID;
    const msg = await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json();
    link = (msg.HTML as string).match(/href="([^"]+)"/)![1].replace(/&amp;/g, '&');
    expect(link).toContain('type=recovery');
  }).toPass({ timeout: 15000 });

  await page.goto(link);
  await expect(page.getByRole('heading', { name: '新しいパスワードを設定' })).toBeVisible();
  await page.locator('#p-new').fill('new-password-456');
  await page.getByRole('button', { name: '変更する' }).click();
  await expect(page.getByText('パスワードを変更しました')).toBeVisible();

  await page.locator('#btn-settings').click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  // ログアウトが終わってログイン画面に戻るのを待ってから、新しいパスワードで入り直す
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();
  await signIn(page, email, 'new-password-456');
  await expect(page.locator('#btn-add')).toBeVisible();
});

test('以前のブラウザ保存版のバックアップを読み込める（2回読み込んでも重複しない）', async ({ page }) => {
  await signUp(page, newEmail());
  const backup = JSON.stringify({
    app: 'shukatsu-shimekiri',
    version: 1,
    items: [
      { id: 'mhx1abc123', company: '旧データ商事', kind: '本選考', platform: 'マイナビ', dDate: dayFromNow(6), dTime: '17:00', status: 'undecided', step: 'ES提出', checklist: [{ id: 'c1', text: 'ES', done: true }], url: 'https://example.com/mypage', memo: '以前のデータ' },
      { id: 'mhx1abc456', company: '旧データ銀行', dDate: dayFromNow(9), status: 'submitted', checklist: [] },
    ],
  });
  for (let i = 0; i < 2; i++) {
    if (i === 0) await page.locator('#btn-settings').click();
    await page.locator('#imp-file').setInputFiles({ name: 'shukatsu-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await expect(page.getByText('から 2 件を読み込みます')).toBeVisible();
    await page.getByRole('button', { name: '今のデータに追加する' }).click();
    await expect(page.getByText('2 件を読み込みました')).toBeVisible();
  }
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(page.locator('.card', { hasText: '旧データ商事' })).toContainText('提出物 1/1');
  await synced(page);
});

test('アカウントを削除すると、ログインできなくなる', async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await addEntry(page, '消える会社', dayFromNow(4));
  await synced(page);
  await page.locator('#btn-settings').click();
  await page.getByRole('button', { name: 'アカウントを削除' }).click();
  await page.getByRole('button', { name: '完全に削除する' }).click();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();
  await signIn(page, email);
  await expect(page.getByRole('alert')).toHaveText('メールアドレスかパスワードが違います。');
});
