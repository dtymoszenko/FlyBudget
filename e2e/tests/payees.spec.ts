import { test, expect, open, isoDay, type Api } from './fixtures';

async function seed(api: Api) {
  const checking = await api.createAccount('Checking', 100_000);
  await api.createTransaction({
    accountId: checking.id,
    date: isoDay(),
    amount: -500,
    payeeName: 'AMZN Mktp',
  });
  await api.createTransaction({
    accountId: checking.id,
    date: isoDay(),
    amount: -700,
    payeeName: 'Amazon',
  });
  await api.createTransaction({
    accountId: checking.id,
    date: isoDay(),
    amount: -900,
    payeeName: 'Amazon',
  });
  return checking;
}

const row = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Select ${name}` }) });

const payeeOrder = (page: import('@playwright/test').Page) =>
  page
    .getByRole('checkbox', { name: /^Select (?!all payees$)/ })
    .evaluateAll((boxes) =>
      boxes.map((box) => box.getAttribute('aria-label')!.slice('Select '.length)),
    );

test.describe('payees', () => {
  test('lists payees with their transaction counts; a split counts once', async ({ page, api }) => {
    const checking = await seed(api);
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -1_000,
      payeeName: 'Costco',
      splits: [
        { categoryId: null, amount: -600 },
        { categoryId: null, amount: -400 },
      ],
    });
    await open(page, '/payees');
    await expect(row(page, 'Amazon').getByRole('cell').nth(3)).toHaveText('2');
    await expect(row(page, 'Costco').getByRole('cell').nth(3)).toHaveText('1');
    await page.getByPlaceholder('Search payees…').fill('amz');
    await expect(row(page, 'AMZN Mktp')).toBeVisible();
    await expect(row(page, 'Amazon')).toBeHidden();
  });

  test('merges payees and moves their transactions', async ({ page, api }) => {
    await seed(api);
    await open(page, '/payees');
    await page.getByRole('checkbox', { name: 'Select AMZN Mktp' }).check();
    await page.getByRole('checkbox', { name: 'Select Amazon' }).check();
    await page.getByRole('button', { name: 'Merge 2 payees' }).click();

    const dialog = page.getByRole('dialog', { name: 'Merge Payees' });
    await dialog.getByRole('radio', { name: /Amazon/ }).check();
    await dialog.getByRole('button', { name: 'Merge' }).click();

    await expect(row(page, 'AMZN Mktp')).toBeHidden();
    await expect(row(page, 'Amazon').getByRole('cell').nth(3)).toHaveText('3');
    const names = new Set((await api.transactions()).map((t) => t.payeeName));
    expect([...names]).toEqual(['Amazon']);
  });

  test('a default category applies to new transactions from that payee', async ({ page, api }) => {
    const checking = await seed(api);
    const shopping = await api.category('Groceries');
    await open(page, '/payees');
    await page
      .getByRole('combobox', { name: 'Default category for Amazon' })
      .selectOption(shopping.id);
    await expect
      .poll(async () => (await api.call<any[]>('GET', '/payees')).find((p) => p.name === 'Amazon'))
      .toMatchObject({ defaultCategoryId: shopping.id });

    const tx = await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -1_234,
      payeeName: 'Amazon',
    });
    expect(tx.categoryId).toBe(shopping.id);
  });

  test('renames a payee in place', async ({ page, api }) => {
    await seed(api);
    await open(page, '/payees');
    await page.getByTitle('Double-click to rename').filter({ hasText: 'AMZN Mktp' }).dblclick();
    const input = page.getByRole('textbox', { name: 'Rename AMZN Mktp' });
    await input.fill('Amazon Marketplace');
    await input.press('Enter');
    await expect(row(page, 'Amazon Marketplace')).toBeVisible();
    await expect
      .poll(async () => (await api.call<any[]>('GET', '/payees')).map((p) => p.name).sort())
      .toEqual(['Amazon', 'Amazon Marketplace']);
  });

  test('sorts by clicking the column headers and remembers the choice', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 100_000);
    const counts = { Bakery: 1, 'city power': 2, Zoo: 3 };
    for (const [payeeName, count] of Object.entries(counts)) {
      for (let i = 0; i < count; i++) {
        await api.createTransaction({
          accountId: checking.id,
          date: isoDay(),
          amount: -100,
          payeeName,
        });
      }
    }
    const payees = await api.call<any[]>('GET', '/payees');
    const idOf = (name: string) => payees.find((p) => p.name === name).id;
    await api.call('PUT', `/payees/${idOf('Bakery')}`, {
      defaultCategoryId: (await api.category('Groceries')).id,
    });
    await api.call('PUT', `/payees/${idOf('city power')}`, {
      defaultCategoryId: (await api.category('Electric')).id,
    });

    await open(page, '/payees');
    const header = (name: string) => page.getByRole('columnheader', { name, exact: true });
    const sortBy = (name: string) => header(name).getByRole('button').click();

    await expect.poll(() => payeeOrder(page)).toEqual(['Bakery', 'city power', 'Zoo']);
    await expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
    await expect(header('Transactions')).toHaveAttribute('aria-sort', 'none');

    await sortBy('Name');
    await expect.poll(() => payeeOrder(page)).toEqual(['Zoo', 'city power', 'Bakery']);
    await expect(header('Name')).toHaveAttribute('aria-sort', 'descending');

    await sortBy('Transactions');
    await expect.poll(() => payeeOrder(page)).toEqual(['Zoo', 'city power', 'Bakery']);
    await expect(header('Transactions')).toHaveAttribute('aria-sort', 'descending');
    await expect(header('Name')).toHaveAttribute('aria-sort', 'none');

    await sortBy('Transactions');
    await expect.poll(() => payeeOrder(page)).toEqual(['Bakery', 'city power', 'Zoo']);

    // Bills & Utilities → Electric, Food & Dining → Groceries, then no default category
    await sortBy('Default category');
    await expect.poll(() => payeeOrder(page)).toEqual(['city power', 'Bakery', 'Zoo']);
    await sortBy('Default category');
    await expect.poll(() => payeeOrder(page)).toEqual(['Bakery', 'city power', 'Zoo']);
    await expect(header('Default category')).toHaveAttribute('aria-sort', 'descending');

    await page.reload();
    await expect(header('Default category')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => payeeOrder(page)).toEqual(['Bakery', 'city power', 'Zoo']);
  });

  test('deletes a payee, keeping its transactions', async ({ page, api }) => {
    await seed(api);
    await open(page, '/payees');
    await page.getByRole('button', { name: 'Delete AMZN Mktp' }).click();
    await page
      .getByRole('dialog', { name: 'Delete Payee' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(row(page, 'AMZN Mktp')).toBeHidden();
    expect(await api.transactions()).toHaveLength(3);
  });
});

test('starts a rule from a payee, with its default category filled in (#175)', async ({
  page,
  api,
}) => {
  const checking = await api.createAccount('Checking', 10_000);
  const groceries = await api.category('Groceries');
  const payee = await api.call('POST', '/payees', {
    name: 'Corner Market',
    defaultCategoryId: groceries.id,
  });
  await api.createTransaction({
    accountId: checking.id,
    date: '2026-01-05',
    amount: -1_000,
    payeeName: 'Corner Market',
  });
  await open(page, '/payees');
  await row(page, 'Corner Market').hover();
  await page.getByRole('button', { name: 'Create rule for Corner Market' }).click();
  const dialog = page.getByRole('dialog', { name: 'New rule for Corner Market' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Groceries');
  await dialog.getByRole('button', { name: 'Save rule' }).click();
  await expect
    .poll(async () =>
      (await api.call<any[]>('GET', '/rules')).map((r) => [r.conditions, r.actions]),
    )
    .toEqual([
      [
        [{ field: 'payee', op: 'is', value: payee.id }],
        [{ type: 'set_category', value: groceries.id }],
      ],
    ]);
});
