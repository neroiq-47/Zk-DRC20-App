import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Page, Post, SearchResults, Trend } from '@zoko/contracts';
import type { AppDeps } from '../context.js';
import { many } from '../db.js';
import { requireAuth } from '../auth/hook.js';
import { parse, pageQuery } from '../lib/validate.js';
import { cursorTs, decodeCursor, pageFrom } from '../lib/cursor.js';
import { hydratePosts, repostOriginalVisibleSql, visiblePostSql } from '../services/posts.js';
import { notBlockedSql, summaryCols, toSummary } from '../services/users.js';

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export default async function feedRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, config: cfg } = deps;

  /**
   * Following feed: my posts + posts of people I follow, newest first, keyset-paginated on
   * (created_at, id) so concurrent inserts never duplicate or skip items across pages.
   * Plain reposts are deduplicated with page-independent rules: a repost is hidden when the original
   * is itself in the feed, or when an earlier repost of the same original is already in the feed.
   */
  app.get('/feed', async (req): Promise<Page<Post>> => {
    const me = requireAuth(req);
    const q = parse(pageQuery, req.query);
    const cur = decodeCursor(q.cursor);
    const rows = await many(
      db,
      `WITH circle AS (SELECT $1::uuid AS id UNION SELECT following_id FROM follows WHERE follower_id = $1)
       SELECT p.id AS _ci, ${cursorTs('p.created_at')} AS _ct
         FROM posts p JOIN users a ON a.id = p.author_id
        WHERE p.author_id IN (SELECT id FROM circle)
          AND p.parent_id IS NULL
          AND ${visiblePostSql('p', 'a', '$1')}
          AND ${repostOriginalVisibleSql('p', '$1')}
          AND NOT (p.is_repost AND (
                EXISTS (SELECT 1 FROM posts o WHERE o.id = p.quote_post_id AND o.parent_id IS NULL
                          AND o.status = 'published' AND o.author_id IN (SELECT id FROM circle))
             OR EXISTS (SELECT 1 FROM posts r2 WHERE r2.is_repost AND r2.status = 'published'
                          AND r2.quote_post_id = p.quote_post_id AND r2.author_id IN (SELECT id FROM circle)
                          AND (r2.created_at, r2.id) < (p.created_at, p.id))))
          AND ($2::timestamptz IS NULL OR (p.created_at, p.id) < ($2::timestamptz, $3::uuid))
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $4`,
      [me.id, cur?.t ?? null, cur?.i ?? null, q.limit + 1],
    );
    const page = pageFrom(rows, q.limit);
    return { items: await hydratePosts(db, cfg, page.rows.map((r) => r._ci), me.id), next_cursor: page.next_cursor };
  });

  /** Discover: public, published, top-level original posts from active, unblocked authors. */
  app.get('/feed/discover', async (req): Promise<Page<Post>> => {
    const me = requireAuth(req);
    const q = parse(pageQuery, req.query);
    const cur = decodeCursor(q.cursor);
    const rows = await many(
      db,
      `SELECT p.id AS _ci, ${cursorTs('p.created_at')} AS _ct
         FROM posts p JOIN users a ON a.id = p.author_id
        WHERE p.visibility = 'public' AND p.status = 'published' AND p.parent_id IS NULL AND NOT p.is_repost
          AND ${visiblePostSql('p', 'a', '$1')}
          AND ($2::timestamptz IS NULL OR (p.created_at, p.id) < ($2::timestamptz, $3::uuid))
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $4`,
      [me.id, cur?.t ?? null, cur?.i ?? null, q.limit + 1],
    );
    const page = pageFrom(rows, q.limit);
    return { items: await hydratePosts(db, cfg, page.rows.map((r) => r._ci), me.id), next_cursor: page.next_cursor };
  });

  app.get('/search', async (req): Promise<SearchResults> => {
    const me = requireAuth(req);
    const q = parse(
      z.object({
        q: z.string().trim().min(1).max(100),
        type: z.enum(['all', 'users', 'posts']).default('all'),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
      req.query,
    );
    const term = q.q.replace(/^[@]/, '');
    const out: SearchResults = { users: [], posts: [] };
    if (q.type !== 'posts' && !q.q.startsWith('#')) {
      const rows = await many(
        db,
        `SELECT ${summaryCols('u', '')}
           FROM users u
          WHERE u.status = 'active' AND (u.handle ILIKE $2::text || '%' OR u.display_name ILIKE '%' || $2::text || '%')
            AND ${notBlockedSql('u.id', '$1')}
          ORDER BY (lower(u.handle) = lower($3::text)) DESC, (u.handle ILIKE $2::text || '%') DESC,
                   (SELECT count(*) FROM follows f WHERE f.following_id = u.id) DESC, u.handle
          LIMIT $4`,
        [me.id, likeEscape(term), term, q.limit],
      );
      out.users = rows.map((r) => toSummary(cfg, r));
    }
    if (q.type !== 'users') {
      const tag = q.q.startsWith('#') ? q.q.slice(1).toLowerCase() : null;
      const rows = await many<{ id: string }>(
        db,
        `SELECT p.id FROM posts p JOIN users a ON a.id = p.author_id
          WHERE p.visibility = 'public' AND NOT p.is_repost AND ${visiblePostSql('p', 'a', '$1')}
            AND ${
              tag
                ? 'EXISTS (SELECT 1 FROM post_hashtags h WHERE h.post_id = p.id AND h.tag = $2::text) AND $4::text IS NOT NULL'
                : `(p.body ILIKE '%' || $2::text || '%' OR EXISTS (SELECT 1 FROM post_hashtags h WHERE h.post_id = p.id AND h.tag = lower($4::text)))`
            }
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT $3`,
        [me.id, tag ?? likeEscape(q.q), q.limit, q.q],
      );
      out.posts = await hydratePosts(db, cfg, rows.map((r) => r.id), me.id);
    }
    return out;
  });

  app.get('/trends', async (req): Promise<{ items: Trend[] }> => {
    requireAuth(req);
    const rows = await many<Trend>(
      db,
      `SELECT h.tag, count(DISTINCT h.post_id)::int AS post_count
         FROM post_hashtags h JOIN posts p ON p.id = h.post_id JOIN users a ON a.id = p.author_id
        WHERE h.created_at > now() - interval '7 days'
          AND p.status = 'published' AND p.visibility = 'public' AND a.status = 'active'
        GROUP BY h.tag
        ORDER BY post_count DESC, max(h.created_at) DESC
        LIMIT 20`,
    );
    return { items: rows };
  });
}
