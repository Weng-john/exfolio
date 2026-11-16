import { expect, loadDemo, open, test } from './fixtures';

test.describe('navigation', () => {
  test('sections lead to their first page and list their pages', async ({ page }, info) => {
    await loadDemo(page);
    const wide = info.project.name === 'desktop';
    const main = page.getByRole('navigation', { name: wide ? '主選單' : '主選單（行動版）' });
    await main.getByRole('link', { name: '帳務' }).click();
    await expect(page.locator('main h1')).toHaveText('帳戶與持倉');
    await expect(main.getByRole('link', { name: '帳務' })).toHaveAttribute('aria-current', 'true');
    const pages = page.getByRole('navigation', { name: '帳務的頁面' });
    await pages.getByRole('link', { name: '借款與質押' }).click();
    await expect(page.locator('main h1')).toHaveText('借款與質押');
    await expect(page).toHaveURL(/#\/loans$/);
  });

  test('a section with one page has no sub-navigation', async ({ page }) => {
    await open(page, '/');
    await expect(page.getByRole('navigation', { name: /的頁面$/ })).toHaveCount(0);
  });
});

test.describe('display preferences', () => {
  test('profit and loss colours can follow the Taiwan convention', async ({ page }) => {
    await open(page, '/settings');
    await page.getByRole('tab', { name: '顯示' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-pnl', 'green-up');
    await page.getByRole('radio', { name: /紅漲綠跌/ }).check();
    await expect(page.locator('html')).toHaveAttribute('data-pnl', 'red-up');
    // Kept for the next visit.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-pnl', 'red-up');
  });
});

test.describe('long tables', () => {
  test('the instrument list is paged', async ({ page }) => {
    await open(page, '/settings');
    const rows = page.getByRole('region', { name: /^商品登錄/ }).locator('tbody tr');
    await expect(rows).toHaveCount(25);
    const first = await rows.first().innerText();
    const pager = page.getByRole('navigation', { name: '商品登錄分頁' });
    await expect(pager.getByRole('button', { name: '上一頁' })).toBeDisabled();
    await pager.getByRole('button', { name: '下一頁' }).click();
    await expect(rows.first()).not.toHaveText(first);
    // Filtering down to one page removes the pager.
    await page.getByRole('searchbox').fill('0050');
    await expect(pager).toHaveCount(0);
  });

  test('positions read as cards on a phone', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout only');
    await loadDemo(page);
    await open(page, '/accounts');
    const table = page.getByRole('region', { name: /^持倉/ }).locator('table');
    const fits = await table.evaluate((el) => el.scrollWidth <= el.parentElement!.clientWidth);
    expect(fits).toBe(true);
  });
});
