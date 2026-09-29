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
  for (const p of PAGES) {
    await nav.getByRole('link', { name: p.link, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${p.route}$`));
    if (p.heading) {
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
    }
  }
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
