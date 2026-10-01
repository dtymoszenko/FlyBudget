import { test as base, expect, type Page } from '@playwright/test';
import fs from 'fs';

// The website's "Try the demo" (client built with `--mode demo`, served under /demo/): the
// real app, with the server's routes running in a Web Worker on a sample budget. Nothing
// here talks to a FlyBudget server.

// Like the other suites: a test fails if the page throws or logs a console error
const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await use();
      if (testInfo.annotations.some((a) => a.type === 'allow-page-errors')) return;
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
    ['/budget', 'Renters Insurance'],
    ['/transactions', 'Maple Court Apartments'],
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

test('the banner leads back to the website: its homepage and the download page', async ({
  page,
}) => {
  await openDemo(page);
  const banner = page.getByRole('region', { name: 'Demo' });
  await expect(banner.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  await expect(banner.getByRole('link', { name: /Download/ })).toHaveAttribute('href', '/download');
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

/** The accounts in this tab's demo, from its API */
const accountNames = (page: Page) =>
  page.evaluate(async () =>
    ((await (await fetch('/api/accounts')).json()) as { name: string }[]).map((a) => a.name),
  );

test('every visitor, and every tab, gets its own demo', async ({ page, context, browser }) => {
  await openDemo(page, '/accounts');
  await page.evaluate(() =>
    fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Only in the first tab', type: 'checking', startingBalance: 0 }),
    }),
  );
  expect(await accountNames(page)).toContain('Only in the first tab');

  // Another tab in the same browser starts from the demo budget
  const secondTab = await context.newPage();
  await openDemo(secondTab, '/accounts');
  expect(await accountNames(secondTab)).toContain('Harbor Checking');
  expect(await accountNames(secondTab)).not.toContain('Only in the first tab');

  // And so does another visitor
  const other = await browser.newContext();
  const visitor = await other.newPage();
  await openDemo(visitor, '/accounts');
  expect(await accountNames(visitor)).toContain('Harbor Checking');
  expect(await accountNames(visitor)).not.toContain('Only in the first tab');
  await other.close();

  // The first tab still has its change
  expect(await accountNames(page)).toContain('Only in the first tab');
});

test('nothing leaves the browser: imports, backups and restores stay in the tab', async ({
  page,
}) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    if (url.hostname !== 'localhost' || !url.pathname.startsWith('/demo/')) outside.push(r.url());
  });
  await openDemo(page, '/settings?tab=data');

  // A backup downloads from the tab
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Backup' }).click();
  const backupFile = await (await download).path();
  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  expect(backup).toMatchObject({ format: 'flybudget-backup' });
  expect(Object.keys(backup)).not.toContain('plaidItems');

  // Restoring it works in the tab too
  await page.getByLabel('Backup file').setInputFiles(backupFile);
  await page
    .getByRole('dialog', { name: 'Restore this backup?' })
    .getByRole('button', { name: 'Replace my data' })
    .click();
  await expect(page.getByRole('status')).toContainText('Restored');

  // A CSV import, all the way through
  await page.evaluate(() => (location.hash = '#/accounts/demo-acct-checking'));
  await page.getByRole('button', { name: 'Import CSV' }).first().click();
  await page.locator('#csv-file-input').setInputFiles({
    name: 'bank.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Date,Description,Amount\n2026-01-05,Private Test Payee,-12.34\n'),
  });
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Import 1 Transactions' }).click();
  await expect(page.getByText('Import complete')).toBeVisible();

  expect(outside).toEqual([]);
});

test("the demo's preferences stay in the tab, and Start over resets them", async ({ page }) => {
  await openDemo(page, '/settings?tab=preferences');
  await expect(page.getByText('Settings are kept in this tab')).toBeVisible();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  // Not in the website's localStorage, which would outlive the tab
  const stored = await page.evaluate(() => ({
    local: localStorage.getItem('budget-preferences'),
    session: sessionStorage.getItem('budget-preferences'),
  }));
  expect(stored.local).toBeNull();
  expect(stored.session).toContain('dark');

  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByText('Left to Spend')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('the demo runs under a strict Content Security Policy', async ({ page }) => {
  // The blocked request below logs a CSP error, as it should
  test.info().annotations.push({ type: 'allow-page-errors' });
  const response = await page.goto('/demo/');
  // From the host (website/static/_headers)…
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("connect-src 'self'");
  expect(headers['x-frame-options']).toBe('DENY');
  // …and in the page itself, for hosts that don't send headers
  const meta = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(meta).toContain("default-src 'self'");
  expect(meta).toContain("connect-src 'self'");
  await expect(page.getByRole('region', { name: 'Demo' })).toBeVisible();
  await expect(page.getByText('Left to Spend')).toBeVisible();

  // A request to another site is blocked
  const blocked = await page.evaluate(() =>
    fetch('https://example.com/steal', { method: 'POST', body: 'x' }).then(
      () => false,
      () => true,
    ),
  );
  expect(blocked).toBe(true);
});
