import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// 実機評価レポート（2026年11月18日）で指摘された点の確認

const jstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function openForm(page: Page, company = '') {
  await page.locator('#btn-add').click();
  if (company) await page.locator('#f-company').fill(company);
}
const save = (page: Page) => page.getByRole('button', { name: '保存する', exact: true }).click();

test('空のまま保存すると、何が足りないかが保存ボタンのすぐ上に見える形で出る', async ({ page }) => {
  await page.goto('/');
  await openForm(page);
  await save(page);
  const err = page.getByRole('alert');
  await expect(err).toHaveText('企業名と締切日を入力してください。締切日が未定なら、企業名だけでも保存できます。');
  await expect(err).toBeInViewport();
  await expect(page.locator('#f-company')).toBeFocused();
  // 締切日だけ入れた場合
  await page.getByRole('button', { name: '明日', exact: true }).click();
  await save(page);
  await expect(err).toHaveText('企業名を入力してください。');
  await expect(page.locator('.card')).toHaveCount(0);
});

test('日付と時刻は直接打てて、貼り付けもでき、12:00・18:00のボタンもある', async ({ page }) => {
  await page.goto('/');
  await openForm(page, '直接入力商事');
  const year = Number(jstToday().slice(0, 4)) + 1;
  await page.locator('#f-ddate').fill(`${year}-11-20`);
  await page.locator('#f-dtime').fill('1830');
  await page.locator('#f-memo').click();
  await expect(page.locator('#f-ddate')).toHaveValue(`${year}/11/20`);
  await expect(page.locator('#f-dtime')).toHaveValue('18:30');
  await page.getByRole('button', { name: '12:00', exact: true }).click();
  await expect(page.locator('#f-dtime')).toHaveValue('12:00');
  await page.getByRole('button', { name: '18:00', exact: true }).click();
  await expect(page.locator('#f-dtime')).toHaveValue('18:00');
  // 貼り付け
  await page.locator('#f-ddate').fill('');
  await page.locator('#f-ddate').focus();
  await page.evaluate((v) => {
    const el = document.getElementById('f-ddate') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.setData('text/plain', v);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, `${year}/12/01`);
  await page.keyboard.insertText(`${year}/12/01`);
  await save(page);
  await expect(page.locator('.card .card-sub')).toContainText('12/1(');
  await expect(page.locator('.card .card-sub')).toContainText('18:00');
});

test('存在しない日付は保存せず、理由を出す。月日だけでも入れられる', async ({ page }) => {
  await page.goto('/');
  await openForm(page, '日付確認社');
  await page.locator('#f-ddate').fill('2027/02/30');
  await save(page);
  await expect(page.getByRole('alert')).toHaveText('実在する日付を入力してください。');
  await page.locator('#f-ddate').fill('1225');
  await page.locator('#f-memo').click();
  await expect(page.locator('#f-ddate')).toHaveValue(/^\d{4}\/12\/25$/);
  await save(page);
  await expect(page.locator('.card')).toHaveCount(1);
});

test('最初の画面からサンプルを入れられ、設定からもいつでも入れられる', async ({ page }) => {
  await page.goto('/');
  const board = page.locator('.board');
  await expect(board.getByRole('button', { name: 'サンプルを入れて試してみる' })).toBeInViewport();
  await board.getByRole('button', { name: 'サンプルを入れて試してみる' }).click();
  await expect(page.locator('.card')).toHaveCount(5);
  // 登録があるときは、ホームのボタンは出さない
  await expect(page.getByRole('button', { name: 'サンプルを入れて試してみる' })).toHaveCount(0);
  await page.getByRole('button', { name: 'サンプルを全部消す' }).click();
  await page.locator('#btn-settings').click();
  await page.getByRole('button', { name: 'サンプルデータを入れる' }).click();
  await expect(page.locator('.card')).toHaveCount(5);
  // 実在の企業名は使わない
  for (const name of await page.locator('.card .name').allTextContents()) expect(name).toContain('（架空）');
});

test('名称は画面もタブも「就活しめきりボード」、絞り込みに「見送り」がある', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('就活しめきりボード');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('就活しめきりボード');
  await openForm(page, '見送り商事');
  await page.locator('#f-status').selectOption({ label: '見送り' });
  await save(page);
  await openForm(page, '応募する商事');
  await save(page);
  await page.getByRole('button', { name: /^見送り\s*1$/ }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toContainText('見送り商事');
});

test('ESの文字数は、ホームのタイルとノートの追加ボタンがそろっている', async ({ page }) => {
  await page.goto('/');
  await openForm(page, 'ES確認社');
  await save(page);
  await page.locator('.card .card-head').click();
  await page.locator('.card').getByRole('button', { name: /ESストック/ }).click();
  for (const n of [400, 800, 1200]) await expect(page.getByRole('button', { name: `＋ ${n}文字`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  for (const n of [400, 800, 1200]) await expect(page.getByRole('button', { name: `ES ${n}字（0件）` })).toBeVisible();
});

test('書き出すファイル名は「就活しめきりボード_日付」で、日本語のまま', async ({ page }) => {
  await page.goto('/');
  await page.locator('.board').getByRole('button', { name: 'サンプルを入れて試してみる' }).click();
  const tag = jstToday().replace(/-/g, '');
  const names: string[] = [];
  await page.getByRole('button', { name: 'Excel・Wordに書き出す' }).click();
  for (const label of ['Excel（.xlsx）を保存', 'Word（.docx）を保存']) {
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: label }).click();
    names.push((await dl).suggestedFilename());
  }
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.locator('#btn-settings').click();
  for (const label of ['JSONで書き出す', 'CSVで書き出す', '全締切をまとめて .ics で書き出す']) {
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: label }).click();
    names.push((await dl).suggestedFilename());
  }
  expect(names).toEqual([
    `就活しめきりボード_${tag}.xlsx`,
    `就活しめきりボード_${tag}.docx`,
    `就活しめきりボード_バックアップ_${tag}.json`,
    `就活しめきりボード_バックアップ_${tag}.csv`,
    `就活しめきりボード_${tag}.ics`,
  ]);
});

test('書き出したJSON・CSVを読み込み直しても二重にならず、その旨が事前に分かる', async ({ page }) => {
  await page.goto('/');
  await page.locator('.board').getByRole('button', { name: 'サンプルを入れて試してみる' }).click();
  await page.locator('#btn-settings').click();
  const files: { name: string; buffer: Buffer }[] = [];
  for (const label of ['JSONで書き出す', 'CSVで書き出す']) {
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: label }).click();
    const d = await dl;
    files.push({ name: d.suggestedFilename(), buffer: await readFile((await d.path())!) });
  }
  for (const f of files) {
    await page.locator('#imp-file').setInputFiles({ name: f.name, mimeType: 'application/octet-stream', buffer: f.buffer });
    await expect(page.getByText('うち 5 件はすでに登録されている企業です', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '今のデータに追加する' }).click();
    await expect(page.getByText('5 件を読み込みました')).toBeVisible();
  }
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(5);
});
