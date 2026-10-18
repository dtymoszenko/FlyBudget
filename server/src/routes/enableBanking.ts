import { Router, type Request, type RequestHandler } from 'express';
import { and, eq, gt, isNull, ne, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  accounts,
  enableBankingAccountMappings,
  enableBankingConfig,
  enableBankingConnections,
} from '../db/schema.js';
import { appMode } from '../config.js';
import { BANK_CALLBACK_PATH } from '../middleware/security.js';
import { logError } from '../utils/log.js';
import { accountTypeSchema, defaultOffBudget } from '../utils/accountTypes.js';
import { readStatementAccount, storeImportSettings } from '../utils/importSettings.js';
import {
  CONFIG_ID,
  clearAspspCache,
  createSession,
  deleteSession,
  EnableBankingError,
  enableBankingErrorMessage,
  getApplication,
  listAspsps,
  loadEnableBankingConfig,
  parsePrivateKey,
  psuContext,
  startAuthorization,
  type PsuContext,
} from '../services/enableBankingService.js';
import {
  cancelAuth,
  createAuthSession,
  pollAuth,
  receivePastedUrl,
  receiveRedirect,
} from '../services/enableBankingAuth.js';
import {
  reconnectConnection,
  saveNewConnection,
  syncAllEnableBankingConnections,
  syncEnableBankingConnection,
  type ConnectionResult,
} from '../services/enableBankingSyncService.js';
import { consentValidUntil } from '../services/enableBankingTransactions.js';

export const enableBankingRouter = Router();

/**
 * The desktop app and `npm run dev` run on http://localhost, which Enable Banking doesn't
 * accept as a redirect URL: this static page forwards the bank's redirect to 127.0.0.1 on
 * the user's computer (website/static/bank-callback/).
 */
export const RELAY_REDIRECT_URL = 'https://flybudget.org/bank-callback/';

/** The redirect URL to register in the Enable Banking application, as seen from `req`. */
export function redirectUrlFor(req: Request): string {
  return appMode === 'server'
    ? `${req.protocol}://${req.host}${BANK_CALLBACK_PATH}`
    : RELAY_REDIRECT_URL;
}

const psuFor = (req: Request): PsuContext => psuContext(req.ip, req.headers['user-agent']);

function requireConfig(res: Parameters<RequestHandler>[1]) {
  const creds = loadEnableBankingConfig();
  if (!creds) res.status(409).json({ error: 'Enable Banking is not set up' });
  return creds;
}

function sendError(res: Parameters<RequestHandler>[1], context: string, err: unknown) {
  logError(context, err);
  // Never 502-504: the client takes those to mean FlyBudget's own server is unreachable
  const status = err instanceof EnableBankingError ? 422 : 500;
  res.status(status).json({ error: enableBankingErrorMessage(err) });
}

// --- Setup ---

enableBankingRouter.get('/status', (req, res) => {
  const row = db
    .select({
      applicationId: enableBankingConfig.applicationId,
      applicationName: enableBankingConfig.applicationName,
      environment: enableBankingConfig.environment,
    })
    .from(enableBankingConfig)
    .where(eq(enableBankingConfig.id, CONFIG_ID))
    .get();
  const connectionCount = db
    .select({ id: enableBankingConnections.id })
    .from(enableBankingConnections)
    .all().length;
  res.json({
    configured: !!row,
    applicationId: row?.applicationId ?? null,
    applicationName: row?.applicationName ?? null,
    environment: row?.environment ?? null,
    redirectUrl: redirectUrlFor(req),
    // The bank's redirect would travel over plain HTTP to another computer
    insecureRedirect: appMode === 'server' && req.protocol !== 'https',
    connectionCount,
  });
});

const configureSchema = z.object({
  applicationId: z
    .string()
    .trim()
    .uuid('That is not an application ID. Copy it from the Enable Banking Control Panel.'),
  privateKey: z.string().trim().min(1).max(16_384),
});

enableBankingRouter.post('/configure', async (req, res) => {
  const parsed = configureSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
  }
  const { applicationId, privateKey } = parsed.data;
  try {
    parsePrivateKey(privateKey);
  } catch {
    return res.status(400).json({
      error:
        "That file isn't a private key. Choose the .pem file Enable Banking downloaded when you created the application.",
    });
  }
  try {
    // Checked before anything is saved, so a wrong key or ID is said right away
    const app = await getApplication({ applicationId, privateKey });
    const now = new Date().toISOString();
    const values = {
      applicationId,
      privateKey,
      applicationName: app.name?.slice(0, 200) ?? null,
      environment: app.environment?.slice(0, 50) ?? null,
      updatedAt: now,
    };
    db.insert(enableBankingConfig)
      .values({ id: CONFIG_ID, ...values, createdAt: now })
      .onConflictDoUpdate({ target: enableBankingConfig.id, set: values })
      .run();
    clearAspspCache();
    const redirectUrl = redirectUrlFor(req);
    res.json({
      applicationName: values.applicationName,
      environment: values.environment,
      // Only known when Enable Banking lists them; null means it couldn't be checked
      redirectUrlRegistered: app.redirect_urls ? app.redirect_urls.includes(redirectUrl) : null,
    });
  } catch (err) {
    sendError(res, 'Enable Banking configure error', err);
  }
});

enableBankingRouter.delete('/configure', (_req, res) => {
  const count = db
    .select({ id: enableBankingConnections.id })
    .from(enableBankingConnections)
    .all().length;
  if (count > 0) return res.status(409).json({ error: 'Disconnect your banks first' });
  db.delete(enableBankingConfig).where(eq(enableBankingConfig.id, CONFIG_ID)).run();
  clearAspspCache();
  res.status(204).send();
});

const countrySchema = z.string().regex(/^[A-Z]{2}$/);

enableBankingRouter.get('/aspsps', async (req, res) => {
  const country = countrySchema.safeParse(String(req.query.country ?? '').toUpperCase());
  if (!country.success) return res.status(400).json({ error: 'Choose a country' });
  const creds = requireConfig(res);
  if (!creds) return;
  try {
    const list = await listAspsps(creds, country.data);
    res.json(
      list.map((a) => ({
        name: a.name,
        country: a.country,
        maximumConsentDays: a.maximum_consent_validity
          ? Math.floor(a.maximum_consent_validity / 86_400)
          : null,
        beta: !!a.beta,
      })),
    );
  } catch (err) {
    sendError(res, 'Enable Banking bank list error', err);
  }
});

// --- Connecting a bank ---

const startSchema = z.object({
  aspspName: z.string().min(1).max(500).optional(),
  country: countrySchema.optional(),
  /** Reconnect this connection instead of adding a new one */
  connectionId: z.string().max(64).optional(),
});

enableBankingRouter.post('/auth', async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const creds = requireConfig(res);
  if (!creds) return;

  let aspsp: { name: string; country: string };
  if (parsed.data.connectionId) {
    const conn = db
      .select({
        name: enableBankingConnections.aspspName,
        country: enableBankingConnections.aspspCountry,
      })
      .from(enableBankingConnections)
      .where(eq(enableBankingConnections.id, parsed.data.connectionId))
      .get();
    if (!conn) return res.status(404).json({ error: 'Connection not found' });
    aspsp = conn;
  } else if (parsed.data.aspspName && parsed.data.country) {
    aspsp = { name: parsed.data.aspspName, country: parsed.data.country };
  } else {
    return res.status(400).json({ error: 'Choose a bank' });
  }

  try {
    const known = (await listAspsps(creds, aspsp.country)).find((a) => a.name === aspsp.name);
    if (!known) return res.status(400).json({ error: "Enable Banking doesn't list this bank" });
    const validUntil = consentValidUntil(new Date(), known.maximum_consent_validity);
    const mode = parsed.data.connectionId
      ? ({ kind: 'reconnect', connectionId: parsed.data.connectionId } as const)
      : ({ kind: 'new' } as const);
    const { authId, state } = createAuthSession(mode, aspsp, validUntil, req.socket.localPort ?? 0);
    try {
      const { url } = await startAuthorization(creds, {
        aspsp,
        validUntil,
        redirectUrl: redirectUrlFor(req),
        state,
        psu: psuFor(req),
      });
      res.json({ authId, url });
    } catch (err) {
      cancelAuth(authId);
      throw err;
    }
  } catch (err) {
    sendError(res, 'Enable Banking auth error', err);
  }
});

/** Runs once per login, when the bank's code is in: exchange it and save the connection. */
function completer(psu: PsuContext) {
  return async (
    code: string,
    session: {
      mode: { kind: 'new' } | { kind: 'reconnect'; connectionId: string };
      validUntil: Date;
    },
  ): Promise<ConnectionResult> => {
    const creds = loadEnableBankingConfig();
    if (!creds) throw new EnableBankingError('bad_credentials');
    const ebSession = await createSession(creds, code, psu);
    if (session.mode.kind === 'new') return saveNewConnection(ebSession, session.validUntil);

    const connectionId = session.mode.connectionId;
    const exists = db
      .select({ id: enableBankingConnections.id })
      .from(enableBankingConnections)
      .where(eq(enableBankingConnections.id, connectionId))
      .get();
    if (!exists) return saveNewConnection(ebSession, session.validUntil);
    // The previous session is left to expire on its own. Ending it can also end the new one:
    // banks revoke the user's consent for these accounts, not just that session (seen with
    // Nordea in Enable Banking's sandbox)
    return reconnectConnection(connectionId, ebSession, session.validUntil);
  };
}

const pollErrorMessage = (err: unknown) => {
  logError('Enable Banking session error', err);
  return enableBankingErrorMessage(err, 'Connecting the bank failed. Try again.');
};

enableBankingRouter.get('/auth/:authId', async (req, res) => {
  const poll = await pollAuth(req.params.authId, completer(psuFor(req)), pollErrorMessage);
  res.json(poll);
});

const pasteSchema = z.object({ url: z.string().min(1).max(8_000) });

enableBankingRouter.post('/auth/:authId/complete', async (req, res) => {
  const parsed = pasteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Paste the whole address' });
  const outcome = receivePastedUrl(req.params.authId, parsed.data.url);
  if ('error' in outcome) {
    return res.status(400).json({
      error:
        outcome.error === 'used'
          ? 'This bank login was already used. Start again.'
          : "That isn't the address your bank sent you back to for this login. Copy the whole address from your browser.",
    });
  }
  res.json(await pollAuth(outcome.authId, completer(psuFor(req)), pollErrorMessage));
});

enableBankingRouter.delete('/auth/:authId', (req, res) => {
  cancelAuth(req.params.authId);
  res.status(204).send();
});

// --- Connections ---

const mapAccountSchema = z.object({
  mappings: z
    .array(
      z.object({
        mappingId: z.string().max(64),
        action: z.enum(['create', 'link', 'skip']),
        accountId: z.string().max(64).optional(),
        accountName: z.string().trim().max(200).optional(),
        accountType: accountTypeSchema.optional(),
        isOffBudget: z.number().int().min(0).max(1).optional(),
      }),
    )
    .max(1_000),
});

enableBankingRouter.post('/connections/:id/map-accounts', (req, res) => {
  const parsed = mapAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const conn = db
    .select({ id: enableBankingConnections.id })
    .from(enableBankingConnections)
    .where(eq(enableBankingConnections.id, req.params.id))
    .get();
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  let mapped = 0;
  let created = 0;
  let skipped = 0;
  db.transaction((tx) => {
    for (const m of parsed.data.mappings) {
      const mapping = tx
        .select()
        .from(enableBankingAccountMappings)
        .where(eq(enableBankingAccountMappings.id, m.mappingId))
        .get();
      if (!mapping || mapping.connectionId !== conn.id) continue;

      let accountId: string | null = null;
      if (m.action === 'skip') {
        tx.update(enableBankingAccountMappings)
          .set({ isEnabled: 0, accountId: null })
          .where(eq(enableBankingAccountMappings.id, mapping.id))
          .run();
        skipped++;
        continue;
      }
      if (m.action === 'link') {
        const account = m.accountId
          ? tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, m.accountId)).get()
          : undefined;
        if (!account) continue;
        accountId = account.id;
        mapped++;
      } else {
        accountId = nanoid();
        const type = m.accountType || 'checking';
        tx.insert(accounts)
          .values({
            id: accountId,
            name: m.accountName || mapping.name,
            type,
            startingBalance: 0,
            isOffBudget: m.isOffBudget ?? defaultOffBudget(type),
            sortOrder: 0,
            closedAt: null,
            createdAt: new Date().toISOString(),
          })
          .run();
        created++;
      }
      // A mapping moved to another account starts its history afresh there
      const moved = mapping.accountId !== accountId;
      tx.update(enableBankingAccountMappings)
        .set({ isEnabled: 1, accountId, ...(moved ? { lastBookedDate: null } : {}) })
        .where(eq(enableBankingAccountMappings.id, mapping.id))
        .run();
      // One Enable Banking mapping per account: an older connection to the same bank (added
      // again rather than reconnected) stops syncing into it, so the two never take turns
      // claiming its transactions. The new one recognises the older one's by the bank's ids.
      tx.update(enableBankingAccountMappings)
        .set({ isEnabled: 0, accountId: null })
        .where(
          and(
            eq(enableBankingAccountMappings.accountId, accountId),
            ne(enableBankingAccountMappings.id, mapping.id),
          ),
        )
        .run();

      // Remember the IBAN like a CAMT import does, so a statement for another account is noticed
      if (mapping.iban) {
        const row = tx
          .select({ importSettings: accounts.importSettings })
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .get();
        if (row && !readStatementAccount(row.importSettings)) {
          tx.update(accounts)
            .set({
              importSettings: storeImportSettings(row.importSettings, {
                statementAccount: mapping.iban,
              }),
            })
            .where(eq(accounts.id, accountId))
            .run();
        }
      }
    }
  });
  res.json({ mapped, created, skipped });
});

const syncSchema = z.object({
  /** Mappings whose first sync should bring in everything the bank has, not just recent history */
  fullHistory: z.array(z.string().max(64)).max(1_000).optional(),
});

enableBankingRouter.post('/connections/:id/sync', async (req, res) => {
  const parsed = syncSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const conn = db
    .select({ id: enableBankingConnections.id })
    .from(enableBankingConnections)
    .where(eq(enableBankingConnections.id, req.params.id))
    .get();
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  try {
    res.json(
      await syncEnableBankingConnection(conn.id, {
        psu: psuFor(req),
        fullHistory: parsed.data.fullHistory,
      }),
    );
  } catch (err) {
    logError('Enable Banking sync error', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

enableBankingRouter.post('/sync-all', async (req, res) => {
  try {
    res.json({ results: await syncAllEnableBankingConnections({ psu: psuFor(req) }) });
  } catch (err) {
    logError('Enable Banking sync error', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

enableBankingRouter.get('/connections', (_req, res) => {
  // Display columns only: selecting the session id would decrypt it for nothing
  const connections = db
    .select({
      id: enableBankingConnections.id,
      aspspName: enableBankingConnections.aspspName,
      aspspCountry: enableBankingConnections.aspspCountry,
      validUntil: enableBankingConnections.validUntil,
      syncStatus: enableBankingConnections.syncStatus,
      syncError: enableBankingConnections.syncError,
      lastSyncedAt: enableBankingConnections.lastSyncedAt,
    })
    .from(enableBankingConnections)
    .all();
  const mappings = db.select().from(enableBankingAccountMappings).all();
  const accountNames = new Map(
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .all()
      .map((a) => [a.id, a.name]),
  );
  res.json(
    connections.map((conn) => ({
      ...conn,
      accounts: mappings
        .filter((m) => m.connectionId === conn.id)
        .map((m) => ({
          mappingId: m.id,
          name: m.name,
          iban: m.iban,
          currency: m.currency,
          accountId: m.accountId,
          accountName: m.accountId ? (accountNames.get(m.accountId) ?? null) : null,
          isEnabled: m.isEnabled,
          lastBookedDate: m.lastBookedDate,
        })),
    })),
  );
});

enableBankingRouter.delete('/connections/:id', async (req, res) => {
  const conn = db
    .select({
      id: enableBankingConnections.id,
      sessionId: enableBankingConnections.sessionId,
      aspspName: enableBankingConnections.aspspName,
      aspspCountry: enableBankingConnections.aspspCountry,
    })
    .from(enableBankingConnections)
    .where(eq(enableBankingConnections.id, req.params.id))
    .get();
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  // Ending a session revokes the user's consent at the bank, which can also cut off another
  // connection to the same bank (the bank was added again rather than reconnected). Then this
  // one is only forgotten, and its access ends on its own date.
  const sameBank = db
    .select({ id: enableBankingConnections.id })
    .from(enableBankingConnections)
    .where(
      and(
        eq(enableBankingConnections.aspspName, conn.aspspName),
        eq(enableBankingConnections.aspspCountry, conn.aspspCountry),
        ne(enableBankingConnections.id, conn.id),
        // Only one that still has access: an ended one has nothing left to lose
        ne(enableBankingConnections.syncStatus, 'login_required'),
        or(
          isNull(enableBankingConnections.validUntil),
          gt(enableBankingConnections.validUntil, new Date().toISOString()),
        ),
      ),
    )
    .get();
  const creds = sameBank ? null : loadEnableBankingConfig();
  if (creds) {
    try {
      // Revoke the bank access first; if Enable Banking can't be reached (or asks to wait), keep the connection
      // so the user can try again rather than leave the access open
      await deleteSession(creds, conn.sessionId);
    } catch (err) {
      if (
        !(err instanceof EnableBankingError) ||
        err.kind === 'unavailable' ||
        err.kind === 'bank_error' ||
        err.kind === 'rate_limited'
      ) {
        logError('Enable Banking disconnect error', err);
        return res.status(422).json({
          error: 'Could not reach Enable Banking to end the bank access. Try again later.',
        });
      }
      // Anything else (e.g. the key was replaced): the session can't be ended from here
      logError('Enable Banking disconnect: session not ended', err);
    }
  }
  db.delete(enableBankingConnections).where(eq(enableBankingConnections.id, conn.id)).run();
  res.status(204).send();
});

// --- The bank's redirect ---

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function callbackPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · FlyBudget</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; display: grid; place-items: center; min-height: 100vh; padding: 16px; box-sizing: border-box; }
  main { max-width: 28rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
  h1 { font-size: 1.25rem; margin: 0 0 8px; }
  p { margin: 0; line-height: 1.5; color: #334155; }
  @media (prefers-color-scheme: dark) { body { background: #0f172a; color: #f1f5f9; } main { background: #1e293b; border-color: #334155; } p { color: #cbd5e1; } }
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}

const callbackQuery = z.object({
  state: z.string().max(500).optional(),
  code: z.string().max(2_000).optional(),
  error: z.string().max(500).optional(),
});

/**
 * GET /api/enable-banking/callback: where the bank sends the user back. This is a
 * top-level navigation from the bank's site, so it carries no session cookie (they are
 * SameSite=Strict) and, in the desktop app, no API token: it is exempt from those checks
 * (see `isBankCallback` in middleware/security.ts), and the single-use `state` is its
 * only authority. It exchanges the code right away, so the page can say how it went.
 */
export const enableBankingCallback: RequestHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const query = callbackQuery.safeParse(req.query);
  const outcome = query.success ? receiveRedirect(query.data) : ({ error: 'unknown' } as const);
  if ('error' in outcome) {
    res
      .status(400)
      .type('html')
      .send(
        callbackPage(
          outcome.error === 'used' ? 'Already done' : 'Link expired',
          outcome.error === 'used'
            ? 'This bank login was already received. You can close this tab and go back to FlyBudget.'
            : 'FlyBudget is not waiting for this bank login (it may have expired). Go back to FlyBudget and connect the bank again.',
        ),
      );
    return;
  }
  const poll = await pollAuth(outcome.authId, completer(psuFor(req)), pollErrorMessage);
  if (poll.status === 'success') {
    res
      .type('html')
      .send(
        callbackPage(
          'Bank connected',
          'You can close this tab and go back to FlyBudget to choose which accounts to sync.',
        ),
      );
  } else {
    res
      .status(400)
      .type('html')
      .send(
        callbackPage(
          'Bank not connected',
          poll.status === 'error'
            ? poll.message
            : 'Go back to FlyBudget and connect the bank again.',
        ),
      );
  }
};
