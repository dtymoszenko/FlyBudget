import path from 'path';
import { getTableColumns, isNotNull, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { databasePath, db, sqlite } from '../db/index.js';
import {
  accounts,
  budgetMonths,
  categories,
  categoryGroups,
  customReports,
  dashboardPages,
  dashboardWidgets,
  goals,
  payees,
  plaidAccountMappings,
  rules,
  scheduleMatchDismissals,
  scheduleOccurrences,
  schedules,
  simplefinAccountMappings,
  transactions,
} from '../db/schema.js';

// Full JSON backup of the user's data, and restoring one.
//
// Bank credentials (Plaid/SimpleFIN), the server password and login sessions are
// never included: a backup file is easy to leave lying around, and credentials are
// encrypted with a key that only this installation has anyway. After a restore,
// connected banks keep syncing into the same accounts when the backup came from
// this installation.

export const BACKUP_FORMAT = 'flybudget-backup';
export const BACKUP_VERSION = 2;

/** Every table in a backup, parents before the tables that reference them. */
const TABLES = {
  accounts,
  categoryGroups,
  categories,
  payees,
  schedules,
  transactions,
  scheduleOccurrences,
  scheduleMatchDismissals,
  budgetMonths,
  rules,
  customReports,
  dashboardPages,
  dashboardWidgets,
  goals,
} satisfies Record<string, SQLiteTable>;

export type BackupTable = keyof typeof TABLES;
export const BACKUP_TABLES = Object.keys(TABLES) as BackupTable[];

const MAX_ROWS_PER_TABLE = 2_000_000;

export function createBackup() {
  const data: Record<string, unknown> = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
  };
  db.transaction((tx) => {
    for (const name of BACKUP_TABLES) data[name] = tx.select().from(TABLES[name]).all();
  });
  return data;
}

export class InvalidBackupError extends Error {}

type Row = Record<string, unknown>;

/**
 * Checks a backup's shape against the schema: every table is a list of rows, and every
 * column has the right type (SQLite would otherwise happily store "abc" as an amount).
 * Tables missing from older backups are restored as empty. Unknown fields are dropped.
 */
export function parseBackup(input: unknown): Record<BackupTable, Row[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidBackupError('This is not a FlyBudget backup file');
  }
  const body = input as Record<string, unknown>;
  const isV1 = body.format === undefined && Array.isArray(body.accounts);
  if (!isV1 && body.format !== BACKUP_FORMAT) {
    throw new InvalidBackupError('This is not a FlyBudget backup file');
  }
  if (typeof body.version === 'number' && body.version > BACKUP_VERSION) {
    throw new InvalidBackupError('This backup was made by a newer version of FlyBudget');
  }

  const result = {} as Record<BackupTable, Row[]>;
  for (const name of BACKUP_TABLES) {
    const rows = body[name] ?? [];
    if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_TABLE) {
      throw new InvalidBackupError(`"${name}" in the backup is not a list of rows`);
    }
    const columns = Object.entries(getTableColumns(TABLES[name]));
    result[name] = rows.map((raw, i) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new InvalidBackupError(`Row ${i + 1} of "${name}" is not valid`);
      }
      const row: Row = {};
      for (const [key, column] of columns) {
        const value = (raw as Row)[key];
        if (value === undefined || value === null) {
          if (column.notNull && !column.hasDefault) {
            throw new InvalidBackupError(`Row ${i + 1} of "${name}" is missing "${key}"`);
          }
          if (value === null && !column.notNull) row[key] = null;
          continue;
        }
        const ok =
          column.columnType === 'SQLiteInteger'
            ? Number.isSafeInteger(value)
            : typeof value === 'string' && value.length <= 1_000_000;
        if (!ok) throw new InvalidBackupError(`Row ${i + 1} of "${name}" has an invalid "${key}"`);
        row[key] = value;
      }
      return row;
    });
  }
  return result;
}

/** Copies the current database next to it before a restore replaces everything. */
export async function saveSafetyCopy(): Promise<string | null> {
  if (databasePath === ':memory:') return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(path.dirname(databasePath), `budget-before-restore-${stamp}.db`);
  await sqlite.backup(file);
  return path.basename(file);
}

/** Replaces all budget data with the backup's, in one transaction: all or nothing. */
export function restoreBackup(data: Record<BackupTable, Row[]>) {
  // Bank connections aren't in backups; remember which accounts they sync into
  const plaidLinks = db
    .select({ id: plaidAccountMappings.id, accountId: plaidAccountMappings.accountId })
    .from(plaidAccountMappings)
    .where(isNotNull(plaidAccountMappings.accountId))
    .all();
  const simplefinLinks = db
    .select({ id: simplefinAccountMappings.id, accountId: simplefinAccountMappings.accountId })
    .from(simplefinAccountMappings)
    .where(isNotNull(simplefinAccountMappings.accountId))
    .all();
  const restoredAccounts = new Set(data.accounts.map((a) => a.id as string));

  db.transaction((tx) => {
    // Foreign keys are checked once, at commit, so rows can go in table by table
    tx.run(sql`PRAGMA defer_foreign_keys = ON`);
    for (const name of [...BACKUP_TABLES].reverse()) tx.delete(TABLES[name]).run();
    for (const name of BACKUP_TABLES) {
      const rows = data[name];
      // Chunked: SQLite limits how many values one statement may bind
      for (let i = 0; i < rows.length; i += 200) {
        tx.insert(TABLES[name])
          .values(rows.slice(i, i + 200) as never)
          .run();
      }
    }
    for (const [table, links] of [
      [plaidAccountMappings, plaidLinks],
      [simplefinAccountMappings, simplefinLinks],
    ] as const) {
      for (const link of links) {
        if (!link.accountId || !restoredAccounts.has(link.accountId)) continue;
        tx.update(table)
          .set({ accountId: link.accountId })
          .where(sql`${table.id} = ${link.id}`)
          .run();
      }
    }
  });

  return Object.fromEntries(BACKUP_TABLES.map((name) => [name, data[name].length]));
}
