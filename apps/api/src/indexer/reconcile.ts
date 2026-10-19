import type { AssetStatus } from '@zoko/contracts';
import type { AppDeps } from '../context.js';
import { many, tx } from '../db.js';
import type { IndexedDrc20, IndexerAdapter } from './adapter.js';

export interface SourceValue {
  adapter: string;
  value: string | null; // null when the adapter failed
  height: number | null;
  error?: string;
}

export interface Reconciled {
  status: AssetStatus;
  amount: string;
  height: number | null;
  sources: SourceValue[];
}

/**
 * Agreement rule across independent indexers:
 *   - every available adapter reports the same amount (and at least two are available) -> 'confirmed'
 *   - available adapters disagree -> 'disputed' (the lowest amount is stored, never the highest)
 *   - only one adapter available -> 'unverified'
 * Returns null when no adapter answered (the stored value is left untouched).
 */
export function reconcileValues(sources: SourceValue[]): Reconciled | null {
  const ok = sources.filter((s) => s.value !== null);
  if (!ok.length) return null;
  const values = ok.map((s) => BigInt(s.value!));
  const min = values.reduce((a, b) => (b < a ? b : a));
  const allEqual = values.every((v) => v === values[0]);
  const heights = ok.map((s) => s.height).filter((h): h is number => h !== null);
  const status: AssetStatus = ok.length < 2 ? 'unverified' : allEqual ? 'confirmed' : 'disputed';
  return { status, amount: min.toString(), height: heights.length ? Math.min(...heights) : null, sources };
}

async function settle<T>(adapters: IndexerAdapter[], fn: (a: IndexerAdapter) => Promise<T>) {
  const results = await Promise.allSettled(adapters.map(fn));
  return results.map((r, i) => ({ adapter: adapters[i].id, result: r }));
}

/** Queries every adapter for one wallet and stores reconciled DOGE and DRC-20 balances. */
export async function refreshWalletBalances(deps: AppDeps, wallet: { id: string; address: string }): Promise<void> {
  const adapters = deps.indexers;
  if (!adapters.length) return;
  const [doge, drc] = await Promise.all([
    settle(adapters, (a) => a.getDogeBalance(wallet.address)),
    settle(adapters, (a) => a.getDrc20Balances(wallet.address)),
  ]);

  const dogeResult = reconcileValues(
    doge.map(({ adapter, result }) =>
      result.status === 'fulfilled'
        ? { adapter, value: result.value.amount_koinu, height: result.value.height }
        : { adapter, value: null, height: null, error: String(result.reason?.message ?? result.reason) },
    ),
  );

  // Union of tokens reported by any adapter, keyed by deploy txid (tickers are not unique across versions).
  const tokens = new Map<string, IndexedDrc20>();
  for (const { result } of drc) if (result.status === 'fulfilled') for (const b of result.value.balances) tokens.set(b.deploy_txid, b);

  await tx(deps.db, async (c) => {
    if (dogeResult) {
      await c.query(
        `INSERT INTO doge_balances (wallet_id, amount_koinu, indexed_height, status, sources, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (wallet_id) DO UPDATE SET amount_koinu = EXCLUDED.amount_koinu, indexed_height = EXCLUDED.indexed_height,
           status = EXCLUDED.status, sources = EXCLUDED.sources, updated_at = now()`,
        [wallet.id, dogeResult.amount, dogeResult.height, dogeResult.status, JSON.stringify(dogeResult.sources)],
      );
    }
    if (!drc.some((d) => d.result.status === 'fulfilled')) return;

    const tokenIds = new Map<string, string>();
    for (const t of tokens.values()) {
      const row = await c.query(
        `INSERT INTO drc20_tokens (ticker, protocol_version, deploy_txid, decimals, max_supply)
         VALUES ($1, 'drc-20', $2, $3, $4)
         ON CONFLICT (deploy_txid) DO UPDATE SET decimals = drc20_tokens.decimals RETURNING id`,
        [t.ticker, t.deploy_txid, t.decimals, t.max_supply],
      );
      tokenIds.set(t.deploy_txid, row.rows[0].id);
    }
    // Tokens held previously but no longer reported anywhere must be reconciled too (to zero).
    const previous = await many<{ token_id: string; deploy_txid: string }>(
      c,
      `SELECT ab.token_id, t.deploy_txid FROM asset_balances ab JOIN drc20_tokens t ON t.id = ab.token_id WHERE ab.wallet_id = $1`,
      [wallet.id],
    );
    for (const p of previous) if (!tokenIds.has(p.deploy_txid)) tokenIds.set(p.deploy_txid, p.token_id);

    for (const [deployTxid, tokenId] of tokenIds) {
      const result = reconcileValues(
        drc.map(({ adapter, result }) => {
          if (result.status !== 'fulfilled') return { adapter, value: null, height: null, error: String(result.reason?.message ?? result.reason) };
          const hit = result.value.balances.find((b) => b.deploy_txid === deployTxid);
          return { adapter, value: hit?.amount_base_units ?? '0', height: result.value.height };
        }),
      );
      if (!result) continue;
      await c.query(
        `INSERT INTO asset_balances (wallet_id, token_id, amount_base_units, indexed_height, status, sources, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (wallet_id, token_id) DO UPDATE SET amount_base_units = EXCLUDED.amount_base_units,
           indexed_height = EXCLUDED.indexed_height, status = EXCLUDED.status, sources = EXCLUDED.sources, updated_at = now()`,
        [wallet.id, tokenId, result.amount, result.height, result.status, JSON.stringify(result.sources)],
      );
    }
  });
}

/** Refreshes balances for a user's wallets whose stored balances are older than ASSET_STALE_SECONDS. */
export async function refreshStaleBalances(deps: AppDeps, userId: string, force = false): Promise<void> {
  const wallets = await many<{ id: string; address: string }>(
    deps.db,
    `SELECT w.id, w.address FROM wallet_connections w
      LEFT JOIN doge_balances d ON d.wallet_id = w.id
     WHERE w.user_id = $1 AND w.revoked_at IS NULL
       AND ($2 OR d.updated_at IS NULL OR d.updated_at < now() - make_interval(secs => $3))`,
    [userId, force, deps.config.assetStaleSeconds],
  );
  await Promise.all(wallets.map((w) => refreshWalletBalances(deps, w).catch(() => undefined)));
}
