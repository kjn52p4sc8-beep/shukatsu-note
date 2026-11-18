import { expect, test, type Page } from '@playwright/test';

async function add(page: Page, company: string, shortcut: '明日' | '1週間後' | null) {
  await page.locator('#btn-add').click();
  await page.locator('#f-company').fill(company);
  if (shortcut) await page.getByRole('button', { name: shortcut, exact: true }).click();
  await page.getByRole('button', { name: '保存する', exact: true }).click();
}

test('ホームはデザイン案の並びで、企業の行は押すと詳細が開く', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '就活しめきりボード' })).toBeVisible();
  await expect(page.getByText('今日の一歩を、未来につなげよう。')).toBeVisible();
  for (const title of ['直近の締切', '企業一覧', 'ESの文字数別保存', '面接ノート']) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }

  await add(page, 'みらい商事', '明日');
  await add(page, 'のんびり工業', null);
  await expect(page.locator('.board .who')).toHaveText('みらい商事');
  await expect(page.locator('.board .count')).toContainText('あと');

  // 締切が近い未提出は最初から開いていて、急がないものは閉じている
  const urgent = page.locator('.card', { hasText: 'みらい商事' });
  const later = page.locator('.card', { hasText: 'のんびり工業' });
  await expect(urgent.locator('.card-head')).toHaveAttribute('aria-expanded', 'true');
  await expect(urgent.getByRole('button', { name: '提出済みにする' })).toBeVisible();
  await expect(later.locator('.card-head')).toHaveAttribute('aria-expanded', 'false');
  await expect(later.getByRole('button', { name: '編集', exact: true })).toHaveCount(0);
  await later.locator('.card-head').click();
  await expect(later.getByRole('button', { name: '編集', exact: true })).toBeVisible();
  await later.locator('.card-head').click();
  await expect(later.getByRole('button', { name: '編集', exact: true })).toHaveCount(0);

  // 検索は行の開閉に関係なく効く
  await page.locator('#q').fill('のんびり');
  await expect(page.locator('.card')).toHaveCount(1);
});

test('ESの文字数タイルから原稿を作り、面接ノートの行から記録を開ける', async ({ page }) => {
  await page.goto('/');
  await add(page, 'みらい商事', '1週間後');
  await add(page, 'あおぞら銀行', '明日');

  // 800字のタイル → 企業を選んで新しい原稿を作る
  await page.getByRole('button', { name: 'ES 800字（0件）' }).click();
  await expect(page.getByText('800字の原稿はまだありません。')).toBeVisible();
  await expect(page.getByRole('button', { name: '＋ 800字の原稿を作る' })).toBeDisabled();
  await page.getByLabel('どの企業の原稿ですか').selectOption({ label: 'みらい商事（本選考）' });
  await page.getByRole('button', { name: '＋ 800字の原稿を作る' }).click();
  await expect(page.getByRole('heading', { name: 'みらい商事のノート' })).toBeVisible();
  await expect(page.getByLabel('文字数の上限')).toHaveValue('800');
  await page.getByLabel('設問・タイトル').fill('志望動機');
  await page.getByLabel('ES本文').fill('御社を志望する理由は三つあります。');

  // 同じ画面で面接も記録する
  await page.getByRole('tab', { name: '面接ノート', exact: true }).click();
  await page.getByRole('button', { name: '＋ 面接を記録' }).click();
  await page.getByLabel('聞かれた質問').fill('学生時代に力を入れたことは？');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();

  // ホームに件数と記録が出て、再読み込みしても残る
  await page.reload();
  await page.getByRole('button', { name: 'ES 800字（1件）' }).click();
  await page.getByRole('button', { name: /志望動機/ }).click();
  await expect(page.getByLabel('ES本文')).toHaveValue('御社を志望する理由は三つあります。');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();

  await page.getByRole('button', { name: /一次面接メモ/ }).click();
  await expect(page.getByRole('heading', { name: 'みらい商事のノート' })).toBeVisible();
  await expect(page.getByLabel('聞かれた質問')).toHaveValue('学生時代に力を入れたことは？');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();

  // 1200字も選べる
  await page.getByRole('button', { name: 'ES 1200字（0件）' }).click();
  await page.getByLabel('どの企業の原稿ですか').selectOption({ label: 'あおぞら銀行（本選考）' });
  await page.getByRole('button', { name: '＋ 1200字の原稿を作る' }).click();
  await expect(page.getByLabel('文字数の上限')).toHaveValue('1200');
});

test('下のボタンから、Gmail検索・Googleカレンダー・Excel/Wordを開ける', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Gmailで検索' }).click();
  await expect(page.getByText('企業を登録すると、Gmailでその企業のメールを探せます')).toBeVisible();

  await add(page, 'みらい商事', '明日');
  await add(page, 'あおぞら銀行', '1週間後');

  await page.getByRole('button', { name: 'Gmailで検索', exact: true }).click();
  const mail = page.getByRole('dialog').getByRole('link', { name: /あおぞら銀行/ });
  expect(decodeURIComponent((await mail.getAttribute('href'))!)).toContain('"あおぞら銀行"');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();

  await page.getByRole('button', { name: 'Googleカレンダーに追加', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /あおぞら銀行/ }).click();
  const cal = page.getByRole('link', { name: 'Googleカレンダーで開く ↗' });
  expect(decodeURIComponent((await cal.getAttribute('href'))!)).toContain('あおぞら銀行');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();

  await page.getByRole('button', { name: 'Excel・Wordに書き出す' }).click();
  await expect(page.getByText('選択した 2 件の企業情報', { exact: false })).toBeVisible();
});
