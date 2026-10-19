import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTransferRequest,
  Page,
  SigningStep,
  Transfer,
  WalletAssets,
  WalletChallenge,
  WalletConnection,
  WalletProvider,
} from '@zoko/contracts';
import { api } from '@/lib/api';
import { isTerminalStatus } from './transferSteps';
import { upsertTransferInPages, walletKeys, type TransferPages } from './keys';

export function useWalletProviders() {
  return useQuery({
    queryKey: walletKeys.providers,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => api<{ items: WalletProvider[] }>('/wallet/providers', { signal }).then((r) => r.items),
  });
}

export function useWalletConnections() {
  return useQuery({
    queryKey: walletKeys.connections,
    queryFn: ({ signal }) => api<{ items: WalletConnection[] }>('/wallet/connections', { signal }).then((r) => r.items),
  });
}

export function useWalletAssets(enabled = true) {
  return useQuery({
    queryKey: walletKeys.assets,
    enabled,
    queryFn: ({ signal }) => api<WalletAssets>('/wallet/assets', { signal }),
  });
}

export function useTransfers(enabled = true) {
  return useInfiniteQuery({
    queryKey: walletKeys.transfers,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => api<Page<Transfer>>('/transfers', { query: { cursor: pageParam, limit: 20 }, signal }),
    getNextPageParam: (last) => last.next_cursor,
  });
}

/** Polls every 5 seconds until the transfer reaches a terminal status. */
export function useTransfer(id: string) {
  return useQuery({
    queryKey: walletKeys.transfer(id),
    enabled: !!id,
    queryFn: ({ signal }) => api<Transfer>(`/transfers/${id}`, { signal }),
    refetchInterval: (q) => (q.state.data && isTerminalStatus(q.state.data.status) ? false : 5000),
  });
}

function useStoreTransfer() {
  const qc = useQueryClient();
  return (t: Transfer) => {
    qc.setQueryData(walletKeys.transfer(t.id), t);
    qc.setQueryData<TransferPages>(walletKeys.transfers, (d) => upsertTransferInPages(d, t));
  };
}

export function useCreateChallenge() {
  return useMutation({
    mutationFn: (body: { address: string; provider: string }) => api<WalletChallenge>('/wallet/challenges', { method: 'POST', body }),
  });
}

export function useVerifyWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { challenge_id: string; signature: string; provider: string }) =>
      api<WalletConnection>('/wallet/connections', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: walletKeys.connections });
      qc.invalidateQueries({ queryKey: walletKeys.assets });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useDisconnectWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/wallet/connections/${id}`, { method: 'DELETE' }),
    onSuccess: (_v, id) => {
      qc.setQueryData<WalletConnection[]>(walletKeys.connections, (d) => d?.filter((c) => c.id !== id));
      qc.invalidateQueries({ queryKey: walletKeys.assets });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useCreateTransfer() {
  const store = useStoreTransfer();
  return useMutation({
    // The Idempotency-Key is generated once per mutate call; retries inside api() reuse it.
    mutationFn: (body: CreateTransferRequest) => api<Transfer>('/transfers', { method: 'POST', body, idempotent: true }),
    onSuccess: store,
  });
}

export function usePrepareTransfer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SigningStep>(`/transfers/${id}/prepare`, { method: 'POST' }),
    onSuccess: (step) => {
      qc.setQueryData(walletKeys.signing(id), step);
      qc.invalidateQueries({ queryKey: walletKeys.transfer(id) });
    },
  });
}

/** The last signing payload returned by prepare, kept so the screen doesn't prepare twice. */
export function getCachedSigningStep(qc: ReturnType<typeof useQueryClient>, id: string): SigningStep | null {
  return qc.getQueryData<SigningStep>(walletKeys.signing(id)) ?? null;
}

export function useSubmitSigned(id: string) {
  const qc = useQueryClient();
  const store = useStoreTransfer();
  return useMutation({
    mutationFn: (body: { step_id: string; signed_payload: string }) => api<Transfer>(`/transfers/${id}/signed`, { method: 'POST', body }),
    onSuccess: (t) => {
      qc.removeQueries({ queryKey: walletKeys.signing(id), exact: true });
      store(t);
    },
  });
}

export function useBroadcastTransfer(id: string) {
  const store = useStoreTransfer();
  return useMutation({
    mutationFn: () => api<Transfer>(`/transfers/${id}/broadcast`, { method: 'POST' }),
    onSuccess: store,
  });
}

export function useCancelTransfer(id: string) {
  const store = useStoreTransfer();
  return useMutation({
    mutationFn: () => api<Transfer>(`/transfers/${id}/cancel`, { method: 'POST' }),
    onSuccess: store,
  });
}
