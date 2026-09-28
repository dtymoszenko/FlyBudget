import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import { db } from '../db/index.js';
import { plaidConfig } from '../db/schema.js';

type AccountType = 'checking' | 'savings' | 'credit' | 'cash' | 'investment';

let plaidClient: PlaidApi | null = null;

function getCredentials() {
  const config = db.select().from(plaidConfig).get();
  if (!config) return null;
  return { clientId: config.clientId, secret: config.secret, environment: config.environment };
}

function getPlaidClient(): PlaidApi {
  if (plaidClient) return plaidClient;

  const creds = getCredentials();
  if (!creds) throw new Error('Plaid is not configured');

  plaidClient = new PlaidApi(
    new Configuration({
      basePath: plaidBasePath(creds.environment),
      baseOptions: {
        // Never hang a sync or the UI on a stalled connection
        timeout: 30_000,
        headers: {
          'PLAID-CLIENT-ID': creds.clientId,
          'PLAID-SECRET': creds.secret,
        },
      },
    }),
  );
  return plaidClient;
}

/**
 * Plaid retired its "development" environment in 2024. Configs saved with it have
 * always been sent to Sandbox (the SDK has no development URL), so keep that.
 */
export function plaidBasePath(environment: string): string {
  return environment === 'production' ? PlaidEnvironments.production : PlaidEnvironments.sandbox;
}

export function invalidatePlaidClient() {
  plaidClient = null;
}

export function isPlaidConfigured(): boolean {
  return getCredentials() !== null;
}

export function getPlaidEnvironment(): string {
  const creds = getCredentials();
  return creds?.environment === 'production' ? 'production' : 'sandbox';
}

/**
 * Creates a Plaid Hosted Link session, opened in the user's own browser. Pass an
 * access token to re-authenticate an existing Item (update mode) instead of
 * adding a new one.
 */
export async function createHostedLink(
  accessToken?: string,
): Promise<{ linkToken: string; url: string }> {
  const client = getPlaidClient();
  const response = await client.linkTokenCreate({
    // Plaid requires a stable, non-identifying user id; FlyBudget is single-user
    user: { client_user_id: 'local-user' },
    client_name: 'FlyBudget',
    language: 'en',
    country_codes: [CountryCode.Us],
    ...(accessToken ? { access_token: accessToken } : { products: [Products.Transactions] }),
    hosted_link: {},
  });
  const url = response.data.hosted_link_url;
  if (!url?.startsWith('https://')) throw new Error('Plaid did not return a Hosted Link URL');
  return { linkToken: response.data.link_token, url };
}

export type HostedLinkOutcome =
  | { status: 'pending' }
  | { status: 'exited' }
  | {
      status: 'success';
      /** Absent in update mode, where the existing Item is simply repaired */
      publicToken?: string;
      institution: { id: string; name: string } | null;
    };

/** Reads a Hosted Link session's result from Plaid (/link/token/get polling). */
export async function getHostedLinkOutcome(linkToken: string): Promise<HostedLinkOutcome> {
  const client = getPlaidClient();
  const { data } = await client.linkTokenGet({ link_token: linkToken });
  for (const session of data.link_sessions ?? []) {
    const added = session.results?.item_add_results?.[0];
    const success = session.on_success;
    const publicToken = added?.public_token ?? success?.public_token;
    const institution = added?.institution ?? success?.metadata?.institution ?? null;
    if (publicToken || (session.finished_at && !session.exit)) {
      return {
        status: 'success',
        publicToken,
        institution:
          institution?.institution_id && institution.name
            ? { id: institution.institution_id, name: institution.name }
            : null,
      };
    }
    if (session.exit) return { status: 'exited' };
  }
  return { status: 'pending' };
}

/**
 * Revokes the access token at Plaid (and stops billing for the Item). Plaid
 * requires calling this when a user disconnects a bank — deleting the local row
 * alone leaves the token valid indefinitely.
 */
export async function removeItem(accessToken: string): Promise<void> {
  const client = getPlaidClient();
  await client.itemRemove({ access_token: accessToken });
}

export interface PlaidAccountInfo {
  plaidAccountId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalance: number;
  availableBalance: number | null;
}

export async function exchangePublicToken(publicToken: string) {
  const client = getPlaidClient();

  const exchangeResponse = await client.itemPublicTokenExchange({ public_token: publicToken });
  const { access_token: accessToken, item_id: itemId } = exchangeResponse.data;

  const accountsResponse = await client.accountsGet({ access_token: accessToken });
  const item = accountsResponse.data.item;
  const plaidAccounts = accountsResponse.data.accounts;

  const accounts: PlaidAccountInfo[] = plaidAccounts.map((a) => ({
    plaidAccountId: a.account_id,
    name: a.name,
    officialName: a.official_name ?? null,
    type: a.type,
    subtype: a.subtype ?? null,
    mask: a.mask ?? null,
    currentBalance: a.balances.current ?? 0,
    availableBalance: a.balances.available ?? null,
  }));

  return {
    accessToken,
    itemId,
    institutionId: item.institution_id ?? '',
    accounts,
  };
}

export async function getInstitutionName(institutionId: string): Promise<string> {
  if (!institutionId) return 'Unknown Institution';
  try {
    const client = getPlaidClient();
    const response = await client.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Us],
    });
    return response.data.institution.name;
  } catch {
    return 'Unknown Institution';
  }
}

export interface PlaidSyncResult {
  added: Array<{
    transactionId: string;
    accountId: string;
    date: string;
    amount: number;
    name: string;
    merchantName: string | null;
    category: string[];
    pending: boolean;
  }>;
  modified: Array<{
    transactionId: string;
    accountId: string;
    date: string;
    amount: number;
    name: string;
    merchantName: string | null;
  }>;
  removed: Array<{ transactionId: string }>;
  nextCursor: string;
  accountBalances: Array<{
    accountId: string;
    current: number;
    available: number | null;
  }>;
}

export async function syncTransactions(
  accessToken: string,
  cursor: string | null,
): Promise<PlaidSyncResult> {
  const client = getPlaidClient();

  const allAdded: PlaidSyncResult['added'] = [];
  const allModified: PlaidSyncResult['modified'] = [];
  const allRemoved: PlaidSyncResult['removed'] = [];
  let nextCursor = cursor ?? '';
  let hasMore = true;

  while (hasMore) {
    const response = await client.transactionsSync({
      access_token: accessToken,
      cursor: nextCursor || undefined,
    });

    const data = response.data;

    for (const t of data.added) {
      if (t.pending) continue;
      allAdded.push({
        transactionId: t.transaction_id,
        accountId: t.account_id,
        date: t.date,
        amount: t.amount,
        name: t.name,
        merchantName: t.merchant_name ?? null,
        category: t.category ?? [],
        pending: t.pending,
      });
    }

    for (const t of data.modified) {
      if (t.pending) continue;
      allModified.push({
        transactionId: t.transaction_id,
        accountId: t.account_id,
        date: t.date,
        amount: t.amount,
        name: t.name,
        merchantName: t.merchant_name ?? null,
      });
    }

    for (const t of data.removed) {
      allRemoved.push({ transactionId: t.transaction_id! });
    }

    nextCursor = data.next_cursor;
    hasMore = data.has_more;
  }

  let accountBalances: PlaidSyncResult['accountBalances'] = [];
  try {
    const balResponse = await client.accountsGet({ access_token: accessToken });
    accountBalances = balResponse.data.accounts.map((a) => ({
      accountId: a.account_id,
      current: a.balances.current ?? 0,
      available: a.balances.available ?? null,
    }));
  } catch {
    // Balance fetch is best-effort
  }

  return {
    added: allAdded,
    modified: allModified,
    removed: allRemoved,
    nextCursor,
    accountBalances,
  };
}

export function plaidAmountToCents(plaidAmount: number): number {
  return Math.round(-plaidAmount * 100);
}

export function mapPlaidAccountType(type: string, subtype: string | null): AccountType {
  if (type === 'depository') {
    if (
      subtype === 'savings' ||
      subtype === 'money market' ||
      subtype === 'hsa' ||
      subtype === 'cd'
    )
      return 'savings';
    return 'checking';
  }
  // Loans (mortgage, student, auto, HELOC) are debts: 'credit' is the closest
  // account type, and plaidBalanceToCents already stores their balance as negative
  if (type === 'credit' || type === 'loan') return 'credit';
  if (type === 'investment' || type === 'brokerage') return 'investment';
  return 'checking';
}

export function plaidBalanceToCents(balance: number, accountType: string): number {
  if (accountType === 'credit' || accountType === 'loan') {
    return -Math.round(balance * 100);
  }
  return Math.round(balance * 100);
}
