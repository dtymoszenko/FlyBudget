import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { listenHost, serverMode, trustProxy } from './config.js';
import { secretCipher } from './db/secretCrypto.js';
import { deleteExpiredSessions, isPasswordSet } from './auth/sessions.js';
import { setupCode } from './auth/setupCode.js';
import { authRouter, requireSession } from './routes/auth.js';
import {
  DEV_CLIENT_ORIGINS,
  apiNotFound,
  apiTokenGuard,
  bankRateLimit,
  errorHandler,
  hostGuard,
  originGuard,
  proxyConfigWarning,
  securityHeaders,
  hstsWhenSecure,
} from './middleware/security.js';
import { accountsRouter } from './routes/accounts.js';
import { categoriesRouter } from './routes/categories.js';
import { transactionsRouter } from './routes/transactions.js';
import { budgetRouter } from './routes/budget.js';
import { payeesRouter } from './routes/payees.js';
import { rulesRouter } from './routes/rules.js';
import { reportsRouter } from './routes/reports.js';
import { RESTORE_PATH, exportRouter } from './routes/export.js';
import { customReportsRouter } from './routes/customReports.js';
import { dashboardsRouter } from './routes/dashboards.js';
import { schedulesRouter } from './routes/schedules.js';
import { goalsRouter } from './routes/goals.js';
import { plaidRouter } from './routes/plaid.js';
import { simplefinRouter } from './routes/simplefin.js';
import { syncAllItems } from './services/plaidSyncService.js';
import { encryptStoredCredentials } from './services/credentialEncryption.js';
import { seedDefaultCategories } from './db/defaultCategories.js';
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

// Behind a reverse proxy (server mode), trust it for HTTPS and client-IP detection
if (trustProxy) {
  app.set(
    'trust proxy',
    /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' || trustProxy,
  );
}

// Binding to 127.0.0.1 doesn't stop other sites open in the user's browser, or other
// programs on the machine, from calling this API — see middleware/security.ts.
app.disable('x-powered-by');
app.use(proxyConfigWarning);
app.use(hostGuard);
app.use(originGuard);
app.use(apiTokenGuard(process.env.FLYBUDGET_API_TOKEN));
app.use(securityHeaders, hstsWhenSecure);
// The Vite dev server and the packaged Electron app (which serves the client from
// this server, see startServer) are same-origin already; this covers direct
// cross-origin dev requests to :3001.
app.use(cors({ origin: DEV_CLIENT_ORIGINS }));
// Large enough for big CSV imports; requests over this are rejected with 413
// (except restoring a backup, which parses its own bigger body after the login check)
const jsonBody = express.json({ limit: '10mb' });
app.use((req, res, next) => (req.path === RESTORE_PATH ? next() : jsonBody(req, res, next)));

// Server mode: login routes, then a valid session is required for the rest of the API
app.use('/api/auth', authRouter);
app.use('/api', requireSession);

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
app.use('/api/dashboards', dashboardsRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/plaid', bankRateLimit, plaidRouter);
app.use('/api/simplefin', bankRateLimit, simplefinRouter);
app.use('/api', apiNotFound);

export async function startServer(port: number | string): Promise<void> {
  if (serverMode && !secretCipher.enabled) {
    throw new Error(
      'Server mode requires an encryption key for bank credentials: set FLYBUDGET_DATA_KEY_FILE ' +
        '(or FLYBUDGET_DATA_KEY) to a 32-byte base64 key, e.g. from `openssl rand -base64 32`.',
    );
  }
  // Apply pending migrations on startup. The packaged app (Electron) and Docker ship them at
  // MIGRATIONS_PATH; `npm run dev` uses the source folder, so a new budget.db gets its tables.
  {
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    const { db } = await import('./db/index.js');
    const migrationsFolder =
      process.env.MIGRATIONS_PATH ?? fileURLToPath(new URL('./db/migrations', import.meta.url));
    migrate(db, { migrationsFolder });
  }
  // Electron serves the built client from this server so the page is same-origin
  // with the API (a file:// page would send Origin: null, which can't be allowlisted safely).
  if (process.env.CLIENT_DIST) {
    const clientDist = path.resolve(process.env.CLIENT_DIST);
    app.use(express.static(clientDist));
    // Server mode uses real URLs (/goals, /budget…): serve the app for any page URL
    if (serverMode) {
      app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
        res.sendFile(path.join(clientDist, 'index.html'));
      });
    }
  }
  // Registered last so it also covers errors from the static handler above
  app.use(errorHandler);
  return new Promise((resolve, reject) => {
    // Express 5 calls this with an error if listening fails (e.g. the port is taken)
    const server = app.listen(Number(port), listenHost, (err?: Error) => {
      if (err) return reject(err);
      console.log(
        `Server running on http://${listenHost === '0.0.0.0' ? 'localhost' : listenHost}:${port}`,
      );
      if (serverMode) {
        console.log('Server mode: login required.');
        if (!isPasswordSet()) setupCode();
        deleteExpiredSessions();
        setInterval(
          () => runStartupTask('Session cleanup', deleteExpiredSessions),
          60 * 60 * 1000,
        ).unref();
      }
      runStartupTasks();
      resolve();
    });
    server.on('error', (err) => console.error('Server error:', err));
  });
}

/** Maintenance on startup. One failing task is logged and doesn't stop the others or the server. */
function runStartupTask(name: string, task: () => void) {
  try {
    task();
  } catch (err) {
    console.error(`${name} failed:`, err);
  }
}

function runStartupTasks() {
  runStartupTask('Default categories', () => {
    const categoriesSeeded = seedDefaultCategories();
    if (categoriesSeeded > 0) console.log(`Created ${categoriesSeeded} default categories`);
  });

  runStartupTask('Credential encryption', () => {
    const credentialsEncrypted = encryptStoredCredentials();
    if (credentialsEncrypted > 0)
      console.log(`Encrypted ${credentialsEncrypted} stored bank credential(s)`);
  });

  // --- Schedule system startup ---
  runStartupTask('Schedule migration', () => {
    const rulesMigrated = migrateRecurrenceRules();
    if (rulesMigrated > 0) console.log(`Migrated ${rulesMigrated} recurrence rule(s)`);

    const legacyOccs = migrateOccurrencesFromLegacy();
    if (legacyOccs > 0) console.log(`Created ${legacyOccs} legacy occurrence(s)`);
  });

  runStartupTask('Schedule occurrences', () => {
    const horizon = format(addDays(new Date(), 90), 'yyyy-MM-dd');
    const ensured = ensureOccurrencesForAll(horizon);
    if (ensured > 0) console.log(`Ensured ${ensured} new occurrence(s)`);
  });

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

  bankSyncDone.then(() =>
    runStartupTask('Scheduled transactions', () => {
      const scheduled = autoCreateDueScheduled();
      if (scheduled > 0) console.log(`Auto-created ${scheduled} scheduled transaction(s)`);
    }),
  );
}

// Auto-start unless bundled for Electron production (where main.ts calls startServer directly)
if (!process.env.ELECTRON_PROD) {
  startServer(process.env.EXPRESS_PORT ?? process.env.PORT ?? 3001).catch((err) => {
    console.error('FlyBudget failed to start:', err);
    process.exit(1);
  });
}
