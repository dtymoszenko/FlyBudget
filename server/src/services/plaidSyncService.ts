import { db } from '../db/index.js';
import { plaidItems, plaidAccountMappings, transactions, accounts } from '../db/schema.js';
import { logError } from '../utils/log.js';
import { eq, and, inArray } from 'drizzle-orm';
import { syncTransactions, plaidAmountToCents, plaidBalanceToCents } from './plaidService.js';
import { buildRuleContext, insertNewTransaction, loadRules } from './ruleService.js';
import { currencyContext, refreshMainAmounts } from './mainAmountService.js';
import { minorUnits } from '../utils/currencies.js';
import { accountTransactionSum } from './balances.js';
import { deleteTransactionRow } from './transactionHelpers.js';
import { syncedTransferChange } from './transferService.js';

export interface SyncResult {
  itemId: string;
  institutionName: string;
  added: number;
  modified: number;
  removed: number;
  errors: string[];
}

// pulls new/modified/removed txns from plaid, adjusts balances to match
export async function syncPlaidItem(plaidItemId: string): Promise<SyncResult> {
  const item = db.select().from(plaidItems).where(eq(plaidItems.id, plaidItemId)).get();
  if (!item) throw new Error('Plaid item not found');

  const result: SyncResult = {
    itemId: plaidItemId,
    institutionName: item.institutionName,
    added: 0,
    modified: 0,
    removed: 0,
    errors: [],
  };

  db.update(plaidItems)
    .set({ syncStatus: 'syncing', syncError: null })
    .where(eq(plaidItems.id, plaidItemId))
    .run();

  try {
    const syncData = await syncTransactions(item.accessToken, item.cursor);

    const mappings = db
      .select()
      .from(plaidAccountMappings)
      .where(eq(plaidAccountMappings.plaidItemId, plaidItemId))
      .all();

    const mappingByPlaidId = new Map(mappings.map((m) => [m.plaidAccountId, m]));
    const ruleOpts = { rules: loadRules(), ctx: buildRuleContext(), currencies: currencyContext() };

    /** A transaction in another currency than its bank account isn't imported (yet) */
    const otherCurrency = (m: { currency: string | null }, tx: { currency: string | null }) =>
      !!m.currency && !!tx.currency && m.currency !== tx.currency;
    const minorOf = (m: { currency: string | null }) => minorUnits(m.currency);

    for (const tx of syncData.added) {
      const mapping = mappingByPlaidId.get(tx.accountId);
      if (!mapping || !mapping.accountId || !mapping.isEnabled) continue;
      if (otherCurrency(mapping, tx)) continue;

      const importedId = `plaid:${tx.transactionId}`;
      const existing = db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, mapping.accountId),
            eq(transactions.importedId, importedId),
          ),
        )
        .get();
      if (existing) continue;

      insertNewTransaction(
        {
          accountId: mapping.accountId,
          date: tx.date,
          amount: plaidAmountToCents(tx.amount, minorOf(mapping)),
          payeeId: null,
          payeeName: tx.merchantName || tx.name,
          // Plaid's `name` is the original bank description; `merchantName` its cleaned-up guess
          importedPayee: tx.name || null,
          notes: null,
          categoryId: null,
          importedId,
        },
        ruleOpts,
      );

      result.added++;
    }

    for (const tx of syncData.modified) {
      const mapping = mappingByPlaidId.get(tx.accountId);
      if (!mapping || !mapping.accountId || !mapping.isEnabled) continue;
      if (otherCurrency(mapping, tx)) continue;

      const importedId = `plaid:${tx.transactionId}`;
      const existing = db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, mapping.accountId),
            eq(transactions.importedId, importedId),
          ),
        )
        .get();
      if (!existing || existing.reconciled === 1) continue;

      const amount = plaidAmountToCents(tx.amount, minorOf(mapping));
      const payeeName = tx.merchantName || tx.name;

      // Plaid's `name` is the original bank description, as on the added path
      const importedPayee = tx.name || payeeName;
      // One transaction: the other side of a transfer and this row change together
      db.transaction(() => {
        // A transfer's other side follows, or the two are unlinked (see syncedTransferChange)
        const transfer = syncedTransferChange(existing, {
          date: tx.date,
          amount,
          importedPayee,
        });
        db.update(transactions)
          .set(
            transfer === 'unlinked'
              ? existing.transferTransactionId
                ? // Just unlinked: its payee was set from the bank's text
                  { date: tx.date, amount, importedPayee }
                : { date: tx.date, amount, payeeName }
              : // A linked transfer keeps its "Transfer: account" name; the bank's text is kept
                // for rules. A reconciled other side keeps the pair's amount
                transfer === 'locked'
                ? { date: tx.date, importedPayee }
                : { date: tx.date, amount, importedPayee },
          )
          .where(eq(transactions.id, existing.id))
          .run();
        // Its value (and a transfer's other side's) follows; a typed-in one stays unless the
        // amount changed
        refreshMainAmounts([existing.id], { keepManual: amount === existing.amount });
      });

      result.modified++;
    }

    const itemAccountIds = mappings.flatMap((m) => (m.accountId ? [m.accountId] : []));
    for (const tx of syncData.removed) {
      const importedId = `plaid:${tx.transactionId}`;
      const existing = itemAccountIds.length
        ? db
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.importedId, importedId),
                inArray(transactions.accountId, itemAccountIds),
              ),
            )
            .get()
        : undefined;
      if (!existing || existing.reconciled === 1) continue;

      deleteTransactionRow(existing);
      result.removed++;
    }

    for (const bal of syncData.accountBalances) {
      const mapping = mappingByPlaidId.get(bal.accountId);
      if (!mapping || !mapping.accountId || !mapping.isEnabled) continue;

      const targetBalance = plaidBalanceToCents(
        bal.current,
        mapping.plaidAccountType,
        minorOf(mapping),
      );

      const newStartingBalance = targetBalance - accountTransactionSum(mapping.accountId);

      db.update(accounts)
        .set({ startingBalance: newStartingBalance })
        .where(eq(accounts.id, mapping.accountId))
        .run();
    }

    db.update(plaidItems)
      .set({
        cursor: syncData.nextCursor,
        lastSyncedAt: new Date().toISOString(),
        syncStatus: 'good',
        syncError: null,
      })
      .where(eq(plaidItems.id, plaidItemId))
      .run();
  } catch (err: any) {
    logError('Plaid sync failed', err);
    // Plaid's own message is meant for users; anything else may carry internal details
    const errorMessage = err?.response?.data?.error_message ?? 'Could not reach Plaid';
    const errorCode = err?.response?.data?.error_code ?? '';

    const syncStatus = errorCode === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'error';

    db.update(plaidItems)
      .set({
        syncStatus,
        syncError: errorMessage,
      })
      .where(eq(plaidItems.id, plaidItemId))
      .run();

    result.errors.push(errorMessage);
  }

  return result;
}

export async function syncAllItems(): Promise<SyncResult[]> {
  const items = db.select().from(plaidItems).all();
  if (items.length === 0) return [];

  const results: SyncResult[] = [];
  for (const item of items) {
    if (item.syncStatus === 'login_required') continue;
    try {
      const result = await syncPlaidItem(item.id);
      results.push(result);
    } catch (err: any) {
      results.push({
        itemId: item.id,
        institutionName: item.institutionName,
        added: 0,
        modified: 0,
        removed: 0,
        errors: [err?.response?.data?.error_message ?? 'Could not reach Plaid'],
      });
    }
  }
  return results;
}
