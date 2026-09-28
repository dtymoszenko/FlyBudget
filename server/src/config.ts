// Runtime configuration from environment variables.
//
// FlyBudget runs in three ways:
// - desktop app (Electron): local only, protected by a per-launch secret
// - `npm run dev`: local only, for development
// - server mode (Docker / self-hosted): reachable from other devices, so every
//   request needs a logged-in session (see routes/auth.ts)

/** Self-hosted server: require a password login for everything. */
export const serverMode = process.env.FLYBUDGET_SERVER_MODE === 'true';

/** Address to listen on. Only server mode should listen beyond this machine. */
export const listenHost = process.env.FLYBUDGET_HOST ?? '127.0.0.1';

/**
 * Hostnames (optionally with :port) the server answers to in server mode, e.g.
 * "budget.example.com,192.168.1.20:3001". Empty = any host (login still required).
 */
export const allowedHosts = (process.env.FLYBUDGET_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/**
 * Express "trust proxy" setting for running behind a reverse proxy (so HTTPS and
 * client IPs are detected correctly), e.g. "loopback" or "1". Unset = no proxy.
 */
export const trustProxy = process.env.FLYBUDGET_TRUST_PROXY;
