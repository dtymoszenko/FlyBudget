// Starts the demo's Web Worker (server/src/browser/worker.ts). Its own module so that
// builds other than the demo swap it for demoWorker.stub.ts (see vite.config.ts): Vite
// bundles any `new Worker(new URL(...))` it sees, and the worker brings in the server's code.
export function startDemoWorker(): Worker {
  return new Worker(new URL('../../../server/src/browser/worker.ts', import.meta.url), {
    type: 'module',
  });
}
