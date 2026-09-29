import { db } from '../db/index.js';
import {
  simplefinConnections,
  simplefinAccountMappings,
  transactions,
  accounts,
} from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import {
  fetchAccounts,
  simpleFinAmountToCents,
  simpleFinBalanceToCents,
} from './simplefinService.js';
import { buildRuleContext, insertNewTransaction, loadRules } from './ruleService.js';
import { accountTransactionSum } from './balances.js';

export interface SimplefinSyncResult {
  connectionId: string;
  connectionName: string;
  added: number;
  errors: string[];
}

export async function syncSimplefinConnection(connectionId: string): Promise<SimplefinSyncResult> {
  const conn = db
    .select()
    .from(simplefinConnections)
    .where(eq(simplefinConnections.id, connectionId))
    .get();
  if (!conn) throw new Error('SimpleFIN connection not found');

  const result: SimplefinSyncResult = {
    connectionId,
    connectionName: conn.connectionName,
    added: 0,
    errors: [],
  };

  db.update(simplefinConnections)
    .set({ syncStatus: 'syncing', syncError: null })
    .where(eq(simplefinConnections.id, connectionId))
    .run();

  try {
    const ninetyDaysAgo = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);
    const data = await fetchAccounts(conn.accessUrl, ninetyDaysAgo);

    const mappings = db
      .select()
      .from(simplefinAccountMappings)
      .where(eq(simplefinAccountMappings.connectionId, connectionId))
      .all();

    const mappingBySfId = new Map(mappings.map((m) => [m.simplefinAccountId, m]));

    const ruleOpts = { rules: loadRules(), ctx: buildRuleContext() };
    for (const sfAccount of data.accounts) {
      const mapping = mappingBySfId.get(sfAccount.id);
      if (!mapping || !mapping.accountId || !mapping.isEnabled) continue;

      for (const tx of sfAccount.transactions) {
        if (tx.pending) continue;

        const importedId = `simplefin:${sfAccount.id}:${tx.id}`;
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

        const amount = simpleFinAmountToCents(tx.amount);
        const date =
          tx.posted > 0
            ? new Date(tx.posted * 1000).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];
        // Bank-supplied text: strip control characters and cap the length
        const payeeName =
          tx.description
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .trim()
            .slice(0, 200) || 'Unknown';
        insertNewTransaction(
          {
            accountId: mapping.accountId,
            date,
            amount,
            payeeId: null,
            payeeName,
            importedPayee: payeeName,
            notes: null,
            categoryId: null,
            importedId,
          },
          ruleOpts,
        );

        result.added++;
      }

      const targetBalance = simpleFinBalanceToCents(sfAccount.balance);
      const newStartingBalance = targetBalance - accountTransactionSum(mapping.accountId);

      db.update(accounts)
        .set({ startingBalance: newStartingBalance })
        .where(eq(accounts.id, mapping.accountId))
        .run();
    }

    db.update(simplefinConnections)
      .set({
        lastSyncedAt: new Date().toISOString(),
        syncStatus: 'good',
        syncError: null,
      })
      .where(eq(simplefinConnections.id, connectionId))
      .run();
  } catch (err: any) {
    const errorMessage = err?.message ?? 'Unknown error';

    db.update(simplefinConnections)
      .set({
        syncStatus: 'error',
        syncError: errorMessage,
      })
      .where(eq(simplefinConnections.id, connectionId))
      .run();

    result.errors.push(errorMessage);
  }

  return result;
}

export async function syncAllSimplefinConnections(): Promise<SimplefinSyncResult[]> {
  const connections = db.select().from(simplefinConnections).all();
  if (connections.length === 0) return [];

  const results: SimplefinSyncResult[] = [];
  for (const conn of connections) {
    try {
      const result = await syncSimplefinConnection(conn.id);
      results.push(result);
    } catch (err: any) {
      results.push({
        connectionId: conn.id,
        connectionName: conn.connectionName,
        added: 0,
        errors: [err.message],
      });
    }
  }
  return results;
}
