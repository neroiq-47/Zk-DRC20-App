import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { loadConfig, type Config } from './config.js';
import { createPool } from './db.js';
import type { AppDeps } from './context.js';
import { TokenService } from './auth/tokens.js';
import { registerAuthHook } from './auth/hook.js';
import { HttpProblem, problemBody } from './lib/errors.js';
import { LocalDiskStorage } from './storage/storage.js';
import { RealtimeHub } from './realtime/hub.js';
import { DogecoinRpcChainSource } from './chain/chainSource.js';
import { SimulatedChain } from './chain/simulated.js';
import { FixtureIndexerAdapter, HttpIndexerAdapter, type IndexerAdapter } from './indexer/adapter.js';
import { SimulatedTransferBuilder } from './transfers/builder.js';
import { ExpoPushSender } from './services/push.js';
import { InvalidTransitionError } from './transfers/stateMachine.js';
import { one } from './db.js';

import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import postRoutes from './routes/posts.js';
import feedRoutes from './routes/feed.js';
import mediaRoutes from './routes/media.js';
import conversationRoutes from './routes/conversations.js';
import notificationRoutes from './routes/notifications.js';
import realtimeRoutes from './routes/realtime.js';
import moderationRoutes from './routes/moderation.js';
import walletRoutes from './routes/wallet.js';
import transferRoutes from './routes/transfers.js';
import devRoutes from './routes/dev.js';

/** Wires real implementations from config. Tests pass overrides (e.g. their own SimulatedChain). */
export function buildDeps(config: Config = loadConfig(), overrides: Partial<AppDeps> = {}): AppDeps {
  const db = overrides.db ?? createPool(config.databaseUrl);
  let simChain: SimulatedChain | null = null;
  let chain = overrides.chain;
  if (chain === undefined) {
    if (config.chainSource === 'simulated') chain = simChain = new SimulatedChain(config.simChainStatePath);
    else if (config.chainSource === 'rpc') chain = new DogecoinRpcChainSource(config.dogecoinRpcUrl!, config.dogecoinRpcUser, config.dogecoinRpcPassword);
    else chain = null;
  } else if (chain instanceof SimulatedChain) {
    simChain = chain;
  }
  const canonicalHeight = async () =>
    (await one<{ h: number | null }>(db, `SELECT max(height)::bigint AS h FROM chain_blocks WHERE canonical`))?.h ?? null;
  const indexers: IndexerAdapter[] =
    overrides.indexers ??
    config.indexers.map((spec, i) =>
      spec === 'fixture'
        ? FixtureIndexerAdapter.fromFile(`fixture-${i + 1}`, config.indexerFixturePath, canonicalHeight)
        : new HttpIndexerAdapter(spec),
    );
  return {
    config,
    db,
    tokens: overrides.tokens ?? new TokenService(config.jwtSecret, config.accessTokenTtlSeconds),
    storage: overrides.storage ?? new LocalDiskStorage(config.storageDir, config.publicBaseUrl),
    hub: overrides.hub ?? new RealtimeHub(),
    chain,
    simChain: overrides.simChain ?? simChain,
    indexers,
    builder: overrides.builder !== undefined ? overrides.builder : config.transferBuilder === 'simulated' ? new SimulatedTransferBuilder() : null,
    push: overrides.push ?? new ExpoPushSender(config.pushEnabled, config.expoPushUrl, config.expoAccessToken),
  };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.logLevel, redact: ['req.headers.authorization'] },
    bodyLimit: 1024 * 1024,
    // Only trust X-Forwarded-For behind a known proxy, otherwise per-IP rate limits can be bypassed.
    trustProxy: deps.config.trustProxy,
    // Media ids, handles etc. are validated by zod; keep Fastify's own schema validation off.
  });

  await app.register(cors, {
    origin: deps.config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Idempotent-Replayed'],
  });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => {
      const err = new HttpProblem(429, 'rate_limited', `Too many attempts. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.`);
      return Object.assign(err, { statusCode: 429 });
    },
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.setErrorHandler((err: FastifyError | HttpProblem | Error, req, reply) => {
    let problem;
    if (err instanceof HttpProblem) problem = err.toProblem();
    else if (err instanceof InvalidTransitionError) problem = problemBody(409, 'invalid_transfer_state', err.message);
    else if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
      const fe = err as FastifyError;
      const code = fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'payload_too_large' : fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 'unsupported_media_type' : 'bad_request';
      problem = problemBody(fe.statusCode!, code, fe.message);
    } else {
      req.log.error({ err }, 'unhandled error');
      problem = problemBody(500, 'internal_error', 'Something went wrong on our side. Try again.');
    }
    return reply.code(problem.status).type('application/problem+json').send(problem);
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).type('application/problem+json').send(problemBody(404, 'route_not_found', `No route for ${req.method} ${req.url.split('?')[0]}.`)),
  );

  registerAuthHook(app, deps);

  await app.register(
    async (api) => {
      await api.register(healthRoutes, deps);
      await api.register(authRoutes, deps);
      await api.register(userRoutes, deps);
      await api.register(postRoutes, deps);
      await api.register(feedRoutes, deps);
      await api.register(mediaRoutes, deps);
      await api.register(conversationRoutes, deps);
      await api.register(notificationRoutes, deps);
      await api.register(realtimeRoutes, deps);
      await api.register(moderationRoutes, deps);
      await api.register(walletRoutes, deps);
      await api.register(transferRoutes, deps);
      if (deps.config.devEndpoints) await api.register(devRoutes, deps);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
