/** Ports the e2e servers listen on (unusual ones, so they don't clash with `npm run dev`) */
export const DESKTOP_PORT = 3171;
export const SERVER_PORT = 3172;
/** Test-only control server (global-setup.ts) that stops and starts the desktop server */
export const CONTROL_PORT = 3173;
/** Static server for the in-browser demo build (served under /demo/, like the website) */
export const DEMO_PORT = 3174;
