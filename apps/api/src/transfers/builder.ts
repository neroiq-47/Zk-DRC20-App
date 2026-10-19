import { createHash } from 'node:crypto';
import { txidFromHex } from '../chain/dogecoin.js';

export type StepKind = 'inscription' | 'transfer' | 'other';

export interface PrepareStepInput {
  transferId: string;
  stepIndex: number;
  kind: StepKind;
  fromAddress: string;
  recipientAddress: string;
  ticker: string;
  amountBaseUnits: string;
  decimals: number;
  /** txids of earlier steps (e.g. the inscription the transfer step spends). */
  previousTxids: string[];
}

export interface PreparedStep {
  provider_format: 'psbt_hex' | 'unsigned_tx_hex';
  data: string;
  network_fee_koinu: string;
}

/**
 * Builds unsigned transactions for the user's external wallet to sign. Implementations never see
 * private keys. A production builder needs UTXO selection for `fromAddress`, DRC-20 inscription
 * construction (commit/reveal), fee estimation, and full validation of the signed tx against the
 * unsigned template (same inputs/outputs) in verifySigned().
 */
export interface TransferBuilder {
  readonly id: string;
  prepareStep(input: PrepareStepInput): Promise<PreparedStep>;
  /** Verifies the signed payload is a signature of exactly `unsignedData`; returns its txid. */
  verifySigned(unsignedData: string, signedHex: string): Promise<{ txid: string }>;
}

export class SignedPayloadMismatchError extends Error {}

/**
 * Development/test builder (TRANSFER_BUILDER=simulated, refused in production). The "unsigned tx" is
 * a hex-encoded JSON template; a "signed tx" is that exact hex followed by a >= 64 hex-char simulated
 * signature. Binding is enforced by prefix equality, so a signature for another step or an edited
 * template is rejected. The resulting hex is accepted only by SimulatedChain.
 */
export class SimulatedTransferBuilder implements TransferBuilder {
  readonly id = 'simulated';

  async prepareStep(input: PrepareStepInput): Promise<PreparedStep> {
    const template = {
      sim: 'zoko-simulated-tx-v1',
      network: 'dogecoin-mainnet',
      transfer_id: input.transferId,
      step_index: input.stepIndex,
      kind: input.kind,
      from: input.fromAddress,
      to: input.kind === 'inscription' ? input.fromAddress : input.recipientAddress,
      inscription:
        input.kind === 'inscription' ? { p: 'drc-20', op: 'transfer', tick: input.ticker, amt: formatUnits(input.amountBaseUnits, input.decimals) } : undefined,
      spends: input.previousTxids,
      nonce: createHash('sha256').update(`${input.transferId}:${input.stepIndex}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16),
    };
    return {
      provider_format: 'unsigned_tx_hex',
      data: Buffer.from(JSON.stringify(template), 'utf8').toString('hex'),
      network_fee_koinu: input.kind === 'inscription' ? '50000000' : '1000000',
    };
  }

  async verifySigned(unsignedData: string, signedHex: string): Promise<{ txid: string }> {
    const s = signedHex.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(s) || s.length % 2) throw new SignedPayloadMismatchError('Signed payload must be hex.');
    if (!s.startsWith(unsignedData.toLowerCase()) || s.length < unsignedData.length + 64) {
      throw new SignedPayloadMismatchError('Signed payload does not match the prepared transaction.');
    }
    return { txid: txidFromHex(s) };
  }

  /** Dev helper used by the dev endpoint and tests to emulate a wallet signature. */
  static simulateSignature(unsignedData: string): string {
    return unsignedData + createHash('sha256').update(`simsig:${unsignedData}`).digest('hex');
  }
}

/** Formats base units as a decimal string (DRC-20 inscriptions carry human amounts). */
export function formatUnits(amount: string, decimals: number): string {
  const v = BigInt(amount);
  if (decimals === 0) return v.toString();
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}
