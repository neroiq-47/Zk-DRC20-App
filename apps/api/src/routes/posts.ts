import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import type { Page, Post } from '@zoko/contracts';
import type { AppDeps, AuthUser } from '../context.js';
import { many, one, tx, type AfterCommit } from '../db.js';
import { requireAuth } from '../auth/hook.js';
import { HttpProblem, notFound } from '../lib/errors.js';
import { parse, pageQuery } from '../lib/validate.js';
import { cursorTs, decodeCursor, pageFrom } from '../lib/cursor.js';
import { withIdempotency } from '../lib/idempotency.js';
import { extractHashtags, extractMentions, hydratePosts, visiblePostSql } from '../services/posts.js';
import { DEFAULT_SETTINGS } from '../services/users.js';
import { audit, notify } from '../services/notify.js';

export const MAX_POST_CHARS = 500;

const createPostSchema = z.object({
  body: z.string().max(4000).default(''),
  visibility: z.enum(['public', 'followers']).optional(),
  media_ids: z.array(z.uuid()).max(4, 'Add up to 4 photos or videos.').optional(),
  parent_id: z.uuid().optional(),
  quote_post_id: z.uuid().optional(),
});
const idParams = z.object({ id: z.uuid() });

/** Loads a post the viewer can see (with its author) or throws 404. Blocked/hidden posts look absent. */
async function visiblePost(db: pg.PoolClient | AppDeps['db'], id: string, viewerId: string) {
  const p = await one(
    db,
    `SELECT p.id, p.author_id, p.visibility, p.is_repost, p.quote_post_id, p.body
       FROM posts p JOIN users a ON a.id = p.author_id
      WHERE p.id = $1 AND ${visiblePostSql('p', 'a', '$2')}`,
    [id, viewerId],
  );
  if (!p) throw notFound('Post');
  return p as { id: string; author_id: string; visibility: 'public' | 'followers'; is_repost: boolean; quote_post_id: string | null; body: string };
}

async function insertPost(
  deps: AppDeps,
  c: pg.PoolClient,
  after: AfterCommit,
  me: AuthUser,
  input: z.infer<typeof createPostSchema>,
  opts: { isRepost?: boolean } = {},
): Promise<Post> {
  const body = input.body ?? '';
  const mediaIds = [...new Set(input.media_ids ?? [])];
  if ([...body].length > MAX_POST_CHARS) {
    throw new HttpProblem(422, 'post_too_long', `Posts can be up to ${MAX_POST_CHARS} characters.`, {
      body: `Posts can be up to ${MAX_POST_CHARS} characters.`,
    });
  }
  if (!opts.isRepost && body.trim() === '' && !mediaIds.length && !input.quote_post_id) {
    throw new HttpProblem(422, 'post_empty', 'Write something or add a photo.', { body: 'Write something or add a photo.' });
  }
  if (input.parent_id && input.quote_post_id) {
    throw new HttpProblem(422, 'invalid_post', 'A post can’t be both a reply and a quote.');
  }

  const settings = await one(c, `SELECT settings FROM users WHERE id = $1`, [me.id]);
  const visibility = input.visibility ?? settings?.settings?.default_visibility ?? DEFAULT_SETTINGS.default_visibility;

  let parent: Awaited<ReturnType<typeof visiblePost>> | null = null;
  if (input.parent_id) parent = await visiblePost(c, input.parent_id, me.id);
  let quoted: Awaited<ReturnType<typeof visiblePost>> | null = null;
  if (input.quote_post_id) {
    quoted = await visiblePost(c, input.quote_post_id, me.id);
    if (quoted.is_repost && quoted.quote_post_id) quoted = await visiblePost(c, quoted.quote_post_id, me.id);
    if (quoted.visibility !== 'public') {
      throw new HttpProblem(422, 'cannot_quote_private', 'Followers-only posts can’t be reposted.');
    }
  }

  if (mediaIds.length) {
    const media = await many(
      c,
      `SELECT m.id, m.owner_id, m.processing_state, EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id) AS used
         FROM media m WHERE m.id = ANY($1::uuid[]) FOR UPDATE`,
      [mediaIds],
    );
    const errors: Record<string, string> = {};
    mediaIds.forEach((id, i) => {
      const m = media.find((x) => x.id === id);
      if (!m || m.owner_id !== me.id) errors[`media_ids.${i}`] = 'Media not found.';
      else if (m.processing_state !== 'ready') errors[`media_ids.${i}`] = 'This media is still processing or was rejected.';
      else if (m.used) errors[`media_ids.${i}`] = 'This media is already attached to another post.';
    });
    if (Object.keys(errors).length) throw new HttpProblem(422, 'invalid_media', 'Some media can’t be attached.', errors);
  }

  let row: { id: string };
  try {
    row = (await one<{ id: string }>(
      c,
      `INSERT INTO posts (author_id, parent_id, quote_post_id, body, visibility, is_repost, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp()) RETURNING id`,
      [me.id, parent?.id ?? null, quoted?.id ?? null, body, visibility, Boolean(opts.isRepost)],
    ))!;
  } catch (err) {
    if ((err as pg.DatabaseError).code === '23505') throw new HttpProblem(409, 'already_reposted', 'You already reposted this.');
    throw err;
  }
  for (const [i, id] of mediaIds.entries()) {
    await c.query(`INSERT INTO post_media (post_id, media_id, sort_order) VALUES ($1, $2, $3)`, [row.id, id, i]);
  }
  const tags = extractHashtags(body);
  if (tags.length) {
    await c.query(`INSERT INTO post_hashtags (post_id, tag) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [row.id, tags]);
  }

  // Notifications.
  if (parent) await notify(deps, c, after, { recipientId: parent.author_id, actorId: me.id, kind: 'reply', postId: row.id, entityId: row.id });
  if (quoted) await notify(deps, c, after, { recipientId: quoted.author_id, actorId: me.id, kind: 'repost', postId: quoted.id, entityId: row.id });
  const mentions = extractMentions(body);
  if (mentions.length) {
    const users = await many<{ id: string; can_see: boolean }>(
      c,
      `SELECT u.id, ($3 = 'public' OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.following_id = $2)) AS can_see
         FROM users u WHERE lower(u.handle) = ANY($1::text[]) AND u.status = 'active'`,
      [mentions, me.id, visibility],
    );
    for (const u of users) {
      if (u.can_see && u.id !== parent?.author_id) {
        await notify(deps, c, after, { recipientId: u.id, actorId: me.id, kind: 'mention', postId: row.id, entityId: row.id });
      }
    }
  }
  const [post] = await hydratePosts(c, deps.config, [row.id], me.id);
  return post;
}

export default async function postRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, config: cfg } = deps;

  app.post('/posts', async (req, reply) => {
    const me = requireAuth(req);
    const input = parse(createPostSchema, req.body);
    const res = await withIdempotency<Post>(db, req, me.id, 'POST /posts', async (c, after) => ({
      status: 201,
      body: await insertPost(deps, c, after, me, input),
    }));
    if (res.replayed) reply.header('Idempotent-Replayed', 'true');
    return reply.code(res.status).send(res.body);
  });

  app.get('/posts/:id', async (req) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const [post] = await hydratePosts(db, cfg, [id], me.id);
    if (!post) throw notFound('Post');
    return post;
  });

  app.delete('/posts/:id', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await tx(db, async (c) => {
      const p = await one(c, `SELECT id, author_id, status FROM posts WHERE id = $1 FOR UPDATE`, [id]);
      if (!p || p.status === 'deleted') throw notFound('Post');
      const isMod = me.role === 'moderator' || me.role === 'admin';
      if (p.author_id !== me.id && !isMod) throw new HttpProblem(403, 'forbidden', 'You can only delete your own posts.');
      await c.query(`UPDATE posts SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
      if (p.author_id !== me.id) {
        await c.query(
          `INSERT INTO moderation_actions (moderator_id, target_kind, target_id, action, reason) VALUES ($1, 'post', $2, 'delete_post', 'deleted by moderator')`,
          [me.id, id],
        );
        await audit(c, me.id, 'moderation.delete_post', 'post', id, { author_id: p.author_id });
      }
    });
    return reply.code(204).send();
  });

  app.get('/posts/:id/replies', async (req): Promise<Page<Post>> => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const q = parse(pageQuery, req.query);
    await visiblePost(db, id, me.id);
    const cur = decodeCursor(q.cursor);
    const rows = await many(
      db,
      `SELECT p.id AS _ci, ${cursorTs('p.created_at')} AS _ct
         FROM posts p JOIN users a ON a.id = p.author_id
        WHERE p.parent_id = $1 AND ${visiblePostSql('p', 'a', '$2')}
          AND ($3::timestamptz IS NULL OR (p.created_at, p.id) > ($3::timestamptz, $4::uuid))
        ORDER BY p.created_at ASC, p.id ASC LIMIT $5`,
      [id, me.id, cur?.t ?? null, cur?.i ?? null, q.limit + 1],
    );
    const page = pageFrom(rows, q.limit);
    return { items: await hydratePosts(db, cfg, page.rows.map((r) => r._ci), me.id), next_cursor: page.next_cursor };
  });

  app.post('/posts/:id/like', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await tx(db, async (c, after) => {
      const p = await visiblePost(c, id, me.id);
      const r = await c.query(`INSERT INTO reactions (user_id, post_id, kind) VALUES ($1, $2, 'like') ON CONFLICT DO NOTHING`, [me.id, id]);
      if (r.rowCount) await notify(deps, c, after, { recipientId: p.author_id, actorId: me.id, kind: 'like', postId: id, entityId: id });
    });
    return reply.code(204).send();
  });
  app.delete('/posts/:id/like', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await db.query(`DELETE FROM reactions WHERE user_id = $1 AND post_id = $2 AND kind = 'like'`, [me.id, id]);
    return reply.code(204).send();
  });

  app.post('/posts/:id/bookmark', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await visiblePost(db, id, me.id);
    await db.query(`INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.id, id]);
    return reply.code(204).send();
  });
  app.delete('/posts/:id/bookmark', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await db.query(`DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2`, [me.id, id]);
    return reply.code(204).send();
  });

  app.post('/posts/:id/repost', async (req: FastifyRequest, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const post = await tx(db, async (c, after) => {
      let target = await visiblePost(c, id, me.id);
      if (target.is_repost && target.quote_post_id) target = await visiblePost(c, target.quote_post_id, me.id);
      const existing = await one(
        c,
        `SELECT id FROM posts WHERE author_id = $1 AND quote_post_id = $2 AND is_repost AND status = 'published'`,
        [me.id, target.id],
      );
      if (existing) return (await hydratePosts(c, cfg, [existing.id], me.id))[0];
      return insertPost(deps, c, after, me, { body: '', quote_post_id: target.id, visibility: 'public' }, { isRepost: true });
    });
    return reply.code(201).send(post);
  });

  app.delete('/posts/:id/repost', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await db.query(
      `UPDATE posts SET status = 'deleted', deleted_at = now(), updated_at = now()
        WHERE author_id = $1 AND is_repost AND status = 'published'
          AND (quote_post_id = $2 OR quote_post_id = (SELECT quote_post_id FROM posts WHERE id = $2 AND is_repost))`,
      [me.id, id],
    );
    return reply.code(204).send();
  });
}
