import type { Page } from '@playwright/test';
import { test, expect, open, isoDay, type Api } from './fixtures';

// Rules: build one in the editor, preview and apply it to existing transactions, and
// check it runs on new ones.

async function seedCoffee(api: Api) {
  const checking = await api.createAccount('Checking', 100_000);
  for (const [day, amount] of [
    [-1, -450],
    [-2, -525],
    [-3, -610],
  ]) {
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(day),
      amount,
      payeeName: `Blue Bottle Coffee #${-day}`,
    });
  }
  await api.createTransaction({
    accountId: checking.id,
    date: isoDay(-1),
    amount: -9_900,
    payeeName: 'Hardware Store',
  });
  return checking;
}

async function buildCoffeeRule(page: Page, expectedMatches: number) {
  await page.getByRole('main').getByRole('button', { name: 'Add rule' }).click();
  const dialog = page.getByRole('dialog', { name: 'New rule' });
  await dialog.getByRole('combobox', { name: 'Field' }).selectOption({ label: 'Payee name' });
  await dialog.getByRole('combobox', { name: 'Operator' }).selectOption({ label: 'contains' });
  await dialog.getByRole('textbox', { name: 'Text…' }).fill('coffee');
  // Live preview of what the conditions match
  await expect(dialog).toContainText(
    expectedMatches
      ? new RegExp(`${expectedMatches} (matching )?transactions?`)
      : 'No transactions match yet',
  );
  await dialog.getByRole('button', { name: 'Choose a category…' }).click();
  await page.getByPlaceholder('Search categories...').fill('coffee');
  await page.getByRole('button', { name: /Coffee Shops/ }).click();
  return dialog;
}

test.describe('rules', () => {
  test('a new rule can be applied to existing transactions', async ({ page, api }) => {
    await seedCoffee(api);
    await open(page, '/rules');
    const dialog = await buildCoffeeRule(page, 3);
    await dialog
      .getByRole('checkbox', { name: 'Apply to existing transactions after saving' })
      .check();
    await dialog.getByRole('button', { name: 'Save rule' }).click();

    const apply = page.getByRole('dialog', { name: 'Apply rule to existing transactions' });
    await expect(apply.getByRole('checkbox', { name: 'Include this transaction' })).toHaveCount(3);
    // Leave one out
    await apply.getByRole('checkbox', { name: 'Include this transaction' }).first().uncheck();
    await apply.getByRole('button', { name: 'Apply to 2 transactions' }).click();
    await expect(apply).toContainText('Updated 2 transactions');
    await apply.getByRole('button', { name: 'Done' }).click();

    const coffee = (await api.category('Coffee Shops')).id;
    const txs = await api.transactions();
    const categorized = txs.filter((t) => t.categoryId === coffee).map((t) => t.payeeName);
    expect(categorized).toHaveLength(2);
    expect(categorized.every((n: string) => n.includes('Coffee'))).toBe(true);
    expect(txs.find((t) => t.payeeName === 'Hardware Store').categoryId).toBeNull();
  });

  test('rules run on transactions entered by hand', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 100_000);
    await open(page, '/rules');
    const dialog = await buildCoffeeRule(page, 0);
    await dialog.getByRole('button', { name: 'Save rule' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('main')).toContainText('Coffee Shops');

    await open(page, `/accounts/${checking.id}`);
    await page.getByRole('button', { name: 'Add Transaction' }).click();
    const form = page.getByRole('form', { name: 'New transaction' });
    await form.getByRole('textbox', { name: 'Payee' }).fill('Corner Coffee Co');
    await form.getByRole('spinbutton', { name: 'Outflow' }).fill('3.75');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByTestId('transaction-row').filter({ hasText: 'Corner Coffee Co' }),
    ).toContainText('Coffee Shops');
  });

  test('turning a rule off keeps its settings and position', async ({ page, api }) => {
    await api.createAccount('Checking');
    const common = { actions: [{ type: 'set_notes', value: 'x' }] };
    await api.call('POST', '/rules', {
      ...common,
      conditions: [{ field: 'payee_name', op: 'contains', value: 'first' }],
      sortOrder: 0,
    });
    const second = await api.call('POST', '/rules', {
      ...common,
      conditionsOp: 'or',
      conditions: [
        { field: 'payee_name', op: 'contains', value: 'a' },
        { field: 'notes', op: 'contains', value: 'b' },
      ],
      sortOrder: 1,
    });

    await open(page, '/rules');
    await page.getByRole('switch', { name: 'Disable rule' }).nth(1).click();
    await expect(page.getByRole('switch', { name: 'Enable rule' })).not.toBeChecked();

    const rules = await api.call<any[]>('GET', '/rules');
    expect(rules.map((r) => r.id)).toEqual([expect.any(String), second.id]);
    expect(rules[1]).toMatchObject({ enabled: false, conditionsOp: 'or', sortOrder: 1 });
  });

  test('deletes a rule', async ({ page, api }) => {
    await api.createAccount('Checking');
    await api.call('POST', '/rules', {
      conditions: [{ field: 'payee_name', op: 'is', value: 'Gym' }],
      actions: [{ type: 'set_notes', value: 'fitness' }],
    });
    await open(page, '/rules');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete rule' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByRole('button', { name: 'Add your first rule' })).toBeVisible();
    expect(await api.call('GET', '/rules')).toEqual([]);
  });
});
