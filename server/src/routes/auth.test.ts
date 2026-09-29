import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

// Server mode is read from the environment when modules load, so set it first
process.env.FLYBUDGET_SERVER_MODE = 'true';

const express = (await import('express')).default;
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { db } = await import('../db/index.js');
const { authRouter, requireSession } = await import('./auth.js');
const { setupCode } = await import('../auth/setupCode.js');

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api', requireSession);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/accounts', (_req, res) => res.json([{ name: 'secret account' }]));
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

const post = (path: string, body: unknown, cookie?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const get = (path: string, cookie?: string) =>
  fetch(base + path, { headers: cookie ? { cookie } : {} });
const sessionCookie = (res: Response) => res.headers.get('set-cookie')?.split(';')[0];
const deviceCookie = (res: Response) =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith('flybudget_device='))
    ?.split(';')[0];

describe('server mode login', () => {
  let cookie: string;

  it('starts locked, asking for setup; data requires a login', async () => {
    expect(await (await get('/auth/status')).json()).toEqual({
      enabled: true,
      needsSetup: true,
      authenticated: false,
    });
    expect((await get('/accounts')).status).toBe(401);
    expect((await get('/health')).status).toBe(200);
  });

  it('rejects passwords shorter than 8 characters', async () => {
    expect((await post('/auth/setup', { password: 'short', setupCode: setupCode() })).status).toBe(
      400,
    );
  });

  it('setup requires the setup code from the server log', async () => {
    expect((await post('/auth/setup', { password: 'attacker password' })).status).toBe(403);
    expect(
      (await post('/auth/setup', { password: 'attacker password', setupCode: 'AAAA-BBBB' })).status,
    ).toBe(403);
    expect((await get('/auth/status')).status).toBe(200);
    expect(setupCode()).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  });

  it('first visit sets the password and signs in with a secure cookie', async () => {
    // Case, spaces and dashes in the code don't matter
    const code = setupCode().toLowerCase().replace(/-/g, ' ');
    const res = await post('/auth/setup', { password: 'first password 123', setupCode: code });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^flybudget_session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    cookie = sessionCookie(res)!;
    expect((await get('/accounts', cookie)).status).toBe(200);
  });

  it('setup can only happen once', async () => {
    expect(
      (await post('/auth/setup', { password: 'attacker password', setupCode: 'anything' })).status,
    ).toBe(409);
  });

  it('stores only hashes: no plaintext password or session token in the database', () => {
    const dump = JSON.stringify([
      db.$client.prepare('select * from auth_config').all(),
      db.$client.prepare('select * from sessions').all(),
    ]);
    expect(dump).not.toContain('first password 123');
    expect(dump).not.toContain(cookie.split('=')[1]);
  });

  it('rejects wrong passwords and forged or missing sessions', async () => {
    expect((await post('/auth/login', { password: 'wrong password' })).status).toBe(401);
    expect((await get('/accounts', 'flybudget_session=forged')).status).toBe(401);
    expect((await get('/accounts')).status).toBe(401);
  });

  it('logs in with the right password, and logging out ends the session', async () => {
    const res = await post('/auth/login', { password: 'first password 123' });
    expect(res.status).toBe(204);
    const second = sessionCookie(res)!;
    expect((await get('/accounts', second)).status).toBe(200);
    expect((await post('/auth/logout', {}, second)).status).toBe(204);
    expect((await get('/accounts', second)).status).toBe(401);
  });

  it('changing the password requires the current one and signs out other sessions', async () => {
    const other = sessionCookie(await post('/auth/login', { password: 'first password 123' }))!;
    const wrong = await post(
      '/auth/change-password',
      { currentPassword: 'nope nope nope', newPassword: 'second password 456' },
      cookie,
    );
    expect(wrong.status).toBe(401);
    const ok = await post(
      '/auth/change-password',
      { currentPassword: 'first password 123', newPassword: 'second password 456' },
      cookie,
    );
    expect(ok.status).toBe(204);
    expect((await get('/accounts', cookie)).status).toBe(200); // this session stays
    expect((await get('/accounts', other)).status).toBe(401); // others are signed out
    expect((await post('/auth/login', { password: 'first password 123' })).status).toBe(401);
    expect((await post('/auth/login', { password: 'second password 456' })).status).toBe(204);
  });

  let device: string;
  let voidedDevice: string;

  it('remembers a browser that signed in, until the password changes', async () => {
    const before = await post('/auth/login', { password: 'second password 456' });
    voidedDevice = deviceCookie(before)!;
    const session = sessionCookie(before)!;
    expect(voidedDevice).toMatch(/^flybudget_device=[\w-]+\.[\w-]+$/);
    expect(before.headers.getSetCookie().join()).toMatch(/Path=\/api\/auth/);
    // Changing the password voids old device cookies and gives this browser a new one
    const changed = await post(
      '/auth/change-password',
      { currentPassword: 'second password 456', newPassword: 'third password 789' },
      session,
    );
    expect(changed.status).toBe(204);
    device = deviceCookie(changed)!;
    expect(device).toBeDefined();
    expect(device).not.toBe(voidedDevice);
  });

  it('rate-limits repeated failed attempts', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await post('/auth/login', { password: `guess ${i}` })).status);
    }
    expect(statuses).toContain(429);
    // Earlier failures in this file count too, so the limit kicks in within 10 tries
    expect(statuses.indexOf(429)).toBeLessThanOrEqual(10);
  });

  it("can't lock out a browser that signed in before, even from the same address", async () => {
    // This address is locked now (previous test); a trusted device has its own limit
    expect((await post('/auth/login', { password: 'guess' })).status).toBe(429);
    expect((await post('/auth/login', { password: 'third password 789' }, device)).status).toBe(
      204,
    );
    // Forged, tampered or voided device cookies fall back to the address's limit
    for (const fake of [
      'flybudget_device=forged.cookie',
      device.slice(0, -2) + 'AA',
      voidedDevice,
    ]) {
      expect((await post('/auth/login', { password: 'third password 789' }, fake)).status).toBe(
        429,
      );
    }
  });
});
