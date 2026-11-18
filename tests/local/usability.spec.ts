import { expect, test, type Page } from '@playwright/test';

async function add(page: Page, company: string, date?: string) {
  await page.locator('#btn-add').click();
  await page.locator('#f-company').fill(company);
  if (date) await page.locator('#f-ddate').fill(date);
  await page.getByRole('button', { name: '保存する', exact: true }).click();
}

test('未提出・期限切れ・締切なしを見落とさず、絞り込みを解除できる', async ({ page }) => {
  await page.goto('/');
  await add(page, '期限切れ商事', '2020-01-01');
  await add(page, '締切未定社');
  await expect(page.locator('.board')).toContainText('期限切れ・締切未登録の未提出が 2 件');
  await page.getByRole('button', { name: /^期限切れ\s*1$/ }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toContainText('期限切れ商事');
  await page.getByRole('button', { name: '提出済みにする' }).click();
  await expect(page.locator('.card')).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('.card').getByRole('button', { name: '提出済みにする' }).click();
  await page.getByRole('button', { name: '絞り込みを解除' }).click();
  await page.reload();
  await expect(page.locator('.card.st-submitted')).toContainText('期限切れ商事');
  await expect(page.locator('.card.st-submitted .left')).not.toContainText('期限切れ');
  // 提出済みの行は閉じているので、開いてから操作する
  await page.locator('.card.st-submitted .card-head').click();
  await page.locator('.card.st-submitted').getByRole('button', { name: '未定に戻す' }).click();
  await expect(page.locator('.card.st-submitted')).toHaveCount(0);
});

test('日付の簡単入力・チェック・直近パネルの提出操作と保存が動く', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-add').click();
  await page.locator('#f-company').fill('操作確認商事');
  await page.getByRole('button', { name: '明日', exact: true }).click();
  await expect(page.locator('#f-ddate')).not.toHaveValue('');
  await page.getByRole('button', { name: '23:59', exact: true }).click();
  await expect(page.locator('#f-dtime')).toHaveValue('23:59');
  await page.getByRole('button', { name: '＋ ES', exact: true }).click();
  await page.locator('#f-memo').fill('面接の練習');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await page.locator('.card').getByRole('checkbox', { name: 'ES', exact: true }).check();
  await expect(page.locator('.card .pill.done')).toHaveText('チェック完了');
  await expect(page.locator('.card .pill.s-undecided')).toBeVisible();
  await page.locator('#q').fill('練習');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('.board').getByRole('button', { name: '提出済みにする' }).click();
  await expect(page.locator('.card .pill.s-submitted')).toBeVisible();
  await page.reload();
  await expect(page.locator('.card .pill.s-submitted')).toBeVisible();
});

test('スマートフォンとPCで横にはみ出さず、入力中も保存を押せる', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'サンプルを入れて試してみる' }).click();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/board-mobile.png', fullPage: true });
  await page.locator('#btn-add').click();
  const save = page.getByRole('button', { name: '保存する', exact: true });
  await expect(save).toBeInViewport();
  await page.screenshot({ path: 'test-results/form-mobile.png' });
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.sheet')).toHaveCSS('background-color', 'rgb(25, 36, 31)');
  await page.screenshot({ path: 'test-results/board-dark.png', fullPage: true });
});


test('端末保存を拒否されても白画面にならず、保存できない旨を知らせる', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.goto('/');
  await expect(page.getByText('このブラウザでは端末にデータを保存できない設定になっています。', { exact: false })).toBeVisible();
  await add(page, '一時入力社');
  await expect(page.locator('.card')).toContainText('一時入力社');
});
