import type { Page } from '@playwright/test';
import { test, expect, open, isoDay } from './fixtures';

// Settings: managing categories and groups, and preferences.

async function pickEmoji(page: Page, name: string) {
  const picker = page.locator('aside.EmojiPickerReact');
  await picker.getByRole('textbox', { name: 'Type to search for an emoji' }).fill(name);
  await picker.getByRole('button', { name, exact: true }).click();
  await expect(picker).toBeHidden();
}

test.describe('categories', () => {
  test.beforeEach(async ({ api, page }) => {
    await api.createAccount('Checking', 0);
    await open(page, '/settings');
  });

  test('creates a group and a category in it', async ({ page, api }) => {
    // The second "Create group" is in the Expenses section
    await page.getByRole('button', { name: 'Create group' }).nth(1).click();
    await page.getByPlaceholder('Group name...').fill('Pets');
    await page.getByRole('button', { name: 'Add group' }).click();
    await expect(page.getByText('Pets', { exact: true })).toBeVisible();

    // New groups go last, so its "Create Category" is the last one
    await page.getByRole('button', { name: 'Create Category' }).last().click();
    await page.getByPlaceholder('Category name...').fill('Vet Bills');
    await page.getByPlaceholder('Category name...').press('Enter');
    await expect(page.getByRole('button', { name: 'Edit Vet Bills' })).toBeVisible();

    const pets = (await api.categoryGroups()).find((g) => g.name === 'Pets')!;
    expect(pets).toMatchObject({ isIncome: 0 });
    expect(pets.categories.map((c) => c.name)).toEqual(['Vet Bills']);
  });

  test('the emoji picker shows its emojis and fits on screen', async ({ page }) => {
    // The last group's form is at the bottom of its card, which hides what overflows it
    await page.getByRole('button', { name: 'Create Category' }).last().click();
    await page.getByRole('button', { name: 'Pick icon' }).click();

    const picker = page.locator('aside.EmojiPickerReact');
    await expect(picker.getByRole('button', { name: 'grinning face', exact: true })).toBeVisible();
    await expect(picker.locator('img')).toHaveCount(0); // the CSP blocks the default CDN images
    await expect(picker).toBeInViewport({ ratio: 1 });
  });

  test('picks an icon for a new category', async ({ page, api }) => {
    await page.getByRole('button', { name: 'Create Category' }).last().click();
    await page.getByPlaceholder('Category name...').fill('Dog Walker');
    await page.getByRole('button', { name: 'Pick icon' }).click();
    await pickEmoji(page, 'dog face');
    await expect(page.getByRole('button', { name: 'Pick icon' })).toHaveText('🐶');

    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByRole('button', { name: 'Edit Dog Walker' })).toBeVisible();
    await expect.poll(async () => (await api.category('Dog Walker'))?.icon).toBe('🐶');
  });

  test('changes a category icon in the edit dialog', async ({ page, api }) => {
    await page.getByRole('button', { name: 'Edit Parking' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Category' });
    await dialog.getByRole('button', { name: 'Change icon' }).click();
    await pickEmoji(page, 'dog face');
    await expect(dialog.getByRole('button', { name: 'Change icon' })).toHaveText('🐶');

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await api.category('Parking'))?.icon).toBe('🐶');
  });

  test('renames a category from the keyboard', async ({ page, api }) => {
    await page.getByRole('button', { name: 'Edit Parking' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Edit Category' });
    await dialog.getByRole('textbox', { name: 'Category name' }).fill('Parking & Tolls');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit Parking & Tolls' })).toBeVisible();
    await expect.poll(() => api.category('Parking & Tolls')).toBeTruthy();
  });

  test('deleting a used category moves its transactions first', async ({ page, api }) => {
    const [checking] = await api.accounts();
    const parking = await api.category('Parking');
    const transit = await api.category('Public Transit');
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -1_200,
      payeeName: 'City Garage',
      categoryId: parking.id,
    });

    await page.getByRole('button', { name: 'Edit Parking' }).click();
    await page
      .getByRole('dialog', { name: 'Edit Category' })
      .getByRole('button', { name: 'Delete' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Delete Category' });
    await expect(dialog).toContainText('Parking has 1 transaction');
    await expect(dialog.getByRole('button', { name: 'Reassign & Delete' })).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Move transactions to' }).selectOption(transit.id);
    await dialog.getByRole('button', { name: 'Reassign & Delete' }).click();

    await expect(page.getByRole('button', { name: 'Edit Parking' })).toBeHidden();
    const [tx] = await api.transactions();
    expect(tx.categoryId).toBe(transit.id);
  });
});

test.describe('preferences', () => {
  test('persist across reloads', async ({ page, api }) => {
    await api.createAccount('Checking', 123_456);
    await open(page, '/settings');
    await page.getByRole('button', { name: 'Preferences' }).click();
    // The dark theme is applied to the page and remembered
    await page.getByRole('main').getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});

test.describe('goals', () => {
  test('adds a savings goal and shows its progress', async ({ page, api }) => {
    const savings = await api.createAccount('Savings', 0, 'savings');
    await open(page, '/goals');
    await page.getByRole('main').getByRole('button', { name: 'Add Goal' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Add Goal' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Emergency Fund');
    await dialog.getByRole('textbox', { name: 'Target', exact: true }).fill('10000');
    await dialog.getByRole('textbox', { name: 'Saved so far' }).fill('2500');
    await dialog
      .getByRole('combobox', { name: 'Linked account' })
      .selectOption({ label: 'Savings' });
    await dialog.getByRole('button', { name: '🛡️' }).click();
    await expect(dialog.getByRole('button', { name: '🛡️' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByRole('button', { name: 'Color #059669' }).click();
    await dialog.getByRole('button', { name: 'Add Goal' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('main')).toContainText('Emergency Fund');
    await expect(page.getByRole('main')).toContainText('25%');
    const [goal] = await api.call<any[]>('GET', '/goals');
    expect(goal).toMatchObject({
      name: 'Emergency Fund',
      targetAmount: 1_000_000,
      currentAmount: 250_000,
      accountId: savings.id,
      icon: '🛡️',
      color: '#059669',
    });
  });
});

test('settings link to the license and the source code', async ({ page, api }) => {
  await api.createAccount('Checking');
  await open(page, '/settings');
  await expect(page.getByRole('link', { name: 'GNU AGPL v3' })).toHaveAttribute(
    'href',
    'https://www.gnu.org/licenses/agpl-3.0.html',
  );
  const source = page.getByRole('link', { name: 'Source code' });
  await expect(source).toHaveAttribute('href', 'https://github.com/dtymoszenko/FlyBudget');
  // Opens outside the app (the desktop app hands https links to the system browser)
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(source).toHaveAttribute('rel', /noopener/);
});
