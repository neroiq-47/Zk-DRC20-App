import { loadConfig } from './config.js';
import { buildApp, buildDeps } from './app.js';
import { startWorker } from './worker.js';

const config = loadConfig();
const deps = buildDeps(config);
const app = await buildApp(deps);

const stopWorker = config.workerEnabled
  ? startWorker(deps, (msg, err) => app.log.warn({ err }, msg))
  : () => undefined;

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  stopWorker();
  deps.hub.closeAll();
  await app.close();
  await deps.db.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
app.log.info(
  `Zoko API on ${config.publicBaseUrl}/api/v1 (chain=${deps.chain?.kind ?? 'none'}, builder=${deps.builder?.id ?? 'none'}, indexers=${deps.indexers.map((i) => i.id).join(',') || 'none'})`,
);
