import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Page, SigningStep, Transfer, TransferStatus } from '@zoko/contracts';
import type pg from 'pg';
import type { AppDeps } from '../context.js';
import { many, one, tx } from '../db.js';
import { requireAuth } from '../auth/hook.js';
import { HttpProblem, notFound } from '../lib/errors.js';
import { parse, pageQuery } from '../lib/validate.js';
import { cursorTs, decodeCursor, pageFrom } from '../lib/cursor.js';
import { withIdempotency } from '../lib/idempotency.js';
import { sha256Hex } from '../auth/tokens.js';
import { txidFromHex } from '../chain/dogecoin.js';
import { refreshWalletBalances } from '../indexer/reconcile.js';
import { validateAddressOrThrow } from './wallet.js';
import { loadTransfers, setTransferStatus } from '../transfers/service.js';
import { CANCELLABLE } from '../transfers/stateMachine.js';
import { SignedPayloadMismatchError, type StepKind } from '../transfers/builder.js';

const SIGNING_TTL_MS = 10 * 60 * 1000;
const STEP_KINDS: StepKind[] = ['inscription', 'transfer'];
const OPEN_STATUSES: TransferStatus[] = ['draft', 'prepared', 'awaiting_signature', 'signed', 'broadcast', 'confirming'];

const createSchema = z.object({
  wallet_id: z.uuid(),
  token_id: z.uuid(),
  recipient_address: z.string().trim().min(1).max(64),
  amount_base_units: z.string().regex(/^[1-9][0-9]*$/, 'Enter a whole number of base units greater than zero.').max(78),
});
const signedSchema = z.object({
  step_id: z.uuid(),
  signed_payload: z.string().trim().min(2).max(400_000).regex(/^[0-9a-fA-F]+$/, 'Paste the signed transaction hex.'),
});
const idParams = z.object({ id: z.uuid() });

async function lockOwned(c: pg.PoolClient, id: string, userId: string) {
  const t = await one(
    c,
    `SELECT tr.*, w.address AS from_address, w.revoked_at AS wallet_revoked, tk.ticker, tk.decimals
       FROM transfers tr JOIN wallet_connections w ON w.id = tr.wallet_id JOIN drc20_tokens tk ON tk.id = tr.token_id
      WHERE tr.id = $1 AND tr.user_id = $2 FOR UPDATE OF tr`,
    [id, userId],
  );
  if (!t) throw notFound('Transfer');
  return t;
}

const invalidState = (status: string, action: string) =>
  new HttpProblem(409, 'invalid_transfer_state', `A transfer that is ${status.replace('_', ' ')} can’t be ${action}.`);

export default async function transferRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps;

  app.post('/transfers', async (req, reply) => {
    const me = requireAuth(req);
    const body = parse(createSchema, req.body);
    validateAddressOrThrow(body.recipient_address, 'recipient_address');
    const wallet = await one(db, `SELECT id, address FROM wallet_connections WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [
      body.wallet_id,
      me.id,
    ]);
    if (!wallet) throw new HttpProblem(422, 'wallet_not_connected', 'Connect this wallet first.', { wallet_id: 'Connect this wallet first.' });
    const token = await one(db, `SELECT id FROM drc20_tokens WHERE id = $1`, [body.token_id]);
    if (!token) throw new HttpProblem(422, 'unknown_token', 'Unknown token.', { token_id: 'Unknown token.' });
    // Fresh balances from the independent indexers before accepting the intent.
    await refreshWalletBalances(deps, wallet).catch(() => undefined);

    const res = await withIdempotency<Transfer>(db, req, me.id, 'POST /transfers', async (c) => {
      const bal = await one(
        c,
        `SELECT amount_base_units::text AS amount, status FROM asset_balances WHERE wallet_id = $1 AND token_id = $2 FOR UPDATE`,
        [wallet.id, token.id],
      );
      if (!bal) throw new HttpProblem(422, 'insufficient_balance', 'This wallet has no balance of this token.');
      if (bal.status === 'disputed') {
        throw new HttpProblem(409, 'balance_disputed', 'Indexers disagree about this balance, so transfers are paused. Try again later.');
      }
      if (bal.status !== 'confirmed') {
        throw new HttpProblem(409, 'balance_unverified', 'We couldn’t verify this balance with independent indexers yet. Try again later.');
      }
      const pending = await one(
        c,
        `SELECT COALESCE(sum(amount_base_units), 0)::text AS sum FROM transfers
          WHERE wallet_id = $1 AND token_id = $2 AND status = ANY($3::transfer_status[])`,
        [wallet.id, token.id, OPEN_STATUSES],
      );
      if (BigInt(bal.amount) - BigInt(pending.sum) < BigInt(body.amount_base_units)) {
        throw new HttpProblem(422, 'insufficient_balance', 'Not enough balance for this transfer.', {
          amount_base_units: 'Not enough balance for this transfer.',
        });
      }
      const key = String(req.headers['idempotency-key']);
      const t = await one(
        c,
        `INSERT INTO transfers (user_id, wallet_id, token_id, recipient_address, amount_base_units, idempotency_key, provider, required_confirmations)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [me.id, wallet.id, token.id, body.recipient_address, body.amount_base_units, key, deps.builder?.id ?? null, deps.config.requiredConfirmations],
      );
      for (const [i, kind] of STEP_KINDS.entries()) {
        await c.query(`INSERT INTO transfer_steps (transfer_id, step_index, kind) VALUES ($1, $2, $3)`, [t.id, i, kind]);
      }
      await c.query(`INSERT INTO transfer_events (transfer_id, from_status, to_status, reason) VALUES ($1, NULL, 'draft', 'created')`, [t.id]);
      const [out] = await loadTransfers(c, [t.id]);
      return { status: 201, body: out };
    });
    return reply.code(res.status).send(res.body);
  });

  app.get('/transfers', async (req): Promise<Page<Transfer>> => {
    const me = requireAuth(req);
    const q = parse(pageQuery, req.query);
    const cur = decodeCursor(q.cursor);
    const rows = await many(
      db,
      `SELECT id AS _ci, ${cursorTs('created_at')} AS _ct FROM transfers
        WHERE user_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
        ORDER BY created_at DESC, id DESC LIMIT $4`,
      [me.id, cur?.t ?? null, cur?.i ?? null, q.limit + 1],
    );
    const page = pageFrom(rows, q.limit);
    return { items: await loadTransfers(db, page.rows.map((r) => r._ci)), next_cursor: page.next_cursor };
  });

  app.get('/transfers/:id', async (req) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const owned = await one(db, `SELECT 1 FROM transfers WHERE id = $1 AND user_id = $2`, [id, me.id]);
    if (!owned) throw notFound('Transfer');
    return (await loadTransfers(db, [id]))[0];
  });

  app.post('/transfers/:id/prepare', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const builder = deps.builder;
    if (!builder) {
      // Never fake success: without a real transaction builder nothing can be signed.
      throw new HttpProblem(501, 'transfer_builder_unavailable', 'Transfers are not available yet on this server.');
    }
    const signing = await tx(db, async (c, after) => {
      const t = await lockOwned(c, id, me.id);
      if (t.wallet_revoked) throw new HttpProblem(409, 'wallet_not_connected', 'This wallet was disconnected.');
      if (!['draft', 'awaiting_signature', 'signed', 'broadcast'].includes(t.status)) throw invalidState(t.status, 'prepared');
      const steps = await many(c, `SELECT * FROM transfer_steps WHERE transfer_id = $1 ORDER BY step_index FOR UPDATE`, [id]);
      const step = steps.find((s) => ['draft', 'awaiting_signature', 'signed'].includes(s.status));
      if (!step) throw new HttpProblem(409, 'nothing_to_prepare', 'Every step of this transfer has been broadcast.');
      const previous = steps.filter((s) => s.step_index < step.step_index);
      if (previous.some((s) => !s.txid || !['broadcast', 'confirming', 'confirmed'].includes(s.status))) {
        throw new HttpProblem(409, 'previous_step_pending', 'Finish the previous step first.');
      }
      const prepared = await builder.prepareStep({
        transferId: id,
        stepIndex: step.step_index,
        kind: step.kind,
        fromAddress: t.from_address,
        recipientAddress: t.recipient_address,
        ticker: t.ticker,
        amountBaseUnits: String(t.amount_base_units),
        decimals: t.decimals,
        previousTxids: previous.map((s) => s.txid),
      });
      const expiresAt = new Date(Date.now() + SIGNING_TTL_MS);
      await c.query(
        `UPDATE transfer_steps SET status = 'awaiting_signature', provider_format = $2, unsigned_payload = $3, unsigned_payload_hash = $4,
            network_fee_koinu = $5, prepare_expires_at = $6, signed_payload = NULL, signed_payload_hash = NULL, txid = NULL, updated_at = now()
          WHERE id = $1`,
        [step.id, prepared.provider_format, prepared.data, sha256Hex(prepared.data), prepared.network_fee_koinu, expiresAt],
      );
      await c.query(
        `UPDATE transfers SET prepare_payload = $2, prepare_expires_at = $3,
            network_fee_koinu = (SELECT sum(network_fee_koinu) FROM transfer_steps WHERE transfer_id = $1) WHERE id = $1`,
        [id, JSON.stringify({ step_id: step.id, provider_format: prepared.provider_format }), expiresAt],
      );
      await setTransferStatus(deps, c, after, id, 'prepared', { reason: `step ${step.step_index} prepared` });
      await setTransferStatus(deps, c, after, id, 'awaiting_signature', { reason: `step ${step.step_index} sent to wallet` });
      const out: SigningStep = {
        step_id: step.id,
        step_index: step.step_index,
        kind: step.kind,
        wallet_payload: { provider_format: prepared.provider_format, data: prepared.data },
        network_fee_koinu: prepared.network_fee_koinu,
        expires_at: expiresAt.toISOString(),
      };
      return out;
    });
    return reply.code(201).send(signing);
  });

  app.post('/transfers/:id/signed', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const body = parse(signedSchema, req.body);
    const builder = deps.builder;
    if (!builder) throw new HttpProblem(501, 'transfer_builder_unavailable', 'Transfers are not available yet on this server.');
    await tx(db, async (c, after) => {
      const t = await lockOwned(c, id, me.id);
      if (t.status !== 'awaiting_signature') throw invalidState(t.status, 'signed');
      const step = await one(c, `SELECT * FROM transfer_steps WHERE transfer_id = $1 AND status = 'awaiting_signature' FOR UPDATE`, [id]);
      if (!step || step.id !== body.step_id) throw new HttpProblem(409, 'step_mismatch', 'This signature is for a different step.');
      if (!step.prepare_expires_at || new Date(step.prepare_expires_at) <= new Date()) {
        throw new HttpProblem(410, 'signing_step_expired', 'This signing request expired. Prepare it again.');
      }
      if (sha256Hex(step.unsigned_payload) !== step.unsigned_payload_hash) throw new Error('unsigned payload integrity check failed');
      let txid: string;
      try {
        ({ txid } = await builder.verifySigned(step.unsigned_payload, body.signed_payload));
      } catch (err) {
        if (err instanceof SignedPayloadMismatchError) {
          throw new HttpProblem(422, 'signed_payload_mismatch', err.message, { signed_payload: err.message });
        }
        throw err;
      }
      const signed = body.signed_payload.toLowerCase();
      if (txidFromHex(signed) !== txid) throw new HttpProblem(422, 'signed_payload_mismatch', 'Signed transaction id mismatch.');
      const dup = await one(c, `SELECT 1 FROM transfer_steps WHERE txid = $1 AND id <> $2`, [txid, step.id]);
      if (dup) throw new HttpProblem(409, 'duplicate_transaction', 'This transaction was already submitted.');
      await c.query(
        `UPDATE transfer_steps SET status = 'signed', signed_payload = $2, signed_payload_hash = $3, txid = $4, updated_at = now() WHERE id = $1`,
        [step.id, signed, sha256Hex(signed), txid],
      );
      await setTransferStatus(deps, c, after, id, 'signed', { reason: `step ${step.step_index} signed` });
    });
    return reply.code(201).send((await loadTransfers(db, [id]))[0]);
  });

  app.post('/transfers/:id/broadcast', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const chain = deps.chain;
    if (!chain) throw new HttpProblem(503, 'chain_unavailable', 'The Dogecoin network connection is unavailable. Try again later.');
    await tx(db, async (c, after) => {
      const t = await lockOwned(c, id, me.id);
      if (t.status !== 'signed') throw invalidState(t.status, 'broadcast');
      const step = await one(c, `SELECT * FROM transfer_steps WHERE transfer_id = $1 AND status = 'signed' FOR UPDATE`, [id]);
      if (!step) throw invalidState(t.status, 'broadcast');
      const fail = async (code: string, detail: string) => {
        await c.query(`UPDATE transfer_steps SET status = 'failed', updated_at = now() WHERE id = $1`, [step.id]);
        await setTransferStatus(deps, c, after, id, 'failed', { reason: code, errorCode: code, errorDetail: detail.slice(0, 500) });
      };
      const check = await chain.testMempoolAccept(step.signed_payload);
      if (!check.allowed) return fail('broadcast_rejected', check.reason ?? 'Rejected by the network.');
      let txid: string;
      try {
        txid = await chain.sendRawTransaction(step.signed_payload);
      } catch (err) {
        return fail('broadcast_failed', (err as Error).message);
      }
      if (txid !== step.txid) return fail('txid_mismatch', `Node returned ${txid}, expected ${step.txid}.`);
      await c.query(`UPDATE transfer_steps SET status = 'broadcast', updated_at = now() WHERE id = $1`, [step.id]);
      await setTransferStatus(deps, c, after, id, 'broadcast', { reason: `step ${step.step_index} broadcast`, errorCode: null, errorDetail: null });
    });
    return reply.code(201).send((await loadTransfers(db, [id]))[0]);
  });

  app.post('/transfers/:id/cancel', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await tx(db, async (c, after) => {
      const t = await lockOwned(c, id, me.id);
      const broadcastSteps = await one(
        c,
        `SELECT count(*)::int AS n FROM transfer_steps WHERE transfer_id = $1 AND status IN ('broadcast','confirming','confirmed','reorged')`,
        [id],
      );
      if (!CANCELLABLE.includes(t.status) || broadcastSteps.n > 0) throw invalidState(t.status, 'cancelled');
      await c.query(`UPDATE transfer_steps SET status = 'cancelled', updated_at = now() WHERE transfer_id = $1`, [id]);
      await setTransferStatus(deps, c, after, id, 'cancelled', { reason: 'cancelled by user' });
    });
    return reply.code(201).send((await loadTransfers(db, [id]))[0]);
  });
}
