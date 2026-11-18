import { expect, test, type Page } from '@playwright/test';

async function add(page: Page, company: string) {
  await page.locator('#btn-add').click();
  await page.locator('#f-company').fill(company);
  await page.getByRole('button', { name: '明日', exact: true }).click();
  await page.getByRole('button', { name: '保存する', exact: true }).click();
}

test('一覧から削除をキャンセルでき、削除後にES・面接メモごと元に戻せる', async ({ page }) => {
  await page.goto('/');
  await add(page, 'みらい商事');
  const card = page.locator('.card');
  await card.getByRole('button', { name: /ESストック/ }).click();
  await page.getByRole('button', { name: '＋ 400文字', exact: true }).click();
  await page.getByLabel('ES本文').fill('削除を取り消したら残る志望動機');
  await page.getByRole('tab', { name: '面接ノート', exact: true }).click();
  await page.getByRole('button', { name: '＋ 面接を記録' }).click();
  await page.getByLabel('聞かれた質問').fill('将来取り組みたいこと');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();

  await card.getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.getByText('この登録に保存したES 1件・面接ノート 1件・メモも一緒に削除されます。')).toBeVisible();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: '削除', exact: true }).click();
  await page.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ES 400字（0件）' })).toBeVisible();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(card).toHaveCount(1);
  await page.reload();
  await card.getByRole('button', { name: /ESストック/ }).click();
  await expect(page.getByLabel('ES本文')).toHaveValue('削除を取り消したら残る志望動機');
  await page.getByRole('tab', { name: '面接ノート', exact: true }).click();
  await expect(page.getByLabel('聞かれた質問')).toHaveValue('将来取り組みたいこと');
});

test('同じ企業の登録をまとめて削除でき、別企業は残り、再読込でも復活しない', async ({ page }) => {
  await page.goto('/');
  await add(page, 'みらい商事');
  await add(page, 'みらい商事');
  await add(page, 'あおぞら銀行');
  const sameCompany = page.locator('.card', { hasText: 'みらい商事' });
  // The existing edit path uses the same confirmation dialog.
  await sameCompany.first().getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#f-memo').fill('まだ保存していないメモ');
  await page.getByRole('dialog').getByRole('button', { name: '削除', exact: true }).click();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.locator('#f-memo')).toHaveValue('まだ保存していないメモ');
  await page.getByRole('dialog').getByRole('button', { name: '削除', exact: true }).click();
  const all = page.getByRole('checkbox', { name: '同じ企業の登録をすべて削除する（2件）' });
  await expect(all).not.toBeChecked();
  await all.check();
  await expect(page.getByRole('dialog').locator('li')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/delete-mobile.png' });
  await page.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(sameCompany).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toContainText('あおぞら銀行');
});
