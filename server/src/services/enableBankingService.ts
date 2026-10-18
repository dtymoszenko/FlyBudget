import { createHash, createPrivateKey, sign, type KeyObject } from 'crypto';
import ipaddr from 'ipaddr.js';
import { fetch, type Response } from 'undici';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { enableBankingConfig } from '../db/schema.js';
import { isPublicAddress, readTextLimited, safeFetch } from './safeFetch.js';

// Enable Banking API (https://enablebanking.com/docs/api/reference/): European bank
// accounts over PSD2. Each user brings their own application (free for linking your own
// accounts), so requests are signed with the application's private key, which never leaves
// the server.

const API_URL = 'https://api.enablebanking.com';
/** Tests point this at a local mock server; real installs always talk to Enable Banking. */
const apiOverride = () => process.env.FLYBUDGET_ENABLE_BANKING_API || undefined;
const TIMEOUT_MS = 30_000;
/** A whole account history can be large; the bank's pages are far smaller than this */
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
/** Some banks repeat the same page forever; no real history needs more pages than this */
const MAX_PAGES = 100;

export interface EnableBankingCredentials {
  applicationId: string;
  privateKey: string;
}

export const CONFIG_ID = 'default';

export function loadEnableBankingConfig(): EnableBankingCredentials | null {
  const row = db
    .select({
      applicationId: enableBankingConfig.applicationId,
      privateKey: enableBankingConfig.privateKey,
    })
    .from(enableBankingConfig)
    .where(eq(enableBankingConfig.id, CONFIG_ID))
    .get();
  return row ?? null;
}

export function isEnableBankingConfigured(): boolean {
  return (
    db
      .select({ id: enableBankingConfig.id })
      .from(enableBankingConfig)
      .where(eq(enableBankingConfig.id, CONFIG_ID))
      .get() !== undefined
  );
}

// --- Errors ---

export type EnableBankingErrorKind =
  | 'login_required'
  | 'rate_limited'
  | 'bad_credentials'
  | 'redirect_not_allowed'
  | 'psu_header_required'
  | 'not_found'
  | 'invalid_request'
  | 'bank_error'
  | 'unavailable';

const MESSAGES: Record<EnableBankingErrorKind, string> = {
  login_required: 'Your bank access has ended. Reconnect the bank to keep syncing.',
  rate_limited:
    'Your bank allows only a few updates a day. FlyBudget will try again later, or sync it yourself tomorrow.',
  bad_credentials:
    "Enable Banking didn't accept the application ID or private key. Check them in Settings → Connected banks.",
  redirect_not_allowed:
    "The redirect URL isn't registered in your Enable Banking application. Add the one shown in Settings → Connected banks.",
  psu_header_required: 'This bank only allows syncing while you use FlyBudget. Click Sync now.',
  not_found: 'Enable Banking no longer knows this bank account. Reconnect the bank.',
  invalid_request: 'Enable Banking refused the request. Try again, or reconnect the bank.',
  bank_error: "Your bank didn't answer. Try again later.",
  unavailable: 'Could not reach Enable Banking. Try again later.',
};

/** A failed Enable Banking call, with a message that's safe to show the user. */
export class EnableBankingError extends Error {
  constructor(
    readonly kind: EnableBankingErrorKind,
    /** Enable Banking's error code (e.g. EXPIRED_SESSION), for the log */
    readonly code: string | null = null,
    readonly status: number | null = null,
  ) {
    super(MESSAGES[kind]);
  }
}

/** The message to show for a failed call: ours, or `fallback` for anything unexpected. */
export function enableBankingErrorMessage(err: unknown, fallback = MESSAGES.unavailable): string {
  return err instanceof EnableBankingError ? err.message : fallback;
}

const SESSION_GONE = new Set([
  'EXPIRED_SESSION',
  'CLOSED_SESSION',
  'REVOKED_SESSION',
  'SESSION_DOES_NOT_EXIST',
  'EXPIRED_AUTHORIZATION_CODE',
  'WRONG_SESSION_STATUS',
]);

/** Classifies an error response from its HTTP status and Enable Banking's error code. */
export function classifyError(status: number, code: string | null): EnableBankingErrorKind {
  if (code && SESSION_GONE.has(code)) return 'login_required';
  if (code === 'ASPSP_RATE_LIMIT_EXCEEDED' || status === 429) return 'rate_limited';
  if (code === 'REDIRECT_URI_NOT_ALLOWED') return 'redirect_not_allowed';
  if (code === 'PSU_HEADER_NOT_PROVIDED' || code === 'PSU_HEADER_INVALID') {
    return 'psu_header_required';
  }
  if (code === 'UNAUTHORIZED_ACCESS' || code === 'UNAUTHORIZED_IP' || status === 401) {
    return 'bad_credentials';
  }
  if (code === 'ACCOUNT_DOES_NOT_EXIST' || code === 'INVALID_ACCOUNT_ID') return 'not_found';
  if (code === 'ASPSP_ERROR' || code === 'ASPSP_TIMEOUT' || status >= 500 || status === 408) {
    return 'bank_error';
  }
  if (status === 403) return 'bad_credentials';
  if (status === 404) return 'not_found';
  return 'invalid_request';
}

// --- Signing ---

/** Reads a PEM private key; only RSA keys can sign Enable Banking's RS256 tokens. */
export function parsePrivateKey(pem: string): KeyObject {
  const key = createPrivateKey({ key: pem, format: 'pem' });
  if (key.asymmetricKeyType !== 'rsa') throw new Error('Not an RSA private key');
  return key;
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A JWT for one request: RS256, the application id as key id, valid for an hour. */
export function signJwt(applicationId: string, key: KeyObject | string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: applicationId }));
  const payload = base64url(
    JSON.stringify({
      iss: 'enablebanking.com',
      aud: 'api.enablebanking.com',
      iat,
      exp: iat + 3600,
    }),
  );
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${base64url(signature)}`;
}

// --- Requests ---

/**
 * Who started a request. PSD2 banks allow only about four background requests a day per
 * account; requests the user is waiting for carry their address and browser, which
 * exempts them. Startup syncs run unattended and send none.
 */
export interface PsuContext {
  ip?: string;
  userAgent?: string;
}

/** The user's address and browser for a request they started, as far as they can be sent. */
export function psuContext(ip: string | undefined, userAgent: string | undefined): PsuContext {
  const ctx: PsuContext = {};
  // Banks reject private and loopback addresses (desktop app, LAN), so those aren't sent
  if (ip && isPublicAddress(ip)) ctx.ip = ipaddr.process(ip).toString();
  const agent = userAgent?.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 512);
  if (agent) ctx.userAgent = agent;
  return ctx;
}

function psuHeaders(psu: PsuContext | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (psu?.ip) headers['Psu-Ip-Address'] = psu.ip;
  if (psu?.userAgent) headers['Psu-User-Agent'] = psu.userAgent;
  return headers;
}

const errorBody = z.object({ error: z.string().max(100).nullish() }).passthrough();

async function request<T>(
  creds: EnableBankingCredentials,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  schema: z.ZodType<T>,
  opts: { query?: Record<string, string | undefined>; body?: unknown; psu?: PsuContext } = {},
): Promise<T> {
  const override = apiOverride();
  const url = new URL(path, override ?? API_URL);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  let token: string;
  try {
    token = signJwt(creds.applicationId, parsePrivateKey(creds.privateKey));
  } catch {
    throw new EnableBankingError('bad_credentials');
  }
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...psuHeaders(opts.psu),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };

  let response: Response;
  try {
    // The address is fixed, but safeFetch still adds a timeout and refuses redirects to
    // private addresses. The test override is a local server, which safeFetch would refuse.
    response = override
      ? await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
      : await safeFetch(url, init, { timeoutMs: TIMEOUT_MS, maxRedirects: 0 });
  } catch {
    throw new EnableBankingError('unavailable');
  }

  let text: string;
  try {
    text = await readTextLimited(response, MAX_RESPONSE_BYTES);
  } catch {
    throw new EnableBankingError('unavailable');
  }
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const parsed = errorBody.safeParse(json);
    const code = parsed.success ? (parsed.data.error?.toUpperCase() ?? null) : null;
    throw new EnableBankingError(classifyError(response.status, code), code, response.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new EnableBankingError('invalid_request', 'UNEXPECTED_RESPONSE');
  return parsed.data;
}

// --- API ---

const applicationSchema = z
  .object({
    name: z.string().max(500).nullish(),
    environment: z.string().max(50).nullish(),
    active: z.boolean().nullish(),
    redirect_urls: z.array(z.string().max(2_000)).max(100).nullish(),
  })
  .passthrough();

export type EnableBankingApplication = z.infer<typeof applicationSchema>;

/** The application the key belongs to: checks the credentials before they're saved. */
export function getApplication(creds: EnableBankingCredentials) {
  return request(creds, 'GET', '/application', applicationSchema);
}

const aspspSchema = z
  .object({
    name: z.string().min(1).max(500),
    country: z.string().length(2),
    maximum_consent_validity: z.number().int().nonnegative().nullish(),
    beta: z.boolean().nullish(),
    psu_types: z.array(z.string().max(50)).max(10).nullish(),
  })
  .passthrough();

export type Aspsp = z.infer<typeof aspspSchema>;

const aspspsSchema = z.object({ aspsps: z.array(z.unknown()).max(20_000) }).passthrough();

const ASPSP_CACHE_MS = 24 * 60 * 60 * 1000;
const aspspCache = new Map<string, { at: number; list: Aspsp[] }>();

/** The banks available in a country for personal accounts, cached for a day. */
export async function listAspsps(creds: EnableBankingCredentials, country: string) {
  const cached = aspspCache.get(country);
  if (cached && Date.now() - cached.at < ASPSP_CACHE_MS) return cached.list;
  const data = await request(creds, 'GET', '/aspsps', aspspsSchema, {
    query: { country, psu_type: 'personal' },
  });
  const list = data.aspsps
    .map((a) => aspspSchema.safeParse(a))
    .flatMap((r) => (r.success ? [r.data] : []))
    .filter((a) => !a.psu_types || a.psu_types.includes('personal'))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Not cached while empty: the user may be linking their accounts in the Control Panel
  if (list.length) aspspCache.set(country, { at: Date.now(), list });
  return list;
}

export function clearAspspCache() {
  aspspCache.clear();
}

const startAuthSchema = z
  .object({ url: z.string().url().max(4_000), authorization_id: z.string().max(500).nullish() })
  .passthrough();

export function startAuthorization(
  creds: EnableBankingCredentials,
  params: {
    aspsp: { name: string; country: string };
    validUntil: Date;
    redirectUrl: string;
    state: string;
    psu?: PsuContext;
  },
) {
  return request(creds, 'POST', '/auth', startAuthSchema, {
    body: {
      access: { valid_until: params.validUntil.toISOString(), balances: true, transactions: true },
      aspsp: params.aspsp,
      state: params.state,
      redirect_url: params.redirectUrl,
      // Enable Banking's default is "business", which sends some banks to their business login
      psu_type: 'personal',
    },
    psu: params.psu,
  });
}

const accountIdSchema = z
  .object({ iban: z.string().max(100).nullish() })
  .passthrough()
  .nullish();

const sessionAccountSchema = z
  .object({
    uid: z.string().min(1).max(500),
    account_id: accountIdSchema,
    identification_hash: z.string().max(500).nullish(),
    name: z.string().max(500).nullish(),
    details: z.string().max(1_000).nullish(),
    product: z.string().max(500).nullish(),
    currency: z.string().max(10).nullish(),
    cash_account_type: z.string().max(10).nullish(),
  })
  .passthrough();

export type SessionAccount = z.infer<typeof sessionAccountSchema>;

const sessionSchema = z
  .object({
    session_id: z.string().min(1).max(500),
    accounts: z.array(sessionAccountSchema).max(1_000).default([]),
    aspsp: z.object({ name: z.string().max(500), country: z.string().max(10) }).passthrough(),
    access: z
      .object({ valid_until: z.string().max(100).nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export type EnableBankingSession = z.infer<typeof sessionSchema>;

/** Exchanges the code from the bank's redirect for a session (single use). */
export function createSession(creds: EnableBankingCredentials, code: string, psu?: PsuContext) {
  return request(creds, 'POST', '/sessions', sessionSchema, { body: { code }, psu });
}

/** Ends the session at Enable Banking, so the bank access is revoked. */
export async function deleteSession(creds: EnableBankingCredentials, sessionId: string) {
  try {
    await request(creds, 'DELETE', `/sessions/${encodeURIComponent(sessionId)}`, z.unknown());
  } catch (err) {
    // Already gone counts as done
    if (
      err instanceof EnableBankingError &&
      (err.kind === 'login_required' || err.kind === 'not_found')
    ) {
      return;
    }
    throw err;
  }
}

const balancesSchema = z
  .object({ balances: z.array(z.unknown()).max(1_000).default([]) })
  .passthrough();

export async function getBalances(creds: EnableBankingCredentials, uid: string, psu?: PsuContext) {
  const data = await request(
    creds,
    'GET',
    `/accounts/${encodeURIComponent(uid)}/balances`,
    balancesSchema,
    { psu },
  );
  return data.balances;
}

const transactionsPageSchema = z
  .object({
    transactions: z.array(z.unknown()).max(100_000).default([]),
    continuation_key: z.string().max(10_000).nullish(),
  })
  .passthrough();

/**
 * Every booked transaction since `dateFrom`, or (without it) as far back as the bank
 * allows, following `continuation_key` across pages. Stops if the bank sends the same key
 * or the same page twice, which some do forever.
 */
export async function getTransactions(
  creds: EnableBankingCredentials,
  uid: string,
  opts: { dateFrom?: string; psu?: PsuContext },
): Promise<unknown[]> {
  const all: unknown[] = [];
  const seenKeys = new Set<string>();
  const seenPages = new Set<string>();
  let key: string | undefined;
  for (let n = 0; n < MAX_PAGES; n++) {
    const data = await request(
      creds,
      'GET',
      `/accounts/${encodeURIComponent(uid)}/transactions`,
      transactionsPageSchema,
      {
        query: {
          date_from: opts.dateFrom,
          strategy: opts.dateFrom ? undefined : 'longest',
          transaction_status: 'BOOK',
          continuation_key: key,
        },
        psu: opts.psu,
      },
    );
    // A page the bank already sent (under another key) would bring every record in twice,
    // including ones without a reference that can't be told apart from real repeats
    const page = createHash('sha256').update(JSON.stringify(data.transactions)).digest('hex');
    if (data.transactions.length && seenPages.has(page)) break;
    seenPages.add(page);
    // One at a time: spreading a very large page into push() can overflow the stack
    for (const tx of data.transactions) all.push(tx);
    key = data.continuation_key || undefined;
    if (!key || seenKeys.has(key)) break;
    seenKeys.add(key);
  }
  return all;
}
