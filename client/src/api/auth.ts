import { apiFetch } from './client';

// Login for server mode (Docker / self-hosted). The desktop app and `npm run dev`
// report `enabled: false` and never show a login screen.

export interface AuthStatus {
  enabled: boolean;
  needsSetup: boolean;
  authenticated: boolean;
}

export const getAuthStatus = () => apiFetch<AuthStatus>('/auth/status');

export const setupPassword = (password: string) =>
  apiFetch<void>('/auth/setup', { method: 'POST', body: JSON.stringify({ password }) });

export const login = (password: string) =>
  apiFetch<void>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) });

export const logout = () => apiFetch<void>('/auth/logout', { method: 'POST' });

export const changePassword = (currentPassword: string, newPassword: string) =>
  apiFetch<void>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
