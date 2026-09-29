import { test, expect, open, isoDay, type Api } from './fixtures';

// Reports: the built-in dashboard, the custom report builder, and saving a report.

async function seed(api: Api) {
  const checking = await api.createAccount('Checking', 100_000);
  const savings = await api.createAccount('Savings', 0, 'savings');
  const groceries = await api.category('Groceries');
  const paychecks = await api.category('Paychecks');
  await api.createTransaction({
    accountId: checking.id,
    date: isoDay(),
    amount: 200_000,
    payeeName: 'Employer',
    categoryId: paychecks.id,
  });
  await api.createTransaction({
    accountId: checking.id,
    date: isoDay(),
    amount: -4_250,
    payeeName: 'Market',
    categoryId: groceries.id,
  });
  // A split: $6 groceries + $4 uncategorized
  await api.createTransaction({
    accountId: checking.id,
    date: isoDay(),
    amount: -1_000,
    payeeName: 'Corner Shop',
    splits: [
      { categoryId: groceries.id, amount: -600 },
      { categoryId: null, amount: -400 },
    ],
  });
  // Moving money between accounts is neither income nor spending
  await api.call('POST', '/transactions/transfer', {
    fromAccountId: checking.id,
    toAccountId: savings.id,
    date: isoDay(),
    amount: 50_000,
  });
}

test.describe('reports', () => {
  test('the overview dashboard summarizes income and spending', async ({ page, api }) => {
    await seed(api);
    await open(page, '/reports');
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible();
    const main = page.getByRole('main');
    // A new budget's reports start on this month
    await expect(main.getByRole('button', { name: '1M', pressed: true })).toBeVisible();
    // Every dollar spent, uncategorized included; no transfer, no double-counted split
    await expect(main).toContainText(/\$2,000\s*Total Income/);
    await expect(main).toContainText(/\$52\.50\s*Total Expenses/);
    for (const widget of [
      'Net Worth',
      'Income & Expenses',
      'Spending by Category',
      'Spending Trends',
      'Transaction Calendar',
    ]) {
      await expect(main.getByText(widget, { exact: true })).toBeVisible();
    }
  });

  test('builds, saves and reopens a custom report', async ({ page, api }) => {
    await seed(api);
    await open(page, '/reports');
    await page.getByRole('link', { name: 'Custom Report' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Custom Report' })).toBeVisible();

    await page.getByRole('button', { name: 'Table' }).click();
    await page.getByRole('combobox', { name: 'Group by' }).selectOption('category');
    const table = page.getByRole('table');
    await expect(table.getByRole('row', { name: 'Groceries $48.50' })).toBeVisible();
    await expect(table.getByRole('row', { name: 'Uncategorized $4' })).toBeVisible();
    await expect(table.getByRole('row', { name: 'Total $52.50' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Group by' }).selectOption('payee');
    await expect(table.getByRole('row', { name: 'Market $42.50' })).toBeVisible();
    await expect(table.getByRole('row', { name: 'Corner Shop $10' })).toBeVisible();

    await page.getByRole('button', { name: 'Save' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save Report' });
    await dialog.getByRole('textbox', { name: 'Report name' }).fill('Spending by payee');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Spending by payee' })).toBeVisible();

    const [saved] = await api.call<any[]>('GET', '/custom-reports');
    expect(saved).toMatchObject({
      name: 'Spending by payee',
      config: { chartType: 'table', groupBy: 'payee', balanceType: 'expense' },
    });

    // It's on the dashboard now, and opens from there
    await open(page, '/reports');
    await expect(page.getByRole('main').getByText('Spending by payee')).toBeVisible();
    await open(page, `/reports/custom/${saved.id}`);
    await expect(page.getByRole('table').getByRole('row', { name: 'Market $42.50' })).toBeVisible();
  });

  test('switching the report to income shows income', async ({ page, api }) => {
    await seed(api);
    await open(page, '/reports/custom');
    await page.getByRole('button', { name: 'Table' }).click();
    await page.getByRole('button', { name: 'Income', exact: true }).click();
    await expect(
      page.getByRole('table').getByRole('row', { name: 'Paychecks $2,000' }),
    ).toBeVisible();
  });

  test('a new dashboard can be added', async ({ page, api }) => {
    await seed(api);
    await open(page, '/reports');
    await page.getByRole('button', { name: 'New dashboard' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('Taxes');
    await dialog.getByRole('button', { name: /Create|Save|Add/ }).click();
    await expect(page.getByRole('button', { name: 'Taxes' })).toBeVisible();
    await expect
      .poll(async () => (await api.call<any[]>('GET', '/dashboards')).map((d) => d.name))
      .toEqual(['Overview', 'Taxes']);
  });
});
