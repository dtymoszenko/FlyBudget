import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  customType,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { secretCipher } from './secretCrypto.js';

/** TEXT column encrypted at rest when a key is configured (see secretCrypto.ts). Can't be queried by value. */
const encryptedText = customType<{ data: string; driverData: string }>({
  dataType: () => 'text',
  toDriver: (value) => secretCipher.encrypt(value),
  fromDriver: (value) => secretCipher.decrypt(value),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  startingBalance: integer('starting_balance').notNull().default(0),
  isOffBudget: integer('is_off_budget').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  closedAt: text('closed_at'),
  /** Custom logo as a small image data URL; null = colored initials */
  logo: text('logo'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const categoryGroups = sqliteTable('category_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isIncome: integer('is_income').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => categoryGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  icon: text('icon'),
  budgetType: text('budget_type'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const payees = sqliteTable('payees', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  defaultCategoryId: text('default_category_id').references(() => categories.id, {
    onDelete: 'set null',
  }),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    amount: integer('amount').notNull(),
    payeeId: text('payee_id').references(() => payees.id, { onDelete: 'set null' }),
    payeeName: text('payee_name'),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    notes: text('notes'),
    reconciled: integer('reconciled').notNull().default(0),
    transferTransactionId: text('transfer_transaction_id'),
    isParent: integer('is_parent').notNull().default(0),
    parentTransactionId: text('parent_transaction_id'),
    importedId: text('imported_id'),
    scheduleId: text('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('transactions_account_date_idx').on(table.accountId, table.date),
    index('transactions_category_idx').on(table.categoryId),
    index('transactions_date_idx').on(table.date),
    index('transactions_imported_id_idx').on(table.importedId),
    index('idx_transactions_schedule').on(table.scheduleId),
  ],
);

export const budgetMonths = sqliteTable(
  'budget_months',
  {
    id: text('id').primaryKey(),
    month: text('month').notNull(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    budgeted: integer('budgeted').notNull().default(0),
    notes: text('notes'),
  },
  (table) => [uniqueIndex('budget_months_month_category_idx').on(table.month, table.categoryId)],
);

export const rules = sqliteTable('rules', {
  id: text('id').primaryKey(),
  conditions: text('conditions').notNull(),
  actions: text('actions').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    amount: integer('amount').notNull(),
    amountType: text('amount_type').notNull().default('exact'),
    recurrenceType: text('recurrence_type').notNull(),
    recurrenceRule: text('recurrence_rule').notNull().default('{}'),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    weekendAdjust: text('weekend_adjust').notNull().default('none'),
    dateFlexibility: integer('date_flexibility').notNull().default(3),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    transferAccountId: text('transfer_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    payeeId: text('payee_id').references(() => payees.id, { onDelete: 'set null' }),
    notes: text('notes'),
    status: text('status').notNull().default('active'),
    autoCreate: integer('auto_create').notNull().default(0),
    autoCreateFrom: text('auto_create_from'),
    source: text('source').notNull().default('manual'),
    occurrenceHorizon: text('occurrence_horizon'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_schedules_status').on(table.status),
    index('idx_schedules_payee').on(table.payeeId),
    index('idx_schedules_account').on(table.accountId),
  ],
);

export const scheduleOccurrences = sqliteTable(
  'schedule_occurrences',
  {
    id: text('id').primaryKey(),
    scheduleId: text('schedule_id')
      .notNull()
      .references(() => schedules.id, { onDelete: 'cascade' }),
    scheduledDate: text('scheduled_date').notNull(),
    expectedDate: text('expected_date').notNull(),
    expectedAmount: integer('expected_amount').notNull(),
    status: text('status').notNull().default('pending'),
    matchedTransactionId: text('matched_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    matchType: text('match_type'),
    matchConfidence: integer('match_confidence'),
    skippedAt: text('skipped_at'),
    paidAt: text('paid_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('idx_occ_schedule_date_unique').on(table.scheduleId, table.scheduledDate),
    index('idx_occ_expected_date').on(table.expectedDate),
    index('idx_occ_status').on(table.status),
    uniqueIndex('idx_occ_matched_tx_unique').on(table.matchedTransactionId),
  ],
);

export const scheduleMatchDismissals = sqliteTable(
  'schedule_match_dismissals',
  {
    id: text('id').primaryKey(),
    occurrenceId: text('occurrence_id')
      .notNull()
      .references(() => scheduleOccurrences.id, { onDelete: 'cascade' }),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    dismissedAt: text('dismissed_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [uniqueIndex('idx_dismissal_unique').on(table.occurrenceId, table.transactionId)],
);

export const customReports = sqliteTable('custom_reports', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  config: text('config').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  targetAmount: integer('target_amount').notNull(),
  currentAmount: integer('current_amount').notNull().default(0),
  targetDate: text('target_date'),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  icon: text('icon').notNull().default('🎯'),
  color: text('color').notNull().default('#2563EB'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const simplefinConnections = sqliteTable('simplefin_connections', {
  id: text('id').primaryKey(),
  accessUrl: encryptedText('access_url').notNull(),
  connectionName: text('connection_name').notNull(),
  syncStatus: text('sync_status').notNull().default('good'),
  syncError: text('sync_error'),
  lastSyncedAt: text('last_synced_at'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const simplefinAccountMappings = sqliteTable(
  'simplefin_account_mappings',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => simplefinConnections.id, { onDelete: 'cascade' }),
    simplefinAccountId: text('simplefin_account_id').notNull(),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    simplefinAccountName: text('simplefin_account_name').notNull(),
    isEnabled: integer('is_enabled').notNull().default(1),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('simplefin_account_mapping_unique').on(
      table.connectionId,
      table.simplefinAccountId,
    ),
  ],
);

export const plaidConfig = sqliteTable('plaid_config', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(),
  secret: encryptedText('secret').notNull(),
  environment: text('environment').notNull().default('development'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const plaidItems = sqliteTable('plaid_items', {
  id: text('id').primaryKey(),
  plaidItemId: text('plaid_item_id').notNull(),
  institutionId: text('institution_id').notNull(),
  institutionName: text('institution_name').notNull(),
  accessToken: encryptedText('access_token').notNull(),
  cursor: text('cursor'),
  lastSyncedAt: text('last_synced_at'),
  syncStatus: text('sync_status').notNull().default('good'),
  syncError: text('sync_error'),
  consentExpiresAt: text('consent_expires_at'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const plaidAccountMappings = sqliteTable(
  'plaid_account_mappings',
  {
    id: text('id').primaryKey(),
    plaidItemId: text('plaid_item_id')
      .notNull()
      .references(() => plaidItems.id, { onDelete: 'cascade' }),
    plaidAccountId: text('plaid_account_id').notNull(),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    plaidAccountName: text('plaid_account_name').notNull(),
    plaidAccountType: text('plaid_account_type').notNull(),
    plaidAccountMask: text('plaid_account_mask'),
    isEnabled: integer('is_enabled').notNull().default(1),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('plaid_account_mapping_unique').on(table.plaidItemId, table.plaidAccountId),
  ],
);
