import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { randomBytes, timingSafeEqual } from 'crypto';
import http from 'http';
import { gzipSync } from 'zlib';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONTROL_PORT, DEMO_PORT, DESKTOP_PORT, SERVER_PORT } from './ports';

// Starts FlyBudget twice, each on a throwaway database:
//
// - desktop: configured exactly like the Electron app (client built with
//   `--mode electron`, served by the API server, a per-launch API token cookie, and
//   an encryption key for bank credentials). Tests add the preload's __API_BASE__.
// - server: self-hosted server mode (password login, setup code from the log).
//
// Settings the tests need are passed on through environment variables.
//
// It also builds the in-browser demo (`--mode demo`, the website's "Try the demo") and serves
// it as static files under /demo/, like the website does.
//
// Tests can also stop and restart the desktop server (to check how the app behaves
// while it can't reach it) through a small control server on 127.0.0.1:CONTROL_PORT,
// which only accepts requests carrying a per-run token (see tests/serverControl.ts).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

function buildClient(outDir: string, mode?: string) {
  const vite = path.join(root, 'client/node_modules/vite/bin/vite.js');
  const args = [vite, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'];
  if (mode) args.push('--mode', mode);
  execFileSync(process.execPath, args, { cwd: path.join(root, 'client'), stdio: 'inherit' });
}

function startServer(name: string, env: Record<string, string>, log: string[]): ChildProcess {
  const tsx = path.join(root, 'server/node_modules/tsx/dist/cli.mjs');
  const child = spawn(process.execPath, [tsx, 'src/index.ts'], {
    cwd: path.join(root, 'server'),
    env: { ...process.env, NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group (Linux/macOS), so stopping it also stops the server tsx starts
    detached: !isWindows,
  });
  const collect = (chunk: Buffer) => {
    log.push(chunk.toString());
    if (process.env.E2E_SERVER_LOGS) process.stdout.write(`[${name}] ${chunk}`);
  };
  child.stdout!.on('data', collect);
  child.stderr!.on('data', collect);
  return child;
}

async function waitForHealth(port: number, child: ChildProcess, log: string[]) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${log.join('')}`);
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server on port ${port} didn't start:\n${log.join('')}`);
}

function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (isWindows) {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

/** Stops a server and waits until it has exited and its port refuses connections. */
async function stopAndWait(child: ChildProcess, port: number) {
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((r) => child.once('exit', () => r()));
  stop(child);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))]);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      return; // refused: it's gone
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server on port ${port} didn't stop`);
}

/**
 * Test-only HTTP control for the desktop server: POST /desktop/stop and /desktop/start.
 * Listens on 127.0.0.1 only and requires the per-run token.
 */
function startControlServer(
  token: string,
  stopDesktop: () => Promise<void>,
  startDesktop: () => Promise<void>,
) {
  const expected = Buffer.from(`Bearer ${token}`);
  const server = http.createServer(async (req, res) => {
    const given = Buffer.from(req.headers.authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.writeHead(401).end();
      return;
    }
    const action =
      req.method === 'POST' && req.url === '/desktop/stop'
        ? stopDesktop
        : req.method === 'POST' && req.url === '/desktop/start'
          ? startDesktop
          : null;
    if (!action) {
      res.writeHead(404).end();
      return;
    }
    try {
      await action();
      res.writeHead(204).end();
    } catch (err) {
      // Details (e.g. the server's log) go to the runner's output, not the response
      console.error('e2e control: desktop server action failed', err);
      res.writeHead(500).end();
    }
  });
  return new Promise<http.Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(CONTROL_PORT, '127.0.0.1', () => resolve(server));
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** Serves the demo build at /demo/, as static files (the website's host does the same). */
function startDemoServer(root: string): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/demo/')) {
      res.writeHead(404).end();
      return;
    }
    const rel = decodeURIComponent(url.pathname.slice('/demo/'.length)) || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(DEMO_PORT, '127.0.0.1', () => resolve(server));
  });
}

export default async function globalSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flybudget-e2e-'));
  if (!process.env.E2E_SKIP_BUILD) {
    buildClient(path.join(dir, 'client-desktop'), 'electron');
    buildClient(path.join(dir, 'client-web'));
    buildClient(path.join(dir, 'client-demo'), 'demo');
  } else {
    // Reuse builds from a previous run (faster while writing tests)
    for (const [target, mode] of [
      ['client-desktop', 'electron'],
      ['client-web', undefined],
      ['client-demo', 'demo'],
    ] as const) {
      const cached = path.join(os.tmpdir(), `flybudget-e2e-cache-${target}`);
      if (!fs.existsSync(cached)) buildClient(cached, mode);
      fs.cpSync(cached, path.join(dir, target), { recursive: true });
    }
  }

  const demo = await startDemoServer(path.join(dir, 'client-demo'));

  const apiToken = randomBytes(32).toString('hex');
  const dataKey = randomBytes(32).toString('base64');

  const desktopLog: string[] = [];
  const desktopEnv = {
    PORT: String(DESKTOP_PORT),
    DB_PATH: path.join(dir, 'desktop.db'),
    CLIENT_DIST: path.join(dir, 'client-desktop'),
    FLYBUDGET_API_TOKEN: apiToken,
    FLYBUDGET_DATA_KEY: dataKey,
  };
  // Replaced when a test restarts it
  let desktop = startServer('desktop', desktopEnv, desktopLog);

  const serverLog: string[] = [];
  const server = startServer(
    'server',
    {
      PORT: String(SERVER_PORT),
      DB_PATH: path.join(dir, 'server.db'),
      CLIENT_DIST: path.join(dir, 'client-web'),
      FLYBUDGET_SERVER_MODE: 'true',
      FLYBUDGET_HOST: '127.0.0.1',
      FLYBUDGET_DATA_KEY: dataKey,
    },
    serverLog,
  );

  try {
    await Promise.all([
      waitForHealth(DESKTOP_PORT, desktop, desktopLog),
      waitForHealth(SERVER_PORT, server, serverLog),
    ]);
  } catch (err) {
    stop(desktop);
    stop(server);
    throw err;
  }

  // Server mode prints a one-time setup code to its log
  const setupCode = serverLog.join('').match(/[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}/)?.[0];
  if (!setupCode) throw new Error(`No setup code in the server log:\n${serverLog.join('')}`);

  // A snapshot of the fresh desktop database: every test starts from it (see fixtures.ts)
  const snapshot = await fetch(`http://localhost:${DESKTOP_PORT}/api/export/backup`, {
    headers: { cookie: `flybudget_token=${apiToken}` },
  });
  if (!snapshot.ok) throw new Error(`Could not snapshot the database: ${snapshot.status}`);
  // Kept in memory, handed to the test workers through the environment (compressed: it
  // holds every default category)
  const snapshotData = gzipSync(Buffer.from(await snapshot.text())).toString('base64');

  const controlToken = randomBytes(32).toString('hex');
  const control = await startControlServer(
    controlToken,
    () => stopAndWait(desktop, DESKTOP_PORT),
    async () => {
      if (desktop.exitCode === null && desktop.signalCode === null) return; // already running
      desktop = startServer('desktop', desktopEnv, desktopLog);
      await waitForHealth(DESKTOP_PORT, desktop, desktopLog);
    },
  );

  process.env.E2E_CONTROL_TOKEN = controlToken;
  process.env.E2E_API_TOKEN = apiToken;
  process.env.E2E_SETUP_CODE = setupCode;
  process.env.E2E_SNAPSHOT = snapshotData;
  process.env.E2E_DIR = dir;

  return async () => {
    control.close();
    demo.close();
    stop(desktop);
    stop(server);
    // SQLite may hold the files for a moment after the process ends on Windows
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  };
}
