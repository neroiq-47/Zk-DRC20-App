import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Conversation, Message, Page } from '@zoko/contracts';
import type { AppDeps } from '../context.js';
import { many, one, tx, type Queryable } from '../db.js';
import { requireAuth } from '../auth/hook.js';
import { HttpProblem, notFound } from '../lib/errors.js';
import { parse, pageQuery } from '../lib/validate.js';
import { cursorTs, decodeCursor, pageFrom } from '../lib/cursor.js';
import { findVisibleUser, isBlockedEitherWay, summaryCols, toSummary } from '../services/users.js';
import { notify } from '../services/notify.js';

const idParams = z.object({ id: z.uuid() });
const startSchema = z.object({ handle: z.string().trim().min(1).max(31).transform((h) => h.replace(/^@/, '')) });
const sendSchema = z.object({
  body: z.string().refine((s) => s.trim().length > 0, 'Write a message.').pipe(z.string().max(4000)),
  client_id: z.string().min(1).max(64).optional(),
});

export function toMessage(r: any): Message {
  return {
    id: r.id,
    conversation_id: r.conversation_id,
    sender_id: r.sender_id,
    body: r.body,
    created_at: new Date(r.created_at).toISOString(),
    client_id: r.client_id ?? null,
  };
}

const CONVERSATION_SQL = (extraWhere: string) => `
  SELECT c.id, c.updated_at, ${cursorTs('c.updated_at')} AS _ct, c.id AS _ci,
      me.accepted_at IS NULL AS is_request,
      ${summaryCols('ou', 'o_')},
      lm.id AS lm_id, lm.sender_id AS lm_sender_id, lm.body AS lm_body, lm.created_at AS lm_created_at, lm.client_id AS lm_client_id,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.deleted_at IS NULL
          AND m.created_at > COALESCE(me.last_read_at, '-infinity'::timestamptz)) AS unread_count
    FROM conversation_members me
    JOIN conversations c ON c.id = me.conversation_id
    JOIN conversation_members om ON om.conversation_id = c.id AND om.user_id <> $1
    JOIN users ou ON ou.id = om.user_id
    LEFT JOIN LATERAL (
      SELECT m.* FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    ) lm ON true
   WHERE me.user_id = $1 AND ${extraWhere}`;

function toConversation(deps: AppDeps, r: any): Conversation {
  return {
    id: r.id,
    other: toSummary(deps.config, r, 'o_'),
    last_message: r.lm_id
      ? toMessage({ id: r.lm_id, conversation_id: r.id, sender_id: r.lm_sender_id, body: r.lm_body, created_at: r.lm_created_at, client_id: r.lm_client_id })
      : null,
    unread_count: r.unread_count,
    is_request: r.is_request,
    updated_at: new Date(r.updated_at).toISOString(),
  };
}

/** Loads a conversation for a member, or 404 for anyone else (membership check on every read/write). */
export async function loadConversation(deps: AppDeps, db: Queryable, id: string, userId: string): Promise<Conversation> {
  const r = await one(db, CONVERSATION_SQL('c.id = $2'), [userId, id]);
  if (!r) throw notFound('Conversation');
  return toConversation(deps, r);
}

async function requireMember(db: Queryable, conversationId: string, userId: string) {
  const m = await one<{ accepted_at: Date | null; other_id: string }>(
    db,
    `SELECT me.accepted_at, om.user_id AS other_id
       FROM conversation_members me
       JOIN conversation_members om ON om.conversation_id = me.conversation_id AND om.user_id <> me.user_id
      WHERE me.conversation_id = $1 AND me.user_id = $2`,
    [conversationId, userId],
  );
  if (!m) throw notFound('Conversation');
  return m;
}

export default async function conversationRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps;

  app.get('/conversations', async (req): Promise<Page<Conversation>> => {
    const me = requireAuth(req);
    const q = parse(pageQuery, req.query);
    const cur = decodeCursor(q.cursor);
    const rows = await many(
      db,
      `${CONVERSATION_SQL(`ou.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = ou.id) OR (b.blocker_id = ou.id AND b.blocked_id = $1))
          AND ($2::timestamptz IS NULL OR (c.updated_at, c.id) < ($2::timestamptz, $3::uuid))`)}
       ORDER BY c.updated_at DESC, c.id DESC LIMIT $4`,
      [me.id, cur?.t ?? null, cur?.i ?? null, q.limit + 1],
    );
    const page = pageFrom(rows, q.limit);
    return { items: page.rows.map((r) => toConversation(deps, r)), next_cursor: page.next_cursor };
  });

  app.post('/conversations', async (req, reply) => {
    const me = requireAuth(req);
    const { handle } = parse(startSchema, req.body);
    const target = await findVisibleUser(db, handle, me.id);
    if (target.id === me.id) throw new HttpProblem(422, 'cannot_message_self', 'You can’t message yourself.');
    if (target.i_blocked) throw new HttpProblem(403, 'blocked', 'Unblock this account to message it.');
    const directKey = [me.id, target.id].sort().join(':');
    const id = await tx(db, async (c) => {
      const existing = await one(c, `SELECT id FROM conversations WHERE direct_key = $1`, [directKey]);
      if (existing) return existing.id as string;
      const theyFollowMe = Boolean(
        await one(c, `SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2`, [target.id, me.id]),
      );
      // 'everyone': anyone may send a request; 'following': only people they follow; 'nobody': no new conversations.
      const pref = target.settings.allow_message_requests;
      if (pref === 'nobody' || (pref === 'following' && !theyFollowMe)) {
        throw new HttpProblem(403, 'messages_not_allowed', 'This person isn’t accepting new messages.');
      }
      const conv = await one(
        c,
        `INSERT INTO conversations (kind, created_by, direct_key) VALUES ('direct', $1, $2)
         ON CONFLICT (direct_key) DO NOTHING RETURNING id`,
        [me.id, directKey],
      );
      if (!conv) return (await one(c, `SELECT id FROM conversations WHERE direct_key = $1`, [directKey])).id as string;
      await c.query(
        `INSERT INTO conversation_members (conversation_id, user_id, accepted_at) VALUES ($1, $2, now()), ($1, $3, $4)`,
        [conv.id, me.id, target.id, theyFollowMe ? new Date() : null],
      );
      return conv.id as string;
    });
    return reply.code(201).send(await loadConversation(deps, db, id, me.id));
  });

  app.get('/conversations/:id', async (req) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    return loadConversation(deps, db, id, me.id);
  });

  app.get('/conversations/:id/messages', async (req): Promise<Page<Message>> => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const q = parse(pageQuery, req.query);
    await requireMember(db, id, me.id);
    const cur = decodeCursor(q.cursor);
    const rows = await many(
      db,
      `SELECT m.*, m.id AS _ci, ${cursorTs('m.created_at')} AS _ct FROM messages m
        WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
          AND ($2::timestamptz IS NULL OR (m.created_at, m.id) < ($2::timestamptz, $3::uuid))
        ORDER BY m.created_at DESC, m.id DESC LIMIT $4`,
      [id, cur?.t ?? null, cur?.i ?? null, q.limit + 1],
    );
    const page = pageFrom(rows, q.limit);
    return { items: page.rows.map(toMessage), next_cursor: page.next_cursor };
  });

  app.post('/conversations/:id/messages', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const body = parse(sendSchema, req.body);
    const result = await tx(db, async (c, after) => {
      const member = await requireMember(c, id, me.id);
      const other = await one(c, `SELECT status FROM users WHERE id = $1`, [member.other_id]);
      if (!other || other.status !== 'active') throw new HttpProblem(403, 'recipient_unavailable', 'This account isn’t available.');
      if (await isBlockedEitherWay(c, me.id, member.other_id)) {
        throw new HttpProblem(403, 'blocked', 'You can’t message this account.');
      }
      if (body.client_id) {
        const dup = await one(c, `SELECT * FROM messages WHERE conversation_id = $1 AND sender_id = $2 AND client_id = $3`, [
          id,
          me.id,
          body.client_id,
        ]);
        if (dup) return toMessage(dup);
      }
      let row = await one(
        c,
        `INSERT INTO messages (conversation_id, sender_id, body, client_id, created_at) VALUES ($1, $2, $3, $4, clock_timestamp())
         ON CONFLICT (conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING *`,
        [id, me.id, body.body, body.client_id ?? null],
      );
      if (!row) {
        row = await one(c, `SELECT * FROM messages WHERE conversation_id = $1 AND sender_id = $2 AND client_id = $3`, [id, me.id, body.client_id]);
        return toMessage(row);
      }
      // Replying accepts a message request; reading/sending updates my read marker.
      await c.query(
        `UPDATE conversation_members SET accepted_at = COALESCE(accepted_at, now()), last_read_at = $3 WHERE conversation_id = $1 AND user_id = $2`,
        [id, me.id, row.created_at],
      );
      await c.query(`UPDATE conversations SET updated_at = $2 WHERE id = $1`, [id, row.created_at]);
      await notify(deps, c, after, { recipientId: member.other_id, actorId: me.id, kind: 'message', entityId: id });
      const msg = toMessage(row);
      after(() => deps.hub.publish([me.id, member.other_id], { type: 'message', message: msg }));
      return msg;
    });
    return reply.code(201).send(result);
  });

  app.post('/conversations/:id/read', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await requireMember(db, id, me.id);
    await db.query(`UPDATE conversation_members SET last_read_at = clock_timestamp() WHERE conversation_id = $1 AND user_id = $2`, [id, me.id]);
    await db.query(
      `UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND kind = 'message' AND entity_id = $2 AND read_at IS NULL`,
      [me.id, id],
    );
    return reply.code(204).send();
  });

  app.post('/conversations/:id/accept', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    await requireMember(db, id, me.id);
    await db.query(`UPDATE conversation_members SET accepted_at = COALESCE(accepted_at, now()) WHERE conversation_id = $1 AND user_id = $2`, [
      id,
      me.id,
    ]);
    return reply.code(204).send();
  });
}
