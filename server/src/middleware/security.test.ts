import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import http from 'http';
import {
  API_TOKEN_COOKIE,
  apiTokenGuard,
  hostGuard,
  originGuard,
  securityHeaders,
} from './security.js';

const TOKEN = 'a'.repeat(64);

function makeApp(token?: string) {
  const app = express();
  app.use(hostGuard, originGuard, apiTokenGuard(token), securityHeaders);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.all('/api/thing', (_req, res) => res.json({ ok: true }));
  return app;
}

// Node's fetch forbids setting Host, so use http.request directly
function request(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string> },
) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.path ?? '/api/thing',
        headers: { host: `localhost:${port}`, ...opts.headers },
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function listen(app: express.Express) {
  return new Promise<http.Server>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('request guards (no token: web / dev mode)', () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    server = await listen(makeApp());
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it('allows same-origin requests from the app', async () => {
    const res = await request(port, {
      method: 'POST',
      headers: { origin: `http://localhost:${port}`, 'sec-fetch-site': 'same-origin' },
    });
    expect(res.status).toBe(200);
  });

  it('allows the Vite dev server origin', async () => {
    const res = await request(port, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'sec-fetch-site': 'same-site' },
    });
    expect(res.status).toBe(200);
  });

  it('allows non-browser clients on the same machine (no Origin / Sec-Fetch headers)', async () => {
    expect((await request(port, {})).status).toBe(200);
  });

  it('blocks DNS rebinding (foreign Host header)', async () => {
    expect((await request(port, { headers: { host: `evil.example:${port}` } })).status).toBe(403);
    expect((await request(port, { headers: { host: 'localhost:1' } })).status).toBe(403);
  });

  it('blocks requests from other websites, even "simple" POSTs', async () => {
    for (const origin of ['https://evil.example', 'null', 'http://localhost:8080']) {
      const res = await request(port, {
        method: 'POST',
        headers: { origin, 'sec-fetch-site': 'cross-site' },
      });
      expect(res.status, origin).toBe(403);
    }
  });

  it('blocks cross-site navigations that carry no Origin header', async () => {
    expect((await request(port, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await request(port, { headers: { 'sec-fetch-site': 'same-site' } })).status).toBe(403);
  });

  it('sends security headers including a strict CSP', async () => {
    const { headers } = await request(port, {});
    const csp = String(headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    // No third-party code or frames: Plaid Link runs in the user's own browser
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toMatch(/https?:/);
    expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
  });
});

describe('API token guard (desktop app)', () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    server = await listen(makeApp(TOKEN));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it('rejects requests without the token cookie', async () => {
    expect((await request(port, {})).status).toBe(401);
  });

  it('rejects a wrong or truncated token', async () => {
    for (const value of ['b'.repeat(64), TOKEN.slice(1), '']) {
      const res = await request(port, { headers: { cookie: `${API_TOKEN_COOKIE}=${value}` } });
      expect(res.status, value).toBe(401);
    }
  });

  it('accepts the correct token among other cookies', async () => {
    const res = await request(port, {
      headers: { cookie: `other=1; ${API_TOKEN_COOKIE}=${TOKEN}; x=y` },
    });
    expect(res.status).toBe(200);
  });

  it('leaves the health check open for the startup probe', async () => {
    expect((await request(port, { path: '/api/health' })).status).toBe(200);
  });
});
