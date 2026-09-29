import { CONTROL_PORT } from '../ports';

// Stops and starts the desktop-app server from a test (see the control server in
// global-setup.ts). The database is kept, so the app comes back with the same data.

async function control(action: 'stop' | 'start') {
  const res = await fetch(`http://127.0.0.1:${CONTROL_PORT}/desktop/${action}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.E2E_CONTROL_TOKEN}` },
    signal: AbortSignal.timeout(90_000),
  });
  if (res.status !== 204) {
    throw new Error(`Could not ${action} the desktop server: ${res.status} ${await res.text()}`);
  }
}

export const stopDesktopServer = () => control('stop');
export const startDesktopServer = () => control('start');
