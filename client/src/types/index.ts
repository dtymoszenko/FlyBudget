// Keep in sync with server/src/utils/accountTypes.ts
export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'credit'
  | 'line_of_credit'
  | 'investment'
  | 'retirement'
  | 'crypto'
  | 'real_estate'
  | 'vehicle'
  | 'valuables'
  | 'mortgage'
  | 'auto_loan'
  | 'student_loan'
  | 'loan'
  | 'other_asset'
  | 'other_liability';

export type AccountGroup = 'cash' | 'credit' | 'investments' | 'property' | 'loans' | 'other';

export interface AccountTypeInfo {
  value: AccountType;
  label: string;
  group: AccountGroup;
  /** Debts: the balance is what's owed, stored as a negative number */
  liability: boolean;
  /** Everyday spending accounts; the rest default to off budget */
  onBudget: boolean;
  /** Example shown under the type picker */
  hint: string;
}

export const ACCOUNT_TYPES: AccountTypeInfo[] = [
  {
    value: 'checking',
    label: 'Checking',
    group: 'cash',
    liability: false,
    onBudget: true,
    hint: 'Everyday bank account',
  },
  {
    value: 'savings',
    label: 'Savings',
    group: 'cash',
    liability: false,
    onBudget: true,
    hint: 'Savings, money market, CDs',
  },
  {
    value: 'cash',
    label: 'Cash',
    group: 'cash',
    liability: false,
    onBudget: true,
    hint: 'Wallet or petty cash',
  },
  {
    value: 'credit',
    label: 'Credit Card',
    group: 'credit',
    liability: true,
    onBudget: true,
    hint: 'Credit or charge card',
  },
  {
    value: 'line_of_credit',
    label: 'Line of Credit',
    group: 'credit',
    liability: true,
    onBudget: true,
    hint: 'Personal line of credit or HELOC',
  },
  {
    value: 'investment',
    label: 'Brokerage',
    group: 'investments',
    liability: false,
    onBudget: false,
    hint: 'Taxable investment account',
  },
  {
    value: 'retirement',
    label: 'Retirement',
    group: 'investments',
    liability: false,
    onBudget: false,
    hint: '401(k), IRA, Roth, pension',
  },
  {
    value: 'crypto',
    label: 'Crypto',
    group: 'investments',
    liability: false,
    onBudget: false,
    hint: 'Exchange account or wallet',
  },
  {
    value: 'real_estate',
    label: 'Real Estate',
    group: 'property',
    liability: false,
    onBudget: false,
    hint: 'Home, rental or land',
  },
  {
    value: 'vehicle',
    label: 'Vehicle',
    group: 'property',
    liability: false,
    onBudget: false,
    hint: 'Car, motorcycle, boat, RV',
  },
  {
    value: 'valuables',
    label: 'Valuables',
    group: 'property',
    liability: false,
    onBudget: false,
    hint: 'Jewelry, art, collectibles, precious metals',
  },
  {
    value: 'mortgage',
    label: 'Mortgage',
    group: 'loans',
    liability: true,
    onBudget: false,
    hint: 'Home loan',
  },
  {
    value: 'auto_loan',
    label: 'Auto Loan',
    group: 'loans',
    liability: true,
    onBudget: false,
    hint: 'Car or vehicle loan',
  },
  {
    value: 'student_loan',
    label: 'Student Loan',
    group: 'loans',
    liability: true,
    onBudget: false,
    hint: 'Federal or private student loan',
  },
  {
    value: 'loan',
    label: 'Other Loan',
    group: 'loans',
    liability: true,
    onBudget: false,
    hint: 'Personal, medical or family loan',
  },
  {
    value: 'other_asset',
    label: 'Other Asset',
    group: 'other',
    liability: false,
    onBudget: false,
    hint: 'Anything else you own',
  },
  {
    value: 'other_liability',
    label: 'Other Liability',
    group: 'other',
    liability: true,
    onBudget: false,
    hint: 'Anything else you owe',
  },
];

export const ACCOUNT_GROUPS: { value: AccountGroup; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'credit', label: 'Credit' },
  { value: 'investments', label: 'Investments' },
  { value: 'property', label: 'Property' },
  { value: 'loans', label: 'Loans' },
  { value: 'other', label: 'Other' },
];

export interface Transaction {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  notes: string | null;
  reconciled: number;
  transferTransactionId: string | null;
  isParent: number;
  parentTransactionId: string | null;
  importedId: string | null;
  /** Raw payee text from the bank or CSV (null for manual entries) */
  importedPayee: string | null;
  /** 1 for a balance correction; reports leave it out while it has no category */
  isAdjustment?: number;
  scheduleId: string | null;
  /**
   * In an account with another currency than the budget's: what it's worth in the budget's
   * currency (null = the same as `amount`, or `missing`)
   */
  mainAmount?: number | null;
  /** rate | manual | transfer | missing (no rate for its day yet: counted as nothing) */
  mainAmountSource?: MainAmountSource | null;
  createdAt: string;
  children?: Transaction[];
}

export type MainAmountSource = 'rate' | 'manual' | 'transfer' | 'missing';

/** Two existing transactions that look like one transfer (GET /transactions/transfers/suggestions) */
export interface TransferSuggestion {
  outflow: Transaction;
  inflow: Transaction;
  /** Days between the two dates */
  days: number;
}

/** Answer to linking or making a transfer: both sides, and how they were before */
export interface TransferLinkResult {
  /** The transaction acted on first, then the other side */
  transactions: [Transaction, Transaction];
  /** The other side is null when it was just created */
  previous: [Transaction, Transaction | null];
  /** Whether the other side was created (no matching transaction was found) */
  created: boolean;
}

export interface ImportPreviewRow {
  date: string;
  amount: number;
  payeeName: string | null;
  notes: string | null;
  importedId: string;
  isDuplicate: boolean;
}

export type BudgetType = 'fixed' | 'flexible' | 'non_monthly' | 'savings';

export interface Category {
  id: string;
  groupId: string;
  name: string;
  icon: string | null;
  budgetType: BudgetType | null;
  sortOrder: number;
  createdAt: string;
}

export interface CategoryGroup {
  id: string;
  name: string;
  isIncome: number;
  sortOrder: number;
  createdAt: string;
  categories: Category[];
}

export interface Payee {
  id: string;
  name: string;
  defaultCategoryId: string | null;
  /** Custom logo image (data URL); null = colored initials */
  logo: string | null;
  createdAt: string;
}

export interface TransactionQueryParams {
  accountId?: string;
  month?: string;
  from?: string;
  to?: string;
  categoryId?: string;
  uncategorized?: boolean;
  categoryGroupId?: string;
  categoryIds?: string[];
  search?: string;
  reconciled?: 0 | 1;
  limit?: number;
  offset?: number;
}

export interface BudgetCategory {
  id: string;
  groupId: string;
  name: string;
  icon: string | null;
  budgetType: BudgetType | null;
  sortOrder: number;
  createdAt: string;
  budgeted: number;
  spent: number;
  carryOver: number;
  balance: number;
}

export interface BudgetGroup {
  id: string;
  name: string;
  isIncome: number;
  sortOrder: number;
  createdAt: string;
  categories: BudgetCategory[];
}

export interface BudgetSummary {
  month: string;
  income: number;
  totalBudgeted: number;
  carryOver: number;
  toBeBudgeted: number;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  startingBalance: number;
  isOffBudget: number;
  sortOrder: number;
  closedAt: string | null;
  /** Custom logo image (data URL); null = colored initials */
  logo: string | null;
  createdAt: string;
  /** In the account's own currency */
  balance: number;
  /** ISO 4217: the account's own, or the budget's (null while the budget has none) */
  currency: string | null;
  /** The balance in the budget's currency at the latest rate; null without a rate */
  mainBalance: number | null;
  /** The day of the rate used for mainBalance (null when no conversion was needed) */
  rateDate: string | null;
  /** Its currency can only change while it has none */
  hasTransactions: boolean;
  /** How many transactions it has (a split counts once); only in the accounts list */
  transactionCount?: number;
  /**
   * In another currency: how much more (or less) it's worth today in the budget's currency
   * than it was counted as when its money came in (the rate moved). Null when not known.
   */
  currencyDifference?: number | null;
}

export interface NetWorthPoint {
  month: string;
  assets: number;
  liabilities: number;
  netWorth: number;
  /** Currencies of accounts left out of this point, for want of a rate */
  unconverted?: string[];
}

/** The budget's currency and its exchange rates (GET /api/currency) */
export interface CurrencySettings {
  currency: string | null;
  ratesEnabled: boolean;
  ratesUrl: string | null;
  defaultRatesUrl: string | null;
  /** False in the demo, which never talks to another server */
  canDownload: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
  /** Currencies accounts are in, other than the budget's */
  foreignCurrencies: string[];
  latestRates: Array<{
    currency: string;
    rate: string | null;
    date: string | null;
    source: string | null;
  }>;
  missing: MissingRates;
}

/** Transactions waiting for a rate, so they count as nothing in the budget for now */
export interface MissingRates {
  count: number;
  currencies: string[];
  oldest?: string | null;
}

export interface ExchangeRate {
  id: string;
  date: string;
  base: string;
  quote: string;
  rate: string;
  source: 'ecb' | 'manual' | string;
}
export interface IncomeExpensesPoint {
  month: string;
  income: number;
  expenses: number;
  net: number;
  /** Signed sum of expense-category transactions (negative = net spending, refunds not clamped) */
  expenseNet: number;
  /** Number of outflow transactions in expense categories */
  expenseCount: number;
}
export interface CashFlowPoint {
  month: string;
  net: number;
}
export interface SpendingByCategory {
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  groupId: string | null;
  groupName: string | null;
  totalSpent: number;
}
export interface IncomeByCategoryItem {
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  groupId: string | null;
  groupName: string | null;
  totalReceived: number;
}
export interface SpendingTrendPoint {
  categoryId: string;
  categoryName: string | null;
  categoryIcon: string | null;
  month: string;
  total: number;
}

/** One day's money in and out on budget accounts, without transfers (`GET /reports/daily-flow`) */
export interface DailyFlowPoint {
  /** yyyy-MM-dd */
  date: string;
  income: number;
  expenses: number;
  /** Transactions that day (a split counts once) */
  count: number;
}

export interface SpendingComparisonData {
  currentTotal: number;
  periodLabel: string;
  currentLabel: string;
  comparisonLabel: string;
  maxDays: number;
  todayDay: number;
  current: { day: number; cumulative: number }[];
  comparison: { day: number; cumulative: number }[];
}

// Custom Reports
export type ChartType = 'bar' | 'stacked-bar' | 'line' | 'area' | 'donut' | 'table';
export type ReportMode = 'total' | 'time';
export type ReportGroupBy = 'category' | 'categoryGroup' | 'payee' | 'account' | 'month';
export type BalanceType = 'expense' | 'income' | 'net';
export type DatePresetCustom = '1m' | '3m' | '6m' | '12m' | 'ytd' | 'last-year' | 'all' | 'custom';

/** `preset: 'custom'` is frozen to `from`/`to`; other presets are live, relative to today. */
export interface ReportDateRange {
  preset: DatePresetCustom;
  from: string;
  to: string;
}

export interface CustomReportConfig {
  chartType: ChartType;
  mode: ReportMode;
  groupBy: ReportGroupBy;
  balanceType: BalanceType;
  dateRange: ReportDateRange;
  filters: { accountIds: string[]; categoryIds: string[]; categoryGroupIds: string[] };
}

export interface SavedCustomReport {
  id: string;
  name: string;
  config: CustomReportConfig;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomReportTotalData {
  mode: 'total';
  data: { name: string; id: string | null; value: number }[];
}

export interface CustomReportTimeData {
  mode: 'time';
  groups: string[];
  data: Record<string, string | number>[];
}

export type CustomReportData = CustomReportTotalData | CustomReportTimeData;

// Report dashboards
export interface DashboardPage {
  id: string;
  name: string;
  sortOrder: number;
  /** The range this dashboard's widgets follow unless they have their own; null = last 6 months */
  dateRange: ReportDateRange | null;
  createdAt: string;
}

export type BuiltinWidgetType =
  'summary' | 'net-worth' | 'income-expenses' | 'spending' | 'spending-trends' | 'calendar';

interface WidgetBase {
  id: string;
  pageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: string;
}

export interface BuiltinWidget extends WidgetBase {
  type: BuiltinWidgetType;
  customReportId: null;
  /**
   * No `dateRange` means the widget follows its dashboard's range. `categoryIds` (Spending
   * Trends only) are the categories to chart; without it, the biggest spending categories.
   */
  meta: { name?: string; dateRange?: ReportDateRange; categoryIds?: string[] };
}

export interface CustomReportWidget extends WidgetBase {
  type: 'custom-report';
  customReportId: string;
  meta: { dateRange?: ReportDateRange };
}

export type DashboardWidget = BuiltinWidget | CustomReportWidget;
export type WidgetType = DashboardWidget['type'];

// --- Rules (mirrors server/src/services/rulesEngine.ts) ---
export type RuleTextField = 'payee_name' | 'imported_payee' | 'notes';
export type RuleIdField = 'payee' | 'account' | 'category';
export type RuleConditionField = RuleTextField | RuleIdField | 'amount' | 'direction' | 'date';

export type RuleCondition =
  | {
      field: RuleTextField;
      op: 'is' | 'is_not' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'regex';
      value: string;
    }
  | { field: RuleTextField | RuleIdField; op: 'one_of' | 'not_one_of'; value: string[] }
  | { field: RuleTextField | RuleIdField; op: 'is_empty' | 'is_not_empty' }
  | { field: RuleIdField; op: 'is' | 'is_not'; value: string }
  /** Absolute value in cents; `direction` tells inflow from outflow */
  | { field: 'amount'; op: 'is' | 'is_not' | 'gt' | 'gte' | 'lt' | 'lte' | 'approx'; value: number }
  | { field: 'amount'; op: 'between'; value: [number, number] }
  | { field: 'direction'; op: 'is'; value: 'inflow' | 'outflow' }
  | { field: 'date'; op: 'is' | 'before' | 'after'; value: string }
  | { field: 'date'; op: 'between'; value: [string, string] };

export type RuleConditionOp = RuleCondition['op'];

export interface RuleSplitPart {
  kind: 'fixed' | 'percent' | 'remainder';
  /** cents for fixed, 0–100 for percent, unused for remainder */
  value: number;
  categoryId: string | null;
  notes: string | null;
}

export type RuleAction =
  | { type: 'set_category' | 'set_payee'; value: string }
  | { type: 'set_notes' | 'prepend_notes' | 'append_notes'; value: string }
  | { type: 'split'; parts: RuleSplitPart[] };

export interface Rule {
  id: string;
  conditionsOp: 'and' | 'or';
  conditions: RuleCondition[];
  actions: RuleAction[];
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
}

export type RuleInput = Omit<Rule, 'id' | 'createdAt' | 'sortOrder'> & { sortOrder?: number };

export interface PayeeWithCount extends Payee {
  transactionCount: number;
}

// --- Schedule System ---
export type RecurrenceType =
  | 'once'
  | 'weekly'
  | 'biweekly'
  | 'semimonthly'
  | 'monthly'
  | 'quarterly'
  | 'semiannually'
  | 'yearly';
export type AmountType = 'exact' | 'approximate' | 'variable';
export type ScheduleStatus = 'active' | 'paused' | 'canceled';
export type ScheduleSource = 'manual' | 'detected';
export type WeekendAdjust = 'none' | 'before' | 'after' | 'closest';
export type OccurrenceDisplayStatus =
  'upcoming' | 'due' | 'waiting' | 'paid' | 'skipped' | 'cancelled';
export type MatchType = 'automatic' | 'manual';

export type RecurrenceRule =
  | { type: 'once' }
  | { type: 'weekly'; interval: number; anchorDay: number }
  | { type: 'biweekly'; anchorDay: number }
  | { type: 'semimonthly'; day1: number; day2: number }
  | { type: 'monthly'; interval: number; anchorDay: number }
  | { type: 'quarterly'; anchorDay: number }
  | { type: 'semiannually'; anchorDay: number }
  | { type: 'yearly'; anchorMonth: number; anchorDay: number };

export const RECURRENCE_TYPE_LABELS: { value: RecurrenceType; label: string }[] = [
  { value: 'once', label: 'One Time' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
  { value: 'semimonthly', label: 'Twice a Month' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semiannually', label: 'Every 6 Months' },
  { value: 'yearly', label: 'Yearly' },
];

export interface Schedule {
  id: string;
  name: string;
  amount: number;
  amountType: AmountType;
  recurrenceType: RecurrenceType;
  recurrenceRule: string;
  startDate: string;
  endDate: string | null;
  weekendAdjust: WeekendAdjust;
  dateFlexibility: number;
  accountId: string | null;
  transferAccountId: string | null;
  categoryId: string | null;
  payeeId: string | null;
  notes: string | null;
  status: ScheduleStatus;
  autoCreate: number;
  autoCreateFrom: string | null;
  source: ScheduleSource;
  occurrenceHorizon: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleWithOccurrences extends Schedule {
  occurrences: ScheduleOccurrence[];
}

export interface ScheduleOccurrence {
  id: string;
  scheduleId: string;
  scheduledDate: string;
  expectedDate: string;
  expectedAmount: number;
  status: string;
  displayStatus: OccurrenceDisplayStatus;
  matchedTransactionId: string | null;
  matchType: MatchType | null;
  matchConfidence: number | null;
  skippedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  scheduleName: string;
  recurrenceType: RecurrenceType;
  amountType: AmountType;
  scheduleAccountId: string | null;
  scheduleCategoryId: string | null;
  schedulePayeeId: string | null;
  matchedAmount: number | null;
  matchedDate: string | null;
}

export interface ScheduleSummary {
  income: number;
  expenses: number;
}

/** A likely recurring charge found by GET /schedules/discover (port of Actual's find-schedules). */
export interface DiscoveredSchedule {
  id: string;
  accountId: string;
  accountName: string;
  payeeId: string | null;
  payeeName: string;
  amount: number;
  amountType: 'exact' | 'approximate';
  recurrenceType: 'weekly' | 'biweekly' | 'monthly';
  recurrenceRule: RecurrenceRule;
  startDate: string;
  exactDate: boolean;
  categoryId: string | null;
  transactionIds: string[];
}

export interface MatchSuggestion {
  occurrenceId: string;
  scheduleId: string;
  scheduleName: string;
  scheduledDate: string;
  expectedDate: string;
  expectedAmount: number;
  candidates: {
    transactionId: string;
    date: string;
    amount: number;
    payeeName: string | null;
    score: number;
  }[];
}

export type RuleApplyScope = 'uncategorized' | 'all';

/** One transaction that running rules would change */
export interface RulePreviewItem {
  transactionId: string;
  date: string;
  accountId: string;
  amount: number;
  payeeName: string | null;
  changes: {
    payee?: { from: string | null; to: string | null };
    category?: { from: string | null; to: string | null };
    notes?: { from: string | null; to: string | null };
    split?: Array<{ amount: number; categoryId: string | null; notes: string | null }>;
  };
}

export interface RuleTestResult {
  count: number;
  matches: Array<{
    id: string;
    date: string;
    payeeName: string | null;
    amount: number;
    accountId: string;
    categoryId: string | null;
  }>;
}

// Goals
export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
  accountId: string | null;
  icon: string;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// Plaid Bank Sync
export type PlaidSyncStatus = 'good' | 'syncing' | 'error' | 'login_required';

export interface PlaidDiscoveredAccount {
  plaidAccountId: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  suggestedType: AccountType;
  currentBalance: number;
}

export interface PlaidAccountMapping {
  plaidAccountId: string;
  plaidAccountName: string;
  plaidAccountType: string;
  mask: string | null;
  accountId: string | null;
  accountName: string | null;
  isEnabled: number;
}

export interface PlaidItem {
  id: string;
  institutionName: string;
  institutionId: string;
  lastSyncedAt: string | null;
  syncStatus: PlaidSyncStatus;
  syncError: string | null;
  consentExpiresAt: string | null;
  accounts: PlaidAccountMapping[];
}

export interface PlaidExchangeResult {
  itemId: string;
  institutionName: string;
  accounts: PlaidDiscoveredAccount[];
}

export interface PlaidSyncResult {
  itemId: string;
  institutionName: string;
  added: number;
  modified: number;
  removed: number;
  errors: string[];
}

// SimpleFIN Bank Sync
export type SimplefinSyncStatus = 'good' | 'syncing' | 'error';

export interface SimplefinDiscoveredAccount {
  simplefinAccountId: string;
  name: string;
  balance: number;
  currency: string;
}

export interface SimplefinAccountMapping {
  simplefinAccountId: string;
  simplefinAccountName: string;
  accountId: string | null;
  accountName: string | null;
  isEnabled: number;
}

export interface SimplefinConnection {
  id: string;
  connectionName: string;
  lastSyncedAt: string | null;
  syncStatus: SimplefinSyncStatus;
  syncError: string | null;
  accounts: SimplefinAccountMapping[];
}

export interface SimplefinSetupResult {
  connectionId: string;
  connectionName: string;
  accounts: SimplefinDiscoveredAccount[];
}

export interface SimplefinSyncResult {
  connectionId: string;
  connectionName: string;
  added: number;
  errors: string[];
}

// Enable Banking (European banks over PSD2)

export type EnableBankingSyncStatus = 'good' | 'syncing' | 'error' | 'login_required';

export interface EnableBankingStatus {
  configured: boolean;
  applicationId: string | null;
  applicationName: string | null;
  environment: string | null;
  /** The redirect URL to register in the Enable Banking application (null in the demo) */
  redirectUrl: string | null;
  /** Self-hosted over plain HTTP: the bank's redirect would not be encrypted */
  insecureRedirect: boolean;
  connectionCount: number;
}

export interface EnableBankingConfigureResult {
  applicationName: string | null;
  environment: string | null;
  /** Whether the application lists FlyBudget's redirect URL; null when it couldn't be checked */
  redirectUrlRegistered: boolean | null;
}

export interface EnableBankingBank {
  name: string;
  country: string;
  maximumConsentDays: number | null;
  beta: boolean;
}

export interface EnableBankingDiscoveredAccount {
  mappingId: string;
  name: string;
  iban: string | null;
  currency: string | null;
  suggestedType: AccountType;
  /** An open account whose last CAMT statement was for this IBAN */
  suggestedAccountId: string | null;
  /** The account it already syncs into (after a reconnect) */
  accountId: string | null;
  isEnabled: number;
}

export interface EnableBankingConnectionResult {
  connectionId: string;
  bankName: string;
  accounts: EnableBankingDiscoveredAccount[];
}

export type EnableBankingAuthPoll =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'error'; message: string }
  | { status: 'success'; result: EnableBankingConnectionResult };

export interface EnableBankingAccountMapping {
  mappingId: string;
  name: string;
  iban: string | null;
  currency: string | null;
  accountId: string | null;
  accountName: string | null;
  isEnabled: number;
  lastBookedDate: string | null;
}

export interface EnableBankingConnection {
  id: string;
  aspspName: string;
  aspspCountry: string;
  /** When the bank's access ends (ISO timestamp) */
  validUntil: string | null;
  syncStatus: EnableBankingSyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
  accounts: EnableBankingAccountMapping[];
}

export interface EnableBankingSyncResult {
  connectionId: string;
  bankName: string;
  added: number;
  /** Already in FlyBudget (from a file or typed in), now recognised as the bank's */
  adopted: number;
  skipped: { noDate: number; badAmount: number; otherCurrency: number };
  errors: string[];
}
