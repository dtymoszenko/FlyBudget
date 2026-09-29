import { readFileSync } from 'fs';
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

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'demo' ? [demoServerModules()] : [])],
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
