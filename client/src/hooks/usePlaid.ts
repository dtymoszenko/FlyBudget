import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as plaidApi from '../api/plaid';

export function usePlaidStatus() {
  return useQuery({
    queryKey: ['plaid-status'],
    queryFn: plaidApi.getPlaidStatus,
    staleTime: Infinity,
  });
}

export function usePlaidItems() {
  return useQuery({
    queryKey: ['plaid-items'],
    queryFn: plaidApi.getPlaidItems,
  });
}

export function useConfigurePlaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: plaidApi.configurePlaid,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaid-status'] });
    },
  });
}

export function useMapAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      mappings,
    }: {
      itemId: string;
      mappings: plaidApi.AccountMappingAction[];
    }) => plaidApi.mapAccounts(itemId, mappings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaid-items'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useSyncItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: plaidApi.syncItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaid-items'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useSyncAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => plaidApi.syncAll(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaid-items'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useDisconnectItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: plaidApi.disconnectItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plaid-items'] });
    },
  });
}
