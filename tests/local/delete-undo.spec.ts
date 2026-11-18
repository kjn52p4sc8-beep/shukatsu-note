import { expect, test, type Page } from '@playwright/test';

async function add(page: Page, company: string) {
  await page.locator('#btn-add').click();
  await page.locator('#f-company').fill(company);
  await page.getByRole('button', { name: '明日', exact: true }).click();
  await page.getByRole('button', { name: '保存する', exact: true }).click();
}
const remove = async (page: Page, company: string) => {
  await page.locator('.card', { hasText: company }).getByRole('button', { name: '削除', exact: true }).click();
  await page.getByRole('button', { name: '削除する', exact: true }).click();
};
const names = (page: Page) => page.locator('.card .name').allTextContents();

test('2社を続けて削除しても、どちらも元に戻せる（新しい順）', async ({ page }) => {
  await page.goto('/');
  await add(page, 'A商事');
  await add(page, 'B銀行');
  await add(page, 'C工業');
  await remove(page, 'A商事');
  await remove(page, 'B銀行');
  const bar = page.locator('.undo-bar');
  await expect(bar).toContainText('B銀行の登録を削除しました');
  await expect(bar).toContainText('ほかに 1 回分');
  await bar.getByRole('button', { name: '元に戻す' }).click();
  await expect.poll(() => names(page)).toEqual(expect.arrayContaining(['B銀行', 'C工業']));
  await expect(bar).toContainText('A商事の登録を削除しました');
  await bar.getByRole('button', { name: '元に戻す' }).click();
  await expect.poll(async () => (await names(page)).sort()).toEqual(['A商事', 'B銀行', 'C工業']);
  await expect(bar).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(3);
});

test('削除の直後に別の操作をしても、削除は元に戻せる', async ({ page }) => {
  await page.goto('/');
  await add(page, 'A商事');
  await add(page, 'B銀行');
  await remove(page, 'A商事');
  // 別の企業を提出済みにすると、そちらの「元に戻す」のお知らせも出る
  await page.locator('.card', { hasText: 'B銀行' }).getByRole('button', { name: '提出済みにする' }).click();
  await expect(page.locator('.toast:not(.undo-bar)')).toContainText('提出済みにしました');
  await page.locator('.undo-bar').getByRole('button', { name: '元に戻す' }).click();
  await expect.poll(async () => (await names(page)).sort()).toEqual(['A商事', 'B銀行']);
});

test('8秒を過ぎると元に戻すは消え、削除は残る', async ({ page }) => {
  await page.goto('/');
  await add(page, 'A商事');
  await remove(page, 'A商事');
  await expect(page.locator('.undo-bar')).toBeVisible();
  await page.waitForTimeout(8500);
  await expect(page.locator('.undo-bar')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(0);
});

test('削除の確認で、一緒に消えるESと面接ノートを題名で確かめられる', async ({ page }) => {
  await page.goto('/');
  await add(page, 'みらい商事');
  await page.locator('.card').getByRole('button', { name: /ESストック/ }).click();
  await page.getByRole('button', { name: '＋ 400文字', exact: true }).click();
  await page.getByLabel('設問・タイトル').fill('志望動機');
  await page.getByRole('tab', { name: '面接ノート', exact: true }).click();
  await page.getByRole('button', { name: '＋ 面接を記録' }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.locator('.card').getByRole('button', { name: '削除', exact: true }).click();
  const detail = page.getByLabel('一緒に削除される記録');
  await expect(detail).toContainText('志望動機（400字）');
  await expect(detail).toContainText('一次面接');
  await expect(page.getByRole('dialog')).toContainText('みらい商事');
  await expect(page.getByRole('dialog')).toContainText('Gmailのメール・Googleカレンダーの予定は取り消しません');
});
