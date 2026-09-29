import type { Page, TestInfo } from '@playwright/test';
import { test, expect, open, isoDay, thisMonth } from '../fixtures';

// FlyBudget on a phone-sized screen (390×844, the "phone" project in
// playwright.config.ts). Every page is visited with realistic data, a screenshot is
// saved (test-results/…/phone-*.png, uploaded by CI), and nothing may make the page
// scroll sideways: neither the document nor the main content area.

/**
 * What doesn't fit sideways: the document, and every scrolling area of the page (a page
 * that scrolls up and down must not also scroll sideways), plus content that sticks out
 * past the right edge. Strips that scroll only sideways on purpose (tabs, wide tables in
 * an `overflow-x-auto` box) are fine.
 */
async function sidewaysOverflow(page: Page) {
  return page.evaluate(() => {
    // The page's own scrolling areas (main, and anything else that scrolls up and down)
    const scrollsDown = (el: Element) =>
      /auto|scroll/.test(getComputedStyle(el).overflowY) &&
      (el.tagName === 'MAIN' || el.scrollHeight > el.clientHeight + 2);
    const sidewaysOnly = (el: Element) =>
      /auto|scroll/.test(getComputedStyle(el).overflowX) && !scrollsDown(el);
    const name = (el: Element) =>
      `<${el.tagName.toLowerCase()}> "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`;
    const problems: string[] = [];
    const extra = document.documentElement.scrollWidth - window.innerWidth;
    if (extra > 0) problems.push(`document +${extra}px`);
    for (const el of document.querySelectorAll('body *')) {
      if (scrollsDown(el) && el.scrollWidth > el.clientWidth + 1) {
        problems.push(`${name(el)} scrolls sideways +${el.scrollWidth - el.clientWidth}px`);
      }
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.right <= window.innerWidth + 1) continue;
      let parent = el.parentElement;
      while (parent && !sidewaysOnly(parent)) parent = parent.parentElement;
      if (!parent) problems.push(`${name(el)} ends at ${Math.round(box.right)}px`);
    }
    return problems.slice(0, 4);
  });
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`phone-${name}.png`), fullPage: true });
}

test('every page fits a phone screen', async ({ page, api }, testInfo) => {
  test.setTimeout(120_000);
  const checking = await api.createAccount('Everyday Checking', 250_000);
  await api.createAccount('Rainy Day Savings', 1_000_000, 'savings');
  const groceries = await api.category('Groceries');
  for (const [i, payee] of ['Corner Grocery', 'Coffee Corner', 'City Power & Light'].entries()) {
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(-i),
      amount: -(4_250 + i * 1_000),
      payeeName: payee,
      categoryId: i === 0 ? groceries.id : null,
      notes: i === 2 ? 'Monthly electricity bill with a fairly long note' : undefined,
    });
  }
  await api.call('PUT', `/budget/${thisMonth()}/${groceries.id}`, { budgeted: 50_000 });
  await api.call('POST', '/schedules', {
    name: 'Rent',
    amount: -150_000,
    recurrenceType: 'monthly',
    startDate: isoDay(2),
    accountId: checking.id,
  });
  await api.call('POST', '/rules', {
    conditions: [{ field: 'payee_name', op: 'contains', value: 'grocery' }],
    actions: [{ type: 'set_category', value: groceries.id }],
  });
  await api.call('POST', '/goals', { name: 'Vacation', targetAmount: 200_000 });

  const routes: [string, string][] = [
    ['dashboard', '/dashboard'],
    ['accounts', '/accounts'],
    ['account', `/accounts/${checking.id}`],
    ['reconcile', `/accounts/${checking.id}/reconcile`],
    ['transactions', '/transactions'],
    ['budget', '/budget'],
    ['budget-category', `/budget/category/${groceries.id}`],
    ['recurring', '/recurring'],
    ['reports', '/reports'],
    ['custom-report', '/reports/custom'],
    ['cash-flow', '/cash-flow'],
    ['goals', '/goals'],
    ['payees', '/payees'],
    ['rules', '/rules'],
    ['settings', '/settings'],
  ];

  const problems: string[] = [];
  for (const [name, route] of routes) {
    await open(page, route);
    await expect(page.getByRole('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await screenshot(page, testInfo, name);
    const overflow = await sidewaysOverflow(page);
    if (overflow.length) problems.push(`${route}: ${overflow.join('; ')}`);
  }
  expect(problems, 'pages that scroll sideways on a phone').toEqual([]);
});

test('the welcome screen fits a phone screen', async ({ page }, testInfo) => {
  await open(page, '/dashboard');
  await expect(page.getByRole('heading', { name: 'Welcome to FlyBudget' })).toBeVisible();
  await screenshot(page, testInfo, 'welcome');
  expect(await sidewaysOverflow(page)).toEqual([]);
});

test('the sidebar is a drawer behind a menu button', async ({ page, api }) => {
  await api.createAccount('Everyday Checking', 150_000);
  await open(page, '/dashboard');

  // The page gets the full width; the navigation is hidden until asked for
  const menu = page.getByRole('button', { name: 'Open menu' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('link', { name: 'Budget', exact: true })).toBeHidden();
  const mainBox = await page.getByRole('main').boundingBox();
  expect(mainBox!.width).toBeGreaterThanOrEqual(389);

  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  const nav = page.getByRole('complementary');
  await expect(nav.getByRole('link', { name: 'Budget', exact: true })).toBeVisible();
  // Focus moves into the drawer
  await expect(nav.locator(':focus')).toHaveCount(1);

  // Escape closes it and puts focus back on the menu button
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await expect(page.getByRole('link', { name: 'Budget', exact: true })).toBeHidden();

  // Following a link closes it
  await menu.click();
  await nav.getByRole('link', { name: 'Budget', exact: true }).click();
  await expect(page).toHaveURL(/#\/budget$/);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('status', { name: 'To be budgeted' })).toBeVisible();

  // So does the close button
  await menu.click();
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
});

test('adding a transaction works on a phone', async ({ page, api }) => {
  const account = await api.createAccount('Everyday Checking', 150_000);
  await open(page, `/accounts/${account.id}`);
  await page.getByRole('button', { name: 'Add Transaction' }).click();
  const form = page.getByRole('form', { name: 'New transaction' });
  await form.getByRole('textbox', { name: 'Payee' }).fill('Corner Grocery');
  await form.getByRole('spinbutton', { name: 'Outflow' }).fill('12.34');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Corner Grocery', exact: true })).toBeVisible();
  await expect.poll(() => api.balance(account.id)).toBe(150_000 - 1_234);
});
