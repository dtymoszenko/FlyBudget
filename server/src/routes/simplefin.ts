import { Router } from 'express';
import { db } from '../db/index.js';
import { simplefinConnections, simplefinAccountMappings, accounts } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { logError } from '../utils/log.js';
import { accountTypeSchema, defaultOffBudget } from '../utils/accountTypes.js';
import {
  claimAccessUrl,
  fetchAccounts,
  connectionNameFromResponse,
  simpleFinBalanceToCents,
  InvalidSetupTokenError,
  simplefinErrorMessage,
} from '../services/simplefinService.js';
import {
  syncSimplefinConnection,
  syncAllSimplefinConnections,
} from '../services/simplefinSyncService.js';

export const simplefinRouter = Router();

const setupSchema = z.object({
  setupToken: z.string().min(1).max(4_096),
});

const mapAccountSchema = z.object({
  mappings: z
    .array(
      z.object({
        simplefinAccountId: z.string().max(256),
        action: z.enum(['create', 'link', 'skip']),
        accountId: z.string().max(64).optional(),
        accountName: z.string().trim().max(200).optional(),
        accountType: accountTypeSchema.optional(),
        isOffBudget: z.number().int().min(0).max(1).optional(),
      }),
    )
    .max(1_000),
});

const accountExists = (id: string) =>
  db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get() !== undefined;

simplefinRouter.get('/status', (_req, res) => {
  // Only the id: selecting the whole row would decrypt every access URL
  const count = db.select({ id: simplefinConnections.id }).from(simplefinConnections).all().length;
  res.json({ configured: count > 0, connectionCount: count });
});

simplefinRouter.post('/setup', async (req, res) => {
  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const accessUrl = await claimAccessUrl(parsed.data.setupToken);
    const data = await fetchAccounts(accessUrl);
    const connName = connectionNameFromResponse(data);

    const connectionId = nanoid();
    db.transaction(() => {
      db.insert(simplefinConnections)
        .values({
          id: connectionId,
          accessUrl,
          connectionName: connName,
          syncStatus: 'good',
          syncError: null,
          lastSyncedAt: null,
          createdAt: new Date().toISOString(),
        })
        .run();

      for (const acct of data.accounts) {
        db.insert(simplefinAccountMappings)
          .values({
            id: nanoid(),
            connectionId,
            simplefinAccountId: acct.id,
            accountId: null,
            simplefinAccountName: acct.name,
            isEnabled: 1,
            createdAt: new Date().toISOString(),
          })
          .onConflictDoNothing()
          .run();
      }
    });

    res.json({
      connectionId,
      connectionName: connName,
      accounts: data.accounts.map((a) => ({
        simplefinAccountId: a.id,
        name: a.name,
        balance: simpleFinBalanceToCents(a.balance),
        currency: a.currency,
      })),
    });
  } catch (err: any) {
    logError('SimpleFIN setup error', err);
    res
      .status(err instanceof InvalidSetupTokenError ? 400 : 502)
      .json({ error: simplefinErrorMessage(err, 'Could not reach SimpleFIN. Try again later.') });
  }
});

simplefinRouter.post('/connections/:id/map-accounts', (req, res) => {
  const parsed = mapAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conn = db
    .select()
    .from(simplefinConnections)
    .where(eq(simplefinConnections.id, req.params.id))
    .get();
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  let mapped = 0;
  let created = 0;
  let skipped = 0;

  for (const m of parsed.data.mappings) {
    // The same bridge account can appear in several connections (e.g. after reconnecting)
    const mapping = db
      .select()
      .from(simplefinAccountMappings)
      .where(
        and(
          eq(simplefinAccountMappings.connectionId, conn.id),
          eq(simplefinAccountMappings.simplefinAccountId, m.simplefinAccountId),
        ),
      )
      .get();
    if (!mapping) continue;

    if (m.action === 'skip') {
      db.update(simplefinAccountMappings)
        .set({ isEnabled: 0, accountId: null })
        .where(eq(simplefinAccountMappings.id, mapping.id))
        .run();
      skipped++;
    } else if (m.action === 'link' && m.accountId && accountExists(m.accountId)) {
      db.update(simplefinAccountMappings)
        .set({ isEnabled: 1, accountId: m.accountId })
        .where(eq(simplefinAccountMappings.id, mapping.id))
        .run();
      mapped++;
    } else if (m.action === 'create') {
      const accountId = nanoid();
      const type = m.accountType || 'checking';
      db.insert(accounts)
        .values({
          id: accountId,
          name: m.accountName || mapping.simplefinAccountName,
          type,
          startingBalance: 0,
          isOffBudget: m.isOffBudget ?? defaultOffBudget(type),
          sortOrder: 0,
          closedAt: null,
          createdAt: new Date().toISOString(),
        })
        .run();

      db.update(simplefinAccountMappings)
        .set({ isEnabled: 1, accountId })
        .where(eq(simplefinAccountMappings.id, mapping.id))
        .run();
      created++;
    }
  }

  res.json({ mapped, created, skipped });
});

simplefinRouter.post('/connections/:id/sync', async (req, res) => {
  const conn = db
    .select({ id: simplefinConnections.id })
    .from(simplefinConnections)
    .where(eq(simplefinConnections.id, req.params.id))
    .get();
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  try {
    const result = await syncSimplefinConnection(conn.id);
    res.json(result);
  } catch (err: any) {
    logError('SimpleFIN sync error', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

simplefinRouter.post('/sync-all', async (_req, res) => {
  try {
    const results = await syncAllSimplefinConnections();
    res.json({ results });
  } catch (err: any) {
    logError('SimpleFIN sync error', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

simplefinRouter.get('/connections', (_req, res) => {
  const connections = db.select().from(simplefinConnections).all();
  const mappings = db.select().from(simplefinAccountMappings).all();
  const accts = db.select().from(accounts).all();
  const accountMap = new Map(accts.map((a) => [a.id, a]));

  const result = connections.map((conn) => ({
    id: conn.id,
    connectionName: conn.connectionName,
    lastSyncedAt: conn.lastSyncedAt,
    syncStatus: conn.syncStatus,
    syncError: conn.syncError,
    accounts: mappings
      .filter((m) => m.connectionId === conn.id)
      .map((m) => ({
        simplefinAccountId: m.simplefinAccountId,
        simplefinAccountName: m.simplefinAccountName,
        accountId: m.accountId,
        accountName: m.accountId ? (accountMap.get(m.accountId)?.name ?? null) : null,
        isEnabled: m.isEnabled,
      })),
  }));

  res.json(result);
});

simplefinRouter.delete('/connections/:id', (_req, res) => {
  const conn = db
    .select()
    .from(simplefinConnections)
    .where(eq(simplefinConnections.id, _req.params.id))
    .get();
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  db.delete(simplefinConnections).where(eq(simplefinConnections.id, _req.params.id)).run();
  res.status(204).send();
});
