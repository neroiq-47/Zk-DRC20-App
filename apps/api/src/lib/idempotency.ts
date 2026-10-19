import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { tx, one, type AfterCommit, type Db } from '../db.js';
import { HttpProblem } from './errors.js';
import { sha256Hex } from '../auth/tokens.js';

export interface StoredResponse<T> {
  status: number;
  body: T;
}

/**
 * Runs a mutating handler at most once per (user, route, Idempotency-Key). The key row is inserted in
 * the same transaction as the work, so a concurrent retry blocks on the unique key until the first
 * attempt commits (then replays its response) or rolls back (then runs itself).
 */
export async function withIdempotency<T>(
  db: Db,
  req: FastifyRequest,
  userId: string,
  route: string,
  fn: (c: pg.PoolClient, after: AfterCommit) => Promise<StoredResponse<T>>,
): Promise<StoredResponse<T> & { replayed: boolean }> {
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || key.length > 200) {
    throw new HttpProblem(400, 'idempotency_key_required', 'Send an Idempotency-Key header (1–200 characters).');
  }
  const requestHash = sha256Hex(JSON.stringify(req.body ?? null));
  return tx(db, async (c, after) => {
    const inserted = await one(
      c,
      `INSERT INTO idempotency_keys (user_id, route, key, request_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING 1 AS ok`,
      [userId, route, key, requestHash],
    );
    if (!inserted) {
      const prev = await one(
        c,
        `SELECT request_hash, status_code, response FROM idempotency_keys WHERE user_id = $1 AND route = $2 AND key = $3`,
        [userId, route, key],
      );
      if (!prev || prev.status_code === null) throw new HttpProblem(409, 'idempotency_in_progress', 'This request is still being processed.');
      if (prev.request_hash !== requestHash) {
        throw new HttpProblem(422, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request.');
      }
      return { status: prev.status_code, body: prev.response as T, replayed: true };
    }
    const res = await fn(c, after);
    await c.query(`UPDATE idempotency_keys SET status_code = $4, response = $5 WHERE user_id = $1 AND route = $2 AND key = $3`, [
      userId,
      route,
      key,
      res.status,
      JSON.stringify(res.body),
    ]);
    return { ...res, replayed: false };
  });
}
