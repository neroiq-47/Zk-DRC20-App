import type { Transfer, TransferStatus, TransferStep } from '@zoko/contracts';

export type StepKey = 'prepare' | 'sign' | 'submit' | 'broadcast' | 'confirm' | 'confirmed';
export type StepState = 'complete' | 'current' | 'upcoming' | 'failed' | 'stopped';

export interface StepView {
  key: StepKey;
  label: string;
  state: StepState;
}

export const STEP_LABELS: Record<StepKey, string> = {
  prepare: 'Prepare',
  sign: 'Sign in your wallet',
  submit: 'Submit signature',
  broadcast: 'Broadcast',
  confirm: 'Waiting for network confirmation',
  confirmed: 'Confirmed',
};

const ORDER: StepKey[] = ['prepare', 'sign', 'submit', 'broadcast', 'confirm', 'confirmed'];

const TERMINAL: TransferStatus[] = ['confirmed', 'failed', 'cancelled'];
const CANCELLABLE: TransferStatus[] = ['draft', 'prepared', 'awaiting_signature', 'signed'];

/** No more server-side progress is expected; stop polling. 'reorged' is not terminal: it may confirm again. */
export function isTerminalStatus(status: TransferStatus): boolean {
  return TERMINAL.includes(status);
}

/** Transfers can be cancelled only before broadcast. */
export function canCancel(status: TransferStatus): boolean {
  return CANCELLABLE.includes(status);
}

/** The step the transfer is working on (or stopped at). */
export function currentStepKey(t: Pick<Transfer, 'status' | 'steps' | 'network_fee_koinu'>): StepKey {
  switch (t.status) {
    case 'draft':
      return 'prepare';
    case 'prepared':
    case 'awaiting_signature':
      return 'sign';
    case 'signed':
      return 'broadcast';
    case 'broadcast':
    case 'confirming':
    case 'reorged':
      return 'confirm';
    case 'confirmed':
      return 'confirmed';
    case 'failed':
    case 'cancelled':
      return inferStoppedAt(t);
  }
}

function inferStoppedAt(t: Pick<Transfer, 'steps' | 'network_fee_koinu'>): StepKey {
  const steps = t.steps ?? [];
  if (steps.some((s) => !!s.txid)) return 'confirm';
  if (steps.some((s) => s.status === 'signed')) return 'broadcast';
  if (steps.some((s) => s.status === 'prepared' || s.status === 'awaiting_signature') || t.network_fee_koinu) return 'sign';
  return 'prepare';
}

/** Maps a transfer to the state of each row in the vertical stepper. Pure, for tests and UI. */
export function transferStepStates(t: Pick<Transfer, 'status' | 'steps' | 'network_fee_koinu'>): StepView[] {
  const current = currentStepKey(t);
  const idx = ORDER.indexOf(current);
  return ORDER.map((key, i) => {
    let state: StepState;
    if (t.status === 'confirmed') state = 'complete';
    else if (i < idx) state = 'complete';
    else if (i > idx) state = 'upcoming';
    else if (t.status === 'failed' || t.status === 'reorged') state = 'failed';
    else if (t.status === 'cancelled') state = 'stopped';
    else state = 'current';
    return { key, label: STEP_LABELS[key], state };
  });
}

/** The on-chain step currently being confirmed (latest step with a txid). */
export function latestBroadcastStep(steps: TransferStep[]): TransferStep | null {
  const withTx = [...(steps ?? [])].filter((s) => !!s.txid).sort((a, b) => b.step_index - a.step_index);
  return withTx[0] ?? null;
}

export function confirmationProgress(t: Pick<Transfer, 'steps' | 'required_confirmations' | 'status'>): { confirmations: number; required: number } {
  const required = Math.max(1, t.required_confirmations || 1);
  const step = latestBroadcastStep(t.steps);
  const confirmations = step ? Math.max(0, step.confirmations) : 0;
  // Only the server decides 'confirmed'; never show full progress before that.
  const capped = t.status === 'confirmed' ? required : Math.min(confirmations, required);
  return { confirmations: capped, required };
}

/** What the user can do next from the transfer screen. */
export type NextAction = 'prepare' | 'sign' | 'broadcast' | 'none';
export function nextAction(status: TransferStatus): NextAction {
  switch (status) {
    case 'draft':
      return 'prepare';
    case 'prepared':
    case 'awaiting_signature':
      return 'sign';
    case 'signed':
      return 'broadcast';
    default:
      return 'none';
  }
}

export function statusHeadline(status: TransferStatus): string {
  switch (status) {
    case 'draft':
      return 'Ready to prepare';
    case 'prepared':
    case 'awaiting_signature':
      return 'Waiting for your signature';
    case 'signed':
      return 'Signed. Ready to broadcast';
    case 'broadcast':
    case 'confirming':
      return 'Waiting for network confirmation.';
    case 'confirmed':
      return 'Transfer confirmed';
    case 'failed':
      return "This transfer didn't go through";
    case 'reorged':
      return 'The network reorganized';
    case 'cancelled':
      return 'Transfer cancelled';
  }
}
