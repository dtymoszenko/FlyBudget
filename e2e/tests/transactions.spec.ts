import type { Page } from '@playwright/test';
import { test, expect, open, isoDay, otherDayThisMonth, typeAmount, type Api } from './fixtures';

// Entering and editing transactions in an account register, checking both what the
// page shows and what the server stored.

async function setup(api: Api) {
  const checking = await api.createAccount('Everyday Checking', 100_000);
  const savings = await api.createAccount('Rainy Day Savings', 500_000, 'savings');
  return { checking, savings };
}

const header = (page: Page) => page.getByRole('main').locator('div').first();

const newForm = (page: Page) => page.getByRole('form', { name: 'New transaction' });

/** The register row for a payee */
const row = (page: Page, payee: string) =>
  page.getByTestId('transaction-row').filter({ hasText: payee });

async function fillNewTransaction(
  page: Page,
  fields: { payee?: string; category?: string; notes?: string; outflow?: string; inflow?: string },
) {
  await page.getByRole('button', { name: 'Add Transaction' }).click();
  const form = newForm(page);
  if (fields.payee) await form.getByRole('textbox', { name: 'Payee' }).fill(fields.payee);
  if (fields.category) {
    await form.getByRole('combobox', { name: 'Category' }).selectOption({ label: fields.category });
  }
  if (fields.notes) await form.getByRole('textbox', { name: 'Notes' }).fill(fields.notes);
  if (fields.outflow) await form.getByRole('spinbutton', { name: 'Outflow' }).fill(fields.outflow);
  if (fields.inflow) await form.getByRole('spinbutton', { name: 'Inflow' }).fill(fields.inflow);
}

test.describe('account register', () => {
  test('adds an expense with a payee and category', async ({ page, api }) => {
    const { checking } = await setup(api);
    await open(page, `/accounts/${checking.id}`);
    await fillNewTransaction(page, {
      payee: 'Corner Grocery',
      category: '🛒 Groceries',
      notes: 'weekly shop',
      outflow: '42.50',
    });
    await newForm(page).getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: 'Corner Grocery', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '🛒 Groceries' })).toBeVisible();
    await expect(header(page)).toContainText('$957.50');
    expect(await api.balance(checking.id)).toBe(95_750);

    const [tx] = await api.transactions(`?account_id=${checking.id}`);
    expect(tx).toMatchObject({ amount: -4_250, payeeName: 'Corner Grocery', notes: 'weekly shop' });
    expect(tx.categoryId).toBe((await api.category('Groceries')).id);
    // A new payee was created for it
    const payees = await api.call<{ name: string }[]>('GET', '/payees');
    expect(payees.map((p) => p.name)).toContain('Corner Grocery');
  });

  test('adds income as an inflow', async ({ page, api }) => {
    const { checking } = await setup(api);
    await open(page, `/accounts/${checking.id}`);
    await fillNewTransaction(page, {
      payee: 'Acme Corp',
      category: '💵 Paychecks',
      inflow: '2500',
    });
    await newForm(page).getByRole('button', { name: 'Save' }).click();
    await expect(header(page)).toContainText('$3,500');
    expect(await api.balance(checking.id)).toBe(350_000);
  });

  test('a split transaction counts once toward the balance', async ({ page, api }) => {
    const { checking } = await setup(api);
    await open(page, `/accounts/${checking.id}`);
    await fillNewTransaction(page, { payee: 'Big Box Store', outflow: '100' });
    const form = newForm(page);
    await form.getByRole('button', { name: 'Split transaction' }).click();
    await form
      .getByRole('combobox', { name: 'Split 1 category' })
      .selectOption({ label: '🛒 Groceries' });
    await form.getByRole('spinbutton', { name: 'Split 1 amount' }).fill('60');
    await expect(form.getByText('$40 remaining')).toBeVisible();
    await form
      .getByRole('combobox', { name: 'Split 2 category' })
      .selectOption({ label: '🏠 Rent / Mortgage' });
    await form.getByRole('spinbutton', { name: 'Split 2 amount' }).fill('40');
    await expect(form.getByText('Balanced')).toBeVisible();
    await newForm(page).getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: 'Split (2)' })).toBeVisible();
    // $1,000 − $100, not − $200
    await expect(header(page)).toContainText('$900');
    expect(await api.balance(checking.id)).toBe(90_000);

    const [parent] = await api.transactions(`?account_id=${checking.id}`);
    const parts = parent.children.map((c: { amount: number }) => c.amount);
    expect(parts.sort((a: number, b: number) => a - b)).toEqual([-6_000, -4_000]);
  });

  test('a transfer moves money between two accounts', async ({ page, api }) => {
    const { checking, savings } = await setup(api);
    await open(page, `/accounts/${checking.id}`);
    await fillNewTransaction(page, { category: 'Transfer: Rainy Day Savings', outflow: '250' });
    await newForm(page).getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Transfer: Rainy Day Savings')).toBeVisible();
    expect(await api.balance(checking.id)).toBe(75_000);
    expect(await api.balance(savings.id)).toBe(525_000);

    // Deleting one side removes it and unlinks the other
    const [out] = await api.transactions(`?account_id=${checking.id}`);
    await api.call('DELETE', `/transactions/${out.id}`);
    const [other] = await api.transactions(`?account_id=${savings.id}`);
    expect(other.transferTransactionId).toBeNull();
  });

  test('edits the category, payee, date and notes from the detail panel', async ({ page, api }) => {
    const { checking } = await setup(api);
    const tx = await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -1_999,
      payeeName: 'Streamflix',
    });
    await open(page, `/accounts/${checking.id}`);
    // Rows open with the keyboard too
    await row(page, 'Streamflix').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Transaction Details')).toBeVisible();
    const panel = page.getByRole('complementary', { name: 'Transaction details' });

    // Category via the searchable picker
    await panel.getByRole('button', { name: 'Uncategorized' }).click();
    await page.getByPlaceholder('Search categories...').fill('stream');
    await page.getByRole('button', { name: /Streaming Services/ }).click();

    await panel.getByRole('textbox', { name: 'Notes' }).fill('family plan');
    await panel.getByRole('textbox', { name: 'Notes' }).blur();
    await panel.getByRole('textbox', { name: 'Date' }).fill(otherDayThisMonth());
    await panel.getByRole('textbox', { name: 'Date' }).blur();

    await expect
      .poll(async () => (await api.transactions(`?account_id=${checking.id}`))[0])
      .toMatchObject({
        id: tx.id,
        notes: 'family plan',
        date: otherDayThisMonth(),
        categoryId: (await api.category('Streaming Services')).id,
      });
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect(page.getByText('Transaction Details')).toBeHidden();
  });

  test('deletes a transaction after confirming', async ({ page, api }) => {
    const { checking } = await setup(api);
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -5_000,
      payeeName: 'Oops Store',
    });
    await open(page, `/accounts/${checking.id}`);
    await row(page, 'Oops Store').click();
    await page.getByRole('button', { name: 'Delete Transaction' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('No transactions yet')).toBeVisible();
    expect(await api.balance(checking.id)).toBe(100_000);
  });

  test('searches and filters by date range', async ({ page, api }) => {
    const { checking } = await setup(api);
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -1_000,
      payeeName: 'Coffee Corner',
    });
    await api.createTransaction({
      accountId: checking.id,
      date: '2020-06-15',
      amount: -2_000,
      payeeName: 'Old Bookshop',
    });
    await open(page, `/accounts/${checking.id}`);
    // "This Month" by default: the 2020 purchase is hidden
    await expect(page.getByRole('button', { name: 'Coffee Corner', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Old Bookshop', exact: true })).toBeHidden();

    await page.getByRole('button', { name: 'All Time' }).click();
    await expect(page.getByText('2 transactions')).toBeVisible();
    await page.getByPlaceholder('Search payee or notes…').fill('book');
    await expect(page.getByText('1 transactions')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Old Bookshop', exact: true })).toBeVisible();
  });

  test('the all-transactions page lists every account', async ({ page, api }) => {
    const { checking, savings } = await setup(api);
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -1,
      payeeName: 'A-Mart',
    });
    await api.createTransaction({
      accountId: savings.id,
      date: isoDay(),
      amount: 2,
      payeeName: 'B-Bank',
    });
    await open(page, '/transactions');
    await expect(page.getByRole('button', { name: 'A-Mart', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'B-Bank', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go to Rainy Day Savings' })).toBeVisible();
  });
});

test('the Add transaction dialog makes transfers too', async ({ page, api }) => {
  const { checking, savings } = await setup(api);
  await open(page, '/transactions?add=1');
  const dialog = page.getByRole('dialog', { name: 'Add transaction' });

  await dialog.getByRole('button', { name: 'Credit' }).click();
  await typeAmount(dialog.getByLabel('Amount', { exact: true }), '300');
  await dialog.getByRole('button', { name: /Select account/ }).click();
  await dialog.getByRole('button', { name: /Everyday Checking/ }).click();
  await dialog.getByRole('button', { name: /^Category:/ }).click();
  await dialog.getByRole('button', { name: 'Transfer: Rainy Day Savings' }).click();

  // A transfer is named after the other account, so it needs no merchant
  await expect(dialog.getByText('Merchant')).toBeHidden();
  await dialog.getByRole('button', { name: 'Add transaction' }).click();
  await expect(dialog).toBeHidden();

  // A credit brings the money into the chosen account
  expect(await api.balance(checking.id)).toBe(130_000);
  expect(await api.balance(savings.id)).toBe(470_000);
  const [into] = await api.transactions(`?account_id=${checking.id}`);
  expect(into.transferTransactionId).not.toBeNull();
});

test('sending a new transaction twice (offline retry) saves it once', async ({ api }) => {
  const checking = await api.createAccount('Everyday Checking', 100_000);
  const savings = await api.createAccount('Savings', 0, 'savings');
  const post = (path: string, data: object) => api.request.post(`/api${path}`, { data });

  const tx = {
    id: 'offline-tx-00000000001',
    accountId: checking.id,
    date: isoDay(),
    amount: -475,
    payeeName: 'Coffee Cart',
  };
  const first = await post('/transactions', tx);
  expect(first.status()).toBe(201);
  const again = await post('/transactions', { ...tx, amount: -999_999 });
  // The same saved transaction comes back; nothing new is created or changed
  expect(again.status()).toBe(200);
  expect(await again.json()).toMatchObject({ id: tx.id, amount: -475 });

  const split = {
    id: 'offline-split-000000001',
    accountId: checking.id,
    date: isoDay(),
    amount: -3_000,
    payeeName: 'Market',
    splits: [
      { categoryId: null, amount: -1_000 },
      { categoryId: null, amount: -2_000 },
    ],
  };
  expect((await post('/transactions', split)).status()).toBe(201);
  const splitAgain = await post('/transactions', split);
  expect(splitAgain.status()).toBe(200);
  expect((await splitAgain.json()).children).toHaveLength(2);

  const transfer = {
    id: 'offline-transfer-000001',
    fromAccountId: checking.id,
    toAccountId: savings.id,
    date: isoDay(),
    amount: 10_000,
  };
  expect((await post('/transactions/transfer', transfer)).status()).toBe(201);
  const transferAgain = await post('/transactions/transfer', transfer);
  expect(transferAgain.status()).toBe(200);
  expect(await transferAgain.json()).toHaveLength(2);

  // Ids from a device must look like ids
  expect((await post('/transactions', { ...tx, id: 'short' })).status()).toBe(400);
  expect((await post('/transactions', { ...tx, id: 'has spaces in it, 1234' })).status()).toBe(400);

  const rows = await api.call<{ id: string }[]>('GET', '/transactions');
  expect(rows.filter((r) => r.id === tx.id)).toHaveLength(1);
  // Balances count each one once: 1,000.00 − 4.75 − 30.00 − 100.00
  const accounts = await api.accounts();
  expect(accounts.find((a) => a.id === checking.id)!.balance).toBe(100_000 - 475 - 3_000 - 10_000);
  expect(accounts.find((a) => a.id === savings.id)!.balance).toBe(10_000);
});
