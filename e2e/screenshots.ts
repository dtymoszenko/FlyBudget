// Takes the screenshots used on the website (the tour, the user guide and the homepage) from
// the in-browser demo, so they always show the demo's sample budget.
//
//   cd website && npm run build:demo     # build the demo into website/static/demo
//   cd e2e && node screenshots.ts        # take every screenshot
//   cd e2e && node screenshots.ts budget # just the ones whose name contains "budget"
//
// They're saved as WebP to website/static/img/screenshots/, each twice: `<name>.webp` in the
// light theme and `dark-<name>.webp` in the dark one, which the website shows to visitors
// using its dark theme. The demo's dates come from today, so taking them again shows the same
// budget on a later day.
//
// Checking how another language fits (never for the website's screenshots, so these need
// SCREENSHOT_DIR, a folder outside website/):
//   SCREENSHOT_LANG=en-XA       the app in this language; en-XA is the pseudo-language, in a
//                               demo built with VITE_I18N_PSEUDO=1
//   SCREENSHOT_DEMO_DIR=<dir>   a demo build somewhere else than website/static/demo
//   SCREENSHOT_PHONE_ALL=1      every screenshot also at phone size (phone-<name>)
//   SCREENSHOT_LIGHT_ONLY=1     skip the dark copies
//   SCREENSHOT_REPORT=<file>    write what doesn't fit (cut-off text, sideways overflow)
//                               to a markdown file
// For example:
//   cd client && VITE_I18N_PSEUDO=1 npx vite build --mode demo --outDir /tmp/demo-pseudo
//   cd e2e && SCREENSHOT_DEMO_DIR=/tmp/demo-pseudo SCREENSHOT_LANG=en-XA SCREENSHOT_LIGHT_ONLY=1 \
//     SCREENSHOT_PHONE_ALL=1 SCREENSHOT_DIR=/tmp/shots SCREENSHOT_REPORT=/tmp/shots/report.md \
//     node screenshots.ts
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { SCREENSHOT_PORT, assertPortsFree } from './ports.ts';
import { clippedText, sidewaysOverflow } from './overflow.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = process.env.SCREENSHOT_DEMO_DIR ?? path.join(root, 'website', 'static', 'demo');
const outDir =
  process.env.SCREENSHOT_DIR ?? path.join(root, 'website', 'static', 'img', 'screenshots');
const PORT = SCREENSHOT_PORT;
const LANG = process.env.SCREENSHOT_LANG;
const PHONE_ALL = process.env.SCREENSHOT_PHONE_ALL === '1';
const LIGHT_ONLY = process.env.SCREENSHOT_LIGHT_ONLY === '1';
const REPORT = process.env.SCREENSHOT_REPORT;

/**
 * English UI text in SCREENSHOT_LANG, so the steps below find buttons and headings in that
 * language too (from its locale file; en-XA is made from English). Data (names, amounts)
 * isn't in there and stays as it is.
 */
const uiText = await (async () => {
  const texts = new Map<string, string>();
  if (!LANG) return texts;
  const read = (lang: string) =>
    JSON.parse(fs.readFileSync(path.join(root, 'client/src/i18n/locales', `${lang}.json`), 'utf8'));
  const flat = (o: object, prefix = ''): [string, string][] =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'string' ? [[prefix + k, v] as [string, string]] : flat(v, `${prefix}${k}.`),
    );
  // Texts with {{values}} too (templates), but not rich text with <tags>
  const english = flat(read('en')).filter(([, v]) => !v.includes('<'));
  if (LANG === 'en-XA') {
    // The client's own module (a path, not an import: it isn't part of the e2e project)
    const pseudoModule = path.join(root, 'client/src/i18n/pseudo.ts');
    const { pseudo } = (await import(pseudoModule)) as { pseudo: (text: string) => string };
    for (const [, v] of english) texts.set(v, pseudo(v));
  } else {
    const other = new Map(flat(read(LANG)));
    for (const [k, v] of english) if (other.has(k)) texts.set(v, other.get(k)!);
  }
  return texts;
})();
const tr = (text: string) => uiText.get(text) ?? text;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * A text with {{values}} ("Import {{count, number}} Transactions"), in SCREENSHOT_LANG or in
 * English, with any value in place of each {{…}}
 */
const eitherTemplate = (template: string): RegExp => {
  const pattern = (text: string) =>
    text
      .split(/\{\{[^}]*\}\}/)
      .map(escapeRegExp)
      .join('.+?');
  const translated = tr(template);
  return new RegExp(`^(?:${pattern(translated)}|${pattern(template)})$`);
};
/** Finds the text in SCREENSHOT_LANG, or in English where that part isn't translated yet */
const either = (text: string, exact = false): string | RegExp => {
  const translated = tr(text);
  if (translated === text) return text;
  const alt = `(?:${escapeRegExp(translated)}|${escapeRegExp(text)})`;
  return exact ? new RegExp(`^${alt}$`) : new RegExp(alt, 'i');
};

/** What doesn't fit, per screenshot (SCREENSHOT_REPORT) */
const findings: { shot: string; problem: string }[] = [];

interface Shot {
  name: string;
  /** Hash route in the demo */
  route: string;
  /** Set for the `dark-` copy of each screenshot */
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
  page.getByText(either(text, true), { exact: true }).first().click();
const dialog = (page: Page) => page.getByRole('dialog').last();
const openDialog = async (page: Page, button: string) => {
  await page
    .getByRole('button', { name: either(button, true), exact: true })
    .first()
    .click();
  await dialog(page).waitFor();
};

/** Opens a transaction's detail panel (clicking the row, not the payee, which edits it) */
async function openTransaction(page: Page, payee: string) {
  const row = page.getByTestId('transaction-row').filter({ hasText: payee }).first();
  const box = (await row.boundingBox())!;
  await row.click({ position: { x: box.width - 150, y: box.height / 2 } });
  await page.getByText(either('Create rule')).first().waitFor();
}

async function importCsv(page: Page) {
  await page
    .getByRole('button', { name: either('Import CSV') })
    .first()
    .click();
  await page.locator('#csv-file-input').setInputFiles({
    name: 'harbor-checking.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(SAMPLE_CSV),
  });
  await page.getByRole('button', { name: either('Preview') }).waitFor();
}

const SHOTS: Shot[] = [
  // --- The tour: one screenshot of each page ---
  { name: 'dashboard', route: '/dashboard', waitFor: 'Left to Spend' },
  { name: 'accounts', route: '/accounts', waitFor: 'Harbor Checking' },
  { name: 'account-register', route: '/accounts/demo-acct-checking', waitFor: 'Reconcile' },
  { name: 'transactions', route: '/transactions', waitFor: 'Fresh Fields Market' },
  { name: 'budget', route: '/budget', waitFor: 'Left to budget' },
  {
    name: 'category-detail',
    route: '/budget/category/demo-cat-groceries',
    waitFor: 'Groceries',
  },
  { name: 'recurring', route: '/recurring', waitFor: "Riley's paycheck" },
  {
    name: 'recurring-calendar',
    route: '/recurring',
    waitFor: "Riley's paycheck",
    prepare: (page) => page.getByRole('button', { name: either('Calendar') }).click(),
  },
  {
    name: 'recurring-all',
    route: '/recurring',
    waitFor: "Riley's paycheck",
    prepare: (page) => page.getByRole('button', { name: either('All recurring') }).click(),
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
  { name: 'rules', route: '/rules', waitFor: 'Daily Grind Coffee' },
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
    prepare: (page) =>
      page
        .getByRole('button', { name: either('Add Transaction') })
        .first()
        .click(),
  },
  {
    name: 'transaction-split',
    route: '/transactions',
    waitFor: 'Fresh Fields Market',
    prepare: async (page) => {
      await page.getByRole('button', { name: either('Last 3 Months') }).click();
      await page.getByPlaceholder(either('Search payee or notes…')).fill('Costwise');
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
      await page.getByRole('button', { name: either('Preview') }).click();
      await page
        .getByRole('button', { name: eitherTemplate('Import {{count, number}} Transactions') })
        .waitFor();
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
    waitFor: 'Daily Grind Coffee',
    prepare: async (page) => {
      await clickText(page, 'Imported description contains "DAILY GRIND"');
      await dialog(page).waitFor();
    },
    element: dialog,
  },
  {
    name: 'rules-apply',
    route: '/rules',
    waitFor: 'Daily Grind Coffee',
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
    prepare: (page) => page.getByRole('button', { name: either('Edit layout') }).click(),
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
  {
    name: 'settings-amounts',
    route: '/settings?tab=preferences',
    waitFor: 'Number format',
    // Shown the European way, the reason the setting exists
    prepare: async (page) => {
      const amounts = page.getByRole('region', { name: either('Amounts') });
      await amounts
        .getByRole('group', { name: either('Number format') })
        .getByRole('button', { name: either('1.234,56') })
        .click();
      await amounts.getByRole('textbox', { name: either('Currency symbol') }).fill('€');
      await amounts.getByRole('button', { name: either('After') }).click();
    },
    element: (page) => page.getByRole('region', { name: either('Amounts') }),
  },

  // --- Phones ---
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
    prepare: (page) =>
      page
        .getByRole('button', { name: either('Open menu') })
        .first()
        .click(),
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
    // The website's screenshots are in English, whatever this computer's language is
    locale: 'en-US',
  });
  try {
    const page = await context.newPage();
    if (shot.dark || LANG) {
      // With a language: saved as the current preferences version, so it's kept as it is
      const prefs = LANG
        ? { state: { ...(shot.dark ? { theme: 'dark' } : {}), language: LANG }, version: 2 }
        : { state: { theme: 'dark' }, version: 0 };
      await page.addInitScript((saved) => {
        sessionStorage.setItem('budget-preferences', saved);
        localStorage.setItem('budget-preferences', saved);
      }, JSON.stringify(prefs));
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
    if (shot.waitFor)
      await page.getByText(either(shot.waitFor)).first().waitFor({ timeout: 15_000 });
    // Show the on-budget accounts in the sidebar (they start collapsed)
    if (!shot.phone)
      await page
        .getByRole('button', {
          name: new RegExp(`^(?:${escapeRegExp(tr('For budget'))}|For budget)`),
        })
        .click();
    if (shot.prepare) await shot.prepare(page);
    // Let charts finish animating
    await page.waitForTimeout(1500);
    const png = shot.element
      ? await shot.element(page).screenshot()
      : await page.screenshot({ animations: 'disabled' });
    fs.writeFileSync(path.join(outDir, `${shot.name}.webp`), await toWebp(browser, png));
    console.log(`  ${shot.name}.webp`);
    if (REPORT) {
      for (const c of await clippedText(page)) {
        if (c.kind === 'label')
          findings.push({ shot: shot.name, problem: `text cut off: ${c.element}` });
        else
          findings.push({ shot: shot.name, problem: `data cut off without a title: ${c.element}` });
      }
      if (shot.phone) {
        for (const p of await sidewaysOverflow(page)) {
          findings.push({ shot: shot.name, problem: `doesn't fit sideways: ${p}` });
        }
      }
    }
  } finally {
    await context.close();
  }
}

const custom = LANG || PHONE_ALL || LIGHT_ONLY || REPORT || process.env.SCREENSHOT_DEMO_DIR;
if (custom && (!process.env.SCREENSHOT_DIR || !path.relative(root, outDir).startsWith('..'))) {
  console.error('These options are for checks: set SCREENSHOT_DIR to a folder outside the repo');
  process.exit(1);
}
if (!fs.existsSync(path.join(demoDir, 'index.html'))) {
  console.error('Build the demo first: cd website && npm run build:demo');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const filters = process.argv.slice(2);
// Every screenshot in both themes (and at phone size too, with SCREENSHOT_PHONE_ALL)
const sized = PHONE_ALL
  ? SHOTS.flatMap((s) => (s.phone ? [s] : [s, { ...s, name: `phone-${s.name}`, phone: true }]))
  : SHOTS;
const ALL_SHOTS = sized.flatMap((s) =>
  LIGHT_ONLY ? [s] : [s, { ...s, name: `dark-${s.name}`, dark: true }],
);
const wanted = ALL_SHOTS.filter((s) => !filters.length || filters.some((f) => s.name.includes(f)));

await assertPortsFree([PORT]);
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

if (REPORT) {
  // The same problem on several screenshots is one row; cut-off UI text first
  const grouped = new Map<string, string[]>();
  for (const f of findings) grouped.set(f.problem, [...(grouped.get(f.problem) ?? []), f.shot]);
  const rows = [...grouped]
    .sort(([a], [b]) => Number(b.startsWith('text')) - Number(a.startsWith('text')))
    .map(
      ([problem, shots]) =>
        `| ${problem.replaceAll('|', '\\|')} | ${[...new Set(shots)].join(', ')} |`,
    );
  const lines = [
    `# What doesn't fit${LANG ? ` (${LANG})` : ''}`,
    '',
    `${findings.length} problem${findings.length === 1 ? '' : 's'} in ${wanted.length} screenshots (${outDir}).`,
    '',
    ...(rows.length ? ['| Problem | Screenshots |', '| --- | --- |', ...rows] : []),
  ];
  fs.writeFileSync(REPORT, lines.join('\n') + '\n');
  console.log(`Report: ${REPORT} (${findings.length} problems)`);
}
