import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AccountExport, Page, Post, UserSummary, WalletConnection } from '@zoko/contracts';
import type { AppDeps } from '../context.js';
import { many, one, tx } from '../db.js';
import { requireAuth } from '../auth/hook.js';
import { HttpProblem } from '../lib/errors.js';
import { parse, pageQuery } from '../lib/validate.js';
import { cursorTs, decodeCursor, pageFrom } from '../lib/cursor.js';
import { DEFAULT_SETTINGS, findVisibleUser, loadMe, loadProfileByHandle, notBlockedSql, summaryCols, toSummary } from '../services/users.js';
import { hydratePosts, repostOriginalVisibleSql, visiblePostSql } from '../services/posts.js';
import { audit, notify } from '../services/notify.js';
import { revokeAllSessions } from './auth.js';

const settingsSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    default_visibility: z.enum(['public', 'followers']),
    allow_message_requests: z.enum(['everyone', 'following', 'nobody']),
    show_wallet_on_profile: z.boolean(),
  })
  .partial()
  .strict();

const updateMeSchema = z
  .object({
    display_name: z.string().trim().min(1).max(80),
    bio: z.string().max(500).nullable(),
    avatar_media_id: z.uuid().nullable(),
    cover_media_id: z.uuid().nullable(),
    settings: settingsSchema,
  })
  .partial();

const handleParams = z.object({ handle: z.string().min(1).max(31).transform((h) => h.replace(/^@/, '')) });

export function walletRow(r: any): WalletConnection {
  return {
    id: r.id,
    address: r.address,
    network: r.network,
    provider: r.provider,
    verified_at: new Date(r.verified_at).toISOString(),
  };
}

export default async function userRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, config: cfg } = deps;

  app.get('/users/me', async (req) => {
    const me = requireAuth(req);
    return loadMe(db, cfg, me.id);
  });

  app.patch('/users/me', async (req) => {
    const me = requireAuth(req);
    const body = parse(updateMeSchema, req.body);
    await tx(db, async (c) => {
      for (const field of ['avatar_media_id', 'cover_media_id'] as const) {
        const id = body[field];
        if (id) {
          const m = await one(c, `SELECT owner_id, kind, processing_state FROM media WHERE id = $1`, [id]);
          if (!m || m.owner_id !== me.id) {
            throw new HttpProblem(422, 'media_not_owned', 'Use a photo you uploaded.', { [field]: 'Use a photo you uploaded.' });
          }
          if (m.kind !== 'image' || m.processing_state !== 'ready') {
            throw new HttpProblem(422, 'media_not_ready', 'That photo is not ready yet.', { [field]: 'That photo is not ready yet.' });
          }
        }
      }
      const sets: string[] = [];
      const vals: unknown[] = [me.id];
      const set = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };
      if (body.display_name !== undefined) set('display_name', body.display_name);
      if (body.bio !== undefined) set('bio', body.bio === null || body.bio.trim() === '' ? null : body.bio);
      if (body.avatar_media_id !== undefined) set('avatar_media_id', body.avatar_media_id);
      if (body.cover_media_id !== undefined) set('cover_media_id', body.cover_media_id);
      if (body.settings) {
        vals.push(JSON.stringify(body.settings));
        sets.push(`settings = settings || $${vals.length}::jsonb`);
      }
      if (sets.length) await c.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
    });
    return loadMe(db, cfg, me.id);
  });

  app.delete('/users/me', async (req, reply) => {
    const me = requireAuth(req);
    await tx(db, async (c) => {
      // Content disappears immediately because every read path requires an active author.
      // Production gap: a background purge job should hard-delete data after the grace period.
      await c.query(`UPDATE users SET status = 'deleting', deleted_at = now(), updated_at = now() WHERE id = $1`, [me.id]);
      await revokeAllSessions(c, me.id, 'account_deleted');
      await c.query(`UPDATE wallet_connections SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [me.id]);
      await c.query(`DELETE FROM devices WHERE user_id = $1`, [me.id]);
      await audit(c, me.id, 'account.delete_requested', 'user', me.id);
    });
    return reply.code(202).send();
  });

  app.get('/users/me/export', async (req) => {
    const me = requireAuth(req);
    const user = await loadMe(db, cfg, me.id);
    const postIds = await many<{ id: string }>(
      db,
      `SELECT id FROM posts WHERE author_id = $1 AND status = 'published' ORDER BY created_at DESC, id DESC`,
      [me.id],
    );
    const following = await many(
      db,
      `SELECT ${summaryCols('u', '')} FROM follows f JOIN users u ON u.id = f.following_id
        WHERE f.follower_id = $1 AND u.status = 'active' ORDER BY f.created_at DESC`,
      [me.id],
    );
    const wallets = await many(
      db,
      `SELECT id, address, network, provider, verified_at FROM wallet_connections WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
      [me.id],
    );
    await audit(db, me.id, 'account.export', 'user', me.id);
    const out: AccountExport = {
      generated_at: new Date().toISOString(),
      user,
      posts: await hydratePosts(db, cfg, postIds.map((p) => p.id), me.id),
      following: following.map((r) => toSummary(cfg, r)),
      wallets: wallets.map(walletRow),
    };
    return out;
  });

  app.get('/users/me/bookmarks', async (req): Promise<Page<Post>> => {
    const me = requireAuth(req);
    const q = parse(pageQuery, req.query);
    const cur = decodeCursor(q.cursor);
    const rows = await many(
      db,
      `SELECT b.post_id AS _ci, ${cursorTs('b.created_at')} AS _ct
         FROM bookmarks b JOIN posts p ON p.id = b.post_id JOIN users a ON a.id = p.author_id
        WHERE b.user_id = $1 AND ${visiblePostSql('p', 'a', '$1')}
          AND ($2::timestamptz IS NULL OR (b.created_at, b.post_id) < ($2::timestamptz, $3::uuid))
        ORDER BY b.created_at DESC, b.post_id DESC LIMIT $4`,
      [me.id, cur?.t ?? null, cur?.i ?? null, q.limit + 1],
    );
    const page = pageFrom(rows, q.limit);
    return { items: await hydratePosts(db, cfg, page.rows.map((r) => r._ci), me.id), next_cursor: page.next_cursor };
  });

  app.get('/users/suggested', async (req) => {
    const me = requireAuth(req);
    const rows = await many(
      db,
      `SELECT ${summaryCols('u', '')},
          (SELECT count(*) FROM follows f WHERE f.following_id = u.id) AS fc,
          (SELECT count(*) FROM follows f2 WHERE f2.following_id = u.id
              AND f2.follower_id IN (SELECT following_id FROM follows WHERE follower_id = $1)) AS mutual
         FROM users u
        WHERE u.status = 'active' AND u.id <> $1
          AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id)
          AND ${notBlockedSql('u.id', '$1')}
        ORDER BY mutual DESC, fc DESC, u.created_at DESC
        LIMIT 10`,
      [me.id],
    );
    return { items: rows.map((r) => toSummary(cfg, r)) };
  });

  app.get('/users/:handle', async (req) => {
    const me = requireAuth(req);
    const { handle } = parse(handleParams, req.params);
    return loadProfileByHandle(db, cfg, handle, me.id);
  });

  app.get('/users/:handle/posts', async (req): Promise<Page<Post>> => {
    const me = requireAuth(req);
    const { handle } = parse(handleParams, req.params);
    const q = parse(pageQuery.extend({ filter: z.enum(['posts', 'replies', 'media']).default('posts') }), req.query);
    const target = await findVisibleUser(db, handle, me.id);
    const cur = decodeCursor(q.cursor);
    const filterSql =
      q.filter === 'posts'
        ? 'p.parent_id IS NULL'
        : q.filter === 'replies'
          ? 'p.parent_id IS NOT NULL'
          : 'EXISTS (SELECT 1 FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = p.id AND m.processing_state = \'ready\')';
    const rows = await many(
      db,
      `SELECT p.id AS _ci, ${cursorTs('p.created_at')} AS _ct
         FROM posts p JOIN users a ON a.id = p.author_id
        WHERE p.author_id = $1 AND ${filterSql} AND ${visiblePostSql('p', 'a', '$2')} AND ${repostOriginalVisibleSql('p', '$2')}
          AND ($3::timestamptz IS NULL OR (p.created_at, p.id) < ($3::timestamptz, $4::uuid))
        ORDER BY p.created_at DESC, p.id DESC LIMIT $5`,
      [target.id, me.id, cur?.t ?? null, cur?.i ?? null, q.limit + 1],
    );
    const page = pageFrom(rows, q.limit);
    return { items: await hydratePosts(db, cfg, page.rows.map((r) => r._ci), me.id), next_cursor: page.next_cursor };
  });

  const followList = (direction: 'followers' | 'following') => async (req: any): Promise<Page<UserSummary>> => {
    const me = requireAuth(req);
    const { handle } = parse(handleParams, req.params);
    const q = parse(pageQuery, req.query);
    const target = await findVisibleUser(db, handle, me.id);
    const cur = decodeCursor(q.cursor);
    const [matchCol, otherCol] = direction === 'followers' ? ['following_id', 'follower_id'] : ['follower_id', 'following_id'];
    const rows = await many(
      db,
      `SELECT ${summaryCols('u', '')}, u.id AS _ci, ${cursorTs('f.created_at')} AS _ct
         FROM follows f JOIN users u ON u.id = f.${otherCol}
        WHERE f.${matchCol} = $1 AND u.status = 'active' AND ${notBlockedSql('u.id', '$2')}
          AND ($3::timestamptz IS NULL OR (f.created_at, u.id) < ($3::timestamptz, $4::uuid))
        ORDER BY f.created_at DESC, u.id DESC LIMIT $5`,
      [target.id, me.id, cur?.t ?? null, cur?.i ?? null, q.limit + 1],
    );
    const page = pageFrom(rows, q.limit);
    return { items: page.rows.map((r) => toSummary(cfg, r)), next_cursor: page.next_cursor };
  };
  app.get('/users/:handle/followers', followList('followers'));
  app.get('/users/:handle/following', followList('following'));

  app.post('/users/:handle/follow', async (req, reply) => {
    const me = requireAuth(req);
    const { handle } = parse(handleParams, req.params);
    const target = await findVisibleUser(db, handle, me.id);
    if (target.id === me.id) throw new HttpProblem(422, 'cannot_follow_self', 'You can’t follow yourself.');
    if (target.i_blocked) throw new HttpProblem(403, 'blocked', 'Unblock this account to follow it.');
    await tx(db, async (c, after) => {
      const r = await c.query(`INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
        me.id,
        target.id,
      ]);
      if (r.rowCount) await notify(deps, c, after, { recipientId: target.id, actorId: me.id, kind: 'follow', entityId: me.id });
    });
    return reply.code(204).send();
  });

  app.delete('/users/:handle/follow', async (req, reply) => {
    const me = requireAuth(req);
    const { handle } = parse(handleParams, req.params);
    const target = await one(db, `SELECT id FROM users WHERE lower(handle) = lower($1)`, [handle]);
    if (target) await db.query(`DELETE FROM follows WHERE follower_id = $1 AND following_id = $2`, [me.id, target.id]);
    return reply.code(204).send();
  });

  app.post('/users/:handle/block', async (req, reply) => {
    const me = requireAuth(req);
    const { handle } = parse(handleParams, req.params);
    const target = await one(db, `SELECT id FROM users WHERE lower(handle) = lower($1) AND status <> 'deleting'`, [handle]);
    if (!target) throw new HttpProblem(404, 'not_found', 'User not found.');
    if (target.id === me.id) throw new HttpProblem(422, 'cannot_block_self', 'You can’t block yourself.');
    await tx(db, async (c) => {
      await c.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.id, target.id]);
      await c.query(
        `DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)`,
        [me.id, target.id],
      );
      await audit(c, me.id, 'user.block', 'user', target.id);
    });
    return reply.code(204).send();
  });

  app.delete('/users/:handle/block', async (req, reply) => {
    const me = requireAuth(req);
    const { handle } = parse(handleParams, req.params);
    const target = await one(db, `SELECT id FROM users WHERE lower(handle) = lower($1)`, [handle]);
    if (target) await db.query(`DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, [me.id, target.id]);
    return reply.code(204).send();
  });
}

export { DEFAULT_SETTINGS };
