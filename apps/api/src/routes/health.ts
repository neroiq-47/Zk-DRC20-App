import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../context.js';
import { one } from '../db.js';

export default async function healthRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/health', async (_req, reply) => {
    let database = 'ok';
    let chainHeight: number | null = null;
    try {
      const r = await one<{ height: number | null }>(deps.db, `SELECT max(height)::bigint AS height FROM chain_blocks WHERE canonical`);
      chainHeight = r?.height ?? null;
    } catch {
      database = 'error';
    }
    const body = {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      chain_source: deps.chain?.kind ?? 'none',
      chain_height: chainHeight,
      transfer_builder: deps.builder?.id ?? 'none',
      indexers: deps.indexers.map((i) => i.id),
      time: new Date().toISOString(),
    };
    return reply.code(database === 'ok' ? 200 : 503).send(body);
  });
}
