// The in-browser demo's Web Worker (see README.md here). It opens a fresh in-memory
// database, applies the real migrations, loads the demo budget, then answers the page's
// API requests with the real routes, off the page's main thread.
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { useDatabase } from './db.js';
import { handleRequest, type DemoRequest } from './app.js';
import { loadDemoBudget } from '../demo/loadDemoBudget.js';

// Every migration in order (the file names start with their number)
const migrationFiles = import.meta.glob<string>('../db/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const migrations = Object.keys(migrationFiles)
  .sort()
  .map((file) => migrationFiles[file]);

export type WorkerMessage =
  { type: 'request'; id: number; request: DemoRequest } | { type: 'reset'; id: number };

let sqlJs: Promise<SqlJsStatic> | null = null;

async function openDemo(): Promise<void> {
  sqlJs ??= initSqlJs({ locateFile: () => wasmUrl });
  const SQL = await sqlJs;
  const database = new SQL.Database();
  database.run('PRAGMA foreign_keys = ON');
  for (const migration of migrations) {
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) database.run(statement);
    }
  }
  useDatabase(database);
  loadDemoBudget(new Date());
}

// Requests wait until the demo budget is ready, and for a reset to finish
let ready = openDemo();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  // A dedicated worker only hears from the page that started it (whose messages have an
  // empty origin or this one), but check anyway
  if (event.origin && event.origin !== self.location.origin) return;
  const message = event.data;
  try {
    if (message.type === 'reset') {
      ready = openDemo();
      await ready;
      self.postMessage({ id: message.id, ok: true });
      return;
    }
    await ready;
    const response = await handleRequest(message.request);
    self.postMessage({ id: message.id, ok: true, response });
  } catch (err) {
    console.error('Demo worker error:', err);
    self.postMessage({ id: message.id, ok: false, error: String(err) });
  }
};
