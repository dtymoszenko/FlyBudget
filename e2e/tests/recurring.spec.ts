import type { Page } from '@playwright/test';
import { test, expect, open, isoDay, typeAmount, type Api } from './fixtures';

// Recurring bills and income: create one, see it in the month, mark it paid, pause it,
// and let "Find recurring" discover one from history.

/** The row for a schedule in the "All recurring" table */
const scheduleRow = (page: Page, name: string) =>
  page
    .getByRole('main')
    .locator('div')
    .filter({ hasText: name })
    .filter({
      has: page.getByRole('button', { name: 'Actions' }),
    });

async function openAll(page: Page) {
  await open(page, '/recurring');
  await page.getByRole('button', { name: 'All recurring' }).click();
}

async function createRent(api: Api, accountId: string, extra: object = {}) {
  return api.call('POST', '/schedules', {
    name: 'Rent',
    amount: -150_000,
    recurrenceType: 'monthly',
    startDate: isoDay(2),
    accountId,
    ...extra,
  });
}

test.describe('recurring', () => {
  test('adds a monthly bill through the form', async ({ page, api }) => {
    await api.createAccount('Checking', 500_000);
    await open(page, '/recurring');
    await page.getByRole('main').getByRole('button', { name: 'Add recurring' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Add Recurring' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Streaming Plus');
    await typeAmount(dialog.getByRole('textbox', { name: 'Amount' }), '15.99');
    await expect(dialog.getByRole('button', { name: 'Expense' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByRole('combobox', { name: 'Frequency' }).selectOption('monthly');
    await dialog.getByRole('combobox', { name: 'Account' }).selectOption({ label: 'Checking' });
    await dialog.getByRole('textbox', { name: 'Start date' }).fill(isoDay(1));
    await dialog.getByRole('button', { name: 'Add Recurring' }).click();
    await expect(dialog).toBeHidden();

    const [schedule] = await api.call<any[]>('GET', '/schedules');
    expect(schedule).toMatchObject({
      name: 'Streaming Plus',
      amount: -1_599,
      recurrenceType: 'monthly',
      status: 'active',
      startDate: isoDay(1),
    });

    await page.getByRole('button', { name: 'All recurring' }).click();
    await expect(scheduleRow(page, 'Streaming Plus').first()).toContainText('$15.99');
  });

  test('picking or creating a payee or category keeps what was already filled in', async ({
    page,
    api,
  }) => {
    await api.createAccount('Checking', 500_000);
    await api.createAccount('Savings', 100_000, 'savings');
    await open(page, '/recurring');
    await page.getByRole('main').getByRole('button', { name: 'Add recurring' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add Recurring' });
    const name = dialog.getByRole('textbox', { name: 'Name' });
    const account = dialog.getByRole('combobox', { name: 'Account' });

    await name.fill('Gym membership');
    await typeAmount(dialog.getByRole('textbox', { name: 'Amount' }), '45');
    await account.selectOption({ label: 'Savings' });

    // A brand-new payee (creating it refreshes the payee list)
    await dialog.getByRole('textbox', { name: 'Payee' }).fill('Iron Temple Gym');
    await dialog.getByRole('button', { name: /Create new merchant/ }).click();
    await expect(dialog.getByRole('textbox', { name: 'Payee' })).toHaveValue('Iron Temple Gym');
    await expect(name).toHaveValue('Gym membership');
    await expect(account).toHaveValue(/.+/);
    await expect(account.locator('option:checked')).toHaveText('Savings');

    // A brand-new category: none of its buttons may submit the form
    await dialog.getByRole('button', { name: /^Category:/ }).click();
    await dialog.getByRole('button', { name: 'Create new category' }).click();
    await dialog.getByRole('textbox', { name: 'New category name' }).fill('Fitness');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Category: Fitness' })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('Gym membership');
    await expect(account.locator('option:checked')).toHaveText('Savings');
    await expect(dialog.getByRole('textbox', { name: 'Payee' })).toHaveValue('Iron Temple Gym');

    await dialog.getByRole('button', { name: 'Add Recurring' }).click();
    await expect(dialog).toBeHidden();
    const [schedule] = await api.call<any[]>('GET', '/schedules');
    expect(schedule).toMatchObject({ name: 'Gym membership', amount: -4_500 });
  });

  test('marking a bill paid records the transaction', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 500_000);
    await createRent(api, checking.id);
    await openAll(page);
    await scheduleRow(page, 'Rent').first().getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Mark next as paid' }).click();

    await expect.poll(() => api.balance(checking.id)).toBe(350_000);
    const [paid] = await api.transactions(`?account_id=${checking.id}&from=2000-01-01`);
    expect(paid).toMatchObject({ amount: -150_000, payeeName: 'Rent', date: isoDay(2) });
  });

  test('pausing keeps the schedule settings', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 0);
    await createRent(api, checking.id, {
      amountType: 'approximate',
      weekendAdjust: 'before',
      dateFlexibility: 6,
      autoCreate: 1,
    });
    await openAll(page);
    await scheduleRow(page, 'Rent').first().getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Pause' }).click();

    await expect
      .poll(async () => (await api.call<any[]>('GET', '/schedules'))[0])
      .toMatchObject({
        status: 'paused',
        amountType: 'approximate',
        weekendAdjust: 'before',
        dateFlexibility: 6,
        autoCreate: 1,
      });
    await scheduleRow(page, 'Rent').first().getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Resume' })).toBeVisible();
  });

  test('cancelling hides a schedule behind "Show canceled"', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 0);
    await createRent(api, checking.id);
    await openAll(page);
    await scheduleRow(page, 'Rent').first().getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Cancel recurring' }).click();
    await page
      .getByRole('dialog', { name: 'Cancel recurring item?' })
      .getByRole('button', { name: 'Cancel item' })
      .click();
    await expect
      .poll(async () => (await api.call<any[]>('GET', '/schedules'))[0].status)
      .toBe('canceled');
    await expect(page.getByText(/Show \d+ canceled|Show canceled/)).toBeVisible();
  });

  test('"Find recurring" discovers a subscription from past transactions', async ({
    page,
    api,
  }) => {
    const checking = await api.createAccount('Checking', 500_000);
    // Four monthly charges on the 5th
    const now = new Date();
    for (let i = 4; i >= 1; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 5);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-05`;
      await api.createTransaction({
        accountId: checking.id,
        date,
        amount: -1_299,
        payeeName: 'MusicBox',
      });
    }
    await open(page, '/recurring');
    await page.getByRole('main').getByRole('button', { name: 'Find recurring' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Search for recurring transactions' });
    await expect(dialog).toContainText('Every month on the 5th');
    await dialog.getByRole('checkbox', { name: 'Track MusicBox' }).press('Space');
    await expect(dialog.getByRole('checkbox', { name: 'Track MusicBox' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Create 1 recurring' }).click();

    await expect
      .poll(async () => (await api.call<any[]>('GET', '/schedules')).map((s) => s.name))
      .toEqual(['MusicBox']);
    const [schedule] = await api.call<any[]>('GET', '/schedules');
    expect(schedule).toMatchObject({
      recurrenceType: 'monthly',
      amount: -1_299,
      source: 'detected',
    });
  });
});
