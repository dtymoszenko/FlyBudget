import { API_BASE } from './base';
import { reportNetworkFailure, reportServerReachable } from '../store/connectionStore';
import { isUnreachableResponse } from '../utils/connection';

export const AUTH_REQUIRED_EVENT = 'flybudget:auth-required';

/** The request never reached FlyBudget's server (it's restarting, stopped, or offline). */
export class NetworkError extends Error {
  constructor() {
    super("Can't reach FlyBudget right now. Nothing was saved; try again once it reconnects.");
    this.name = 'NetworkError';
  }
}

/** The server answered with an error (the message is safe to show) */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (err) {
    // Cancelled on purpose (e.g. a query that's no longer needed): not a connection problem
    if ((err as Error)?.name === 'AbortError') throw err;
    reportNetworkFailure();
    throw new NetworkError();
  }
  if (isUnreachableResponse(res.status, res.headers.get('content-type'))) {
    reportNetworkFailure();
    throw new NetworkError();
  }
  // Any real answer (even an error or "login required") means the server is there
  reportServerReachable();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Server mode: the session expired or was signed out elsewhere — show the login screen
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    // Validation failures send an object of field errors, not a message
    const message =
      typeof body.error === 'string'
        ? body.error
        : body.error
          ? 'Some of the values entered are invalid'
          : res.statusText;
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
