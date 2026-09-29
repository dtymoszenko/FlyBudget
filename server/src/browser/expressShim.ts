// A small stand-in for Express, used only by the in-browser demo (see README.md here). The
// demo build swaps `express` for this module, so the real route files run unchanged inside
// a Web Worker. It covers what those routes use: routers with plain and `:param` segments,
// `router.param`, middleware chains, async handlers, and req/res basics.

export interface ShimRequest {
  method: string;
  path: string;
  url: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  body: unknown;
  headers: Record<string, string>;
  get(name: string): string | undefined;
}

export interface ShimResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string | undefined;
  headersSent: boolean;
  status(code: number): ShimResponse;
  json(value: unknown): ShimResponse;
  send(body?: unknown): ShimResponse;
  sendStatus(code: number): ShimResponse;
  setHeader(name: string, value: string): ShimResponse;
  set(name: string, value: string): ShimResponse;
  end(): ShimResponse;
}

type Next = (err?: unknown) => void;
type Handler = (req: ShimRequest, res: ShimResponse, next: Next) => unknown;
type ParamHandler = (req: ShimRequest, res: ShimResponse, next: Next, value: string) => unknown;

interface Layer {
  method: string | null; // null: middleware for every method (router.use)
  segments: string[];
  prefix: boolean; // router.use matches the start of the path
  handlers: (Handler | ShimRouter)[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** The route's `:param` values if `path` matches its segments, else null. */
function match(layer: Layer, parts: string[]): Record<string, string> | null {
  if (layer.prefix ? parts.length < layer.segments.length : parts.length !== layer.segments.length)
    return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < layer.segments.length; i++) {
    const seg = layer.segments[i];
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
    else if (seg !== parts[i]) return null;
  }
  return params;
}

export class ShimRouter {
  private layers: Layer[] = [];
  private paramHandlers = new Map<string, ParamHandler>();

  constructor() {
    for (const method of METHODS) {
      this[method] = (path: string, ...handlers: Handler[]) => {
        this.layers.push({ method, segments: split(path), prefix: false, handlers });
        return this;
      };
    }
  }

  get!: (path: string, ...handlers: Handler[]) => this;
  post!: (path: string, ...handlers: Handler[]) => this;
  put!: (path: string, ...handlers: Handler[]) => this;
  patch!: (path: string, ...handlers: Handler[]) => this;
  delete!: (path: string, ...handlers: Handler[]) => this;

  use(pathOrHandler: string | Handler | ShimRouter, ...rest: (Handler | ShimRouter)[]): this {
    const path = typeof pathOrHandler === 'string' ? pathOrHandler : '/';
    const handlers = typeof pathOrHandler === 'string' ? rest : [pathOrHandler, ...rest];
    this.layers.push({ method: null, segments: split(path), prefix: true, handlers });
    return this;
  }

  param(name: string, handler: ParamHandler): this {
    this.paramHandlers.set(name, handler);
    return this;
  }

  /** Runs the request through this router; calls `done` if nothing here answers it. */
  async handle(req: ShimRequest, res: ShimResponse, done: Next, path = req.path): Promise<void> {
    const parts = split(path);
    for (const layer of this.layers) {
      if (layer.method && layer.method !== req.method.toLowerCase()) continue;
      const params = match(layer, parts);
      if (!params) continue;
      req.params = { ...req.params, ...params };

      // router.param hooks run once before the handlers, like Express's
      for (const [name, value] of Object.entries(params)) {
        const hook = this.paramHandlers.get(name);
        if (!hook) continue;
        const proceed = await runHandler((next) => hook(req, res, next, value));
        if (!proceed) return;
      }

      for (const handler of layer.handlers) {
        if (handler instanceof ShimRouter) {
          const rest = '/' + parts.slice(layer.segments.length).join('/');
          let fellThrough = false;
          await handler.handle(req, res, () => (fellThrough = true), rest);
          if (!fellThrough) return;
          continue;
        }
        const proceed = await runHandler((next) => handler(req, res, next));
        if (!proceed) return;
      }
      if (res.headersSent) return;
    }
    done();
  }
}

/**
 * Runs one handler. True if it called next() without an error (keep going); false if it
 * answered the request. Errors (thrown, rejected, or passed to next) propagate.
 */
async function runHandler(call: (next: Next) => unknown): Promise<boolean> {
  let nextCalled = false;
  let nextError: unknown;
  await call((err) => {
    nextCalled = true;
    nextError = err;
  });
  if (nextError) throw nextError;
  return nextCalled;
}

export function Router(): ShimRouter {
  return new ShimRouter();
}

export function createResponse(): ShimResponse {
  const res: ShimResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(value) {
      if (!res.headers['content-type']) res.headers['content-type'] = 'application/json';
      res.body = JSON.stringify(value);
      res.headersSent = true;
      return res;
    },
    send(body) {
      if (body !== undefined && typeof body !== 'string') return res.json(body);
      res.body = body;
      res.headersSent = true;
      return res;
    },
    sendStatus(code) {
      res.statusCode = code;
      return res.send();
    },
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    set(name, value) {
      return res.setHeader(name, value);
    },
    end() {
      res.headersSent = true;
      return res;
    },
  };
  return res;
}

/** `express.json()`: the demo passes bodies already parsed, so it only moves on. */
function json() {
  return (_req: ShimRequest, _res: ShimResponse, next: Next) => next();
}

const express = Object.assign(() => new ShimRouter(), { Router, json });
export default express;
