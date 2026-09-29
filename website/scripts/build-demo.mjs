// Builds the in-browser demo ("Try the demo") into static/demo, so the website serves it at
// /demo/. It's the real app built with `vite build --mode demo`: the server's routes run in a
// Web Worker on a sample budget (see server/src/browser/README.md). Runs before
// `docusaurus build`, so the website's host builds it with everything else.
import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const website = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.dirname(website);
const out = path.join(website, 'static', 'demo');

const run = (command, cwd) => execSync(command, { cwd, stdio: 'inherit' });

// The demo bundles code from both packages. Their .npmrc keeps install scripts off.
for (const pkg of ['server', 'client']) {
  const dir = path.join(root, pkg);
  if (!existsSync(path.join(dir, 'node_modules'))) run('npm ci', dir);
}

rmSync(out, { recursive: true, force: true });
run(`npx vite build --mode demo --outDir "${out}" --emptyOutDir`, path.join(root, 'client'));
