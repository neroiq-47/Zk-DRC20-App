import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../context.js';
import { resolveAccessToken } from '../auth/hook.js';
import { problemBody } from '../lib/errors.js';
import { one } from '../db.js';

/**
 * WS /api/v1/ws?access_token=...
 * The token is verified before the upgrade; an invalid or missing token gets a 401 and no socket.
 * Each socket receives only RealtimeEvent frames addressed to its user (e.g. as a conversation member).
 * Optional client frames: {"type":"ping"} -> {"type":"pong"};
 * {"type":"subscribe","conversation_id":...} is checked against membership: a non-member receives
 * {"type":"error","code":"forbidden"} and the socket is closed with code 4403.
 */
export default async function realtimeRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get(
    '/ws',
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const q = req.query as Record<string, string | undefined>;
        const header = req.headers.authorization?.replace(/^Bearer\s+/i, '');
        const token = q.access_token || header;
        if (!token) return reply.code(401).type('application/problem+json').send(problemBody(401, 'unauthenticated', 'Missing access token.'));
        const r = await resolveAccessToken(deps, token);
        if ('error' in r) return reply.code(401).type('application/problem+json').send(problemBody(401, r.error, 'Invalid access token.'));
        req.authUser = r.user;
      },
    },
    (socket, req) => {
      const user = req.authUser!;
      const remove = deps.hub.add(user.id, socket);
      socket.on('close', remove);
      socket.on('error', remove);
      socket.on('message', async (raw: Buffer) => {
        let msg: any;
        try {
          msg = JSON.parse(raw.toString('utf8'));
        } catch {
          return;
        }
        if (msg?.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
        if (msg?.type === 'subscribe') {
          const ok =
            typeof msg.conversation_id === 'string' &&
            /^[0-9a-f-]{36}$/i.test(msg.conversation_id) &&
            (await one(deps.db, `SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [msg.conversation_id, user.id]));
          if (!ok) {
            socket.send(JSON.stringify({ type: 'error', code: 'forbidden' }));
            socket.close(4403, 'forbidden');
          } else {
            socket.send(JSON.stringify({ type: 'subscribed', conversation_id: msg.conversation_id }));
          }
        }
      });
    },
  );
}
