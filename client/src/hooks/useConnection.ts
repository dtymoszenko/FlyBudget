import { useEffect, useState } from 'react';
import {
  retryConnectionNow,
  useConnectionStore,
  type ConnectionStatus,
} from '../store/connectionStore';
import { secondsUntil, waitProgress } from '../utils/connection';

/** The current time, updated every `intervalMs` while `active`. */
function useNow(active: boolean, intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

export interface Connection {
  status: ConnectionStatus;
  /** A health check is running right now */
  checking: boolean;
  /** Waiting for this tab to be visible again */
  paused: boolean;
  /** Seconds until the next automatic check (null while checking or paused) */
  secondsLeft: number | null;
  /** 0..1 through the wait for the next check */
  progress: number;
  retryNow: () => Promise<void>;
}

/** Connection state with a live countdown to the next retry. */
export function useConnection(): Connection {
  const { status, checking, paused, retryAt, waitStartedAt } = useConnectionStore();
  const now = useNow(status === 'reconnecting' && retryAt !== null);
  return {
    status,
    checking,
    paused,
    secondsLeft: retryAt === null ? null : secondsUntil(now, retryAt),
    progress:
      retryAt === null || waitStartedAt === null ? 0 : waitProgress(now, waitStartedAt, retryAt),
    retryNow: retryConnectionNow,
  };
}

/**
 * False while FlyBudget can't reach its server. Save buttons are disabled then, so
 * nothing looks saved that wasn't (show <SavingPausedHint /> next to them).
 */
export const useCanSave = () => useConnectionStore((s) => s.status === 'connected');
