import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { and, eq, gt, lte, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import { authConfig, sessions } from '../db/schema.js';
import { hashPassword, verifyPassword } from './password.js';

// Server-mode login: one password for the whole server (like Actual Budget's
// server password), set by the first visitor. Sessions are random 256-bit tokens;
// only their SHA-256 is stored, so a leaked database doesn't leak live sessions.

export const SESSION_COOKIE = 'flybudget_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CONFIG_ID = 'server';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export function isPasswordSet(): boolean {
  return db.select({ id: authConfig.id }).from(authConfig).get() !== undefined;
}

/** First-run setup. Returns false if a password already exists (setup can't be repeated). */
export async function setInitialPassword(password: string): Promise<boolean> {
  const hash = await hashPassword(password);
  // The insert is the check: a second concurrent setup hits the primary key
  try {
    db.insert(authConfig).values({ id: CONFIG_ID, passwordHash: hash }).run();
    return true;
  } catch {
    return false;
  }
}

export async function checkPassword(password: string): Promise<boolean> {
  const row = db.select().from(authConfig).where(eq(authConfig.id, CONFIG_ID)).get();
  // Still spend the hashing time when no password is set, so timing reveals nothing
  if (!row) {
    await hashPassword(password);
    return false;
  }
  return verifyPassword(password, row.passwordHash);
}

/** Changes the password and signs out every other session. */
export async function changePassword(newPassword: string, keepSessionToken?: string) {
  const hash = await hashPassword(newPassword);
  db.update(authConfig)
    .set({ passwordHash: hash, updatedAt: new Date().toISOString() })
    .where(eq(authConfig.id, CONFIG_ID))
    .run();
  const keep = keepSessionToken ? digest(keepSessionToken) : '';
  db.delete(sessions).where(ne(sessions.id, keep)).run();
}

// --- Trusted devices ---
// Browsers that have signed in get a long-lived "device" cookie (OWASP's defense
// against lockout attacks): failed logins from a known device are rate limited on
// their own, so someone guessing passwords, even from behind the same reverse proxy
// or NAT, can't lock the owner out. The cookie is an HMAC keyed by the password
// hash, so only this server can issue one, and changing the password voids them all.

export const DEVICE_COOKIE = 'flybudget_device';
export const DEVICE_TTL_MS = 400 * 24 * 60 * 60 * 1000; // the longest browsers keep a cookie

function deviceSignature(id: string): Buffer | null {
  const row = db.select({ hash: authConfig.passwordHash }).from(authConfig).get();
  return row ? createHmac('sha256', row.hash).update(`device:${id}`).digest() : null;
}

/** A new device cookie value, or null if no password is set yet. */
export function createDeviceToken(): string | null {
  const id = randomBytes(18).toString('base64url');
  const signature = deviceSignature(id);
  return signature ? `${id}.${signature.toString('base64url')}` : null;
}

/** The device id if the cookie value is one this server issued (for the current password). */
export function verifyDeviceToken(token: string | undefined): string | null {
  const [id, sig, extra] = (token ?? '').split('.');
  if (!id || !sig || extra !== undefined || id.length > 64) return null;
  const expected = deviceSignature(id);
  const given = Buffer.from(sig, 'base64url');
  if (!expected || given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? id : null;
}

/** Longest user agent kept for the signed-in devices list */
const MAX_USER_AGENT_LENGTH = 256;

/** A user agent header made safe to store and show: no control characters, capped. */
export function cleanUserAgent(userAgent: string | undefined): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = (userAgent ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return cleaned ? cleaned.slice(0, MAX_USER_AGENT_LENGTH) : null;
}

export function createSession(userAgent?: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const now = new Date().toISOString();
  db.insert(sessions)
    .values({
      id: digest(token),
      expiresAt: expiresAt.toISOString(),
      userAgent: cleanUserAgent(userAgent),
      lastUsedAt: now,
    })
    .run();
  return { token, expiresAt };
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const row = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, digest(token)), gt(sessions.expiresAt, new Date().toISOString())))
    .get();
  return row !== undefined;
}

export function deleteSession(token: string | undefined) {
  if (token)
    db.delete(sessions)
      .where(eq(sessions.id, digest(token)))
      .run();
}

export function deleteExpiredSessions() {
  db.delete(sessions).where(lte(sessions.expiresAt, new Date().toISOString())).run();
}

// --- Signed-in devices ---
// Settings → Server lists the sessions so the owner can sign out a lost phone. The list
// never includes the stored id (the token's hash): each session gets a public id that is
// a hash of that hash, which can name a session but can't be turned into a cookie.

/** How often "last used" is written for a session that keeps making requests */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const lastTouched = new Map<string, number>();

export const publicSessionId = (storedId: string) => digest(`session:${storedId}`).slice(0, 12);

export interface SessionInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  userAgent: string | null;
  current: boolean;
}

/** Records that a valid session was used (at most every few minutes per session). */
export function touchSession(token: string | undefined) {
  if (!token) return;
  const id = digest(token);
  const now = Date.now();
  if (now - (lastTouched.get(id) ?? 0) < TOUCH_INTERVAL_MS) return;
  lastTouched.set(id, now);
  // Don't let the map grow with sessions that ended long ago
  if (lastTouched.size > 1000) {
    for (const [key, at] of lastTouched) if (now - at >= TOUCH_INTERVAL_MS) lastTouched.delete(key);
  }
  db.update(sessions)
    .set({ lastUsedAt: new Date(now).toISOString() })
    .where(eq(sessions.id, id))
    .run();
}

/** Every live session, newest first, with the caller's own marked `current`. */
export function listSessions(currentToken: string | undefined): SessionInfo[] {
  const current = currentToken ? digest(currentToken) : '';
  return db
    .select()
    .from(sessions)
    .where(gt(sessions.expiresAt, new Date().toISOString()))
    .all()
    .map((s) => ({
      id: publicSessionId(s.id),
      // SQLite's datetime('now') is UTC without the ISO "T" and "Z"
      createdAt: /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s.createdAt)
        ? `${s.createdAt.replace(' ', 'T')}Z`
        : s.createdAt,
      expiresAt: s.expiresAt,
      lastUsedAt: s.lastUsedAt,
      userAgent: s.userAgent,
      current: s.id === current,
    }))
    .sort((a, b) => (b.lastUsedAt ?? b.createdAt).localeCompare(a.lastUsedAt ?? a.createdAt));
}

/** Signs out the session with this public id. Returns whether one was found. */
export function deleteSessionByPublicId(publicId: string): boolean {
  const match = db
    .select({ id: sessions.id })
    .from(sessions)
    .all()
    .find((s) => publicSessionId(s.id) === publicId);
  if (!match) return false;
  db.delete(sessions).where(eq(sessions.id, match.id)).run();
  return true;
}

/** Signs out every session except this one. Returns how many were signed out. */
export function deleteOtherSessions(currentToken: string): number {
  return db
    .delete(sessions)
    .where(ne(sessions.id, digest(currentToken)))
    .run().changes;
}
