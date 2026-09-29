import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as authApi from '../api/auth';
import * as serverApi from '../api/server';
import { clearOutbox } from '../offline/outbox';
import { clearOfflineCopy } from '../offline/snapshot';

/** Login status (server mode). Shared with AuthGate, which fetched it on startup. */
export const useAuthStatus = () =>
  useQuery({ queryKey: ['auth-status'], queryFn: authApi.getAuthStatus, staleTime: Infinity });

export const useServerInfo = () =>
  useQuery({ queryKey: ['server-info'], queryFn: serverApi.getServerInfo, staleTime: 5 * 60_000 });

export type AppMode = 'desktop' | 'server' | 'dev';

/**
 * How FlyBudget runs, as far as this page can tell: the desktop app (its preload sets
 * __API_BASE__), a self-hosted server (login enabled), or a local dev server. Before the
 * server has answered, a production web build is assumed to be a self-hosted server.
 */
export function appModeFrom(auth: authApi.AuthStatus | undefined): AppMode {
  if (window.__API_BASE__) return 'desktop';
  if (auth) return auth.enabled ? 'server' : 'dev';
  return import.meta.env.DEV ? 'dev' : 'server';
}

export const useAppMode = () => appModeFrom(useAuthStatus().data);

/** Signs this browser out (server mode) and shows the login screen. */
export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    await authApi.logout().catch(() => {});
    // Nothing of this budget stays on the device after signing out
    await Promise.all([clearOfflineCopy(), clearOutbox()]);
    // Drop the signed-in data, then re-check the status so the login screen shows. Not
    // qc.clear(): it detaches the auth-status query the app is watching, so nothing changed.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth-status' });
    await qc.invalidateQueries({ queryKey: ['auth-status'] });
  };
}

export const useSessions = (enabled: boolean) =>
  useQuery({ queryKey: ['auth-sessions'], queryFn: serverApi.getSessions, enabled });

export function useSignOutSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: serverApi.signOutSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth-sessions'] }),
  });
}

export function useSignOutOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: serverApi.signOutOtherSessions,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth-sessions'] }),
  });
}
