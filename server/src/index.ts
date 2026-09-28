import express from 'express';
import cors from 'cors';
import {
  DEV_CLIENT_ORIGINS,
  apiTokenGuard,
  bankRateLimit,
  hostGuard,
  originGuard,
  securityHeaders,
} from './middleware/security.js';
import { accountsRouter } from './routes/accounts.js';
import { categoriesRouter } from './routes/categories.js';
import { transactionsRouter } from './routes/transactions.js';
import { budgetRouter } from './routes/budget.js';
import { payeesRouter } from './routes/payees.js';
import { rulesRouter } from './routes/rules.js';
import { reportsRouter } from './routes/reports.js';
import { exportRouter } from './routes/export.js';
import { customReportsRouter } from './routes/customReports.js';
import { schedulesRouter } from './routes/schedules.js';
import { goalsRouter } from './routes/goals.js';
import { plaidRouter } from './routes/plaid.js';
import { simplefinRouter } from './routes/simplefin.js';
import { syncAllItems } from './services/plaidSyncService.js';
import { encryptStoredCredentials } from './services/credentialEncryption.js';
import { isPlaidConfigured } from './services/plaidService.js';
import { syncAllSimplefinConnections } from './services/simplefinSyncService.js';
import {
  migrateRecurrenceRules,
  migrateOccurrencesFromLegacy,
  ensureOccurrencesForAll,
  autoCreateDueScheduled,
} from './services/scheduleService.js';
import { format, addDays } from 'date-fns';

const app = express();

// Binding to 127.0.0.1 doesn't stop other sites open in the user's browser, or other
// programs on the machine, from calling this API — see middleware/security.ts.
app.disable('x-powered-by');
app.use(hostGuard);
app.use(originGuard);
app.use(apiTokenGuard(process.env.FLYBUDGET_API_TOKEN));
app.use(securityHeaders);
// The Vite dev server and the packaged Electron app (which serves the client from
// this server, see startServer) are same-origin already; this covers direct
// cross-origin dev requests to :3001.
app.use(cors({ origin: DEV_CLIENT_ORIGINS }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/accounts', accountsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/budget', budgetRouter);
app.use('/api/payees', payeesRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/export', exportRouter);
app.use('/api/custom-reports', customReportsRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/plaid', bankRateLimit, plaidRouter);
app.use('/api/simplefin', bankRateLimit, simplefinRouter);

export async function startServer(port: number | string): Promise<void> {
  if (process.env.ELECTRON_PROD) {
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    const { db } = await import('./db/index.js');
    migrate(db, { migrationsFolder: process.env.MIGRATIONS_PATH! });
  }
  // Electron serves the built client from this server so the page is same-origin
  // with the API (a file:// page would send Origin: null, which can't be allowlisted safely).
  if (process.env.CLIENT_DIST) {
    app.use(express.static(process.env.CLIENT_DIST));
  }
  return new Promise((resolve) => {
    app.listen(Number(port), '127.0.0.1', () => {
      console.log(`Server running on http://localhost:${port}`);

      const credentialsEncrypted = encryptStoredCredentials();
      if (credentialsEncrypted > 0)
        console.log(`Encrypted ${credentialsEncrypted} stored bank credential(s)`);

      // --- Schedule system startup ---
      const rulesMigrated = migrateRecurrenceRules();
      if (rulesMigrated > 0) console.log(`Migrated ${rulesMigrated} recurrence rule(s)`);

      const legacyOccs = migrateOccurrencesFromLegacy();
      if (legacyOccs > 0) console.log(`Created ${legacyOccs} legacy occurrence(s)`);

      const horizon = format(addDays(new Date(), 90), 'yyyy-MM-dd');
      const ensured = ensureOccurrencesForAll(horizon);
      if (ensured > 0) console.log(`Ensured ${ensured} new occurrence(s)`);

      // Bank sync BEFORE schedule auto-create (so real txns get matched first)
      const bankSyncDone = Promise.all([
        isPlaidConfigured()
          ? syncAllItems()
              .then((results) => {
                const total = results.reduce((s, r) => s + r.added, 0);
                if (total > 0) console.log(`Plaid sync: imported ${total} new transaction(s)`);
              })
              .catch((err) => console.error('Plaid sync error:', err.message))
          : Promise.resolve(),
        syncAllSimplefinConnections()
          .then((results) => {
            const total = results.reduce((s, r) => s + r.added, 0);
            if (total > 0) console.log(`SimpleFIN sync: imported ${total} new transaction(s)`);
          })
          .catch((err) => console.error('SimpleFIN sync error:', err.message)),
      ]);

      bankSyncDone.then(() => {
        const scheduled = autoCreateDueScheduled();
        if (scheduled > 0) console.log(`Auto-created ${scheduled} scheduled transaction(s)`);
      });

      resolve();
    });
  });
}

// Auto-start unless bundled for Electron production (where main.ts calls startServer directly)
if (!process.env.ELECTRON_PROD) {
  startServer(process.env.EXPRESS_PORT ?? process.env.PORT ?? 3001).catch(console.error);
}
