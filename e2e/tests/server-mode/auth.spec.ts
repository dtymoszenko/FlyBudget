import { test, expect, type Page } from '@playwright/test';

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
  await owner.getByRole('button', { name: 'Sign out' }).click();
  await expect(owner.getByText('Sign in to FlyBudget')).toBeVisible();
  await signIn(owner, NEW_PASSWORD);
  await expect(owner.getByRole('complementary')).toBeVisible();
});
