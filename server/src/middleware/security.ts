import { timingSafeEqual } from 'crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

// The API has no login: it's protected by only answering the app itself.
// These guards stop other websites open in the user's browser, and (in the
// desktop app) other programs or users on the same machine, from using it.

/** Vite dev server — the only origin that calls the API cross-origin (via its proxy or directly). */
export const DEV_CLIENT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];

export const API_TOKEN_COOKIE = 'flybudget_token';

const selfOrigins = (port: number) => LOCAL_HOSTNAMES.map((h) => `http://${h}:${port}`);

/**
 * Rejects requests whose Host header isn't this server on localhost. Blocks DNS
 * rebinding, where a malicious domain re-points itself at 127.0.0.1 so the
 * browser treats the API as same-origin with the attacker's page.
 */
export const hostGuard: RequestHandler = (req, res, next) => {
  const port = req.socket.localPort;
  const allowed = LOCAL_HOSTNAMES.map((h) => `${h}:${port}`);
  if (!allowed.includes(req.headers.host ?? '')) {
    res.status(403).json({ error: 'Forbidden host' });
    return;
  }
  next();
};

/**
 * Rejects requests made by other websites. CORS only stops them from reading
 * responses; browsers still send "simple" cross-site requests (e.g. a form POST),
 * which could trigger actions like running rules or auto-creating transactions.
 */
export const originGuard: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  const allowedOrigins = [...DEV_CLIENT_ORIGINS, ...selfOrigins(req.socket.localPort ?? 0)];

  if (origin !== undefined && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: 'Forbidden origin' });
    return;
  }
  // Browsers mark cross-site requests even when they omit Origin (e.g. GET navigations).
  // Other localhost ports count as "same-site", so those must carry an allowed Origin.
  if (site === 'cross-site' || (site === 'same-site' && origin === undefined)) {
    res.status(403).json({ error: 'Forbidden cross-site request' });
    return;
  }
  next();
};

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/**
 * Desktop app only: the Electron main process generates a random token per launch,
 * passes it here via FLYBUDGET_API_TOKEN, and sets it as an HttpOnly, SameSite=Strict
 * cookie in its own window. Anything else on the machine that finds the port —
 * another program or another OS user — can't read or change the user's data.
 */
export function apiTokenGuard(token: string | undefined): RequestHandler {
  if (!token) return (_req, _res, next) => next();
  const expected = Buffer.from(token);
  return (req, res, next) => {
    if (req.path === '/api/health') return next(); // used by the main process to wait for startup
    const given = Buffer.from(readCookie(req.headers.cookie, API_TOKEN_COOKIE) ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}

/**
 * Security headers. The Content Security Policy is an allowlist of where the page
 * may load code and send data: only this app. (Plaid Link runs on Plaid's hosted
 * page in the user's own browser, so no third-party script or frame is allowed.)
 * It applies to the built client served by this server (the desktop app); the Vite
 * dev server serves its own HTML.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // Some UI libraries (e.g. the emoji picker) inject <style> tags at runtime
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  // Served over http://localhost — HSTS / upgrade-insecure-requests don't apply
  strictTransportSecurity: false,
  // With COOP same-origin, fully isolates the page from other origins
  crossOriginEmbedderPolicy: { policy: 'require-corp' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  xFrameOptions: { action: 'deny' },
});

/**
 * Caps bank-sync actions (connect, sync, disconnect) at a pace no person clicking
 * would hit, so a bug or runaway loop can't hammer Plaid/SimpleFIN (Plaid bills
 * per call and may lock the account). Read-only GETs are not limited.
 */
export const bankRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  skip: (req) => req.method === 'GET',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many bank requests. Wait a minute and try again.' },
});

/** Unknown API routes get a JSON 404 instead of Express's HTML page. */
export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' });
};

/**
 * Last-resort error handler. Express's default one sends the stack trace (with
 * file paths) to the client unless NODE_ENV=production, which the app doesn't
 * set. Details go to the server log only.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = typeof err?.status === 'number' && err.status >= 400 ? err.status : 500;
  // Fixed format string, and the path JSON-escaped so it can't forge log lines
  if (status >= 500) console.error('Error on %s %s:', req.method, JSON.stringify(req.path), err);
  const message =
    err?.type === 'entity.parse.failed'
      ? 'Invalid JSON'
      : err?.type === 'entity.too.large'
        ? 'Request too large'
        : status < 500
          ? 'Bad request'
          : 'Internal server error';
  res.status(status).json({ error: message });
};
