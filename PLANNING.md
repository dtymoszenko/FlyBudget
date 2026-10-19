# FlyBudget — Project Overview and Roadmap

FlyBudget is a free, open-source, local-first budgeting app: an alternative to popular apps like Monarch, Mint and YNAB, without the subscription. Your data stays on your own computer or server.

It runs three ways:

- **Desktop app** (Electron) for Windows, macOS and Linux
- **Self-hosted server** (Docker), with a password login, for use from any browser
- **In-browser demo** at [flybudget.org/demo](https://flybudget.org/demo/), with a sample budget and no server

FlyBudget is licensed under AGPL-3.0-only.

This document gives the big picture: goals, architecture, what has shipped and where the project is heading. For details, see:

- [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md): detailed conventions, security model and per-feature notes
- [`CONTRIBUTING.md`](CONTRIBUTING.md): how to contribute (outside contributors accept the [CLA](CLA.md))
- [`website/docs/`](website/docs/): the user guide

---

## Goals and principles

- **Local-first and private.** The whole budget is one SQLite file. There is no cloud account and no tracking, and nothing leaves the machine unless you connect a bank or turn on exchange rate downloads.
- **Zero-based envelope budgeting.** Every unit of income gets a job. Category balances carry over from month to month.
- **Exact money math.** Amounts are integers in their currency's minor units, exchange rates are decimal strings handled with BigInt, and nothing uses floats.
- **Never lock users out.** An offline copy of the budget, a reconnect banner and queued new transactions keep the app usable while the server restarts or the network drops.
- **Secure by default.** Host, origin and per-launch token guards protect the local API, bank credentials are encrypted at rest, and the CSP is strict. Outbound requests to user-supplied URLs go through `safeFetch`.
- **Keep multi-device sync possible.** Writes go through shared service functions, generated data gets deterministic ids where feasible, schema changes are additive, and business logic lives in pure modules.

---

## Architecture at a glance

### Repository layout

```
budgeting-project/
├── client/     # React web app (also loaded by Electron and the demo)
├── server/     # Express API + SQLite (also runs in a Web Worker for the demo)
├── electron/   # Electron main + preload: starts the server, opens the window
├── website/    # Docusaurus site: user guide, tour, blog, download page, demo
├── e2e/        # Playwright tests (desktop, phone, server mode, demo)
├── docker/     # Helper scripts for the Docker image (backup, reset password)
├── Dockerfile  # Self-hosted image (ghcr.io/dtymoszenko/flybudget)
└── package.json
```

### Tech stack

| Layer           | Choice                                                        |
| --------------- | ------------------------------------------------------------- |
| Frontend        | React 19 + TypeScript + Vite                                  |
| Styling         | Tailwind CSS v4, self-hosted Inter font                       |
| Routing         | React Router v7                                               |
| Server state    | TanStack Query v5 (one hook file per resource in `hooks/`)    |
| UI state        | Zustand (`appStore`, `preferencesStore`, `currencyStore`, …)  |
| Charts          | Recharts; `react-grid-layout` for report dashboards           |
| Backend         | Node.js + Express 5 + TypeScript                              |
| Database        | SQLite via `better-sqlite3` (sql.js in the demo)              |
| ORM/Migrations  | Drizzle ORM + drizzle-kit (applied on startup)                |
| Validation      | Zod on every route                                            |
| Security        | helmet (CSP), express-rate-limit, scrypt passwords, AES-GCM   |
| Bank sync       | Plaid (Hosted Link), SimpleFIN, Enable Banking (PSD2)         |
| Desktop         | Electron + electron-builder (asar integrity, fuses)           |
| Website         | Docusaurus                                                    |
| Tests           | Vitest + fast-check (property-based), Playwright (end-to-end) |
| Icons and dates | Lucide React, date-fns                                        |
| IDs             | nanoid                                                        |

### Run modes

| Mode        | How it runs                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| Dev         | `npm run dev`: Vite (5173) proxies `/api` to Express (3001); no login                                  |
| Desktop     | Electron starts the server on localhost with a per-launch API token cookie and an encryption key       |
| Server mode | `FLYBUDGET_SERVER_MODE=true` (Docker): password login, sessions, setup code in the server log          |
| Demo        | `vite build --mode demo`: every `/api` call goes to a Web Worker running the server's routes on sql.js |

### Data flow

```
React components
  → TanStack Query hooks (client/src/hooks)
  → api/* wrappers → apiFetch (connection tracking, NetworkError)
  → Express /api/* (guards → requireSession → Zod validation)
  → services (pure logic + database side) → Drizzle → SQLite
```

The server is the only thing that touches the database. Offline, the client shows a copy of its query cache saved in IndexedDB (`client/src/offline/`) and keeps new transactions in an outbox until the server is back.

### Main areas and where they live

| Area                    | Key files                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Budget math             | `server/src/routes/budget.ts`, `client/src/utils/budgetFigures.ts`                                          |
| Transactions            | `routes/transactions.ts`, `services/transactionHelpers.ts` (`insertNewTransaction`, deletes)                |
| Splits and balances     | `services/balances.ts`                                                                                      |
| Transfers               | `services/transferMatching.ts` (pure), `services/transferService.ts`                                        |
| Rules engine            | `services/rulesEngine.ts` (pure), `services/ruleService.ts`, `client/src/components/rules/`                 |
| Recurring schedules     | `utils/recurrence.ts`, `services/scheduleService.ts`, `services/scheduleDiscovery.ts`                       |
| Reports and dashboards  | `routes/reports.ts`, `routes/dashboards.ts`, `client/src/components/reports/`                               |
| Multiple currencies     | `utils/currencies.ts`, `utils/money.ts`, `services/exchangeRates.ts`, `services/mainAmounts.ts`             |
| Bank sync               | `services/plaid*.ts`, `services/simplefin*.ts`, `services/enableBanking*.ts`                                |
| File import (CSV, CAMT) | `client/src/utils/csv.ts`, `client/src/utils/camt.ts`, `client/src/components/transactions/ImportModal.tsx` |
| Backup and restore      | `services/backupService.ts`, `routes/export.ts`                                                             |
| Security and auth       | `middleware/security.ts`, `routes/auth.ts`, `server/src/auth/`, `db/secretCrypto.ts`                        |
| Connection and offline  | `client/src/store/connectionStore.ts`, `client/src/offline/`, `client/public/sw.js`                         |
| In-browser demo         | `server/src/browser/`, `server/src/demo/demoBudget.ts`, `client/src/demo/`                                  |
| Phones (below 768px)    | `client/src/hooks/useIsPhone.ts`, `client/src/components/layout/AppShell.tsx` (`PhoneShell`)                |

Server paths are relative to `server/src/` unless they start with `client/`.

### Database tables

The schema lives in [`server/src/db/schema.ts`](server/src/db/schema.ts) and the migrations in `server/src/db/migrations/`. Every id is a nanoid string, amounts are integer minor units, and dates are `YYYY-MM-DD` text.

- **Budget:** `accounts`, `category_groups`, `categories`, `budget_months`, `budget_settings`, `goals`
- **Transactions:** `transactions`, `payees`, `rules`, `transfer_match_dismissals`
- **Recurring:** `schedules`, `schedule_occurrences`, `schedule_match_dismissals`
- **Reports:** `custom_reports`, `dashboard_pages`, `dashboard_widgets`
- **Currencies:** `exchange_rates`
- **Bank sync:** `plaid_config`, `plaid_items`, `plaid_account_mappings`, `simplefin_connections`, `simplefin_account_mappings`, `enable_banking_config`, `enable_banking_connections`, `enable_banking_account_mappings`
- **Server mode:** `auth_config`, `sessions`

---

## What's shipped (v0.2.0)

- **Budgeting:** zero-based monthly budget with carry-over, category detail pages, savings goals, and a phone layout with collapsible groups
- **Accounts:** 17 account types in six groups (cash, credit, investments, property, loans, other), on/off budget, logos, value updates for assets, reconciliation
- **Transactions:** register with filters, splits, transfers (including linking existing rows and suggested matches), undo, and payees with default categories and logos
- **Rules:** conditions on text, ids, amount, direction and date; rename, categorize, notes and split actions; preview and apply to existing transactions
- **Recurring:** monthly list and calendar views, a schedules table, auto-create, match suggestions, and "Find recurring" detection
- **Reports:** dashboards of movable widgets (summary, net worth, income vs. expenses, spending, spending trends, transaction calendar), a custom report builder, cash flow, and CSV export
- **Import and export:** CSV with detected formats, CAMT.053/052/054 statements, per-account import settings, CSV export, full JSON backup and restore
- **Bank sync:** Plaid, SimpleFIN and Enable Banking (European banks), each with your own credentials
- **Multiple currencies:** a budget currency, per-account currencies, daily exchange rates (opt-in download or manual), and currency-aware formatting
- **Everywhere:** the desktop app, a self-hosted Docker image, the in-browser demo, offline support, phone layouts, and configurable number and date formats

---

## Roadmap and ideas

Open directions. None of these are committed. To discuss or pick something up, open an issue or join the [Discord](https://discord.gg/xVHK4mUUNw).

- **Multi-device sync:** one budget shared between the desktop app, phones and a server, merging offline changes (see "Keep offline sync possible" in `CLAUDE.md`)
- **Asset tracking:** automatic valuations for property and vehicle accounts (updated by hand today)
- **Category goal targets:** save $X in a category by date Y, shown in the budget
- **Legacy cleanup:** drop the `recurring_transactions` table and `transactions.recurring_transaction_id`, which migration `0011_unified_schedules` left behind, in a migration of its own

---

## Key decisions

| Decision       | Choice                                          | Reason                                                                                         |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Storage        | SQLite, one local file                          | Local-first, no server cost, no account needed, easy to back up                                |
| Budget method  | Zero-based / envelope                           | Most effective personal budgeting method                                                       |
| Amounts        | Integer minor units, BigInt rates               | No floating-point errors, correct for currencies with 0–3 decimals                             |
| ORM            | Drizzle                                         | Type-safe, lightweight, good SQLite support                                                    |
| Charts         | Recharts                                        | React-native, composable, no D3 knowledge needed                                               |
| Server state   | TanStack Query                                  | Handles caching, invalidation and loading/error states                                         |
| UI state       | Zustand                                         | Simple, little boilerplate                                                                     |
| Auth           | None on desktop; password + sessions on servers | The desktop API is locked to the app by guards and a token; a self-hosted server needs a login |
| Encryption     | Bank credentials only, not the whole database   | Protects the secrets that matter without the cost of full-database encryption                  |
| Bank sync      | Plaid, SimpleFIN, Enable Banking                | Covers the US, Canada and Europe; each user brings their own credentials, so no middleman      |
| Desktop        | Electron                                        | Largest ecosystem, simplest way to ship the web app as a desktop app                           |
| Tests          | Property-based (fast-check) + Playwright        | Invariants over many generated inputs catch edge cases fixed examples miss                     |
| License        | AGPL-3.0-only + CLA                             | Keeps hosted modifications open source                                                         |
| Generated data | Deterministic ids where feasible                | Two devices generating the same row shouldn't create duplicates once sync exists               |
