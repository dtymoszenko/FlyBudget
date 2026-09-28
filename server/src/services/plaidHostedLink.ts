import { nanoid } from 'nanoid';
import { createHostedLink, getHostedLinkOutcome, type HostedLinkOutcome } from './plaidService.js';

// Plaid Hosted Link sessions (https://plaid.com/docs/link/hosted-link/).
//
// The desktop app can't run Plaid Link's OAuth pop-up inside its locked-down
// window, and native apps should do bank logins in the system browser anyway
// (RFC 8252). So the user completes Link on Plaid's hosted page in their own
// browser, and the server polls Plaid for the result. The link token and the
// public token never reach the UI; the client only sees an opaque session id.

const SESSION_TTL_MS = 35 * 60 * 1000; // Plaid's hosted URL lives 30 minutes

export type HostedLinkMode = { kind: 'new' } | { kind: 'update'; itemId: string };

interface Session {
  linkToken: string;
  mode: HostedLinkMode;
  createdAt: number;
  /** Final outcome once known, so repeated polls don't hit Plaid again */
  finished?: PollResult;
  /**
   * The poll currently in progress. Concurrent polls share it, so the Plaid check
   * and completion run once at a time and the single-use public token can't be
   * exchanged twice.
   */
  inFlight?: Promise<PollResult>;
}

export type PollResult<T = unknown> =
  | { status: 'pending' }
  | { status: 'exited' }
  | { status: 'expired' }
  | { status: 'success'; result?: T };

const sessions = new Map<string, Session>();

function sweep(now = Date.now()) {
  for (const [id, s] of sessions) if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
}

export async function startHostedLink(
  mode: HostedLinkMode,
  accessToken?: string,
): Promise<{ sessionId: string; url: string }> {
  sweep();
  const { linkToken, url } = await createHostedLink(accessToken);
  const sessionId = nanoid(32);
  sessions.set(sessionId, { linkToken, mode, createdAt: Date.now() });
  return { sessionId, url };
}

/**
 * Checks a session with Plaid. On success, `complete` runs exactly once with the
 * outcome (e.g. exchanging the public token) and its return value is cached.
 */
export async function pollHostedLink<T>(
  sessionId: string,
  complete: (
    outcome: Extract<HostedLinkOutcome, { status: 'success' }>,
    mode: HostedLinkMode,
  ) => Promise<T>,
): Promise<PollResult<T>> {
  const session = sessions.get(sessionId);
  if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return { status: 'expired' };
  }
  if (session.finished) return session.finished as PollResult<T>;
  if (session.inFlight) return (await session.inFlight) as PollResult<T>;

  session.inFlight = (async (): Promise<PollResult> => {
    const outcome = await getHostedLinkOutcome(session.linkToken);
    if (outcome.status === 'pending') return { status: 'pending' };
    if (outcome.status === 'exited') return (session.finished = { status: 'exited' });
    // If completion throws, nothing is cached and the next poll can retry
    const result = await complete(outcome, session.mode);
    return (session.finished = { status: 'success', result });
  })();
  try {
    return (await session.inFlight) as PollResult<T>;
  } finally {
    session.inFlight = undefined;
  }
}

export function cancelHostedLink(sessionId: string) {
  sessions.delete(sessionId);
}

/** Test helper */
export function _resetHostedLinkSessions() {
  sessions.clear();
}
