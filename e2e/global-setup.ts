import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { DESKTOP_PORT, SERVER_PORT } from './ports';

// Starts FlyBudget twice, each on a throwaway database:
//
// - desktop: configured exactly like the Electron app (client built with
//   `--mode electron`, served by the API server, a per-launch API token cookie, and
//   an encryption key for bank credentials). Tests add the preload's __API_BASE__.
// - server: self-hosted server mode (password login, setup code from the log).
//
// Settings the tests need are passed on through environment variables.

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
  if (child.exitCode !== null || !child.pid) return;
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

export default async function globalSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flybudget-e2e-'));
  if (!process.env.E2E_SKIP_BUILD) {
    buildClient(path.join(dir, 'client-desktop'), 'electron');
    buildClient(path.join(dir, 'client-web'));
  } else {
    // Reuse builds from a previous run (faster while writing tests)
    for (const [target, mode] of [
      ['client-desktop', 'electron'],
      ['client-web', undefined],
    ] as const) {
      const cached = path.join(os.tmpdir(), `flybudget-e2e-cache-${target}`);
      if (!fs.existsSync(cached)) buildClient(cached, mode);
      fs.cpSync(cached, path.join(dir, target), { recursive: true });
    }
  }

  const apiToken = randomBytes(32).toString('hex');
  const dataKey = randomBytes(32).toString('base64');

  const desktopLog: string[] = [];
  const desktop = startServer(
    'desktop',
    {
      PORT: String(DESKTOP_PORT),
      DB_PATH: path.join(dir, 'desktop.db'),
      CLIENT_DIST: path.join(dir, 'client-desktop'),
      FLYBUDGET_API_TOKEN: apiToken,
      FLYBUDGET_DATA_KEY: dataKey,
    },
    desktopLog,
  );

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
  const snapshotFile = path.join(dir, 'fresh-backup.json');
  fs.writeFileSync(snapshotFile, await snapshot.text());

  process.env.E2E_API_TOKEN = apiToken;
  process.env.E2E_SETUP_CODE = setupCode;
  process.env.E2E_SNAPSHOT = snapshotFile;
  process.env.E2E_DIR = dir;

  return async () => {
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
