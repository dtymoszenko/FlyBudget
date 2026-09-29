import { test, expect, open, isoDay, typeAmount } from './fixtures';

test.describe('accounts', () => {
  test('a new user adds their first account from the welcome screen', async ({ page, api }) => {
    await open(page, '/dashboard');
    await page.getByRole('button', { name: /Add accounts manually/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Add Account' });
    await dialog.getByRole('textbox', { name: 'Account name' }).fill('Chase Checking');
    await dialog.getByRole('combobox', { name: 'Account type' }).selectOption('checking');
    await dialog.getByRole('textbox', { name: 'Current Balance' }).fill('1234.56');
    await dialog.getByRole('button', { name: 'Add Account' }).click();

    await expect
      .poll(async () => (await api.accounts()).map((a) => a.name))
      .toEqual(['Chase Checking']);
    const [account] = await api.accounts();
    expect(account.balance).toBe(123_456);
    // Checking accounts are on budget by default
    expect(account).toMatchObject({ isOffBudget: 0 });
  });

  test('"Skip for now" opens the app, and it stays open after a reload', async ({ page }) => {
    await open(page, '/welcome');
    await page.getByRole('button', { name: 'Skip for now and look around' }).click();
    await expect(page).toHaveURL(/#\/dashboard$/);
    await expect(
      page.getByRole('complementary').getByRole('link', { name: 'Budget' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Get started with FlyBudget' })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/#\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Get started with FlyBudget' })).toBeVisible();
  });

  test('the assets and liabilities summary lists only the kinds of accounts you have', async ({
    page,
    api,
  }) => {
    await api.createAccount('Checking', 120_000);
    await open(page, '/accounts');
    const main = page.getByRole('main');
    await expect(main.getByText('Assets', { exact: true })).toBeVisible();
    // No "$0" rows for kinds of accounts that were never added
    await expect(main.getByText('Investments', { exact: true })).toHaveCount(0);
    await expect(main.getByText('Credit', { exact: true })).toHaveCount(0);
    await expect(main.getByText('No credit cards or loans yet.')).toBeVisible();

    await main.getByRole('link', { name: 'Add account' }).click();
    await expect(page.getByRole('dialog', { name: 'Add Account' })).toBeVisible();
  });

  test('investments, property and loans default to off budget', async ({ page, api }) => {
    await api.createAccount('Checking', 0);
    await open(page, '/accounts');
    await page.getByRole('main').getByRole('button', { name: 'Add Account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Account' });
    await dialog.getByRole('textbox', { name: 'Account name' }).fill('Home');
    await dialog.getByRole('combobox', { name: 'Account type' }).selectOption('real_estate');
    await expect(dialog.getByRole('checkbox', { name: /Off budget/ })).toBeChecked();
    await dialog.getByRole('textbox', { name: 'Current Value' }).fill('350000');
    await dialog.getByRole('button', { name: 'Add Account' }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => (await api.accounts()).find((a) => a.name === 'Home'))
      .toMatchObject({ isOffBudget: 1, balance: 35_000_000 });
  });

  test('renaming an account keeps its balance', async ({ page, api }) => {
    const account = await api.createAccount('Checking', 250_000);
    await api.createTransaction({
      accountId: account.id,
      date: isoDay(),
      amount: -12_345,
      payeeName: 'Rent',
    });
    await open(page, `/accounts/${account.id}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Account' });
    await dialog.getByRole('textbox', { name: 'Account name' }).fill('Joint Checking');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Joint Checking' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('$2,376.55');
    expect(await api.balance(account.id)).toBe(237_655);
  });

  test('changing the starting balance moves the balance', async ({ page, api }) => {
    const account = await api.createAccount('Checking', 10_000);
    await open(page, `/accounts/${account.id}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Account' });
    await typeAmount(dialog.getByRole('textbox', { name: 'Starting balance' }), '500');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => api.balance(account.id)).toBe(50_000);
  });

  test('closing an account hides it', async ({ page, api }) => {
    await api.createAccount('Keep Me', 100);
    const account = await api.createAccount('Old Card', -500, 'credit');
    await open(page, `/accounts/${account.id}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await page
      .getByRole('dialog', { name: 'Edit Account' })
      .getByRole('button', { name: 'Close Account' })
      .click();
    await page
      .getByRole('dialog', { name: 'Close Account' })
      .getByRole('button', { name: 'Close Account' })
      .click();

    await expect.poll(async () => (await api.accounts()).map((a) => a.name)).toEqual(['Keep Me']);
    await open(page, '/accounts');
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
    await expect(page.getByText('Old Card')).toBeHidden();
  });

  test('updating an investment value records the change', async ({ page, api }) => {
    await api.createAccount('Checking', 0);
    const brokerage = await api.createAccount('Brokerage', 1_000_000, 'investment');
    await open(page, `/accounts/${brokerage.id}`);
    await page.getByRole('button', { name: 'Update value' }).click();
    const dialog = page.getByRole('dialog', { name: 'Update Value' });
    await typeAmount(dialog.getByRole('textbox', { name: 'Value today' }), '10500');
    await dialog.getByRole('button', { name: /Save|Update/ }).click();

    await expect.poll(() => api.balance(brokerage.id)).toBe(1_050_000);
    const [adjustment] = await api.transactions(`?account_id=${brokerage.id}`);
    expect(adjustment).toMatchObject({ amount: 50_000, notes: 'Value update', isAdjustment: 1 });

    // A change in value isn't money earned or spent: reports leave it out
    await open(page, '/reports');
    const main = page.getByRole('main');
    await expect(main).toContainText(/\$0\s*Total Income/);
    await expect(main).toContainText(/\$0\s*Total Expenses/);
  });

  test('the accounts page totals assets and liabilities', async ({ page, api }) => {
    await api.createAccount('Checking', 300_000);
    await api.createAccount('Visa', -45_000, 'credit');
    await api.createAccount('Car Loan', -1_200_000, 'auto_loan');
    await open(page, '/accounts');
    const main = page.getByRole('main');
    await expect(main).toContainText(/Net Worth\s*-\$9,450/);
    await expect(main).toContainText(/Assets\s*\$3,000/);
    await expect(main).toContainText(/Liabilities\s*-\$12,450/);
    await expect(main).toContainText(/Loans\s*-\$12,000/);
  });
});
