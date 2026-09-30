// Used instead of demoWorker.ts in every build except the demo (see vite.config.ts)
export function startDemoWorker(): Worker {
  throw new Error('The demo worker is only in the demo build (vite --mode demo)');
}
