import net from 'net';

// The ports of one e2e run, seven in a row from a base. Runs in different checkouts (git
// worktrees) on one machine each need their own base:
//
//   E2E_PORT_BASE=3271 npm test
//
// Leave at least seven between two bases. The default is unusual on purpose, so it doesn't
// clash with `npm run dev`.

const DEFAULT_PORT_BASE = 3171;
const PORT_COUNT = 7;

function portBase(): number {
  const given = process.env.E2E_PORT_BASE;
  if (given === undefined || given === '') return DEFAULT_PORT_BASE;
  const base = Number(given);
  if (!Number.isInteger(base) || base < 1024 || base > 65535 - (PORT_COUNT - 1)) {
    throw new Error(
      `E2E_PORT_BASE must be a whole number from 1024 to ${65535 - (PORT_COUNT - 1)}, got "${given}"`,
    );
  }
  return base;
}

export const PORT_BASE = portBase();

/** The desktop-app server and the self-hosted (server mode) one */
export const DESKTOP_PORT = PORT_BASE;
export const SERVER_PORT = PORT_BASE + 1;
/** Test-only control server (global-setup.ts) that stops and starts the desktop server */
export const CONTROL_PORT = PORT_BASE + 2;
/** Static server for the in-browser demo build (served under /demo/, like the website) */
export const DEMO_PORT = PORT_BASE + 3;
/** Stand-in for Enable Banking's API (mockEnableBanking.ts), used by the desktop server */
export const ENABLE_BANKING_MOCK_PORT = PORT_BASE + 4;
/** Stand-in for Frankfurter's exchange rates (mockFrankfurter.ts), used by the desktop server */
export const FRANKFURTER_MOCK_PORT = PORT_BASE + 5;
/** Static server of screenshots.ts (not part of a test run) */
export const SCREENSHOT_PORT = PORT_BASE + 6;

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/**
 * Fails with a message naming the way out when one of these ports is already taken: most
 * often another run of the suite, which this one would otherwise end up talking to.
 */
export async function assertPortsFree(ports: number[]) {
  const taken: number[] = [];
  for (const port of ports) if (!(await isFree(port))) taken.push(port);
  if (taken.length === 0) return;
  const many = taken.length > 1;
  throw new Error(
    `Port${many ? 's' : ''} ${taken.join(', ')} ${many ? 'are' : 'is'} already in use, ` +
      `probably by another e2e run (E2E_PORT_BASE=${PORT_BASE}). ` +
      `Give this run its own ports, e.g. E2E_PORT_BASE=${PORT_BASE + 100} npm test`,
  );
}
