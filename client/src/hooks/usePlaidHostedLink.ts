import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as plaidApi from '../api/plaid';
import type { PlaidExchangeResult } from '../types';

const POLL_INTERVAL_MS = 3_000;

export type HostedLinkState =
  | { phase: 'idle'; message?: string }
  | { phase: 'starting' }
  | { phase: 'waiting'; url: string }
  | { phase: 'error'; message: string };

/**
 * Connects (or reconnects) a bank with Plaid Hosted Link: Plaid's page opens in
 * the user's own browser — where OAuth banks like Chase work and credentials are
 * never typed into FlyBudget — and the app polls the local server until the user
 * finishes. In the desktop app, window.open() is routed to the system browser.
 */
export function usePlaidHostedLink(onSuccess: (result: PlaidExchangeResult | null) => void) {
  const qc = useQueryClient();
  const [state, setState] = useState<HostedLinkState>({ phase: 'idle' });
  const session = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const stopPolling = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const finish = useCallback(
    (next: HostedLinkState) => {
      stopPolling();
      session.current = null;
      setState(next);
    },
    [stopPolling],
  );

  const poll = useCallback(
    async (sessionId: string) => {
      if (session.current !== sessionId) return;
      try {
        const res = await plaidApi.pollHostedLink(sessionId);
        if (session.current !== sessionId) return;
        if (res.status === 'success') {
          finish({ phase: 'idle' });
          qc.invalidateQueries({ queryKey: ['plaid-items'] });
          onSuccessRef.current(res.result);
          return;
        }
        if (res.status === 'exited')
          return finish({ phase: 'idle', message: 'Connection cancelled.' });
        if (res.status === 'expired') {
          return finish({
            phase: 'error',
            message: 'The Plaid session expired. Please try again.',
          });
        }
      } catch (err) {
        return finish({ phase: 'error', message: (err as Error).message });
      }
      timer.current = setTimeout(() => poll(sessionId), POLL_INTERVAL_MS);
    },
    [finish, qc],
  );

  const start = useCallback(
    async (itemId?: string) => {
      stopPolling();
      setState({ phase: 'starting' });
      try {
        const { sessionId, url } = itemId
          ? await plaidApi.startUpdateHostedLink(itemId)
          : await plaidApi.startHostedLink();
        session.current = sessionId;
        window.open(url, '_blank', 'noopener,noreferrer');
        setState({ phase: 'waiting', url });
        timer.current = setTimeout(() => poll(sessionId), POLL_INTERVAL_MS);
      } catch (err) {
        setState({ phase: 'error', message: (err as Error).message });
      }
    },
    [poll, stopPolling],
  );

  const reopen = useCallback(() => {
    if (state.phase === 'waiting') window.open(state.url, '_blank', 'noopener,noreferrer');
  }, [state]);

  const cancel = useCallback(() => {
    const id = session.current;
    finish({ phase: 'idle' });
    if (id) plaidApi.cancelHostedLink(id).catch(() => {});
  }, [finish]);

  // Stop polling and drop the server-side session if the component goes away
  useEffect(
    () => () => {
      stopPolling();
      if (session.current) plaidApi.cancelHostedLink(session.current).catch(() => {});
      session.current = null;
    },
    [stopPolling],
  );

  return { state, start, reopen, cancel };
}
