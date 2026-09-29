import { Router, type Request } from 'express';
import { allowedHosts, appMode, trustProxy, type AppMode } from '../config.js';
import { secretCipher } from '../db/secretCrypto.js';
import { isPasswordSet } from '../auth/sessions.js';
import { appVersion } from '../utils/version.js';

// GET /api/server/info: how this FlyBudget runs, for the sidebar's server status and
// Settings → Server. It sits behind requireSession, so in server mode only a signed-in
// browser can read it (anonymous visitors learn nothing new; /api/health stays
// `{"status":"ok"}`). It never includes secrets, keys, hashes, tokens or file paths:
// only yes/no answers about the setup, which the page turns into advice naming the
// environment variable that fixes each warning.

export type SecurityCheckId =
  'https' | 'trustProxy' | 'allowedHosts' | 'encryptionKey' | 'password';

export interface SecurityCheck {
  id: SecurityCheckId;
  ok: boolean;
  /** Why a check passed or failed, when there's more than one way */
  reason?: 'secure' | 'local' | 'insecure' | 'untrusted-proxy' | 'no-proxy-seen';
}

export interface ServerInfo {
  mode: AppMode;
  version: string;
  /** Server mode only */
  checks?: SecurityCheck[];
}

export interface CheckInputs {
  /** The request came over HTTPS (directly, or through a trusted proxy) */
  secure: boolean;
  /** The host name the browser used */
  hostname: string;
  /** The request carries reverse-proxy headers (X-Forwarded-For / Forwarded) */
  forwarded: boolean;
  trustProxyConfigured: boolean;
  allowedHostsConfigured: boolean;
  encryptionKey: boolean;
  passwordSet: boolean;
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i;

/** Security checks for a self-hosted server, as seen from one request. Pure. */
export function securityChecks(input: CheckInputs): SecurityCheck[] {
  const local = LOOPBACK.test(input.hostname);
  return [
    {
      id: 'https',
      // Plain HTTP on the same computer never crosses a network
      ok: input.secure || local,
      reason: input.secure ? 'secure' : local ? 'local' : 'insecure',
    },
    {
      id: 'trustProxy',
      // Behind a proxy that isn't trusted, HTTPS and client addresses are misdetected.
      // Trusting a proxy when requests arrive directly lets clients fake their address.
      ok: input.forwarded === input.trustProxyConfigured,
      ...(input.forwarded !== input.trustProxyConfigured && {
        reason: input.forwarded ? 'untrusted-proxy' : 'no-proxy-seen',
      }),
    },
    { id: 'allowedHosts', ok: input.allowedHostsConfigured },
    { id: 'encryptionKey', ok: input.encryptionKey },
    { id: 'password', ok: input.passwordSet },
  ];
}

function checksFor(req: Request): SecurityCheck[] {
  return securityChecks({
    secure: req.secure,
    hostname: req.hostname ?? '',
    forwarded: req.headers['x-forwarded-for'] !== undefined || req.headers.forwarded !== undefined,
    trustProxyConfigured: Boolean(trustProxy),
    allowedHostsConfigured: allowedHosts.length > 0,
    encryptionKey: secretCipher.enabled,
    passwordSet: isPasswordSet(),
  });
}

export const serverRouter = Router();

serverRouter.get('/info', (req, res) => {
  const info: ServerInfo = { mode: appMode, version: appVersion };
  if (appMode === 'server') info.checks = checksFor(req);
  res.json(info);
});
