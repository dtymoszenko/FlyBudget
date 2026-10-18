import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ebApi from '../api/enableBanking';
import type { EnableBankingAuthPoll, EnableBankingConnectionResult } from '../types';

export function useEnableBankingStatus() {
  return useQuery({
    queryKey: ['enable-banking-status'],
    queryFn: ebApi.getEnableBankingStatus,
  });
}

export function useEnableBankingConnections() {
  return useQuery({
    queryKey: ['enable-banking-connections'],
    queryFn: ebApi.getEnableBankingConnections,
  });
}

/** The banks Enable Banking offers in a country (none until a country is chosen). */
export function useEnableBankingBanks(country: string | null) {
  return useQuery({
    queryKey: ['enable-banking-banks', country],
    queryFn: () => ebApi.getEnableBankingBanks(country!),
    enabled: !!country,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

export function useConfigureEnableBanking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ applicationId, privateKey }: { applicationId: string; privateKey: string }) =>
      ebApi.configureEnableBanking(applicationId, privateKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enable-banking-status'] });
      qc.removeQueries({ queryKey: ['enable-banking-banks'] });
    },
  });
}

export function useRemoveEnableBankingConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ebApi.removeEnableBankingConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enable-banking-status'] });
      qc.removeQueries({ queryKey: ['enable-banking-banks'] });
    },
  });
}

export function useMapEnableBankingAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      connectionId,
      mappings,
    }: {
      connectionId: string;
      mappings: ebApi.EnableBankingMappingAction[];
    }) => ebApi.mapEnableBankingAccounts(connectionId, mappings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enable-banking-connections'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

function useInvalidateAfterSync() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['enable-banking-connections'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
  };
}

export function useSyncEnableBankingConnection() {
  const invalidate = useInvalidateAfterSync();
  return useMutation({
    mutationFn: ({ connectionId, fullHistory }: { connectionId: string; fullHistory?: string[] }) =>
      ebApi.syncEnableBankingConnection(connectionId, fullHistory),
    onSettled: invalidate,
  });
}

export function useSyncAllEnableBanking() {
  const invalidate = useInvalidateAfterSync();
  return useMutation({
    mutationFn: () => ebApi.syncAllEnableBanking(),
    onSettled: invalidate,
  });
}

export function useDisconnectEnableBanking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ebApi.disconnectEnableBanking,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enable-banking-connections'] });
      qc.invalidateQueries({ queryKey: ['enable-banking-status'] });
    },
  });
}

const POLL_INTERVAL_MS = 3_000;

export type BankLoginState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'waiting'; url: string }
  | { phase: 'error'; message: string };

/**
 * Logs in at a bank through Enable Banking. The bank's page opens in the user's own browser
 * (in the desktop app, window.open goes to the system browser), and the bank sends them back
 * to FlyBudget's redirect URL; meanwhile this polls the server until the login is in. If
 * the redirect can't reach FlyBudget, `paste` takes the address the browser ended up on.
 */
export function useEnableBankingLogin(onSuccess: (result: EnableBankingConnectionResult) => void) {
  const qc = useQueryClient();
  const [state, setState] = useState<BankLoginState>({ phase: 'idle' });
  const login = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped by every start, finish and unmount: a start that resolves after it was cancelled is dropped */
  const attempt = useRef(0);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const stopPolling = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const finish = useCallback(
    (next: BankLoginState) => {
      stopPolling();
      attempt.current++;
      login.current = null;
      setState(next);
    },
    [stopPolling],
  );

  /** Acts on a poll answer; returns whether the login is over. */
  const handle = useCallback(
    (authId: string, res: EnableBankingAuthPoll) => {
      if (login.current !== authId) return true;
      if (res.status === 'success') {
        finish({ phase: 'idle' });
        qc.invalidateQueries({ queryKey: ['enable-banking-connections'] });
        qc.invalidateQueries({ queryKey: ['enable-banking-status'] });
        onSuccessRef.current(res.result);
        return true;
      }
      if (res.status === 'error') {
        finish({ phase: 'error', message: res.message });
        return true;
      }
      if (res.status === 'expired') {
        finish({ phase: 'error', message: 'The bank login took too long. Please try again.' });
        return true;
      }
      return false;
    },
    [finish, qc],
  );

  const poll = useCallback(
    async (authId: string) => {
      if (login.current !== authId) return;
      try {
        if (handle(authId, await ebApi.pollEnableBankingLogin(authId))) return;
      } catch (err) {
        return finish({ phase: 'error', message: (err as Error).message });
      }
      timer.current = setTimeout(() => poll(authId), POLL_INTERVAL_MS);
    },
    [finish, handle],
  );

  /** Call straight from a click handler, so the browser allows the bank's tab to open. */
  const start = useCallback(
    async (target: ebApi.EnableBankingLoginTarget) => {
      stopPolling();
      const mine = ++attempt.current;
      setState({ phase: 'starting' });
      // Open the tab now, while the click still counts: browsers block a window opened after
      // waiting for the server. It's pointed at the bank once its address is known. (The
      // desktop app opens the system browser instead and returns no window here.)
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      try {
        const { authId, url } = await ebApi.startEnableBankingLogin(target);
        if (attempt.current !== mine) {
          // Cancelled (or the dialog closed) while the server was answering
          tab?.close();
          ebApi.cancelEnableBankingLogin(authId).catch(() => {});
          return;
        }
        login.current = authId;
        if (tab && !tab.closed) tab.location.href = url;
        else window.open(url, '_blank', 'noopener,noreferrer');
        setState({ phase: 'waiting', url });
        timer.current = setTimeout(() => poll(authId), POLL_INTERVAL_MS);
      } catch (err) {
        tab?.close();
        if (attempt.current !== mine) return;
        setState({ phase: 'error', message: (err as Error).message });
      }
    },
    [poll, stopPolling],
  );

  /** The address the user's browser landed on after the bank login. Throws if it's refused. */
  const paste = useCallback(
    async (url: string) => {
      const authId = login.current;
      if (!authId) return;
      handle(authId, await ebApi.completeEnableBankingLogin(authId, url));
    },
    [handle],
  );

  const reopen = useCallback(() => {
    if (state.phase === 'waiting') window.open(state.url, '_blank', 'noopener,noreferrer');
  }, [state]);

  const cancel = useCallback(() => {
    const id = login.current;
    finish({ phase: 'idle' });
    if (id) ebApi.cancelEnableBankingLogin(id).catch(() => {});
  }, [finish]);

  // Stop polling and drop the login if the dialog goes away
  useEffect(
    () => () => {
      stopPolling();
      attempt.current++;
      if (login.current) ebApi.cancelEnableBankingLogin(login.current).catch(() => {});
      login.current = null;
    },
    [stopPolling],
  );

  return { state, start, paste, reopen, cancel };
}
