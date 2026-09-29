// In-browser demo stand-in for db/index.ts (see README.md here): the same exports, backed
// by sql.js (SQLite compiled to WebAssembly) in memory instead of better-sqlite3 on disk.
// Drizzle's sql.js driver is synchronous like better-sqlite3's, so every query in the
// routes and services runs unchanged.
import type { Database } from 'sql.js';
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import { PreparedQuery } from 'drizzle-orm/sql-js/session';
import * as schema from '../db/schema.js';

// better-sqlite3's .run() reports how many rows changed (the reconcile route returns it);
// sql.js's doesn't, so add it
const originalRun = PreparedQuery.prototype.run;
PreparedQuery.prototype.run = function (this: { client: Database }, ...args) {
  originalRun.apply(this, args);
  return { changes: this.client.getRowsModified(), lastInsertRowid: 0 };
} as typeof originalRun;

export const databasePath = ':memory:';

// Some routes build queries when they load (budget.ts's on-budget subquery), before the
// worker has opened a database. Building a query doesn't touch the connection, so start
// with one that has none; running a query before useDatabase() is a bug and fails loudly.
let current = drizzle(null as unknown as Database, { schema });

/** Points every module's `db` at a new database (the demo resets by opening a fresh one). */
export function useDatabase(database: Database) {
  current = drizzle(database, { schema });
}

export const db = new Proxy({} as SQLJsDatabase<typeof schema>, {
  get(_target, prop) {
    const value = Reflect.get(current, prop, current);
    return typeof value === 'function' ? value.bind(current) : value;
  },
});

/** Only backups use the raw connection, to save a safety copy, which the demo skips. */
export const sqlite = {
  backup: async () => {},
};
