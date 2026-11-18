import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

test('1文字候補から登録し、ES3種類と面接記録を保存、編集、再読込、Officeへ持ち出せる', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-add').click();
  await page.getByRole('combobox', { name: '企業名（必須）' }).fill('と');
  await page.getByRole('option', { name: 'トヨタ自動車 選択' }).click();
  await expect(page.locator('#f-company')).toHaveValue('トヨタ自動車');
  await page.getByRole('button', { name: '明日', exact: true }).click();
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await page.locator('.card').getByRole('button', { name: /ESストック/ }).click();
  for (const limit of [400, 800, 1200]) {
    await page.getByRole('button', { name: `＋ ${limit}文字`, exact: true }).click();
    await page.getByLabel('設問・タイトル').fill(`自己PR${limit}`);
    await page.getByLabel('ES本文').fill(`私の強み${limit}`);
  }
  await page.getByLabel('ES本文').fill('あ'.repeat(1201));
  await expect(page.getByText('1201 / 1200文字', { exact: false })).toContainText('1文字オーバー');
  await page.getByLabel('ES本文').fill('私の強み1200');
  await page.getByRole('tab', { name: '面接ノート', exact: true }).click();
  await page.getByRole('button', { name: '＋ 面接を記録' }).click();
  await page.getByLabel('聞かれた質問').fill('入社後に何をしたいですか？');
  await page.getByLabel('自分の回答', { exact: true }).fill('ものづくりで貢献したい');
  await page.getByLabel('振り返り・次に活かすこと').fill('具体例を追加する');
  await page.screenshot({ path: 'test-results/interview-mobile.png' });
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  // エントリー編集で新フィールドが消えないこと。
  await page.locator('.card').getByRole('button', { name: '編集', exact: true }).click();
  await page.locator('#f-memo').fill('追加したメモ');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await page.reload();
  await page.locator('.card').getByRole('button', { name: /ESストック/ }).click();
  await expect(page.getByLabel('保存した原稿').locator('option')).toHaveCount(4);
  await expect(page.getByLabel('ES本文')).toHaveValue('私の強み400');
  await page.screenshot({ path: 'test-results/es-mobile.png' });
  await page.getByRole('tab', { name: '面接ノート', exact: true }).click();
  await expect(page.getByLabel('聞かれた質問')).toHaveValue('入社後に何をしたいですか？');
  await page.getByRole('button', { name: 'この企業を書き出す' }).click();
  const excelDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel（.xlsx）を保存' }).click();
  const excel = await excelDownload;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await excel.path())!);
  expect(book.getWorksheet('ESストック')!.rowCount).toBe(4);
  expect(book.getWorksheet('面接ノート')!.getCell('E2').value).toBe('入社後に何をしたいですか？');
  const wordDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Word（.docx）を保存' }).click();
  const word = await wordDownload;
  const zip = await JSZip.loadAsync(await readFile((await word.path())!));
  expect(await zip.file('word/document.xml')!.async('string')).toContain('私の強み1200');
});

test('GmailとGoogleカレンダーのリンク・通知設定が使える', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-add').click();
  await page.locator('#f-company').fill('独自商事');
  await page.getByRole('button', { name: '明日', exact: true }).click();
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  const mail = page.locator('.card').getByRole('link', { name: 'Gmailで検索 ↗' });
  expect(decodeURIComponent((await mail.getAttribute('href'))!)).toContain('"独自商事"');
  const calendar = page.locator('.card').getByRole('link', { name: 'Googleカレンダー ↗' });
  expect(decodeURIComponent((await calendar.getAttribute('href'))!)).toContain('独自商事');
  await page.getByRole('button', { name: /通知設定/ }).click();
  await expect(page.getByText('アプリを閉じていても届く通知は', { exact: false })).toBeVisible();
  await page.getByRole('checkbox', { name: '1時間前', exact: true }).check();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /通知設定/ }).click();
  await expect(page.getByRole('checkbox', { name: '1時間前', exact: true })).toBeChecked();
});
