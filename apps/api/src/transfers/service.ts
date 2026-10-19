import type pg from 'pg';
import type { Transfer, TransferStatus } from '@zoko/contracts';
import type { AppDeps } from '../context.js';
import { many, one, tx, type AfterCommit, type Queryable } from '../db.js';
import { notify } from '../services/notify.js';
import { assertTransition, canTransition } from './stateMachine.js';

export function toToken(r: any, px = 't_') {
  return {
    id: r[`${px}id`],
    ticker: r[`${px}ticker`],
    decimals: r[`${px}decimals`],
    max_supply: r[`${px}max_supply`] ?? null,
    deploy_txid: r[`${px}deploy_txid`],
  };
}

/** Loads transfers with token and steps (2 queries regardless of count). */
export async function loadTransfers(db: Queryable, ids: string[]): Promise<Transfer[]> {
  if (!ids.length) return [];
  const rows = await many(
    db,
    `SELECT tr.*, w.address AS from_address,
        t.id AS t_id, t.ticker AS t_ticker, t.decimals AS t_decimals, t.max_supply::text AS t_max_supply, t.deploy_txid AS t_deploy_txid
       FROM transfers tr
       JOIN wallet_connections w ON w.id = tr.wallet_id
       JOIN drc20_tokens t ON t.id = tr.token_id
      WHERE tr.id = ANY($1::uuid[])`,
    [ids],
  );
  const steps = await many(
    db,
    `SELECT id, transfer_id, step_index, kind, status, txid, confirmations FROM transfer_steps
      WHERE transfer_id = ANY($1::uuid[]) ORDER BY transfer_id, step_index`,
    [ids],
  );
  const byId = new Map<string, Transfer>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      status: r.status,
      wallet_id: r.wallet_id,
      from_address: r.from_address,
      token: toToken(r),
      recipient_address: r.recipient_address,
      amount_base_units: String(r.amount_base_units),
      network_fee_koinu: r.network_fee_koinu === null ? null : String(r.network_fee_koinu),
      required_confirmations: r.required_confirmations,
      steps: steps
        .filter((s) => s.transfer_id === r.id)
        .map((s) => ({ id: s.id, step_index: s.step_index, kind: s.kind, status: s.status, txid: s.txid, confirmations: s.confirmations })),
      error_code: r.error_code,
      error_detail: r.error_detail,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    });
  }
  return ids.map((id) => byId.get(id)).filter((t): t is Transfer => Boolean(t));
}

const NOTIFY_ON: TransferStatus[] = ['broadcast', 'confirmed', 'failed', 'reorged'];

/**
 * The only way a transfer's status changes: validates the transition, records it in transfer_events,
 * and (after commit) pushes a realtime frame plus a notification for user-relevant milestones.
 */
export async function setTransferStatus(
  deps: AppDeps,
  c: pg.PoolClient,
  after: AfterCommit,
  transferId: string,
  to: TransferStatus,
  opts: { reason?: string; errorCode?: string | null; errorDetail?: string | null } = {},
): Promise<void> {
  const cur = await one<{ status: TransferStatus; user_id: string }>(c, `SELECT status, user_id FROM transfers WHERE id = $1 FOR UPDATE`, [transferId]);
  if (!cur) throw new Error('transfer not found');
  assertTransition(cur.status, to);
  await c.query(
    `UPDATE transfers SET status = $2, updated_at = now(),
        error_code = CASE WHEN $3::boolean THEN $4 ELSE error_code END,
        error_detail = CASE WHEN $3::boolean THEN $5 ELSE error_detail END
      WHERE id = $1`,
    [transferId, to, opts.errorCode !== undefined, opts.errorCode ?? null, opts.errorDetail ?? null],
  );
  await c.query(`INSERT INTO transfer_events (transfer_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4)`, [
    transferId,
    cur.status,
    to,
    opts.reason ?? null,
  ]);
  if (NOTIFY_ON.includes(to)) {
    await notify(deps, c, after, { recipientId: cur.user_id, actorId: null, kind: 'transfer', entityId: transferId });
  }
  after(async () => {
    const [t] = await loadTransfers(deps.db, [transferId]);
    if (t) deps.hub.publish([cur.user_id], { type: 'transfer', transfer: t });
  });
}

/** Called by chain sync inside its transaction when blocks leave the canonical chain. */
export async function rollbackOrphanedBlocks(deps: AppDeps, c: pg.PoolClient, after: AfterCommit, hashes: string[]): Promise<string[]> {
  if (!hashes.length) return [];
  const affected = await many<{ transfer_id: string }>(
    c,
    `UPDATE transfer_steps SET status = 'reorged', confirmations = 0, block_hash = NULL, block_height = NULL, updated_at = now()
      WHERE block_hash = ANY($1::text[]) RETURNING transfer_id`,
    [hashes],
  );
  const ids = [...new Set(affected.map((a) => a.transfer_id))];
  for (const id of ids) {
    const t = await one<{ status: TransferStatus }>(c, `SELECT status FROM transfers WHERE id = $1`, [id]);
    if (t && canTransition(t.status, 'reorged')) {
      await setTransferStatus(deps, c, after, id, 'reorged', {
        reason: 'block_orphaned',
        errorCode: 'reorged',
        errorDetail: 'A block containing this transfer was replaced by a chain reorganization.',
      });
    }
  }
  return ids;
}

/**
 * Updates confirmations of broadcast steps from the node + our canonical block table, then derives the
 * transfer status. Confirmations are counted only against blocks our sync job has accepted as canonical,
 * so a transfer is never 'confirmed' before `required_confirmations` canonical blocks.
 */
export async function monitorTransfers(deps: AppDeps): Promise<void> {
  const chain = deps.chain;
  if (!chain) return;
  const tipRow = await one<{ height: number }>(deps.db, `SELECT max(height)::bigint AS height FROM chain_blocks WHERE canonical`);
  const tip = tipRow?.height ?? null;
  if (tip === null) return;

  const active = await many<{ id: string }>(
    deps.db,
    `SELECT DISTINCT t.id FROM transfers t JOIN transfer_steps s ON s.transfer_id = t.id
      WHERE s.txid IS NOT NULL AND s.status IN ('broadcast', 'confirming', 'reorged', 'confirmed')
        AND t.status NOT IN ('failed', 'cancelled', 'confirmed')`,
  );
  for (const { id } of active) {
    await tx(deps.db, async (c, after) => {
      const t = await one<{ status: TransferStatus; required_confirmations: number }>(
        c,
        `SELECT status, required_confirmations FROM transfers WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!t) return;
      const steps = await many(c, `SELECT * FROM transfer_steps WHERE transfer_id = $1 ORDER BY step_index`, [id]);
      for (const s of steps) {
        if (!s.txid || !['broadcast', 'confirming', 'reorged', 'confirmed'].includes(s.status)) continue;
        const onChain = await chain.getRawTransaction(s.txid);
        if (!onChain) continue; // unknown to the node (dropped): stays as is
        if (!onChain.blockhash) {
          if (s.status !== 'reorged' && s.block_hash) {
            await c.query(`UPDATE transfer_steps SET status = 'broadcast', confirmations = 0, block_hash = NULL, block_height = NULL, updated_at = now() WHERE id = $1`, [s.id]);
          }
          continue;
        }
        const block = await one<{ height: number }>(c, `SELECT height FROM chain_blocks WHERE hash = $1 AND canonical`, [onChain.blockhash]);
        if (!block) continue; // our sync has not accepted this block yet
        const confirmations = Math.max(0, tip - block.height + 1);
        const status: TransferStatus = confirmations >= t.required_confirmations ? 'confirmed' : 'confirming';
        await c.query(
          `UPDATE transfer_steps SET status = $2, confirmations = $3, block_hash = $4, block_height = $5, updated_at = now() WHERE id = $1`,
          [s.id, status, confirmations, onChain.blockhash, block.height],
        );
        await c.query(
          `INSERT INTO chain_events (txid, event_index, block_hash, event_type, payload)
           VALUES ($1, $2, $3, 'zoko_transfer_step', $4) ON CONFLICT (txid, event_index, block_hash) DO UPDATE SET canonical = true`,
          [s.txid, s.step_index, onChain.blockhash, JSON.stringify({ transfer_id: id, step_id: s.id, kind: s.kind })],
        );
        s.status = status;
        s.block_hash = onChain.blockhash;
      }
      // The transfer-level status follows the chain only once every step has been broadcast.
      if (steps.some((s) => !s.txid || ['awaiting_signature', 'signed', 'draft', 'prepared'].includes(s.status))) return;
      const allConfirmed = steps.every((s) => s.status === 'confirmed');
      const anyMined = steps.some((s) => s.status === 'confirming' || s.status === 'confirmed');
      const anyReorged = steps.some((s) => s.status === 'reorged');
      let status = t.status;
      if (anyReorged) return;
      if (anyMined && (status === 'broadcast' || status === 'reorged')) {
        await setTransferStatus(deps, c, after, id, 'confirming', { reason: 'mined' });
        status = 'confirming';
      }
      if (allConfirmed && status === 'confirming') {
        await setTransferStatus(deps, c, after, id, 'confirmed', { reason: `confirmations>=${t.required_confirmations}` });
      }
    });
  }
}
