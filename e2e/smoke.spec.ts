import { expect, loadDemo, open, test } from './fixtures';

const PAGES: Array<[string, RegExp]> = [
  ['/', /總覽/],
  ['/allocation', /配置/],
  ['/new-money', /New Money|新資金/],
  ['/accounts', /帳戶/],
  ['/loans', /借款|Loans/],
  ['/futures', /期貨|Futures/],
  ['/risk', /風險|Risk/],
  ['/settings', /設定|Settings/],
];

test.describe('every public page', () => {
  for (const [path, heading] of PAGES) {
    test(`renders ${path} empty and with the demo`, async ({ page, errors }) => {
      await open(page, path);
      await expect(page.locator('main h1').first()).toHaveText(heading);
      await loadDemo(page);
      await open(page, path);
      await expect(page.locator('main h1').first()).toHaveText(heading);
      expect(errors).toEqual([]);
    });
  }

  test('full-edition pages are not offered', async ({ page }) => {
    await open(page, '/');
    await expect(page.getByRole('link', { name: '主動策略' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '績效分析' })).toHaveCount(0);
  });
});
