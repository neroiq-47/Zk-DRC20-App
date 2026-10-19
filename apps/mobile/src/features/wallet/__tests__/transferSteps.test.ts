import { describe, expect, it } from '@jest/globals';
import type { Transfer, TransferStatus, TransferStep } from '@zoko/contracts';
import { canCancel, confirmationProgress, currentStepKey, isTerminalStatus, nextAction, transferStepStates } from '../transferSteps';

function step(partial: Partial<TransferStep> = {}): TransferStep {
  return { id: 's1', step_index: 0, kind: 'transfer', status: 'prepared', txid: null, confirmations: 0, ...partial };
}

function transfer(status: TransferStatus, steps: TransferStep[] = [], extra: Partial<Transfer> = {}): Transfer {
  return {
    id: 't1',
    status,
    wallet_id: 'w1',
    from_address: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
    token: { id: 'k1', ticker: 'dogi', decimals: 18, max_supply: null, deploy_txid: 'x' },
    recipient_address: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
    amount_base_units: '1',
    network_fee_koinu: null,
    required_confirmations: 6,
    steps,
    error_code: null,
    error_detail: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

const states = (t: Transfer) => transferStepStates(t).map((s) => s.state);

describe('transferStepStates', () => {
  it('draft: prepare is current', () => {
    expect(states(transfer('draft'))).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('prepared / awaiting_signature: signing is current', () => {
    expect(states(transfer('prepared'))).toEqual(['complete', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(states(transfer('awaiting_signature'))).toEqual(['complete', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('signed: broadcast is current', () => {
    expect(states(transfer('signed'))).toEqual(['complete', 'complete', 'complete', 'current', 'upcoming', 'upcoming']);
  });

  it('broadcast / confirming: waiting for confirmation, never confirmed', () => {
    const t = transfer('confirming', [step({ status: 'confirming', txid: 'ab', confirmations: 9 })]);
    expect(states(t)).toEqual(['complete', 'complete', 'complete', 'complete', 'current', 'upcoming']);
    expect(states(transfer('broadcast'))[5]).toBe('upcoming');
    // Confirmations beyond the requirement are capped until the server says confirmed.
    expect(confirmationProgress(t)).toEqual({ confirmations: 6, required: 6 });
  });

  it('confirmed: everything complete', () => {
    expect(states(transfer('confirmed'))).toEqual(Array(6).fill('complete'));
    expect(confirmationProgress(transfer('confirmed'))).toEqual({ confirmations: 6, required: 6 });
  });

  it('failed before signing marks the signing step failed', () => {
    const t = transfer('failed', [step({ status: 'failed' })], { network_fee_koinu: '100000' });
    expect(currentStepKey(t)).toBe('sign');
    expect(states(t)).toEqual(['complete', 'failed', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('failed with a txid marks confirmation failed', () => {
    const t = transfer('failed', [step({ status: 'failed', txid: 'ab' })]);
    expect(states(t)[4]).toBe('failed');
  });

  it('failed with nothing prepared marks prepare failed', () => {
    expect(states(transfer('failed'))[0]).toBe('failed');
  });

  it('reorged marks confirmation failed but keeps polling', () => {
    const t = transfer('reorged', [step({ status: 'reorged', txid: 'ab', confirmations: 0 })]);
    expect(states(t)).toEqual(['complete', 'complete', 'complete', 'complete', 'failed', 'upcoming']);
    expect(isTerminalStatus('reorged')).toBe(false);
  });

  it('cancelled marks the stopped step', () => {
    const t = transfer('cancelled', [step({ status: 'signed' })]);
    expect(states(t)).toEqual(['complete', 'complete', 'complete', 'stopped', 'upcoming', 'upcoming']);
  });
});

describe('helpers', () => {
  it('terminal statuses', () => {
    expect(isTerminalStatus('confirmed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('confirming')).toBe(false);
  });

  it('cancel only before broadcast', () => {
    expect(canCancel('signed')).toBe(true);
    expect(canCancel('broadcast')).toBe(false);
    expect(canCancel('confirming')).toBe(false);
  });

  it('next action', () => {
    expect(nextAction('draft')).toBe('prepare');
    expect(nextAction('awaiting_signature')).toBe('sign');
    expect(nextAction('signed')).toBe('broadcast');
    expect(nextAction('confirming')).toBe('none');
    const steps = [
      { id: 'a', step_index: 0, kind: 'inscription' as const, status: 'broadcast' as const, txid: 'ab', confirmations: 0 },
      { id: 'b', step_index: 1, kind: 'transfer' as const, status: 'draft' as const, txid: null, confirmations: 0 },
    ];
    expect(nextAction('broadcast', steps)).toBe('prepare');
    expect(currentStepKey({ status: 'broadcast', steps, network_fee_koinu: '1' })).toBe('prepare');
  });

  it('confirmation progress uses latest broadcast step', () => {
    const t = transfer('confirming', [
      step({ id: 'a', step_index: 0, txid: 'aa', confirmations: 10, status: 'confirmed' }),
      step({ id: 'b', step_index: 1, txid: 'bb', confirmations: 2, status: 'confirming' }),
    ]);
    expect(confirmationProgress(t)).toEqual({ confirmations: 2, required: 6 });
  });
});
