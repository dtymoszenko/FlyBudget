import type { Page } from '@playwright/test';
import { test, expect, open, isoDay } from './fixtures';

// Every page opens from the sidebar and renders without errors (the console guard
// in fixtures.ts fails the test on any uncaught exception or console error).

const PAGES: { link: string; route: string; heading?: string }[] = [
  { link: 'Dashboard', route: '/dashboard' },
  { link: 'Accounts', route: '/accounts', heading: 'Accounts' },
  { link: 'Transactions', route: '/transactions', heading: 'All Transactions' },
  { link: 'Budget', route: '/budget' },
  { link: 'Recurring', route: '/recurring', heading: 'Recurring' },
  { link: 'Reports', route: '/reports', heading: 'Reports' },
  { link: 'Cash Flow', route: '/cash-flow', heading: 'Cash Flow' },
  { link: 'Goals', route: '/goals', heading: 'Goals' },
  { link: 'Payees', route: '/payees', heading: 'Payees' },
  { link: 'Rules', route: '/rules', heading: 'Rules' },
  { link: 'Settings', route: '/settings', heading: 'Settings' },
];

test('a new budget starts on the welcome screen', async ({ page }) => {
  await open(page, '/dashboard');
  await expect(page.getByRole('heading', { name: 'Welcome to FlyBudget' })).toBeVisible();
  await expect(page).toHaveURL(/#\/welcome$/);
});

test('every page opens from the sidebar', async ({ page, api }) => {
  const account = await api.createAccount('Everyday Checking', 150_000);
  await api.createTransaction({
    accountId: account.id,
    date: isoDay(),
    amount: -4_250,
    payeeName: 'Corner Grocery',
  });

  await open(page, '/dashboard');
  const nav = page.getByRole('complementary');
  const windowScrolls: string[] = [];
  for (const p of PAGES) {
    await nav.getByRole('link', { name: p.link, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${p.route}$`));
    if (p.heading) {
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
    }
    // Only the content area scrolls: the window itself never does (a second scroll bar
    // that scrolls the app off screen)
    await page.waitForLoadState('networkidle');
    const extra = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    if (extra > 0) windowScrolls.push(`${p.route} +${extra}px`);
  }
  expect(windowScrolls, 'pages where the whole window scrolls').toEqual([]);
});

test('the sidebar lists accounts with their balances and opens them', async ({ page, api }) => {
  await api.createAccount('Everyday Checking', 150_000);
  await api.createAccount('Rainy Day Savings', 1_000_000, 'savings');
  await open(page, '/dashboard');
  const nav = page.getByRole('complementary');
  await expect(nav.getByRole('link', { name: 'All accounts $11,500' })).toBeVisible();
  await nav.getByRole('button', { name: 'For budget $11,500' }).click();
  await expect(nav.getByRole('link', { name: /Everyday Checking.*\$1,500/ })).toBeVisible();
  await nav.getByRole('link', { name: /Rainy Day Savings/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rainy Day Savings' })).toBeVisible();
});

test('unknown routes inside the app fall back gracefully', async ({ page, api }) => {
  await api.createAccount('Everyday Checking');
  await open(page, '/');
  await expect(page).toHaveURL(/#\/dashboard$/);
});

test('the unpinned sidebar works from the keyboard', async ({ page, api }) => {
  await api.createAccount('Everyday Checking');
  await open(page, '/dashboard');
  const sidebar = page.getByRole('complementary');
  const pin = sidebar.getByRole('button', { name: 'Pin sidebar' });

  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  // Starts over, so Tab begins at the top of the page (the setting is kept)
  await page.reload();
  await page.mouse.move(900, 400);
  // Collapsed: the links' names are hidden
  await expect(sidebar.getByText('Dashboard', { exact: true })).toHaveCSS('opacity', '0');

  // The first Tab offers a way past the sidebar
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();

  // Tabbing into the sidebar opens it, so the pin can be reached
  await page.keyboard.press('Shift+Tab');
  await expect(sidebar.getByRole('button', { name: /^Server status/ })).toBeFocused();
  await expect(sidebar.getByText('Dashboard', { exact: true })).toHaveCSS('opacity', '1');
  await skip.focus();
  await page.keyboard.press('Tab');
  await expect(sidebar.getByRole('link', { name: /Help & docs/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(pin).toBeFocused();
  const box = (await pin.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(208);
  await page.keyboard.press('Enter');
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
});

test.describe('Escape collapses the unpinned sidebar', () => {
  test.beforeEach(async ({ page, api }) => {
    await api.createAccount('Everyday Checking');
    await open(page, '/dashboard');
    await page.getByRole('complementary').getByRole('button', { name: 'Pin sidebar' }).click();
    await page.reload();
    await page.mouse.move(900, 400);
  });

  const sidebar = (page: Page) => page.getByRole('complementary');
  const label = (page: Page) => sidebar(page).getByText('Dashboard', { exact: true });
  const dashboard = (page: Page) => sidebar(page).getByRole('link', { name: 'Dashboard' });
  const accounts = (page: Page) =>
    sidebar(page).getByRole('link', { name: 'Accounts', exact: true });

  test('on a link, focus stays and the next Tab opens it again', async ({ page }) => {
    await page.getByRole('link', { name: 'Skip to main content' }).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(dashboard(page)).toBeFocused();
    await expect(label(page)).toHaveCSS('opacity', '1');
    await page.keyboard.press('Escape');
    await expect(label(page)).toHaveCSS('opacity', '0');
    await expect(dashboard(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(accounts(page)).toBeFocused();
    await expect(label(page)).toHaveCSS('opacity', '1');
  });

  test('on a header button, which the strip hides, focus moves to Dashboard', async ({ page }) => {
    await dashboard(page).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(sidebar(page).getByRole('button', { name: 'Pin sidebar' })).toBeFocused();
    await expect(label(page)).toHaveCSS('opacity', '1');
    await page.keyboard.press('Escape');
    await expect(label(page)).toHaveCSS('opacity', '0');
    await expect(dashboard(page)).toBeFocused();
  });

  test('in the account list, focus moves to Accounts', async ({ page }) => {
    await sidebar(page).getByRole('link', { name: 'Goals' }).focus();
    await page.keyboard.press('Tab');
    await expect(sidebar(page).getByRole('link', { name: /^All accounts/ })).toBeFocused();
    await expect(label(page)).toHaveCSS('opacity', '1');
    await page.keyboard.press('Escape');
    await expect(label(page)).toHaveCSS('opacity', '0');
    await expect(accounts(page)).toBeFocused();
  });

  test('in the Add account menu, the first Escape only closes the menu', async ({ page }) => {
    await sidebar(page).getByRole('button', { name: 'For budget' }).focus();
    await page.keyboard.press('Tab');
    const add = sidebar(page).getByRole('button', { name: 'Add account' });
    await expect(add).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(add).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    await expect(add).toBeFocused();
    await expect(label(page)).toHaveCSS('opacity', '1');
    await page.keyboard.press('Escape');
    await expect(label(page)).toHaveCSS('opacity', '0');
    await expect(accounts(page)).toBeFocused();
  });
});
