import { z } from 'zod';
import { assertSafeUrl, readTextLimited, safeFetch } from './safeFetch.js';

// SimpleFIN protocol: https://www.simplefin.org/protocol.html
// Everything that comes from outside (the setup token the user pastes, the access
// URL the bridge returns, and account data) is validated before it's used or stored.

/** Decimal amount as SimpleFIN sends it, e.g. "-12.34" */
const decimalString = z.string().regex(/^-?\d{1,15}(\.\d{1,8})?$/, 'Invalid amount');

const transactionSchema = z.object({
  id: z.string().min(1).max(256),
  // Unix seconds; capped at year 9999 so date conversion can't throw
  posted: z.number().int().nonnegative().max(253_402_300_799),
  amount: decimalString,
  description: z.string().max(10_000).default(''),
  transacted_at: z.number().int().nonnegative().max(253_402_300_799).optional(),
  pending: z.boolean().optional(),
});

const accountSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().max(500),
  currency: z.string().max(100),
  balance: decimalString,
  'available-balance': decimalString.optional(),
  'balance-date': z.number().int().nonnegative().max(253_402_300_799),
  transactions: z.array(transactionSchema).max(100_000).default([]),
});

const connectionSchema = z.object({
  conn_id: z.string().max(256).optional(),
  name: z.string().max(500).optional(),
});

const responseSchema = z.object({
  errors: z.array(z.string().max(2_000)).max(1_000).default([]),
  connections: z.array(connectionSchema).max(1_000).default([]),
  accounts: z.array(accountSchema).max(10_000),
});

export type SimplefinTransaction = z.infer<typeof transactionSchema>;
export type SimplefinAccount = z.infer<typeof accountSchema>;
export type SimplefinResponse = z.infer<typeof responseSchema>;

/** The user's setup token (or what it decodes to) is unusable — a 400, not a server error. */
export class InvalidSetupTokenError extends Error {}

/** Setup tokens are base64 of a claim URL — reject anything else before decoding. */
const setupTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .regex(/^[A-Za-z0-9+/_-]+={0,2}$/, 'Invalid setup token');

/**
 * An access URL is https://user:password@host/path. Returns the endpoint without
 * credentials plus the Basic auth header, so credentials never appear in a URL.
 */
export function parseAccessUrl(accessUrl: string): { baseUrl: string; authorization: string } {
  let url: URL;
  try {
    url = assertSafeUrl(accessUrl.trim());
  } catch {
    throw new Error('Invalid SimpleFIN access URL');
  }
  if (!url.username || !url.password || url.search || url.hash) {
    throw new Error('Invalid SimpleFIN access URL');
  }
  const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  url.username = '';
  url.password = '';
  return {
    baseUrl: url.toString().replace(/\/+$/, ''),
    authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
  };
}

export async function claimAccessUrl(setupToken: string): Promise<string> {
  const token = setupTokenSchema.safeParse(setupToken);
  if (!token.success) throw new InvalidSetupTokenError('Invalid setup token');

  const claimUrl = Buffer.from(token.data, 'base64').toString('utf-8');
  try {
    assertSafeUrl(claimUrl);
  } catch {
    throw new InvalidSetupTokenError(
      'Invalid setup token: it must decode to a public https:// claim URL',
    );
  }

  const response = await safeFetch(claimUrl, { method: 'POST' });
  if (!response.ok) {
    // 403 = already claimed (tokens are single-use) or revoked
    throw new InvalidSetupTokenError(
      response.status === 403
        ? 'This setup token was already used or revoked — create a new one in SimpleFIN Bridge'
        : `Failed to claim setup token (HTTP ${response.status})`,
    );
  }

  const accessUrl = (await readTextLimited(response, 4_096)).trim();
  parseAccessUrl(accessUrl); // throws if the bridge returned something unexpected
  return accessUrl;
}

export async function fetchAccounts(
  accessUrl: string,
  startDate?: number,
): Promise<SimplefinResponse> {
  const { baseUrl, authorization } = parseAccessUrl(accessUrl);
  const url = new URL(`${baseUrl}/accounts`);
  url.searchParams.set('version', '2');
  if (startDate) url.searchParams.set('start-date', String(startDate));

  const response = await safeFetch(url, { headers: { Authorization: authorization } });

  if (response.status === 402) {
    throw new Error('SimpleFIN subscription required — visit simplefin.org to activate');
  }
  if (response.status === 403) {
    throw new Error('SimpleFIN access denied — the connection may have been revoked');
  }
  if (!response.ok) {
    throw new Error(`SimpleFIN error (HTTP ${response.status})`);
  }

  return parseSimplefinResponse(await readTextLimited(response));
}

/** Parses and validates an /accounts response body; anything unexpected is rejected. */
export function parseSimplefinResponse(body: string): SimplefinResponse {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('SimpleFIN returned an invalid response');
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw new Error('SimpleFIN returned data in an unexpected format');
  return parsed.data;
}

/** Exact conversion of a validated decimal string to integer cents (no float rounding surprises). */
function decimalToCents(value: string): number {
  const negative = value.startsWith('-');
  const [whole, frac = ''] = value.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  // Round half away from zero on the third decimal
  const rounded = Number(frac[2] ?? '0') >= 5 ? cents + 1 : cents;
  if (!Number.isSafeInteger(rounded)) throw new Error('Amount out of range');
  return negative ? -rounded : rounded;
}

export function simpleFinAmountToCents(amount: string): number {
  return decimalToCents(decimalString.parse(amount));
}

export function simpleFinBalanceToCents(balance: string): number {
  return decimalToCents(decimalString.parse(balance));
}

export function connectionNameFromResponse(response: SimplefinResponse): string {
  const name = response.connections[0]?.name?.trim();
  return name ? name.slice(0, 200) : 'SimpleFIN Connection';
}
