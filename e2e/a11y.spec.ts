import AxeBuilder from '@axe-core/playwright';
import { expect, loadDemo, open, test } from './fixtures';

// Automated WCAG 2.1 AA checks on every public page, with the demo loaded so
// tables, charts and badges are on screen, in both themes. Automated checks
// find only part of the problems; keyboard and screen-reader passes remain.
const PAGES = [
  '/',
  '/allocation',
  '/new-money',
  '/accounts',
  '/loans',
  '/futures',
  '/risk',
  '/options',
  '/settings',
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`accessibility (${theme})`, () => {
    test.use({ colorScheme: theme });
    for (const path of PAGES) {
      test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
        await loadDemo(page);
        await open(page, path);
        // Let charts finish their entry animation before colours are sampled.
        await page.waitForTimeout(600);
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        const summary = result.violations.map(
          (v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes[0]?.target.join(' ')}`,
        );
        expect(summary).toEqual([]);
      });
    }
  });
}

const STATES: Array<[string, string, (page: import('@playwright/test').Page) => Promise<void>]> = [
  [
    'options builder with results',
    '/options',
    async (page) => {
      await page.getByRole('button', { name: /鐵兀鷹/ }).click();
      await page
        .getByRole('button', { name: /的操作$/ })
        .first()
        .click();
    },
  ],
  [
    'option leg dialog',
    '/options',
    async (page) => {
      await page.getByRole('button', { name: '＋ 新增部位腿' }).click();
    },
  ],
  [
    'held option Greeks',
    '/options',
    async (page) => {
      await page.getByRole('tab', { name: '持倉 Greeks' }).click();
    },
  ],
  [
    'new loan dialog',
    '/loans',
    async (page) => {
      await page.getByRole('button', { name: '新增借款' }).click();
    },
  ],
  [
    'statement import wizard',
    '/accounts',
    async (page) => {
      await page.getByRole('tab', { name: '交易' }).click();
      await page.getByRole('button', { name: '匯入券商對帳單' }).click();
    },
  ],
];

test.describe('accessibility of interactive states', () => {
  for (const [name, path, act] of STATES) {
    test(`${name} has no WCAG A/AA violations`, async ({ page }) => {
      await loadDemo(page);
      await open(page, path);
      await act(page);
      await page.waitForTimeout(600);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        result.violations.map(
          (v) =>
            `${v.id} (${v.impact}): ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        ),
      ).toEqual([]);
    });
  }
});
