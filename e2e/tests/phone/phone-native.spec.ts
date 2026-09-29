import type { Locator, Page } from '@playwright/test';
import { test, expect, open, isoDay, thisMonth, type Api } from '../fixtures';

// Phone-native layouts (390×844, the "phone" project): the register, budget, payees and
// rules as cards, dialogs as bottom sheets, transaction details full screen, and touch
// targets of at least 44px.

const TOUCH = 44;

/** Width and height of the element's box, rounded (sub-pixel layout gives 43.99…) */
async function size(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

async function expectTouchSize(locator: Locator) {
  const { width, height } = await size(locator);
  expect(width, `${locator} width`).toBeGreaterThanOrEqual(TOUCH);
  expect(height, `${locator} height`).toBeGreaterThanOrEqual(TOUCH);
}

/** A sheet sits on the bottom edge and spans the screen (once it has slid up) */
async function expectBottomSheet(page: Page, dialog: Locator) {
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = (await dialog.boundingBox())!;
      return { width: Math.round(box.width), bottom: Math.round(box.y + box.height) };
    })
    .toEqual({ width: viewport.width, bottom: viewport.height });
}

async function seedAccount(api: Api) {
  const checking = await api.createAccount('Everyday Checking', 100_000);
  const groceries = await api.category('Groceries');
  await api.createTransaction({
    accountId: checking.id,
    date: isoDay(),
    amount: -4_250,
    payeeName: 'Corner Grocery',
    categoryId: groceries.id,
  });
  await api.createTransaction({
    accountId: checking.id,
    date: isoDay(-1),
    amount: -1_999,
    payeeName: 'Streamflix',
    notes: 'family plan',
  });
  return { checking, groceries };
}

test.describe('register', () => {
  test('shows each transaction as a card and edits it in a full-screen sheet', async ({
    page,
    api,
  }) => {
    const { checking } = await seedAccount(api);
    await open(page, `/accounts/${checking.id}`);

    const card = page.getByTestId('transaction-card').filter({ hasText: 'Streamflix' });
    await expect(card).toContainText('Uncategorized');
    await expect(card).toContainText('family plan');
    await expect(card).toContainText('$19.99');
    // No desktop hover controls on a phone
    await expect(page.getByTestId('transaction-row')).toHaveCount(0);
    await expectTouchSize(card);

    await card.click();
    const details = page.getByRole('complementary', { name: 'Transaction details' });
    await expect(details).toBeVisible();
    const box = (await details.boundingBox())!;
    expect(Math.round(box.width)).toBe(page.viewportSize()!.width);
    await expectTouchSize(details.getByRole('button', { name: 'Close details' }));

    await details.getByRole('button', { name: 'Uncategorized' }).click();
    await page.getByPlaceholder('Search categories...').fill('stream');
    await page.getByRole('button', { name: /Streaming Services/ }).click();
    const streaming = await api.category('Streaming Services');
    await expect
      .poll(async () => (await api.transactions(`?account_id=${checking.id}`))[1].categoryId)
      .toBe(streaming.id);

    await details.getByRole('button', { name: 'Close details' }).click();
    await expect(details).toBeHidden();
    await expect(card).toContainText('Streaming Services');
  });

  test('adds a split transaction from a bottom sheet', async ({ page, api }) => {
    const { checking } = await seedAccount(api);
    await open(page, `/accounts/${checking.id}`);
    await page.getByRole('button', { name: 'Add Transaction' }).click();

    const sheet = page.getByRole('dialog', { name: 'New transaction' });
    await expect(sheet).toBeVisible();
    await expectBottomSheet(page, sheet);
    const form = sheet.getByRole('form', { name: 'New transaction' });
    // 16px text, so iOS doesn't zoom in when a field is focused
    const fontSize = await form
      .getByRole('textbox', { name: 'Payee' })
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);

    await form.getByRole('textbox', { name: 'Payee' }).fill('Big Box Store');
    await form.getByRole('spinbutton', { name: 'Outflow' }).fill('100');
    await form.getByRole('button', { name: 'Split transaction' }).click();
    await form
      .getByRole('combobox', { name: 'Split 1 category' })
      .selectOption({ label: '🛒 Groceries' });
    await form.getByRole('spinbutton', { name: 'Split 1 amount' }).fill('60');
    await form.getByRole('spinbutton', { name: 'Split 2 amount' }).fill('40');
    await expect(form.getByText('Balanced')).toBeVisible();
    for (const name of ['Save', 'Split transaction', 'Cancel']) {
      await expectTouchSize(form.getByRole('button', { name, exact: true }));
    }
    await form.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(sheet).toBeHidden();
    await expect(
      page.getByTestId('transaction-card').filter({ hasText: 'Big Box Store' }),
    ).toContainText('Split (2)');
    // $1,000 − $42.50 − $19.99 − $100: the split counts once
    await expect.poll(() => api.balance(checking.id)).toBe(100_000 - 4_250 - 1_999 - 10_000);
  });
});

test.describe('budget', () => {
  test('shows categories as cards and plans an amount in a sheet', async ({ page, api }) => {
    const { groceries } = await seedAccount(api);
    await api.call('PUT', `/budget/${thisMonth()}/${groceries.id}`, { budgeted: 50_000 });
    await open(page, '/budget');

    const card = page.getByTestId('budget-card').filter({ hasText: 'Groceries' });
    await expect(card).toContainText('$457.50 remaining');
    await expect(card).toContainText('$42.50');
    await expect(page.getByRole('table')).toHaveCount(0);
    await expectTouchSize(page.getByRole('button', { name: 'Previous month' }));
    await expectTouchSize(page.getByRole('button', { name: 'Next month' }));

    const planned = card.getByRole('button', { name: 'Planned for Groceries: $500' });
    await expectTouchSize(planned);
    await planned.click();
    const sheet = page.getByRole('dialog', { name: 'Plan Groceries' });
    await expectBottomSheet(page, sheet);
    await sheet.getByRole('spinbutton', { name: 'Planned for Groceries' }).fill('425');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toBeHidden();
    await expect(card).toContainText('$382.50 remaining');

    // Enter saves too, and the amount can be used for the next 12 months
    await card.getByRole('button', { name: /^Planned for Groceries/ }).click();
    await sheet.getByRole('checkbox', { name: 'Use this amount for the next 12 months' }).check();
    const input = sheet.getByRole('spinbutton', { name: 'Planned for Groceries' });
    await input.fill('300');
    await input.press('Enter');
    await expect(sheet).toBeHidden();
    const [y, m] = thisMonth().split('-').map(Number);
    const later = new Date(y, m - 1 + 5, 1);
    const laterMonth = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}`;
    await expect
      .poll(async () => {
        const budget = await api.call<any[]>('GET', `/budget/${laterMonth}`);
        return budget.flatMap((g) => g.categories).find((c) => c.id === groceries.id).budgeted;
      })
      .toBe(30_000);
  });

  test('inactive categories are tucked away until asked for', async ({ page, api }) => {
    await seedAccount(api);
    await open(page, '/budget');
    const fixed = page.getByRole('region', { name: 'Fixed' });
    await expect(fixed.getByTestId('budget-card')).toHaveCount(0);
    await fixed.getByRole('button', { name: /^Show \d+ inactive categories$/ }).click();
    await expect(fixed.getByTestId('budget-card').first()).toBeVisible();
  });
});

test.describe('payees', () => {
  test('uses cards with a menu instead of hover and double-click', async ({ page, api }) => {
    await seedAccount(api);
    await open(page, '/payees');
    const cards = page.getByTestId('payee-card');
    await expect(cards).toHaveCount(2);

    // Rename from the menu
    const menu = page.getByRole('button', { name: 'Actions for Streamflix' });
    await expectTouchSize(menu);
    await menu.click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const input = page.getByRole('textbox', { name: 'Rename Streamflix' });
    await input.fill('Streamflix Premium');
    await input.press('Enter');
    await expect(cards.filter({ hasText: 'Streamflix Premium' })).toBeVisible();

    // Default category
    const groceries = await api.category('Groceries');
    await page
      .getByRole('combobox', { name: 'Default category for Corner Grocery' })
      .selectOption(groceries.id);
    await expect
      .poll(async () =>
        (await api.call<any[]>('GET', '/payees')).find((p) => p.name === 'Corner Grocery'),
      )
      .toMatchObject({ defaultCategoryId: groceries.id });

    // Merge two
    await page.getByRole('checkbox', { name: 'Select Corner Grocery' }).check();
    await page.getByRole('checkbox', { name: 'Select Streamflix Premium' }).check();
    await page.getByRole('button', { name: 'Merge 2 payees' }).click();
    const merge = page.getByRole('dialog', { name: 'Merge Payees' });
    await expectBottomSheet(page, merge);
    await merge.getByRole('radio', { name: /Corner Grocery/ }).check();
    await merge.getByRole('button', { name: 'Merge' }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('2 transactions');

    // Delete from the menu
    await page.getByRole('button', { name: 'Actions for Corner Grocery' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete Payee' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(cards).toHaveCount(0);
  });
});

test.describe('rules', () => {
  test('toggles, reorders and deletes from the card', async ({ page, api }) => {
    await api.createAccount('Checking');
    const common = { actions: [{ type: 'set_notes', value: 'x' }] };
    const first = await api.call('POST', '/rules', {
      ...common,
      conditions: [{ field: 'payee_name', op: 'contains', value: 'first' }],
      sortOrder: 0,
    });
    const second = await api.call('POST', '/rules', {
      ...common,
      conditions: [{ field: 'payee_name', op: 'contains', value: 'second' }],
      sortOrder: 1,
    });
    await open(page, '/rules');

    // No drag handles on a phone; the switch has a full-size tap area
    await expect(page.getByRole('button', { name: 'Drag to reorder' })).toHaveCount(0);
    const toggle = page.getByRole('switch', { name: 'Disable rule' }).first();
    await expectTouchSize(toggle);
    await toggle.click();
    await expect.poll(async () => (await api.call<any[]>('GET', '/rules'))[0].enabled).toBe(false);

    // The first rule can only move down, the last only up
    const menus = page.getByRole('button', { name: 'Rule actions' });
    await menus.first().click();
    await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await expect
      .poll(async () => (await api.call<any[]>('GET', '/rules')).map((r) => r.id))
      .toEqual([second.id, first.id]);

    await menus.first().click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete rule' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect
      .poll(async () => (await api.call<any[]>('GET', '/rules')).map((r) => r.id))
      .toEqual([first.id]);
  });
});

test.describe('dialogs and touch targets', () => {
  test('dialogs open as bottom sheets with a full-size close button', async ({ page, api }) => {
    await api.createAccount('Checking');
    await open(page, '/accounts');
    await page.getByRole('main').getByRole('button', { name: 'Add Account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Account' });
    await expectBottomSheet(page, dialog);
    await expectTouchSize(dialog.getByRole('button', { name: 'Close' }));
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('primary controls are at least 44px', async ({ page, api }) => {
    const { checking } = await seedAccount(api);
    await open(page, `/accounts/${checking.id}`);
    const menu = page.getByRole('button', { name: 'Open menu' });
    await expectTouchSize(menu);
    for (const name of ['Add Transaction', 'Import CSV', 'This Month', 'All Time']) {
      await expectTouchSize(page.getByRole('button', { name, exact: true }));
    }
    await menu.click();
    const nav = page.getByRole('complementary');
    await expectTouchSize(page.getByRole('button', { name: 'Close menu' }));
    for (const name of ['Dashboard', 'Budget', 'Settings']) {
      const { height } = await size(nav.getByRole('link', { name, exact: true }));
      expect(height, name).toBeGreaterThanOrEqual(TOUCH);
    }
  });
});

test('report summary figures fit their card', async ({ page, api }) => {
  await seedAccount(api);
  await open(page, '/reports');
  await expect(page.getByText('Total Expenses')).toBeVisible();
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('main p')]
      .filter((p) => /^-?\$[\d,.]+$/.test(p.textContent ?? ''))
      .filter((p) => p.scrollWidth > p.clientWidth + 1)
      .map((p) => p.textContent),
  );
  expect(clipped).toEqual([]);
});
