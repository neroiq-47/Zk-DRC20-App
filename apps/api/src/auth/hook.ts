import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps, AuthUser } from '../context.js';
import { HttpProblem } from '../lib/errors.js';
import { one } from '../db.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null;
    authError: string | null;
  }
}

/** Resolves a bearer access token to an active user whose session family is still live. */
export async function resolveAccessToken(deps: AppDeps, token: string): Promise<{ user: AuthUser } | { error: string }> {
  const claims = await deps.tokens.verifyAccess(token);
  if (!claims) return { error: 'token_invalid' };
  const row = await one<{ id: string; handle: string; role: AuthUser['role']; status: string; live: boolean }>(
    deps.db,
    `SELECT u.id, u.handle, u.role, u.status,
            EXISTS (SELECT 1 FROM sessions s WHERE s.token_family = $2 AND s.user_id = u.id
                     AND s.revoked_at IS NULL AND s.expires_at > now()) AS live
       FROM users u WHERE u.id = $1`,
    [claims.sub, claims.fam],
  );
  if (!row || !row.live) return { error: 'session_revoked' };
  if (row.status === 'suspended') return { error: 'account_suspended' };
  if (row.status !== 'active') return { error: 'account_inactive' };
  return { user: { id: row.id, handle: row.handle, role: row.role } };
}

export function registerAuthHook(app: FastifyInstance, deps: AppDeps): void {
  app.decorateRequest('authUser', null);
  app.decorateRequest('authError', null);
  app.addHook('onRequest', async (req) => {
    const h = req.headers.authorization;
    if (!h) return;
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) {
      req.authError = 'token_invalid';
      return;
    }
    const r = await resolveAccessToken(deps, m[1].trim());
    if ('user' in r) req.authUser = r.user;
    else req.authError = r.error;
  });
}

export function requireAuth(req: FastifyRequest): AuthUser {
  if (req.authUser) return req.authUser;
  if (req.authError === 'account_suspended') {
    throw new HttpProblem(403, 'account_suspended', 'This account is suspended.');
  }
  if (req.authError) throw new HttpProblem(401, req.authError, 'Your session has expired. Sign in again.');
  throw new HttpProblem(401, 'unauthenticated', 'Sign in to continue.');
}

export function requireRole(req: FastifyRequest, roles: AuthUser['role'][]): AuthUser {
  const u = requireAuth(req);
  if (!roles.includes(u.role)) throw new HttpProblem(403, 'forbidden_role', 'This action needs moderator access.');
  return u;
}
