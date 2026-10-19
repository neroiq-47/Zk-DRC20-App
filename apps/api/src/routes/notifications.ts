import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NotificationPage } from '@zoko/contracts';
import type { AppDeps } from '../context.js';
import { many, one } from '../db.js';
import { requireAuth } from '../auth/hook.js';
import { parse, pageQuery } from '../lib/validate.js';
import { cursorTs, decodeCursor, pageFrom } from '../lib/cursor.js';
import { loadNotifications } from '../services/notify.js';

const deviceSchema = z.object({
  expo_push_token: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/, 'Not an Expo push token.'),
  platform: z.enum(['ios', 'android']),
});

export default async function notificationRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps;

  app.get('/notifications', async (req): Promise<NotificationPage> => {
    const me = requireAuth(req);
    const q = parse(pageQuery, req.query);
    const cur = decodeCursor(q.cursor);
    const rows = await many(
      db,
      `SELECT n.id AS _ci, ${cursorTs('n.created_at')} AS _ct
         FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
        WHERE n.recipient_id = $1
          AND (n.actor_id IS NULL OR (a.status = 'active' AND NOT EXISTS (SELECT 1 FROM blocks b
                WHERE (b.blocker_id = $1 AND b.blocked_id = n.actor_id) OR (b.blocker_id = n.actor_id AND b.blocked_id = $1))))
          AND ($2::timestamptz IS NULL OR (n.created_at, n.id) < ($2::timestamptz, $3::uuid))
        ORDER BY n.created_at DESC, n.id DESC LIMIT $4`,
      [me.id, cur?.t ?? null, cur?.i ?? null, q.limit + 1],
    );
    const page = pageFrom(rows, q.limit);
    const unread = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM notifications WHERE recipient_id = $1 AND read_at IS NULL`, [me.id]);
    return {
      items: await loadNotifications(deps, db, me.id, page.rows.map((r) => r._ci)),
      next_cursor: page.next_cursor,
      unread_count: unread?.n ?? 0,
    };
  });

  app.post('/notifications/read', async (req, reply) => {
    const me = requireAuth(req);
    await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL`, [me.id]);
    return reply.code(204).send();
  });

  app.post('/devices', async (req, reply) => {
    const me = requireAuth(req);
    const body = parse(deviceSchema, req.body);
    await db.query(
      `INSERT INTO devices (user_id, expo_push_token, platform) VALUES ($1, $2, $3)
       ON CONFLICT (expo_push_token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_error = NULL, updated_at = now()`,
      [me.id, body.expo_push_token, body.platform],
    );
    return reply.code(204).send();
  });
}
