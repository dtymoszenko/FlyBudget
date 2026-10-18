import { test, expect, open, isoDay, typeAmount } from './fixtures';
import type { Api } from './fixtures';

// Multiple currencies: the budget has one, accounts can each have their own, and the budget
// and reports count everything in the budget's at each day's rate. The desktop server
// downloads rates from mockFrankfurter.ts (1 EUR = 1.25 USD = 0.80 GBP = 4.25 PLN = 160 JPY).

const setCurrency = (api: Api, currency: string) => api.call('PUT', '/currency', { currency });
const addRate = (api: Api, base: string, quote: string, rate: string, date = isoDay()) =>
  api.call('POST', '/currency/rates', { date, base, quote, rate });

test('a budget with one currency sees nothing new', async ({ page, api }) => {
  await api.createAccount('Checking', 10_000);
  await open(page, '/accounts');
  await page.getByRole('main').getByRole('button', { name: 'Add Account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Account' });
  // No currency to pick until asked for
  await expect(dialog.getByRole('combobox', { name: 'Currency' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Choose a currency' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // The symbol is still the device's own setting
  await open(page, '/settings?tab=preferences');
  await expect(page.getByRole('textbox', { name: 'Currency symbol' })).toBeVisible();
  await expect(page.getByRole('main').getByText('$100.00')).toHaveCount(0);
});

test('choosing the budget currency, then adding accounts in others', async ({ page, api }) => {
  await api.createAccount('Girokonto', 100_000);
  await open(page, '/settings?tab=currencies');
  await page.getByRole('combobox', { name: 'Budget currency' }).selectOption('EUR');
  await page.getByRole('button', { name: 'Use this currency' }).click();
  await expect(page.getByRole('heading', { name: 'Exchange rates' })).toBeVisible();
  await expect.poll(async () => (await api.call('GET', '/currency')).currency).toBe('EUR');

  // An account in yen: no decimals, typed and shown that way
  await open(page, '/accounts');
  await page.getByRole('main').getByRole('button', { name: 'Add Account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Account' });
  await dialog.getByRole('textbox', { name: 'Account name' }).fill('Tokyo cash');
  await dialog.getByRole('combobox', { name: 'Currency' }).selectOption('JPY');
  const balance = dialog.getByRole('textbox', { name: 'Current Balance' });
  await typeAmount(balance, '12.5');
  await expect(balance).toHaveAttribute('aria-invalid', 'true');
  await typeAmount(balance, '15000');
  await dialog.getByRole('button', { name: 'Add Account' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await api.accounts()).find((a) => a.name === 'Tokyo cash'))
    .toMatchObject({ currency: 'JPY', balance: 15_000 });

  // Each balance in its own currency; its euro value appears once there's a rate
  await addRate(api, 'EUR', 'JPY', '160');
  await page.reload();
  await expect(page.getByRole('main').getByText('¥15,000')).toBeVisible();
  // The euro written as at home in the euro area (this device is American)
  await expect(page.getByRole('main').getByText(/≈ 93\.75\s€/)).toBeVisible();
});

test('the złoty is written after the amount, the dollar before', async ({ page, api }) => {
  await setCurrency(api, 'USD');
  await api.createAccount('Checking', 123_456);
  await api.createAccount('Konto', 123_456, 'checking', { currency: 'PLN' });
  await open(page, '/accounts');
  const main = page.getByRole('main');
  await expect(main.getByText('$1,234.56').first()).toBeVisible();
  await expect(main.getByText(/^1,234\.56\szł$/)).toBeVisible();
});

test('money moved between currencies keeps both amounts and the budget unchanged', async ({
  page,
  api,
}) => {
  await setCurrency(api, 'EUR');
  await api.createAccount('Girokonto', 200_000);
  await api.createAccount('US checking', 0, 'checking', { currency: 'USD' });
  await addRate(api, 'EUR', 'USD', '1.25');

  await open(page, '/transactions?add=1');
  const dialog = page.getByRole('dialog', { name: 'Add transaction' });
  await typeAmount(dialog.getByLabel('Amount', { exact: true }), '100');
  await dialog.getByRole('button', { name: /Select account/ }).click();
  await dialog.getByRole('button', { name: /Girokonto/ }).click();
  await dialog.getByRole('button', { name: /^Category:/ }).click();
  await dialog.getByRole('button', { name: 'Transfer: US checking' }).click();

  // What arrives is filled in at the day's rate, and can be typed over (the bank's own rate)
  const arrived = dialog.getByRole('textbox', { name: 'Amount in USD' });
  await expect(arrived).toHaveValue('$125');
  await typeAmount(arrived, '123.40');
  await dialog.getByRole('button', { name: 'Add transaction' }).click();
  await expect(dialog).toBeHidden();

  const accounts = await api.accounts();
  const usd = accounts.find((a) => a.name === 'US checking')!;
  expect(usd.balance).toBe(12_340);
  expect(accounts.find((a) => a.name === 'Girokonto')!.balance).toBe(190_000);
  const [into] = await api.call('GET', `/transactions?account_id=${usd.id}`);
  // Worth exactly what left: neither income nor spending
  expect(into).toMatchObject({ amount: 12_340, mainAmount: 10_000, mainAmountSource: 'transfer' });
});

test('a purchase without a rate is flagged until one is added', async ({ page, api }) => {
  await setCurrency(api, 'EUR');
  const pounds = await api.createAccount('UK current account', 0, 'checking', { currency: 'GBP' });
  const groceries = await api.category('Groceries');
  await api.createTransaction({
    accountId: pounds.id,
    date: isoDay(),
    amount: -4_000,
    payeeName: 'Corner shop',
    categoryId: groceries.id,
  });

  await open(page, '/budget');
  const banner = page.getByRole('status').filter({ hasText: 'no EUR value yet' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('1 GBP transaction');

  // In the register, it says why
  await open(page, `/accounts/${pounds.id}`);
  await expect(page.getByText('No rate').first()).toBeVisible();

  await open(page, '/settings?tab=currencies');
  await page.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('GBP');
  await page.getByRole('textbox', { name: /1 GBP in EUR/ }).fill('1,25');
  await page.getByRole('button', { name: 'Add rate' }).click();
  await expect(page.getByText('1 GBP = 1.25 EUR', { exact: true })).toBeVisible();

  await open(page, '/budget');
  await expect(page.getByRole('status').filter({ hasText: 'no EUR value yet' })).toHaveCount(0);
  const [tx] = await api.call('GET', `/transactions?account_id=${pounds.id}`);
  expect(tx).toMatchObject({ mainAmount: -5_000, mainAmountSource: 'rate' });
});

test('ECB rates download only when turned on', async ({ page, api }) => {
  await setCurrency(api, 'EUR');
  const zloty = await api.createAccount('Konto', 0, 'checking', { currency: 'PLN' });
  await api.createTransaction({
    accountId: zloty.id,
    date: isoDay(-2),
    amount: -8_500,
    payeeName: 'Sklep',
  });
  // Nothing was downloaded on its own
  expect((await api.call('GET', '/currency/rates')).length).toBe(0);

  await open(page, '/settings?tab=currencies');
  const download = page.getByRole('checkbox', { name: 'Download ECB reference rates' });
  await download.click();
  await expect(download).toBeChecked();
  await page.getByRole('button', { name: 'Download now' }).click();
  await expect(page.getByText('1 PLN = 0.235294 EUR')).toBeVisible();
  const [tx] = await api.call('GET', `/transactions?account_id=${zloty.id}`);
  expect(tx).toMatchObject({ mainAmount: -2_000, mainAmountSource: 'rate' });
});
