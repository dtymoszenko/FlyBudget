# AGENTS.md

This file provides guidance to AI coding agents (Codex and others) when working with code in this repository.

It mirrors `CLAUDE.md` (the same guide for Claude Code). When you change one, make the same change in the other.

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
npx vite --mode demo # the website's in-browser demo (server/src/browser/README.md)
```

**Server only:**

```bash
cd server
npm run dev          # tsx watch (hot reload)
npm run db:generate  # drizzle-kit generate (after schema changes)
npm run db:migrate   # drizzle-kit migrate (the server also applies pending migrations on startup)
npm run db:seed      # add default categories (also runs automatically on server startup for a new budget)
DB_PATH=demo.db npm run db:seed-demo  # the website demo's sample budget, in a new database
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

**Formatting** (Prettier, checked in CI):

```bash
npm run format        # from the root: format everything
npm run format:check
```

**Type checking:**

```bash
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit
```

**Tests** (Vitest + fast-check property-based tests, run in CI):

```bash
cd client && npm test   # src/**/*.test.ts — currency helpers, rule editor helpers, reconnect backoff
cd server && npm test   # src/**/*.test.ts — recurrence dates, rules engine
```

Tests are property-based: they assert invariants over hundreds of generated inputs rather than fixed examples. Server tests run with `DB_PATH=:memory:` (see `server/vitest.config.ts`) so they never touch `budget.db`. To search harder locally, temporarily set `fc.configureGlobal({ numRuns: 20000 })`.

**End-to-end tests** (Playwright, `e2e/`, run in CI):

```bash
cd e2e
npm ci && npx playwright install chromium   # once
npm test                                    # builds the client, starts two servers, runs everything
npm test -- --project=desktop               # just the desktop-app suite
npm test -- --project=phone                 # the desktop app at 390x844 (tests/phone)
npm test -- --project=demo                  # the website's in-browser demo (tests/demo)
E2E_SKIP_BUILD=1 npm test                   # reuse this checkout's last client builds (faster while writing tests)
E2E_PORT_BASE=3271 npm test                 # other ports, to run next to another checkout's run
npm run screenshots                         # the website's screenshots, from the demo (see website/README.md)
```

**Several runs on one machine** (one per git worktree): a run uses seven ports in a row from `E2E_PORT_BASE` (`e2e/ports.ts`; default 3171: desktop, server mode, control server, demo, the Enable Banking and Frankfurter mocks, and `screenshots.ts`), so give each checkout running at the same time its own base, at least seven apart (`E2E_PORT_BASE=3271 npm test`). Never write one of those ports as a number: import it from `ports.ts`. A run whose ports are taken stops before building, naming the ports (`assertPortsFree`). Every run leaves its client builds in the system temp directory under a name that includes a hash of the checkout's path (`buildCache` in `global-setup.ts`), which is what `E2E_SKIP_BUILD=1` reuses (rebuilt when it has no `index.html`: macOS empties old files in the temp directory), so one checkout never serves another's build. Two runs in the same checkout at once are not supported: they share `e2e/test-results` (each run empties it) and the build cache.

`global-setup.ts` starts FlyBudget twice on throwaway databases: **desktop** (configured like the Electron app: `--mode electron` client served by the API server, per-launch API token, credential encryption key; tests inject the preload's `__API_BASE__`) and **server-mode** (password login; the setup code is read from the server log). Desktop tests run one at a time and each starts from a snapshot of the fresh database, restored through `POST /api/export/restore`. Fixtures in `tests/fixtures.ts`: `api` seeds data over HTTP, `open(page, route)` uses hash routes, `typeAmount` types into currency fields, and a console guard fails any test whose page throws or logs `console.error` (opt out with an `allow-page-errors` annotation). Prefer role/label selectors; when a control has no accessible name, give it one in the app rather than reaching for CSS selectors. The **phone** project runs `tests/phone/` at 390x844 against the desktop server: it visits every page, saves `phone-*.png` screenshots (uploaded by CI as `phone-screenshots`), and fails if the document or any vertically scrolling area also scrolls sideways, or if content sticks out past the right edge (only boxes that scroll sideways on their own, like tab strips or `max-md:overflow-x-auto` table wrappers, may be wider). The **demo** project builds the client with `--mode demo`, serves it as static files under `/demo/` (like the website) and checks the sample budget, Start over, and that bank connections can't be set up.

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

- All amounts are stored and passed as **integer minor units of their account's currency** (cents: $12.34 → `1234`; yen have none, dinars three: `minorUnits` in `utils/currencies.ts`). Values in the budget's currency (budget, reports, totals across accounts) come from `mainAmount` (see Multiple currencies). Convert at UI boundaries only using `formatCurrency()`, `formatCentsAxis()`, `centsToInput()` and `parseCents()` in `client/src/utils/currency.ts`. They follow the per-device `amountFormat` (`dot` 1,234.56 / `comma` 1.234,56 / `space` 1 234,56 / `apostrophe` 1'234.56) and `symbolPosition` preferences, where `auto` is what the device language uses (`localeAmountStyle`). `auto` is the default for new installs only: preferences saved before the setting existed are migrated to `dot`/`before` (persist `version` + `migratePreferences` in `preferencesStore.ts`; bump `PREFERENCES_VERSION` and add a step for future changes). The one-argument helpers are safe as callbacks (Recharts `tickFormatter`, `map`); `formatAmount`/`parseAmount`/… take an explicit `AmountStyle` (tests, the Settings preview). `parseCents` is exact (no `parseFloat`, via `readTypedAmount` → `readImportAmount` with `directionWords: false`, so a symbol like `S/` after the amount never reads as a debit): with both `.` and `,` the last one is the decimal separator, and one `.` or `,` with one or two digits after it is too, so `12,50`, `12.50`, `1.234,56` and `1,234.56` work in every format. The user's symbol is ignored wherever it is. Text that isn't an amount is never saved as 0: `readTypedAmount` returns null and `isUnreadableAmount` marks the field (`aria-invalid`, `UNREADABLE_AMOUNT`), as `CurrencyInput`, the transaction form and the budget fields do. A dialog with `CurrencyInput`s wraps them in `<AmountFields report={report}>` and keeps Save disabled while `useAmountValidity().allValid` is false (`components/ui/amountValidity.tsx`), since the field keeps its previous amount; inside a `<form>` the browser also refuses to submit (`setCustomValidity`). Use `useAmountStyle()` where a component must re-render when the format changes.
- **Money inputs** are `type="text" inputMode="decimal"`, never `type="number"` (a number field rejects `12,50`), with `amountPlaceholder()` as the placeholder. In e2e tests they are `textbox`es.
- **Displayed dates** go through `client/src/utils/dates.ts` (`formatDay`, `formatDayLong`, `formatWeekday`, `formatShortDay`; `shortDayPattern` for chart axes), which follow the Date Format preference (day first: `5 Jan`, with dd.MM.yyyy `5. Jan`). Use `format(…)` from date-fns directly only for `yyyy-MM-dd` keys and month labels.
- **CSV exports** follow the number format: with a decimal comma, `;` between columns and `12,50` amounts (`GET /api/export/transactions/csv?decimal=comma`, `csvAmount`/`escapeCsv(value, separator)` in `routes/export.ts`; report CSVs through `downloadCsv` in `client/src/utils/exportCsv.ts`).
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
- **Server mode** (`FLYBUDGET_SERVER_MODE=true`, see `server/src/config.ts`): used by self-hosted installs. Settings come from env vars: `FLYBUDGET_HOST` (listen address, default `127.0.0.1`), `FLYBUDGET_ALLOWED_HOSTS`, `FLYBUDGET_TRUST_PROXY` (Express `trust proxy`, for HTTPS behind a reverse proxy) and `FLYBUDGET_DATA_KEY` / `FLYBUDGET_DATA_KEY_FILE` (required: the server refuses to start without an encryption key). The first visit shows a "set a password" screen (`AuthGate`) that also needs a one-time setup code printed to the server log (`server/src/auth/setupCode.ts`, in memory, new on each restart), so nobody else can claim a fresh server; after that every `/api` route except `/api/health` and `/api/auth/*` needs a session (`requireSession` in `server/src/routes/auth.ts`). Passwords are hashed with scrypt (`server/src/auth/password.ts`); sessions are random 256-bit tokens stored only as SHA-256 hashes in `sessions`, sent as the HttpOnly, SameSite=Strict `flybudget_session` cookie (Secure over HTTPS), and expire after 30 days. Login, setup and password changes are limited to 10 failed attempts per 15 minutes, per IP, or per trusted device for browsers that signed in before (`flybudget_device` cookie, an HMAC keyed by the password hash, path `/api/auth`), so nobody behind the same proxy or NAT can lock the owner out; changing the password voids device cookies and signs out every other session. A request with `X-Forwarded-For` while `FLYBUDGET_TRUST_PROXY` is unset logs a one-time warning (`proxyConfigWarning`). Settings → Server (server mode) has a security check, signed-in devices, change password and sign out. Signed-in devices: `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/sign-out-others` (each checks the session itself, since `/api/auth/*` skips `requireSession`). Sessions are listed by an opaque public id (`publicSessionId`: a hash of the stored hash), never by the stored id; `user_agent` (control characters stripped, 256 chars) and `last_used_at` (written at most every 5 minutes, `touchSession`) come from migration `0019`. Password hashing is serialized (~128 MB per scrypt hash). `hstsWhenSecure` adds HSTS for HTTPS requests in server mode.
- **`GET /api/health`** stays exactly `{"status":"ok"}`: anyone who can reach the server may call it (Docker health check, the Electron main process, reconnect pings), so it must never say anything else.
- **`GET /api/server/info`** (`routes/server.ts`) is under `requireSession`, so in server mode anonymous visitors get 401 (desktop/dev: the usual guards). It returns `mode` (`desktop` when `FLYBUDGET_API_TOKEN` is set, `server`, `dev`; `appMode` in `config.ts`), `version` (`utils/version.ts`: `FLYBUDGET_VERSION`, which the Dockerfile inlines with esbuild `--define` and Electron sets from `app.getVersion()`, else the root `package.json`) and, in server mode, `checks`: yes/no answers computed from the request by the pure `securityChecks` (HTTPS or same computer, `FLYBUDGET_TRUST_PROXY` set exactly when proxy headers arrive, `FLYBUDGET_ALLOWED_HOSTS` set, encryption key, password set). Never add secrets, keys, hashes, tokens or file paths to it; the UI turns warnings into hints that name the env var, never a value.
- **`securityHeaders`** (helmet): a strict CSP (only `'self'`: no third-party scripts, frames or connections), `nosniff`, no framing, `no-referrer`, same-origin CORP/COOP and COEP `require-corp`. **Loading anything from a new external origin means updating the CSP.** Fonts are self-hosted (`@fontsource/inter`), so the app never calls Google.
- **Electron window** (`electron/main.ts`): sandboxed, no Node in the page, DevTools only in dev, and every permission request denied. The window can't navigate away from the app, and `shell.openExternal` is only ever called with `https:` URLs (never pass it arbitrary URLs).
- **Credentials at rest**: `plaid_config.secret`, `plaid_items.access_token`, `simplefin_connections.access_url`, `enable_banking_config.private_key` and `enable_banking_connections.session_id` use the `encryptedText` column type (`server/src/db/schema.ts` → `secretCrypto.ts`, AES-256-GCM, stored as `enc:v1:…`). The desktop app keeps the key in `userData/credentials.key`, itself encrypted with Electron `safeStorage` (DPAPI/Keychain/libsecret), and passes it in as `FLYBUDGET_DATA_KEY`. Plaintext rows are encrypted on startup (`encryptStoredCredentials`). Plain `npm run dev` has no key and stores them unencrypted. Encrypted columns can't be used in `WHERE` clauses.
- **Outbound requests to user-supplied URLs** (SimpleFIN setup tokens and access URLs, a rate server chosen in Settings → Currencies) must go through `safeFetch` (`server/src/services/safeFetch.ts`): https only, public IPs only (checked at connect time, so DNS rebinding can't bypass it), manual redirects re-validated on every hop with `Authorization` dropped across origins, a 30s timeout, and capped response sizes. Never call `fetch` directly on such URLs.
- **Bank data is untrusted input**: SimpleFIN responses are validated with Zod (`parseSimplefinResponse`), amounts are converted to cents exactly (no `parseFloat`), and payee text is stripped of control characters and capped at 200 chars.
- **Plaid**: access tokens never leave the server. Disconnecting calls `/item/remove` to revoke the token at Plaid _before_ deleting it locally; if Plaid can't be reached, the connection is kept so the user can retry. Plaid calls time out after 30s. Only `sandbox` and `production` are valid environments (legacy `development` configs map to Sandbox).
- **Enable Banking**: the application's private key never leaves the server and is checked with `GET /application` before it's saved. The bank's redirect (`GET /api/enable-banking/callback`, `BANK_CALLBACK_PATH` / `isBankCallback` in `middleware/security.ts`) is the one route that skips `originGuard`, `apiTokenGuard` and `requireSession` (it's a cross-site navigation with no cookie or token): its only authority is the random, single-use `state` (`services/enableBankingAuth.ts`, 30 minutes, in memory), and it has its own rate limit (`bankCallbackRateLimit`). Keep it GET-only and doing nothing but receiving the code. User-started calls send `Psu-Ip-Address` (public addresses only) and `Psu-User-Agent` (`psuContext`), which exempts them from PSD2's ~4 unattended calls a day. Enable Banking errors answer 422/409, never 502-504 (the client reads those as FlyBudget's own server being down).
- **Rate limiting**: mutating `/api/plaid`, `/api/simplefin` and `/api/enable-banking` requests are limited to 20/minute (`bankRateLimit`); GETs are not limited.
- **Errors**: `errorHandler` (registered last in `startServer`) returns generic JSON errors and logs details server-side; never send `err.stack` or raw exception messages to the client. Unknown `/api` routes get a JSON 404. Request bodies are capped at 10 MB.
- **Backup / restore**: `services/backupService.ts`. `GET /api/export/backup` (version 3) includes every data table (`BACKUP_TABLES`; add new tables there, including `budget_settings` and `exchange_rates`) but never bank credentials, the password or sessions. A backup from before currencies (no `budgetSettings`) keeps the budget's currency. `POST /api/export/restore` validates every column's type against the schema, saves `budget-before-restore-<time>.db` next to the database, then replaces everything in one transaction (foreign keys deferred to commit) and re-links bank connections to their accounts. It parses its own body (250 MB) after the login check; `index.ts` skips the 10 MB parser for that path.
- **CSV export**: `escapeCsv` prefixes cells starting with `=`, `+`, `-`, `@`, tab or CR with `'` (CSV formula injection: payee names come from banks and merchants). Use it for every text cell.
- **Validation**: dates must be real `YYYY-MM-DD` dates (`isoDate`), recurrence rules are typed (a zero interval would loop forever), imported rows are capped at 100k, and rule regexes must compile and be at most 200 characters.
- **Packaging** (`electron-builder.json`): the app ships in `app.asar` with embedded integrity validation (a modified file makes the app refuse to start), and Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`. `better-sqlite3` is unpacked from the asar because it's a native module (its npm package ships prebuilds for every platform, so one checkout builds any of them). The app icons live in `electron/resources/` (tracked; `build/` is gitignored): `icon.ico` for Windows, `icon-1024.png` for macOS, and `linux/` (the same logo at 16-512px) for Linux, since the hicolor icon theme has no 1024px folder and a lone 1024px icon shows as a generic one. Targets: Windows NSIS (x64), macOS dmg (arm64 + x64, ad-hoc signed: Apple silicon won't run unsigned apps), Linux AppImage + deb (x64 + arm64). macOS gets a minimal app/Edit/Window menu (its copy, paste and quit shortcuts only work through menu items); Windows and Linux have none. `.github/workflows/release.yml` builds each on its own runner, starts every packaged app and waits for `/api/health`, attests the files and publishes them with `SHA256SUMS.txt` on `v*` tags. File names have no version (`FlyBudget-Windows-Setup.exe`, `FlyBudget-macOS-arm64.dmg`, …) so `website/src/pages/download.tsx` links to `releases/latest/download/<file>`: keep the two in sync.

### In-browser demo (website "Try the demo")

The website serves the real app at `/demo/` with a sample budget and no server: `vite build --mode demo` (`IS_DEMO` in `client/src/demo/isDemo.ts`) sends every `/api` fetch to a Web Worker that runs the server's own routes on sql.js (SQLite in WebAssembly), with stand-ins for Express, the database module, credential encryption and `path` (`server/src/browser/`, see its README). Each visitor gets a private copy that's gone when the tab closes; `DemoBanner` offers Back to home (the website's homepage), Start over and Download. Bank connections (Plaid/SimpleFIN/Enable Banking) and sign-in are refused by the worker and replaced by `NotInDemo` in the app; CSV import and backups work (they stay in the tab). Preferences go to `sessionStorage` in the demo and "Start over" resets them. The demo page has the app's strict CSP in a `<meta>` tag (`demoPage` in `client/vite.config.ts`), and `website/static/_headers` sends it as a header with `frame-ancestors 'none'` (keep both in sync); the e2e tests check that no request leaves `/demo/`. `website/scripts/build-demo.mjs` builds it into `website/static/demo/` before `docusaurus build`.

- **Mount new routers in `server/src/browser/app.ts`** as well as `index.ts`, and keep Node-only code (files, `crypto`, network) out of the route modules the demo loads; a `--mode demo` build warns about any Node module it had to leave out. New Express features in routes need the same in `expressShim.ts`.
- **The sample budget** is `server/src/demo/demoBudget.ts`: a couple on a median income, 18 months ending today, every feature in use (in US dollars, with a euro account for their trip, daily ECB-like rates from a seeded random walk, and values set with the pure `mainAmountFor`). Pure and deterministic (a seeded random generator, readable ids, dates from `today`), loaded by `loadDemoBudget.ts` (which uses the schedule services to create and link occurrences). Every account and payee has a logo (`logos.ts`, drawn by `client/scripts/generate-demo-logos.mjs`). When you add a feature, show it there too, leanly; `demoBudget.test.ts` checks it still adds up for any day.

### Connection layer (never lock users out)

- `client/src/store/connectionStore.ts` tracks whether the server is reachable. `apiFetch` reports every request: a network failure (fetch throws, other than an abort) or a gateway error (502-504, or a non-JSON 500 from the Vite dev proxy while `tsx watch` restarts) throws `NetworkError` and switches to `reconnecting`; any real answer, including 401 and JSON errors, switches back to `connected`. A 401 still fires `AUTH_REQUIRED_EVENT` (login screen), never "disconnected".
- While reconnecting it pings **only** `GET /api/health` on `API_BASE` (`api/base.ts`: the desktop app's own server, never any other), with backoff 2s, 4s, 8s, 16s, then every 30s (`retryDelayMs` in `utils/connection.ts`), paused while the tab is hidden, and immediately on the browser `online` event, on returning to the tab, or "Try now"/"Retry now". Retries never touch `/api/auth/*` (the login routes are rate limited).
- `AuthGate` opens the app with the **offline copy** when the startup auth-status request can't reach the server (or is still waiting), and shows `ReconnectScreen` only when there is no copy (desktop: "FlyBudget is starting up again"; self-hosted: the host plus Docker troubleshooting; dev: `npm run dev`). When the connection comes back it invalidates every query, so the app loads (or refreshes) without a page reload.
- Mid-session, `ConnectionBanner` (top of `AppShell`) says saving is paused and counts down; cached TanStack data stays on screen. Offline never fakes a save: primary save actions check `useCanSave()` (`hooks/useConnection.ts`) and show `<SavingPausedHint />` (account dialogs, budget amounts, CSV import, rules, recurring). Use both for new save buttons. The one exception is adding a transaction (below).
- `ServerStatus` (sidebar footer, `components/layout/`) shows where the data lives ("On this computer" or the server's host) with a green/amber dot; its menu (`role="menu"`) has status, address, whether the connection is encrypted, version (from `/api/server/info`), Server settings and, in server mode, Sign out. The client's mode comes from `useAppMode()` (`__API_BASE__` = desktop, auth status `enabled` = server).
- Settings → Server exists in every mode (`?tab=server`; the Settings tab lives in the URL). Desktop/dev: where the data lives and a link to the self-hosting guide. The sign-in screen shows the server address and warns when the password would go over plain HTTP to another machine.
- **Offline copy** (`offline/snapshot.ts`, dev and server mode; not the desktop app, whose server lives inside it): the TanStack cache is saved to IndexedDB (`offline/storage.ts`) 1.5s after data loads, only while connected and signed in, and only budget data (`OFFLINE_QUERY_KEYS` in `utils/offline.ts`: never auth status, signed-in devices, server info or bank connections). `main.tsx` restores it before the first render (so starts are instant too); copies older than 30 days or from another `SNAPSHOT_VERSION` are ignored. Each save merges with the previous copy (`mergeSavedQueries`: what's loaded now first, then earlier pages newest first, at most `MAX_SAVED_QUERIES`), since TanStack forgets unused pages after 5 minutes. It's deleted on sign-out, on any 401 / login-required status, and when "Keep a copy of my budget on this device" (Settings → Server, `keepOfflineCopy` preference, default on) is turned off. The banner says how old the data on screen is (`shownDataAsOf`: the oldest active answer, since a page from an earlier save can be older than the rest).
- **Service worker** (`client/public/sw.js`, registered in `main.tsx` for the built web app only: not dev, not Electron): on a self-hosted install the same server serves the page, so without it the browser couldn't even load the app while the server is down. It saves the page, the `/assets/` files it loads and the fonts at install; pages are network-first with a 4s timeout, then the saved page; hashed `/assets/` files are cache-first (at most 150 kept). It never touches `/api` or other origins, so no budget data is in it. Browsers only run it on https:// and localhost (plain-HTTP LAN installs get the offline copy in an open tab only).
- **Waiting transactions** (`offline/outbox.ts`): offline, new transactions and transfers are kept on the device and sent in order when the server is back (`OutboxSender` in `AuthGate`), and edits, deletes and budget changes still wait for the connection, so nothing another device changed is overwritten. Every new transaction gets a device-chosen id (`newClientId`, 16-64 of `[A-Za-z0-9_-]`); `POST /transactions` and `/transactions/transfer` return the existing row (200) when that id already exists, so a resend never duplicates, and a save that fails with `NetworkError` mid-request is queued with the same id. Use `useAddTransaction()` (`hooks/useOffline.ts`) for new-transaction buttons. List changes are atomic single IndexedDB transactions (safe across tabs), sending is serialized with Web Locks when available, and other tabs reload on a `BroadcastChannel` message. Offline (NetworkError), 401, 429 and 5xx stop sending until later; other refusals mark the item with its error for Try again / Discard in `WaitingTransactions` (top of the register). Signing out deletes waiting transactions too.
- E2E: `tests/serverControl.ts` stops and restarts the desktop test server through a token-protected control server in `global-setup.ts` (127.0.0.1, `CONTROL_PORT`); always restart it in a `finally`.

### Key conventions

- **API layer**: `client/src/api/` contains thin fetch wrappers using `apiFetch` from `./client`. Types come from `client/src/types/index.ts`.
- **Route validation**: Server routes validate request bodies with Zod before touching the DB. Dates use `isoDate` / `isoMonth` from `server/src/utils/validation.ts` (checked against the calendar: `2024-13-45` passes a regex but breaks date math). Report ranges are validated and capped (`monthRangeParams` in `routes/reports.ts`).
- **Update schemas**: never build a PUT schema with `createSchema.partial()` when the create schema has `.default()`s: Zod 4 still applies defaults inside `.partial()`, so every field the client didn't send gets reset. Define the fields once without defaults, add the defaults for create only, and `.partial()` the plain version (see `routes/rules.ts`, `accounts.ts`, `schedules.ts`).
- **Splits**: the parent row holds the full amount and the child rows hold the parts, all in the same account. Account balances and net worth count everything except children (`inAccountBalance` / `accountTransactionSum` in `services/balances.ts`); category and spending totals count everything except parents (`isParent = 0`). Editing a parent's date/payee/account moves its children too; its amount can't change on its own.
- **Rules engine**: pure logic in `server/src/services/rulesEngine.ts` (types, matching, actions, split math), database side in `ruleService.ts`. Rules are stored as JSON `conditions` and `actions` in the `rules` table, plus `conditions_op` (`and` = all match, `or` = any) and `enabled`. Rules saved in the original format (`{field, op: 'exact'}` conditions, `{field: 'category_id'}` actions) are converted on read (`normalizeConditions` / `normalizeActions`); never write that format.
  - **Conditions**: text fields `payee_name`, `imported_payee` (raw bank/CSV text, falls back to the payee name), `notes` with `is`/`is_not`/`contains`/`not_contains`/`starts_with`/`ends_with`/`regex`/`one_of`/`not_one_of`/`is_empty`/`is_not_empty` (case-insensitive); id fields `payee`/`account`/`category` with `is`/`is_not`/`one_of`/`not_one_of`/`is_empty`/`is_not_empty`; `amount` (absolute cents: `is`/`is_not`/`gt`/`gte`/`lt`/`lte`/`between`/`approx` ±7.5%); `direction` (`inflow`/`outflow`); `date` (`is`/`before`/`after`/`between`).
  - **Actions**: `set_category`, `set_payee` (also sets `payeeName`), `set_notes`, `prepend_notes`, `append_notes`, `split` (parts are `fixed` cents, `percent`, or `remainder`; leftover with no remainder part becomes an uncategorized child; `computeSplitAmounts` always sums to the total).
  - **Order**: every enabled matching rule applies, top to bottom, each seeing the changes of the rules above it (rename, then categorize the new name). A field set by a higher rule is never overwritten by a lower one; prepend/append stack. Actions pointing at deleted payees/categories are skipped.
  - **New transactions** all go through `insertNewTransaction` (manual add, CSV import, Plaid, SimpleFIN). Payees are created only after rules run (no junk payees from renamed bank text); the payee's `defaultCategoryId` applies if no rule set a category. Manual entries keep a category/notes the user typed (`keepUserCategory`/`keepUserNotes`).
  - **Existing transactions**: `POST /rules/preview` (dry run) and `POST /rules/apply` (only the ticked `transactionIds`, recomputed server-side) for every enabled rule or given `ruleIds`, scope `uncategorized` or `all`. Reconciled, transfer and split transactions are never touched. Running every rule also fills payee default categories.
  - **UI**: `components/rules/` (`RuleEditorModal` with live match preview via `POST /rules/test`, `ApplyRulesModal`, `RuleEditorFlow` = save then optionally apply), labels/summaries in `utils/ruleFormat.ts`. "Create rule" in the transaction detail panel prefills payee → category.
- **Importing files** (`components/transactions/ImportModal.tsx`, pure parsing in `client/src/utils/csv.ts` and `camt.ts`): CSV with the separator, encoding, rows above the header, date order (`mdy`/`dmy`/`ymd` for two-digit years first) and decimal format (`dot`/`comma`) detected from the file, an optional direction column (Af/Bij, Debit/Credit) and the user's own "money out" word; CAMT.053/052/054 XML statements (booked entries only, booking date, batches split only when the parts add up, ids from the bank's `AcctSvcrRef`). Never guess: when a file could be read two ways the dialog asks. Rows come from the pure `buildImportRows` (`csv.ts`): every row is imported or returned as a `SkippedRow` (unreadable date, amount or direction, or zero), listed in the preview. Each account remembers its CSV settings (`import_settings`), used again when a file has the same columns; the file's own evidence still wins over them. The same column also keeps the last CAMT statement's account number (`statementAccount`, saved on its own with `PUT /accounts/:id/statement-account`; each save keeps the other part), and the preview warns when a statement is for another account.
- **Budget math**: `To Be Budgeted = income received + prior month carry-over − total budgeted`. Category balance = `budgeted + carry-over − spent`. Only on-budget accounts count. Calculation logic lives in `server/src/routes/budget.ts`.
- **Multiple currencies**: the budget has one currency (`budget_settings.currency`, null = not chosen: amounts show the device's `currencySymbol` preference, as before), each account may have its own (`accounts.currency`, null = the budget's; `effectiveCurrency`/`isForeign` in `utils/currencies.ts`). A transaction keeps `amount` in its account's currency plus, in a foreign account, `main_amount` in the budget's with `main_amount_source`: `rate` (the day's rate), `manual` (typed in: "Value in EUR" in the detail panel, `PUT /transactions/:id { mainAmount }`), `transfer` (minus the other side's value, so a pair always nets to 0 in the budget currency and a transfer is never income or spending) or `missing` (no rate within `RATE_MAX_AGE_DAYS` (31) before its day: counts as 0 and is shown, never as rate 1). Migration `0024` (hand-written) adds this, `exchange_rates` (decimal-string rates, ids `source:date:base:quote`, `ecb`/`manual`; manual wins on its day) and currency on the Plaid/SimpleFIN mappings.
  - **Pure logic**: `utils/currencies.ts` (ISO 4217 codes and minor units) and `utils/money.ts` (BigInt rates: `parseRate`, `convertMinor` rounding once halves away from zero, `decimalToMinor` for bank amounts, `allocate` for split parts) are **identical copies in client and server** (`currencies.test.ts` checks); `services/exchangeRates.ts` (`buildRateBook().find`: direct, inverse, then through EUR, closest earlier day) and `services/mainAmounts.ts` (`mainAmountFor`, `transferMainAmounts`). Property tests next to each.
  - **Database side**: `services/mainAmountService.ts`. Every write that creates or changes a transaction's amount, date or account sets its value: `insertNewTransaction` does (pass `currencies: currencyContext()` with `rules`/`ctx` for bulk inserts), everything else calls `refreshMainAmounts([id])` afterwards (it includes a transfer's other side and a split's parts; `keepManual: false` when the amount itself changed). `fillMissingMainAmounts` runs on startup, after a rate is added or downloaded and after a restore; it never touches `rate`/`manual`/`transfer` values. "Recalculate from rates" (`recalculateMainAmounts`) redoes `rate` ones only. Don't nest `db.transaction` around it in new code paths that the demo runs (sql.js can't nest transactions; `refreshMainAmounts` opens none).
  - **Queries**: budget and report sums use the `mainAmount` SQL expression from `services/balances.ts`; per-account sums (balances, reconcile) use `amount`. Net worth and the recurring summary convert balances at each period's rate (`valueToday`) and name what they couldn't (`unconverted`). `GET /accounts` returns the effective `currency`, `mainBalance` (null without a rate), `rateDate`, `hasTransactions` and `currencyDifference` (value today − `bookedValue`); client totals add `balanceValue` (`utils/accountMoney.ts`) and show `UnconvertedNote`.
  - **Transfers between currencies**: `POST /transactions/transfer` takes `toAmount` (left out: the day's rate, 422 without one); editing one side never copies its amount to the other; `linkTransfer` only needs opposite signs; matching (`transferMatching.ts`) pairs other currencies by value within `CROSS_CURRENCY_TOLERANCE` (3%).
  - **Rules for changes**: an account's currency can't change once it has transactions (409); the budget's can be corrected (`PUT /api/currency`) while no account in another currency has history (relabel, nothing converted). "Record currency difference" (`POST /api/currency/difference`) adds an `is_adjustment` row with amount 0 and a `manual` value; never automatic.
  - **Rates**: `routes/currency.ts` (`/api/currency`: settings, manual rates, convert, recalculate, missing, difference; mounted in `browser/app.ts` too) has no network code: `index.ts` plugs in `rateFetchService.ts` with `setRateDownloader`. Downloading is opt-in (`rates_enabled`), from Frankfurter (`DEFAULT_RATES_URL`, ECB rates, `/currencies` then yearly time series for the currencies in use), through `safeFetch` for a URL chosen in Settings; `FLYBUDGET_EXCHANGE_RATES_URL` (operator/tests, plain fetch: a LAN Frankfurter or `e2e/mockFrankfurter.ts`). Runs on startup and every 6 hours, at most every 12 (`RATES_REFRESH_MS`). The demo refuses turning it on.
  - **Client**: the budget currency lives in `store/currencyStore.ts` (synced from `GET /api/currency` by `useBudgetCurrencySync` in `AuthGate`, key `currency` in `OFFLINE_QUERY_KEYS`), so the one-argument `formatCurrency`/`parseCents` stay in the budget currency. An account's own amounts use `formatMoney(amount, currency)`, `useAmountStyle(currency)`, `CurrencyInput currency=…` and `useAccountCurrency()`. `currencyAmountStyle` takes separators from `amountFormat` and, per currency, the symbol (`currencySymbol`: the narrow one unless shared, then US$/CA$/SEK) and side and spacing as written at home (`currencyConvention`: the device's locale when its region uses the currency, else the currency's country: `1 234,56 zł`, `$1,234.56`, `CHF 1'234.56`); a symbol ending in a letter always gets a space (`USD 1,234.56` where the device writes the code, #151); the `symbolPosition` preference applies to the budget currency, `currencyStyles` (Settings → Currencies) overrides any. Typed amounts use the currency's decimals (`readTypedAmount`: `12.5` yen is unreadable, `1.234` yen is grouping). UI pieces in `components/currency/` (`CurrencySelect`, `ForeignValue`, `MainAmountField`, `MissingRatesBanner`, `CurrencyDifference`, `UnconvertedNote`) and `components/settings/CurrencySettings.tsx` (`?tab=currencies`).
  - **Bank sync and files**: accounts created from a bank get its currency (`bankCurrency`, `currencyToStore`: the budget adopts the first currency an account gets); amounts are read in the bank account's minor units (Enable Banking `signedCents(…, minor)`, SimpleFIN, Plaid `plaidAmountToCents(…, minor)`), transactions in another currency than the bank account are skipped (Enable Banking and Plaid), and `pickBalance` ignores balances in another currency. CAMT reads `Ccy` (`CamtStatement.currency`, amounts in its decimals, an instructed amount in another currency is never used) and the import dialog warns about a statement in another currency; CSV rows use the account's decimals (`ImportFormats.minor`). The transaction CSV export adds `Currency` and `Amount (<budget>)` once there are accounts in more than one.
- **Transfers**: Linked via `transferTransactionId` on both transaction rows — deleting one side nulls the link on the other, and editing one side's date or amount updates the other. Deleting any transaction goes through `deleteTransactionRow` (`services/transactionHelpers.ts`), which also removes split parts and reopens a schedule occurrence it paid.
  - **Existing transactions as transfers** (issue #89: bank imports bring both sides in as ordinary rows): every category picker for a transaction (add forms, register row, detail panel) ends with `Transfer: <account>` (value `transfer:<accountId>`), in the Add dialog even before its account is chosen. On an existing row it calls `POST /transactions/:id/transfer`, which links the matching row in that account or creates the other side. Matching is pure in `services/transferMatching.ts` (same amount the other way, another account, within `TRANSFER_MATCH_DAYS` (5), closest date wins, each row used once); the database side is `services/transferService.ts` (eligible rows: open account, unreconciled, not split, not an adjustment, not already a transfer). `GET /transactions/transfers/suggestions` feeds `TransferSuggestions` above the register (review and link; never linked automatically, since a wrong link silently drops spending). "Not a transfer" (`POST /:id/unlink-transfer`, or dismissing a suggestion) records the pair in `transfer_match_dismissals` (id = `pairKey`, migration `0021`, hand-written) so it isn't suggested again; linking keeps the bank text in `imported_payee` and unlinking restores it as the payee. Client hooks in `hooks/useTransfers.ts` (query key under `['transactions']`, so every transaction change refreshes suggestions; undo supported). Unlinking, deleting one side, and a bank sync changing one side's amount (`syncedTransferChange`: a side that wasn't imported follows the date and amount, two imported sides are unlinked, a reconciled side keeps the pair's amount) all go back to the bank's payee through `restoreBankPayee` (`services/transactionHelpers.ts`).
- **Custom reports**: Config stored as JSON blob in `custom_reports` table (same pattern as rules). Aggregation handled by a single flexible `GET /reports/custom` endpoint with dynamic SQL.
- **Shared chart helpers**: `CurrencyTooltip`, `ChartSkeleton`, `EmptyState` (the chart version: message plus a hint), `StatCardRow`, `EXPENSE_COLORS`, `monthLabel` live in `client/src/components/reports/ChartHelpers.tsx` — reuse these for any new chart work.
- **X-axis labels**: every Recharts `<XAxis>` uses `useXAxisLayout` (`client/src/hooks/useXAxisLayout.tsx`, logic in `utils/axisLayout.ts`). It measures the real label widths against the chart size and picks which labels to draw so they never overlap or get cut off: time axes skip labels evenly (`ordered: true`); category axes tilt and shorten names, or leave them to the tooltip when bars are too thin. Pass the plot `inset` (margin + y-axis width) and spread `axisProps` on the axis; don't set `interval`/`angle`/`tick` by hand.
- **Zoomed Y axes**: `valueAxis` (`client/src/utils/valueAxis.ts`) gives a `domain` + round `ticks` fitted to the data instead of starting at $0, for line charts where the change matters (the Net Worth report). Never use it for bars: a bar's height is its value, so bar axes must include 0.

### Phones (below 768px)

- `useIsPhone()` (`hooks/useIsPhone.ts`, `max-width: 767px`, Tailwind's `md`) switches `AppShell` to `PhoneShell`: a top bar with a menu button (`aria-expanded`, `aria-controls="app-sidebar"`) and the sidebar as a slide-out drawer (`SidebarDrawer`). The drawer is `inert` and `invisible` when closed; opening it moves focus in and makes the page behind inert; Escape, the backdrop or "Close menu" close it and return focus to the menu button; following a link closes it. Desktop keeps the normal sidebar (`Sidebar`/`SidebarContent`).
- Phone-only tweaks use `max-md:` classes so desktop is untouched: headers wrap (`flex-wrap`), the Settings tab strip scrolls sideways, wide tables sit in a `max-md:overflow-x-auto` wrapper, the budget summary and report builder stack.
- Lists become cards on phones (switch with `useIsPhone()`, desktop keeps the tables): the register (`TransactionCard`; tapping opens `TransactionDetailPanel`, which is full screen on phones), the budget (`components/budget/PhoneBudget.tsx`: collapsible groups, inactive categories behind a toggle, planned amounts edited in `BudgetAmountSheet`), payees and rules (actions in a `RowMenu`; rules move up/down instead of dragging). Budget actual/remaining math is shared by the table and the cards in `utils/budgetFigures.ts`.
- Adding a transaction on a phone opens `TransactionFormRow` with `layout="sheet"` in a `Modal` (one field per row); `PayeeCombobox`/`CategorySelect` take `fieldClassName` for the larger fields.
- Touch targets are at least 44px on phones (`max-md:min-h-11`, plus `max-md:min-w-11` for icon buttons): `Button`, `RowMenu`, modal close buttons, month navigation, the sidebar and filter tabs. Give new icon buttons the same. Inputs, selects and textareas are at least 16px (an unlayered rule in `index.css`) so iOS doesn't zoom in.
- E2E: `tests/phone/phone-native.spec.ts` covers the cards, sheets and 44px controls (`expectTouchSize`, `expectBottomSheet`).
- **Forms never reset because data refreshed**: fill a dialog's fields once per opening with `useFormReset(openKey, reset)` (`hooks/useFormReset.ts`), never from an effect that depends on query data or the record being edited (payees, accounts and records refetch on window focus, syncs, or after creating a payee/category, and would wipe what the user typed). Values that load later fill only empty fields, once. `Button` defaults to `type="button"`; give plain `<button>`s inside pickers `type="button"` too, or they submit the surrounding form.
- Don't default query data to a fresh `[]` (`data: x = []`) when an effect copies it into state: a new array each render re-runs the effect forever while loading (React error #185). Use a module-level constant (`NO_RULES` in `pages/Rules.tsx`).

### Shared UI components (`client/src/components/ui/`)

- `Modal` — portal-based, ESC closes, backdrop click closes, sizes: `sm | md | lg` (named export, not default). On phones it's a bottom sheet (full width, slides up, safe-area padding)
- `RowMenu` — ⋮ portal menu (`items` with `label`/`onClick`/`danger`/`hidden`; `label` names the trigger for screen readers), taller items on phones
- `Button` — `primary | secondary | ghost | danger`, sizes `sm | md`, never wraps, at least 44px tall on phones
- `ConfirmModal` — wraps Modal, `danger` prop for red confirm button
- `CurrencyInput` — displays formatted `$1,234.56`, stores/emits integer cents
- `Badge` — colored pill for account types and states
- `ButtonLink` (in `Button.tsx`) — a router `Link` styled like `Button`, for buttons that go to another page
- `EmptyState` — icon, title, description, actions and an optional "Learn more" link to the user guide (`compact` inside cards). Use it whenever a page or card has nothing to show: say what goes there and offer the first step, never just "No data"
- `ExternalLink` — opens outside the app (new tab / system browser in Electron) with `rel="noopener noreferrer"`

**First run and empty states**: a new budget opens on `/welcome` (add an account, SimpleFIN or Plaid; "Skip for now" sets the persisted `setupSkipped` preference). Buttons on empty states can open a page's add dialog with `?add=1` (or `?import=1` on an account page) via `useOpenFromLink` (`hooks/useOpenFromLink.ts`): `/transactions`, `/accounts`, `/accounts/:id`, `/recurring`, `/rules`. Links to the user guide use `docsUrl(page)` from `utils/project.ts`; the pages live in `website/docs/`, so keep their file names in sync. The guide (`website/docs/`) explains every feature in detail and the tour (`website/tour/`) is a short overview of each page with a screenshot; when a feature changes, update its guide page, and retake affected screenshots with `e2e/screenshots.ts` (it takes each one in the light and dark theme; pages show them with `<Screenshot name=… />`, which follows the website's theme, never a Markdown image or `<img>`).

### Pages and routes

| Route                     | Page                                                                         |
| ------------------------- | ---------------------------------------------------------------------------- |
| `/welcome`                | First-run setup (shown while there are no accounts, until "Skip for now")    |
| `/dashboard`              | Dashboard (at-a-glance financial overview — default landing page)            |
| `/budget`                 | Budget (zero-based envelope view)                                            |
| `/budget/category/:id`    | One category: budget history and its transactions                            |
| `/transactions`           | All transactions across all accounts                                         |
| `/accounts`               | Account overview cards                                                       |
| `/accounts/:id`           | Single account transaction list                                              |
| `/accounts/:id/reconcile` | Account reconciliation flow                                                  |
| `/reports`                | Report dashboards (`?dashboard=<id>` picks the tab): movable grid of widgets |
| `/reports/widget/:id`     | Full view of a built-in report widget (stats, chart, breakdown table, save)  |
| `/reports/custom`         | Custom Report Builder (configurable chart type, grouping, filtering)         |
| `/reports/custom/:id`     | Saved custom report (loads saved config by ID)                               |
| `/recurring`              | Recurring transactions (bills, subscriptions, recurring income)              |
| `/cash-flow`              | Cash flow diagram (income sources to spending)                               |
| `/goals`                  | Savings goals                                                                |
| `/payees`                 | Payees management                                                            |
| `/rules`                  | Auto-categorization rules                                                    |
| `/settings`               | Settings (Categories, Account reorder, Data export/backup, Preferences)      |

### DB schema summary

> **Pending legacy cleanup:** migration `0011_unified_schedules` copied `recurring_transactions` into `schedules` but intentionally kept the old table and `transactions.recurring_transaction_id`. The drizzle snapshot still records them, so `db:generate` will propose dropping both — review that as its own migration rather than letting it ride along with unrelated schema changes.

- `budget_settings` / `exchange_rates` — the budget's currency and rate download settings (single row `id='budget'`) and stored rates (migration `0024`, hand-written; see Multiple currencies)
- `accounts` — `type` is one of 17 types in six groups (cash: `checking`/`savings`/`cash`; credit: `credit`/`line_of_credit`; investments: `investment`/`retirement`/`crypto`; property: `real_estate`/`vehicle`/`valuables`; loans: `mortgage`/`auto_loan`/`student_loan`/`loan`; other: `other_asset`/`other_liability`). The list lives in `server/src/utils/accountTypes.ts` and `ACCOUNT_TYPES` in `client/src/types/index.ts` (keep them in sync; helpers in `client/src/utils/accountTypes.ts`). Liability types hold negative balances and count as liabilities in net worth; only cash and credit types default to on budget. Non-spending accounts get an "Update value" button (`UpdateValueModal`) that adds a dated adjustment transaction; `isOffBudget` excludes from budget calculations; `closedAt` for soft-delete; `logo` (nullable PNG/JPEG/WebP data URL, cropped client-side to 128px) replaces the colored initials in `AccountIcon`, which is hidden entirely when the "Account icons" preference is off; `currency` (ISO 4217, null = the budget's; can't change once it has transactions); `import_settings` (migration `0022`, hand-written) is the last CSV import's settings as JSON (`ImportSettings`, validated by `server/src/utils/importSettings.ts`, `GET`/`PUT /accounts/:id/import-settings`)
- `category_groups` — `isIncome=1` marks income groups (affects budget math and report filtering)
- `categories` — belong to a group; used as budget envelopes
- `transactions` — `payeeName` (denormalized string) + `payeeId` (FK, nullable). `is_adjustment` (migration `0020`, hand-written) marks balance corrections (reconciliation, "Update value"; sent as `adjustment: true`): rules don't touch them, and while uncategorized they're left out of income and spending reports (`isIncomeOrSpending` in `services/balances.ts`) but still count in balances and net worth
- `budget_months` — one row per category per month; stores the `budgeted` amount
- `rules` — `conditions` and `actions` stored as JSON strings, `conditions_op` (`and`/`or`), `enabled`; ordered by `sortOrder`. `transactions.imported_payee` keeps the raw bank/CSV payee text for rules (migration `0017`)
- `auth_config` / `sessions` — server mode only: the scrypt password hash (single row, `id='server'`) and hashed session tokens (plus `user_agent` / `last_used_at` for the signed-in devices list, migration `0019`, hand-written like `0014`/`0015`)
- `enable_banking_config` / `enable_banking_connections` / `enable_banking_account_mappings` — Enable Banking's application (single row `id='default'`), bank logins (encrypted `session_id`, `valid_until`, sync status) and where each bank account goes (`account_uid` changes per session; `identification_hash` and `iban` find it again; `last_booked_date` for the next sync's start). Migration `0023`, hand-written. Not in backups; restore re-links the mappings
- `payees` — `defaultCategoryId` auto-applied when a payee is selected on a new transaction; `logo` (same format as account logos) replaces the colored initial in `PayeeIcon`. Pass `onLogoChange` to make the icon editable (hover shows a pencil, click uploads, × removes), as on the Payees page and transaction detail panel. Merging keeps a merged payee's logo if the kept one has none
- `custom_reports` — `name` + `config` (JSON string of `CustomReportConfig`); stores saved custom report configurations
- `dashboard_pages` / `dashboard_widgets` — report dashboards and their widgets (`type`, grid `x`/`y`/`width`/`height`, `meta` JSON). Pages have a `date_range` (null = last 6 months; the auto-created Overview starts on a live `1m`, this month). Custom report widgets reference `custom_report_id` (cascade delete). Migrations `0014`/`0015` were hand-written because `db:generate` prompts about the pending legacy cleanup above
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

- **Widgets**: built-in `summary`, `net-worth`, `income-expenses`, `spending`, `spending-trends`, `calendar` (charts in `components/reports/BuiltinCharts.tsx`, dashboard versions and registry in `BuiltinReport.tsx`) plus `custom-report`. Add them from "Add widget"; ⋮ menu has rename, date range, freeze/unfreeze, move to another dashboard, remove (undoable).
- **Full view** (`/reports/widget/:id`, `ReportDetail.tsx`): every built-in report has the same layout: four stat cards, the chart in a card, and a breakdown table whose contents are exactly what Export CSV saves. Give a new built-in report the same three parts. "Save to widget" stores the date range (only if changed) and, for Spending Trends, `meta.categoryIds`.
- **Transaction Calendar** (`TransactionCalendar.tsx`, layout math in `utils/calendarLayout.ts`, data from `GET /reports/daily-flow`: money in/out per day on budget accounts, no transfers, splits counted once): up to `CALENDAR_MONTHS_MAX` (3) months it draws month grids with a green (in) and red (out) bar per day, square-root scaled; longer ranges draw a heatmap (a square per day colored by net, in quartile levels), starting at the first month with transactions. On the dashboard (`fit`) it picks the layout with the biggest cells that fit the widget. The full view lists a clicked day's transactions.
- **Spending Trends categories**: `meta.categoryIds` (1-5), or when unset the `TOP_TREND_CATEGORIES` (5) with the most spending in the range (`useTopSpendingCategories`), on both the widget and the full view.
- **Date ranges**: each dashboard has a range picker, and widgets follow it unless `meta.dateRange` gives them their own (a live preset, or frozen months). Unfreezing just removes `meta.dateRange`. `ReportDateRange` (`utils/dateRange.ts`) is live (preset recomputed from today by `resolveDateRange`) or frozen (`preset: 'custom'`); `widgetDateRange` picks a widget's effective range. Custom report widgets work the same way and pass their range to the builder as `?range=` (`encodeRangeParam`). Server validates ranges with `dateRangeSchema` in `services/dashboardService.ts`.
- **Short ranges**: reports take `yyyy-MM` month ranges. Net Worth switches to daily points for ranges up to `DAILY_MAX_MONTHS` (3), starting at the previous month's close (`useNetWorthSeries`); Spending Trends shows a running total by day for a single month (`granularity=daily`). Any line/area chart with a single point is drawn as bars instead.
- **Layout**: `react-grid-layout` v2 (12 cols, 80px rows), drag/resize only in "Edit layout" mode on desktop; changed positions are saved on drag/resize stop (`PUT /api/dashboards/:id/layout`). Below 768px it's a single read-only column. Summary is one row tall: title, dates and figures sit on one line when its card is wide enough (`SUMMARY_ONE_LINE_PX`), and it's drawn two rows tall (not saved) when narrower.
- **API**: `/api/dashboards` (pages CRUD, `GET/POST /:id/widgets`, `PUT /:id/layout`, `GET/PATCH/DELETE /widgets/:widgetId`). The first `GET` creates an "Overview" dashboard with the built-ins and all existing custom reports; the last dashboard can't be deleted.

### Recurring Transactions

The recurring page at `/recurring` pairs a month-at-a-glance view with an Actual Budget-style schedules table. Two tabs:

- **Monthly** — one card with month nav (← → Today), a List | Calendar toggle, and an Income / Expenses summary (remaining, paid of total, progress bar) computed client-side from occurrences. List view is split into Income and Expenses sections sorted by date; Calendar view shows name chips per day (clicking a day jumps to its rows).
- **All recurring** (Actual `SchedulesTable`-style) — searchable table: Name | Payee | Account | Next date | Status | Amount | Frequency | ⋮. Status follows Actual's `getStatus()` order (missed → due → upcoming within the upcoming length → scheduled). Canceled items hide behind a "Show canceled" row.

Shared pieces: `StatusBadge` (Actual color/icon scheme), `RowMenu` (`components/ui`), `scheduleFormat.ts` (`~` approx / `+` income amounts, upcoming-length helpers). Match suggestions render as a banner under the header (`MatchSuggestionsPanel`).

**Find recurring** (`DiscoverSchedulesModal`, `GET /api/schedules/discover`, `POST /api/schedules/discover/create`) — port of Actual's `find-schedules.ts` in `server/src/services/scheduleDiscovery.ts`. Per open account it scans weekly / every-2-weeks / monthly-on-day-X / monthly-last-day patterns, requiring 3 consecutive matches (same payee, ±2 days, amount within 7.5%), picks the best-ranked pattern per payee, then walks the start date back through history. Ignores transactions already linked to a schedule or occurrence, transfers, split children, and payees with a live schedule. Creating links past transactions to occurrences (paid) and marks unmatched past occurrences skipped; schedules get `source='detected'`.

**Upcoming length** (`UpcomingLengthModal`) — Actual's setting, stored as `upcomingLength` in `preferencesStore` (`'1'|'7'|'14'|'oneMonth'|'currentMonth'|'<n>-<day|week|month|year>'`, default `'7'`). Pending occurrences beyond the window show as "Scheduled" instead of "Upcoming" (`occurrenceBadgeStatus`).

Occurrence status is computed by cross-referencing `recurringTransactionId` on transactions within a 3-day window of expected date: `paid`, `paid_different` (amount differs), `upcoming`, or `overdue`.

Mark-as-paid creates a real transaction linked via `recurringTransactionId`. Auto-create (on server startup) creates transactions for items with `autoCreate=1` that are due today or earlier.

UI components live in `client/src/components/recurring/`. Occurrence computation utility: `server/src/utils/recurrence.ts`.

### Dashboard

The dashboard at `/dashboard` (default landing page) is built from the components in `client/src/components/dashboard/`, with `HelpFooter` (docs, GitHub and issues links) at the bottom:

- `GettingStarted` — first-run checklist (add an account, bring in transactions, add bills and paychecks, plan the budget, create a rule), ticked off from real data; hidden once every step is done or by the user (`gettingStartedHidden` preference)
- `NetWorthMini` — net worth with a range picker and area chart
- `SummaryStats` — Left to Spend, average monthly income/expenses, savings rate (shows "—" with a hint until there's a budget or income)
- `IncomeExpensesMini` — 6-month income vs. expenses bars
- `SpendingComparison` — cumulative spending, this period vs. a comparison period
- `BudgetProgress` — planned vs. spent by budget type this month
- `UpcomingBills` — next upcoming/due recurring items within 30 days
- `SpendingBreakdown` — top spending categories this month
- `RecentTransactions` — the latest transactions

Every card has an empty state with a button to where its data comes from.

### Bank Sync (Plaid, SimpleFin, Enable Banking)

The app integrates with **Plaid** for automatic bank transaction import. Plaid credentials are stored in the `plaid_config` SQLite table (entered via Settings → Connected Banks), not in environment variables.

We also integrate with **SimpleFin**, and with **Enable Banking** for European banks (below).

**Enable Banking** (PSD2, EEA banks; the third step of European support after file import #95 and European amounts #120). Each user brings their own Enable Banking application (free in restricted mode for linking your own accounts): application id + RSA `.pem` key, stored in `enable_banking_config`. Modelled on Actual Budget's integration, fixing its known problems:

- `services/enableBankingService.ts`: API client. RS256 JWT per request (`signJwt`, Node `crypto`, no dependency), fixed base URL `https://api.enablebanking.com` through `safeFetch` (`FLYBUDGET_ENABLE_BANKING_API` points tests at a mock), Zod-validated responses, `classifyError` maps Enable Banking error codes to user-safe messages (`EXPIRED_SESSION` etc. → `login_required`). `getTransactions` asks for `transaction_status=BOOK` only (pending ones change id when booked), pages by `continuation_key` and stops when a key repeats. `POST /auth` always sends `psu_type: 'personal'`.
- `services/enableBankingTransactions.ts`: pure mapping (property-tested). Booking date, then value, then transaction date; sign from `credit_debit_indicator`; payee = creditor for money out, debtor for money in, then the first remittance line; SEPA reference lines (`EREF+`…) dropped, `SVWZ+` stripped; ids `eb:<mappingId>:<entry_reference or transaction_id>` (positional refs like `2026-10-17-3` are skipped), else a content key with `#n` for repeats; exact repeats of a record count once. Booked balances (`ITBD`, `CLBD`…) before available ones (`pickBalance`). `consentValidUntil` asks for the bank's `maximum_consent_validity` (at most 180 days). `matchExistingImports` adopts rows already in the account (same CAMT reference or the same bank id from an earlier connection, else same amount within 3 days, each row once; never this mapping's own rows, nor `plaid:`/`simplefin:` rows while that sync still runs on the account), so linking an account with CSV/CAMT history, or adding a bank again, doesn't duplicate it. Each account has at most one Enable Banking mapping (`map-accounts` unlinks an older one). `getTransactions` also stops on a page it has already seen. Transactions in another currency than the bank account are skipped and counted; amounts are read in its currency's decimals.
- `services/enableBankingAuth.ts`: bank logins in progress (like `plaidHostedLink.ts`). The redirect URL is `https://<host>/api/enable-banking/callback` in server mode (as in Actual) and `https://flybudget.org/bank-callback/` for the desktop app and dev (`RELAY_REDIRECT_URL`): `website/static/bank-callback/relay.js` forwards `?code&state` to `http://127.0.0.1:<port>`, the port being in the state (`fb1.<port>.<random>`, `makeState`/`parseState`); it only ever goes to loopback. Keep the relay, its `_headers` CSP and `parseState` in sync. If the redirect can't reach FlyBudget, the user pastes the address (`POST /auth/:authId/complete`, state must match). The code is exchanged once (`pollAuth`, shared in-flight promise); the callback exchanges it right away so its page can say how it went.
- `services/enableBankingSyncService.ts`: `saveNewConnection`, `reconnectConnection` (accounts found again by `matchReturningAccounts`: `identification_hash`, IBAN, name and currency, or the one missing account and the one new one, since `uid`s change every session; mappings and history are kept, and mappings the bank no longer shows are deleted), `syncEnableBankingConnection` (first sync of a new account = everything the bank allows (`strategy=longest`); linked to an account with history = a week before its latest transaction, or everything with `fullHistory`; later syncs = `last_booked_date` − 14 days; balances after transactions and never fatal; one account failing doesn't stop the others) and `syncAllEnableBankingConnections({ unattended: true })` on startup, which skips connections synced in the last 6 hours, ended ones and `login_required` ones, and first marks connections left `syncing` by a crash as interrupted (`resetInterruptedSyncs`). A backup restore clears `last_booked_date`, so the next sync starts again from the restored budget.
- `routes/enableBanking.ts` (`/api/enable-banking`): `status` (includes the redirect URL to register), `configure`, `aspsps`, `auth`, `auth/:authId` (poll), `connections/:id/map-accounts` (also stores the IBAN as the account's `statementAccount` if it has none), `sync`, `sync-all`, `connections`, `DELETE connections/:id` (ends the session at Enable Banking first, kept if unreachable or rate limited; only forgotten locally while another connection to the same bank exists). Reconnecting never ends the previous session: banks revoke the user's consent, not just one session, so that also cuts off the new one (verified with Nordea in the Enable Banking sandbox). New mappings suggest the account whose CAMT `statementAccount` is the IBAN.
- Client: `components/enablebanking/` (`EnableBankingSetupForm`, `ConnectEnableBankingModal`: setup → bank → browser (with the paste fallback) → mapping → sync, `EnableBankingConnectionCard`: expiry shown and warned 7 days before, Reconnect), `hooks/useEnableBanking.ts` (`useEnableBankingLogin` polls every 3s; call `start` straight from a click: it opens a blank tab before awaiting the server, so browsers don't block it, and points it at the bank afterwards). Entry points: Settings → Connected Banks, the sidebar add menu, the welcome page.
- E2E: `e2e/mockEnableBanking.ts` stands in for the API (its bank page redirects straight to the callback); `tests/enable-banking.spec.ts` also serves the relay page through `page.route`.

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

## Keep offline sync possible

FlyBudget may one day sync one budget between devices that also work offline (desktop app, phone, self-hosted server), merging changes made on each. Nothing syncs today, and this isn't a reason to refactor existing code, but new code shouldn't make that harder:

- **Route writes through the shared functions** instead of writing rows directly from a route, so a future change log has one place to hook in: `insertNewTransaction` for new transactions, `deleteTransactionRow` for deletes (both in `services/transactionHelpers.ts`), and the schedule/rule services for their tables. Add a shared function when a new kind of write appears in more than one place.
- **Give generated data deterministic ids where feasible.** Rows that every device would create on its own (a recurring occurrence for a schedule and date, the default categories of a new budget) should get an id derived from their content (e.g. a hash of `scheduleId + date`) rather than a random `nanoid()`, so two devices generating the same thing produce the same row instead of duplicates. Today they use `nanoid()`; follow this for new generated data and when touching those paths anyway.
- **Keep schema changes additive**: add nullable columns or columns with defaults, and new tables; avoid renaming or dropping columns, and changing a column's meaning. An older device must be able to read data written by a newer one.
- **Avoid new unique constraints that two devices could each satisfy differently** (e.g. unique names). If two offline edits would violate one when merged, there's no good way to resolve it. Existing ones (`budget_months` month+category, occurrence schedule+date) describe real identity, which is fine: prefer constraints on ids and natural keys over user-entered text.
- **Keep business logic in pure modules** (like `rulesEngine.ts` and `utils/recurrence.ts`, with the database side in a separate service such as `ruleService.ts`), taking data in and returning results without touching the database or the clock directly, so the same logic can run on any device and be re-run after a merge.

## License and contributions

FlyBudget is **AGPL-3.0-only** (`LICENSE`; every `package.json` says so). Outside contributors accept the Contributor License Agreement (`CLA.md`) with a one-line PR comment; `.github/workflows/cla.yml` checks it and sets a **CLA** status (it runs on `pull_request_target`, so it must never check out or run PR code, or interpolate comment text into its script). The CLA's version is in its acceptance sentence: changing the terms means a new version and sentence. Settings links to the license and to `SOURCE_CODE_URL` (`client/src/utils/project.ts`), which forks running a modified FlyBudget for others should point at their own source (AGPL section 13). Don't add dependencies whose licenses are incompatible with AGPL-3.0.

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

- **Asset Tracking**: Automatic valuations for property and vehicle accounts (values are updated by hand today).
- **Goal Tracking**: Save targets per category (e.g., "save $X by date Y").
