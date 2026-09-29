import { NetworkError } from '../api/client';
import type { CreateTransactionData, CreateTransferData } from '../api/transactions';
import { queueOnDevice, useOutbox } from '../offline/outbox';
import { newClientId } from '../utils/offline';
import { useCanSave } from './useConnection';
import { useCreateTransaction, useCreateTransfer } from './useTransactions';

/**
 * Whether a new transaction can be added right now, and whether it would wait on this
 * device (FlyBudget can't reach its server, but this browser can store it).
 */
export function useCanAddTransaction() {
  const canSave = useCanSave();
  const canWait = useOutbox((s) => s.available);
  return { allowed: canSave || canWait, onDevice: !canSave };
}

export type NewTransaction =
  | { kind: 'transaction'; data: CreateTransactionData }
  | { kind: 'transfer'; data: CreateTransferData };

/**
 * Adds a new transaction or transfer. Connected: saves it on the server. Not connected, or
 * the connection drops mid-save: keeps it on this device with the same id, and it's sent
 * when FlyBudget reconnects (the id stops a save that did arrive from being made twice).
 */
export function useAddTransaction() {
  const { allowed, onDevice } = useCanAddTransaction();
  const createTx = useCreateTransaction();
  const createTransfer = useCreateTransfer();

  function add(item: NewTransaction, onDone: () => void) {
    const id = newClientId();
    const keepOnDevice = () => void queueOnDevice(id, item).then(onDone);
    if (onDevice) return keepOnDevice();
    const opts = {
      onSuccess: onDone,
      onError: (err: Error) => {
        if (err instanceof NetworkError && useOutbox.getState().available) keepOnDevice();
      },
    };
    if (item.kind === 'transaction') createTx.mutate({ ...item.data, id }, opts);
    else createTransfer.mutate({ ...item.data, id }, opts);
  }

  return {
    add,
    allowed,
    onDevice,
    pending: createTx.isPending || createTransfer.isPending,
  };
}
