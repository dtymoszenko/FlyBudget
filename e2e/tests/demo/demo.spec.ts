import { test as base, expect, type Page } from '@playwright/test';

// The website's "Try the demo" (client built with `--mode demo`, served under /demo/): the
// real app, with the server's routes running in a Web Worker on a sample budget. Nothing
// here talks to a FlyBudget server.

// Like the other suites: a test fails if the page throws or logs a console error
const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await use();
      expect(errors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
});

async function openDemo(page: Page, route = '/dashboard') {
  await page.goto(`/demo/#${route}`);
  await expect(page.getByRole('region', { name: 'Demo' })).toBeVisible();
}

test('the demo opens on a finished budget, and every page works', async ({ page }) => {
  // It never talks to a server: every request stays on the demo's own files
  const requests: string[] = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));

  await openDemo(page);
  await expect(page.getByText('Left to Spend')).toBeVisible();
  await expect(page.getByText('Upcoming Bills')).toBeVisible();

  for (const [route, text] of [
    ['/budget', 'Left to budget'],
    ['/transactions', 'Fresh Fields Market'],
    ['/accounts', 'Northstar Auto Loan'],
    ['/recurring', "Riley's paycheck"],
    ['/reports', 'Where the money goes'],
    ['/cash-flow', 'Total income'],
    ['/goals', 'Emergency fund'],
    ['/payees', 'Daily Grind Coffee'],
    ['/rules', 'Rename payee to Daily Grind Coffee'],
    ['/settings', 'Paychecks'],
  ] as const) {
    await page.evaluate((r) => (location.hash = `#${r}`), route);
    await expect(page.getByText(text).first(), route).toBeVisible();
  }

  expect(requests.filter((p) => !p.startsWith('/demo/'))).toEqual([]);
});

test('every payee shows its logo', async ({ page }) => {
  await openDemo(page, '/payees');
  const rows = page.getByRole('row').filter({ has: page.getByRole('checkbox') });
  await expect(rows.first()).toBeVisible();
  const withoutLogo = await rows.evaluateAll((trs) =>
    trs
      .filter((tr) => !tr.querySelector('img[src^="data:image/webp"]'))
      .map((tr) => tr.textContent),
  );
  expect(withoutLogo.slice(1)).toEqual([]); // the first row is the header's select-all
});

test('changes stay in the tab, and "Start over" brings the demo budget back', async ({ page }) => {
  await openDemo(page, '/accounts');
  await page.evaluate(() =>
    fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My test account', type: 'checking', startingBalance: 1234 }),
    }),
  );
  await page.reload();
  // A reload starts a fresh demo: nothing was saved
  await expect(page.getByText('Harbor Checking').first()).toBeVisible();
  await expect(page.getByText('My test account')).toHaveCount(0);

  await page.getByRole('link', { name: 'Payees' }).click();
  await page.getByRole('button', { name: 'Delete Corner Grocer' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Delete/ })
    .click();
  await expect(page.getByRole('row', { name: /Corner Grocer/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByText('Left to Spend')).toBeVisible();
  await page.getByRole('link', { name: 'Payees' }).click();
  await expect(page.getByRole('row', { name: /Corner Grocer/ })).toBeVisible();
});

test("bank connections can't be set up in the demo", async ({ page }) => {
  await openDemo(page, '/settings?tab=connections');
  await expect(page.getByText('Not available in the demo')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('button', { name: 'Connect via SimpleFIN' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect a bank' });
  await expect(dialog).toContainText('need the FlyBudget app');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);

  // The demo's API refuses them too
  const status = await page.evaluate(
    async () =>
      (
        await fetch('/api/simplefin/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setupToken: 'aHR0cHM6Ly9leGFtcGxlLmNvbQ==' }),
        })
      ).status,
  );
  expect(status).toBe(403);
});

test('the payment waiting to be matched can be confirmed', async ({ page }) => {
  await openDemo(page, '/recurring');
  await page.getByRole('button', { name: 'Review now' }).click();
  await expect(page.getByText('Kindred Food Bank').first()).toBeVisible();
  await page.getByRole('button', { name: 'Accept match' }).click();
  await expect(page.getByRole('button', { name: 'Review now' })).toHaveCount(0);
});
