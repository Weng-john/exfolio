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
