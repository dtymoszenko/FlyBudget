import http from 'http';
import { FRANKFURTER_MOCK_PORT } from './ports';

// A stand-in for Frankfurter (api.frankfurter.dev), which serves the ECB's euro reference
// rates, for the desktop server the tests start (FLYBUDGET_EXCHANGE_RATES_URL points here).
// Every working day has the same rates, so tests can count on them.

/** Units of each currency per euro */
export const MOCK_RATES: Record<string, number> = { USD: 1.25, GBP: 0.8, PLN: 4.25, JPY: 160 };

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

export function startFrankfurterMock(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/v1/currencies') {
      return json(res, 200, {
        EUR: 'Euro',
        USD: 'US Dollar',
        GBP: 'British Pound',
        PLN: 'Polish Zloty',
        JPY: 'Japanese Yen',
      });
    }
    const range = /^\/v1\/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(url.pathname);
    if (!range) return json(res, 404, { message: 'not found' });
    const symbols = (url.searchParams.get('symbols') ?? '')
      .split(',')
      .filter((s) => s in MOCK_RATES);
    const rates: Record<string, Record<string, number>> = {};
    for (
      let d = new Date(`${range[1]}T00:00:00Z`);
      d <= new Date(`${range[2]}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      rates[d.toISOString().slice(0, 10)] = Object.fromEntries(
        symbols.map((s) => [s, MOCK_RATES[s]]),
      );
    }
    json(res, 200, { amount: 1, base: 'EUR', start_date: range[1], end_date: range[2], rates });
  });
  return new Promise((resolve) =>
    server.listen(FRANKFURTER_MOCK_PORT, '127.0.0.1', () => resolve(server)),
  );
}
