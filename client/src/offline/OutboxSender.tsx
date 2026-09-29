import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConnectionStore } from '../store/connectionStore';
import { sendable } from '../utils/offline';
import { sendWaiting, useOutbox } from './outbox';

/** Sends transactions saved on this device as soon as FlyBudget's server can be reached. */
export function OutboxSender() {
  const qc = useQueryClient();
  const connected = useConnectionStore((s) => s.status === 'connected');
  const waiting = useOutbox((s) => sendable(s.items).length);
  useEffect(() => {
    if (connected && waiting > 0) void sendWaiting(qc);
  }, [connected, waiting, qc]);
  return null;
}
