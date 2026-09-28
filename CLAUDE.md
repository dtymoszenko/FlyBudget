# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Start dev (both client + server):**

```bash
npm run dev          # from project root — runs client (port 5173) and server (port 3001) concurrently
```

**Client only:**

```bash
cd client
npm run dev          # Vite dev server
npm run build        # tsc + vite build
```

**Server only:**

```bash
cd server
npm run dev          # tsx watch (hot reload)
npm run db:generate  # drizzle-kit generate (after schema changes)
npm run db:migrate   # drizzle-kit migrate (apply migrations)
npm run db:seed      # seed default categories and data
```

**Electron:**

```bash
npm run electron:dev    # concurrent dev server + Electron
npm run electron:build  # full build pipeline with electron-builder
```

`better-sqlite3` (v13+) ships Node-API prebuilds that load in both Node and Electron, so no native rebuild is needed when switching between `npm run dev` and Electron.

**Docker (self-hosted server mode):**

```bash
docker build -t flybudget .   # Dockerfile at the root; docker-compose.yml is the example users run
```

The image bundles the server with esbuild (only `better-sqlite3` stays in `node_modules`), serves the built client, runs as the `node` user with data in `/data`, and sets `FLYBUDGET_SERVER_MODE=true`. `.github/workflows/docker.yml` builds and smoke-tests the container on every PR and publishes `ghcr.io/dtymoszenko/flybudget` (amd64 + arm64, with provenance) on `v*` tags. User docs: `website/community/self-hosting.mdx`.

**Type checking:**

```bash
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit
```

**Tests** (Vitest + fast-check property-based tests, run in CI):

```bash
cd client && npm test   # src/**/*.test.ts — currency helpers
cd server && npm test   # src/**/*.test.ts — recurrence dates, rules engine
```

Tests are property-based: they assert invariants over hundreds of generated inputs rather than fixed examples. Server tests run with `DB_PATH=:memory:` (see `server/vitest.config.ts`) so they never touch `budget.db`. To search harder locally, temporarily set `fc.configureGlobal({ numRuns: 20000 })`.

**Supply chain:**

- Every package (`/`, `client/`, `server/`, `website/`) has an `.npmrc` with `ignore-scripts=true`, so dependency install scripts never run. None are needed: Electron downloads its binary on first run, and `esbuild`/`@swc/core` ship platform binaries as optional dependencies. If a new dependency genuinely needs its install script, run it explicitly (e.g. `npm rebuild <pkg> --ignore-scripts=false`) rather than removing the setting.
- CI runs `npm audit signatures` (root, client, server) to verify every package's registry signature. The website is skipped because npm can't verify Docusaurus's aliased `react-loadable`.
- Dependabot waits 7 days (14 for majors) before proposing a new release (`cooldown` in `.github/dependabot.yml`). Security updates are not delayed.

---

## Architecture

**FlyBudget** is a **local-first single-user budgeting app**. No auth, no cloud (for now). The entire app runs on `localhost`. Also packaged as an Electron desktop app.

### Monorepo layout

```
budgeting-project/
├── client/          # React 19 + Vite + Tailwind v4 + React Router v7
├── server/          # Node.js + Express 5 + SQLite
├── electron/        # Electron main + preload (wraps web app)
└── package.json     # root — runs concurrently
```

### Data flow

- All amounts are stored and passed as **integer cents** (e.g. $12.34 → `1234`). Convert at UI boundaries only using `formatCurrency()` and `parseCents()` in `client/src/utils/currency.ts`.
- The DB is a single SQLite file (`server/budget.db`) managed by Drizzle ORM. Schema is in `server/src/db/schema.ts`. All tables use `nanoid` string PKs.
- The client never talks to SQLite directly — everything goes through the Express API at `localhost:3001/api/*`. Vite proxies `/api` to the server in dev.

### Client state split

- **Server state** (transactions, accounts, budget data): TanStack Query. Every resource has a hook in `client/src/hooks/`. Mutations call `queryClient.invalidateQueries` on success to keep cache fresh.
- **UI state** (selected month, sidebar): Zustand store at `client/src/store/appStore.ts`.
- **Preferences** (currency symbol, display settings): Zustand store at `client/src/store/preferencesStore.ts`.

### Security model

The desktop app and `npm run dev` have no login, so `server/src/middleware/security.ts` makes sure only the app itself can use the API. Server mode (self-hosting) adds a password login on top. Keep these in place when adding routes or external resources:

- **`hostGuard`**: rejects any `Host` other than `localhost`/`127.0.0.1` on the server's port (blocks DNS rebinding). In server mode it accepts `FLYBUDGET_ALLOWED_HOSTS` (comma-separated, with or without port) or, if unset, any host (the password protects the API).
- **`originGuard`**: rejects requests from other websites (foreign `Origin`, or `Sec-Fetch-Site: cross-site`), including simple POSTs that CORS alone wouldn't stop. In server mode an `Origin` matching the request's own host is also allowed.
- **`apiTokenGuard`**: desktop app only. `electron/main.ts` generates a random token per launch (`FLYBUDGET_API_TOKEN`) and sets it as an HttpOnly, SameSite=Strict cookie, so other programs and users on the machine can't use the API.
- **Server mode** (`FLYBUDGET_SERVER_MODE=true`, see `server/src/config.ts`): used by self-hosted installs. Settings come from env vars: `FLYBUDGET_HOST` (listen address, default `127.0.0.1`), `FLYBUDGET_ALLOWED_HOSTS`, `FLYBUDGET_TRUST_PROXY` (Express `trust proxy`, for HTTPS behind a reverse proxy) and `FLYBUDGET_DATA_KEY` / `FLYBUDGET_DATA_KEY_FILE` (required: the server refuses to start without an encryption key). The first visit shows a "set a password" screen (`AuthGate`) that also needs a one-time setup code printed to the server log (`server/src/auth/setupCode.ts`, in memory, new on each restart), so nobody else can claim a fresh server; after that every `/api` route except `/api/health` and `/api/auth/*` needs a session (`requireSession` in `server/src/routes/auth.ts`). Passwords are hashed with scrypt (`server/src/auth/password.ts`); sessions are random 256-bit tokens stored only as SHA-256 hashes in `sessions`, sent as the HttpOnly, SameSite=Strict `flybudget_session` cookie (Secure over HTTPS), and expire after 30 days. Login, setup and password changes are limited to 10 failed attempts per 15 minutes; changing the password signs out every other session. Settings → Server (server mode only) has change password and sign out. Password hashing is serialized (~128 MB per scrypt hash). `hstsWhenSecure` adds HSTS for HTTPS requests in server mode.
- **`securityHeaders`** (helmet): a strict CSP (only `'self'`: no third-party scripts, frames or connections), `nosniff`, no framing, `no-referrer`, same-origin CORP/COOP and COEP `require-corp`. **Loading anything from a new external origin means updating the CSP.** Fonts are self-hosted (`@fontsource/inter`), so the app never calls Google.
- **Electron window** (`electron/main.ts`): sandboxed, no Node in the page, DevTools only in dev, and every permission request denied. The window can't navigate away from the app, and `shell.openExternal` is only ever called with `https:` URLs (never pass it arbitrary URLs).
- **Credentials at rest**: `plaid_config.secret`, `plaid_items.access_token` and `simplefin_connections.access_url` use the `encryptedText` column type (`server/src/db/schema.ts` → `secretCrypto.ts`, AES-256-GCM, stored as `enc:v1:…`). The desktop app keeps the key in `userData/credentials.key`, itself encrypted with Electron `safeStorage` (DPAPI/Keychain/libsecret), and passes it in as `FLYBUDGET_DATA_KEY`. Plaintext rows are encrypted on startup (`encryptStoredCredentials`). Plain `npm run dev` has no key and stores them unencrypted. Encrypted columns can't be used in `WHERE` clauses.
- **Outbound requests to user-supplied URLs** (SimpleFIN setup tokens and access URLs) must go through `safeFetch` (`server/src/services/safeFetch.ts`): https only, public IPs only (checked at connect time, so DNS rebinding can't bypass it), manual redirects re-validated on every hop with `Authorization` dropped across origins, a 30s timeout, and capped response sizes. Never call `fetch` directly on such URLs.
- **Bank data is untrusted input**: SimpleFIN responses are validated with Zod (`parseSimplefinResponse`), amounts are converted to cents exactly (no `parseFloat`), and payee text is stripped of control characters and capped at 200 chars.
- **Plaid**: access tokens never leave the server. Disconnecting calls `/item/remove` to revoke the token at Plaid _before_ deleting it locally; if Plaid can't be reached, the connection is kept so the user can retry. Plaid calls time out after 30s. Only `sandbox` and `production` are valid environments (legacy `development` configs map to Sandbox).
- **Rate limiting**: mutating `/api/plaid` and `/api/simplefin` requests are limited to 20/minute (`bankRateLimit`); GETs are not limited.
- **Errors**: `errorHandler` (registered last in `startServer`) returns generic JSON errors and logs details server-side; never send `err.stack` or raw exception messages to the client. Unknown `/api` routes get a JSON 404. Request bodies are capped at 10 MB.
- **CSV export**: `escapeCsv` prefixes cells starting with `=`, `+`, `-`, `@`, tab or CR with `'` (CSV formula injection: payee names come from banks and merchants). Use it for every text cell.
- **Validation**: dates must match `YYYY-MM-DD`, imported rows are capped at 100k, and rule regexes must compile and be at most 200 characters.
- **Packaging** (`electron-builder.json`): the app ships in `app.asar` with embedded integrity validation (a modified file makes the app refuse to start), and Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`. `better-sqlite3` is unpacked from the asar because it's a native module.

### Key conventions

- **API layer**: `client/src/api/` contains thin fetch wrappers using `apiFetch` from `./client`. Types come from `client/src/types/index.ts`.
- **Route validation**: Server routes validate request bodies with Zod before touching the DB.
- **Rules engine**: Rules are stored as JSON-serialized `conditions` and `actions` in the `rules` table. Conditions support operators: `contains`, `starts_with`, `ends_with`, `exact`, `regex` on fields `payee_name`, `amount`, `notes`. First matching rule wins.
- **Budget math**: `To Be Budgeted = income received + prior month carry-over − total budgeted`. Category balance = `budgeted + carry-over − spent`. Calculation logic lives in `server/src/routes/budget.ts`.
- **Transfers**: Linked via `transferTransactionId` on both transaction rows — deleting one side nulls the link on the other.
- **Custom reports**: Config stored as JSON blob in `custom_reports` table (same pattern as rules). Aggregation handled by a single flexible `GET /reports/custom` endpoint with dynamic SQL.
- **Shared chart helpers**: `CurrencyTooltip`, `ChartSkeleton`, `EmptyState`, `StatCardRow`, `EXPENSE_COLORS`, `monthLabel` live in `client/src/components/reports/ChartHelpers.tsx` — reuse these for any new chart work.
- **X-axis labels**: every Recharts `<XAxis>` uses `useXAxisLayout` (`client/src/hooks/useXAxisLayout.tsx`, logic in `utils/axisLayout.ts`). It measures the real label widths against the chart size and picks which labels to draw so they never overlap or get cut off: time axes skip labels evenly (`ordered: true`); category axes tilt and shorten names, or leave them to the tooltip when bars are too thin. Pass the plot `inset` (margin + y-axis width) and spread `axisProps` on the axis; don't set `interval`/`angle`/`tick` by hand.

### Shared UI components (`client/src/components/ui/`)

- `Modal` — portal-based, ESC closes, backdrop click closes, sizes: `sm | md | lg` (named export, not default)
- `ConfirmModal` — wraps Modal, `danger` prop for red confirm button
- `CurrencyInput` — displays formatted `$1,234.56`, stores/emits integer cents
- `Badge` — colored pill for account types and states

### Pages and routes

| Route                     | Page                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `/dashboard`              | Dashboard (at-a-glance financial overview — default landing page)                  |
| `/budget`                 | Budget (zero-based envelope view)                                                  |
| `/transactions`           | All transactions across all accounts                                               |
| `/accounts`               | Account overview cards                                                             |
| `/accounts/:id`           | Single account transaction list                                                    |
| `/accounts/:id/reconcile` | Account reconciliation flow                                                        |
| `/reports`                | Report dashboards (`?dashboard=<id>` picks the tab): movable grid of widgets       |
| `/reports/widget/:id`     | Full view of a built-in report widget (date range, CSV export, save to widget)     |
| `/reports/custom`         | Custom Report Builder (configurable chart type, grouping, filtering)               |
| `/reports/custom/:id`     | Saved custom report (loads saved config by ID)                                     |
| `/recurring`              | Recurring transactions (bills, subscriptions, recurring income)                    |
| `/payees`                 | Payees management                                                                  |
| `/rules`                  | Auto-categorization rules                                                          |
| `/settings`               | Settings (Categories, Account reorder, Data export/backup, Preferences)            |

### DB schema summary

> **Pending legacy cleanup:** migration `0011_unified_schedules` copied `recurring_transactions` into `schedules` but intentionally kept the old table and `transactions.recurring_transaction_id`. The drizzle snapshot still records them, so `db:generate` will propose dropping both — review that as its own migration rather than letting it ride along with unrelated schema changes.

- `accounts` — type: `checking | savings | credit | cash | investment`; `isOffBudget` excludes from budget calculations; `closedAt` for soft-delete; `logo` (nullable PNG/JPEG/WebP data URL, cropped client-side to 128px) replaces the colored initials in `AccountIcon`, which is hidden entirely when the "Account icons" preference is off
- `category_groups` — `isIncome=1` marks income groups (affects budget math and report filtering)
- `categories` — belong to a group; used as budget envelopes
- `transactions` — `payeeName` (denormalized string) + `payeeId` (FK, nullable); `reconciled=-1` means excluded from balance
- `budget_months` — one row per category per month; stores the `budgeted` amount
- `rules` — `conditions` and `actions` stored as JSON strings; ordered by `sortOrder`
- `auth_config` / `sessions` — server mode only: the scrypt password hash (single row, `id='server'`) and hashed session tokens
- `payees` — `defaultCategoryId` auto-applied when a payee is selected on a new transaction
- `custom_reports` — `name` + `config` (JSON string of `CustomReportConfig`); stores saved custom report configurations
- `dashboard_pages` / `dashboard_widgets` — report dashboards and their widgets (`type`, grid `x`/`y`/`width`/`height`, `meta` JSON). Pages have a `date_range` (null = last 6 months). Custom report widgets reference `custom_report_id` (cascade delete). Migrations `0014`/`0015` were hand-written because `db:generate` prompts about the pending legacy cleanup above
- `recurring_transactions` — `frequency` (`weekly|biweekly|semimonthly|monthly|quarterly|semiannually|yearly`); `status` (`active|paused|canceled`); `autoCreate` auto-creates transactions on server startup; linked to transactions via `recurringTransactionId` FK

### Custom Report Builder

The report builder at `/reports/custom` supports:

- **Chart types**: bar, stacked-bar, line, area, donut, table
- **Modes**: total (aggregated) or time (over months)
- **Group by**: category, category group, payee, account, month
- **Balance type**: expenses, income, net
- **Filters**: date range presets (1M/3M/6M/12M/YTD/Last Year/All/Custom), account selection, category tree selection
- **Save/load**: reports persist to DB and can be opened via `/reports/custom/:id`. Saving a new report also adds it to a dashboard (`?dashboard=<id>`, else the first one)
- **Live updates**: config changes debounced (300ms via `useDebounce`) and chart re-renders automatically

### Report Dashboards

`/reports` is a set of dashboards (tabs), each a grid of widgets.

- **Widgets**: built-in `summary`, `net-worth`, `income-expenses`, `spending`, `spending-trends` (charts in `components/reports/BuiltinCharts.tsx`, registry in `BuiltinReport.tsx`) plus `custom-report`. Add them from "Add widget"; ⋮ menu has rename, date range, freeze/unfreeze, move to another dashboard, remove (undoable).
- **Date ranges**: each dashboard has a range picker, and widgets follow it unless `meta.dateRange` gives them their own (a live preset, or frozen months). Unfreezing just removes `meta.dateRange`. `ReportDateRange` (`utils/dateRange.ts`) is live (preset recomputed from today by `resolveDateRange`) or frozen (`preset: 'custom'`); `widgetDateRange` picks a widget's effective range. Custom report widgets work the same way and pass their range to the builder as `?range=` (`encodeRangeParam`). Server validates ranges with `dateRangeSchema` in `services/dashboardService.ts`.
- **Layout**: `react-grid-layout` v2 (12 cols, 80px rows), drag/resize only in "Edit layout" mode on desktop; changed positions are saved on drag/resize stop (`PUT /api/dashboards/:id/layout`). Below 768px it's a single read-only column.
- **API**: `/api/dashboards` (pages CRUD, `GET/POST /:id/widgets`, `PUT /:id/layout`, `GET/PATCH/DELETE /widgets/:widgetId`). The first `GET` creates an "Overview" dashboard with the built-ins and all existing custom reports; the last dashboard can't be deleted.

### Recurring Transactions

The recurring page at `/recurring` pairs a month-at-a-glance view with an Actual Budget-style schedules table. Two tabs:

- **Monthly** — one card with month nav (← → Today), a List | Calendar toggle, and an Income / Expenses summary (remaining, paid of total, progress bar) computed client-side from occurrences. List view is split into Income and Expenses sections sorted by date; Calendar view shows name chips per day (clicking a day jumps to its rows).
- **All recurring** (Actual `SchedulesTable`-style) — searchable table: Name | Payee | Account | Next date | Status | Amount | Frequency | ⋮. Status follows Actual's `getStatus()` order (missed → due → upcoming within the upcoming length → scheduled). Canceled items hide behind a "Show canceled" row.

Shared pieces: `StatusBadge` (Actual color/icon scheme), `RowMenu` (⋮ portal menu), `scheduleFormat.ts` (`~` approx / `+` income amounts, upcoming-length helpers). Match suggestions render as a banner under the header (`MatchSuggestionsPanel`).

**Find recurring** (`DiscoverSchedulesModal`, `GET /api/schedules/discover`, `POST /api/schedules/discover/create`) — port of Actual's `find-schedules.ts` in `server/src/services/scheduleDiscovery.ts`. Per open account it scans weekly / every-2-weeks / monthly-on-day-X / monthly-last-day patterns, requiring 3 consecutive matches (same payee, ±2 days, amount within 7.5%), picks the best-ranked pattern per payee, then walks the start date back through history. Ignores transactions already linked to a schedule or occurrence, transfers, split children, and payees with a live schedule. Creating links past transactions to occurrences (paid) and marks unmatched past occurrences skipped; schedules get `source='detected'`.

**Upcoming length** (`UpcomingLengthModal`) — Actual's setting, stored as `upcomingLength` in `preferencesStore` (`'1'|'7'|'14'|'oneMonth'|'currentMonth'|'<n>-<day|week|month|year>'`, default `'7'`). Pending occurrences beyond the window show as "Scheduled" instead of "Upcoming" (`occurrenceBadgeStatus`).

Occurrence status is computed by cross-referencing `recurringTransactionId` on transactions within a 3-day window of expected date: `paid`, `paid_different` (amount differs), `upcoming`, or `overdue`.

Mark-as-paid creates a real transaction linked via `recurringTransactionId`. Auto-create (on server startup) creates transactions for items with `autoCreate=1` that are due today or earlier.

UI components live in `client/src/components/recurring/`. Occurrence computation utility: `server/src/utils/recurrence.ts` (also copied to `client/src/utils/recurrence.ts`).

### Dashboard

The dashboard at `/dashboard` (default landing page) has 8 widget components in `client/src/components/dashboard/`:

- `SummaryStats` — Net Worth, To Be Budgeted, Income, Expenses, Savings Rate
- `AccountsOverview` — accounts grouped by type with balances
- `BudgetProgress` — top 6 budget categories with progress bars
- `NetWorthMini` — compact 6-month area chart
- `IncomeExpensesMini` — compact 6-month bar chart
- `SpendingBreakdown` — category spending with colored percentage bars
- `UpcomingBills` — next 7 upcoming/overdue recurring bills within 30 days
- `RecentTransactions` — last 8 transactions

### Bank Sync (Plaid, SimpleFin)

The app integrates with **Plaid** for automatic bank transaction import. Plaid credentials are stored in the `plaid_config` SQLite table (entered via Settings → Connected Banks), not in environment variables.

We also integrate with **SimpleFin**, and may consider supporting other connections in the future!

**Architecture:**

- `server/src/services/plaidService.ts` — Plaid SDK wrapper (lazy-init client from DB credentials). Amount conversion: `Math.round(-plaidAmount * 100)` (Plaid positive=debit → app negative=outflow).
- `server/src/services/plaidSyncService.ts` — Sync orchestration: calls Plaid Transactions Sync API (cursor-based incremental), processes added/modified/removed transactions, adjusts account balances.
- `server/src/services/transactionHelpers.ts` — Shared `resolvePayee()` and `autoCategory()` (extracted from transactions route, used by both manual entry and Plaid sync).
- `server/src/routes/plaid.ts` — API endpoints under `/api/plaid` (status, configure, hosted-link start/poll/cancel, map-accounts, sync, items CRUD, per-item hosted-link for re-authentication).

**DB tables:**

- `plaid_config` — Single-row table for Plaid API credentials (clientId, secret, environment)
- `plaid_items` — One row per connected institution (accessToken, cursor, syncStatus, lastSyncedAt)
- `plaid_account_mappings` — Maps Plaid sub-accounts to local accounts (plaidAccountId → accountId)

**Sync behavior:**

- Runs on app startup (fire-and-forget) + manual "Sync Now" in settings
- Transactions get `importedId = 'plaid:' + plaidTransactionId` for dedup (same `importedId` column used by CSV import)
- Reconciled transactions are never modified/deleted by sync
- Account `startingBalance` is adjusted so `startingBalance + SUM(transactions) = Plaid reported balance`

**Plaid Link runs as [Hosted Link](https://plaid.com/docs/link/hosted-link/) in the user's own browser** (RFC 8252: native apps do bank/OAuth logins in the system browser, and OAuth banks like Chase can't finish in the locked-down Electron window). `services/plaidHostedLink.ts` keeps in-memory sessions: the UI gets an opaque session id plus Plaid's URL, polls `GET /api/plaid/hosted-link/:id`, and the server polls `/link/token/get` and exchanges the public token itself, exactly once (concurrent polls share one in-flight check). Link and public tokens never reach the UI. There is no `react-plaid-link`/in-app Link.

**Client components:** `client/src/components/plaid/` — `usePlaidHostedLink` hook + HostedLinkWaiting, ConnectBankModal (multi-step: link → account mapping → sync → done), ConnectedInstitutionCard, SyncStatusBadge, PlaidConfigForm.

---

## Commit Message Conventions

Use conventional commit prefixes:

| Type       | Description                                 |
| ---------- | ------------------------------------------- |
| `feat`     | Adds a new feature                          |
| `fix`      | Fixes a bug                                 |
| `docs`     | Documentation-only changes                  |
| `style`    | Formatting or styling changes               |
| `refactor` | Restructures code without changing behavior |
| `perf`     | Improves performance                        |
| `test`     | Adds or updates tests                       |
| `build`    | Changes the build system or dependencies    |
| `ci`       | Changes CI/CD configuration                 |
| `chore`    | General maintenance work                    |
| `revert`   | Reverts a previous commit                   |

---

## Future Considerations

- **Asset Tracking**: Car value tracking and house/real estate tracking for more accurate net worth calculations. Would need new account types or asset tables beyond the current financial account model.
- **Goal Tracking**: Save targets per category (e.g., "save $X by date Y").
