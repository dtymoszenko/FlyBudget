import { generateKeyPairSync, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, open } from './fixtures';
import { DESKTOP_PORT, ENABLE_BANKING_MOCK_PORT } from '../ports';
import { MOCK_IBAN } from '../mockEnableBanking';

// European bank sync through Enable Banking, against the mock in mockEnableBanking.ts: set up
// the application, log in at the bank in another window (whose redirect reaches FlyBudget
// with no API token), map the account an earlier CAMT statement went into, sync without
// duplicating what's there, the session ending, reconnecting with the paste fallback, and
// disconnecting. Also the flybudget.org relay page the desktop app registers.

const mock = (action: string) =>
  fetch(`http://127.0.0.1:${ENABLE_BANKING_MOCK_PORT}/__mock/${action}`, { method: 'POST' }).then(
    (r) => r.json() as Promise<{ deleted: string[] }>,
  );

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

test('connects a European bank, syncs it, reconnects and disconnects', async ({
  page,
  api,
  context,
}) => {
  test.setTimeout(90_000);
  await mock('reset');
  try {
    // An account that already has this IBAN's statements, with one of the bank's transactions
    const account = await api.createAccount('Mock checking');
    await api.call('PUT', `/accounts/${account.id}/statement-account`, { account: MOCK_IBAN });
    await api.createTransaction({
      accountId: account.id,
      date: days(-3),
      amount: -1250,
      payeeName: 'Kauppa',
    });

    await open(page, '/settings?tab=connections');
    await page.getByRole('button', { name: 'Enable Banking' }).click();
    await page.getByLabel('Application ID').fill('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    await page.getByLabel('Private key (.pem file)').setInputFiles({
      name: 'app.pem',
      mimeType: 'application/x-pem-file',
      buffer: Buffer.from(pem),
    });
    await page.getByRole('button', { name: 'Check and save' }).click();
    await expect(page.getByText('E2E FlyBudget')).toBeVisible();

    // Saving opens the connect dialog
    const dialog = page.getByRole('dialog', { name: 'Connect a European bank' });
    await dialog.getByLabel('Country').selectOption('FI');
    await dialog.getByRole('option', { name: 'Mock Bank' }).click();
    const bankPage = context.waitForEvent('page');
    await dialog.getByRole('button', { name: 'Log in at your bank' }).click();
    const bank = await bankPage;
    await expect(bank.getByRole('heading', { name: 'Bank connected' })).toBeVisible();
    await bank.close();

    // The account the CAMT statement went into is picked
    await expect(
      dialog.getByText('Your last bank statement for this account went here.'),
    ).toBeVisible();
    await expect(dialog.getByLabel(/^Account for /)).toHaveValue(account.id);
    await dialog.getByRole('button', { name: 'Save and sync' }).click();
    await expect(dialog.getByText('Brought in 2 transactions.', { exact: false })).toBeVisible();
    await expect(dialog.getByText(/1 you already had/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    const rows = (await api.transactions()).filter((t) => t.accountId === account.id);
    expect(rows).toHaveLength(3);
    expect(await api.balance(account.id)).toBe(300000);
    await expect(page.getByText('→ Mock checking')).toBeVisible();

    // A second sync adds nothing
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText('Synced: 0 new transactions.')).toBeVisible();

    // The bank's access ends
    await mock('expire');
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText('Login Required')).toBeVisible();
    await mock('renew');

    // Reconnect, with the redirect not reaching FlyBudget: paste the address instead
    await mock('hold');
    await page.getByRole('button', { name: 'Reconnect' }).click();
    const reconnect = page.getByRole('dialog', { name: 'Reconnect Mock Bank' });
    const again = context.waitForEvent('page');
    await reconnect.getByRole('button', { name: 'Log in at your bank' }).click();
    const held = await again;
    const address = (await held.locator('body').textContent())?.trim();
    await held.close();
    await reconnect
      .getByRole('button', { name: "Logged in, but FlyBudget didn't continue?" })
      .click();
    await reconnect.getByLabel(/copy the whole address/).fill(address!);
    await reconnect.getByRole('button', { name: 'Continue' }).click();
    // Every account was already set up, so it syncs straight away
    await expect(reconnect.getByText('Brought in 0 transactions.', { exact: false })).toBeVisible();
    await reconnect.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Synced', { exact: true })).toBeVisible();
    expect((await api.transactions()).filter((t) => t.accountId === account.id)).toHaveLength(3);

    await page.getByRole('button', { name: 'Disconnect' }).click();
    await page
      .getByRole('dialog', { name: 'Disconnect Mock Bank' })
      .getByRole('button', { name: 'Disconnect' })
      .click();
    await expect(page.getByText('→ Mock checking')).toHaveCount(0);
    const state = await mock('renew');
    expect(state.deleted).toEqual(['e2e-session-1', 'e2e-session-2']);
  } finally {
    // Bank connections aren't part of the database reset between tests
    for (const conn of await api.call<{ id: string }[]>('GET', '/enable-banking/connections')) {
      await api.call('DELETE', `/enable-banking/connections/${conn.id}`);
    }
    await api.request.fetch('/api/enable-banking/configure', { method: 'DELETE' });
  }
});

test("the bank's redirect needs its state, and nothing else gets through without the token", async ({
  request,
}) => {
  const callback = `http://127.0.0.1:${DESKTOP_PORT}/api/enable-banking/callback`;
  const forged = await request.get(
    `${callback}?state=fb1.${DESKTOP_PORT}.${'a'.repeat(43)}&code=x`,
    {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    },
  );
  expect(forged.status()).toBe(400);
  expect(await forged.text()).toContain('Link expired');
  // The rest of the API still needs the token
  const other = await request.get(`http://127.0.0.1:${DESKTOP_PORT}/api/enable-banking/status`);
  expect(other.status()).toBe(401);
});

const relayDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../website/static/bank-callback',
);

test('the flybudget.org relay page sends the bank login to FlyBudget on this computer', async ({
  page,
}) => {
  // Served from the website's files, as Cloudflare Pages would
  await page.route('https://flybudget.org/bank-callback/**', (route) => {
    const file = new URL(route.request().url()).pathname.endsWith('relay.js')
      ? 'relay.js'
      : 'index.html';
    return route.fulfill({
      body: fs.readFileSync(path.join(relayDir, file)),
      contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html',
    });
  });

  const state = `fb1.${DESKTOP_PORT}.${randomBytes(32).toString('base64url')}`;
  await page.goto(`https://flybudget.org/bank-callback/?code=abc&state=${state}`);
  // FlyBudget isn't waiting for this login, and says so: the page reached it
  await expect(page).toHaveURL(
    new RegExp(
      `^http://127\\.0\\.0\\.1:${DESKTOP_PORT}/api/enable-banking/callback\\?code=abc&state=`,
    ),
  );
  await expect(page.getByRole('heading', { name: 'Link expired' })).toBeVisible();

  // A cancelled login is passed on too, and the page never says it worked
  await page.goto(`https://flybudget.org/bank-callback/?error=access_denied&state=${state}`);
  await expect(page).toHaveURL(/\/api\/enable-banking\/callback\?error=access_denied/);

  // Anything that isn't FlyBudget's state goes nowhere
  await page.goto('https://flybudget.org/bank-callback/?code=abc&state=https://evil.example');
  await expect(page.getByRole('heading', { name: 'Nothing to pass on' })).toBeVisible();
  expect(new URL(page.url()).host).toBe('flybudget.org');
});
