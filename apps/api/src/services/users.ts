import type { Me, Profile, UserSettings, UserSummary } from '@zoko/contracts';
import type { Config } from '../config.js';
import { mediaUrl } from '../context.js';
import { many, one, type Queryable } from '../db.js';
import { notFound } from '../lib/errors.js';

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  default_visibility: 'public',
  allow_message_requests: 'everyone',
  show_wallet_on_profile: true,
};

/** SQL select list for a UserSummary of the user aliased `a`, with columns prefixed by `px`. */
export function summaryCols(a: string, px: string): string {
  return `${a}.id AS ${px}id, ${a}.handle AS ${px}handle, ${a}.display_name AS ${px}display_name,
    ${a}.avatar_media_id AS ${px}avatar_media_id,
    (COALESCE((${a}.settings->>'show_wallet_on_profile')::boolean, true)
      AND EXISTS (SELECT 1 FROM wallet_connections wc WHERE wc.user_id = ${a}.id AND wc.revoked_at IS NULL)) AS ${px}has_wallet`;
}

export function toSummary(cfg: Config, row: Record<string, any>, px = ''): UserSummary {
  return {
    id: row[`${px}id`],
    handle: row[`${px}handle`],
    display_name: row[`${px}display_name`],
    avatar_url: mediaUrl(cfg, row[`${px}avatar_media_id`]),
    has_verified_wallet: Boolean(row[`${px}has_wallet`]),
  };
}

/** SQL condition: no block in either direction between user column `col` and viewer param `v`. */
export function notBlockedSql(col: string, v: string): string {
  return `NOT EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker_id = ${v} AND bk.blocked_id = ${col}) OR (bk.blocker_id = ${col} AND bk.blocked_id = ${v}))`;
}

export async function isBlockedEitherWay(db: Queryable, a: string, b: string): Promise<boolean> {
  const r = await one(
    db,
    `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`,
    [a, b],
  );
  return Boolean(r);
}

export async function summariesByIds(db: Queryable, cfg: Config, ids: string[]): Promise<Map<string, UserSummary>> {
  const out = new Map<string, UserSummary>();
  if (!ids.length) return out;
  const rows = await many(db, `SELECT ${summaryCols('u', '')} FROM users u WHERE u.id = ANY($1::uuid[])`, [
    [...new Set(ids)],
  ]);
  for (const r of rows) out.set(r.id, toSummary(cfg, r));
  return out;
}

const PROFILE_SQL = (where: string) => `
  SELECT ${summaryCols('u', '')}, u.bio, u.cover_media_id, u.created_at, u.status,
    (SELECT count(*)::int FROM follows f JOIN users fu ON fu.id = f.follower_id AND fu.status = 'active' WHERE f.following_id = u.id) AS followers_count,
    (SELECT count(*)::int FROM follows f JOIN users fu ON fu.id = f.following_id AND fu.status = 'active' WHERE f.follower_id = u.id) AS following_count,
    (SELECT count(*)::int FROM posts p WHERE p.author_id = u.id AND p.status = 'published' AND p.parent_id IS NULL) AS posts_count,
    EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id) AS is_following,
    EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.following_id = $1) AS follows_me,
    EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = $1 AND b.blocked_id = u.id) AS is_blocked,
    EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = u.id AND b.blocked_id = $1) AS blocked_me
  FROM users u WHERE ${where}`;

function toProfile(cfg: Config, r: Record<string, any>, viewerId: string): Profile {
  return {
    ...toSummary(cfg, r),
    bio: r.bio,
    cover_url: mediaUrl(cfg, r.cover_media_id),
    created_at: new Date(r.created_at).toISOString(),
    followers_count: r.followers_count,
    following_count: r.following_count,
    posts_count: r.posts_count,
    is_me: r.id === viewerId,
    is_following: r.is_following,
    follows_me: r.follows_me,
    is_blocked: r.is_blocked,
  };
}

/** Profile by handle as seen by viewer. Hidden (404) when inactive or when they blocked the viewer. */
export async function loadProfileByHandle(db: Queryable, cfg: Config, handle: string, viewerId: string): Promise<Profile> {
  const r = await one(db, PROFILE_SQL('lower(u.handle) = lower($2)'), [viewerId, handle]);
  if (!r || r.status !== 'active' || r.blocked_me) throw notFound('User');
  return toProfile(cfg, r, viewerId);
}

export async function loadMe(db: Queryable, cfg: Config, userId: string): Promise<Me> {
  const r = await one(
    db,
    PROFILE_SQL('u.id = $1').replace('FROM users u WHERE', ', u.role, u.settings, c.email FROM users u LEFT JOIN credentials c ON c.user_id = u.id WHERE'),
    [userId],
  );
  if (!r) throw notFound('User');
  return {
    ...toProfile(cfg, r, userId),
    email: r.email ?? '',
    role: r.role,
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
  };
}

/** Finds an active user by handle that is visible to the viewer (no block in either direction). */
export async function findVisibleUser(
  db: Queryable,
  handle: string,
  viewerId: string,
): Promise<{ id: string; handle: string; settings: UserSettings; i_blocked: boolean }> {
  const r = await one(
    db,
    `SELECT u.id, u.handle, u.settings,
        EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = $2 AND b.blocked_id = u.id) AS i_blocked,
        EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = u.id AND b.blocked_id = $2) AS blocked_me
       FROM users u WHERE lower(u.handle) = lower($1) AND u.status = 'active'`,
    [handle, viewerId],
  );
  if (!r || r.blocked_me) throw notFound('User');
  return { id: r.id, handle: r.handle, settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) }, i_blocked: r.i_blocked };
}
