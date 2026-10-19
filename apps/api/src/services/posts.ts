import type { MediaItem, Post } from '@zoko/contracts';
import type { Config } from '../config.js';
import { mediaUrl } from '../context.js';
import { many, type Queryable } from '../db.js';
import { summaryCols, toSummary } from './users.js';

/**
 * SQL condition: post `p` (author joined as `a`) is visible to viewer `v`.
 * - published, author active
 * - public, or the viewer is the author, or the viewer follows the author (followers-only)
 * - no block in either direction
 */
export function visiblePostSql(p: string, a: string, v: string): string {
  return `(${p}.status = 'published' AND ${a}.status = 'active'
    AND (${p}.visibility = 'public' OR ${p}.author_id = ${v}
         OR EXISTS (SELECT 1 FROM follows vf WHERE vf.follower_id = ${v} AND vf.following_id = ${p}.author_id))
    AND NOT EXISTS (SELECT 1 FROM blocks vb WHERE (vb.blocker_id = ${v} AND vb.blocked_id = ${p}.author_id)
                                              OR (vb.blocker_id = ${p}.author_id AND vb.blocked_id = ${v})))`;
}

/** SQL condition: a plain repost `p` only shows when its original is still visible to `v`. */
export function repostOriginalVisibleSql(p: string, v: string): string {
  return `(NOT ${p}.is_repost OR EXISTS (SELECT 1 FROM posts ro JOIN users roa ON roa.id = ro.author_id
            WHERE ro.id = ${p}.quote_post_id AND ${visiblePostSql('ro', 'roa', v)}))`;
}

/**
 * Loads full Post objects for ids, in the given order, as seen by viewer. Uses a fixed number of
 * queries regardless of page size (posts+counts, media, then the same for quoted posts).
 * Posts that are not visible to the viewer are dropped.
 */
export async function hydratePosts(db: Queryable, cfg: Config, ids: string[], viewerId: string, depth = 0): Promise<Post[]> {
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  const rows = await many(
    db,
    `SELECT p.id, p.body, p.visibility, p.created_at, p.parent_id, p.quote_post_id, p.is_repost,
        ${summaryCols('a', 'a_')},
        pa.handle AS reply_to_handle,
        (SELECT count(*)::int FROM reactions r WHERE r.post_id = p.id AND r.kind = 'like') AS like_count,
        (SELECT count(*)::int FROM posts c WHERE c.parent_id = p.id AND c.status = 'published') AS reply_count,
        (SELECT count(*)::int FROM posts q WHERE q.quote_post_id = p.id AND q.status = 'published') AS repost_count,
        EXISTS (SELECT 1 FROM reactions r WHERE r.post_id = p.id AND r.user_id = $2 AND r.kind = 'like') AS liked_by_me,
        EXISTS (SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = $2) AS bookmarked_by_me,
        EXISTS (SELECT 1 FROM posts q WHERE q.quote_post_id = p.id AND q.author_id = $2 AND q.is_repost
                  AND q.status = 'published') AS reposted_by_me
       FROM posts p
       JOIN users a ON a.id = p.author_id
       LEFT JOIN posts pp ON pp.id = p.parent_id
       LEFT JOIN users pa ON pa.id = pp.author_id
      WHERE p.id = ANY($1::uuid[]) AND ${visiblePostSql('p', 'a', '$2')}`,
    [unique, viewerId],
  );
  if (!rows.length) return [];

  const mediaRows = await many(
    db,
    `SELECT pm.post_id, m.id, m.kind, m.alt_text, m.width, m.height, m.thumbnail_key
       FROM post_media pm JOIN media m ON m.id = pm.media_id
      WHERE pm.post_id = ANY($1::uuid[]) AND m.processing_state = 'ready'
      ORDER BY pm.post_id, pm.sort_order`,
    [rows.map((r) => r.id)],
  );
  const mediaByPost = new Map<string, MediaItem[]>();
  for (const m of mediaRows) {
    const list = mediaByPost.get(m.post_id) ?? [];
    list.push({
      id: m.id,
      kind: m.kind,
      url: mediaUrl(cfg, m.id)!,
      // Thumbnails are not generated in the MVP (no transcoding pipeline yet).
      thumbnail_url: null,
      alt_text: m.alt_text,
      width: m.width,
      height: m.height,
    });
    mediaByPost.set(m.post_id, list);
  }

  const quotes = new Map<string, Post>();
  if (depth === 0) {
    const quoteIds = rows.map((r) => r.quote_post_id).filter(Boolean);
    for (const q of await hydratePosts(db, cfg, quoteIds, viewerId, depth + 1)) quotes.set(q.id, q);
  }

  const byId = new Map<string, Post>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      author: toSummary(cfg, r, 'a_'),
      body: r.body,
      visibility: r.visibility,
      created_at: new Date(r.created_at).toISOString(),
      parent_id: r.parent_id,
      reply_to_handle: r.reply_to_handle ?? null,
      quote: r.quote_post_id ? (quotes.get(r.quote_post_id) ?? null) : null,
      media: mediaByPost.get(r.id) ?? [],
      like_count: r.like_count,
      reply_count: r.reply_count,
      repost_count: r.repost_count,
      liked_by_me: r.liked_by_me,
      bookmarked_by_me: r.bookmarked_by_me,
      reposted_by_me: r.reposted_by_me,
    });
  }
  return ids.map((id) => byId.get(id)).filter((p): p is Post => Boolean(p));
}

/** Extracts lowercase #hashtags (letters, digits, underscore) from a post body. */
export function extractHashtags(body: string): string[] {
  const tags = new Set<string>();
  for (const m of body.matchAll(/(?:^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]{1,64})/gu)) {
    const tag = m[1].toLowerCase();
    if (!/^\d+$/.test(tag)) tags.add(tag);
  }
  return [...tags].slice(0, 20);
}

/** Extracts @handles mentioned in a post body. */
export function extractMentions(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(?:^|[^a-zA-Z0-9_@])@([a-zA-Z0-9_]{3,30})\b/g)) out.add(m[1].toLowerCase());
  return [...out].slice(0, 10);
}
