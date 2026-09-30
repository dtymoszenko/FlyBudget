// Takes the screenshots used on the website (the tour, the user guide and the homepage) from
// the in-browser demo, so they always show the demo's sample budget.
//
//   cd website && npm run build:demo     # build the demo into website/static/demo
//   cd e2e && node screenshots.ts        # take every screenshot
//   cd e2e && node screenshots.ts budget # just the ones whose name contains "budget"
//
// They're saved as WebP to website/static/img/screenshots/. The demo's dates come from
// today, so taking them again shows the same budget on a later day.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = path.join(root, 'website', 'static', 'demo');
const outDir =
  process.env.SCREENSHOT_DIR ?? path.join(root, 'website', 'static', 'img', 'screenshots');
const PORT = 3175;

interface Shot {
  name: string;
  /** Hash route in the demo */
  route: string;
  dark?: boolean;
  phone?: boolean;
  /** Wait for this text before anything else */
  waitFor?: string;
  /** Clicks and waits before the screenshot */
  prepare?: (page: Page) => Promise<void>;
  /** Screenshot just this part of the page (e.g. a dialog) */
  element?: (page: Page) => Locator;
}

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** A small bank file for the CSV import screenshots */
const SAMPLE_CSV = [
  'Date,Description,Amount',
  '2026-09-02,SQ *DAILY GRIND 1142,-5.75',
  '2026-09-03,FRESH FIELDS MKT #0221,-84.12',
  '2026-09-05,FUEL STOP 00318,-41.60',
  '2026-09-08,BRIGHTWAVE STUDIO PAYROLL,2450.00',
].join('\n');

const clickText = (page: Page, text: string) =>
  page.getByText(text, { exact: true }).first().click();
const dialog = (page: Page) => page.getByRole('dialog').last();
const openDialog = async (page: Page, button: string) => {
  await page.getByRole('button', { name: button, exact: true }).first().click();
  await dialog(page).waitFor();
};

/** Opens a transaction's detail panel (clicking the row, not the payee, which edits it) */
async function openTransaction(page: Page, payee: string) {
  const row = page.getByTestId('transaction-row').filter({ hasText: payee }).first();
  const box = (await row.boundingBox())!;
  await row.click({ position: { x: box.width - 150, y: box.height / 2 } });
  await page.getByText('Create rule').first().waitFor();
}

async function importCsv(page: Page) {
  await page.getByRole('button', { name: 'Import CSV' }).first().click();
  await page.locator('#csv-file-input').setInputFiles({
    name: 'harbor-checking.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(SAMPLE_CSV),
  });
  await page.getByRole('button', { name: 'Preview' }).waitFor();
}

const SHOTS: Shot[] = [
  // --- The tour: one screenshot of each page ---
  { name: 'dashboard', route: '/dashboard', waitFor: 'Left to Spend' },
  { name: 'accounts', route: '/accounts', waitFor: 'Harbor Checking' },
  { name: 'account-register', route: '/accounts/demo-acct-checking', waitFor: 'Reconcile' },
  { name: 'transactions', route: '/transactions', waitFor: 'Fresh Fields Market' },
  { name: 'budget', route: '/budget', waitFor: 'Left to budget' },
  { name: 'category-detail', route: '/budget/category/demo-cat-groceries', waitFor: 'Groceries' },
  { name: 'recurring', route: '/recurring', waitFor: "Riley's paycheck" },
  {
    name: 'recurring-calendar',
    route: '/recurring',
    waitFor: "Riley's paycheck",
    prepare: (page) => page.getByRole('button', { name: 'Calendar' }).click(),
  },
  {
    name: 'recurring-all',
    route: '/recurring',
    waitFor: "Riley's paycheck",
    prepare: (page) => page.getByRole('button', { name: 'All recurring' }).click(),
  },
  { name: 'reports', route: '/reports', waitFor: 'Where the money goes' },
  { name: 'report-net-worth', route: '/reports/widget/demo-widget-2', waitFor: 'Net Worth' },
  { name: 'report-calendar', route: '/reports/widget/demo-widget-7', waitFor: 'Calendar' },
  {
    name: 'custom-report',
    route: '/reports/custom/demo-report-whereItGoes',
    waitFor: 'Where the money goes',
  },
  { name: 'cash-flow', route: '/cash-flow', waitFor: 'Total income' },
  { name: 'goals', route: '/goals', waitFor: 'Emergency fund' },
  { name: 'payees', route: '/payees', waitFor: 'Daily Grind Coffee' },
  { name: 'rules', route: '/rules', waitFor: 'Rename payee to Daily Grind Coffee' },
  { name: 'settings', route: '/settings', waitFor: 'Paychecks' },

  // --- The user guide: dialogs and details ---
  {
    name: 'transaction-detail',
    route: '/transactions',
    waitFor: 'Fresh Fields Market',
    prepare: (page) => openTransaction(page, 'Fresh Fields Market'),
  },
  {
    name: 'transaction-add',
    route: '/transactions',
    waitFor: 'Fresh Fields Market',
    prepare: (page) => openDialog(page, 'Add'),
    element: dialog,
  },
  {
    name: 'transaction-add-inline',
    route: '/accounts/demo-acct-checking',
    waitFor: 'Reconcile',
    prepare: (page) => page.getByRole('button', { name: 'Add Transaction' }).first().click(),
  },
  {
    name: 'transaction-split',
    route: '/transactions',
    waitFor: 'Fresh Fields Market',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Last 3 Months' }).click();
      await page.getByPlaceholder(/Search payee or notes/).fill('Costwise');
      await openTransaction(page, 'Costwise Warehouse');
    },
  },
  {
    name: 'import-csv',
    route: '/accounts/demo-acct-checking',
    waitFor: 'Reconcile',
    prepare: importCsv,
    element: dialog,
  },
  {
    name: 'import-csv-preview',
    route: '/accounts/demo-acct-checking',
    waitFor: 'Reconcile',
    prepare: async (page) => {
      await importCsv(page);
      await page.getByRole('button', { name: 'Preview' }).click();
      await page.getByRole('button', { name: /^Import \d+ Transactions$/ }).waitFor();
    },
    element: dialog,
  },
  { name: 'reconcile', route: '/accounts/demo-acct-checking/reconcile', waitFor: 'Harbor' },
  {
    name: 'update-value',
    route: '/accounts/demo-acct-car',
    waitFor: 'Update value',
    prepare: (page) => openDialog(page, 'Update value'),
    element: dialog,
  },
  {
    name: 'add-account',
    route: '/accounts',
    waitFor: 'Harbor Checking',
    prepare: (page) => openDialog(page, 'Add Account'),
    element: dialog,
  },
  {
    name: 'rule-editor',
    route: '/rules',
    waitFor: 'Rename payee to Daily Grind Coffee',
    prepare: async (page) => {
      await clickText(page, 'Imported description contains "DAILY GRIND"');
      await dialog(page).waitFor();
    },
    element: dialog,
  },
  {
    name: 'rules-apply',
    route: '/rules',
    waitFor: 'Rename payee to Daily Grind Coffee',
    prepare: (page) => openDialog(page, 'Run rules'),
    element: dialog,
  },
  {
    name: 'recurring-find',
    route: '/recurring',
    waitFor: "Riley's paycheck",
    prepare: (page) => openDialog(page, 'Find recurring'),
    element: dialog,
  },
  {
    name: 'recurring-add',
    route: '/recurring',
    waitFor: "Riley's paycheck",
    prepare: (page) => openDialog(page, 'Add recurring'),
    element: dialog,
  },
  {
    name: 'budget-edit',
    route: '/budget',
    waitFor: 'Left to budget',
    prepare: (page) => page.getByRole('button', { name: /^Planned for Rent:/ }).click(),
  },
  {
    name: 'budget-overspent',
    route: '/budget',
    waitFor: 'Left to budget',
    prepare: async (page) => {
      // Plan less than was spent on groceries and restaurants, so they show red
      for (const [category, amount] of [
        ['Groceries', '400'],
        ['Restaurants', '50'],
      ]) {
        await page.getByRole('button', { name: new RegExp(`^Planned for ${category}:`) }).click();
        await page.getByLabel(`Planned for ${category}`, { exact: true }).fill(amount);
        await page.keyboard.press('Enter');
      }
      await page.getByRole('button', { name: /^Planned for Restaurants: \$50/ }).waitFor();
      await page.mouse.move(0, 0);
      await page.mouse.wheel(0, 900);
    },
  },
  {
    name: 'reports-edit-layout',
    route: '/reports',
    waitFor: 'Where the money goes',
    prepare: (page) => page.getByRole('button', { name: 'Edit layout' }).click(),
  },
  {
    name: 'goal-add',
    route: '/goals',
    waitFor: 'Emergency fund',
    prepare: (page) => openDialog(page, 'Add Goal'),
    element: dialog,
  },
  { name: 'settings-data', route: '/settings?tab=data', waitFor: 'Download Backup' },
  { name: 'settings-preferences', route: '/settings?tab=preferences', waitFor: 'Theme' },

  // --- Phones and dark mode ---
  { name: 'phone-dashboard', route: '/dashboard', phone: true, waitFor: 'Left to Spend' },
  { name: 'phone-budget', route: '/budget', phone: true, waitFor: 'Left to budget' },
  {
    name: 'phone-transactions',
    route: '/transactions',
    phone: true,
    waitFor: 'Fresh Fields Market',
  },
  {
    name: 'phone-menu',
    route: '/dashboard',
    phone: true,
    waitFor: 'Left to Spend',
    prepare: (page) => page.getByRole('button', { name: /menu/i }).first().click(),
  },
  { name: 'dark-dashboard', route: '/dashboard', dark: true, waitFor: 'Left to Spend' },
  { name: 'dark-budget', route: '/budget', dark: true, waitFor: 'Left to budget' },

  // --- The homepage: the same screens in dark mode, for visitors using the dark theme ---
  { name: 'dark-reports', route: '/reports', dark: true, waitFor: 'Where the money goes' },
  { name: 'dark-cash-flow', route: '/cash-flow', dark: true, waitFor: 'Total income' },
  {
    name: 'dark-rule-editor',
    route: '/rules',
    dark: true,
    waitFor: 'Rename payee to Daily Grind Coffee',
    prepare: async (page) => {
      await clickText(page, 'Imported description contains "DAILY GRIND"');
      await dialog(page).waitFor();
    },
    element: dialog,
  },
  {
    name: 'dark-phone-dashboard',
    route: '/dashboard',
    phone: true,
    dark: true,
    waitFor: 'Left to Spend',
  },
  {
    name: 'dark-phone-budget',
    route: '/budget',
    phone: true,
    dark: true,
    waitFor: 'Left to budget',
  },
  {
    name: 'dark-phone-transactions',
    route: '/transactions',
    phone: true,
    dark: true,
    waitFor: 'Fresh Fields Market',
  },
];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** Serves the demo build at /demo/, like the website does */
function serveDemo(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const rel = decodeURIComponent(url.pathname.replace(/^\/demo\//, '')) || 'index.html';
    const file = path.join(demoDir, rel);
    if (
      !url.pathname.startsWith('/demo/') ||
      path.relative(demoDir, file).startsWith('..') ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/** PNG → WebP (a third of the size), using the browser's own encoder */
async function toWebp(browser: Browser, png: Buffer): Promise<Buffer> {
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(
    async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      return canvas.toDataURL('image/webp', 0.9);
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
  await page.close();
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

const HIDE_DEMO_BANNER = '[role="region"][aria-label="Demo"] { display: none !important; }';

async function take(browser: Browser, shot: Shot) {
  const context = await browser.newContext({
    viewport: shot.phone ? PHONE : LAPTOP,
    deviceScaleFactor: 2,
    isMobile: shot.phone,
    hasTouch: shot.phone,
    colorScheme: shot.dark ? 'dark' : 'light',
  });
  try {
    const page = await context.newPage();
    if (shot.dark) {
      await page.addInitScript(() => {
        const prefs = JSON.stringify({ state: { theme: 'dark' }, version: 0 });
        sessionStorage.setItem('budget-preferences', prefs);
        localStorage.setItem('budget-preferences', prefs);
      });
    }
    // The demo banner isn't part of the app
    await page.addInitScript((css) => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.append(style);
      });
    }, HIDE_DEMO_BANNER);
    await page.goto(`http://localhost:${PORT}/demo/#${shot.route}`);
    if (shot.waitFor) await page.getByText(shot.waitFor).first().waitFor({ timeout: 15_000 });
    // Show the on-budget accounts in the sidebar (they start collapsed)
    if (!shot.phone) await page.getByRole('button', { name: /^For budget/ }).click();
    if (shot.prepare) await shot.prepare(page);
    // Let charts finish animating
    await page.waitForTimeout(1500);
    const png = shot.element
      ? await shot.element(page).screenshot()
      : await page.screenshot({ animations: 'disabled' });
    fs.writeFileSync(path.join(outDir, `${shot.name}.webp`), await toWebp(browser, png));
    console.log(`  ${shot.name}.webp`);
  } finally {
    await context.close();
  }
}

if (!fs.existsSync(path.join(demoDir, 'index.html'))) {
  console.error('Build the demo first: cd website && npm run build:demo');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const filters = process.argv.slice(2);
const wanted = SHOTS.filter((s) => !filters.length || filters.some((f) => s.name.includes(f)));

const server = await serveDemo();
const browser = await chromium.launch();
try {
  for (const shot of wanted) {
    try {
      await take(browser, shot);
    } catch (err) {
      console.error(`  ${shot.name} FAILED: ${(err as Error).message.split('\n')[0]}`);
      process.exitCode = 1;
    }
  }
} finally {
  await browser.close();
  server.close();
}
