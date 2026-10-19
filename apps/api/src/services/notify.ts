import type { Notification, NotificationKind } from '@zoko/contracts';
import type pg from 'pg';
import type { AppDeps } from '../context.js';
import type { AfterCommit, Queryable } from '../db.js';
import { many, one } from '../db.js';
import { summaryCols, toSummary } from './users.js';
import { visiblePostSql } from './posts.js';

export interface NotifyInput {
  recipientId: string;
  actorId: string | null;
  kind: NotificationKind;
  postId?: string | null;
  entityId?: string | null;
}

/**
 * Creates a notification row (skipping self-notifications and blocked pairs), queues a push in the
 * outbox, and pushes a realtime frame after commit.
 */
export async function notify(deps: AppDeps, client: pg.PoolClient, after: AfterCommit, input: NotifyInput): Promise<void> {
  if (input.actorId && input.actorId === input.recipientId) return;
  if (input.actorId) {
    const blocked = await one(
      client,
      `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [input.recipientId, input.actorId],
    );
    if (blocked) return;
  }
  let id: string | null = null;
  if (input.kind === 'message' && input.entityId) {
    // Coalesce message notifications per conversation and sender while unread.
    const existing = await one<{ id: string }>(
      client,
      `UPDATE notifications SET created_at = now()
        WHERE recipient_id = $1 AND actor_id = $2 AND kind = 'message' AND entity_id = $3 AND read_at IS NULL
        RETURNING id`,
      [input.recipientId, input.actorId, input.entityId],
    );
    id = existing?.id ?? null;
  }
  if (!id) {
    const row = await one<{ id: string }>(
      client,
      `INSERT INTO notifications (recipient_id, actor_id, kind, post_id, entity_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.recipientId, input.actorId, input.kind, input.postId ?? null, input.entityId ?? null],
    );
    id = row!.id;
  }
  await client.query(
    `INSERT INTO outbox_events (aggregate_kind, aggregate_id, event_kind, payload) VALUES ('notification', $1, 'notification.created', $2)`,
    [id, JSON.stringify({ recipient_id: input.recipientId, kind: input.kind })],
  );
  const nid = id;
  after(async () => {
    const [n] = await loadNotifications(deps, deps.db, input.recipientId, [nid]);
    if (n) deps.hub.publish([input.recipientId], { type: 'notification', notification: n });
  });
}

/** Hydrates notifications (actor summary and the post, when still visible to the recipient). */
export async function loadNotifications(
  deps: AppDeps,
  db: Queryable,
  recipientId: string,
  ids: string[],
): Promise<Notification[]> {
  if (!ids.length) return [];
  const rows = await many(
    db,
    `SELECT n.id, n.kind, n.entity_id, n.read_at, n.created_at, n.actor_id, ${summaryCols('a', 'a_')},
        CASE WHEN p.id IS NOT NULL AND ${visiblePostSql('p', 'pa', '$2')} THEN p.id END AS post_id,
        CASE WHEN p.id IS NOT NULL AND ${visiblePostSql('p', 'pa', '$2')} THEN p.body END AS post_body
       FROM notifications n
       LEFT JOIN users a ON a.id = n.actor_id
       LEFT JOIN posts p ON p.id = n.post_id
       LEFT JOIN users pa ON pa.id = p.author_id
      WHERE n.id = ANY($1::uuid[]) AND n.recipient_id = $2`,
    [ids, recipientId],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      actor: r.actor_id && r.a_id ? toSummary(deps.config, r, 'a_') : null,
      post: r.post_id ? { id: r.post_id, body: r.post_body } : null,
      entity_id: r.entity_id,
      read: r.read_at !== null,
      created_at: new Date(r.created_at).toISOString(),
    }));
}

export async function audit(
  db: Queryable,
  actorId: string | null,
  action: string,
  subjectKind: string,
  subjectId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (actor_id, action, subject_kind, subject_id, metadata) VALUES ($1, $2, $3, $4, $5)`,
    [actorId, action, subjectKind, subjectId, JSON.stringify(metadata)],
  );
}
