import { test, expect, type Page } from '@playwright/test';
import { SERVER_PORT } from '../../ports';

// Self-hosted server mode (Docker): the first visitor sets a password with the setup
// code from the server log, and everything else needs a login. These tests share one
// server and run in order, like a real first week with FlyBudget.

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'even better passphrase';

/** The browser that sets up the server; it stays signed in across tests */
let owner: Page;

test.beforeAll(async ({ browser }) => {
  owner = await (await browser.newContext()).newPage();
});
test.afterAll(async () => owner.context().close());

async function signIn(page: Page, password: string) {
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a new server asks for a password and the setup code', async ({ baseURL }) => {
  await owner.goto(`${baseURL}/`);
  await expect(owner.getByText('Set up your FlyBudget server')).toBeVisible();
  // Which server this is; on this computer (localhost) there's no insecure-connection warning
  await expect(owner.getByLabel('Server address')).toHaveText(`localhost:${SERVER_PORT}`);
  await expect(owner.getByText('Not a secure connection.')).toBeHidden();
  // The data is not reachable yet
  const api = await owner.request.get('/api/accounts');
  expect(api.status()).toBe(401);

  await owner.getByLabel('Setup code').fill('AAAA-BBBB-CCCC-DDDD');
  await owner.getByLabel('New password').fill(PASSWORD);
  await owner.getByLabel('Confirm password').fill(PASSWORD);
  await owner.getByRole('button', { name: 'Create password' }).click();
  await expect(owner.getByText('Incorrect setup code')).toBeVisible();

  await owner.getByLabel('Confirm password').fill('something else');
  await owner.getByLabel('Setup code').fill(process.env.E2E_SETUP_CODE!.toLowerCase());
  await owner.getByRole('button', { name: 'Create password' }).click();
  await expect(owner.getByText("The passwords don't match.")).toBeVisible();

  await owner.getByLabel('Confirm password').fill(PASSWORD);
  await owner.getByRole('button', { name: 'Create password' }).click();
  await expect(owner.getByRole('heading', { name: 'Welcome to FlyBudget' })).toBeVisible();

  // The session cookie can't be read by scripts
  const cookies = await owner.context().cookies();
  const session = cookies.find((c) => c.name === 'flybudget_session')!;
  expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  expect(await owner.evaluate(() => document.cookie)).toBe('');
});

test('the signed-in owner uses the app, with real page URLs', async ({ baseURL }) => {
  await owner.getByRole('button', { name: /Add Manually/ }).click();
  const dialog = owner.getByRole('dialog', { name: 'Add Account' });
  await dialog.getByRole('textbox', { name: 'Account name' }).fill('Credit Union');
  await dialog.getByRole('button', { name: 'Add Account' }).click();
  await expect(dialog).toBeHidden();

  // Server mode uses normal URLs: deep links and reloads work
  await owner.goto(`${baseURL}/budget`);
  await expect(owner.getByRole('status', { name: 'To be budgeted' })).toBeVisible();
  await owner.reload();
  await expect(owner.getByRole('status', { name: 'To be budgeted' })).toBeVisible();
});

test('another browser sees only the login screen', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/accounts`);
  await expect(page.getByText('Sign in to FlyBudget')).toBeVisible();
  await expect(page.getByText('Credit Union')).toBeHidden();
  await signIn(page, 'not the password');
  await expect(page.getByText('Incorrect password')).toBeVisible();
  await signIn(page, PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Credit Union');
});

test('changing the password signs out other browsers', async ({ browser, baseURL }) => {
  const other = await (await browser.newContext()).newPage();
  await other.goto(`${baseURL}/`);
  await signIn(other, PASSWORD);
  await expect(other.getByRole('complementary')).toBeVisible();

  await owner.goto(`${baseURL}/settings?tab=server`);
  await owner.getByRole('textbox', { name: 'Current password' }).fill(PASSWORD);
  await owner.getByRole('textbox', { name: 'New password', exact: true }).fill(NEW_PASSWORD);
  await owner.getByRole('textbox', { name: 'Confirm new password' }).fill(NEW_PASSWORD);
  await owner.getByRole('button', { name: 'Change password' }).click();
  await expect(
    owner.getByText('Password changed. Other devices have been signed out.'),
  ).toBeVisible();

  // The other browser's next request finds its session gone
  await other.reload();
  await expect(other.getByText('Sign in to FlyBudget')).toBeVisible();
  await signIn(other, PASSWORD);
  await expect(other.getByText('Incorrect password')).toBeVisible();
  await signIn(other, NEW_PASSWORD);
  await expect(other.getByRole('complementary')).toBeVisible();
  await other.context().close();
});

test('server details and signed-in devices need a login', async ({ playwright, baseURL }) => {
  const stranger = await playwright.request.newContext({ baseURL });
  expect((await stranger.get('/api/server/info')).status()).toBe(401);
  expect((await stranger.get('/api/auth/sessions')).status()).toBe(401);
  expect((await stranger.post('/api/auth/sessions/sign-out-others')).status()).toBe(401);
  // Anyone may check that the server is up, and learns nothing else
  expect(await (await stranger.get('/api/health')).text()).toBe('{"status":"ok"}');
  await stranger.dispose();

  const info = await owner.request.get('/api/server/info');
  expect(info.status()).toBe(200);
  const body = await info.json();
  expect(body.mode).toBe('server');
  expect(body.checks.map((c: { id: string }) => c.id)).toEqual([
    'https',
    'trustProxy',
    'allowedHosts',
    'encryptionKey',
    'password',
  ]);
});

test('Settings → Server shows the security check and signed-in devices', async ({
  browser,
  baseURL,
}) => {
  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`${baseURL}/`);
  await signIn(phone, NEW_PASSWORD);
  await expect(phone.getByRole('complementary')).toBeVisible();

  await owner.goto(`${baseURL}/settings?tab=server`);
  const checks = owner.getByRole('list', { name: 'Security check' });
  await expect(checks.getByRole('listitem')).toHaveCount(5);
  await expect(checks).toContainText('Connected on the same computer as the server');
  await expect(checks).toContainText('Bank credentials are encrypted at rest');
  // FLYBUDGET_ALLOWED_HOSTS isn't set on the test server: a warning that names the fix
  const hosts = checks.getByRole('listitem').filter({ hasText: 'Answers to any host name' });
  await expect(hosts.getByLabel('Warning')).toBeVisible();
  await expect(hosts).toContainText('FLYBUDGET_ALLOWED_HOSTS');

  const devices = owner.getByRole('list', { name: 'Signed-in devices' });
  await expect(devices.getByRole('listitem').filter({ hasText: 'This device' })).toHaveCount(1);
  expect(await devices.getByRole('listitem').count()).toBeGreaterThanOrEqual(2);

  await owner.getByRole('button', { name: 'Sign out all other devices' }).click();
  await expect(devices.getByRole('listitem')).toHaveCount(1);
  await expect(owner.getByRole('button', { name: 'Sign out all other devices' })).toBeDisabled();
  await phone.reload();
  await expect(phone.getByText('Sign in to FlyBudget')).toBeVisible();
  await phone.context().close();
});

test('the sidebar shows the server and can sign out', async ({ baseURL }) => {
  await owner.goto(`${baseURL}/budget`);
  const status = owner.getByRole('button', {
    name: `Server status: Online, localhost:${SERVER_PORT}`,
  });
  await status.click();
  const menu = owner.getByRole('menu', { name: 'Server' });
  await expect(menu).toContainText(`localhost:${SERVER_PORT}`);
  await menu.getByRole('menuitem', { name: 'Server settings' }).click();
  await expect(owner.getByRole('list', { name: 'Security check' })).toBeVisible();

  await status.click();
  await menu.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(owner.getByText('Sign in to FlyBudget')).toBeVisible();
  await signIn(owner, NEW_PASSWORD);
  await expect(owner.getByRole('complementary')).toBeVisible();
});

/** This browser's offline copy as JSON text, or null when there is none */
function offlineCopy(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const req = indexedDB.open('flybudget-offline', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const get = req.result.transaction('kv').objectStore('kv').get('snapshot');
          get.onsuccess = () => resolve(get.result ? JSON.stringify(get.result) : null);
          get.onerror = () => resolve(null);
        };
      }),
  );
}

const unreachable = (page: Page) =>
  page.route('**/api/**', (route) => route.abort('connectionrefused'));

test('with the server unreachable, the app opens with the offline copy and keeps new transactions', async ({
  baseURL,
}) => {
  await owner.goto(`${baseURL}/accounts`);
  await owner.getByRole('main').getByText('Credit Union', { exact: true }).click();
  await expect(owner.getByRole('heading', { level: 1, name: 'Credit Union' })).toBeVisible();
  const accountUrl = owner.url();
  // The copy is saved a moment after the data loads
  await expect.poll(() => offlineCopy(owner)).toContain('Credit Union');
  const copy = (await offlineCopy(owner))!;
  // Never the login state or signed-in devices
  expect(copy).not.toContain('auth-status');
  expect(copy).not.toContain('auth-sessions');

  // The server is gone and the page is opened fresh: the app still opens, with the data
  await unreachable(owner);
  await owner.goto(accountUrl);
  await expect(owner.getByRole('heading', { level: 1, name: 'Credit Union' })).toBeVisible();
  const banner = owner.getByRole('status', { name: 'Connection' });
  await expect(banner).toContainText("Can't reach FlyBudget. Showing your data as of");
  await expect(banner).toContainText('New transactions are saved on this device');

  // A new transaction waits on the device, even across a reload
  await owner.getByRole('button', { name: 'Add Transaction' }).click();
  const form = owner.getByRole('form', { name: 'New transaction' });
  await form.getByRole('textbox', { name: 'Payee' }).fill('Coffee Cart');
  await form.getByRole('spinbutton', { name: 'Outflow' }).fill('4.75');
  await form.getByRole('button', { name: 'Save' }).click();
  const waiting = owner.getByRole('region', { name: 'Saved on this device' });
  await expect(waiting.getByTestId('waiting-transaction')).toContainText('Coffee Cart');
  await expect(waiting).toContainText('Sent when FlyBudget reconnects');
  await expect(banner).toContainText('1 transaction waiting to send');
  await owner.reload();
  await expect(waiting.getByTestId('waiting-transaction')).toContainText('Coffee Cart');

  // Back online: it's sent once, by itself
  await owner.unroute('**/api/**');
  await expect(waiting).toBeHidden({ timeout: 15_000 });
  await expect(
    owner.getByTestId('transaction-row').filter({ hasText: 'Coffee Cart' }),
  ).toBeVisible();
  const all = await (await owner.request.get('/api/transactions')).json();
  expect(all.filter((t: { payeeName: string }) => t.payeeName === 'Coffee Cart')).toHaveLength(1);
});

test('the offline copy can be turned off, and signing out deletes it', async ({ baseURL }) => {
  await owner.goto(`${baseURL}/settings?tab=server`);
  const keep = owner.getByRole('checkbox', { name: /Keep a copy of my budget on this device/ });
  await expect(keep).toBeChecked();
  await expect.poll(() => offlineCopy(owner)).not.toBeNull();
  await keep.uncheck();
  await expect.poll(() => offlineCopy(owner)).toBeNull();
  // Nothing is saved while it's off, even as data loads
  await owner.goto(`${baseURL}/budget`);
  await expect(owner.getByRole('status', { name: 'To be budgeted' })).toBeVisible();
  await owner.waitForTimeout(2_500);
  expect(await offlineCopy(owner)).toBeNull();

  await owner.goto(`${baseURL}/settings?tab=server`);
  await keep.check();
  await owner.goto(`${baseURL}/budget`);
  await expect.poll(() => offlineCopy(owner)).not.toBeNull();

  await owner.goto(`${baseURL}/settings?tab=server`);
  await owner.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(owner.getByText('Sign in to FlyBudget')).toBeVisible();
  expect(await offlineCopy(owner)).toBeNull();
  // So an unreachable server shows no data at all
  await unreachable(owner);
  await owner.reload();
  await expect(owner.getByText('Try now')).toBeVisible();
  await expect(owner.getByText('Credit Union')).toBeHidden();
  await owner.unroute('**/api/**');
  await owner.getByRole('button', { name: 'Try now' }).click();
  await signIn(owner, NEW_PASSWORD);
  await expect(owner.getByRole('complementary')).toBeVisible();
});

test('warns before sending the password over plain HTTP to another machine', async ({
  playwright,
}) => {
  // Reach the test server under a name that isn't localhost, like a server on the LAN
  const browser = await playwright.chromium.launch({
    args: [
      '--host-resolver-rules=MAP flybudget.test 127.0.0.1',
      '--disable-features=HttpsUpgrades',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://flybudget.test:${SERVER_PORT}/`);
    await expect(page.getByText('Sign in to FlyBudget')).toBeVisible();
    await expect(page.getByLabel('Server address')).toHaveText(`flybudget.test:${SERVER_PORT}`);
    await expect(page.getByRole('note')).toContainText(
      'Not a secure connection. Your password would travel unencrypted. Only continue on a network you trust.',
    );
  } finally {
    await browser.close();
  }
});

test("someone guessing passwords can't lock the owner out", async ({ playwright, baseURL }) => {
  // An attacker from the same address (e.g. behind the same reverse proxy) burns
  // through the failed-login limit…
  const attacker = await playwright.request.newContext({ baseURL });
  let status = 0;
  for (let i = 0; i < 12 && status !== 429; i++) {
    status = (
      await attacker.post('/api/auth/login', { data: { password: `guess ${i}` } })
    ).status();
  }
  expect(status).toBe(429);
  await attacker.dispose();

  // …but a browser that signed in before has its own limit and still gets in
  await owner.goto(`${baseURL}/settings?tab=server`);
  await owner.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(owner.getByText('Sign in to FlyBudget')).toBeVisible();
  await signIn(owner, NEW_PASSWORD);
  await expect(owner.getByRole('complementary')).toBeVisible();
});
