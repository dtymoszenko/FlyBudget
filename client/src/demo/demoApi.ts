// The in-browser demo (`vite build --mode demo`): the app's API requests go to a Web Worker
// that runs the real server routes on a demo budget (server/src/browser/README.md), so the
// rest of the app works exactly as it does against a real server.
import { startDemoWorker } from './demoWorker';

/** True in the demo build */
export const IS_DEMO = import.meta.env.MODE === 'demo';

interface DemoResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
}

type Reply = { id: number; ok: true; response?: DemoResponse } | { id: number; ok: false };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (reply: Reply) => void>();

function send(message: object): Promise<Reply> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ ...message, id });
  });
}

/** Where a request is going, if it's for the API (`/api/...` on this page) */
function apiPath(input: RequestInfo | URL): string | null {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return null;
  return url.pathname.slice('/api'.length) + url.search;
}

/** Starts the demo's worker and sends every API request there. */
export function startDemoApi() {
  worker = startDemoWorker();
  worker.onmessage = (event: MessageEvent<Reply>) => {
    pending.get(event.data.id)?.(event.data);
    pending.delete(event.data.id);
  };

  const networkFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const path = apiPath(input);
    if (path === null) return networkFetch(input, init);
    init?.signal?.throwIfAborted();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const reply = await send({
      type: 'request',
      request: { method: init?.method ?? 'GET', url: path, headers, body },
    });
    if (!reply.ok || !reply.response) {
      return new Response(JSON.stringify({ error: 'Something went wrong' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    const { status, headers: resHeaders, body: resBody } = reply.response;
    return new Response(status === 204 ? null : (resBody ?? null), { status, headers: resHeaders });
  };
}

/** Throws away every change and loads the demo budget again. */
export async function resetDemo(): Promise<void> {
  await send({ type: 'reset' });
}

/**
 * Downloads a file the API makes (a backup or CSV export). A real server answers a page
 * navigation; the demo's API only answers fetch, so save the result from here.
 */
export async function downloadFromApi(url: string) {
  const res = await fetch(url);
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'download';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(await res.blob());
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
