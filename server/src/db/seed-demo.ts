import { count } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, databasePath } from './index.js';
import { categoryGroups, transactions } from './schema.js';
import { loadDemoBudget } from '../demo/loadDemoBudget.js';

// Loads the website demo's budget (src/demo) into a new, empty database, e.g. to work on
// the demo or take screenshots: DB_PATH=demo.db npm run db:seed-demo
migrate(db, { migrationsFolder: 'src/db/migrations' });
const [{ groups }] = db.select({ groups: count() }).from(categoryGroups).all();
const [{ txns }] = db.select({ txns: count() }).from(transactions).all();
if (groups > 0 || txns > 0) {
  console.error(`${databasePath} already has a budget. Point DB_PATH at a new file.`);
  process.exit(1);
}
loadDemoBudget(new Date());
console.log(`Loaded the demo budget into ${databasePath}.`);
