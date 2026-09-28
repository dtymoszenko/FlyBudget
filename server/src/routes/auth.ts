import { Router, type Request, type RequestHandler, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { serverMode } from '../config.js';
import { readCookie } from '../middleware/security.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../auth/password.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  changePassword,
  checkPassword,
  createSession,
  deleteSession,
  isPasswordSet,
  isValidSession,
  setInitialPassword,
} from '../auth/sessions.js';
import { checkSetupCode, clearSetupCode, setupCode } from '../auth/setupCode.js';

// Login for server mode (Docker / self-hosted). Modeled on Actual Budget's server:
// the first visitor creates the server password, and everything else requires a
// session. In the desktop app and `npm run dev` these routes report that login is
// disabled, and nothing else changes.

export const authRouter = Router();

const password = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

/** Slows password guessing: failed attempts are limited per IP; successes don't count. */
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait 15 minutes and try again.' },
});

const sessionToken = (req: Request) => readCookie(req.headers.cookie, SESSION_COOKIE);

function startSession(req: Request, res: Response) {
  const { token } = createSession();
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    // Behind an HTTPS reverse proxy (with FLYBUDGET_TRUST_PROXY set), mark it Secure
    secure: req.secure,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

authRouter.get('/status', (req, res) => {
  const needsSetup = serverMode && !isPasswordSet();
  // Make sure a setup code has been printed to the log (e.g. after reset-password)
  if (needsSetup) setupCode();
  res.json({
    enabled: serverMode,
    needsSetup,
    authenticated: !serverMode || isValidSession(sessionToken(req)),
  });
});

authRouter.post('/setup', authRateLimit, async (req, res) => {
  if (!serverMode) return res.status(404).json({ error: 'Not found' });
  const parsed = z
    .object({ password, setupCode: z.string().max(100).optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
    });
  }
  if (isPasswordSet()) return res.status(409).json({ error: 'A password has already been set' });
  if (!checkSetupCode(parsed.data.setupCode)) {
    return res.status(403).json({ error: 'Incorrect setup code' });
  }
  if (!(await setInitialPassword(parsed.data.password))) {
    return res.status(409).json({ error: 'A password has already been set' });
  }
  clearSetupCode();
  startSession(req, res);
  res.status(204).send();
});

authRouter.post('/login', authRateLimit, async (req, res) => {
  if (!serverMode) return res.status(404).json({ error: 'Not found' });
  const parsed = z.object({ password: z.string().max(MAX_PASSWORD_LENGTH) }).safeParse(req.body);
  if (!parsed.success || !(await checkPassword(parsed.data.password))) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  startSession(req, res);
  res.status(204).send();
});

authRouter.post('/logout', (req, res) => {
  deleteSession(sessionToken(req));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.status(204).send();
});

authRouter.post('/change-password', authRateLimit, async (req, res) => {
  if (!serverMode) return res.status(404).json({ error: 'Not found' });
  const token = sessionToken(req);
  if (!isValidSession(token)) return res.status(401).json({ error: 'Login required' });
  const parsed = z
    .object({ currentPassword: z.string().max(MAX_PASSWORD_LENGTH), newPassword: password })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: `New password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
    });
  }
  if (!(await checkPassword(parsed.data.currentPassword))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  await changePassword(parsed.data.newPassword, token);
  res.status(204).send();
});

/** In server mode, every API request except health and login needs a valid session. */
export const requireSession: RequestHandler = (req, res, next) => {
  if (!serverMode || req.path === '/health' || req.path.startsWith('/auth/')) return next();
  if (isValidSession(sessionToken(req))) return next();
  res.status(401).json({ error: 'Login required' });
};
