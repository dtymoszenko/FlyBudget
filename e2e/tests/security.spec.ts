import http from 'http';
import { test, expect, open, isoDay } from './fixtures';
import { DESKTOP_PORT } from '../ports';

// The desktop app's defenses, checked from the outside: only the app's own window
// (with its per-launch token) can use the API, other websites and DNS-rebinding hosts
// are refused, and the page is locked down by its security headers.

/** A raw HTTP request, so the Host and Origin headers can be anything */
function rawRequest(
  path: string,
  headers: Record<string, string>,
  method = 'GET',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: DESKTOP_PORT, path, method, headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const token = () => `flybudget_token=${process.env.E2E_API_TOKEN}`;
const localHost = `localhost:${DESKTOP_PORT}`;

test.describe('API access', () => {
  test('requires the per-launch token', async () => {
    expect((await rawRequest('/api/accounts', { host: localHost })).status).toBe(401);
    expect(
      (await rawRequest('/api/accounts', { host: localHost, cookie: 'flybudget_token=guess' }))
        .status,
    ).toBe(401);
    expect((await rawRequest('/api/accounts', { host: localHost, cookie: token() })).status).toBe(
      200,
    );
    // Only the health check is open (the app waits on it at startup)
    expect((await rawRequest('/api/health', { host: localHost })).status).toBe(200);
  });

  test('refuses other host names (DNS rebinding)', async () => {
    const res = await rawRequest('/api/accounts', { host: 'evil.example', cookie: token() });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden host' });
  });

  test('refuses requests from other websites, even simple form posts', async () => {
    const attempts: Record<string, string>[] = [
      { origin: 'https://evil.example' },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of attempts) {
      const res = await rawRequest(
        '/api/schedules/auto-create',
        { host: localHost, cookie: token(), ...headers },
        'POST',
      );
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
  });

  test('errors never include stack traces or internals', async () => {
    const res = await rawRequest('/api/transactions?limit=abc', {
      host: localHost,
      cookie: token(),
    });
    expect(res.status).toBe(400);
    expect(res.body).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+/);
    const missing = await rawRequest('/api/nope', { host: localHost, cookie: token() });
    expect(missing).toEqual({ status: 404, body: '{"error":"Not found"}' });
  });
});

test.describe('the page', () => {
  test('is served with strict security headers', async ({ page, api }) => {
    await api.createAccount('Checking');
    const response = await page.goto('/');
    const headers = response!.headers();
    const csp = headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('blocks injected inline scripts and outside connections', async ({ page, api }) => {
    test.info().annotations.push({ type: 'allow-page-errors', description: 'CSP violations' });
    await api.createAccount('Checking');
    await open(page, '/dashboard');
    await expect(page.getByRole('complementary')).toBeVisible();
    const result = await page.evaluate(async () => {
      const script = document.createElement('script');
      script.textContent = 'window.__injected = true';
      document.body.appendChild(script);
      let fetched = true;
      try {
        await fetch('https://example.com/steal', { mode: 'no-cors' });
      } catch {
        fetched = false;
      }
      return { injected: (window as unknown as { __injected?: boolean }).__injected, fetched };
    });
    expect(result).toEqual({ injected: undefined, fetched: false });
  });

  test('shows bank-supplied text as text, never as HTML', async ({ page, api }) => {
    const checking = await api.createAccount('Checking');
    const nasty = '<img src=x onerror="window.__xss=1">Sneaky Store';
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -100,
      payeeName: nasty,
      notes: '<script>window.__xss=2</script>',
    });
    await open(page, `/accounts/${checking.id}`);
    const row = page.getByTestId('transaction-row').filter({ hasText: 'Sneaky Store' });
    await expect(row).toContainText(nasty);
    await row.click();
    await expect(
      page.getByRole('complementary', { name: 'Transaction details' }).getByRole('textbox', {
        name: 'Notes',
      }),
    ).toHaveValue('<script>window.__xss=2</script>');
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });
});
