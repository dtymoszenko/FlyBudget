import { db } from './index.js';
import {
  accounts,
  categories,
  categoryGroups,
  payees,
  transactions,
  budgetMonths,
  schedules,
  rules,
  customReports,
  goals,
} from './schema.js';
import { nanoid } from 'nanoid';
import { buildRecurrenceRule, type RecurrenceType } from '../utils/recurrence.js';

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randCents(minDollars: number, maxDollars: number): number {
  return randInt(Math.round(minDollars * 100), Math.round(maxDollars * 100));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fmtDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function fmtMonth(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}`;
}

function lastDay(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function getYM(mi: number): { year: number; month: number } {
  const total = 9 + mi;
  return { year: 2024 + Math.floor(total / 12), month: (total % 12) + 1 };
}

function getCR(mi: number): { reconciled: number } {
  if (mi <= 14) return { reconciled: 1 };
  return { reconciled: 0 };
}

const NOTES = [
  'Weekly grocery run',
  'Stocked up for the week',
  'Quick stop after work',
  'Date night',
  'Family dinner out',
  'Team lunch',
  'Celebratory dinner',
  'Regular fill-up',
  'Road trip gas',
  'Used rewards points',
  'Sale item',
  'Clearance find',
  'Online order',
  'In-store pickup',
  'Needed for work',
  'Rewards applied',
  'Used coupon',
  'Emergency purchase',
  'Planned purchase',
  'Monthly bill',
  'Paid in full',
  'Auto-pay',
  'Recurring charge',
];

function maybeNote(): string | null {
  return Math.random() < 0.15 ? pick(NOTES) : null;
}

// ═══════════════════════════════════════════════════════
// PHASE 0: Prerequisites
// ═══════════════════════════════════════════════════════

console.log('Rich seed: Checking prerequisites...');

const existingAccounts = db.select().from(accounts).all();
if (existingAccounts.length > 0) {
  console.log(
    'Rich seed data already exists (accounts found). Delete budget.db and re-run db:seed + db:seed-rich to start fresh.',
  );
  process.exit(0);
}

const allGroups = db.select().from(categoryGroups).all();
if (allGroups.length === 0) {
  console.error('No categories found. Run `npm run db:seed` first.');
  process.exit(1);
}

const allCats = db.select().from(categories).all();
const catMap = new Map(allCats.map((c) => [c.name, c.id]));

function catId(name: string): string {
  const id = catMap.get(name);
  if (!id) throw new Error(`Category not found: "${name}"`);
  return id;
}

const now = new Date().toISOString();

// ═══════════════════════════════════════════════════════
// PHASE 1: Accounts
// ═══════════════════════════════════════════════════════

console.log('Rich seed: Inserting accounts...');

const ACCOUNT_DEFS = [
  {
    name: 'Primary Checking',
    type: 'checking',
    startingBalance: 250000,
    isOffBudget: 0,
    closedAt: null,
  },
  {
    name: 'Savings Account',
    type: 'savings',
    startingBalance: 500000,
    isOffBudget: 0,
    closedAt: null,
  },
  {
    name: 'Chase Credit Card',
    type: 'credit',
    startingBalance: -120000,
    isOffBudget: 0,
    closedAt: null,
  },
  { name: 'Cash Wallet', type: 'cash', startingBalance: 20000, isOffBudget: 0, closedAt: null },
  {
    name: 'Vanguard 401k',
    type: 'retirement',
    startingBalance: 4500000,
    isOffBudget: 1,
    closedAt: null,
  },
  {
    name: 'Home',
    type: 'real_estate',
    startingBalance: 42000000,
    isOffBudget: 1,
    closedAt: null,
  },
  {
    name: 'Home Mortgage',
    type: 'mortgage',
    startingBalance: -31500000,
    isOffBudget: 1,
    closedAt: null,
  },
  {
    name: 'Honda Civic',
    type: 'vehicle',
    startingBalance: 1850000,
    isOffBudget: 1,
    closedAt: null,
  },
  {
    name: 'Emergency Fund',
    type: 'savings',
    startingBalance: 300000,
    isOffBudget: 0,
    closedAt: null,
  },
  {
    name: 'Old Checking',
    type: 'checking',
    startingBalance: 100000,
    isOffBudget: 0,
    closedAt: '2025-03-15T00:00:00.000Z',
  },
];

const acct: Record<string, string> = {};
ACCOUNT_DEFS.forEach((a, i) => {
  const id = nanoid();
  acct[a.name] = id;
  db.insert(accounts)
    .values({
      id,
      name: a.name,
      type: a.type,
      startingBalance: a.startingBalance,
      isOffBudget: a.isOffBudget,
      sortOrder: i,
      closedAt: a.closedAt,
      createdAt: '2024-09-15T00:00:00.000Z',
    })
    .run();
});

// ═══════════════════════════════════════════════════════
// PHASE 2: Payees
// ═══════════════════════════════════════════════════════

console.log('Rich seed: Inserting payees...');

const PAYEE_DEFS: { name: string; cat: string | null }[] = [
  { name: 'Acme Corp', cat: 'Paychecks' },
  { name: 'Greenfield Properties', cat: 'Rent / Mortgage' },
  { name: 'Kroger', cat: 'Groceries' },
  { name: "Trader Joe's", cat: 'Groceries' },
  { name: 'Aldi', cat: 'Groceries' },
  { name: 'Whole Foods', cat: 'Groceries' },
  { name: 'Costco', cat: 'Groceries' },
  { name: 'Shell', cat: 'Gas / Fuel' },
  { name: 'Exxon', cat: 'Gas / Fuel' },
  { name: 'Chipotle', cat: 'Restaurants' },
  { name: 'Olive Garden', cat: 'Restaurants' },
  { name: 'Thai Basil', cat: 'Restaurants' },
  { name: 'Sushi Palace', cat: 'Restaurants' },
  { name: 'Pizza Hut', cat: 'Fast Food' },
  { name: "McDonald's", cat: 'Fast Food' },
  { name: 'Uber Eats', cat: 'Fast Food' },
  { name: 'Starbucks', cat: 'Coffee Shops' },
  { name: "Dunkin'", cat: 'Coffee Shops' },
  { name: 'Local Coffee Co', cat: 'Coffee Shops' },
  { name: 'Netflix', cat: 'Streaming Services' },
  { name: 'Spotify', cat: 'Streaming Services' },
  { name: 'Hulu', cat: 'Streaming Services' },
  { name: 'Planet Fitness', cat: 'Gym / Fitness' },
  { name: 'Amazon', cat: 'Electronics' },
  { name: 'Target', cat: 'Home Goods' },
  { name: 'Walmart', cat: 'Home Goods' },
  { name: 'TJ Maxx', cat: 'Clothing' },
  { name: 'Nike', cat: 'Clothing' },
  { name: 'Duke Energy', cat: 'Electric' },
  { name: 'City Water Dept', cat: 'Water' },
  { name: 'AT&T Wireless', cat: 'Phone' },
  { name: 'Spectrum Internet', cat: 'Internet' },
  { name: 'Piedmont Natural Gas', cat: 'Gas (Natural)' },
  { name: 'Republic Services', cat: 'Trash / Recycling' },
  { name: 'State Farm', cat: 'Car Insurance' },
  { name: 'Dr. Sarah Johnson', cat: 'Doctor / Medical' },
  { name: 'CVS Pharmacy', cat: 'Pharmacy' },
  { name: 'Bright Smiles Dental', cat: 'Dentist' },
  { name: 'LensCrafters', cat: 'Vision / Eye Care' },
  { name: 'Merry Maids', cat: 'Home Maintenance' },
  { name: 'Home Depot', cat: 'Home Improvement' },
  { name: 'United Airlines', cat: 'Flights' },
  { name: 'Marriott', cat: 'Hotels' },
  { name: 'AMC Theaters', cat: 'Entertainment' },
  { name: 'Udemy', cat: 'Online Courses' },
  { name: 'T-Mobile', cat: 'Phone' },
];

const pay: Record<string, string> = {};
PAYEE_DEFS.forEach((p) => {
  const id = nanoid();
  pay[p.name] = id;
  db.insert(payees)
    .values({
      id,
      name: p.name,
      defaultCategoryId: p.cat ? catId(p.cat) : null,
      createdAt: '2024-09-15T00:00:00.000Z',
    })
    .run();
});

// ═══════════════════════════════════════════════════════
// PHASE 3: Recurring Transactions
// ═══════════════════════════════════════════════════════

console.log('Rich seed: Inserting schedules...');

const REC_DEFS: {
  name: string;
  amount: number;
  recurrenceType: RecurrenceType;
  startDate: string;
  endDate: string | null;
  accountName: string;
  categoryName: string;
  payeeName: string | null;
  status: string;
  autoCreate: number;
  amountType: string;
  notes: string | null;
}[] = [
  {
    name: 'Salary',
    amount: 450000,
    recurrenceType: 'semimonthly',
    startDate: '2024-10-01',
    endDate: null,
    accountName: 'Primary Checking',
    categoryName: 'Paychecks',
    payeeName: 'Acme Corp',
    status: 'active',
    autoCreate: 1,
    amountType: 'exact',
    notes: null,
  },
  {
    name: 'Rent',
    amount: -180000,
    recurrenceType: 'monthly',
    startDate: '2024-10-01',
    endDate: null,
    accountName: 'Primary Checking',
    categoryName: 'Rent / Mortgage',
    payeeName: 'Greenfield Properties',
    status: 'active',
    autoCreate: 0,
    amountType: 'exact',
    notes: null,
  },
  {
    name: 'Electric Bill',
    amount: -12000,
    recurrenceType: 'monthly',
    startDate: '2024-10-05',
    endDate: null,
    accountName: 'Primary Checking',
    categoryName: 'Electric',
    payeeName: 'Duke Energy',
    status: 'active',
    autoCreate: 0,
    amountType: 'approximate',
    notes: null,
  },
  {
    name: 'Water Bill',
    amount: -5000,
    recurrenceType: 'monthly',
    startDate: '2024-10-10',
    endDate: null,
    accountName: 'Primary Checking',
    categoryName: 'Water',
    payeeName: 'City Water Dept',
    status: 'active',
    autoCreate: 0,
    amountType: 'approximate',
    notes: null,
  },
  {
    name: 'Internet',
    amount: -7000,
    recurrenceType: 'monthly',
    startDate: '2024-10-12',
    endDate: null,
    accountName: 'Primary Checking',
    categoryName: 'Internet',
    payeeName: 'Spectrum Internet',
    status: 'active',
    autoCreate: 1,
    amountType: 'exact',
    notes: null,
  },
  {
    name: 'Phone Bill',
    amount: -8500,
    recurrenceType: 'monthly',
    startDate: '2024-10-15',
    endDate: null,
    accountName: 'Primary Checking',
    categoryName: 'Phone',
    payeeName: 'AT&T Wireless',
    status: 'active',
    autoCreate: 1,
    amountType: 'exact',
    notes: null,
  },
  {
    name: 'Natural Gas',
    amount: -5500,
    recurrenceType: 'monthly',
    startDate: '2024-10-18',
    endDate: null,
    accountName: 'Primary Checking',
    categoryName: 'Gas (Natural)',
    payeeName: 'Piedmont Natural Gas',
    status: 'active',
    autoCreate: 0,
    amountType: 'approximate',
    notes: null,
  },
  {
    name: 'Netflix',
    amount: -1599,
    recurrenceType: 'monthly',
    startDate: '2024-10-03',
    endDate: null,
    accountName: 'Chase Credit Card',
    categoryName: 'Streaming Services',
    payeeName: 'Netflix',
    status: 'active',
    autoCreate: 1,
    amountType: 'exact',
    notes: null,
  },
  {
    name: 'Spotify',
    amount: -1099,
    recurrenceType: 'monthly',
    startDate: '2024-10-05',
    endDate: null,
    accountName: 'Chase Credit Card',
    categoryName: 'Streaming Services',
    payeeName: 'Spotify',
    status: 'active',
    autoCreate: 1,
    amountType: 'exact',
    notes: null,
  },
  {
    name: 'Hulu',
    amount: -1799,
    recurrenceType: 'monthly',
    startDate: '2024-10-08',
    endDate: null,
    accountName: 'Chase Credit Card',
    categoryName: 'Streaming Services',
    payeeName: 'Hulu',
    status: 'active',
    autoCreate: 1,
    amountType: 'exact',
    notes: null,
  },
  {
    name: 'Planet Fitness',
    amount: -4500,
    recurrenceType: 'monthly',
    startDate: '2024-10-01',
    endDate: null,
    accountName: 'Chase Credit Card',
    categoryName: 'Gym / Fitness',
    payeeName: 'Planet Fitness',
    status: 'active',
    autoCreate: 0,
    amountType: 'exact',
    notes: null,
  },
  {
    name: 'Car Insurance',
    amount: -42000,
    recurrenceType: 'quarterly',
    startDate: '2024-10-15',
    endDate: null,
    accountName: 'Primary Checking',
    categoryName: 'Car Insurance',
    payeeName: 'State Farm',
    status: 'active',
    autoCreate: 0,
    amountType: 'exact',
    notes: 'Quarterly premium',
  },
  {
    name: 'Amazon Prime',
    amount: -13900,
    recurrenceType: 'yearly',
    startDate: '2024-11-20',
    endDate: null,
    accountName: 'Chase Credit Card',
    categoryName: 'Electronics',
    payeeName: 'Amazon',
    status: 'active',
    autoCreate: 1,
    amountType: 'exact',
    notes: 'Annual membership',
  },
  {
    name: 'Old Phone Plan',
    amount: -6500,
    recurrenceType: 'monthly',
    startDate: '2024-10-01',
    endDate: '2025-06-30',
    accountName: 'Primary Checking',
    categoryName: 'Phone',
    payeeName: 'T-Mobile',
    status: 'canceled',
    autoCreate: 0,
    amountType: 'exact',
    notes: 'Canceled - switched to AT&T',
  },
  {
    name: 'Freelance Income',
    amount: 200000,
    recurrenceType: 'monthly',
    startDate: '2025-01-15',
    endDate: null,
    accountName: 'Primary Checking',
    categoryName: 'Business Income',
    payeeName: null,
    status: 'paused',
    autoCreate: 0,
    amountType: 'approximate',
    notes: 'On hold',
  },
  {
    name: 'Weekly Coffee',
    amount: -2500,
    recurrenceType: 'weekly',
    startDate: '2024-10-07',
    endDate: null,
    accountName: 'Chase Credit Card',
    categoryName: 'Coffee Shops',
    payeeName: 'Starbucks',
    status: 'active',
    autoCreate: 1,
    amountType: 'exact',
    notes: null,
  },
  {
    name: 'House Cleaner',
    amount: -15000,
    recurrenceType: 'biweekly',
    startDate: '2024-10-14',
    endDate: null,
    accountName: 'Primary Checking',
    categoryName: 'Home Maintenance',
    payeeName: 'Merry Maids',
    status: 'active',
    autoCreate: 0,
    amountType: 'exact',
    notes: null,
  },
  {
    name: 'Savings Transfer',
    amount: -50000,
    recurrenceType: 'monthly',
    startDate: '2024-10-25',
    endDate: null,
    accountName: 'Primary Checking',
    categoryName: 'Savings',
    payeeName: null,
    status: 'active',
    autoCreate: 0,
    amountType: 'exact',
    notes: 'Monthly savings goal',
  },
];

const rec: Record<string, string> = {};
REC_DEFS.forEach((r) => {
  const id = nanoid();
  rec[r.name] = id;
  db.insert(schedules)
    .values({
      id,
      name: r.name,
      amount: r.amount,
      amountType: r.amountType,
      recurrenceType: r.recurrenceType,
      recurrenceRule: JSON.stringify(buildRecurrenceRule(r.recurrenceType, r.startDate)),
      startDate: r.startDate,
      endDate: r.endDate,
      weekendAdjust: 'none',
      dateFlexibility: 3,
      accountId: acct[r.accountName] ?? null,
      categoryId: catId(r.categoryName),
      payeeId: r.payeeName ? (pay[r.payeeName] ?? null) : null,
      notes: r.notes,
      status: r.status,
      autoCreate: r.autoCreate,
      source: 'manual',
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

// ═══════════════════════════════════════════════════════
// PHASE 4: Transactions
// ═══════════════════════════════════════════════════════

console.log('Rich seed: Generating transactions...');

let txCount = 0;

function insertTx(vals: {
  accountId: string;
  date: string;
  amount: number;
  payeeId?: string | null;
  payeeName?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  reconciled?: number;
  scheduleId?: string | null;
  isParent?: number;
  parentTransactionId?: string | null;
  transferTransactionId?: string | null;
}): string {
  const id = nanoid();
  db.insert(transactions)
    .values({
      id,
      accountId: vals.accountId,
      date: vals.date,
      amount: vals.amount,
      payeeId: vals.payeeId ?? null,
      payeeName: vals.payeeName ?? null,
      categoryId: vals.categoryId ?? null,
      notes: vals.notes ?? null,
      reconciled: vals.reconciled ?? 0,
      transferTransactionId: vals.transferTransactionId ?? null,
      isParent: vals.isParent ?? 0,
      parentTransactionId: vals.parentTransactionId ?? null,
      importedId: null,
      scheduleId: vals.scheduleId ?? null,
      createdAt: now,
    })
    .run();
  txCount++;
  return id;
}

function insertTransfer(
  fromAcctName: string,
  toAcctName: string,
  date: string,
  amount: number,
  reconciled: number,
) {
  const fromId = nanoid();
  const toId = nanoid();
  db.insert(transactions)
    .values({
      id: fromId,
      accountId: acct[fromAcctName],
      date,
      amount: -amount,
      payeeId: null,
      payeeName: `Transfer: ${toAcctName}`,
      categoryId: null,
      notes: null,
      reconciled,
      isParent: 0,
      parentTransactionId: null,
      transferTransactionId: toId,
      importedId: null,
      scheduleId: null,
      createdAt: now,
    })
    .run();
  db.insert(transactions)
    .values({
      id: toId,
      accountId: acct[toAcctName],
      date,
      amount,
      payeeId: null,
      payeeName: `Transfer: ${fromAcctName}`,
      categoryId: null,
      notes: null,
      reconciled,
      isParent: 0,
      parentTransactionId: null,
      transferTransactionId: fromId,
      importedId: null,
      scheduleId: null,
      createdAt: now,
    })
    .run();
  txCount += 2;
}

function insertSplit(
  accountId: string,
  date: string,
  totalAmount: number,
  payeeId: string | null,
  payeeName: string | null,
  children: { categoryId: string | null; amount: number; notes: string | null }[],
  reconciled: number,
) {
  const parentId = nanoid();
  db.insert(transactions)
    .values({
      id: parentId,
      accountId,
      date,
      amount: totalAmount,
      payeeId,
      payeeName,
      categoryId: null,
      notes: null,
      reconciled,
      isParent: 1,
      parentTransactionId: null,
      transferTransactionId: null,
      importedId: null,
      scheduleId: null,
      createdAt: now,
    })
    .run();
  txCount++;
  for (const ch of children) {
    db.insert(transactions)
      .values({
        id: nanoid(),
        accountId,
        date,
        amount: ch.amount,
        payeeId,
        payeeName,
        categoryId: ch.categoryId,
        notes: ch.notes,
        reconciled,
        isParent: 0,
        parentTransactionId: parentId,
        transferTransactionId: null,
        importedId: null,
        scheduleId: null,
        createdAt: now,
      })
      .run();
    txCount++;
  }
}

// Grocery store payees for rotation
const groceryPayees = ['Kroger', "Trader Joe's", 'Aldi', 'Whole Foods', 'Costco'];
const restaurantPayees = ['Chipotle', 'Olive Garden', 'Thai Basil', 'Sushi Palace'];
const fastFoodPayees = ['Pizza Hut', "McDonald's", 'Uber Eats'];
const gasPayees = ['Shell', 'Exxon'];
const shoppingPayees = ['Amazon', 'Target', 'Walmart', 'TJ Maxx', 'Nike'];

// Quarters when car insurance is due (month indices)
const carInsuranceMonths = [0, 3, 6, 9, 12, 15, 18, 21];
// Amazon Prime renewal months (Nov = monthIndex 1, 13)
const amazonPrimeMonths = [1, 13];
// Old phone plan months (Oct 2024 - Jun 2025 = monthIndex 0-8)
const oldPhoneMonths = [0, 1, 2, 3, 4, 5, 6, 7, 8];
// Freelance income months (Jan 2025 - Mar 2025 = monthIndex 3-5)
const freelanceMonths = [3, 4, 5];

// Months for large occasional expenses
const LARGE_EXPENSES: Record<
  number,
  { payee: string; cat: string; amount: number; notes: string }
> = {
  2: {
    payee: 'Home Depot',
    cat: 'Car Maintenance',
    amount: -85000,
    notes: 'Car repair - transmission issue',
  },
  5: {
    payee: 'Dr. Sarah Johnson',
    cat: 'Doctor / Medical',
    amount: -45000,
    notes: 'Annual physical + lab work',
  },
  8: { payee: 'Marriott', cat: 'Vacation', amount: -220000, notes: 'Beach vacation - 5 nights' },
  11: { payee: 'Amazon', cat: 'Electronics', amount: -110000, notes: 'New monitor + keyboard' },
  14: { payee: 'Target', cat: 'Gifts', amount: -60000, notes: 'Holiday gift shopping' },
  17: { payee: 'Home Depot', cat: 'Home Maintenance', amount: -90000, notes: 'Plumbing repair' },
  20: { payee: 'Bright Smiles Dental', cat: 'Dentist', amount: -40000, notes: 'Crown replacement' },
};

// Months for uncategorized transactions (for rules testing)
const uncategorizedMonths = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23];
// Months with "birthday" notes and no category (for rules testing)
const birthdayMonths = [4, 10, 16];

// ── Main month loop ──

for (let mi = 0; mi < 24; mi++) {
  const { year: y, month: m } = getYM(mi);
  const ld = lastDay(y, m);
  const d = (day: number) => fmtDate(y, m, Math.min(day, ld));
  const cr = () => getCR(mi);

  // For Sep 2026 (mi=23), only generate up to day 15 for some items
  // to leave upcoming bills for the dashboard widget
  const isCurrentMonth = mi === 23;

  // ── SALARY (semimonthly, linked) ──
  insertTx({
    accountId: acct['Primary Checking'],
    date: d(1),
    amount: randCents(4400, 4600),
    payeeId: pay['Acme Corp'],
    payeeName: 'Acme Corp',
    categoryId: catId('Paychecks'),
    scheduleId: rec['Salary'],
    ...cr(),
  });
  insertTx({
    accountId: acct['Primary Checking'],
    date: d(15),
    amount: randCents(4400, 4600),
    payeeId: pay['Acme Corp'],
    payeeName: 'Acme Corp',
    categoryId: catId('Paychecks'),
    scheduleId: rec['Salary'],
    ...cr(),
  });

  // ── RENT (monthly, linked) ──
  insertTx({
    accountId: acct['Primary Checking'],
    date: d(1),
    amount: -180000,
    payeeId: pay['Greenfield Properties'],
    payeeName: 'Greenfield Properties',
    categoryId: catId('Rent / Mortgage'),
    scheduleId: rec['Rent'],
    ...cr(),
  });

  // ── UTILITIES (monthly, linked) ──

  // Electric - seasonal variation
  const isWinterOrSummer = [1, 2, 6, 7, 8, 12].includes(m);
  const electricAmt = isWinterOrSummer ? randCents(120, 155) : randCents(80, 115);
  insertTx({
    accountId: acct['Primary Checking'],
    date: d(5),
    amount: -electricAmt,
    payeeId: pay['Duke Energy'],
    payeeName: 'Duke Energy',
    categoryId: catId('Electric'),
    scheduleId: rec['Electric Bill'],
    ...cr(),
  });

  // Water
  insertTx({
    accountId: acct['Primary Checking'],
    date: d(10),
    amount: -randCents(40, 62),
    payeeId: pay['City Water Dept'],
    payeeName: 'City Water Dept',
    categoryId: catId('Water'),
    scheduleId: rec['Water Bill'],
    ...cr(),
  });

  // Internet
  insertTx({
    accountId: acct['Primary Checking'],
    date: d(12),
    amount: -7000,
    payeeId: pay['Spectrum Internet'],
    payeeName: 'Spectrum Internet',
    categoryId: catId('Internet'),
    scheduleId: rec['Internet'],
    ...cr(),
  });

  // Phone
  insertTx({
    accountId: acct['Primary Checking'],
    date: d(15),
    amount: -8500,
    payeeId: pay['AT&T Wireless'],
    payeeName: 'AT&T Wireless',
    categoryId: catId('Phone'),
    scheduleId: rec['Phone Bill'],
    ...cr(),
  });

  // Natural Gas - seasonal variation, skip in current month for "upcoming" test
  const isHeating = [11, 12, 1, 2].includes(m);
  const gasNatAmt = isHeating ? randCents(60, 85) : randCents(30, 50);
  if (!isCurrentMonth) {
    insertTx({
      accountId: acct['Primary Checking'],
      date: d(18),
      amount: -gasNatAmt,
      payeeId: pay['Piedmont Natural Gas'],
      payeeName: 'Piedmont Natural Gas',
      categoryId: catId('Gas (Natural)'),
      scheduleId: rec['Natural Gas'],
      ...cr(),
    });
  }

  // Trash
  insertTx({
    accountId: acct['Primary Checking'],
    date: d(20),
    amount: -randCents(25, 35),
    payeeId: pay['Republic Services'],
    payeeName: 'Republic Services',
    categoryId: catId('Trash / Recycling'),
    ...cr(),
  });

  // ── SUBSCRIPTIONS (monthly on credit card, linked) ──
  insertTx({
    accountId: acct['Chase Credit Card'],
    date: d(3),
    amount: -1599,
    payeeId: pay['Netflix'],
    payeeName: 'Netflix',
    categoryId: catId('Streaming Services'),
    scheduleId: rec['Netflix'],
    ...cr(),
  });
  insertTx({
    accountId: acct['Chase Credit Card'],
    date: d(5),
    amount: -1099,
    payeeId: pay['Spotify'],
    payeeName: 'Spotify',
    categoryId: catId('Streaming Services'),
    scheduleId: rec['Spotify'],
    ...cr(),
  });
  insertTx({
    accountId: acct['Chase Credit Card'],
    date: d(8),
    amount: -1799,
    payeeId: pay['Hulu'],
    payeeName: 'Hulu',
    categoryId: catId('Streaming Services'),
    scheduleId: rec['Hulu'],
    ...cr(),
  });

  // Gym
  insertTx({
    accountId: acct['Chase Credit Card'],
    date: d(1),
    amount: -4500,
    payeeId: pay['Planet Fitness'],
    payeeName: 'Planet Fitness',
    categoryId: catId('Gym / Fitness'),
    scheduleId: rec['Planet Fitness'],
    ...cr(),
  });

  // ── HOUSE CLEANER (biweekly, linked) ──
  insertTx({
    accountId: acct['Primary Checking'],
    date: d(10),
    amount: -15000,
    payeeId: pay['Merry Maids'],
    payeeName: 'Merry Maids',
    categoryId: catId('Home Maintenance'),
    scheduleId: rec['House Cleaner'],
    ...cr(),
  });
  if (!isCurrentMonth || true) {
    insertTx({
      accountId: acct['Primary Checking'],
      date: d(24),
      amount: -15000,
      payeeId: pay['Merry Maids'],
      payeeName: 'Merry Maids',
      categoryId: catId('Home Maintenance'),
      scheduleId: rec['House Cleaner'],
      ...cr(),
    });
  }

  // ── WEEKLY COFFEE (4 per month at Starbucks, linked) ──
  for (const coffeeDay of [5, 12, 19, 26]) {
    if (isCurrentMonth && coffeeDay > 15) continue;
    insertTx({
      accountId: acct['Chase Credit Card'],
      date: d(coffeeDay),
      amount: -randCents(4, 8),
      payeeId: pay['Starbucks'],
      payeeName: 'Starbucks',
      categoryId: catId('Coffee Shops'),
      scheduleId: rec['Weekly Coffee'],
      ...cr(),
    });
  }

  // ── CAR INSURANCE (quarterly, linked) ──
  if (carInsuranceMonths.includes(mi)) {
    insertTx({
      accountId: acct['Primary Checking'],
      date: d(15),
      amount: -42000,
      payeeId: pay['State Farm'],
      payeeName: 'State Farm',
      categoryId: catId('Car Insurance'),
      scheduleId: rec['Car Insurance'],
      ...cr(),
    });
  }

  // ── AMAZON PRIME (yearly, linked) ──
  if (amazonPrimeMonths.includes(mi)) {
    insertTx({
      accountId: acct['Chase Credit Card'],
      date: d(20),
      amount: -13900,
      payeeId: pay['Amazon'],
      payeeName: 'Amazon',
      categoryId: catId('Electronics'),
      scheduleId: rec['Amazon Prime'],
      ...cr(),
    });
  }

  // ── OLD PHONE PLAN (canceled, linked) ──
  if (oldPhoneMonths.includes(mi)) {
    insertTx({
      accountId: acct['Primary Checking'],
      date: d(20),
      amount: -6500,
      payeeId: pay['T-Mobile'],
      payeeName: 'T-Mobile',
      categoryId: catId('Phone'),
      scheduleId: rec['Old Phone Plan'],
      ...cr(),
    });
  }

  // ── FREELANCE INCOME (paused, linked for early months) ──
  if (freelanceMonths.includes(mi)) {
    insertTx({
      accountId: acct['Primary Checking'],
      date: d(15),
      amount: randCents(1800, 2200),
      payeeId: null,
      payeeName: 'Freelance Client',
      categoryId: catId('Business Income'),
      scheduleId: rec['Freelance Income'],
      ...cr(),
    });
  }

  // ── GROCERIES (10-14 per month, 60% checking / 40% credit) ──
  const groceryCount = randInt(10, 14);
  for (let i = 0; i < groceryCount; i++) {
    const day = randInt(1, isCurrentMonth ? 20 : ld);
    const payeeName = pick(groceryPayees);
    const onCredit = Math.random() < 0.4;
    insertTx({
      accountId: onCredit ? acct['Chase Credit Card'] : acct['Primary Checking'],
      date: d(day),
      amount: -randCents(35, 155),
      payeeId: pay[payeeName],
      payeeName,
      categoryId: uncategorizedMonths.includes(mi) && i === 0 ? null : catId('Groceries'),
      notes: maybeNote(),
      ...cr(),
    });
  }

  // ── RESTAURANTS (5-8 per month, mostly credit) ──
  const restCount = randInt(5, 8);
  for (let i = 0; i < restCount; i++) {
    const day = randInt(1, isCurrentMonth ? 20 : ld);
    const payeeName = pick(restaurantPayees);
    insertTx({
      accountId: Math.random() < 0.8 ? acct['Chase Credit Card'] : acct['Primary Checking'],
      date: d(day),
      amount: -randCents(15, 82),
      payeeId: pay[payeeName],
      payeeName,
      categoryId: catId('Restaurants'),
      notes: maybeNote(),
      ...cr(),
    });
  }

  // ── FAST FOOD (2-3 per month, credit) ──
  const ffCount = randInt(2, 3);
  for (let i = 0; i < ffCount; i++) {
    const day = randInt(1, isCurrentMonth ? 20 : ld);
    const payeeName = pick(fastFoodPayees);
    insertTx({
      accountId: acct['Chase Credit Card'],
      date: d(day),
      amount: -randCents(8, 26),
      payeeId: pay[payeeName],
      payeeName,
      categoryId: catId('Fast Food'),
      notes: maybeNote(),
      ...cr(),
    });
  }

  // ── ADDITIONAL COFFEE (1-3 non-Starbucks per month) ──
  const extraCoffee = randInt(1, 3);
  for (let i = 0; i < extraCoffee; i++) {
    const day = randInt(1, isCurrentMonth ? 20 : ld);
    const payeeName = pick(["Dunkin'", 'Local Coffee Co']);
    insertTx({
      accountId: acct['Chase Credit Card'],
      date: d(day),
      amount: -randCents(4, 8),
      payeeId: pay[payeeName],
      payeeName,
      categoryId: catId('Coffee Shops'),
      notes: maybeNote(),
      ...cr(),
    });
  }

  // ── GAS (3-4 per month, checking) ──
  const gasCount = randInt(3, 4);
  for (let i = 0; i < gasCount; i++) {
    const day = randInt(1, isCurrentMonth ? 20 : ld);
    const payeeName = pick(gasPayees);
    insertTx({
      accountId: acct['Primary Checking'],
      date: d(day),
      amount: -randCents(35, 58),
      payeeId: pay[payeeName],
      payeeName,
      categoryId: catId('Gas / Fuel'),
      notes: maybeNote(),
      ...cr(),
    });
  }

  // ── SHOPPING (2-4 per month, mix of accounts) ──
  const shopCount = randInt(2, 4);
  for (let i = 0; i < shopCount; i++) {
    const day = randInt(1, isCurrentMonth ? 20 : ld);
    const payeeName = pick(shoppingPayees);
    const catName =
      payeeName === 'TJ Maxx' || payeeName === 'Nike'
        ? 'Clothing'
        : payeeName === 'Amazon'
          ? 'Electronics'
          : 'Home Goods';
    insertTx({
      accountId: Math.random() < 0.5 ? acct['Chase Credit Card'] : acct['Primary Checking'],
      date: d(day),
      amount: -randCents(18, 195),
      payeeId: pay[payeeName],
      payeeName,
      categoryId: catId(catName),
      notes: maybeNote(),
      ...cr(),
    });
  }

  // ── CASH (1-2 per month, Cash Wallet, some with no payee) ──
  const cashCount = randInt(1, 2);
  for (let i = 0; i < cashCount; i++) {
    const day = randInt(1, isCurrentMonth ? 20 : ld);
    const hasPayee = Math.random() > 0.5;
    insertTx({
      accountId: acct['Cash Wallet'],
      date: d(day),
      amount: -randCents(5, 40),
      payeeId: null,
      payeeName: hasPayee ? 'Cash Purchase' : null,
      categoryId: pick([catId('Cash / ATM'), catId('Coffee Shops'), catId('Fast Food')]),
      ...cr(),
    });
  }

  // ── BIRTHDAY UNCATEGORIZED (for rules testing) ──
  if (birthdayMonths.includes(mi)) {
    const day = randInt(10, 25);
    insertTx({
      accountId: acct['Primary Checking'],
      date: d(day),
      amount: -randCents(30, 80),
      payeeId: pay['Target'],
      payeeName: 'Target',
      categoryId: null,
      notes: 'Birthday gift for mom',
      ...cr(),
    });
  }

  // ── LARGE OCCASIONAL EXPENSES ──
  if (LARGE_EXPENSES[mi]) {
    const le = LARGE_EXPENSES[mi];
    const day = randInt(8, 22);
    insertTx({
      accountId: acct['Primary Checking'],
      date: d(day),
      amount: le.amount,
      payeeId: pay[le.payee],
      payeeName: le.payee,
      categoryId: catId(le.cat),
      notes: le.notes,
      ...cr(),
    });
  }

  // ── ENTERTAINMENT (1-2 per month) ──
  if (Math.random() < 0.7) {
    const day = randInt(1, isCurrentMonth ? 20 : ld);
    insertTx({
      accountId: acct['Chase Credit Card'],
      date: d(day),
      amount: -randCents(12, 45),
      payeeId: pay['AMC Theaters'],
      payeeName: 'AMC Theaters',
      categoryId: catId('Entertainment'),
      notes: maybeNote(),
      ...cr(),
    });
  }

  // ── ONLINE COURSE (occasional) ──
  if (mi % 4 === 2) {
    const day = randInt(5, 20);
    insertTx({
      accountId: acct['Chase Credit Card'],
      date: d(day),
      amount: -randCents(10, 50),
      payeeId: pay['Udemy'],
      payeeName: 'Udemy',
      categoryId: catId('Online Courses'),
      notes: 'Course purchase',
      ...cr(),
    });
  }

  // ── PHARMACY (every other month) ──
  if (mi % 2 === 0) {
    const day = randInt(3, 25);
    insertTx({
      accountId: acct['Primary Checking'],
      date: d(day),
      amount: -randCents(10, 55),
      payeeId: pay['CVS Pharmacy'],
      payeeName: 'CVS Pharmacy',
      categoryId: catId('Pharmacy'),
      ...cr(),
    });
  }

  // ── PERSONAL CARE (1 per month) ──
  {
    const day = randInt(1, isCurrentMonth ? 20 : ld);
    insertTx({
      accountId: Math.random() < 0.5 ? acct['Chase Credit Card'] : acct['Primary Checking'],
      date: d(day),
      amount: -randCents(8, 35),
      payeeId: pay['Target'],
      payeeName: 'Target',
      categoryId: catId('Personal Care'),
      ...cr(),
    });
  }

  // ── TRANSFERS ──

  // Checking → Savings ($500)
  insertTransfer('Primary Checking', 'Savings Account', d(25), 50000, cr().reconciled);

  // Checking → Credit Card payment
  insertTransfer(
    'Primary Checking',
    'Chase Credit Card',
    d(22),
    randCents(700, 1100),
    cr().reconciled,
  );

  // Checking → 401k ($500, off-budget)
  insertTransfer('Primary Checking', 'Vanguard 401k', d(1), 50000, cr().reconciled);

  // Checking → Emergency Fund ($250, every other month)
  if (mi % 2 === 0) {
    insertTransfer('Primary Checking', 'Emergency Fund', d(28), 25000, cr().reconciled);
  }

  // ── OLD CHECKING (first 3 months only) ──
  if (mi <= 2) {
    const txns = randInt(2, 4);
    for (let i = 0; i < txns; i++) {
      const day = randInt(1, ld);
      insertTx({
        accountId: acct['Old Checking'],
        date: d(day),
        amount: -randCents(10, 50),
        payeeId: null,
        payeeName: pick(['Corner Store', 'ATM Withdrawal', 'Misc Purchase']),
        categoryId: pick([catId('Cash / ATM'), catId('Miscellaneous')]),
        ...cr(),
      });
    }
  }

  console.log(`  ${fmtMonth(y, m)}: ${txCount} total so far`);
}

// ── SPLIT TRANSACTIONS ──

// Month 4 (Feb 2025): Costco bulk buy
{
  const { reconciled } = getCR(4);
  insertSplit(
    acct['Primary Checking'],
    fmtDate(2025, 2, 14),
    -32000,
    pay['Costco'],
    'Costco',
    [
      { categoryId: catId('Groceries'), amount: -18000, notes: 'Bulk groceries' },
      { categoryId: catId('Home Goods'), amount: -9000, notes: 'Paper towels & cleaning' },
      { categoryId: catId('Electronics'), amount: -5000, notes: 'USB cables' },
    ],
    reconciled,
  );
}

// Month 10 (Aug 2025): Target run
{
  const { reconciled } = getCR(10);
  insertSplit(
    acct['Primary Checking'],
    fmtDate(2025, 8, 8),
    -21500,
    pay['Target'],
    'Target',
    [
      { categoryId: catId('Clothing'), amount: -12000, notes: 'Back to school clothes' },
      { categoryId: catId('Home Goods'), amount: -9500, notes: 'Bedding set' },
    ],
    reconciled,
  );
}

// Month 16 (Feb 2026): Amazon order
{
  const { reconciled } = getCR(16);
  insertSplit(
    acct['Chase Credit Card'],
    fmtDate(2026, 2, 20),
    -17500,
    pay['Amazon'],
    'Amazon',
    [
      { categoryId: catId('Electronics'), amount: -12500, notes: 'Wireless mouse + stand' },
      { categoryId: catId('Home Goods'), amount: -5000, notes: 'Desk organizer' },
    ],
    reconciled,
  );
}

// Month 21 (Jul 2026): Vacation trip
{
  const { reconciled } = getCR(21);
  insertSplit(
    acct['Primary Checking'],
    fmtDate(2026, 7, 10),
    -180000,
    pay['United Airlines'],
    'United Airlines',
    [
      { categoryId: catId('Flights'), amount: -90000, notes: 'Round trip flights' },
      { categoryId: catId('Hotels'), amount: -65000, notes: '4 nights hotel' },
      { categoryId: catId('Restaurants'), amount: -25000, notes: 'Dining while traveling' },
    ],
    reconciled,
  );
}

console.log(`Rich seed: ${txCount} transactions created.`);

// ═══════════════════════════════════════════════════════
// PHASE 5: Budget Months
// ═══════════════════════════════════════════════════════

console.log('Rich seed: Inserting budget months...');

const BUDGET_TEMPLATE: Record<string, number> = {
  'Rent / Mortgage': 180000,
  Groceries: 60000,
  Restaurants: 30000,
  'Fast Food': 10000,
  'Coffee Shops': 8000,
  'Gas / Fuel': 15000,
  Electric: 12000,
  Water: 5000,
  'Gas (Natural)': 6000,
  Internet: 7000,
  Phone: 8500,
  'Trash / Recycling': 3000,
  'Streaming Services': 5000,
  'Car Insurance': 14000,
  'Gym / Fitness': 4500,
  Clothing: 10000,
  Electronics: 10000,
  'Home Goods': 5000,
  'Home Maintenance': 15000,
  'Doctor / Medical': 5000,
  Pharmacy: 3000,
  Entertainment: 5000,
  'Personal Care': 3000,
  Savings: 50000,
  Gifts: 5000,
  'Online Courses': 2000,
};

// Which categories to budget in current month (subset for edge case)
const currentMonthBudgeted = new Set([
  'Rent / Mortgage',
  'Groceries',
  'Restaurants',
  'Gas / Fuel',
  'Electric',
  'Water',
  'Internet',
  'Phone',
  'Streaming Services',
  'Gym / Fitness',
  'Savings',
  'Car Insurance',
]);

// Months where restaurant budget is halved (tests overspent)
const overbudgetRestaurantMonths = [3, 7, 13, 19];

let budgetCount = 0;
for (let mi = 0; mi < 24; mi++) {
  const { year: y, month: m } = getYM(mi);
  const monthStr = fmtMonth(y, m);

  for (const [catName, baseAmount] of Object.entries(BUDGET_TEMPLATE)) {
    let budgeted = baseAmount;
    let notes: string | null = null;

    // Current month: only budget a subset
    if (mi === 23 && !currentMonthBudgeted.has(catName)) continue;

    // Overspent months: halve restaurant budget
    if (overbudgetRestaurantMonths.includes(mi) && catName === 'Restaurants') {
      budgeted = 15000;
      notes = 'Reduced - trying to save this month';
    }

    // Month 17: zero home maintenance budget (but there's a $900 expense)
    if (mi === 17 && catName === 'Home Maintenance') {
      budgeted = 0;
    }

    // Holiday months: increase gifts budget
    if ((mi === 2 || mi === 14) && catName === 'Gifts') {
      budgeted = 25000;
      notes = 'Increased for holidays';
    }

    // Slight random variation on some categories
    if (['Groceries', 'Restaurants', 'Gas / Fuel', 'Entertainment'].includes(catName)) {
      budgeted += randInt(-2000, 2000);
    }

    db.insert(budgetMonths)
      .values({
        id: nanoid(),
        month: monthStr,
        categoryId: catId(catName),
        budgeted,
        notes,
      })
      .run();
    budgetCount++;
  }
}

console.log(`Rich seed: ${budgetCount} budget entries created.`);

// ═══════════════════════════════════════════════════════
// PHASE 6: Rules
// ═══════════════════════════════════════════════════════

console.log('Rich seed: Inserting rules...');

const RULE_DEFS = [
  {
    conditions: [{ field: 'payee_name', op: 'contains', value: 'Kroger' }],
    actions: [{ field: 'category_id', value: catId('Groceries') }],
  },
  {
    conditions: [{ field: 'payee_name', op: 'contains', value: 'Trader Joe' }],
    actions: [{ field: 'category_id', value: catId('Groceries') }],
  },
  {
    conditions: [{ field: 'payee_name', op: 'contains', value: 'Netflix' }],
    actions: [{ field: 'category_id', value: catId('Streaming Services') }],
  },
  {
    conditions: [{ field: 'payee_name', op: 'contains', value: 'Spotify' }],
    actions: [{ field: 'category_id', value: catId('Streaming Services') }],
  },
  {
    conditions: [{ field: 'payee_name', op: 'contains', value: 'Shell' }],
    actions: [{ field: 'category_id', value: catId('Gas / Fuel') }],
  },
  {
    conditions: [{ field: 'payee_name', op: 'contains', value: 'Exxon' }],
    actions: [{ field: 'category_id', value: catId('Gas / Fuel') }],
  },
  {
    conditions: [{ field: 'payee_name', op: 'starts_with', value: 'Amazon' }],
    actions: [{ field: 'category_id', value: catId('Electronics') }],
  },
  {
    conditions: [{ field: 'payee_name', op: 'contains', value: 'Starbucks' }],
    actions: [{ field: 'category_id', value: catId('Coffee Shops') }],
  },
  {
    conditions: [{ field: 'notes', op: 'contains', value: 'birthday' }],
    actions: [{ field: 'category_id', value: catId('Gifts') }],
  },
  {
    conditions: [{ field: 'payee_name', op: 'exact', value: 'Chipotle' }],
    actions: [{ field: 'category_id', value: catId('Restaurants') }],
  },
];

RULE_DEFS.forEach((r, i) => {
  db.insert(rules)
    .values({
      id: nanoid(),
      conditions: JSON.stringify(r.conditions),
      actions: JSON.stringify(r.actions),
      sortOrder: i,
      createdAt: now,
    })
    .run();
});

// ═══════════════════════════════════════════════════════
// PHASE 7: Custom Reports
// ═══════════════════════════════════════════════════════

console.log('Rich seed: Inserting custom reports...');

const REPORT_DEFS = [
  {
    name: 'Monthly Spending by Category',
    config: {
      chartType: 'donut',
      mode: 'total',
      groupBy: 'category',
      balanceType: 'expense',
      dateRange: { preset: '3m', from: '2026-07', to: '2026-09' },
      filters: { accountIds: [], categoryIds: [], categoryGroupIds: [] },
    },
  },
  {
    name: 'Income vs Expenses Trend',
    config: {
      chartType: 'stacked-bar',
      mode: 'time',
      groupBy: 'categoryGroup',
      balanceType: 'net',
      dateRange: { preset: '12m', from: '2025-10', to: '2026-09' },
      filters: { accountIds: [], categoryIds: [], categoryGroupIds: [] },
    },
  },
  {
    name: 'Top Payees This Year',
    config: {
      chartType: 'bar',
      mode: 'total',
      groupBy: 'payee',
      balanceType: 'expense',
      dateRange: { preset: 'ytd', from: '2026-01', to: '2026-09' },
      filters: { accountIds: [], categoryIds: [], categoryGroupIds: [] },
    },
  },
  {
    name: 'Spending Trends',
    config: {
      chartType: 'line',
      mode: 'time',
      groupBy: 'category',
      balanceType: 'expense',
      dateRange: { preset: '6m', from: '2026-04', to: '2026-09' },
      filters: {
        accountIds: [],
        categoryIds: [catId('Groceries'), catId('Restaurants'), catId('Gas / Fuel')],
        categoryGroupIds: [],
      },
    },
  },
  {
    name: 'Account Activity',
    config: {
      chartType: 'area',
      mode: 'time',
      groupBy: 'account',
      balanceType: 'net',
      dateRange: { preset: 'last-year', from: '2025-01', to: '2025-12' },
      filters: { accountIds: [], categoryIds: [], categoryGroupIds: [] },
    },
  },
  {
    name: 'Category Group Summary',
    config: {
      chartType: 'table',
      mode: 'total',
      groupBy: 'categoryGroup',
      balanceType: 'expense',
      dateRange: { preset: 'all', from: '2024-10', to: '2026-09' },
      filters: { accountIds: [], categoryIds: [], categoryGroupIds: [] },
    },
  },
  {
    name: 'Monthly Expense Totals',
    config: {
      chartType: 'bar',
      mode: 'total',
      groupBy: 'month',
      balanceType: 'expense',
      dateRange: { preset: 'custom', from: '2025-01', to: '2025-12' },
      filters: { accountIds: [], categoryIds: [], categoryGroupIds: [] },
    },
  },
  {
    name: 'Income Sources',
    config: {
      chartType: 'donut',
      mode: 'total',
      groupBy: 'category',
      balanceType: 'income',
      dateRange: { preset: 'ytd', from: '2026-01', to: '2026-09' },
      filters: { accountIds: [], categoryIds: [], categoryGroupIds: [] },
    },
  },
];

REPORT_DEFS.forEach((r, i) => {
  db.insert(customReports)
    .values({
      id: nanoid(),
      name: r.name,
      config: JSON.stringify(r.config),
      sortOrder: i,
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

// ═══════════════════════════════════════════════════════
// PHASE 8: Goals
// ═══════════════════════════════════════════════════════

console.log('Rich seed: Inserting goals...');

const GOAL_DEFS = [
  {
    name: 'Emergency Fund',
    targetAmount: 1000000,
    currentAmount: 750000,
    targetDate: '2027-03-21',
    accountId: acct['Emergency Fund'],
    icon: '🛡️',
    color: '#059669',
  },
  {
    name: 'Vacation Fund',
    targetAmount: 300000,
    currentAmount: 120000,
    targetDate: '2026-12-21',
    accountId: null,
    icon: '✈️',
    color: '#7C3AED',
  },
  {
    name: 'New Laptop',
    targetAmount: 200000,
    currentAmount: 200000,
    targetDate: '2026-06-01',
    accountId: null,
    icon: '💻',
    color: '#2563EB',
  },
  {
    name: 'Holiday Gifts',
    targetAmount: 50000,
    currentAmount: 0,
    targetDate: '2026-12-25',
    accountId: null,
    icon: '🎁',
    color: '#DC2626',
  },
  {
    name: 'Car Down Payment',
    targetAmount: 500000,
    currentAmount: 80000,
    targetDate: '2026-06-01',
    accountId: null,
    icon: '🚗',
    color: '#D97706',
  },
];

GOAL_DEFS.forEach((g, i) => {
  db.insert(goals)
    .values({
      id: nanoid(),
      name: g.name,
      targetAmount: g.targetAmount,
      currentAmount: g.currentAmount,
      targetDate: g.targetDate,
      accountId: g.accountId,
      icon: g.icon,
      color: g.color,
      sortOrder: i,
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

// ═══════════════════════════════════════════════════════

console.log(`\nRich seed complete!`);
console.log(`  Accounts: ${ACCOUNT_DEFS.length}`);
console.log(`  Payees: ${PAYEE_DEFS.length}`);
console.log(`  Schedules: ${REC_DEFS.length}`);
console.log(`  Transactions: ${txCount}`);
console.log(`  Budget entries: ${budgetCount}`);
console.log(`  Rules: ${RULE_DEFS.length}`);
console.log(`  Custom reports: ${REPORT_DEFS.length}`);
console.log(`  Goals: ${GOAL_DEFS.length}`);
