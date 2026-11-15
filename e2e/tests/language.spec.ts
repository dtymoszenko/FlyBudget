import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';
import { test, expect, open } from './fixtures';

// FlyBudget in Dutch: Automatic picks it on a Dutch device, older installs stay English, and the
// Language setting switches at once. Texts come from the translation files, so rewording a
// translation doesn't break these tests.

const locales = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../client/src/i18n/locales',
);
const read = (code: string) =>
  JSON.parse(fs.readFileSync(path.join(locales, `${code}.json`), 'utf8'));
const en = read('en');
const nl = read('nl');
const automatic = (texts: typeof en, language: string) =>
  texts.settings.preferences.language.automatic.replace('{{language}}', language);

/** Preferences as an earlier version of FlyBudget saved them */
async function savedPreferences(page: Page, state: object, version: number) {
  await page.addInitScript(
    ([saved]) => {
      if (!localStorage.getItem('budget-preferences'))
        localStorage.setItem('budget-preferences', saved);
    },
    [JSON.stringify({ state, version })],
  );
}

const languageSelect = (page: Page, texts: typeof en) =>
  page.getByRole('combobox', { name: texts.settings.preferences.language.title });

test.describe('on a Dutch device', () => {
  test.use({ locale: 'nl-NL' });

  test('a new install is in Dutch', async ({ page, api }) => {
    await api.createAccount('Betaalrekening');
    await open(page, '/settings?tab=preferences');
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
    await expect(page.getByRole('heading', { name: nl.settings.title, exact: true })).toBeVisible();
    const language = languageSelect(page, nl);
    await expect(language).toHaveValue('auto');
    await expect(language.getByRole('option')).toHaveText([
      automatic(nl, 'Nederlands'),
      'English',
      'Nederlands',
    ]);
  });

  test('an install from before the language setting stays English', async ({ page, api }) => {
    await api.createAccount('Betaalrekening');
    await savedPreferences(page, { setupSkipped: true }, 1);
    await open(page, '/settings?tab=preferences');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(languageSelect(page, en)).toHaveValue('en');
  });

  test('an install from before the amount format stays English too', async ({ page, api }) => {
    await api.createAccount('Betaalrekening');
    await savedPreferences(page, { currencySymbol: '$', setupSkipped: true }, 0);
    await open(page, '/settings?tab=preferences');
    await expect(languageSelect(page, en)).toHaveValue('en');
  });

  test('choosing a language switches at once and is remembered', async ({ page, api }) => {
    const account = await api.createAccount('Betaalrekening', 123_456);
    await savedPreferences(page, { setupSkipped: true }, 1);
    await open(page, `/accounts/${account.id}`);
    // Amounts keep their own format whatever the language
    const amounts = await page.getByRole('main').innerText();
    const balance = amounts.match(/[^\s]*1[.,]?234[.,]56[^\s]*/)?.[0];
    expect(balance).toBeTruthy();

    await open(page, '/settings?tab=preferences');
    await languageSelect(page, en).selectOption('nl');
    await expect(page.getByRole('heading', { name: nl.settings.title, exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
    // The select keeps focus after the app is drawn again in the new language
    await expect(languageSelect(page, nl)).toBeFocused();

    await page.reload();
    await expect(languageSelect(page, nl)).toHaveValue('nl');
    await open(page, `/accounts/${account.id}`);
    await expect(page.getByRole('main')).toContainText(balance!);

    await open(page, '/settings?tab=preferences');
    await languageSelect(page, nl).selectOption('auto');
    await expect(page.getByRole('heading', { name: nl.settings.title, exact: true })).toBeVisible();
  });
});
