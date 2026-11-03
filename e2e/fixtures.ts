import { expect, test as base, type Page } from '@playwright/test';

// Every test starts offline from the outside world: the public edition may
// only talk to its own origin, so anything else is answered with an error
// rather than waiting on the network.
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await use(errors);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  },
});

export { expect };

/** Opens a route of the hash router and waits for its page heading. */
export async function open(page: Page, path = '/') {
  await page.goto(`./#${path}`);
  await expect(page.locator('main h1').first()).toBeVisible();
}

/** Loads the fictional demo portfolio from the scratch-mode banner. */
export async function loadDemo(page: Page) {
  await open(page, '/');
  await page.getByRole('button', { name: '看虛構的示範資料' }).click();
  await expect(page.getByRole('button', { name: '改用自己的數字試算' })).toBeVisible();
}

/** Opens the navigation (a slide-in drawer on small screens) and follows a link. */
export async function navigate(page: Page, label: string) {
  const menu = page.getByRole('button', { name: /選單|導覽/ });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('link', { name: label }).click();
}
