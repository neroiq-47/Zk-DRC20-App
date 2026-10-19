import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../context.js';
import { requireAuth } from '../auth/hook.js';
import { HttpProblem } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { syncChain } from '../chain/sync.js';
import { monitorTransfers } from '../transfers/service.js';
import { SimulatedTransferBuilder } from '../transfers/builder.js';

/**
 * Development-only helpers (DEV_ENDPOINTS=true, refused in production). Not part of the app contract.
 *   POST /dev/chain/mine   { blocks?: number }            mine simulated blocks, then sync + monitor
 *   POST /dev/chain/reorg  { depth: number, keep_txs?: boolean }
 *   POST /dev/sign-simulated { data: string }            emulate a wallet signing a simulated unsigned tx
 */
export default async function devRoutes(app: FastifyInstance, deps: AppDeps) {
  const sim = () => {
    if (!deps.simChain) throw new HttpProblem(404, 'not_found', 'The simulated chain is not enabled.');
    return deps.simChain;
  };
  const step = async () => {
    const sync = await syncChain(deps);
    await monitorTransfers(deps);
    return sync;
  };

  app.post('/dev/chain/mine', async (req) => {
    requireAuth(req);
    const { blocks } = parse(z.object({ blocks: z.number().int().min(1).max(100).default(1) }), req.body ?? {});
    sim().mine(blocks);
    const sync = await step();
    return { tip: sync.tip, added: sync.added };
  });

  app.post('/dev/chain/reorg', async (req) => {
    requireAuth(req);
    const body = parse(z.object({ depth: z.number().int().min(1).max(50), keep_txs: z.boolean().default(false) }), req.body);
    sim().reorg(body.depth, { returnToMempool: body.keep_txs });
    const sync = await step();
    return { tip: sync.tip, orphaned: sync.orphaned.length, reorged_transfers: sync.reorgedTransfers };
  });

  app.post('/dev/sign-simulated', async (req) => {
    requireAuth(req);
    if (deps.builder?.id !== 'simulated') throw new HttpProblem(404, 'not_found', 'The simulated builder is not enabled.');
    const { data } = parse(z.object({ data: z.string().regex(/^[0-9a-f]+$/i).max(200_000) }), req.body);
    return { signed_payload: SimulatedTransferBuilder.simulateSignature(data) };
  });
}
