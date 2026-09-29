import { apiFetch } from './client';

// How FlyBudget runs (sidebar server status, Settings → Server). Signed-in only.

export type SecurityCheckId =
  'https' | 'trustProxy' | 'allowedHosts' | 'encryptionKey' | 'password';

export interface SecurityCheck {
  id: SecurityCheckId;
  ok: boolean;
  reason?: 'secure' | 'local' | 'insecure' | 'untrusted-proxy' | 'no-proxy-seen';
}

export interface ServerInfo {
  mode: 'desktop' | 'server' | 'dev';
  version: string;
  /** Server mode only */
  checks?: SecurityCheck[];
}

export const getServerInfo = () => apiFetch<ServerInfo>('/server/info');

/** A signed-in browser (server mode). `id` is opaque: it can't be used to sign in. */
export interface SignedInDevice {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  userAgent: string | null;
  current: boolean;
}

export const getSessions = () => apiFetch<SignedInDevice[]>('/auth/sessions');

export const signOutSession = (id: string) =>
  apiFetch<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const signOutOtherSessions = () =>
  apiFetch<{ signedOut: number }>('/auth/sessions/sign-out-others', { method: 'POST' });
