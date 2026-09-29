import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

// Server mode is read from the environment when modules load, so set it first
process.env.FLYBUDGET_SERVER_MODE = 'true';

const express = (await import('express')).default;
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { db } = await import('../db/index.js');
const { authRouter, requireSession } = await import('./auth.js');
const { serverRouter, securityChecks } = await import('./server.js');
const { setupCode } = await import('../auth/setupCode.js');
const { cleanUserAgent } = await import('../auth/sessions.js');
const { resolveVersion } = await import('../utils/version.js');

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api', requireSession);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/server', serverRouter);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

const request = (method: string, path: string, cookie?: string, headers: object = {}) =>
  fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: method === 'POST' ? '{}' : undefined,
  });
const sessionCookie = (res: Response) => res.headers.get('set-cookie')?.split(';')[0];
const PASSWORD = 'a long enough password';

async function login(userAgent: string) {
  const res = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
    body: JSON.stringify({ password: PASSWORD }),
  });
  expect(res.status).toBe(204);
  return sessionCookie(res)!;
}

describe('GET /api/server/info (server mode)', () => {
  let cookie: string;

  it('is refused before setup and for anonymous visitors; health stays minimal', async () => {
    expect((await request('GET', '/server/info')).status).toBe(401);
    const health = await request('GET', '/health');
    expect(await health.json()).toEqual({ status: 'ok' });

    const res = await fetch(base + '/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, setupCode: setupCode() }),
    });
    expect(res.status).toBe(204);
    cookie = sessionCookie(res)!;

    expect((await request('GET', '/server/info')).status).toBe(401);
    expect((await request('GET', '/server/info', 'flybudget_session=forged')).status).toBe(401);
    expect(await (await request('GET', '/health')).json()).toEqual({ status: 'ok' });
  });

  it('tells a signed-in browser the mode, version and security checks', async () => {
    const res = await request('GET', '/server/info', cookie);
    expect(res.status).toBe(200);
    const info = await res.json();
    expect(info.mode).toBe('server');
    expect(info.version).toMatch(/^[0-9A-Za-z.+-]+$/);
    const byId = Object.fromEntries(info.checks.map((c: { id: string }) => [c.id, c]));
    // Plain HTTP to 127.0.0.1: local, so not a warning
    expect(byId.https).toEqual({ id: 'https', ok: true, reason: 'local' });
    expect(byId.trustProxy).toEqual({ id: 'trustProxy', ok: true });
    expect(byId.allowedHosts.ok).toBe(false);
    expect(byId.encryptionKey.ok).toBe(true);
    expect(byId.password.ok).toBe(true);
  });

  it('warns when a reverse proxy is in front but not trusted', async () => {
    const info = await (
      await request('GET', '/server/info', cookie, { 'X-Forwarded-For': '203.0.113.9' })
    ).json();
    expect(info.checks.find((c: { id: string }) => c.id === 'trustProxy')).toEqual({
      id: 'trustProxy',
      ok: false,
      reason: 'untrusted-proxy',
    });
  });

  it('never includes secrets, hashes, tokens or paths', async () => {
    const text = await (await request('GET', '/server/info', cookie)).text();
    const secrets = [
      process.env.FLYBUDGET_DATA_KEY!,
      cookie.split('=')[1],
      PASSWORD,
      ...db.$client
        .prepare('select id from sessions')
        .all()
        .map((r) => (r as { id: string }).id),
      (
        db.$client.prepare('select password_hash from auth_config').get() as {
          password_hash: string;
        }
      ).password_hash,
    ];
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/[\\/](budget\.db|Users|home)/i);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['checks', 'mode', 'version']);
  });
});

describe('signed-in devices', () => {
  let phone: string;
  let laptop: string;

  it('lists sessions without anything that could sign in', async () => {
    phone = await login('Mozilla/5.0\t(iPhone)\t');
    laptop = await login('Mozilla/5.0 (Windows NT 10.0) Chrome/140');
    const res = await request('GET', '/auth/sessions', laptop);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const s of list) {
      expect(s.id).toMatch(/^[0-9a-f]{12}$/);
      expect(Object.keys(s).sort()).toEqual(
        ['createdAt', 'current', 'expiresAt', 'id', 'lastUsedAt', 'userAgent'].sort(),
      );
      expect(new Date(s.createdAt).getTime()).not.toBeNaN();
    }
    expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(list.find((s: { current: boolean }) => s.current).userAgent).toContain('Windows');
    // Control characters from the header are dropped
    expect(list.some((s: { userAgent: string }) => s.userAgent?.includes('\t'))).toBe(false);

    const text = JSON.stringify(list);
    for (const row of db.$client.prepare('select id from sessions').all() as { id: string }[]) {
      expect(text).not.toContain(row.id);
    }
    for (const c of [phone, laptop]) expect(text).not.toContain(c.split('=')[1]);
  });

  it('needs a session', async () => {
    expect((await request('GET', '/auth/sessions')).status).toBe(401);
    expect((await request('POST', '/auth/sessions/sign-out-others')).status).toBe(401);
    expect((await request('DELETE', '/auth/sessions/abcdefabcdef')).status).toBe(401);
  });

  it('signs out one device by its id', async () => {
    const list = await (await request('GET', '/auth/sessions', laptop)).json();
    const phoneSession = list.find((s: { userAgent: string }) => s.userAgent?.includes('iPhone'));
    expect((await request('DELETE', '/auth/sessions/not-an-id', laptop)).status).toBe(400);
    expect((await request('DELETE', '/auth/sessions/000000000000', laptop)).status).toBe(404);
    expect((await request('DELETE', `/auth/sessions/${phoneSession.id}`, laptop)).status).toBe(204);
    expect((await request('GET', '/server/info', phone)).status).toBe(401);
    expect((await request('GET', '/server/info', laptop)).status).toBe(200);
  });

  it('signs out every other device and keeps this one', async () => {
    const other = await login('Firefox');
    const res = await request('POST', '/auth/sessions/sign-out-others', laptop);
    expect(res.status).toBe(200);
    expect((await res.json()).signedOut).toBeGreaterThanOrEqual(1);
    expect((await request('GET', '/server/info', other)).status).toBe(401);
    const list = await (await request('GET', '/auth/sessions', laptop)).json();
    expect(list).toHaveLength(1);
    expect(list[0].current).toBe(true);
  });

  it('signing out the current device clears its cookie', async () => {
    const list = await (await request('GET', '/auth/sessions', laptop)).json();
    const res = await request('DELETE', `/auth/sessions/${list[0].id}`, laptop);
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(/flybudget_session=;/);
    expect((await request('GET', '/server/info', laptop)).status).toBe(401);
  });
});

describe('securityChecks', () => {
  const inputs = fc.record({
    secure: fc.boolean(),
    hostname: fc.oneof(
      fc.constantFrom('localhost', '127.0.0.1', 'budget.example.com', '192.168.1.20'),
      fc.domain(),
    ),
    forwarded: fc.boolean(),
    trustProxyConfigured: fc.boolean(),
    allowedHostsConfigured: fc.boolean(),
    encryptionKey: fc.boolean(),
    passwordSet: fc.boolean(),
  });

  it('flags exactly the settings that are missing or mismatched', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const checks = Object.fromEntries(securityChecks(input).map((c) => [c.id, c]));
        const local = ['localhost', '127.0.0.1'].includes(input.hostname);
        expect(checks.https.ok).toBe(input.secure || local);
        expect(checks.trustProxy.ok).toBe(input.forwarded === input.trustProxyConfigured);
        if (!checks.trustProxy.ok) {
          expect(checks.trustProxy.reason).toBe(
            input.forwarded ? 'untrusted-proxy' : 'no-proxy-seen',
          );
        }
        expect(checks.allowedHosts.ok).toBe(input.allowedHostsConfigured);
        expect(checks.encryptionKey.ok).toBe(input.encryptionKey);
        expect(checks.password.ok).toBe(input.passwordSet);
      }),
    );
  });

  it('only ever reports ids and yes/no answers', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const json = JSON.stringify(securityChecks(input));
        expect(json).not.toContain(input.hostname);
      }),
    );
  });
});

describe('cleanUserAgent / resolveVersion', () => {
  it('keeps user agents printable and short', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 600, unit: 'binary' }), (ua) => {
        const cleaned = cleanUserAgent(ua);
        if (cleaned === null) return;
        expect(cleaned.length).toBeLessThanOrEqual(256);
        // eslint-disable-next-line no-control-regex
        expect(cleaned).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      }),
    );
  });

  it('picks the first well-formed version', () => {
    expect(resolveVersion([undefined, '1.2.3', '9.9.9'])).toBe('1.2.3');
    expect(resolveVersion(['<script>', '1.0.0-beta.1'])).toBe('1.0.0-beta.1');
    expect(resolveVersion([undefined, ''])).toBe('unknown');
  });
});
