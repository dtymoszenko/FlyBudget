// Safe copy of the database while FlyBudget is running (SQLite online backup, so
// changes still in the write-ahead log are included).
//   docker exec flybudget node backup.cjs
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH;
const dir = path.join(path.dirname(dbPath), 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = path.join(dir, `budget-${stamp}.db`);

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.backup(file)
  .then(() => console.log(`Backup saved to ${file}`))
  .finally(() => db.close());
