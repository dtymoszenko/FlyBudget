import fs from 'fs';
import {
  test as base,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';

// Fixtures for the desktop-app suite.
//
// - Every test starts from the fresh database snapshot taken in global-setup.ts
//   (restored through the app's own backup restore), so tests don't affect each other.
// - Pages are set up like the Electron window: the preload's __API_BASE__ (which also
//   switches the app to hash routing) and the per-launch API token cookie.
// - `api` seeds data through the HTTP API with the same token.
// - A test fails if the page throws or logs a console error.

const token = () => process.env.E2E_API_TOKEN!;

export type Account = { id: string; name: string; balance: number; startingBalance: number };
export type Category = { id: string; name: string; groupId: string };
export type CategoryGroup = { id: string; name: string; isIncome: number; categories: Category[] };

export class Api {
  constructor(readonly request: APIRequestContext) {}

  async call<T = any>(method: string, path: string, data?: unknown): Promise<T> {
    const res = await this.request.fetch(`/api${path}`, { method, data });
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${await res.text()}`);
    return (res.status() === 204 ? null : await res.json()) as T;
  }

  createAccount(name: string, startingBalance = 0, type = 'checking', extra: object = {}) {
    return this.call<Account>('POST', '/accounts', { name, type, startingBalance, ...extra });
  }

  createTransaction(data: {
    accountId: string;
    date: string;
    amount: number;
    payeeName?: string;
    categoryId?: string | null;
    notes?: string;
    splits?: { categoryId: string | null; amount: number }[];
  }) {
    return this.call('POST', '/transactions', data);
  }

  async accounts() {
    return this.call<Account[]>('GET', '/accounts');
  }

  async balance(accountId: string) {
    return (await this.accounts()).find((a) => a.id === accountId)!.balance;
  }

  async categoryGroups() {
    return this.call<CategoryGroup[]>('GET', '/categories');
  }

  /** A category from the default set, by name */
  async category(name: string) {
    for (const g of await this.categoryGroups()) {
      const c = g.categories.find((c) => c.name === name);
      if (c) return c;
    }
    throw new Error(`No category named ${name}`);
  }

  transactions(query = '') {
    return this.call<any[]>('GET', `/transactions${query}`);
  }
}

/** Opens an app route (hash routing, like the desktop app) */
export async function open(page: Page, route: string) {
  await page.goto(`/#${route}`);
}

type Fixtures = { api: Api; resetDatabase: void; consoleGuard: void };

export const test = base.extend<Fixtures>({
  resetDatabase: [
    async ({ playwright, baseURL }, use) => {
      const request = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { cookie: `flybudget_token=${token()}` },
      });
      const res = await request.post('/api/export/restore', {
        data: JSON.parse(fs.readFileSync(process.env.E2E_SNAPSHOT!, 'utf8')),
      });
      if (!res.ok()) throw new Error(`Database reset failed: ${await res.text()}`);
      await request.dispose();
      await use();
    },
    { auto: true },
  ],

  context: async ({ context, baseURL }, use) => {
    await context.addInitScript((apiBase) => {
      (window as unknown as { __API_BASE__: string }).__API_BASE__ = apiBase;
    }, `${baseURL}/api`);
    await context.addCookies([
      {
        name: 'flybudget_token',
        value: token(),
        url: baseURL!,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await use(context);
  },

  api: async ({ playwright, baseURL }, use) => {
    const request = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { cookie: `flybudget_token=${token()}` },
    });
    await use(new Api(request));
    await request.dispose();
  },

  consoleGuard: [
    async ({ page }, use, testInfo) => {
      const problems: string[] = [];
      page.on('pageerror', (err) => problems.push(`Uncaught: ${err.message}`));
      page.on('console', (msg) => {
        // Failed requests are reported by the request itself; tests assert on those
        if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
          problems.push(`console.error: ${msg.text()}`);
        }
      });
      await use();
      // Tests that provoke errors on purpose (e.g. a CSP violation) opt out with
      // test.info().annotations.push({ type: 'allow-page-errors' })
      const allowed = testInfo.annotations.some((a) => a.type === 'allow-page-errors');
      if (!allowed && testInfo.status === testInfo.expectedStatus) {
        expect(problems, 'the page logged errors').toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };

/** Today and nearby days as yyyy-MM-dd, in the browser's time zone setting */
export function isoDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const thisMonth = () => isoDay().slice(0, 7);

/**
 * Types into an amount field the way a person does: click it (which selects the current
 * amount) and type over it. `fill()` doesn't work here: the field switches from "$1,234"
 * to a plain number while focused.
 */
export async function typeAmount(field: Locator, amount: string) {
  const page = field.page();
  await field.click();
  // Once focused it becomes a number field (a spinbutton), so type through the keyboard
  await expect(page.locator('input:focus')).toHaveAttribute('type', 'number');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(amount);
  await page.keyboard.press('Tab');
}
