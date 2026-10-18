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

test('the sidebar is resized by dragging its edge or with the keyboard', async ({ page, api }) => {
  await api.createAccount('Everyday Checking', 100_000);
  await open(page, '/dashboard');
  const sidebar = page.locator('aside').first();
  const edge = page.getByRole('separator', { name: 'Resize sidebar' });
  const width = async () => (await sidebar.boundingBox())!.width;
  expect(await width()).toBe(208);

  const box = (await edge.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, y, { steps: 5 });
  await page.mouse.up();
  expect(await width()).toBe(268);

  // Never wider than 320 or narrower than 200
  await edge.press('End');
  await expect(edge).toHaveAttribute('aria-valuenow', '320');
  await edge.press('ArrowLeft');
  await expect(edge).toHaveAttribute('aria-valuenow', '304');
  await edge.press('Home');
  await expect(edge).toHaveAttribute('aria-valuenow', '200');

  // Remembered on this device; double-click goes back to the default
  await edge.press('End');
  await page.reload();
  expect(await width()).toBe(320);
  await edge.dblclick();
  expect(await width()).toBe(208);
});

test('unknown routes inside the app fall back gracefully', async ({ page, api }) => {
  await api.createAccount('Everyday Checking');
  await open(page, '/');
  await expect(page).toHaveURL(/#\/dashboard$/);
});
