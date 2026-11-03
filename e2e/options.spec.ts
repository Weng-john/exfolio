import { expect, loadDemo, open, test } from './fixtures';

test.describe('Options Lab', () => {
  test('a template fills the legs and shows bounded risk', async ({ page }) => {
    await open(page, '/options');
    await page.getByRole('button', { name: /鐵兀鷹/ }).click();
    await expect(page.getByRole('status').filter({ hasText: '已套用「鐵兀鷹」' })).toBeVisible();
    const legs = page.getByRole('region', { name: /部位腿/ });
    await expect(legs.locator('tbody tr')).toHaveCount(4);
    const stat = (label: string) => page.locator('.stat').filter({ hasText: label });
    await expect(stat('最大獲利（到期）').locator('.stat-value')).not.toHaveText('無上限');
    await expect(stat('最大損失（到期）').locator('.stat-value')).not.toHaveText('無上限');
    await expect(stat('損益兩平').locator('.opt-chip')).toHaveCount(2);
    await expect(page.locator('.opt-chart svg').first()).toBeVisible();
  });

  test('a naked short call has unlimited loss', async ({ page }) => {
    await open(page, '/options');
    await page.getByRole('button', { name: '＋ 新增部位腿' }).click();
    const dialog = page.getByRole('dialog', { name: '新增部位腿' });
    await dialog.getByRole('combobox', { name: '方向' }).selectOption('sell');
    await dialog.getByRole('button', { name: '加入' }).click();
    await expect(dialog).toBeHidden();
    const loss = page.locator('.stat').filter({ hasText: '最大損失（到期）' });
    await expect(loss.locator('.stat-value')).toHaveText('無上限');
  });

  test('market errors are explained and block new legs', async ({ page }) => {
    await open(page, '/options');
    await page.getByRole('spinbutton', { name: '標的價格' }).fill('0');
    await expect(page.getByRole('alert')).toContainText('標的價格必須大於 0');
    await expect(page.getByRole('button', { name: '＋ 新增部位腿' })).toBeDisabled();
  });

  test('the row menu flips a leg and removes it', async ({ page }) => {
    await open(page, '/options');
    await page.getByRole('button', { name: /買進買權/ }).click();
    const rows = page.getByRole('region', { name: /部位腿/ }).locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: /的操作$/ }).click();
    await page.getByRole('button', { name: '改為賣出' }).click();
    await expect(rows.first()).toContainText('賣出');
    await page.getByRole('button', { name: /的操作$/ }).click();
    await page.getByRole('button', { name: '刪除' }).click();
    await expect(page.getByText('從一隻腿開始')).toBeVisible();
  });

  test('held options show Greeks and load into the builder', async ({ page }) => {
    await loadDemo(page);
    await open(page, '/options');
    await page.getByRole('tab', { name: '持倉 Greeks' }).click();
    const table = page.getByRole('region', { name: '選擇權部位（可左右捲動）' });
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table).toContainText('反推');
    await page.locator('.opt-load-card').first().click();
    await expect(page.getByRole('tab', { name: '策略試算' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('region', { name: /部位腿/ }).locator('tbody tr')).toHaveCount(2);
  });
});
