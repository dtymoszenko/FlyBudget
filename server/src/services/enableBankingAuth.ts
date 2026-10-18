import { randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { makeState } from './enableBankingTransactions.js';

// Bank logins in progress. The user logs in at their bank in their own browser, and the bank
// sends them back to the redirect URL with a one-time `code` and the `state` we chose:
//
// - self-hosted: straight to this server (GET /api/enable-banking/callback), the way
//   Actual Budget does it;
// - desktop app and `npm run dev`: Enable Banking only accepts https redirect URLs, so
//   through a static page on flybudget.org that forwards it to 127.0.0.1 on the user's
//   computer (the port is in the state);
// - or the user pastes the address they landed on into FlyBudget.
//
// The `state` is the only proof the callback has (the bank's redirect carries no session
// cookie or API token), so it is 32 random bytes, used once, and forgotten after 30 minutes.
// The code alone is useless: exchanging it needs the application's private key. The UI only
// knows an opaque `authId` and polls it.

const SESSION_TTL_MS = 30 * 60 * 1000; // bank logins with a TAN generator can take a while

export type AuthMode = { kind: 'new' } | { kind: 'reconnect'; connectionId: string };

export type AuthPoll<T = unknown> =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'error'; message: string }
  | { status: 'success'; result: T };

interface AuthSession {
  authId: string;
  state: string;
  mode: AuthMode;
  aspsp: { name: string; country: string };
  /** When the bank's access should end, as asked for in POST /auth */
  validUntil: Date;
  createdAt: number;
  /** From the bank's redirect, once it arrives */
  code?: string;
  /** The bank's redirect said the login failed or was cancelled */
  error?: string;
  finished?: AuthPoll;
  /** The exchange in progress: concurrent polls share it, so the code is used once */
  inFlight?: Promise<AuthPoll>;
}

const sessions = new Map<string, AuthSession>();
const byState = new Map<string, string>();

function sweep(now = Date.now()) {
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
      byState.delete(s.state);
    }
  }
}

/** Starts a login; `port` is where the relay page should send the bank's redirect. */
export function createAuthSession(
  mode: AuthMode,
  aspsp: { name: string; country: string },
  validUntil: Date,
  port: number,
): { authId: string; state: string } {
  sweep();
  const authId = nanoid(32);
  const state = makeState(port, randomBytes(32).toString('base64url'));
  sessions.set(authId, { authId, state, mode, aspsp, validUntil, createdAt: Date.now() });
  byState.set(state, authId);
  return { authId, state };
}

function live(authId: string | undefined): AuthSession | undefined {
  const session = authId ? sessions.get(authId) : undefined;
  if (session && Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(session.authId);
    byState.delete(session.state);
    return undefined;
  }
  return session;
}

/** A user-readable reason for an `error` the bank's redirect carried. */
function redirectErrorMessage(error: string): string {
  return /denied|cancel|reject/i.test(error)
    ? 'The bank login was cancelled. Try again when you are ready.'
    : 'The bank login did not finish. Try again.';
}

export type CallbackOutcome = { authId: string } | { error: 'unknown' | 'used' };

/**
 * Records the bank's redirect. Unknown, expired or already used states are refused, so a
 * forged or replayed redirect can't attach a different bank login.
 */
export function receiveRedirect(params: {
  state?: string;
  code?: string;
  error?: string;
}): CallbackOutcome {
  const authId = params.state ? byState.get(params.state) : undefined;
  const session = live(authId);
  if (!session) return { error: 'unknown' };
  if (session.code || session.error || session.finished) return { error: 'used' };
  if (params.code) session.code = params.code.slice(0, 2_000);
  else session.error = redirectErrorMessage(params.error ?? '');
  return { authId: session.authId };
}

/**
 * The paste fallback: the address the user's browser ended up on. Its state must be this
 * login's own. Pasting after the redirect already arrived is fine: it's the same login.
 */
export function receivePastedUrl(authId: string, pasted: string): CallbackOutcome {
  const session = live(authId);
  if (!session) return { error: 'unknown' };
  let url: URL;
  try {
    url = new URL(pasted.trim());
  } catch {
    return { error: 'unknown' };
  }
  const state = url.searchParams.get('state') ?? undefined;
  if (state !== session.state) return { error: 'unknown' };
  // The redirect got through as well (the relay, or the bank's own redirect): this login is
  // already on its way, so the caller just waits for it like a poll would
  if (session.code || session.error || session.finished) return { authId: session.authId };
  return receiveRedirect({
    state,
    code: url.searchParams.get('code') ?? undefined,
    error: url.searchParams.get('error') ?? undefined,
  });
}

/**
 * Where a login stands. Once the code is in, `complete` runs exactly once with it (to
 * exchange it for a session and save the connection); its result is kept for later polls.
 * If it throws, the error is final: an authorization code can't be used twice.
 */
export async function pollAuth<T>(
  authId: string,
  complete: (
    code: string,
    session: { mode: AuthMode; aspsp: { name: string; country: string }; validUntil: Date },
  ) => Promise<T>,
  errorMessage: (err: unknown) => string,
): Promise<AuthPoll<T>> {
  const session = live(authId);
  if (!session) return { status: 'expired' };
  if (session.finished) return session.finished as AuthPoll<T>;
  if (session.inFlight) return (await session.inFlight) as AuthPoll<T>;
  if (session.error) return (session.finished = { status: 'error', message: session.error });
  const code = session.code;
  if (!code) return { status: 'pending' };

  session.inFlight = (async (): Promise<AuthPoll> => {
    try {
      const result = await complete(code, {
        mode: session.mode,
        aspsp: session.aspsp,
        validUntil: session.validUntil,
      });
      return (session.finished = { status: 'success', result });
    } catch (err) {
      return (session.finished = { status: 'error', message: errorMessage(err) });
    }
  })();
  try {
    return (await session.inFlight) as AuthPoll<T>;
  } finally {
    session.inFlight = undefined;
  }
}

export function cancelAuth(authId: string) {
  const session = sessions.get(authId);
  if (!session) return;
  sessions.delete(authId);
  byState.delete(session.state);
}

/** Test helper */
export function _resetAuthSessions() {
  sessions.clear();
  byState.clear();
}
