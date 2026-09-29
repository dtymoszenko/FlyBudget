import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'path';
import { fileURLToPath } from 'url';

// electron sets DB_PATH to appData, otherwise use project root
let dbPath: string;
if (process.env.DB_PATH) {
  dbPath = process.env.DB_PATH;
} else {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dbPath = path.resolve(__dirname, '../../budget.db');
}

const dbOptions: ConstructorParameters<typeof Database>[1] = {};
if (process.env.DB_NATIVE_BINDING) {
  dbOptions.nativeBinding = process.env.DB_NATIVE_BINDING;
}

/** Where the database lives (':memory:' in tests) */
export const databasePath = dbPath;

export const sqlite = new Database(dbPath, dbOptions);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
