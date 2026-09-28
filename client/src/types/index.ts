export type AccountType = 'checking' | 'savings' | 'credit' | 'cash' | 'investment';

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'investment', label: 'Investment' },
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
  scheduleId: string | null;
  createdAt: string;
  children?: Transaction[];
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

export const BUDGET_TYPE_LABELS: Record<BudgetType, string> = {
  fixed: 'Fixed',
  flexible: 'Flexible',
  non_monthly: 'Non-Monthly',
  savings: 'Savings/Investments',
};

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
  createdAt: string;
}

export interface TransactionQueryParams {
  accountId?: string;
  month?: string;
  from?: string;
  to?: string;
  categoryId?: string;
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
  balance: number;
}

export interface NetWorthPoint {
  month: string;
  assets: number;
  liabilities: number;
  netWorth: number;
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
  'summary' | 'net-worth' | 'income-expenses' | 'spending' | 'spending-trends';

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
  /** No `dateRange` means the widget follows its dashboard's range */
  meta: { name?: string; dateRange?: ReportDateRange };
}

export interface CustomReportWidget extends WidgetBase {
  type: 'custom-report';
  customReportId: string;
  meta: { dateRange?: ReportDateRange };
}

export type DashboardWidget = BuiltinWidget | CustomReportWidget;
export type WidgetType = DashboardWidget['type'];

export interface RuleCondition {
  field: 'payee_name' | 'amount' | 'notes';
  op: 'contains' | 'starts_with' | 'ends_with' | 'exact' | 'regex';
  value: string;
}

export interface RuleAction {
  field: 'category_id' | 'payee_id' | 'notes';
  value: string;
}

export interface Rule {
  id: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  sortOrder: number;
  createdAt: string;
}

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

export interface RunRulesPreviewItem {
  transactionId: string;
  date: string;
  payeeName: string | null;
  amount: number;
  newCategoryName: string | null;
  actions: RuleAction[];
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
