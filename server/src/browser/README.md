# The in-browser demo

The website's **Try the demo** button opens the real FlyBudget app with a sample budget, running
entirely in the visitor's browser. There is no demo server: the server's own routes run in a Web
Worker, on SQLite compiled to WebAssembly ([sql.js](https://github.com/sql-js/sql.js)). Every
visitor gets a private copy that disappears when they close the tab, and nothing is sent anywhere.

## How it fits together

- `client/`: `vite build --mode demo` builds the app with `IS_DEMO` (`client/src/demo/demoApi.ts`)
  set. `startDemoApi()` starts the worker and sends every `fetch` to `/api/...` there, so the rest
  of the app works unchanged. The demo also uses hash routing, relative asset paths, no offline
  copy or service worker, and shows `DemoBanner` ("Start over", "Download FlyBudget").
- `vite.config.ts` (`demoServerModules`) swaps the server's Node-only modules for the stand-ins in
  this folder, for files under `server/src` only:
  - `express` → `expressShim.ts`: routers with plain and `:param` segments, `router.param`,
    middleware chains and async handlers, `req.params/query/body`, `res.status/json/send/setHeader`.
  - `db/index.ts` → `db.ts`: the same exports, backed by sql.js through Drizzle's sql.js driver
    (synchronous, like better-sqlite3's, so every query runs as is).
  - `db/secretCrypto.ts` → `secretCrypto.ts`: no encryption (the demo never stores credentials).
  - `path` → `path.ts`: throws if used (only restore's safety copy of the database file needs it).
- `app.ts` mounts the budget routers like `index.ts` does and answers `/health`, `/auth/status` and
  `/server/info` itself. Bank connections (`/plaid`, `/simplefin`) and sign-in are refused, and the
  app shows "needs the FlyBudget app" instead of their setup screens (`NotInDemo`).
- `worker.ts` opens an in-memory database, runs every migration in `db/migrations`, and loads the
  demo budget. "Start over" does the same again.
- `../demo/demoBudget.ts` is the budget itself (pure: rows from today's date, the same every time
  for the same day), `../demo/loadDemoBudget.ts` loads it, and `../demo/logos.ts` holds the logos,
  drawn by `client/scripts/generate-demo-logos.mjs`.
- `website/scripts/build-demo.mjs` builds it into `website/static/demo/` before `docusaurus build`,
  so the site serves it at `/demo/`.

## Working on it

```bash
cd client && npx vite --mode demo            # the demo with hot reload
cd server && npx tsc --noEmit -p src/browser # type-check this folder (it's excluded from the server's)
cd server && DB_PATH=demo.db npm run db:seed-demo   # the demo budget in a normal database
cd e2e && npm test -- --project=demo         # the demo's end-to-end tests
```

## Keep it working

- **New routes**: mount them in `app.ts` too, or the demo answers 404.
- **Node-only code in a route** (the file system, `crypto`, network requests) won't run in the
  browser: keep it in a service the demo doesn't load, or give the demo an answer in `app.ts`.
  Building the demo (`--mode demo`) fails or warns when such an import sneaks in.
- **New Express features** in routes need the same in `expressShim.ts`.
- **New features** should show up in the demo budget (`demoBudget.ts`), kept lean: every account
  and payee has a logo, and `demoBudget.test.ts` checks the budget still adds up for any day.
