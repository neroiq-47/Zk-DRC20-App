import { ApiError } from '@/lib/api';

function codeOf(err: unknown): { status: number; code: string; detail: string } {
  if (err instanceof ApiError) {
    return { status: err.status, code: (err.problem?.code ?? err.problem?.type ?? '').toLowerCase(), detail: err.problem?.detail ?? '' };
  }
  return { status: 0, code: '', detail: '' };
}

export function isBuilderUnavailable(err: unknown): boolean {
  const { status, code } = codeOf(err);
  return code.includes('transfer_builder_unavailable') || (status === 501 && !code);
}

/** Friendly copy for wallet-proof errors (challenge and verify). */
export function walletProofErrorMessage(err: unknown): string {
  const { status, code, detail } = codeOf(err);
  if (status === 0) return "We couldn't reach Zoko. Check your connection and try again.";
  if (code.includes('expired')) return 'This message expired. Start again to get a fresh one.';
  if (code.includes('replay') || code.includes('used') || code.includes('consumed')) return 'This message was already used. Start again to get a fresh one.';
  if (code.includes('signature')) return "That signature doesn't match this address and message. Sign the exact message again with the same address, then paste the result.";
  if (code.includes('address')) return detail || "That doesn't look like a Dogecoin mainnet address.";
  if (code.includes('already') || status === 409) return detail || 'This wallet is already connected.';
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  return detail || 'Something went wrong. Try again.';
}

/** Friendly copy for transfer actions. */
export function transferErrorMessage(err: unknown): string {
  const { status, code, detail } = codeOf(err);
  if (status === 0) return "We couldn't reach Zoko. Check your connection and try again.";
  if (isBuilderUnavailable(err)) return "Transfers aren't available on this server yet.";
  if (code.includes('insufficient')) return detail || "This wallet doesn't have enough balance for this transfer and its network fee.";
  if (code.includes('expired')) return 'The signing request expired. Prepare the transaction again.';
  if (code.includes('signature') || code.includes('signed')) return detail || "We couldn't verify the signed transaction. Make sure you signed the exact payload shown.";
  if (code.includes('disputed')) return 'Independent indexers disagree on this balance, so transfers are paused for it.';
  if (status === 409) return detail || 'This transfer changed. Pull to refresh and try again.';
  return detail || 'Something went wrong. Try again.';
}
