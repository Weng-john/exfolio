import { readFileSync } from 'node:fs';
import { expect, loadDemo, open, test } from './fixtures';

test.describe('New Money Allocator', () => {
  test('suggests only buys for the demo', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/new-money');
    const amount = page.getByRole('spinbutton', { name: '金額' });
    await amount.fill('200000');
    const list = page.getByRole('region', { name: /^交易建議清單/ }).first();
    await expect(list.getByRole('row').nth(1)).toBeVisible();
    // Every suggestion is a buy: the allocator never sells.
    const sides = await list.locator('tbody tr td:nth-child(3)').allTextContents();
    expect(sides.length).toBeGreaterThan(0);
    for (const s of sides) expect(s).toBe('買進');
  });

  test('flags an invalid amount instead of clamping it', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/new-money');
    await page.getByRole('spinbutton', { name: '金額' }).fill('-5');
    await expect(page.getByRole('alert')).toContainText('金額必須是大於或等於 0');
  });
});

test.describe('Loans', () => {
  test('a new loan cannot be saved until it is complete', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/loans');
    await page.getByRole('button', { name: '新增借款' }).click();
    const dialog = page.getByRole('dialog', { name: '新增借款' });
    const save = dialog.getByRole('button', { name: '儲存' });
    await expect(save).toBeDisabled();
    await dialog.getByRole('textbox', { name: '名稱' }).fill('測試信貸');
    await dialog.getByRole('spinbutton', { name: /原始本金/ }).fill('120000');
    await dialog.getByRole('spinbutton', { name: '年利率（%）' }).fill('2.4');
    await dialog.getByRole('spinbutton', { name: '期數（月）' }).fill('12');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: '測試信貸' })).toBeVisible();
  });

  test('Escape closes the dialog and returns focus to its opener', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/loans');
    const opener = page.getByRole('button', { name: '新增借款' });
    await opener.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('repaying a loan lowers total debt', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/loans');
    const debt = page.locator('.stat, .stat-card').filter({ hasText: '總負債' }).first();
    const before = await debt.innerText();
    await page
      .getByRole('region', { name: '示範信貸' })
      .getByRole('button', { name: '還款' })
      .click();
    const dialog = page.getByRole('dialog', { name: /還款/ });
    await expect(dialog.getByRole('combobox', { name: '資金來源' })).toHaveValue(
      /internal|portfolio/,
    );
    await dialog.getByRole('button', { name: '建立交易' }).click();
    await expect(dialog).toBeHidden();
    await expect(debt).not.toHaveText(before);
  });
});

test.describe('Statement import', () => {
  test('walks a CSV through all five steps', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/accounts');
    await page.getByRole('tab', { name: '交易' }).click();
    await page.getByRole('button', { name: '匯入券商對帳單' }).click();
    const dialog = page.getByRole('dialog', { name: '匯入券商對帳單' });
    await dialog
      .locator('input[type=file]')
      .setInputFiles('tests/fixtures/statements/tw_securities.csv');
    await expect(dialog.getByRole('heading', { level: 3 })).toContainText('資料 3 列');
    await dialog.getByRole('button', { name: '下一步' }).click();
    await expect(dialog.getByRole('combobox', { name: /^成交日期/ })).toHaveValue(/.+/);
    await dialog.getByRole('button', { name: '下一步' }).click();
    // An unknown symbol is never created silently.
    await expect(dialog.getByRole('button', { name: /需確認商品 1/ })).toBeVisible();
    await dialog.getByRole('button', { name: '確認新增此商品' }).click();
    await expect(dialog.getByRole('button', { name: /可匯入 3/ })).toBeVisible();
    await dialog.getByRole('button', { name: '下一步' }).click();
    const confirm = dialog.getByRole('button', { name: /確認匯入 3 筆/ });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog.getByText(/完成|已匯入/).first()).toBeVisible();
  });
});

test.describe('Backup', () => {
  test('rejects a damaged file and changes nothing', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/settings');
    await page.getByRole('tab', { name: '後端與資料' }).click();
    await page
      .getByRole('region', { name: '備份與還原' })
      .locator('input[type=file]')
      .setInputFiles({
        name: 'broken.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{"version":1,"data":{"accounts":[{"id":1}]}}'),
      });
    await expect(page.getByText('備份檔驗證失敗，未做任何變更')).toBeVisible();
  });

  test('round-trips an exported backup into an empty tab', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/settings');
    await page.getByRole('tab', { name: '後端與資料' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '匯出 JSON 備份' }).click();
    const text = readFileSync(await (await download).path(), 'utf8');
    expect(JSON.parse(text)).toMatchObject({ format: 'exfolio-backup' });

    // A fresh tab holds nothing: the scratch calculator keeps data in memory only.
    await page.reload();
    await open(page, '/settings');
    await page.getByRole('tab', { name: '後端與資料' }).click();
    await page
      .getByRole('region', { name: '備份與還原' })
      .locator('input[type=file]')
      .setInputFiles({
        name: 'exfolio-backup-test.json',
        mimeType: 'application/json',
        buffer: Buffer.from(text),
      });
    const confirm = page.getByRole('dialog', { name: '確認還原' });
    await confirm.getByRole('button', { name: '覆蓋並還原' }).click();
    await expect(confirm).toBeHidden();
    await open(page, '/loans');
    await expect(page.getByRole('button', { name: '示範信貸' })).toBeVisible();
  });
});
