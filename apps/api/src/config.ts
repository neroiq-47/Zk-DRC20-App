import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/api directory (works from src/ under tsx and from dist/ after build). */
export const API_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(API_ROOT, '..', '..');

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number in env ${name}: ${v}`);
  return Math.trunc(n);
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export type ChainSourceKind = 'simulated' | 'rpc' | 'none';
export type BuilderKind = 'simulated' | 'none';

export interface Config {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  publicBaseUrl: string;
  appDomain: string;
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  corsOrigins: string[] | true;
  storageDir: string;
  workerEnabled: boolean;
  workerIntervalMs: number;
  pushEnabled: boolean;
  expoPushUrl: string;
  expoAccessToken: string | null;
  requiredConfirmations: number;
  chainSource: ChainSourceKind;
  dogecoinRpcUrl: string | null;
  dogecoinRpcUser: string | null;
  dogecoinRpcPassword: string | null;
  chainSyncStartDepth: number;
  simChainStatePath: string | null;
  simBlockIntervalMs: number;
  transferBuilder: BuilderKind;
  indexers: string[]; // 'fixture' or http(s) URLs
  indexerFixturePath: string;
  assetStaleSeconds: number;
  devEndpoints: boolean;
  logLevel: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const rawEnv = str('NODE_ENV', 'development');
  const env: Config['env'] = rawEnv === 'production' ? 'production' : rawEnv === 'test' ? 'test' : 'development';
  const isProduction = env === 'production';

  const jwtSecret = str('JWT_SECRET', isProduction ? '' : 'dev-only-insecure-jwt-secret-change-me-0123456789');
  const corsRaw = str('CORS_ORIGINS', isProduction ? '' : '*');
  const indexersRaw = str('INDEXERS', isProduction ? '' : 'fixture,fixture');

  const cfg: Config = {
    env,
    isProduction,
    host: str('HOST', '0.0.0.0'),
    port: int('PORT', 4000),
    databaseUrl: str('DATABASE_URL', 'postgres://postgres@127.0.0.1:5432/zoko'),
    publicBaseUrl: str('PUBLIC_BASE_URL', 'http://localhost:4000').replace(/\/$/, ''),
    appDomain: str('APP_DOMAIN', 'zoko.app'),
    jwtSecret,
    accessTokenTtlSeconds: int('ACCESS_TOKEN_TTL_SECONDS', 15 * 60),
    refreshTokenTtlDays: int('REFRESH_TOKEN_TTL_DAYS', 30),
    authRateLimitMax: int('AUTH_RATE_LIMIT_MAX', 20),
    authRateLimitWindowMs: int('AUTH_RATE_LIMIT_WINDOW_MS', 60_000),
    corsOrigins: corsRaw === '*' ? true : corsRaw.split(',').map((s) => s.trim()).filter(Boolean),
    storageDir: path.resolve(API_ROOT, str('STORAGE_DIR', 'storage')),
    workerEnabled: bool('WORKER_ENABLED', env !== 'test'),
    workerIntervalMs: int('WORKER_INTERVAL_MS', 5000),
    pushEnabled: bool('PUSH_ENABLED', false),
    expoPushUrl: str('EXPO_PUSH_URL', 'https://exp.host/--/api/v2/push/send'),
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN || null,
    requiredConfirmations: int('REQUIRED_CONFIRMATIONS', 6),
    chainSource: str('CHAIN_SOURCE', isProduction ? 'none' : 'simulated') as ChainSourceKind,
    dogecoinRpcUrl: process.env.DOGECOIN_RPC_URL || null,
    dogecoinRpcUser: process.env.DOGECOIN_RPC_USER || null,
    dogecoinRpcPassword: process.env.DOGECOIN_RPC_PASSWORD || null,
    chainSyncStartDepth: int('CHAIN_SYNC_START_DEPTH', 12),
    simChainStatePath: env === 'test' ? null : path.resolve(API_ROOT, str('SIM_CHAIN_STATE_PATH', 'storage/sim-chain.json')),
    simBlockIntervalMs: int('SIM_BLOCK_INTERVAL_MS', 30_000),
    transferBuilder: str('TRANSFER_BUILDER', isProduction ? 'none' : 'simulated') as BuilderKind,
    indexers: indexersRaw.split(',').map((s) => s.trim()).filter(Boolean),
    indexerFixturePath: path.resolve(API_ROOT, str('INDEXER_FIXTURE_PATH', 'fixtures/indexer.json')),
    assetStaleSeconds: int('ASSET_STALE_SECONDS', 60),
    devEndpoints: bool('DEV_ENDPOINTS', !isProduction),
    logLevel: str('LOG_LEVEL', env === 'test' ? 'silent' : 'info'),
    ...overrides,
  };
  validateConfig(cfg);
  return cfg;
}

export function validateConfig(cfg: Config): void {
  if (!['simulated', 'rpc', 'none'].includes(cfg.chainSource)) throw new Error(`CHAIN_SOURCE must be simulated|rpc|none`);
  if (!['simulated', 'none'].includes(cfg.transferBuilder)) throw new Error(`TRANSFER_BUILDER must be simulated|none`);
  if (cfg.chainSource === 'rpc' && !cfg.dogecoinRpcUrl) throw new Error('CHAIN_SOURCE=rpc requires DOGECOIN_RPC_URL');
  if (cfg.isProduction) {
    if (cfg.jwtSecret.length < 32) throw new Error('JWT_SECRET must be set (>= 32 chars) in production');
    // Simulations must never back real users: refuse to boot rather than fake success.
    if (cfg.chainSource === 'simulated') throw new Error('CHAIN_SOURCE=simulated is not allowed in production');
    if (cfg.transferBuilder === 'simulated') throw new Error('TRANSFER_BUILDER=simulated is not allowed in production');
    if (cfg.indexers.includes('fixture')) throw new Error('INDEXERS=fixture is not allowed in production');
    if (cfg.devEndpoints) throw new Error('DEV_ENDPOINTS must be off in production');
  }
  if (cfg.requiredConfirmations < 1) throw new Error('REQUIRED_CONFIRMATIONS must be >= 1');
}
