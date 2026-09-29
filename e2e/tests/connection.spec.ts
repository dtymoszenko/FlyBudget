import { test, expect, open, isoDay, thisMonth } from './fixtures';
import { startDesktopServer, stopDesktopServer } from './serverControl';

// Losing the connection to FlyBudget's server never locks you out: on startup the app
// shows a reconnect screen that keeps retrying (or opens with the offline copy, see
// server-mode/auth.spec.ts), and mid-session it keeps what's on screen, pauses saving
// except for new transactions (they wait on the device), and picks up again by itself.

test('the reconnect screen retries on its own and the app loads without a reload', async ({
  page,
  api,
}) => {
  await api.createAccount('Everyday Checking', 150_000);
  // The API doesn't answer yet (e.g. the server is still starting)
  await page.route('**/api/**', (route) => route.abort('connectionrefused'));
  await open(page, '/dashboard');

  await expect(page.getByRole('heading', { name: 'FlyBudget is starting up again' })).toBeVisible();
  await expect(page.getByText(/Trying again in \d+s|Checking…/)).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Time until the next try' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try now' })).toBeVisible();
  await expect(page.getByText('Your data is safe on this computer.')).toBeVisible();

  // The server answers again: no clicks, no reload
  await page.unroute('**/api/**');
  await expect(page.getByRole('link', { name: 'All accounts $1,500' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { name: 'FlyBudget is starting up again' })).toBeHidden();
});

test('"Try now" reconnects straight away', async ({ page, api }) => {
  await api.createAccount('Everyday Checking', 150_000);
  await page.route('**/api/**', (route) => route.abort('connectionrefused'));
  await open(page, '/dashboard');
  await expect(page.getByRole('button', { name: 'Try now' })).toBeVisible();
  await page.unroute('**/api/**');
  await page.getByRole('button', { name: 'Try now' }).click();
  await expect(page.getByRole('link', { name: 'All accounts $1,500' })).toBeVisible();
});

test('mid-session the app keeps what it loaded, keeps new transactions, and recovers', async ({
  page,
  api,
}) => {
  const account = await api.createAccount('Everyday Checking', 150_000);
  await api.createTransaction({
    accountId: account.id,
    date: isoDay(),
    amount: -4_250,
    payeeName: 'Corner Grocery',
  });
  const groceries = await api.category('Groceries');
  await api.call('PUT', `/budget/${thisMonth()}/${groceries.id}`, { budgeted: 50_000 });
  await open(page, '/budget');
  const planned = page.getByRole('button', { name: /^Planned for Groceries:/ });
  await expect(planned).toBeEnabled();
  await open(page, `/accounts/${account.id}`);
  await expect(page.getByText('Corner Grocery')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Transaction' })).toBeEnabled();

  await stopDesktopServer();
  try {
    // The next request finds the server gone (a page that hasn't loaded its data yet)
    const nav = page.getByRole('complementary');
    await nav.getByRole('link', { name: 'Transactions', exact: true }).click();
    const banner = page.getByRole('status', { name: 'Connection' });
    await expect(banner).toContainText("Can't reach FlyBudget. Showing your data as of");
    await expect(banner).toContainText(
      'New transactions are saved on this device; other changes wait until it reconnects.',
    );
    await expect(banner).toContainText(/Retrying in \d+s|Checking…/);
    // What was loaded stays on screen, but can't be changed
    await nav.getByRole('link', { name: 'Budget', exact: true }).click();
    await expect(planned).toBeVisible();
    await expect(planned).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Server status: Reconnecting/ })).toBeVisible();

    // In-app navigation (no reload) back to the account
    await page.evaluate((id) => (window.location.hash = `#/accounts/${id}`), account.id);
    await expect(page.getByText('Corner Grocery')).toBeVisible();
    // A new transaction is kept on this device until the server is back
    await page.getByRole('button', { name: 'Add Transaction' }).click();
    const form = page.getByRole('form', { name: 'New transaction' });
    await form.getByRole('textbox', { name: 'Payee' }).fill('Coffee Cart');
    await form.getByRole('spinbutton', { name: 'Outflow' }).fill('4.75');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toBeHidden();
    await expect(
      page.getByRole('region', { name: 'Saved on this device' }).getByTestId('waiting-transaction'),
    ).toContainText('Coffee Cart');
    await expect(banner).toContainText('1 transaction waiting to send');
  } finally {
    await startDesktopServer();
  }

  // Back: "Retry now" checks straight away (unless an automatic retry got there first)
  await page
    .getByRole('status', { name: 'Connection' })
    .getByRole('button', { name: 'Retry now' })
    .click({ timeout: 2_000 })
    .catch(() => {});
  await expect(page.getByRole('status', { name: 'Connection' })).toContainText(
    'Reconnected. Everything is up to date.',
  );
  await expect(page.getByRole('button', { name: /^Server status: Online/ })).toBeVisible();
  // The waiting transaction was sent, once
  await expect(page.getByRole('region', { name: 'Saved on this device' })).toBeHidden();
  await expect(
    page.getByTestId('transaction-row').filter({ hasText: 'Coffee Cart' }),
  ).toBeVisible();
  const saved = await api.call<{ payeeName: string }[]>(
    'GET',
    `/transactions?accountId=${account.id}`,
  );
  expect(saved.filter((t) => t.payeeName === 'Coffee Cart')).toHaveLength(1);
});

test('the sidebar shows where the data lives and links to Settings → Server', async ({
  page,
  api,
}) => {
  await api.createAccount('Everyday Checking');
  await open(page, '/dashboard');
  const status = page.getByRole('button', { name: 'Server status: Online, on this computer' });
  await expect(status).toHaveAttribute('aria-expanded', 'false');
  await status.click();
  const menu = page.getByRole('menu', { name: 'Server' });
  await expect(menu).toContainText('Server online');
  await expect(menu).toContainText('Stays on this computer');
  await expect(menu).toContainText(/Version\s*\d+\.\d+\.\d+/);
  // No login in the desktop app, so nothing to sign out of
  await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(status).toBeFocused();

  await status.click();
  await page.getByRole('menuitem', { name: 'Server settings' }).click();
  await expect(page.getByRole('heading', { name: 'Where your data lives' })).toBeVisible();
  await expect(page.getByRole('main').getByText('On this computer', { exact: true })).toBeVisible();
  const guide = page.getByRole('link', { name: 'Read the self-hosting guide' });
  await expect(guide).toHaveAttribute('href', 'https://flybudget.org/community/self-hosting');
  await expect(guide).toHaveAttribute('target', '_blank');
  await expect(guide).toHaveAttribute('rel', 'noopener noreferrer');
  await page.getByRole('button', { name: 'Make a backup first' }).click();
  await expect(page.getByRole('button', { name: 'Download Backup' })).toBeVisible();
});

test('server details are only for the app itself', async ({ playwright, baseURL, api }) => {
  const info = await api.call('GET', '/server/info');
  expect(info).toEqual({ mode: 'desktop', version: expect.stringMatching(/^\d+\.\d+\.\d+/) });
  // Without the per-launch token: refused, while health says only that it's up
  const stranger = await playwright.request.newContext({ baseURL });
  expect((await stranger.get('/api/server/info')).status()).toBe(401);
  expect(await (await stranger.get('/api/health')).json()).toEqual({ status: 'ok' });
  await stranger.dispose();
});
