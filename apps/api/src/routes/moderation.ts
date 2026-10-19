import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ModerationReport, Page, Report } from '@zoko/contracts';
import type { AppDeps } from '../context.js';
import { many, one, tx, type Queryable } from '../db.js';
import { requireAuth, requireRole } from '../auth/hook.js';
import { HttpProblem, notFound } from '../lib/errors.js';
import { parse, pageQuery } from '../lib/validate.js';
import { cursorTs, decodeCursor, pageFrom } from '../lib/cursor.js';
import { summaryCols, toSummary } from '../services/users.js';
import { audit } from '../services/notify.js';
import { revokeAllSessions } from './auth.js';

const reportSchema = z.object({
  target_kind: z.enum(['user', 'post', 'message']),
  target_id: z.uuid(),
  reason: z.enum(['spam', 'harassment', 'hate', 'violence', 'sexual', 'scam', 'impersonation', 'other']),
  details: z.string().trim().max(1000).optional(),
});
const actionSchema = z.object({
  action: z.enum(['dismiss', 'hide_post', 'suspend_user', 'restore']),
  reason: z.string().trim().min(1).max(1000),
});

const REPORT_SQL = `SELECT r.id, r.status, r.target_kind, r.target_id, r.reason, r.created_at, ${summaryCols('u', 'u_')},
    r.id AS _ci, ${cursorTs('r.created_at')} AS _ct
  FROM reports r JOIN users u ON u.id = r.reporter_id`;

function toModerationReport(deps: AppDeps, r: any): ModerationReport {
  return {
    id: r.id,
    status: r.status,
    target_kind: r.target_kind,
    target_id: r.target_id,
    reason: r.reason,
    reporter: toSummary(deps.config, r, 'u_'),
    created_at: new Date(r.created_at).toISOString(),
  };
}

async function targetExists(db: Queryable, kind: string, id: string, reporterId: string): Promise<boolean> {
  if (kind === 'user') return Boolean(await one(db, `SELECT 1 FROM users WHERE id = $1`, [id]));
  if (kind === 'post') return Boolean(await one(db, `SELECT 1 FROM posts WHERE id = $1 AND status <> 'deleted'`, [id]));
  // Messages can only be reported by a member of the conversation.
  return Boolean(
    await one(
      db,
      `SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $2 WHERE m.id = $1`,
      [id, reporterId],
    ),
  );
}

export default async function moderationRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps;

  app.post('/reports', async (req, reply) => {
    const me = requireAuth(req);
    const body = parse(reportSchema, req.body);
    if (!(await targetExists(db, body.target_kind, body.target_id, me.id))) throw notFound('Reported content');
    const row = await one(
      db,
      `INSERT INTO reports (reporter_id, target_kind, target_id, reason, details) VALUES ($1, $2, $3, $4, $5) RETURNING id, status`,
      [me.id, body.target_kind, body.target_id, body.reason, body.details || null],
    );
    const res: Report = { id: row.id, status: row.status };
    return reply.code(201).send(res);
  });

  app.get('/moderation/reports', async (req): Promise<Page<ModerationReport>> => {
    requireRole(req, ['moderator', 'admin']);
    const q = parse(pageQuery.extend({ status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).default('open') }), req.query);
    const cur = decodeCursor(q.cursor);
    const rows = await many(
      db,
      `${REPORT_SQL} WHERE r.status = $1 AND ($2::timestamptz IS NULL OR (r.created_at, r.id) > ($2::timestamptz, $3::uuid))
       ORDER BY r.created_at ASC, r.id ASC LIMIT $4`,
      [q.status, cur?.t ?? null, cur?.i ?? null, q.limit + 1],
    );
    const page = pageFrom(rows, q.limit);
    return { items: page.rows.map((r) => toModerationReport(deps, r)), next_cursor: page.next_cursor };
  });

  app.post('/moderation/reports/:id/actions', async (req, reply) => {
    const mod = requireRole(req, ['moderator', 'admin']);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(actionSchema, req.body);
    await tx(db, async (c) => {
      const report = await one(c, `SELECT * FROM reports WHERE id = $1 FOR UPDATE`, [id]);
      if (!report) throw notFound('Report');
      let targetKind = report.target_kind as string;
      let targetId = report.target_id as string;

      if (body.action === 'hide_post') {
        if (report.target_kind === 'post') {
          await c.query(`UPDATE posts SET status = 'hidden', updated_at = now() WHERE id = $1 AND status = 'published'`, [targetId]);
        } else if (report.target_kind === 'message') {
          await c.query(`UPDATE messages SET deleted_at = now() WHERE id = $1`, [targetId]);
        } else {
          throw new HttpProblem(422, 'invalid_action', 'hide_post applies to post or message reports.');
        }
      } else if (body.action === 'suspend_user') {
        if (report.target_kind !== 'user') {
          const table = report.target_kind === 'post' ? 'posts' : 'messages';
          const col = report.target_kind === 'post' ? 'author_id' : 'sender_id';
          const t = await one(c, `SELECT ${col} AS uid FROM ${table} WHERE id = $1`, [targetId]);
          if (!t) throw notFound('Reported content');
          targetKind = 'user';
          targetId = t.uid;
        }
        const target = await one(c, `SELECT role FROM users WHERE id = $1`, [targetId]);
        if (!target) throw notFound('User');
        if (target.role === 'admin' || (target.role === 'moderator' && mod.role !== 'admin')) {
          throw new HttpProblem(403, 'forbidden_role', 'You can’t suspend this account.');
        }
        await c.query(`UPDATE users SET status = 'suspended', updated_at = now() WHERE id = $1 AND status = 'active'`, [targetId]);
        await revokeAllSessions(c, targetId, 'suspended');
      } else if (body.action === 'restore') {
        if (report.target_kind === 'post') {
          await c.query(`UPDATE posts SET status = 'published', updated_at = now() WHERE id = $1 AND status = 'hidden'`, [targetId]);
        } else if (report.target_kind === 'message') {
          await c.query(`UPDATE messages SET deleted_at = NULL WHERE id = $1`, [targetId]);
        } else {
          await c.query(`UPDATE users SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'suspended'`, [targetId]);
        }
      }

      const status = body.action === 'dismiss' ? 'dismissed' : 'resolved';
      await c.query(`UPDATE reports SET status = $2, resolved_at = now(), resolved_by = $3 WHERE id = $1`, [id, status, mod.id]);
      await c.query(
        `INSERT INTO moderation_actions (report_id, moderator_id, target_kind, target_id, action, reason) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, mod.id, targetKind, targetId, body.action, body.reason],
      );
      await audit(c, mod.id, `moderation.${body.action}`, targetKind, targetId, { report_id: id, reason: body.reason });
    });
    const row = await one(db, `${REPORT_SQL} WHERE r.id = $1`, [id]);
    return reply.code(201).send(toModerationReport(deps, row));
  });
}
