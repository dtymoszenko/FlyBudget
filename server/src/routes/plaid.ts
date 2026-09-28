import { Router } from 'express';
import { db } from '../db/index.js';
import { plaidConfig, plaidItems, plaidAccountMappings, accounts } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { accountTypeSchema, defaultOffBudget } from '../utils/accountTypes.js';
import {
  isPlaidConfigured,
  getPlaidEnvironment,
  invalidatePlaidClient,
  removeItem,
  exchangePublicToken,
  getInstitutionName,
  mapPlaidAccountType,
  plaidBalanceToCents,
} from '../services/plaidService.js';
import { syncPlaidItem, syncAllItems } from '../services/plaidSyncService.js';
import { cancelHostedLink, pollHostedLink, startHostedLink } from '../services/plaidHostedLink.js';

export const plaidRouter = Router();

// Plaid client IDs and secrets are short hex strings
const plaidKey = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, 'Unexpected characters');

const configureSchema = z.object({
  clientId: plaidKey,
  secret: plaidKey,
  // Plaid retired "development" in 2024; limited Production replaced it
  environment: z.enum(['sandbox', 'production']).default('production'),
});

const mapAccountSchema = z.object({
  mappings: z.array(
    z.object({
      plaidAccountId: z.string().max(256),
      action: z.enum(['create', 'link', 'skip']),
      accountId: z.string().max(64).optional(),
      accountName: z.string().trim().max(200).optional(),
      accountType: accountTypeSchema.optional(),
      isOffBudget: z.number().int().min(0).max(1).optional(),
    }),
  ),
});

function requirePlaid(res: any): boolean {
  if (!isPlaidConfigured()) {
    res.status(503).json({ error: 'Plaid is not configured' });
    return false;
  }
  return true;
}

plaidRouter.get('/status', (_req, res) => {
  res.json({
    configured: isPlaidConfigured(),
    environment: isPlaidConfigured() ? getPlaidEnvironment() : null,
  });
});

plaidRouter.post('/configure', (req, res) => {
  const parsed = configureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { clientId, secret, environment } = parsed.data;
  // Only the id: reading the row would decrypt the old secret for no reason
  const existing = db.select({ id: plaidConfig.id }).from(plaidConfig).get();
  const now = new Date().toISOString();

  if (existing) {
    db.update(plaidConfig)
      .set({ clientId, secret, environment, updatedAt: now })
      .where(eq(plaidConfig.id, existing.id))
      .run();
  } else {
    db.insert(plaidConfig)
      .values({
        id: nanoid(),
        clientId,
        secret,
        environment,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  invalidatePlaidClient();
  res.json({ ok: true });
});

// --- Connecting banks: Plaid Hosted Link, completed in the user's own browser ---

/** Saves a newly linked Item (public token exchanged server-side) and returns its accounts. */
async function addPlaidItem(publicToken: string, institution: { id: string; name: string } | null) {
  const result = await exchangePublicToken(publicToken);
  const institutionId = (institution?.id ?? result.institutionId).slice(0, 100);
  const institutionName = (institution?.name ?? (await getInstitutionName(institutionId))).slice(
    0,
    200,
  );

  const itemId = nanoid();
  db.transaction((tx) => {
    tx.insert(plaidItems)
      .values({
        id: itemId,
        plaidItemId: result.itemId,
        institutionId,
        institutionName,
        accessToken: result.accessToken,
        cursor: null,
        lastSyncedAt: null,
        syncStatus: 'good',
        syncError: null,
        consentExpiresAt: null,
        createdAt: new Date().toISOString(),
      })
      .run();
    for (const acct of result.accounts) {
      tx.insert(plaidAccountMappings)
        .values({
          id: nanoid(),
          plaidItemId: itemId,
          plaidAccountId: acct.plaidAccountId,
          accountId: null,
          plaidAccountName: acct.officialName || acct.name,
          plaidAccountType: acct.type,
          plaidAccountMask: acct.mask,
          isEnabled: 1,
          createdAt: new Date().toISOString(),
        })
        .run();
    }
  });

  return {
    itemId,
    institutionName,
    accounts: result.accounts.map((a) => ({
      plaidAccountId: a.plaidAccountId,
      name: a.officialName || a.name,
      type: a.type,
      subtype: a.subtype,
      mask: a.mask,
      suggestedType: mapPlaidAccountType(a.type, a.subtype),
      currentBalance: plaidBalanceToCents(a.currentBalance, a.type),
    })),
  };
}

function plaidErrorMessage(err: any, fallback: string): string {
  return err?.response?.data?.error_message ?? fallback;
}

// Start connecting a new bank: returns Plaid's hosted URL for the user's browser
plaidRouter.post('/hosted-link', async (_req, res) => {
  if (!requirePlaid(res)) return;
  try {
    res.json(await startHostedLink({ kind: 'new' }));
  } catch (err: any) {
    console.error('Plaid hosted-link error:', err?.response?.data ?? err.message);
    res.status(502).json({ error: plaidErrorMessage(err, 'Could not start connecting to Plaid') });
  }
});

// Re-authenticate an existing bank (Plaid "update mode")
plaidRouter.post('/items/:itemId/hosted-link', async (req, res) => {
  if (!requirePlaid(res)) return;
  const { itemId } = req.params;
  const item = db
    .select({ accessToken: plaidItems.accessToken })
    .from(plaidItems)
    .where(eq(plaidItems.id, itemId))
    .get();
  if (!item) return res.status(404).json({ error: 'Item not found' });
  try {
    res.json(await startHostedLink({ kind: 'update', itemId }, item.accessToken));
  } catch (err: any) {
    console.error('Plaid hosted-link (update) error:', err?.response?.data ?? err.message);
    res
      .status(502)
      .json({ error: plaidErrorMessage(err, 'Could not start reconnecting to Plaid') });
  }
});

// Polled by the UI until the user finishes (or quits) in their browser
plaidRouter.get('/hosted-link/:sessionId', async (req, res) => {
  if (!requirePlaid(res)) return;
  try {
    const result = await pollHostedLink(req.params.sessionId, async (outcome, mode) => {
      if (mode.kind === 'update') {
        db.update(plaidItems)
          .set({ syncStatus: 'good', syncError: null })
          .where(eq(plaidItems.id, mode.itemId))
          .run();
        return null;
      }
      if (!outcome.publicToken) throw new Error('Plaid finished without a public token');
      return addPlaidItem(outcome.publicToken, outcome.institution);
    });
    res.json(result);
  } catch (err: any) {
    console.error('Plaid hosted-link poll error:', err?.response?.data ?? err.message);
    res.status(502).json({ error: plaidErrorMessage(err, 'Could not finish connecting to Plaid') });
  }
});

plaidRouter.delete('/hosted-link/:sessionId', (req, res) => {
  cancelHostedLink(req.params.sessionId);
  res.status(204).send();
});

plaidRouter.post('/items/:itemId/map-accounts', (req, res) => {
  const parsed = mapAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { itemId } = req.params;
  const item = db.select().from(plaidItems).where(eq(plaidItems.id, itemId)).get();
  if (!item) return res.status(404).json({ error: 'Item not found' });

  let mapped = 0;
  let created = 0;
  let skipped = 0;

  for (const m of parsed.data.mappings) {
    const mapping = db
      .select()
      .from(plaidAccountMappings)
      .where(eq(plaidAccountMappings.plaidAccountId, m.plaidAccountId))
      .get();
    if (!mapping) continue;

    if (m.action === 'skip') {
      db.update(plaidAccountMappings)
        .set({ isEnabled: 0, accountId: null })
        .where(eq(plaidAccountMappings.id, mapping.id))
        .run();
      skipped++;
    } else if (m.action === 'link' && m.accountId) {
      db.update(plaidAccountMappings)
        .set({ isEnabled: 1, accountId: m.accountId })
        .where(eq(plaidAccountMappings.id, mapping.id))
        .run();
      mapped++;
    } else if (m.action === 'create') {
      const accountId = nanoid();
      const type = m.accountType || mapPlaidAccountType(mapping.plaidAccountType, null);
      db.insert(accounts)
        .values({
          id: accountId,
          name: m.accountName || mapping.plaidAccountName,
          type,
          startingBalance: 0,
          isOffBudget: m.isOffBudget ?? defaultOffBudget(type),
          sortOrder: 0,
          closedAt: null,
          createdAt: new Date().toISOString(),
        })
        .run();

      db.update(plaidAccountMappings)
        .set({ isEnabled: 1, accountId })
        .where(eq(plaidAccountMappings.id, mapping.id))
        .run();
      created++;
    }
  }

  res.json({ mapped, created, skipped });
});

plaidRouter.post('/items/:itemId/sync', async (req, res) => {
  if (!requirePlaid(res)) return;
  const { itemId } = req.params;
  try {
    const result = await syncPlaidItem(itemId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

plaidRouter.post('/sync-all', async (_req, res) => {
  if (!requirePlaid(res)) return;
  try {
    const results = await syncAllItems();
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

plaidRouter.get('/items', (_req, res) => {
  const items = db.select().from(plaidItems).all();
  const mappings = db.select().from(plaidAccountMappings).all();
  const accts = db.select().from(accounts).all();
  const accountMap = new Map(accts.map((a) => [a.id, a]));

  const result = items.map((item) => ({
    id: item.id,
    institutionName: item.institutionName,
    institutionId: item.institutionId,
    lastSyncedAt: item.lastSyncedAt,
    syncStatus: item.syncStatus,
    syncError: item.syncError,
    consentExpiresAt: item.consentExpiresAt,
    accounts: mappings
      .filter((m) => m.plaidItemId === item.id)
      .map((m) => ({
        plaidAccountId: m.plaidAccountId,
        plaidAccountName: m.plaidAccountName,
        plaidAccountType: m.plaidAccountType,
        mask: m.plaidAccountMask,
        accountId: m.accountId,
        accountName: m.accountId ? (accountMap.get(m.accountId)?.name ?? null) : null,
        isEnabled: m.isEnabled,
      })),
  }));

  res.json(result);
});

plaidRouter.delete('/items/:itemId', async (req, res) => {
  const { itemId } = req.params;
  const item = db
    .select({ id: plaidItems.id })
    .from(plaidItems)
    .where(eq(plaidItems.id, itemId))
    .get();
  if (!item) return res.status(404).json({ error: 'Item not found' });

  // Revoke the access token at Plaid before forgetting it, so a disconnected bank
  // can't be read with a leftover token (and Plaid stops billing for it).
  if (isPlaidConfigured()) {
    let accessToken: string | undefined;
    try {
      accessToken = db
        .select({ accessToken: plaidItems.accessToken })
        .from(plaidItems)
        .where(eq(plaidItems.id, itemId))
        .get()?.accessToken;
    } catch {
      // Credential can't be decrypted (e.g. key lost): nothing left to revoke from here
    }
    if (accessToken) {
      try {
        await removeItem(accessToken);
      } catch (err: any) {
        const code = err?.response?.data?.error_code;
        if (code !== 'ITEM_NOT_FOUND' && code !== 'INVALID_ACCESS_TOKEN') {
          console.error('Plaid item remove error:', err?.response?.data ?? err.message);
          return res.status(502).json({
            error:
              'Could not revoke access at Plaid, so the connection was kept. Check your internet connection and try again.',
          });
        }
      }
    }
  }

  db.delete(plaidItems).where(eq(plaidItems.id, itemId)).run();
  res.status(204).send();
});
