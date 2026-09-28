import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// Server mode + an allowlist are read from the environment when modules load
process.env.FLYBUDGET_SERVER_MODE = 'true';
process.env.FLYBUDGET_ALLOWED_HOSTS = 'budget.example.com, 192.168.1.20:3001';

const express = (await import('express')).default;
const { hostGuard, originGuard } = await import('./security.js');

let server: http.Server;
let port: number;

beforeAll(async () => {
  const app = express();
  app.use(hostGuard, originGuard);
  app.all('/api/thing', (_req, res) => res.json({ ok: true }));
  server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());

function request(host: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<number>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: '/api/thing', headers: { host, ...headers } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('request guards in server mode', () => {
  it('accepts the configured hosts (with or without port entries)', async () => {
    expect(await request('budget.example.com')).toBe(200);
    expect(await request('budget.example.com:8443')).toBe(200);
    expect(await request('192.168.1.20:3001')).toBe(200);
  });

  it('rejects hosts that are not on the allowlist', async () => {
    expect(await request('evil.example')).toBe(403);
    expect(await request('192.168.1.20:9999')).toBe(403);
  });

  it("accepts requests from the server's own address (same origin)", async () => {
    const status = await request(
      'budget.example.com',
      { origin: 'http://budget.example.com', 'sec-fetch-site': 'same-origin' },
      'POST',
    );
    expect(status).toBe(200);
  });

  it('still rejects other websites', async () => {
    for (const origin of [
      'https://evil.example',
      'null',
      'http://budget.example.com.evil.example',
    ]) {
      const status = await request(
        'budget.example.com',
        { origin, 'sec-fetch-site': 'cross-site' },
        'POST',
      );
      expect(status, origin).toBe(403);
    }
  });
});
