import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as simplefinApi from '../api/simplefin';

export function useSimplefinConnections() {
  return useQuery({
    queryKey: ['simplefin-connections'],
    queryFn: simplefinApi.getSimplefinConnections,
  });
}

export function useSetupSimplefin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: simplefinApi.setupSimplefin,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['simplefin-status'] });
      qc.invalidateQueries({ queryKey: ['simplefin-connections'] });
    },
  });
}

export function useMapSimplefinAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      connectionId,
      mappings,
    }: {
      connectionId: string;
      mappings: simplefinApi.SimplefinAccountMappingAction[];
    }) => simplefinApi.mapSimplefinAccounts(connectionId, mappings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['simplefin-connections'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useSyncSimplefinConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: simplefinApi.syncSimplefinConnection,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['simplefin-connections'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useSyncAllSimplefin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => simplefinApi.syncAllSimplefin(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['simplefin-connections'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useDisconnectSimplefin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: simplefinApi.disconnectSimplefin,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['simplefin-connections'] });
      qc.invalidateQueries({ queryKey: ['simplefin-status'] });
    },
  });
}
