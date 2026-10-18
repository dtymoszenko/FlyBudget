import http from 'http';
import { DESKTOP_PORT, ENABLE_BANKING_MOCK_PORT } from './ports';

// A stand-in for Enable Banking's API (api.enablebanking.com), for the desktop server the
// tests start (FLYBUDGET_ENABLE_BANKING_API points here). Its "bank login" page sends the
// browser straight to FlyBudget's callback on 127.0.0.1, like the flybudget.org relay page
// does, unless a test holds it there to try the paste fallback.
//
// Test controls (POST, no auth: 127.0.0.1 only, test data only):
//   /__mock/reset   back to the start
//   /__mock/expire  every later data request answers EXPIRED_SESSION, until /__mock/renew
//   /__mock/hold    the next bank login shows the address instead of redirecting

const IBAN = 'FI2112345600000785';

interface State {
  expired: boolean;
  hold: boolean;
  sessions: number;
  deleted: string[];
}
let state: State;
const reset = () => (state = { expired: false, hold: false, sessions: 0, deleted: [] });
reset();

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Booked transactions on the checking account; the first matches a CAMT row the test makes */
export const MOCK_TRANSACTIONS = () => [
  {
    entry_reference: 'E2E-REF-1',
    booking_date: days(-3),
    transaction_amount: { amount: '12.50', currency: 'EUR' },
    credit_debit_indicator: 'DBIT',
    status: 'BOOK',
    creditor: { name: 'Kauppa Oy' },
  },
  {
    entry_reference: 'E2E-REF-2',
    booking_date: days(-2),
    transaction_amount: { amount: '2400.00', currency: 'EUR' },
    credit_debit_indicator: 'CRDT',
    status: 'BOOK',
    debtor: { name: 'Employer Oyj' },
    remittance_information: ['SVWZ+Salary'],
  },
  {
    entry_reference: 'E2E-REF-3',
    booking_date: days(-1),
    transaction_amount: { amount: '4.20', currency: 'EUR' },
    credit_debit_indicator: 'DBIT',
    status: 'BOOK',
    creditor: { name: 'Kahvila' },
  },
];

async function body(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString();
  return text ? JSON.parse(text) : {};
}

export function startEnableBankingMock(): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${ENABLE_BANKING_MOCK_PORT}`);
    const path = url.pathname;

    if (req.method === 'POST' && path.startsWith('/__mock/')) {
      if (path === '/__mock/reset') reset();
      if (path === '/__mock/expire') state.expired = true;
      if (path === '/__mock/renew') state.expired = false;
      if (path === '/__mock/hold') state.hold = true;
      return json(res, 200, state);
    }

    // The bank's login page: straight back to FlyBudget, as the relay page would. Only ever
    // to the test desktop server (the relay reads the port from the state; tests use one)
    if (path === '/bank') {
      const query = new URLSearchParams({
        code: `code-${Date.now()}`,
        state: url.searchParams.get('state') ?? '',
      });
      const target = `http://127.0.0.1:${DESKTOP_PORT}/api/enable-banking/callback?${query}`;
      if (state.hold) {
        state.hold = false;
        // Plain text: the address to paste, as the user would copy it
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(target);
      }
      res.writeHead(302, { Location: target });
      return res.end();
    }

    if (!req.headers.authorization?.startsWith('Bearer ')) {
      return json(res, 401, { error: 'UNAUTHORIZED_ACCESS' });
    }
    if (req.method === 'GET' && path === '/application') {
      return json(res, 200, { name: 'E2E FlyBudget', environment: 'PRODUCTION' });
    }
    if (req.method === 'GET' && path === '/aspsps') {
      return json(res, 200, {
        aspsps:
          url.searchParams.get('country') === 'FI'
            ? [
                { name: 'Mock Bank', country: 'FI', maximum_consent_validity: 180 * 86_400 },
                { name: 'Other Bank', country: 'FI', beta: true },
              ]
            : [],
      });
    }
    if (req.method === 'POST' && path === '/auth') {
      const { state: st } = await body(req);
      return json(res, 200, {
        url: `http://127.0.0.1:${ENABLE_BANKING_MOCK_PORT}/bank?state=${encodeURIComponent(st)}`,
        authorization_id: 'auth-1',
      });
    }
    if (req.method === 'POST' && path === '/sessions') {
      const n = ++state.sessions;
      return json(res, 200, {
        session_id: `e2e-session-${n}`,
        aspsp: { name: 'Mock Bank', country: 'FI' },
        access: { valid_until: new Date(Date.now() + 179 * 86_400_000).toISOString() },
        accounts: [
          {
            uid: `uid-${n}`,
            account_id: { iban: IBAN },
            identification_hash: 'hash-checking',
            name: 'Käyttötili',
            currency: 'EUR',
            cash_account_type: 'CACC',
          },
        ],
      });
    }
    if (req.method === 'DELETE' && path.startsWith('/sessions/')) {
      state.deleted.push(decodeURIComponent(path.slice('/sessions/'.length)));
      return json(res, 200, { message: 'OK' });
    }
    if (state.expired) return json(res, 401, { error: 'EXPIRED_SESSION' });
    if (req.method === 'GET' && /^\/accounts\/[^/]+\/transactions$/.test(path)) {
      return json(res, 200, { transactions: MOCK_TRANSACTIONS() });
    }
    if (req.method === 'GET' && /^\/accounts\/[^/]+\/balances$/.test(path)) {
      return json(res, 200, {
        balances: [
          { balance_type: 'ITBD', balance_amount: { amount: '3000.00', currency: 'EUR' } },
        ],
      });
    }
    json(res, 404, { error: 'NOT_FOUND' });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(ENABLE_BANKING_MOCK_PORT, '127.0.0.1', () => resolve(server));
  });
}

export { IBAN as MOCK_IBAN };
