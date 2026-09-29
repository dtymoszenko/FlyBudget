// FlyBudget's service worker: keeps the app itself (its page, scripts, styles and fonts)
// on this device, so FlyBudget still opens when its server can't be reached. Budget data
// never goes through here: /api requests always go to the server, and the app's own
// offline copy (src/offline/) covers them.
//
// Registered only by the built web app (self-hosted servers), never in dev or the desktop
// app. Browsers allow service workers on https:// and localhost only.

const CACHE = 'flybudget-app-v1';
// The page every in-app URL serves (/budget, /accounts/…): the app routes on its own
const SHELL = '/';
// Hashed build files pile up across updates; keep the newest ones
const MAX_ENTRIES = 150;
// A server that doesn't answer (the device can't reach it) shouldn't hold up opening
const PAGE_TIMEOUT_MS = 4000;

// Install: save the page and the files it loads, so the very next visit works offline
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch(SHELL, { cache: 'no-store' });
      if (!res.ok) return;
      const html = await res.clone().text();
      await cache.put(SHELL, res);
      const files = [...html.matchAll(/(?:src|href)="\.?(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await Promise.all(files.map((f) => cache.add(f).catch(() => {})));
      // The fonts the stylesheet loads (woff2: every browser that runs service workers has it)
      for (const css of files.filter((f) => f.endsWith('.css'))) {
        const text = await (await cache.match(css))?.text();
        const fonts = [...(text ?? '').matchAll(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/g)];
        await Promise.all(
          fonts.map((m) =>
            cache.add(new URL(m[1], self.location.origin + css).pathname).catch(() => {}),
          ),
        );
      }
    })().then(() => self.skipWaiting()),
  );
});

// Activate: remove caches from older versions of this worker and take over open tabs
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('flybudget-') && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    if (new URL(req.url).pathname !== SHELL) await cache.delete(req);
  }
}

// Pages: ask the server first (so updates arrive), and use the saved page when it can't
// be reached or takes too long
async function page(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PAGE_TIMEOUT_MS)),
    ]);
    // Only a real app page replaces the saved one (not an error page from a proxy)
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
      await cache.put(SHELL, res.clone());
    }
    return res;
  } catch {
    return (await cache.match(SHELL)) || Response.error();
  }
}

// Build files have the content's hash in their name, so a saved copy is always right
async function file(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    void trim(cache);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Other sites, and all budget data: straight to the network, never saved here
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;
  if (request.mode === 'navigate') return event.respondWith(page(request));
  if (url.pathname.startsWith('/assets/')) return event.respondWith(file(request));
});
