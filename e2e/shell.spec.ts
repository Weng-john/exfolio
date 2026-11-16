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

test.describe('overview', () => {
  test('states where the portfolio stands and what to look at', async ({ page }) => {
    await loadDemo(page);
    const leverage = page.locator('.ov-kpi').filter({ hasText: 'Gross 槓桿' });
    await expect(leverage).toContainText('低於提醒門檻');
    const targets = page.getByRole('region', { name: '目標與實際' });
    await expect(targets).toContainText(/個目標/);
    await expect(targets.locator('.ov-devs li').first()).toContainText('S&P 500');
    await targets.getByRole('link', { name: /查看配置/ }).click();
    await expect(page.locator('main h1')).toHaveText('核心配置');
  });

  test('shows the most important notices first and the rest on request', async ({ page }) => {
    await loadDemo(page);
    const card = page.getByRole('region', { name: /^提醒/ });
    await expect(card.locator('.ov-notices li')).toHaveCount(3);
    const more = card.getByRole('button', { name: /顯示全部/ });
    await more.click();
    expect(await card.locator('.ov-notices li').count()).toBeGreaterThan(3);
    await expect(card.getByRole('button', { name: '只顯示最重要的' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

test.describe('tables on a phone', () => {
  for (const path of ['/', '/accounts', '/loans', '/new-money', '/risk', '/options']) {
    test(`${path} needs no sideways scrolling`, async ({ page }, info) => {
      test.skip(info.project.name !== 'mobile', 'phone layout only');
      await loadDemo(page);
      await open(page, path);
      const wide = await page
        .locator('.table-wrap')
        .evaluateAll((els) =>
          els.filter((el) => el.scrollWidth > el.clientWidth + 2).map((el) => el.ariaLabel),
        );
      expect(wide).toEqual([]);
    });
  }
});
