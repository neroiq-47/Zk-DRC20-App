import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { DogeBalance, Drc20Balance, Token, WalletAssets, WalletChallenge, WalletProvider } from '@zoko/contracts';
import type pg from 'pg';
import type { AppDeps } from '../context.js';
import { many, one, tx } from '../db.js';
import { requireAuth } from '../auth/hook.js';
import { HttpProblem, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { sha256Hex } from '../auth/tokens.js';
import { checkDogecoinAddress, verifyDogecoinMessage } from '../chain/dogecoin.js';
import { refreshStaleBalances } from '../indexer/reconcile.js';
import { audit } from '../services/notify.js';
import { walletRow } from './users.js';
import { toToken } from '../transfers/service.js';

export const NETWORK = 'dogecoin-mainnet';
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export const PROVIDERS: WalletProvider[] = [
  {
    id: 'manual',
    name: 'Any Dogecoin wallet',
    can_sign_message: true,
    can_sign_transaction: true,
    signing_method: 'copy_paste',
    notes:
      'Copy the message into a Dogecoin wallet that supports “Sign message” (for example Dogecoin Core: File → Sign message) using a legacy D… address, then paste the base64 signature back. Transactions are signed the same way by pasting the unsigned transaction hex into your wallet. Zoko never asks for your seed phrase or private key.',
  },
];

const challengeSchema = z.object({ address: z.string().trim().min(1).max(64), provider: z.string().min(1).max(40) });
const verifySchema = z.object({
  challenge_id: z.uuid(),
  signature: z.string().trim().min(80).max(120),
  provider: z.string().min(1).max(40),
});

export function buildChallengeMessage(p: { domain: string; address: string; userId: string; nonce: string; issuedAt: Date; expiresAt: Date }) {
  return [
    `${p.domain} wants you to prove you own this Dogecoin address:`,
    p.address,
    '',
    'Signing is free and does not send a transaction.',
    '',
    `URI: https://${p.domain}`,
    `Network: ${NETWORK}`,
    `User ID: ${p.userId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt.toISOString()}`,
    `Expiration Time: ${p.expiresAt.toISOString()}`,
  ].join('\n');
}

export function validateAddressOrThrow(address: string, field = 'address') {
  const check = checkDogecoinAddress(address);
  if (!check.ok) {
    if (check.reason === 'wrong_network') {
      throw new HttpProblem(422, 'wrong_network', 'This address is not on Dogecoin mainnet.', { [field]: 'Use a Dogecoin mainnet address.' });
    }
    throw new HttpProblem(422, 'invalid_address', 'This is not a valid Dogecoin address.', { [field]: 'This is not a valid Dogecoin address.' });
  }
  return check;
}

export default async function walletRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, config: cfg } = deps;

  app.get('/wallet/providers', async (req) => {
    requireAuth(req);
    return { items: PROVIDERS };
  });

  app.post('/wallet/challenges', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (req, reply) => {
    const me = requireAuth(req);
    const body = parse(challengeSchema, req.body);
    if (!PROVIDERS.some((p) => p.id === body.provider)) throw new HttpProblem(422, 'unknown_provider', 'Unknown wallet provider.');
    const check = validateAddressOrThrow(body.address);
    if (check.type !== 'p2pkh') {
      throw new HttpProblem(422, 'address_type_unsupported', 'Message signing needs a legacy address starting with D.', {
        address: 'Use an address that starts with D.',
      });
    }
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
    const message = buildChallengeMessage({ domain: cfg.appDomain, address: body.address, userId: me.id, nonce, issuedAt, expiresAt });
    const row = await one(
      db,
      `INSERT INTO wallet_challenges (user_id, address, nonce_hash, domain, network, expires_at, message, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [me.id, body.address, sha256Hex(nonce), cfg.appDomain, NETWORK, expiresAt, message, body.provider],
    );
    const res: WalletChallenge = { challenge_id: row.id, message, expires_at: expiresAt.toISOString() };
    return reply.code(201).send(res);
  });

  app.post('/wallet/connections', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (req, reply) => {
    const me = requireAuth(req);
    const body = parse(verifySchema, req.body);
    // Consume the challenge atomically: a challenge can be used exactly once, even if the signature is wrong.
    const ch = await one(
      db,
      `UPDATE wallet_challenges SET consumed_at = now()
        WHERE id = $1 AND user_id = $2 AND consumed_at IS NULL
        RETURNING address, domain, network, message, provider, expires_at, expires_at <= now() AS expired`,
      [body.challenge_id, me.id],
    );
    if (!ch) {
      const exists = await one(db, `SELECT 1 FROM wallet_challenges WHERE id = $1 AND user_id = $2`, [body.challenge_id, me.id]);
      if (exists) throw new HttpProblem(409, 'challenge_used', 'This challenge was already used. Start again.');
      throw notFound('Challenge');
    }
    if (ch.expired) throw new HttpProblem(410, 'challenge_expired', 'This challenge expired. Start again.');
    if (ch.network !== NETWORK || ch.domain !== cfg.appDomain) {
      throw new HttpProblem(422, 'wrong_network', 'This challenge was issued for a different network or app.');
    }
    if (ch.provider !== body.provider) throw new HttpProblem(422, 'provider_mismatch', 'Use the same wallet you started with.');
    if (!verifyDogecoinMessage(ch.address, ch.message, body.signature)) {
      throw new HttpProblem(422, 'invalid_signature', 'That signature doesn’t match this address and message.', {
        signature: 'That signature doesn’t match this address and message.',
      });
    }
    const conn = await tx(db, async (c) => {
      const existing = await one(c, `SELECT * FROM wallet_connections WHERE network = $1 AND address = $2 AND revoked_at IS NULL FOR UPDATE`, [
        NETWORK,
        ch.address,
      ]);
      if (existing && existing.user_id !== me.id) {
        throw new HttpProblem(409, 'address_already_connected', 'This address is already connected to another account.');
      }
      let row;
      if (existing) {
        row = await one(c, `UPDATE wallet_connections SET verified_at = now(), provider = $2 WHERE id = $1 RETURNING *`, [existing.id, body.provider]);
      } else {
        row = await one(
          c,
          `INSERT INTO wallet_connections (user_id, address, network, provider, verified_at) VALUES ($1, $2, $3, $4, now()) RETURNING *`,
          [me.id, ch.address, NETWORK, body.provider],
        ).catch((err: pg.DatabaseError) => {
          if (err.code === '23505') throw new HttpProblem(409, 'address_already_connected', 'This address is already connected to another account.');
          throw err;
        });
      }
      await audit(c, me.id, 'wallet.connect', 'wallet', row.id, { address: ch.address, provider: body.provider });
      return row;
    });
    return reply.code(201).send(walletRow(conn));
  });

  app.get('/wallet/connections', async (req) => {
    const me = requireAuth(req);
    const rows = await many(
      db,
      `SELECT * FROM wallet_connections WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
      [me.id],
    );
    return { items: rows.map(walletRow) };
  });

  app.delete('/wallet/connections/:id', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const r = await db.query(`UPDATE wallet_connections SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [id, me.id]);
    if (!r.rowCount) throw notFound('Wallet');
    await audit(db, me.id, 'wallet.disconnect', 'wallet', id);
    return reply.code(204).send();
  });

  app.get('/wallet/assets', async (req): Promise<WalletAssets> => {
    const me = requireAuth(req);
    const q = parse(z.object({ refresh: z.enum(['true', 'false']).optional() }), req.query);
    await refreshStaleBalances(deps, me.id, q.refresh === 'true');
    const doge = await many(
      db,
      `SELECT w.id AS wallet_id, w.address, d.amount_koinu::text AS amount_koinu, d.status, d.indexed_height
         FROM wallet_connections w LEFT JOIN doge_balances d ON d.wallet_id = w.id
        WHERE w.user_id = $1 AND w.revoked_at IS NULL ORDER BY w.created_at`,
      [me.id],
    );
    const drc = await many(
      db,
      `SELECT w.id AS wallet_id, w.address, ab.amount_base_units::text AS amount, ab.status, ab.indexed_height,
          t.id AS t_id, t.ticker AS t_ticker, t.decimals AS t_decimals, t.max_supply::text AS t_max_supply, t.deploy_txid AS t_deploy_txid
         FROM wallet_connections w
         JOIN asset_balances ab ON ab.wallet_id = w.id
         JOIN drc20_tokens t ON t.id = ab.token_id
        WHERE w.user_id = $1 AND w.revoked_at IS NULL AND (ab.amount_base_units > 0 OR ab.status = 'disputed')
        ORDER BY w.created_at, t.ticker`,
      [me.id],
    );
    const tip = await one<{ height: number | null }>(db, `SELECT max(height)::bigint AS height FROM chain_blocks WHERE canonical`);
    return {
      doge: doge.map(
        (r): DogeBalance => ({
          wallet_id: r.wallet_id,
          address: r.address,
          amount_koinu: r.amount_koinu ?? '0',
          // No answer from any indexer yet: 'pending' until the first reconciliation lands.
          status: r.status ?? 'pending',
          indexed_height: r.indexed_height ?? null,
        }),
      ),
      drc20: drc.map(
        (r): Drc20Balance => ({
          wallet_id: r.wallet_id,
          address: r.address,
          token: toToken(r),
          amount_base_units: r.amount,
          status: r.status,
          indexed_height: r.indexed_height ?? null,
        }),
      ),
      chain_height: tip?.height ?? null,
    };
  });

  app.get('/tokens/:ticker', async (req): Promise<Token> => {
    requireAuth(req);
    const { ticker } = parse(z.object({ ticker: z.string().min(1).max(32) }), req.params);
    const r = await one(
      db,
      `SELECT id AS t_id, ticker AS t_ticker, decimals AS t_decimals, max_supply::text AS t_max_supply, deploy_txid AS t_deploy_txid
         FROM drc20_tokens WHERE lower(ticker) = lower($1) ORDER BY created_at LIMIT 1`,
      [ticker],
    );
    if (!r) throw notFound('Token');
    return toToken(r);
  });
}
