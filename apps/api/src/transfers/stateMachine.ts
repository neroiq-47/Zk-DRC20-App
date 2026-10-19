import type { TransferStatus } from '@zoko/contracts';

/**
 * Server-enforced transfer state machine. A DRC-20 transfer has two on-chain steps (inscription, then
 * transfer); after the inscription step is broadcast the transfer goes back to 'prepared' for the next
 * step. Every change goes through assertTransition() and is recorded in transfer_events.
 */
export const TRANSITIONS: Record<TransferStatus, readonly TransferStatus[]> = {
  draft: ['prepared', 'cancelled', 'failed'],
  // 'reorged' from the mid-flow states covers an earlier step (the inscription) being orphaned.
  prepared: ['awaiting_signature', 'cancelled', 'failed', 'reorged'],
  awaiting_signature: ['signed', 'prepared', 'cancelled', 'failed', 'reorged'],
  signed: ['broadcast', 'prepared', 'cancelled', 'failed', 'reorged'],
  broadcast: ['prepared', 'confirming', 'failed', 'reorged'],
  confirming: ['confirmed', 'reorged', 'failed'],
  // A reorged tx may be mined again on the new canonical chain.
  reorged: ['confirming', 'failed'],
  // Defensive: a reorg deeper than the confirmation depth must still be reported honestly.
  confirmed: ['reorged'],
  failed: [],
  cancelled: [],
};

export const CANCELLABLE: readonly TransferStatus[] = ['draft', 'prepared', 'awaiting_signature', 'signed'];

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TransferStatus,
    readonly to: TransferStatus,
  ) {
    super(`Transfer cannot move from ${from} to ${to}.`);
  }
}

export function assertTransition(from: TransferStatus, to: TransferStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
