import type { Page } from '@playwright/test';
import { test, expect, open, isoDay, thisMonth } from './fixtures';

// The zero-based budget: To Be Budgeted = income + carry-over − planned.

const toBeBudgeted = (page: Page) => page.getByRole('status', { name: 'To be budgeted' });

async function plan(page: Page, category: string, amount: string) {
  const button = page.getByRole('button', { name: new RegExp(`^Planned for ${category}:`) });
  // Categories with no activity sit under "Show N inactive categories" in each section
  await expect(page.getByRole('button', { name: /^Planned for / }).first()).toBeVisible();
  const showInactive = page.getByRole('button', { name: /^Show \d+ inactive/ });
  while (!(await button.isVisible()) && (await showInactive.count()) > 0) {
    await showInactive.first().click();
  }
  await button.click();
  const input = page.getByRole('spinbutton', { name: `Planned for ${category}` });
  await input.fill(amount);
  await input.press('Enter');
  await expect(
    page.getByRole('button', { name: new RegExp(`^Planned for ${category}: \\$`) }),
  ).toBeVisible();
}

test.describe('budget', () => {
  test('income is ready to budget, and planning spends it down', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 0);
    const paychecks = await api.category('Paychecks');
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: 300_000,
      payeeName: 'Employer',
      categoryId: paychecks.id,
    });

    await open(page, '/budget');
    await expect(toBeBudgeted(page)).toContainText('$3,000');
    await expect(toBeBudgeted(page)).toContainText('Left to budget');

    await plan(page, 'Groceries', '400');
    await expect(toBeBudgeted(page)).toContainText('$2,600');
    await plan(page, 'Rent / Mortgage', '2600');
    await expect(toBeBudgeted(page)).toContainText('$0');
    await expect(toBeBudgeted(page)).toContainText('Fully budgeted');

    const summary = await api.call('GET', `/budget/${thisMonth()}/summary`);
    expect(summary).toMatchObject({ income: 300_000, totalBudgeted: 300_000, toBeBudgeted: 0 });

    await plan(page, 'Restaurants', '50');
    await expect(toBeBudgeted(page)).toContainText('-$50');
    await expect(toBeBudgeted(page)).toContainText('Over budget');
  });

  test('spending shows against its categories, including split parts', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 100_000);
    const groceries = await api.category('Groceries');
    const restaurants = await api.category('Restaurants');
    await api.call('PUT', `/budget/${thisMonth()}/${groceries.id}`, { budgeted: 50_000 });
    await api.call('PUT', `/budget/${thisMonth()}/${restaurants.id}`, { budgeted: 10_000 });
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -12_000,
      payeeName: 'Supercenter',
      splits: [
        { categoryId: groceries.id, amount: -9_000 },
        { categoryId: restaurants.id, amount: -3_000 },
      ],
    });

    await open(page, '/budget');
    const groceriesRow = page.getByRole('row').filter({ hasText: 'Groceries' });
    await expect(groceriesRow).toContainText('$90');
    await expect(groceriesRow).toContainText('$410');
    const restaurantsRow = page.getByRole('row').filter({ hasText: 'Restaurants' });
    await expect(restaurantsRow).toContainText('$30');
    await expect(restaurantsRow).toContainText('$70');
  });

  test('income in an off-budget account is not money to budget', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 0);
    const brokerage = await api.createAccount('Brokerage', 0, 'investment');
    const paychecks = await api.category('Paychecks');
    const dividends = await api.category('Interest');
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: 100_000,
      categoryId: paychecks.id,
    });
    await api.createTransaction({
      accountId: brokerage.id,
      date: isoDay(),
      amount: 55_000,
      categoryId: dividends.id,
    });
    await open(page, '/budget');
    await expect(toBeBudgeted(page)).toContainText('$1,000');
  });

  test('unspent money carries over to the next month', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 0);
    const paychecks = await api.category('Paychecks');
    const groceries = await api.category('Groceries');
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: 100_000,
      categoryId: paychecks.id,
    });
    await api.call('PUT', `/budget/${thisMonth()}/${groceries.id}`, { budgeted: 40_000 });

    await open(page, '/budget');
    await expect(toBeBudgeted(page)).toContainText('$600');
    await page.getByRole('button', { name: 'Next month' }).click();
    // Last month's unbudgeted $600 is still there to budget
    await expect(toBeBudgeted(page)).toContainText('$600');
    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(toBeBudgeted(page)).toContainText('$0');
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(toBeBudgeted(page)).toContainText('$600');
  });

  test('a category links to its detail page with its transactions', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 0);
    const groceries = await api.category('Groceries');
    await api.call('PUT', `/budget/${thisMonth()}/${groceries.id}`, { budgeted: 20_000 });
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -4_321,
      payeeName: 'Farm Stand',
      categoryId: groceries.id,
    });
    await open(page, '/budget');
    await page.getByRole('row').filter({ hasText: 'Groceries' }).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`#/budget/category/${groceries.id}$`));
    await expect(
      page.getByTestId('transaction-row').filter({ hasText: 'Farm Stand' }),
    ).toBeVisible();
  });
  test('switching months keeps the budget on screen while the next month loads', async ({
    page,
    api,
  }) => {
    await api.createAccount('Checking', 0);
    const groceries = await api.category('Groceries');
    await api.call('PUT', `/budget/${thisMonth()}/${groceries.id}`, { budgeted: 20_000 });
    await open(page, '/budget');
    const groceriesPlanned = page.getByRole('button', { name: /^Planned for Groceries:/ });
    await expect(groceriesPlanned).toBeVisible();

    // Make next month slow to load, so the moment in between can be checked
    const [y, m] = thisMonth().split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    await page.route(`**/api/budget/${next}**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });

    await page.getByRole('button', { name: 'Next month' }).click();
    // Still loading: this month's table stays (faded) instead of collapsing to nothing
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    await expect(groceriesPlanned).toBeVisible();
    await expect(page.getByText('No categories yet')).toHaveCount(0);

    // Then next month's figures replace it
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^Planned for Groceries: \$0(\.00)?$/ }),
    ).toBeVisible();
  });
});
