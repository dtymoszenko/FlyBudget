import { test, expect, open, isoDay } from './fixtures';

test('Cash Flow clicks scope transactions to the category, group and chart range', async ({
  page,
  api,
}) => {
  const account = await api.createAccount('Checking');
  const grocery = await api.category('Groceries');
  const dining = await api.category('Restaurants');
  const income = await api.category('Paychecks');
  const prior = new Date();
  prior.setDate(1);
  prior.setMonth(prior.getMonth() - 1);
  const previousDay = `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, '0')}-01`;
  for (const tx of [
    { date: isoDay(), amount: 100_000, payeeName: 'Employer', categoryId: income.id },
    { date: isoDay(), amount: -1_000, payeeName: 'Current groceries', categoryId: grocery.id },
    { date: previousDay, amount: -2_000, payeeName: 'Previous groceries', categoryId: grocery.id },
    { date: isoDay(), amount: -500, payeeName: 'Current dining', categoryId: dining.id },
    { date: isoDay(), amount: -300, payeeName: 'Unknown merchant', categoryId: null },
  ])
    await api.createTransaction({ accountId: account.id, ...tx });
  await open(page, '/cash-flow');
  await page.getByRole('button', { name: '1M', exact: true }).click();
  await page.getByRole('button', { name: /Show transactions: .*Groceries$/ }).click();
  const list = page.getByRole('region', { name: /Transactions:/ });
  await expect(list).toContainText('Current groceries');
  await expect(list).not.toContainText('Previous groceries');
  await expect(list).not.toContainText('Current dining');
  await expect(list).not.toContainText('Unknown merchant');
  const request = new URL(page.url());
  expect(request.hash).toContain('cash-flow');
  // A stale search must not hide the next chart selection.
  await list.getByPlaceholder('Search payee or notes…').fill('no such payee');
  await page
    .getByRole('button', { name: 'Show transactions: Uncategorized', exact: true })
    .first()
    .click();
  await expect(list).toContainText('Unknown merchant');
  await expect(list).not.toContainText('Current groceries');
  await expect(list.getByPlaceholder('Search payee or notes…')).toHaveValue('');
  const group = (await api.categoryGroups()).find((g) =>
    g.categories.some((c) => c.id === grocery.id),
  )!;
  await page.getByRole('button', { name: `Show transactions: ${group.name}`, exact: true }).click();
  await expect(list).toContainText('Current groceries');
  await expect(list).not.toContainText('Unknown merchant');
  // Switching date ranges must issue the chart's month bounds, not the register's defaults.
  await page.getByRole('button', { name: '6M', exact: true }).click();
  await page.getByRole('button', { name: /Show transactions: .*Groceries$/ }).click();
  await expect(list).toContainText('Previous groceries');
  await expect(list).toContainText('Current groceries');
});
