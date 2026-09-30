/**
 * The demo budget: a couple with a median household income, about 18 months of history
 * ending today, with every feature in use (see README in ../browser). Pure: it takes today's
 * date and returns rows, the same rows every time for the same day (a seeded random
 * generator, readable ids), so a visitor always sees a coherent, finished-looking budget.
 */
import {
  addDays,
  addMonths,
  format,
  getDay,
  lastDayOfMonth,
  parseISO,
  startOfMonth,
  subDays,
  subMonths,
} from 'date-fns';
import type {
  accounts,
  budgetMonths,
  categories,
  categoryGroups,
  customReports,
  dashboardPages,
  dashboardWidgets,
  goals,
  payees,
  rules,
  schedules,
  transactions,
} from '../db/schema.js';
import {
  buildRecurrenceRule,
  computeOccurrenceDates,
  type RecurrenceRule,
  type RecurrenceType,
} from '../utils/recurrence.js';
import type { Action, Condition } from '../services/rulesEngine.js';
import { DEMO_LOGOS, type DemoLogo } from './logos.js';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export interface ScheduleLink {
  scheduleId: string;
  scheduledDate: string;
  /** The payment, or null for an occurrence the couple skipped */
  transactionId: string | null;
}

export interface DemoBudget {
  categoryGroups: Row<typeof categoryGroups>[];
  categories: Row<typeof categories>[];
  accounts: Row<typeof accounts>[];
  payees: Row<typeof payees>[];
  schedules: Row<typeof schedules>[];
  transactions: Row<typeof transactions>[];
  /** Past occurrences to mark paid (linked to their transaction) or skipped */
  scheduleLinks: ScheduleLink[];
  budgetMonths: Row<typeof budgetMonths>[];
  rules: Row<typeof rules>[];
  customReports: Row<typeof customReports>[];
  dashboardPages: Row<typeof dashboardPages>[];
  dashboardWidgets: Row<typeof dashboardWidgets>[];
  goals: Row<typeof goals>[];
}

// ─── Random numbers ────────────────────────────────────────────────────────────

/** mulberry32: small, fast, and the same sequence for the same seed */
function seededRandom(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── The budget's structure ───────────────────────────────────────────────────

type BudgetType = 'fixed' | 'flexible' | 'non_monthly';

/** Category groups and categories: key → [name, icon, budget type] */
const GROUPS: {
  key: string;
  name: string;
  isIncome?: boolean;
  cats: [string, string, string, BudgetType?][];
}[] = [
  {
    key: 'income',
    name: 'Income',
    isIncome: true,
    cats: [
      ['paychecks', 'Paychecks', '💵'],
      ['interest', 'Interest', '💹'],
      ['otherIncome', 'Other Income', '💰'],
    ],
  },
  {
    key: 'housing',
    name: 'Housing',
    cats: [
      ['rent', 'Rent', '🏠', 'fixed'],
      ['rentersInsurance', 'Renters Insurance', '🛡️', 'fixed'],
      ['homeGoods', 'Home Goods', '🛋️', 'flexible'],
    ],
  },
  {
    key: 'bills',
    name: 'Bills & Utilities',
    cats: [
      ['electric', 'Electric', '⚡', 'fixed'],
      ['internet', 'Internet', '🌐', 'fixed'],
      ['phone', 'Phone', '📱', 'fixed'],
      ['streaming', 'Streaming', '📺', 'fixed'],
    ],
  },
  {
    key: 'food',
    name: 'Food & Dining',
    cats: [
      ['groceries', 'Groceries', '🛒', 'flexible'],
      ['restaurants', 'Restaurants', '🍽️', 'flexible'],
      ['coffee', 'Coffee Shops', '☕', 'flexible'],
    ],
  },
  {
    key: 'transport',
    name: 'Transportation',
    cats: [
      ['carPayment', 'Car Payment', '🚗', 'fixed'],
      ['carInsurance', 'Car Insurance', '🛡️', 'fixed'],
      ['gas', 'Gas', '⛽', 'flexible'],
      ['carMaintenance', 'Car Maintenance', '🔧', 'non_monthly'],
    ],
  },
  {
    key: 'health',
    name: 'Health & Wellness',
    cats: [
      ['gym', 'Gym', '🏋️', 'fixed'],
      ['pharmacy', 'Pharmacy', '💊', 'flexible'],
      ['medical', 'Doctor & Dentist', '🩺', 'non_monthly'],
    ],
  },
  {
    key: 'lifestyle',
    name: 'Lifestyle',
    cats: [
      ['clothing', 'Clothing', '👕', 'flexible'],
      ['personalCare', 'Personal Care', '✨', 'flexible'],
      ['pets', 'Biscuit (dog)', '🐶', 'flexible'],
      ['entertainment', 'Entertainment', '🎬', 'flexible'],
      ['electronics', 'Electronics', '💻', 'non_monthly'],
    ],
  },
  {
    key: 'giving',
    name: 'Gifts & Giving',
    cats: [
      ['gifts', 'Gifts', '🎁', 'non_monthly'],
      ['charity', 'Charity', '❤️', 'fixed'],
    ],
  },
  {
    key: 'goals',
    name: 'Savings Goals',
    cats: [
      ['vacation', 'Vacation', '🏖️', 'non_monthly'],
      ['emergencyFund', 'Emergency Fund', '🛟', 'non_monthly'],
    ],
  },
];

type CategoryKey = (typeof GROUPS)[number]['cats'][number][0];

const ACCOUNTS: {
  key: string;
  name: string;
  type: string;
  offBudget?: boolean;
  logo: DemoLogo;
  startingBalance?: number;
}[] = [
  { key: 'checking', name: 'Harbor Checking', type: 'checking', logo: 'harbor' },
  { key: 'savings', name: 'Harbor Savings', type: 'savings', logo: 'harborSavings' },
  { key: 'card', name: 'Summit Rewards Card', type: 'credit', logo: 'summit' },
  {
    key: 'retirement',
    name: 'Evergreen 401(k)',
    type: 'retirement',
    offBudget: true,
    logo: 'evergreen',
    startingBalance: 1_842_000,
  },
  {
    key: 'brokerage',
    name: 'Pinecone Brokerage',
    type: 'investment',
    offBudget: true,
    logo: 'pinecone',
    startingBalance: 615_000,
  },
  {
    key: 'carLoan',
    name: 'Northstar Auto Loan',
    type: 'auto_loan',
    offBudget: true,
    logo: 'northstar',
    startingBalance: -1_795_000,
  },
  {
    key: 'car',
    name: '2021 Crossover',
    type: 'vehicle',
    offBudget: true,
    logo: 'vehicle',
    startingBalance: 2_450_000,
  },
];

type AccountKey = 'checking' | 'savings' | 'card' | 'retirement' | 'brokerage' | 'carLoan' | 'car';

/** Payees: key → [name, logo, default category, raw bank text] */
const PAYEES: Record<string, [string, DemoLogo, CategoryKey | null, string | null]> = {
  brightwave: ['Brightwave Studio', 'brightwave', 'paychecks', 'BRIGHTWAVE STUDIO PAYROLL'],
  cedarHealth: ['Cedar Health', 'cedarHealth', 'paychecks', 'CEDAR HEALTH DIR DEP'],
  harbor: ['Harbor Bank', 'harbor', 'interest', null],
  mapleCourt: ['Maple Court Apartments', 'mapleCourt', 'rent', 'MAPLE COURT APTS WEBPAY'],
  shieldwell: ['Shieldwell Insurance', 'shieldwell', 'carInsurance', 'SHIELDWELL INS PREMIUM'],
  cityPower: ['City Power & Light', 'cityPower', 'electric', 'CITY POWER LIGHT AUTOPAY'],
  loopFiber: ['Loop Fiber', 'loopFiber', 'internet', 'LOOP FIBER INTERNET'],
  nimbus: ['Nimbus Mobile', 'nimbus', 'phone', 'NIMBUS MOBILE BILL PAY'],
  streamline: ['Streamline', 'streamline', 'streaming', 'STREAMLINE.TV'],
  tuneful: ['Tuneful', 'tuneful', 'streaming', 'TUNEFUL*PREMIUM'],
  flexplay: ['FlexPlay', 'flexplay', 'streaming', 'FLEXPLAY SUBSCRIPTION'],
  peakFitness: ['Peak Fitness', 'peakFitness', 'gym', 'PEAK FITNESS CLUB'],
  freshFields: ['Fresh Fields Market', 'freshFields', 'groceries', 'FRESH FIELDS MKT #0221'],
  costwise: ['Costwise Warehouse', 'costwise', 'groceries', 'COSTWISE WHSE #0487'],
  cornerGrocer: ['Corner Grocer', 'cornerGrocer', 'groceries', 'CORNER GROCER'],
  dailyGrind: ['Daily Grind Coffee', 'dailyGrind', 'coffee', 'SQ *DAILY GRIND 1142'],
  luigis: ["Luigi's Trattoria", 'luigis', 'restaurants', 'LUIGIS TRATTORIA'],
  tacoLuna: ['Taco Luna', 'tacoLuna', 'restaurants', 'TST* TACO LUNA'],
  sakura: ['Sakura Sushi', 'sakura', 'restaurants', 'SAKURA SUSHI BAR'],
  burgerBarn: ['Burger Barn', 'burgerBarn', 'restaurants', 'BURGER BARN #12'],
  fuelStop: ['Fuel Stop', 'fuelStop', 'gas', 'FUEL STOP 00318'],
  quickLube: ['QuickLube Auto Care', 'quickLube', 'carMaintenance', 'QUICKLUBE AUTO CARE'],
  northstar: ['Northstar Credit Union', 'northstar', 'carPayment', 'NORTHSTAR CU LOAN PMT'],
  evergreen: ['Evergreen Retirement', 'evergreen', null, null],
  pinecone: ['Pinecone Invest', 'pinecone', null, null],
  wellway: ['Wellway Pharmacy', 'wellway', 'pharmacy', 'WELLWAY PHARMACY #0921'],
  riverside: ['Riverside Clinic', 'riverside', 'medical', 'RIVERSIDE CLINIC COPAY'],
  threadline: ['Threadline', 'threadline', 'clothing', 'THREADLINE ONLINE'],
  hearthHome: ['Hearth & Home', 'hearthHome', 'homeGoods', 'HEARTH AND HOME #88'],
  parcel: ['Parcel', 'parcel', null, 'PARCEL.COM*ORDER'],
  glow: ['Glow Beauty', 'glow', 'personalCare', 'GLOW BEAUTY'],
  happyPaws: ['Happy Paws Pet Supply', 'happyPaws', 'pets', 'HAPPY PAWS PET SUPPLY'],
  oakwoodVet: ['Oakwood Vet', 'oakwoodVet', 'pets', 'OAKWOOD VETERINARY'],
  skyhop: ['SkyHop Airlines', 'skyhop', 'vacation', 'SKYHOP AIR 0271'],
  lakesideInn: ['Lakeside Inn', 'lakesideInn', 'vacation', 'LAKESIDE INN'],
  cineplex: ['Cineplex 8', 'cineplex', 'entertainment', 'CINEPLEX 8 TICKETS'],
  kindred: ['Kindred Food Bank', 'kindred', 'charity', 'KINDRED FOOD BANK'],
};

type PayeeKey = keyof typeof PAYEES;

const MONTHS_OF_HISTORY = 18;

// ─── Building it ────────────────────────────────────────────────────────────────

export function buildDemoBudget(today: Date): DemoBudget {
  const rand = seededRandom(20260929);
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const chance = (p: number) => rand() < p;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

  const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
  const todayStr = ymd(today);
  const firstMonth = startOfMonth(subMonths(today, MONTHS_OF_HISTORY - 1));
  const monthStarts = Array.from({ length: MONTHS_OF_HISTORY }, (_, i) => addMonths(firstMonth, i));
  const monthKey = (d: Date) => format(d, 'yyyy-MM');
  const currentMonth = monthKey(today);
  const reconciledBefore = ymd(subDays(today, 40));
  /** A date in month `m` (clamped to its last day), or null if it hasn't happened yet */
  const dayIn = (m: Date, day: number): string | null => {
    const d = ymd(
      new Date(m.getFullYear(), m.getMonth(), Math.min(day, lastDayOfMonth(m).getDate())),
    );
    return d <= todayStr ? d : null;
  };

  // Categories
  const cat = {} as Record<CategoryKey, string>;
  const result: DemoBudget = {
    categoryGroups: [],
    categories: [],
    accounts: [],
    payees: [],
    schedules: [],
    transactions: [],
    scheduleLinks: [],
    budgetMonths: [],
    rules: [],
    customReports: [],
    dashboardPages: [],
    dashboardWidgets: [],
    goals: [],
  };
  const budgetTypes = {} as Record<CategoryKey, BudgetType | undefined>;
  GROUPS.forEach((group, gi) => {
    const groupId = `demo-group-${group.key}`;
    result.categoryGroups.push({
      id: groupId,
      name: group.name,
      isIncome: group.isIncome ? 1 : 0,
      sortOrder: gi,
    });
    group.cats.forEach(([key, name, icon, budgetType], ci) => {
      cat[key as CategoryKey] = `demo-cat-${key}`;
      budgetTypes[key as CategoryKey] = budgetType;
      result.categories.push({
        id: `demo-cat-${key}`,
        groupId,
        name,
        icon,
        budgetType: budgetType ?? null,
        sortOrder: ci,
      });
    });
  });

  // Accounts
  const acct = {} as Record<AccountKey, string>;
  const accountNames = {} as Record<AccountKey, string>;
  ACCOUNTS.forEach((a, i) => {
    acct[a.key as AccountKey] = `demo-acct-${a.key}`;
    accountNames[a.key as AccountKey] = a.name;
    result.accounts.push({
      id: `demo-acct-${a.key}`,
      name: a.name,
      type: a.type,
      startingBalance: a.startingBalance ?? 0,
      isOffBudget: a.offBudget ? 1 : 0,
      sortOrder: i,
      logo: DEMO_LOGOS[a.logo],
      createdAt: `${ymd(firstMonth)} 09:00:00`,
    });
  });

  // Payees
  for (const [key, [name, logo, defaultCategory]] of Object.entries(PAYEES)) {
    result.payees.push({
      id: `demo-payee-${key}`,
      name,
      logo: DEMO_LOGOS[logo],
      defaultCategoryId: defaultCategory ? cat[defaultCategory] : null,
      createdAt: `${ymd(firstMonth)} 09:00:00`,
    });
  }

  // ─── Transactions ────────────────────────────────────────────────────────────
  let txCount = 0;
  const nextTxId = () => `demo-tx-${String(++txCount).padStart(5, '0')}`;

  function add(t: {
    account: AccountKey;
    date: string;
    amount: number;
    payee?: PayeeKey;
    category?: CategoryKey | null;
    notes?: string;
    adjustment?: boolean;
  }): string {
    const id = nextTxId();
    const payee = t.payee ? PAYEES[t.payee] : null;
    result.transactions.push({
      id,
      accountId: acct[t.account],
      date: t.date,
      amount: t.amount,
      payeeId: t.payee ? `demo-payee-${t.payee}` : null,
      payeeName: payee?.[0] ?? null,
      // Everything except adjustments gets its payee's category unless told otherwise
      categoryId:
        t.category === null
          ? null
          : t.category
            ? cat[t.category]
            : payee?.[2] && !t.adjustment
              ? cat[payee[2]]
              : null,
      notes: t.notes ?? null,
      reconciled: t.date < reconciledBefore ? 1 : 0,
      importedPayee: payee?.[3] ?? null,
      isAdjustment: t.adjustment ? 1 : 0,
    });
    return id;
  }

  function transfer(
    from: AccountKey,
    to: AccountKey,
    date: string,
    amount: number,
    notes?: string,
  ) {
    const outId = nextTxId();
    const inId = nextTxId();
    const reconciled = date < reconciledBefore ? 1 : 0;
    result.transactions.push(
      {
        id: outId,
        accountId: acct[from],
        date,
        amount: -amount,
        payeeName: `Transfer: ${accountNames[to]}`,
        transferTransactionId: inId,
        notes: notes ?? null,
        reconciled,
      },
      {
        id: inId,
        accountId: acct[to],
        date,
        amount,
        payeeName: `Transfer: ${accountNames[from]}`,
        transferTransactionId: outId,
        notes: notes ?? null,
        reconciled,
      },
    );
    return outId;
  }

  function split(
    account: AccountKey,
    date: string,
    payee: PayeeKey,
    parts: [CategoryKey, number][],
    notes?: string,
  ) {
    const parentId = nextTxId();
    const total = parts.reduce((s, [, a]) => s + a, 0);
    const [name, , , imported] = PAYEES[payee];
    const reconciled = date < reconciledBefore ? 1 : 0;
    const base = {
      accountId: acct[account],
      date,
      payeeId: `demo-payee-${payee}`,
      payeeName: name,
      importedPayee: imported,
      reconciled,
    };
    result.transactions.push({
      ...base,
      id: parentId,
      amount: total,
      isParent: 1,
      notes: notes ?? null,
    });
    for (const [category, amount] of parts) {
      result.transactions.push({
        ...base,
        id: nextTxId(),
        amount,
        categoryId: cat[category],
        parentTransactionId: parentId,
      });
    }
  }

  // ─── Recurring bills and paychecks (schedules) ──────────────────────────────
  interface ScheduleSpec {
    key: string;
    name: string;
    payee?: PayeeKey;
    account: AccountKey;
    transferTo?: AccountKey;
    category?: CategoryKey;
    amount: number;
    amountType?: 'exact' | 'approximate' | 'variable';
    type: RecurrenceType;
    /** First occurrence */
    start: string;
    rule?: RecurrenceRule;
    end?: string;
    status?: 'active' | 'paused' | 'canceled';
    weekendAdjust?: 'none' | 'before' | 'after';
    /** The amount paid on a given occurrence (defaults to `amount`) */
    paid?: (date: string, index: number) => number;
    /** Occurrences the couple skipped */
    skipped?: (date: string) => boolean;
    /** Paid, but not yet linked to its occurrence: the Recurring page suggests the match */
    unlinked?: (date: string) => boolean;
    notes?: string;
  }

  const start = ymd(firstMonth);
  const monthlyOn = (day: number) =>
    ymd(new Date(firstMonth.getFullYear(), firstMonth.getMonth(), day));
  // The first Friday of the history, for Riley's every-other-Friday paychecks
  const firstFriday = addDays(firstMonth, (5 - getDay(firstMonth) + 7) % 7);
  const raiseDate = ymd(addMonths(firstMonth, 9));
  // The monthly donation falls due two days ago, so the Recurring page has one "due" item
  const donationDay = Math.min(subDays(today, 2).getDate(), 28);
  // Electric bills follow the seasons (more in winter and summer)
  const electric = (date: string) => {
    const m = parseISO(date).getMonth();
    const seasonal = [138, 126, 104, 82, 70, 88, 118, 124, 96, 76, 92, 128][m];
    return -Math.round((seasonal + (rand() * 10 - 5)) * 100);
  };

  const scheduleSpecs: ScheduleSpec[] = [
    {
      key: 'paycheckRiley',
      name: "Riley's paycheck",
      payee: 'brightwave',
      account: 'checking',
      amount: 153_110,
      amountType: 'approximate',
      type: 'biweekly',
      start: ymd(firstFriday),
      paid: (date) => (date < raiseDate ? 148_652 : 153_110),
    },
    {
      key: 'paycheckSam',
      name: "Sam's paycheck",
      payee: 'cedarHealth',
      account: 'checking',
      amount: 126_240,
      type: 'semimonthly',
      start: monthlyOn(15),
      rule: { type: 'semimonthly', day1: 15, day2: 31 },
      weekendAdjust: 'before',
    },
    {
      key: 'rent',
      name: 'Rent',
      payee: 'mapleCourt',
      account: 'checking',
      amount: -185_000,
      type: 'monthly',
      start: monthlyOn(1),
    },
    {
      key: 'carPayment',
      name: 'Car payment',
      payee: 'northstar',
      account: 'checking',
      amount: -38_900,
      type: 'monthly',
      start: monthlyOn(20),
    },
    {
      key: 'electric',
      name: 'Electric bill',
      payee: 'cityPower',
      account: 'checking',
      amount: -9_800,
      amountType: 'approximate',
      type: 'monthly',
      start: monthlyOn(18),
      paid: electric,
    },
    {
      key: 'internet',
      name: 'Internet',
      payee: 'loopFiber',
      account: 'card',
      amount: -6_500,
      type: 'monthly',
      start: monthlyOn(9),
    },
    {
      key: 'phone',
      name: 'Phone plan',
      payee: 'nimbus',
      account: 'card',
      amount: -9_000,
      type: 'monthly',
      start: monthlyOn(22),
    },
    {
      key: 'streamline',
      name: 'Streamline',
      payee: 'streamline',
      account: 'card',
      amount: -1_549,
      type: 'monthly',
      start: monthlyOn(5),
    },
    {
      key: 'flexplay',
      name: 'FlexPlay',
      payee: 'flexplay',
      account: 'card',
      amount: -1_199,
      type: 'monthly',
      start: monthlyOn(11),
      end: ymd(subMonths(today, 5)),
      status: 'canceled',
      notes: 'Canceled: we only watched one show',
    },
    {
      key: 'gym',
      name: 'Gym membership',
      payee: 'peakFitness',
      account: 'card',
      amount: -4_900,
      type: 'monthly',
      start: monthlyOn(3),
      // Paused for a month while Riley's knee healed
      skipped: (date) => date.slice(0, 7) === monthKey(subMonths(today, 7)),
    },
    {
      key: 'carInsurance',
      name: 'Car insurance',
      payee: 'shieldwell',
      account: 'card',
      amount: -14_200,
      type: 'monthly',
      start: monthlyOn(12),
    },
    {
      key: 'rentersInsurance',
      name: 'Renters insurance',
      payee: 'shieldwell',
      account: 'card',
      category: 'rentersInsurance',
      amount: -1_800,
      type: 'monthly',
      start: monthlyOn(26),
    },
    {
      key: 'savings',
      name: 'Move to savings',
      account: 'checking',
      transferTo: 'savings',
      amount: -90_000,
      type: 'monthly',
      start: monthlyOn(2),
    },
    {
      key: 'donation',
      name: 'Food bank donation',
      payee: 'kindred',
      account: 'checking',
      amount: -2_500,
      type: 'monthly',
      start: monthlyOn(donationDay),
      // The latest one came through the bank but isn't linked yet: Recurring asks to match it
      unlinked: (date) => date >= ymd(subDays(today, 5)),
    },
    {
      key: 'dogFood',
      name: "Biscuit's food",
      payee: 'happyPaws',
      account: 'card',
      amount: -5_800,
      amountType: 'approximate',
      type: 'weekly',
      start: ymd(addDays(firstMonth, 6)),
      rule: { type: 'weekly', interval: 4, anchorDay: getDay(addDays(firstMonth, 6)) },
      paid: () => -between(5_400, 6_300),
    },
  ];

  for (const spec of scheduleSpecs) {
    const scheduleId = `demo-schedule-${spec.key}`;
    const rule = spec.rule ?? buildRecurrenceRule(spec.type, spec.start);
    result.schedules.push({
      id: scheduleId,
      name: spec.name,
      amount: spec.amount,
      amountType: spec.amountType ?? 'exact',
      recurrenceType: spec.type,
      recurrenceRule: JSON.stringify(rule),
      startDate: spec.start,
      endDate: spec.end ?? null,
      weekendAdjust: spec.weekendAdjust ?? 'none',
      accountId: acct[spec.account],
      transferAccountId: spec.transferTo ? acct[spec.transferTo] : null,
      categoryId: spec.category
        ? cat[spec.category]
        : spec.payee && PAYEES[spec.payee][2]
          ? cat[PAYEES[spec.payee][2]!]
          : null,
      payeeId: spec.payee ? `demo-payee-${spec.payee}` : null,
      notes: spec.notes ?? null,
      status: spec.status ?? 'active',
      source: 'manual',
      // Canceled schedules get no occurrences; mark this one done so the server's startup
      // upgrade of old schedules doesn't create them
      occurrenceHorizon: spec.status === 'canceled' ? (spec.end ?? null) : null,
      createdAt: `${start} 09:00:00`,
      updatedAt: `${start} 09:00:00`,
    });

    const dates = computeOccurrenceDates(
      {
        startDate: spec.start,
        endDate: spec.end ?? null,
        recurrenceType: spec.type,
        recurrenceRule: rule,
        weekendAdjust: spec.weekendAdjust ?? 'none',
      },
      spec.start,
      todayStr,
    );
    dates.forEach(({ scheduledDate, expectedDate }, i) => {
      if (spec.skipped?.(expectedDate)) {
        result.scheduleLinks.push({ scheduleId, scheduledDate, transactionId: null });
        return;
      }
      const amount = spec.paid?.(expectedDate, i) ?? spec.amount;
      const transactionId = spec.transferTo
        ? transfer(spec.account, spec.transferTo, expectedDate, -amount, 'Monthly savings')
        : add({
            account: spec.account,
            date: expectedDate,
            amount,
            payee: spec.payee,
            category: spec.category,
          });
      // A canceled schedule has no occurrences left to link
      if (spec.status !== 'canceled' && !spec.unlinked?.(expectedDate)) {
        result.scheduleLinks.push({ scheduleId, scheduledDate, transactionId });
      }
    });
  }

  // The music subscription was never added as recurring: "Find recurring" spots it
  for (const m of monthStarts) {
    const date = dayIn(m, 14);
    if (date) add({ account: 'card', date, amount: -1_699, payee: 'tuneful' });
  }

  // ─── Everyday spending ──────────────────────────────────────────────────────
  monthStarts.forEach((m, mi) => {
    const days = lastDayOfMonth(m).getDate();
    const on = (day: number) => dayIn(m, day);
    const isDecember = m.getMonth() === 11;

    // Groceries: a big weekly shop, small top-ups, and a monthly warehouse run (split)
    for (let day = 1 + ((6 - getDay(m) + 7) % 7); day <= days; day += 7) {
      const date = on(day);
      if (date)
        add({ account: 'card', date, amount: -between(8_600, 15_800), payee: 'freshFields' });
    }
    for (const day of [between(3, 13), between(16, 27)]) {
      const date = on(day);
      if (date)
        add({ account: 'checking', date, amount: -between(1_150, 3_400), payee: 'cornerGrocer' });
    }
    const warehouse = on(between(8, 14));
    if (warehouse) {
      const food = between(12_000, 16_500);
      const home = between(4_500, 8_500);
      split('card', warehouse, 'costwise', [
        ['groceries', -food],
        ['homeGoods', -home],
      ]);
    }

    // Eating out
    for (let i = 0; i < 7; i++) {
      const date = on(between(1, days));
      if (date) add({ account: 'card', date, amount: -between(475, 1_250), payee: 'dailyGrind' });
    }
    for (let i = 0; i < 4; i++) {
      const date = on(between(1, days));
      if (!date) continue;
      const payee = pick(['luigis', 'tacoLuna', 'sakura', 'burgerBarn'] as const);
      const range = payee === 'luigis' || payee === 'sakura' ? [5_200, 9_600] : [2_200, 4_800];
      add({ account: 'card', date, amount: -between(range[0], range[1]), payee });
    }
    if (mi === 4) {
      const date = on(21);
      if (date)
        add({
          account: 'card',
          date,
          amount: -14_860,
          payee: 'luigis',
          notes: 'Anniversary dinner 🥂',
        });
    }

    // This month they went out for a birthday dinner they hadn't planned for, so by the end
    // of the month flexible spending is a little over (the demo shows an overspent budget)
    if (mi === monthStarts.length - 1) {
      const date = on(4);
      if (date)
        add({
          account: 'card',
          date,
          amount: -11_860,
          payee: 'sakura',
          notes: "Sam's birthday dinner 🎂",
        });
    }

    // Last month was an expensive one early on: a weekend away and new tires, so the
    // dashboard's "this month vs. last month" spending lines pull clearly apart
    if (mi === monthStarts.length - 2) {
      const flights = on(5);
      if (flights)
        add({
          account: 'card',
          date: flights,
          amount: -38_960,
          payee: 'skyhop',
          notes: 'Flights for the lake weekend',
        });
      const hotel = on(7);
      if (hotel)
        add({
          account: 'card',
          date: hotel,
          amount: -48_620,
          payee: 'lakesideInn',
          notes: 'Weekend at the lake',
        });
      const tires = on(10);
      if (tires)
        add({
          account: 'card',
          date: tires,
          amount: -61_240,
          payee: 'quickLube',
          notes: 'New tires',
        });
    }

    // Car
    for (const day of [between(2, 9), between(12, 19), between(22, 28)]) {
      const date = on(day);
      if (date) add({ account: 'card', date, amount: -between(3_600, 5_000), payee: 'fuelStop' });
    }
    if (mi % 4 === 1) {
      const date = on(between(5, 25));
      if (date)
        add({ account: 'card', date, amount: -6_999, payee: 'quickLube', notes: 'Oil change' });
    }
    if (mi === 8) {
      const date = on(16);
      if (date)
        add({
          account: 'card',
          date,
          amount: -61_240,
          payee: 'quickLube',
          notes: 'Four new tires + alignment',
        });
    }

    // Health
    {
      const date = on(between(4, 26));
      if (date) add({ account: 'card', date, amount: -between(1_200, 3_900), payee: 'wellway' });
    }
    if (mi % 3 === 2) {
      const date = on(between(6, 24));
      if (date)
        add({ account: 'checking', date, amount: -3_500, payee: 'riverside', notes: 'Copay' });
    }

    // Shopping and lifestyle
    if (mi % 2 === 0 || isDecember) {
      const date = on(between(3, 27));
      if (date)
        add({ account: 'card', date, amount: -between(3_800, 14_500), payee: 'threadline' });
    }
    if (mi % 3 === 1) {
      const date = on(between(3, 27));
      if (date)
        add({ account: 'card', date, amount: -between(2_400, 11_800), payee: 'hearthHome' });
    }
    {
      const date = on(between(8, 20));
      if (date) add({ account: 'card', date, amount: -between(1_800, 4_400), payee: 'glow' });
    }
    {
      const date = on(between(5, 26));
      if (date) add({ account: 'card', date, amount: -between(2_600, 3_400), payee: 'cineplex' });
    }
    for (const [day, category] of [
      [between(2, 14), pick(['homeGoods', 'electronics', 'personalCare'] as const)],
      [between(15, 28), pick(['homeGoods', 'pets', 'electronics'] as const)],
    ] as const) {
      const date = on(day);
      if (date)
        add({ account: 'card', date, amount: -between(1_500, 6_200), payee: 'parcel', category });
    }
    if (isDecember) {
      for (const day of [4, 9, 13, 17]) {
        const date = on(day);
        if (date)
          add({
            account: 'card',
            date,
            amount: -between(3_500, 9_500),
            payee: pick(['parcel', 'threadline', 'hearthHome'] as const),
            category: 'gifts',
            notes: 'Holiday gifts',
          });
      }
    }
    if (mi === 6 || mi === 13) {
      const date = on(between(8, 20));
      if (date)
        add({
          account: 'card',
          date,
          amount: -between(4_500, 7_500),
          payee: 'parcel',
          category: 'gifts',
          notes: 'Birthday gift for Mom',
        });
    }
    if (mi === 3) {
      const date = on(11);
      if (date)
        add({
          account: 'card',
          date,
          amount: -18_500,
          payee: 'oakwoodVet',
          notes: "Biscuit's checkup and shots",
        });
    }
    if (mi === 15) {
      const date = on(18);
      if (date)
        add({
          account: 'card',
          date,
          amount: -21_300,
          payee: 'oakwoodVet',
          notes: "Biscuit's yearly checkup",
        });
    }

    // Savings account interest (4.1% APY on a growing balance)
    {
      const date = on(days);
      if (date) {
        const balance = 480_000 + mi * 92_000;
        add({
          account: 'savings',
          date,
          amount: Math.round((balance * 0.041) / 12),
          payee: 'harbor',
        });
      }
    }
  });

  // The trip they took, paid for from the Vacation category they'd saved in
  const tripMonth = subMonths(today, 5);
  add({
    account: 'card',
    date: ymd(new Date(tripMonth.getFullYear(), tripMonth.getMonth() - 2, 14)),
    amount: -48_620,
    payee: 'skyhop',
    notes: 'Flights to the coast (2)',
  });
  add({
    account: 'card',
    date: ymd(new Date(tripMonth.getFullYear(), tripMonth.getMonth(), 9)),
    amount: -61_200,
    payee: 'lakesideInn',
    notes: '4 nights, ocean view',
  });
  add({
    account: 'card',
    date: ymd(new Date(tripMonth.getFullYear(), tripMonth.getMonth(), 10)),
    amount: -8_740,
    payee: 'sakura',
    category: 'vacation',
    notes: 'Trip dinner',
  });

  // A laptop they saved up for (the finished goal)
  add({
    account: 'card',
    date: ymd(new Date(today.getFullYear(), today.getMonth() - 2, 6)),
    amount: -129_900,
    payee: 'parcel',
    category: 'electronics',
    notes: 'New laptop for Sam',
  });

  // Two recent purchases still waiting for a category
  add({
    account: 'card',
    date: ymd(subDays(today, 1)),
    amount: -2_349,
    payee: 'parcel',
    category: null,
  });
  add({
    account: 'checking',
    date: ymd(subDays(today, 3)),
    amount: -6_420,
    payee: 'hearthHome',
    category: null,
  });

  // The opening deposit: money they had when they started budgeting
  add({
    account: 'checking',
    date: start,
    amount: 520_000,
    payee: 'harbor',
    category: 'otherIncome',
    notes: 'Opening balance',
  });
  add({
    account: 'savings',
    date: start,
    amount: 480_000,
    payee: 'harbor',
    category: 'otherIncome',
    notes: 'Opening balance',
  });

  // ─── Credit card payments: last month's charges, paid in full on the 25th ──
  const cardCharges = (month: string) =>
    result.transactions
      .filter(
        (t) =>
          t.accountId === acct.card &&
          !t.transferTransactionId &&
          !t.parentTransactionId &&
          t.date.startsWith(month),
      )
      .reduce((s, t) => s + t.amount, 0);
  monthStarts.slice(1).forEach((m) => {
    const date = dayIn(m, 25);
    const owed = -cardCharges(monthKey(subMonths(m, 1)));
    if (date && owed > 0) transfer('checking', 'card', date, owed, 'Statement balance');
  });

  // ─── Accounts that change value: 401(k), brokerage, car loan, the car ───────
  let retirement = 1_842_000;
  let brokerage = 615_000;
  let loan = -1_795_000;
  monthStarts.forEach((m, mi) => {
    const date = dayIn(m, lastDayOfMonth(m).getDate());
    if (!date) return;
    // Payroll contributions plus the market's ups and downs
    const retirementChange = 61_000 + Math.round(retirement * (0.006 + (rand() - 0.45) * 0.045));
    retirement += retirementChange;
    add({
      account: 'retirement',
      date,
      amount: retirementChange,
      payee: 'evergreen',
      notes: 'Value update',
      adjustment: true,
    });
    const brokerageChange = 15_000 + Math.round(brokerage * (0.005 + (rand() - 0.45) * 0.05));
    brokerage += brokerageChange;
    add({
      account: 'brokerage',
      date,
      amount: brokerageChange,
      payee: 'pinecone',
      notes: 'Value update',
      adjustment: true,
    });
    // The principal part of each payment (the rest is interest)
    const principal = 38_900 - Math.round((-loan * 0.059) / 12);
    loan += principal;
    add({
      account: 'carLoan',
      date,
      amount: principal,
      payee: 'northstar',
      notes: 'Balance update',
      adjustment: true,
    });
    if (mi % 3 === 2)
      add({
        account: 'car',
        date,
        amount: -between(38_000, 52_000),
        notes: 'Value update',
        adjustment: true,
      });
  });

  // ─── The budget: what they planned for each category, month by month ───────
  // Fixed bills get exactly their amount; everything else gets its typical monthly
  // spending, rounded up, so balances stay small and positive. Whatever's left each month
  // goes to savings goals, keeping next month's budget funded ("living on last month's
  // income"), so this month's To Be Budgeted is a small, tidy number.
  const spending = new Map<string, number>();
  const income = new Map<string, number>();
  const onBudget = new Set([acct.checking, acct.savings, acct.card]);
  const incomeCats = new Set(
    ['paychecks', 'interest', 'otherIncome'].map((k) => cat[k as CategoryKey]),
  );
  for (const t of result.transactions) {
    if (!t.categoryId || !onBudget.has(t.accountId) || t.isParent) continue;
    const month = t.date.slice(0, 7);
    if (incomeCats.has(t.categoryId)) {
      income.set(month, (income.get(month) ?? 0) + t.amount);
    } else {
      spending.set(
        `${t.categoryId}|${month}`,
        (spending.get(`${t.categoryId}|${month}`) ?? 0) - t.amount,
      );
    }
  }
  const fullMonths = monthStarts.slice(1, -1).map(monthKey);
  const lastFullMonth = fullMonths[fullMonths.length - 1];
  const plan = new Map<string, number>();
  for (const c of result.categories) {
    if (incomeCats.has(c.id)) continue;
    const key = c.id.replace('demo-cat-', '') as CategoryKey;
    const total = fullMonths.reduce((s, month) => s + (spending.get(`${c.id}|${month}`) ?? 0), 0);
    // A fixed bill is planned at what it costs now (the electric bill changes with the
    // seasons, so it gets its average like everything else), rounded up to the dollar;
    // others at their average, rounded up to $5
    const fixed = budgetTypes[key] === 'fixed' && key !== 'electric';
    const amount = fixed
      ? (spending.get(`${c.id}|${lastFullMonth}`) ?? 0)
      : total / fullMonths.length;
    const step = fixed ? 100 : 500;
    plan.set(c.id, Math.ceil(amount / step) * step);
  }
  // The electric bill is planned at its most expensive month plus a little, rounded to $5,
  // so it's never short: in milder months some of it is left over (the dashboard's Fixed
  // bar shows a sliver still to spend)
  const electricMax = Math.max(
    ...fullMonths.map((month) => spending.get(`${cat.electric}|${month}`) ?? 0),
  );
  plan.set(cat.electric, Math.ceil((electricMax + 2_500) / 500) * 500);
  plan.set(cat.vacation, 25_000);
  plan.set(cat.electronics, Math.max(plan.get(cat.electronics) ?? 0, 15_000));
  plan.set(cat.emergencyFund, 0);
  const planTotal = [...plan.values()].reduce((s, v) => s + v, 0);

  let carry = 0;
  monthStarts.forEach((m) => {
    const month = monthKey(m);
    const available = carry + (income.get(month) ?? 0);
    // They budget a month ahead: each month is funded by the month before, and what's left
    // after keeping next month's plan in reserve goes to the emergency fund. This month's
    // paychecks are for next month, so they wait in To Be Budgeted.
    const isCurrent = month === currentMonth;
    const leftover = isCurrent ? available - planTotal : planTotal;
    const extra = Math.max(0, available - planTotal - leftover);

    // Income is planned too: the paychecks they expect (Riley is paid every other Friday)
    const riley = Math.round(((m < parseISO(raiseDate) ? 148_652 : 153_110) * 26) / 12);
    result.budgetMonths.push(
      {
        id: `demo-budget-${month}-${cat.paychecks}`,
        month,
        categoryId: cat.paychecks,
        budgeted: Math.round((riley + 2 * 126_240) / 100) * 100,
      },
      {
        id: `demo-budget-${month}-${cat.interest}`,
        month,
        categoryId: cat.interest,
        budgeted: 5_000,
      },
    );

    for (const [categoryId, amount] of plan) {
      let budgeted = amount;
      if (categoryId === cat.emergencyFund) budgeted += extra;
      if (budgeted === 0) continue;
      result.budgetMonths.push({
        id: `demo-budget-${month}-${categoryId}`,
        month,
        categoryId,
        budgeted,
      });
    }
    carry = available - planTotal - extra;
  });

  // ─── Rules ───────────────────────────────────────────────────────────────────
  const addRule = (
    conditions: Condition[],
    actions: Action[],
    opts: { op?: 'and' | 'or'; enabled?: boolean } = {},
  ) =>
    result.rules.push({
      id: `demo-rule-${result.rules.length + 1}`,
      conditions: JSON.stringify(conditions),
      actions: JSON.stringify(actions),
      conditionsOp: opts.op ?? 'and',
      enabled: opts.enabled === false ? 0 : 1,
      sortOrder: result.rules.length,
      createdAt: `${start} 09:00:00`,
    });
  addRule(
    [{ field: 'imported_payee', op: 'contains', value: 'DAILY GRIND' }],
    [
      { type: 'set_payee', value: 'demo-payee-dailyGrind' },
      { type: 'set_category', value: cat.coffee },
    ],
  );
  addRule(
    [{ field: 'imported_payee', op: 'starts_with', value: 'FRESH FIELDS' }],
    [{ type: 'set_payee', value: 'demo-payee-freshFields' }],
  );
  addRule(
    [
      {
        field: 'payee',
        op: 'one_of',
        value: [
          'demo-payee-luigis',
          'demo-payee-tacoLuna',
          'demo-payee-sakura',
          'demo-payee-burgerBarn',
        ],
      },
    ],
    [{ type: 'set_category', value: cat.restaurants }],
  );
  addRule(
    [{ field: 'payee', op: 'is', value: 'demo-payee-costwise' }],
    [
      {
        type: 'split',
        parts: [
          { kind: 'percent', value: 70, categoryId: cat.groceries, notes: null },
          { kind: 'remainder', value: 0, categoryId: cat.homeGoods, notes: 'Household' },
        ],
      },
    ],
  );
  addRule(
    [
      { field: 'payee', op: 'is', value: 'demo-payee-northstar' },
      { field: 'amount', op: 'approx', value: 38_900 },
    ],
    [
      { type: 'set_category', value: cat.carPayment },
      { type: 'append_notes', value: 'Auto loan' },
    ],
  );
  addRule(
    [
      { field: 'notes', op: 'contains', value: 'gift' },
      { field: 'imported_payee', op: 'contains', value: 'GIFT' },
    ],
    [{ type: 'set_category', value: cat.gifts }],
    { op: 'or' },
  );
  addRule(
    [
      { field: 'direction', op: 'is', value: 'outflow' },
      { field: 'amount', op: 'gt', value: 50_000 },
      { field: 'category', op: 'is_empty' },
    ],
    [{ type: 'prepend_notes', value: 'Big purchase: ' }],
    { enabled: false },
  );

  // ─── Goals ───────────────────────────────────────────────────────────────────
  // The trip goal shows what's set aside in the Vacation category
  const vacationSaved =
    result.budgetMonths
      .filter((b) => b.categoryId === cat.vacation)
      .reduce((sum, b) => sum + (b.budgeted ?? 0), 0) -
    [...spending].reduce((sum, [k, v]) => (k.startsWith(`${cat.vacation}|`) ? sum + v : sum), 0);

  const savingsBalance = result.transactions
    .filter((t) => t.accountId === acct.savings)
    .reduce((s, t) => s + t.amount, 0);
  result.goals.push(
    {
      id: 'demo-goal-emergency',
      name: 'Emergency fund',
      targetAmount: 2_500_000,
      currentAmount: savingsBalance,
      accountId: acct.savings,
      icon: '🛟',
      color: '#059669',
      sortOrder: 0,
    },
    {
      id: 'demo-goal-trip',
      name: 'Anniversary trip to Portugal',
      targetAmount: 450_000,
      currentAmount: vacationSaved,
      targetDate: ymd(lastDayOfMonth(addMonths(today, 7))),
      icon: '✈️',
      color: '#0EA5E9',
      sortOrder: 1,
    },
    {
      id: 'demo-goal-laptop',
      name: 'New laptop',
      targetAmount: 130_000,
      currentAmount: 130_000,
      targetDate: ymd(new Date(today.getFullYear(), today.getMonth() - 2, 6)),
      icon: '💻',
      color: '#7C3AED',
      sortOrder: 2,
    },
  );

  // ─── Reports: two dashboards and three saved custom reports ─────────────────
  const range = (preset: string, months: number) => ({
    preset,
    from: monthKey(subMonths(today, months - 1)),
    to: currentMonth,
  });
  const noFilters = { accountIds: [], categoryIds: [], categoryGroupIds: [] };
  const report = (key: string, name: string, config: object, sortOrder: number) =>
    result.customReports.push({
      id: `demo-report-${key}`,
      name,
      config: JSON.stringify({ ...config, filters: noFilters }),
      sortOrder,
      createdAt: `${start} 09:00:00`,
      updatedAt: `${start} 09:00:00`,
    });
  report(
    'whereItGoes',
    'Where the money goes',
    {
      chartType: 'donut',
      mode: 'total',
      groupBy: 'categoryGroup',
      balanceType: 'expense',
      dateRange: range('3m', 3),
    },
    0,
  );
  report(
    'monthlyGroups',
    'Spending by group, month by month',
    {
      chartType: 'stacked-bar',
      mode: 'time',
      groupBy: 'categoryGroup',
      balanceType: 'expense',
      dateRange: range('6m', 6),
    },
    1,
  );
  report(
    'topPayees',
    'Top places we spend',
    {
      chartType: 'bar',
      mode: 'total',
      groupBy: 'payee',
      balanceType: 'expense',
      dateRange: range('3m', 3),
    },
    2,
  );

  result.dashboardPages.push(
    {
      id: 'demo-dash-overview',
      name: 'Overview',
      sortOrder: 0,
      dateRange: JSON.stringify(range('6m', 6)),
    },
    {
      id: 'demo-dash-year',
      name: 'Year in review',
      sortOrder: 1,
      dateRange: JSON.stringify(range('12m', 12)),
    },
  );
  const widget = (
    page: string,
    type: string,
    x: number,
    y: number,
    width: number,
    height: number,
    extra: { reportId?: string; meta?: object } = {},
  ) =>
    result.dashboardWidgets.push({
      id: `demo-widget-${result.dashboardWidgets.length + 1}`,
      pageId: `demo-dash-${page}`,
      type,
      customReportId: extra.reportId ?? null,
      x,
      y,
      width,
      height,
      meta: JSON.stringify(extra.meta ?? {}),
    });
  widget('overview', 'summary', 0, 0, 12, 1);
  widget('overview', 'net-worth', 0, 1, 6, 4);
  widget('overview', 'income-expenses', 6, 1, 6, 4);
  widget('overview', 'spending', 0, 5, 6, 4);
  widget('overview', 'custom-report', 6, 5, 6, 4, { reportId: 'demo-report-whereItGoes' });
  widget('overview', 'spending-trends', 0, 9, 6, 4, {
    meta: { categoryIds: [cat.groceries, cat.restaurants, cat.gas, cat.coffee] },
  });
  widget('overview', 'calendar', 6, 9, 6, 4, { meta: { dateRange: range('1m', 1) } });
  widget('year', 'net-worth', 0, 0, 12, 4, { meta: { name: 'Net worth this year' } });
  widget('year', 'custom-report', 0, 4, 6, 4, { reportId: 'demo-report-monthlyGroups' });
  widget('year', 'custom-report', 6, 4, 6, 4, { reportId: 'demo-report-topPayees' });
  widget('year', 'calendar', 0, 8, 12, 4, { meta: { name: 'Every day this year' } });

  return result;
}
