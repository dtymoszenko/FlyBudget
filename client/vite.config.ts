import { readFileSync, rmSync } from 'fs';
import path from 'path';
import { defineConfig, normalizePath, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const serverSrc = path.resolve(import.meta.dirname, '../server/src');
const version = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'),
).version as string;

/**
 * The in-browser demo (`vite build --mode demo`, see server/src/browser/README.md) runs the
 * real server routes in a Web Worker. This swaps the server's Node-only modules for the
 * browser stand-ins next to that README.
 */
function demoServerModules(): Plugin {
  // Vite ids use forward slashes, even on Windows; a different spelling of the same file
  // would load it twice (and the worker would open a database the routes never see)
  const file = (relative: string) => normalizePath(path.join(serverSrc, relative));
  const swaps: Record<string, string> = {
    [file('db/index.ts')]: file('browser/db.ts'),
    [file('db/secretCrypto.ts')]: file('browser/secretCrypto.ts'),
  };
  return {
    name: 'flybudget-demo-server-modules',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !normalizePath(importer).startsWith(file(''))) return null;
      if (source === 'express') return file('browser/expressShim.ts');
      if (source === 'path') return file('browser/path.ts');
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const swap = resolved && swaps[normalizePath(resolved.id)];
      return swap ?? null;
    },
  };
}

/**
 * The demo's Content Security Policy, like the one the server sends the app (helmet in
 * server/src/middleware/security.ts), plus WebAssembly for the worker's SQLite. The website's
 * host sends the same policy as a header (website/static/_headers), with frame-ancestors,
 * which only works as a header.
 */
const DEMO_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * The demo's page: the same strict CSP as the app (it runs on the website, whose host may not
 * send one), no referrer, and no service worker file (the demo never registers one).
 */
function demoPage(): Plugin {
  let outDir = '';
  return {
    name: 'flybudget-demo-page',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: DEMO_CSP },
        injectTo: 'head-prepend',
      },
      {
        tag: 'meta',
        attrs: { name: 'referrer', content: 'no-referrer' },
        injectTo: 'head-prepend',
      },
    ],
    closeBundle() {
      rmSync(path.join(outDir, 'sw.js'), { force: true });
    },
  };
}

/**
 * Every build except the demo: swap the module that starts the demo's worker for a stub, so
 * none of the demo (or the server code it runs) ends up in the build, and building the
 * client doesn't need the server's packages installed.
 */
function withoutDemoWorker(): Plugin {
  const real = normalizePath(path.resolve(import.meta.dirname, 'src/demo/demoWorker.ts'));
  const stub = normalizePath(path.resolve(import.meta.dirname, 'src/demo/demoWorker.stub.ts'));
  return {
    name: 'flybudget-without-demo-worker',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('demoWorker')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && normalizePath(resolved.id) === real ? stub : null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === 'demo' ? [demoServerModules(), demoPage()] : [withoutDemoWorker()]),
  ],
  // The desktop app loads files from disk and the demo lives under /demo/ on the website,
  // so both use relative paths
  base: mode === 'electron' || mode === 'demo' ? './' : '/',
  define: { __FLYBUDGET_VERSION__: JSON.stringify(version) },
  worker: {
    format: 'es',
    plugins: () => (mode === 'demo' ? [demoServerModules()] : []),
  },
  server: {
    // The demo worker imports the server's route files
    fs: { allow: [path.resolve(import.meta.dirname, '..')] },
    proxy:
      mode === 'demo'
        ? undefined
        : {
            '/api': {
              target: process.env.API_URL || 'http://localhost:3001',
              changeOrigin: true,
            },
          },
  },
}));
