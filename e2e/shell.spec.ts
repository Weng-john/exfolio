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
  test('the instrument list is paged', async ({ page }, info) => {
    await open(page, '/settings');
    const rows = page.getByRole('region', { name: /^商品登錄/ }).locator('tbody tr');
    // Rows are cards on a phone, so a page holds fewer of them.
    await expect(rows).toHaveCount(info.project.name === 'mobile' ? 10 : 25);
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

test.describe('long pages show one part at a time', () => {
  test('allocation opens on target against actual and switches views', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/allocation');
    await expect(page.getByRole('tab', { name: '目標與實際' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const targets = page.getByRole('heading', { level: 2, name: '目標設定' });
    await expect(targets).toHaveCount(0);
    await page.getByRole('tab', { name: '目標設定' }).click();
    await expect(targets).toBeVisible();
  });

  test('futures list held series first and fold the rest away', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/futures');
    const card = page.getByRole('region', { name: '合約月份管理' });
    await expect(card.getByRole('heading', { level: 3 })).toHaveCount(1);
    await card.getByText(/^其他系列/).click();
    expect(await card.getByRole('heading', { level: 3 }).count()).toBeGreaterThan(1);
  });

  test('stress inputs list held indices and keep the others one click away', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/risk');
    const form = page.getByRole('region', { name: '衝擊設定（瞬間）' });
    await expect(form.getByLabel('台灣 50')).toBeVisible();
    await expect(form.getByLabel('日經 225')).toBeHidden();
    await form.getByText(/^未持有的指數/).click();
    await expect(form.getByLabel('日經 225')).toBeVisible();
  });
});

test.describe('positions columns', () => {
  test('optional columns can be hidden and stay hidden', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'wide table only');
    await loadDemo(page);
    await open(page, '/accounts');
    const headers = page.getByRole('region', { name: /^持倉/ }).locator('thead th:visible');
    const before = await headers.count();
    await page.getByRole('button', { name: '選擇顯示的欄位' }).click();
    await page.getByRole('checkbox', { name: '均價' }).uncheck();
    await expect(headers).toHaveCount(before - 1);
    await expect(headers.filter({ hasText: '均價' })).toHaveCount(0);
    // The account group rows still line up with the header.
    const span = await page
      .locator('tr.acct-group td')
      .first()
      .evaluate((td) => (td as HTMLTableCellElement).colSpan);
    expect(span).toBe(5);
    await page.reload();
    await loadDemo(page);
    await open(page, '/accounts');
    await expect(headers.filter({ hasText: '均價' })).toHaveCount(0);
  });
});

test.describe('editable tables on a phone', () => {
  for (const [path, tab] of [
    ['/allocation', '目標設定'],
    ['/allocation', '商品替代'],
    ['/futures', ''],
  ] as const) {
    test(`${path} ${tab} needs no sideways scrolling`, async ({ page }, info) => {
      test.skip(info.project.name !== 'mobile', 'phone layout only');
      await loadDemo(page);
      await open(page, path);
      if (tab) await page.getByRole('tab', { name: tab }).click();
      const wide = await page
        .locator('.table-wrap')
        .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 2).length);
      expect(wide).toBe(0);
    });
  }
});
