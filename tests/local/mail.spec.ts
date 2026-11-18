import {expect,test} from '@playwright/test';
test('未接続版では実メールの受信を装わず、サンプルで複数の締切を確認できる',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'応募メールから締切を取り込む',exact:true}).click();
 await expect(page.getByText('メール連携はログインして使う公開版で利用できます。',{exact:false})).toBeVisible();
 await page.getByText('サンプルで読み取り方を試す',{exact:true}).click();
 await page.getByRole('button',{name:'架空のメールを表示',exact:true}).click();
 await expect(page.locator('.mail-demo')).toHaveCount(2);
 await expect(page.locator('.mail-demo').first()).toContainText('2027-01-20 17:00');
 await page.getByLabel('試し読みするメール本文').fill('企業名：みらい商事\n締切：明日17時まで');
 await expect(page.locator('.mail-demo')).toContainText('日付未確定');
 await page.screenshot({path:'test-results/mail-sample.png'});
});
