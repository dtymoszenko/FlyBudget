// electron preload injects the full url, dev uses vite proxy
const BASE = window.__API_BASE__ ?? '/api';

export const AUTH_REQUIRED_EVENT = 'flybudget:auth-required';

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Server mode: the session expired or was signed out elsewhere — show the login screen
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw new Error(body.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
