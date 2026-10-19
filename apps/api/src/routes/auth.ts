import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type pg from 'pg';
import type { AuthResponse, TokenPair } from '@zoko/contracts';
import type { AppDeps } from '../context.js';
import { one, tx, type Queryable } from '../db.js';
import { HttpProblem } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../auth/passwords.js';
import { newRefreshToken, sha256Hex } from '../auth/tokens.js';
import { loadMe } from '../services/users.js';
import { audit } from '../services/notify.js';

export const HANDLE_RE = /^[a-z0-9_]{3,30}$/;

const registerSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12, 'Use at least 12 characters.').max(256),
  handle: z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, '').toLowerCase())
    .pipe(z.string().regex(HANDLE_RE, 'Use 3–30 lowercase letters, numbers or underscores.')),
  display_name: z.string().trim().min(1).max(80).optional(),
});
const loginSchema = z.object({ email: z.string().trim().min(1).max(254), password: z.string().min(1).max(256) });
const refreshSchema = z.object({ refresh_token: z.string().min(10).max(200) });

export async function issueTokens(
  deps: AppDeps,
  db: Queryable,
  userId: string,
  family: string = randomUUID(),
  userAgent?: string,
): Promise<TokenPair & { session_id: string }> {
  const refresh = newRefreshToken();
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO sessions (user_id, refresh_hash, token_family, expires_at, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(days => $4), $5) RETURNING id`,
    [userId, sha256Hex(refresh), family, deps.config.refreshTokenTtlDays, userAgent?.slice(0, 300) ?? null],
  );
  const access = await deps.tokens.signAccess({ sub: userId, fam: family });
  return { access_token: access, refresh_token: refresh, expires_in: deps.tokens.accessTtl, session_id: row!.id };
}

const strip = ({ session_id: _s, ...pair }: TokenPair & { session_id: string }): TokenPair => pair;

export async function revokeAllSessions(db: Queryable, userId: string, reason: string): Promise<void> {
  await db.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [
    userId,
    reason,
  ]);
}

export default async function authRoutes(app: FastifyInstance, deps: AppDeps) {
  const rateLimit = { max: deps.config.authRateLimitMax, timeWindow: deps.config.authRateLimitWindowMs };

  app.post('/auth/register', { config: { rateLimit } }, async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const passwordHash = await hashPassword(body.password);
    const result = await tx(deps.db, async (c) => {
      const handleTaken = await one(c, `SELECT 1 FROM users WHERE lower(handle) = $1`, [body.handle]);
      if (handleTaken) throw new HttpProblem(409, 'handle_taken', 'That handle is taken.', { handle: 'That handle is taken.' });
      const emailTaken = await one(c, `SELECT 1 FROM credentials WHERE lower(email) = lower($1)`, [body.email]);
      if (emailTaken) {
        throw new HttpProblem(409, 'email_taken', 'An account with this email already exists.', {
          email: 'An account with this email already exists.',
        });
      }
      const user = await one<{ id: string }>(
        c,
        `INSERT INTO users (handle, display_name) VALUES ($1, $2) RETURNING id`,
        [body.handle, body.display_name ?? body.handle],
      );
      await c.query(`INSERT INTO credentials (user_id, email, password_hash) VALUES ($1, $2, $3)`, [
        user!.id,
        body.email.trim(),
        passwordHash,
      ]);
      await c.query(`INSERT INTO auth_identities (user_id, provider, provider_subject) VALUES ($1, 'password', $2)`, [
        user!.id,
        body.email.trim().toLowerCase(),
      ]);
      const tokens = await issueTokens(deps, c, user!.id, undefined, req.headers['user-agent']);
      await audit(c, user!.id, 'auth.register', 'user', user!.id);
      return { userId: user!.id, tokens };
    }).catch((err: pg.DatabaseError) => {
      // Concurrent registration racing the checks above.
      if (err.code === '23505') {
        if (err.constraint === 'users_handle_lower_unique') throw new HttpProblem(409, 'handle_taken', 'That handle is taken.', { handle: 'That handle is taken.' });
        if (err.constraint === 'credentials_email_lower_unique' || err.constraint === 'auth_identities_provider_provider_subject_key')
          throw new HttpProblem(409, 'email_taken', 'An account with this email already exists.', { email: 'An account with this email already exists.' });
      }
      throw err;
    });
    const res: AuthResponse = { ...strip(result.tokens), user: await loadMe(deps.db, deps.config, result.userId) };
    return reply.code(201).send(res);
  });

  app.post('/auth/login', { config: { rateLimit } }, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const row = await one<{ user_id: string; password_hash: string; status: string }>(
      deps.db,
      `SELECT c.user_id, c.password_hash, u.status FROM credentials c JOIN users u ON u.id = c.user_id WHERE lower(c.email) = lower($1)`,
      [body.email],
    );
    if (!row) {
      await burnPasswordCheck(body.password);
      throw new HttpProblem(401, 'invalid_credentials', 'That email and password don’t match.');
    }
    const ok = await verifyPassword(body.password, row.password_hash);
    if (!ok || row.status === 'deleting') throw new HttpProblem(401, 'invalid_credentials', 'That email and password don’t match.');
    if (row.status === 'suspended') throw new HttpProblem(403, 'account_suspended', 'This account is suspended.');
    const tokens = await issueTokens(deps, deps.db, row.user_id, undefined, req.headers['user-agent']);
    const res: AuthResponse = { ...strip(tokens), user: await loadMe(deps.db, deps.config, row.user_id) };
    return reply.code(201).send(res);
  });

  app.post('/auth/refresh', { config: { rateLimit } }, async (req, reply) => {
    const { refresh_token } = parse(refreshSchema, req.body);
    const hash = sha256Hex(refresh_token);
    const outcome = await tx(deps.db, async (c) => {
      const s = await one<{ id: string; user_id: string; token_family: string; revoked_at: Date | null; expired: boolean; status: string }>(
        c,
        `SELECT s.id, s.user_id, s.token_family, s.revoked_at, s.expires_at <= now() AS expired, u.status
           FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.refresh_hash = $1 FOR UPDATE OF s`,
        [hash],
      );
      if (!s) return { error: new HttpProblem(401, 'refresh_token_invalid', 'Your session has expired. Sign in again.') };
      if (s.revoked_at) {
        // Reuse of a rotated (or revoked) token: assume theft and revoke the whole family.
        await c.query(
          `UPDATE sessions SET revoked_at = now(), revoked_reason = 'reuse_detected' WHERE token_family = $1 AND revoked_at IS NULL`,
          [s.token_family],
        );
        await audit(c, s.user_id, 'auth.refresh_reuse_detected', 'session_family', s.token_family);
        return { error: new HttpProblem(401, 'refresh_token_reused', 'Your session has expired. Sign in again.') };
      }
      if (s.expired) return { error: new HttpProblem(401, 'refresh_token_expired', 'Your session has expired. Sign in again.') };
      if (s.status !== 'active') {
        return { error: new HttpProblem(s.status === 'suspended' ? 403 : 401, s.status === 'suspended' ? 'account_suspended' : 'account_inactive', 'This account is not active.') };
      }
      const next = await issueTokens(deps, c, s.user_id, s.token_family, req.headers['user-agent']);
      await c.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'rotated', replaced_by = $2 WHERE id = $1`, [
        s.id,
        next.session_id,
      ]);
      return { tokens: next };
    });
    // The reuse revocation must commit before we answer, so errors are thrown outside the transaction.
    if ('error' in outcome) throw outcome.error;
    return reply.code(201).send(strip(outcome.tokens));
  });

  app.post('/auth/logout', { config: { rateLimit } }, async (req, reply) => {
    const { refresh_token } = parse(refreshSchema, req.body);
    await deps.db.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout'
        WHERE token_family = (SELECT token_family FROM sessions WHERE refresh_hash = $1) AND revoked_at IS NULL`,
      [sha256Hex(refresh_token)],
    );
    return reply.code(204).send();
  });
}
