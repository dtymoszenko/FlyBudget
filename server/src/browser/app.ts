// The in-browser demo's "server": the real budget routers, mounted like index.ts does,
// plus answers for the few server-only endpoints the app asks about. Runs in a Web Worker
// (see worker.ts and README.md here).
import {
  Router,
  createResponse,
  type ShimRequest,
  type ShimResponse,
  type ShimRouter,
} from './expressShim.js';
import { accountsRouter } from '../routes/accounts.js';
import { categoriesRouter } from '../routes/categories.js';
import { transactionsRouter } from '../routes/transactions.js';
import { budgetRouter } from '../routes/budget.js';
import { payeesRouter } from '../routes/payees.js';
import { rulesRouter } from '../routes/rules.js';
import { reportsRouter } from '../routes/reports.js';
import { exportRouter } from '../routes/export.js';
import { customReportsRouter } from '../routes/customReports.js';
import { dashboardsRouter } from '../routes/dashboards.js';
import { schedulesRouter } from '../routes/schedules.js';
import { goalsRouter } from '../routes/goals.js';

/** Answer for anything that needs a real server: bank connections, sign-in. */
const NOT_IN_DEMO = "This isn't available in the demo. Download FlyBudget to use it.";

const app = Router();

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/auth/status', (_req, res) =>
  res.json({ enabled: false, needsSetup: false, authenticated: true }),
);
app.get('/server/info', (_req, res) => res.json({ mode: 'demo', version: DEMO_VERSION }));

// Bank sync talks to Plaid and SimpleFIN from a server, so the demo shows it as not set up
app.get('/plaid/status', (_req, res) => res.json({ configured: false, environment: null }));
app.get('/plaid/items', (_req, res) => res.json([]));
app.get('/simplefin/connections', (_req, res) => res.json([]));

app.use('/accounts', accountsRouter as unknown as ShimRouter);
app.use('/categories', categoriesRouter as unknown as ShimRouter);
app.use('/transactions', transactionsRouter as unknown as ShimRouter);
app.use('/budget', budgetRouter as unknown as ShimRouter);
app.use('/payees', payeesRouter as unknown as ShimRouter);
app.use('/rules', rulesRouter as unknown as ShimRouter);
app.use('/reports', reportsRouter as unknown as ShimRouter);
app.use('/export', exportRouter as unknown as ShimRouter);
app.use('/custom-reports', customReportsRouter as unknown as ShimRouter);
app.use('/dashboards', dashboardsRouter as unknown as ShimRouter);
app.use('/schedules', schedulesRouter as unknown as ShimRouter);
app.use('/goals', goalsRouter as unknown as ShimRouter);

app.use('/plaid', (_req, res) => res.status(403).json({ error: NOT_IN_DEMO }));
app.use('/simplefin', (_req, res) => res.status(403).json({ error: NOT_IN_DEMO }));
app.use('/auth', (_req, res) => res.status(403).json({ error: NOT_IN_DEMO }));

declare const __FLYBUDGET_VERSION__: string;
const DEMO_VERSION = typeof __FLYBUDGET_VERSION__ === 'string' ? __FLYBUDGET_VERSION__ : 'demo';

export interface DemoRequest {
  method: string;
  /** Path after /api, with its query string */
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface DemoResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
}

/** Handles one API request, like the Express app in index.ts would. */
export async function handleRequest(request: DemoRequest): Promise<DemoResponse> {
  const url = new URL(request.url, 'http://demo');
  // No prototype, so a key like "__proto__" is just a key (like Express's own query parser)
  const query: Record<string, string | string[]> = Object.create(null);
  for (const key of new Set(url.searchParams.keys())) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const values = url.searchParams.getAll(key);
    query[key] = values.length === 1 ? values[0] : values;
  }
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  let body: unknown = {};
  if (request.body) {
    try {
      body = JSON.parse(request.body);
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }
  }
  const req: ShimRequest = {
    method: request.method.toUpperCase(),
    path: url.pathname,
    url: url.pathname + url.search,
    params: {},
    query,
    body,
    headers,
    get: (name) => headers[name.toLowerCase()],
  };
  const res: ShimResponse = createResponse();

  try {
    await app.handle(req, res, () => {
      res.status(404).json({ error: 'Not found' });
    });
  } catch (err) {
    // Like errorHandler: log the details, send a generic message
    console.error('Demo API error:', err);
    return json(500, { error: 'Something went wrong' });
  }
  return { status: res.statusCode, headers: res.headers, body: res.body };
}

function json(status: number, value: unknown): DemoResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}
