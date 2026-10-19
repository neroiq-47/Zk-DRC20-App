import type { AppDeps } from '../context.js';
import { many, one, tx } from '../db.js';
import { rollbackOrphanedBlocks } from '../transfers/service.js';

const MAX_REORG_DEPTH = 100;
const MAX_BLOCKS_PER_RUN = 500;

export interface SyncResult {
  tip: number | null;
  added: number;
  orphaned: string[];
  reorgedTransfers: string[];
}

/**
 * Canonical block sync. Records block headers in chain_blocks, detects reorgs by comparing our stored
 * canonical hashes with the node (and by parent-hash mismatch while extending), marks orphaned blocks
 * and their chain_events non-canonical, and rolls affected transfers to 'reorged'.
 */
export async function syncChain(deps: AppDeps): Promise<SyncResult> {
  const chain = deps.chain;
  const result: SyncResult = { tip: null, added: 0, orphaned: [], reorgedTransfers: [] };
  if (!chain) return result;

  const nodeTip = await chain.getBlockCount();
  let ours = await one<{ height: number; hash: string }>(
    deps.db,
    `SELECT height, hash FROM chain_blocks WHERE canonical ORDER BY height DESC LIMIT 1`,
  );

  if (!ours) {
    const start = Math.max(0, nodeTip - deps.config.chainSyncStartDepth);
    const hash = await chain.getBlockHash(start);
    const header = await chain.getBlockHeader(hash);
    await deps.db.query(
      `INSERT INTO chain_blocks (height, hash, parent_hash, canonical, block_time) VALUES ($1, $2, $3, true, to_timestamp($4))
       ON CONFLICT (hash) DO UPDATE SET canonical = true`,
      [start, hash, header.previousblockhash, header.time],
    );
    ours = { height: start, hash };
    result.added++;
  }

  // 1) Find the fork point: walk back from our tip until our hash matches the node's at that height.
  const orphaned: string[] = [];
  let forkHeight = ours.height;
  const stored = await many<{ height: number; hash: string }>(
    deps.db,
    `SELECT height, hash FROM chain_blocks WHERE canonical AND height > $1::bigint - $2::int ORDER BY height DESC`,
    [ours.height, MAX_REORG_DEPTH],
  );
  for (const b of stored) {
    const nodeHash = b.height <= nodeTip ? await chain.getBlockHash(b.height) : null;
    if (nodeHash === b.hash) {
      forkHeight = b.height;
      break;
    }
    orphaned.push(b.hash);
    forkHeight = b.height - 1;
  }
  if (orphaned.length === stored.length && stored.length >= MAX_REORG_DEPTH) {
    throw new Error(`reorg deeper than ${MAX_REORG_DEPTH} blocks; manual intervention required`);
  }
  if (orphaned.length) {
    await tx(deps.db, async (c, after) => {
      await c.query(`UPDATE chain_blocks SET canonical = false WHERE hash = ANY($1::text[])`, [orphaned]);
      await c.query(`UPDATE chain_events SET canonical = false WHERE block_hash = ANY($1::text[])`, [orphaned]);
      result.reorgedTransfers = await rollbackOrphanedBlocks(deps, c, after, orphaned);
    });
    result.orphaned = orphaned;
  }

  // 2) Extend from the fork point, verifying each header links to the previous canonical block.
  let prev = await one<{ hash: string }>(deps.db, `SELECT hash FROM chain_blocks WHERE canonical AND height = $1`, [forkHeight]);
  const end = Math.min(nodeTip, forkHeight + MAX_BLOCKS_PER_RUN);
  for (let h = forkHeight + 1; h <= end; h++) {
    const hash = await chain.getBlockHash(h);
    const header = await chain.getBlockHeader(hash);
    if (prev && header.previousblockhash !== prev.hash) break; // chain moved under us; next run handles it
    await deps.db.query(
      `INSERT INTO chain_blocks (height, hash, parent_hash, canonical, block_time) VALUES ($1, $2, $3, true, to_timestamp($4))
       ON CONFLICT (hash) DO UPDATE SET canonical = true, height = EXCLUDED.height`,
      [h, hash, header.previousblockhash, header.time],
    );
    await deps.db.query(`UPDATE chain_events SET canonical = true WHERE block_hash = $1`, [hash]);
    prev = { hash };
    result.added++;
  }
  const tip = await one<{ height: number }>(deps.db, `SELECT max(height)::bigint AS height FROM chain_blocks WHERE canonical`);
  result.tip = tip?.height ?? null;
  return result;
}
