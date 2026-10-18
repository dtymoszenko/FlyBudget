import { and, eq, gte, isNull, lte, max, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import {
  accounts,
  enableBankingAccountMappings,
  enableBankingConnections,
  plaidAccountMappings,
  simplefinAccountMappings,
  transactions,
} from '../db/schema.js';
import { logError } from '../utils/log.js';
import { readStatementAccount } from '../utils/importSettings.js';
import type { AccountType } from '../utils/accountTypes.js';
import { accountTransactionSum } from './balances.js';
import { buildRuleContext, insertNewTransaction, loadRules } from './ruleService.js';
import {
  EnableBankingError,
  enableBankingErrorMessage,
  getBalances,
  getTransactions,
  loadEnableBankingConfig,
  type EnableBankingSession,
  type PsuContext,
} from './enableBankingService.js';
import {
  ADOPT_MAX_DAYS,
  emptySkipped,
  ENABLE_BANKING_ID_PREFIX,
  mapTransactions,
  matchExistingImports,
  matchReturningAccounts,
  pickBalance,
  suggestAccountType,
  type SkippedCounts,
} from './enableBankingTransactions.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Later syncs ask again for this many days before the last booking, for late bookings */
const OVERLAP_DAYS = 14;
/** Linking an account that already has transactions starts this long before the latest one */
const LINKED_START_DAYS = 7;
/** Startup syncs skip a connection synced more recently: banks allow ~4 unattended a day */
export const UNATTENDED_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

export interface DiscoveredAccount {
  mappingId: string;
  name: string;
  iban: string | null;
  currency: string | null;
  suggestedType: AccountType;
  /** An open account whose last CAMT statement was for this IBAN */
  suggestedAccountId: string | null;
  /** Where it syncs to now (after a reconnect), or null if not mapped yet */
  accountId: string | null;
  isEnabled: number;
}

export interface ConnectionResult {
  connectionId: string;
  bankName: string;
  accounts: DiscoveredAccount[];
}

const normalizeIban = (iban: string | null | undefined) =>
  iban ? iban.replace(/\s+/g, '').toUpperCase() : null;

function accountName(acct: SessionAccount): string {
  const name = acct.name || acct.product || acct.details || 'Bank account';
  const iban = normalizeIban(acct.account_id?.iban);
  return (iban && !name.includes(iban.slice(-4)) ? `${name} ••${iban.slice(-4)}` : name)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Open accounts by the IBAN of the last CAMT statement imported into them (#95). */
function accountsByStatementIban(): Map<string, string> {
  const result = new Map<string, string>();
  const rows = db
    .select({ id: accounts.id, importSettings: accounts.importSettings })
    .from(accounts)
    .where(isNull(accounts.closedAt))
    .all();
  for (const row of rows) {
    const iban = normalizeIban(readStatementAccount(row.importSettings));
    if (iban && !result.has(iban)) result.set(iban, row.id);
  }
  return result;
}

function discovered(connectionId: string): DiscoveredAccount[] {
  const byIban = accountsByStatementIban();
  return db
    .select()
    .from(enableBankingAccountMappings)
    .where(eq(enableBankingAccountMappings.connectionId, connectionId))
    .all()
    .map((m) => ({
      mappingId: m.id,
      name: m.name,
      iban: m.iban,
      currency: m.currency,
      suggestedType: suggestAccountType(m.cashAccountType),
      suggestedAccountId: (m.iban && byIban.get(m.iban)) || null,
      accountId: m.accountId,
      isEnabled: m.isEnabled,
    }));
}

type SessionAccount = EnableBankingSession['accounts'][number];

/** The session's accounts, each once */
function uniqueAccounts(list: readonly SessionAccount[]): SessionAccount[] {
  const seen = new Set<string>();
  return list.filter((acct) => !seen.has(acct.uid) && !!seen.add(acct.uid));
}

/** A bank account FlyBudget hasn't seen: not mapped to a FlyBudget account yet */
function newMapping(connectionId: string, acct: SessionAccount, now: string) {
  return {
    id: nanoid(),
    connectionId,
    accountUid: acct.uid,
    identificationHash: acct.identification_hash ?? null,
    iban: normalizeIban(acct.account_id?.iban),
    name: accountName(acct),
    currency: acct.currency?.toUpperCase() ?? null,
    cashAccountType: acct.cash_account_type ?? null,
    accountId: null,
    isEnabled: 1,
    createdAt: now,
  };
}

/** Saves a new bank login and its accounts (not mapped to FlyBudget accounts yet). */
export function saveNewConnection(
  session: EnableBankingSession,
  validUntil: Date,
): ConnectionResult {
  const connectionId = nanoid();
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.insert(enableBankingConnections)
      .values({
        id: connectionId,
        sessionId: session.session_id,
        aspspName: session.aspsp.name.slice(0, 200),
        aspspCountry: session.aspsp.country.slice(0, 10),
        psuType: 'personal',
        validUntil: session.access?.valid_until ?? validUntil.toISOString(),
        syncStatus: 'good',
        createdAt: now,
      })
      .run();
    for (const acct of uniqueAccounts(session.accounts)) {
      tx.insert(enableBankingAccountMappings)
        .values(newMapping(connectionId, acct, now))
        .run();
    }
  });
  return { connectionId, bankName: session.aspsp.name, accounts: discovered(connectionId) };
}

/**
 * A new login for an existing connection (its consent ran out, or the bank asked again).
 * The bank's account ids change with every session, so accounts are found again
 * (`matchReturningAccounts`) and keep their mappings and imported history. Known accounts
 * the bank no longer shows are removed, so no sync keeps asking for an id that's gone;
 * their transactions stay, and a new mapping for the same account recognises them by the
 * bank's ids (`matchExistingImports`).
 */
export function reconnectConnection(
  connectionId: string,
  session: EnableBankingSession,
  validUntil: Date,
): ConnectionResult {
  const existing = db
    .select()
    .from(enableBankingAccountMappings)
    .where(eq(enableBankingAccountMappings.connectionId, connectionId))
    .all();
  const returning = uniqueAccounts(session.accounts);
  const pairs = matchReturningAccounts(
    existing,
    returning.map((acct) => ({
      uid: acct.uid,
      identificationHash: acct.identification_hash ?? null,
      iban: normalizeIban(acct.account_id?.iban),
      name: accountName(acct),
      currency: acct.currency?.toUpperCase() ?? null,
    })),
  );
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(enableBankingConnections)
      .set({
        sessionId: session.session_id,
        validUntil: session.access?.valid_until ?? validUntil.toISOString(),
        syncStatus: 'good',
        syncError: null,
      })
      .where(eq(enableBankingConnections.id, connectionId))
      .run();
    for (const acct of returning) {
      const mappingId = pairs.get(acct.uid);
      if (mappingId) {
        tx.update(enableBankingAccountMappings)
          .set({
            accountUid: acct.uid,
            identificationHash:
              acct.identification_hash ??
              existing.find((m) => m.id === mappingId)?.identificationHash ??
              null,
            iban:
              normalizeIban(acct.account_id?.iban) ??
              existing.find((m) => m.id === mappingId)?.iban ??
              null,
          })
          .where(eq(enableBankingAccountMappings.id, mappingId))
          .run();
      } else {
        tx.insert(enableBankingAccountMappings)
          .values(newMapping(connectionId, acct, now))
          .run();
      }
    }
    const kept = new Set(pairs.values());
    for (const m of existing) {
      if (!kept.has(m.id)) {
        tx.delete(enableBankingAccountMappings)
          .where(eq(enableBankingAccountMappings.id, m.id))
          .run();
      }
    }
  });
  const conn = db
    .select({ aspspName: enableBankingConnections.aspspName })
    .from(enableBankingConnections)
    .where(eq(enableBankingConnections.id, connectionId))
    .get();
  return { connectionId, bankName: conn?.aspspName ?? '', accounts: discovered(connectionId) };
}

export interface EnableBankingSyncResult {
  connectionId: string;
  bankName: string;
  added: number;
  /** Already in FlyBudget (from a file or typed in), now recognised as this bank's */
  adopted: number;
  skipped: SkippedCounts;
  errors: string[];
}

/** Where a mapping's sync starts: undefined = as far back as the bank allows. */
function syncStart(
  mapping: { lastBookedDate: string | null; accountId: string },
  fullHistory: boolean,
): string | undefined {
  if (mapping.lastBookedDate) return isoDay(dayMs(mapping.lastBookedDate) - OVERLAP_DAYS * DAY_MS);
  if (fullHistory) return undefined;
  // Linked to an account with history: carry on from it rather than fetch everything again
  const latest = db
    .select({ date: max(transactions.date) })
    .from(transactions)
    .where(eq(transactions.accountId, mapping.accountId))
    .get()?.date;
  return latest ? isoDay(dayMs(latest) - LINKED_START_DAYS * DAY_MS) : undefined;
}

/**
 * Whether Plaid or SimpleFIN still syncs into this account. Their rows are then theirs to
 * keep: giving one an Enable Banking id would make that sync import it again.
 */
function syncedByAnotherProvider(accountId: string): boolean {
  const linked = (table: typeof plaidAccountMappings | typeof simplefinAccountMappings) =>
    db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.accountId, accountId), eq(table.isEnabled, 1)))
      .get() !== undefined;
  return linked(plaidAccountMappings) || linked(simplefinAccountMappings);
}

function syncMapping(
  mapping: typeof enableBankingAccountMappings.$inferSelect & { accountId: string },
  raw: unknown[],
  ruleOpts: Parameters<typeof insertNewTransaction>[1],
  result: EnableBankingSyncResult,
) {
  const { transactions: mapped, skipped } = mapTransactions(raw, {
    mappingId: mapping.id,
    currency: mapping.currency,
  });
  result.skipped.noDate += skipped.noDate;
  result.skipped.badAmount += skipped.badAmount;
  result.skipped.otherCurrency += skipped.otherCurrency;
  if (!mapped.length) return;

  const prefix = `${ENABLE_BANKING_ID_PREFIX}${mapping.id}:`;
  const known = new Set(
    db
      .select({ importedId: transactions.importedId })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, mapping.accountId),
          sql`substr(${transactions.importedId}, 1, ${prefix.length}) = ${prefix}`,
        ),
      )
      .all()
      .map((r) => r.importedId),
  );
  const fresh = mapped.filter((tx) => !known.has(tx.importedId));

  let latest = mapping.lastBookedDate;
  for (const tx of mapped) if (!latest || tx.date > latest) latest = tx.date;

  if (fresh.length) {
    const dates = fresh.map((tx) => dayMs(tx.date));
    // Rows that came from somewhere else and may be the same transactions: split parts and
    // balance adjustments never are
    const candidates = db
      .select({
        id: transactions.id,
        date: transactions.date,
        amount: transactions.amount,
        importedId: transactions.importedId,
        reconciled: transactions.reconciled,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, mapping.accountId),
          isNull(transactions.parentTransactionId),
          eq(transactions.isAdjustment, 0),
          gte(transactions.date, isoDay(Math.min(...dates) - ADOPT_MAX_DAYS * DAY_MS)),
          lte(transactions.date, isoDay(Math.max(...dates) + ADOPT_MAX_DAYS * DAY_MS)),
        ),
      )
      .all();
    const reconciled = new Set(candidates.filter((c) => c.reconciled).map((c) => c.id));
    const matches = matchExistingImports(fresh, candidates, {
      mappingId: mapping.id,
      keepProviderRows: syncedByAnotherProvider(mapping.accountId),
    });

    db.transaction(() => {
      fresh.forEach((tx, i) => {
        const existingId = matches.get(i);
        if (existingId) {
          // Reconciled rows are never changed; they still keep the bank's copy out
          if (!reconciled.has(existingId)) {
            db.update(transactions)
              .set({ importedId: tx.importedId })
              .where(eq(transactions.id, existingId))
              .run();
          }
          result.adopted++;
          return;
        }
        insertNewTransaction(
          {
            accountId: mapping.accountId,
            date: tx.date,
            amount: tx.amount,
            payeeId: null,
            payeeName: tx.payeeName,
            importedPayee: tx.importedPayee,
            notes: tx.notes,
            categoryId: null,
            importedId: tx.importedId,
          },
          ruleOpts,
        );
        result.added++;
      });
    });
  }

  if (latest !== mapping.lastBookedDate) {
    db.update(enableBankingAccountMappings)
      .set({ lastBookedDate: latest })
      .where(eq(enableBankingAccountMappings.id, mapping.id))
      .run();
  }
}

/**
 * Syncs one bank login: each mapped account's booked transactions (pending ones change or
 * disappear, and some banks give them a new id once booked), then its balance. An account
 * that fails doesn't stop the others; an ended session stops them all, since every account
 * needs the user to reconnect.
 */
export async function syncEnableBankingConnection(
  connectionId: string,
  opts: { psu?: PsuContext; fullHistory?: readonly string[] } = {},
): Promise<EnableBankingSyncResult> {
  const conn = db
    .select({
      id: enableBankingConnections.id,
      aspspName: enableBankingConnections.aspspName,
    })
    .from(enableBankingConnections)
    .where(eq(enableBankingConnections.id, connectionId))
    .get();
  if (!conn) throw new Error('Enable Banking connection not found');

  const result: EnableBankingSyncResult = {
    connectionId,
    bankName: conn.aspspName,
    added: 0,
    adopted: 0,
    skipped: emptySkipped(),
    errors: [],
  };
  const setStatus = (values: Partial<typeof enableBankingConnections.$inferInsert>) =>
    db
      .update(enableBankingConnections)
      .set(values)
      .where(eq(enableBankingConnections.id, connectionId))
      .run();

  const creds = loadEnableBankingConfig();
  if (!creds) {
    const message =
      'Enable Banking is not set up. Add your application in Settings → Connected banks.';
    setStatus({ syncStatus: 'error', syncError: message });
    result.errors.push(message);
    return result;
  }

  setStatus({ syncStatus: 'syncing', syncError: null });
  const mappings = db
    .select()
    .from(enableBankingAccountMappings)
    .where(eq(enableBankingAccountMappings.connectionId, connectionId))
    .all()
    .filter((m): m is typeof m & { accountId: string } => !!m.accountId && m.isEnabled === 1);
  const ruleOpts = { rules: loadRules(), ctx: buildRuleContext() };
  const fullHistory = new Set(opts.fullHistory ?? []);

  try {
    for (const mapping of mappings) {
      try {
        const raw = await getTransactions(creds, mapping.accountUid, {
          dateFrom: syncStart(mapping, fullHistory.has(mapping.id)),
          psu: opts.psu,
        });
        syncMapping(mapping, raw, ruleOpts, result);
      } catch (err) {
        if (err instanceof EnableBankingError && err.kind === 'login_required') throw err;
        logError(`Enable Banking sync failed for ${mapping.name}`, err);
        result.errors.push(`${mapping.name}: ${enableBankingErrorMessage(err)}`);
        continue;
      }
      // The balance is a bonus: a bank that can't give one still gets its transactions
      try {
        const balance = pickBalance(await getBalances(creds, mapping.accountUid, opts.psu));
        if (balance !== null) {
          db.update(accounts)
            .set({ startingBalance: balance - accountTransactionSum(mapping.accountId) })
            .where(eq(accounts.id, mapping.accountId))
            .run();
        }
      } catch (err) {
        if (err instanceof EnableBankingError && err.kind === 'login_required') throw err;
        logError(`Enable Banking balance failed for ${mapping.name}`, err);
      }
    }
    setStatus({
      lastSyncedAt: new Date().toISOString(),
      syncStatus: result.errors.length ? 'error' : 'good',
      syncError: result.errors[0] ?? null,
    });
  } catch (err) {
    logError('Enable Banking sync failed', err);
    const message = enableBankingErrorMessage(err);
    const loginRequired = err instanceof EnableBankingError && err.kind === 'login_required';
    setStatus({ syncStatus: loginRequired ? 'login_required' : 'error', syncError: message });
    result.errors.push(message);
  }
  return result;
}

/**
 * On startup no sync can be running, so a connection still marked "syncing" was cut off
 * (FlyBudget quit or crashed mid-sync). Without this its Sync button would stay disabled
 * until the next startup sync, which waits for the bank's daily limit.
 */
export function resetInterruptedSyncs() {
  db.update(enableBankingConnections)
    .set({
      syncStatus: 'error',
      syncError: 'The last sync was interrupted. Sync again to finish it.',
    })
    .where(eq(enableBankingConnections.syncStatus, 'syncing'))
    .run();
}

/**
 * Syncs every connection. Unattended (on startup) it leaves out ones that need the user
 * (ended consent) and ones synced in the last few hours, so the bank's daily limit for
 * background requests isn't used up by restarts.
 */
export async function syncAllEnableBankingConnections(
  opts: { psu?: PsuContext; unattended?: boolean } = {},
): Promise<EnableBankingSyncResult[]> {
  if (!loadEnableBankingConfig()) return [];
  if (opts.unattended) resetInterruptedSyncs();
  const connections = db
    .select({
      id: enableBankingConnections.id,
      aspspName: enableBankingConnections.aspspName,
      validUntil: enableBankingConnections.validUntil,
      syncStatus: enableBankingConnections.syncStatus,
      lastSyncedAt: enableBankingConnections.lastSyncedAt,
    })
    .from(enableBankingConnections)
    .all();
  const now = Date.now();
  const results: EnableBankingSyncResult[] = [];
  for (const conn of connections) {
    if (conn.validUntil && Date.parse(conn.validUntil) < now) {
      db.update(enableBankingConnections)
        .set({
          syncStatus: 'login_required',
          syncError: enableBankingErrorMessage(new EnableBankingError('login_required')),
        })
        .where(eq(enableBankingConnections.id, conn.id))
        .run();
      continue;
    }
    if (opts.unattended) {
      if (conn.syncStatus === 'login_required') continue;
      if (conn.lastSyncedAt && now - Date.parse(conn.lastSyncedAt) < UNATTENDED_MIN_INTERVAL_MS) {
        continue;
      }
    }
    try {
      results.push(await syncEnableBankingConnection(conn.id, { psu: opts.psu }));
    } catch (err) {
      results.push({
        connectionId: conn.id,
        bankName: conn.aspspName,
        added: 0,
        adopted: 0,
        skipped: emptySkipped(),
        errors: [enableBankingErrorMessage(err)],
      });
    }
  }
  return results;
}
