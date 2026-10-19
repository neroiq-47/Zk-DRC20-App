import { inject } from 'vitest';
import pg from 'pg';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AuthResponse } from '@zoko/contracts';
import { loadConfig, type Config } from '../src/config.js';
import { buildApp, buildDeps } from '../src/app.js';
import type { AppDeps } from '../src/context.js';
import { SimulatedChain } from '../src/chain/simulated.js';
import { p2pkhAddress, publicKeyFor, signDogecoinMessage } from '../src/chain/dogecoin.js';
import { FixtureIndexerAdapter } from '../src/indexer/adapter.js';

export const templateUrl = inject('testDbTemplateUrl');
export const hasDb = Boolean(templateUrl);

function withDb(url: string, name: string) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function createDatabase(): Promise<string> {
  const tpl = new URL(templateUrl!).pathname.slice(1);
  const name = `${tpl}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: withDb(templateUrl!, 'postgres') });
  await admin.connect();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await admin.query(`CREATE DATABASE ${name} TEMPLATE ${tpl}`);
        break;
      } catch (err) {
        // Concurrent copies of the same template can collide; retry briefly.
        if (attempt > 40 || !/being accessed by other users/.test(String((err as Error).message))) throw err;
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
      }
    }
  } finally {
    await admin.end();
  }
  return withDb(templateUrl!, name);
}

export const FIXTURE_PATH = path.resolve(import.meta.dirname, '..', 'fixtures', 'indexer.json');

export interface TestCtx {
  app: FastifyInstance;
  deps: AppDeps;
  chain: SimulatedChain;
  close: () => Promise<void>;
}

export async function createTestApp(opts: { config?: Partial<Config>; deps?: Partial<AppDeps> } = {}): Promise<TestCtx> {
  const databaseUrl = await createDatabase();
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoko-media-'));
  const config = loadConfig({
    env: 'test',
    isProduction: false,
    databaseUrl,
    storageDir,
    workerEnabled: false,
    logLevel: 'silent',
    authRateLimitMax: 10_000,
    devEndpoints: true,
    simChainStatePath: null,
    chainSource: 'simulated',
    transferBuilder: 'simulated',
    requiredConfirmations: 6,
    ...opts.config,
  });
  const chain = (opts.deps?.chain as SimulatedChain) ?? new SimulatedChain(null);
  const deps = buildDeps(config, {
    chain,
    indexers: [
      FixtureIndexerAdapter.fromFile('fixture-a', FIXTURE_PATH),
      FixtureIndexerAdapter.fromFile('fixture-b', FIXTURE_PATH),
    ],
    ...opts.deps,
  });
  const app = await buildApp(deps);
  await app.ready();
  return {
    app,
    deps,
    chain,
    close: async () => {
      deps.hub.closeAll();
      await app.close();
      await deps.db.end();
      fs.rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, any>;
}

export function client(app: FastifyInstance, token?: string) {
  const call = async <T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> => {
    const res = await app.inject({
      method: method as any,
      url: `/api/v1${url}`,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.statusCode, body: res.body ? (res.json() as T) : (undefined as T), headers: res.headers };
  };
  return {
    get: <T = any>(url: string, h?: Record<string, string>) => call<T>('GET', url, undefined, h),
    post: <T = any>(url: string, body?: unknown, h?: Record<string, string>) => call<T>('POST', url, body, h),
    patch: <T = any>(url: string, body?: unknown) => call<T>('PATCH', url, body),
    del: <T = any>(url: string) => call<T>('DELETE', url),
  };
}

let seq = 0;
export function uniqueHandle(prefix = 'u'): string {
  seq += 1;
  return `${prefix}_${randomBytes(3).toString('hex')}${seq}`.slice(0, 30);
}

export interface TestUser {
  id: string;
  handle: string;
  email: string;
  password: string;
  token: string;
  refresh: string;
  api: ReturnType<typeof client>;
}

export async function registerUser(app: FastifyInstance, handle = uniqueHandle()): Promise<TestUser> {
  const email = `${handle}@example.test`;
  const password = 'correct horse battery staple';
  const res = await client(app).post<AuthResponse>('/auth/register', { email, password, handle });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  return {
    id: res.body.user.id,
    handle,
    email,
    password,
    token: res.body.access_token,
    refresh: res.body.refresh_token,
    api: client(app, res.body.access_token),
  };
}

export async function setRole(deps: AppDeps, userId: string, role: 'user' | 'moderator' | 'admin') {
  await deps.db.query(`UPDATE users SET role = $2 WHERE id = $1`, [userId, role]);
}

export function newKey() {
  const priv = new Uint8Array(randomBytes(32));
  const pub = publicKeyFor(priv, true);
  return { priv, address: p2pkhAddress(pub) };
}

/** Full wallet proof flow with a freshly generated key. */
export async function connectWallet(user: TestUser, key = newKey()) {
  const ch = await user.api.post('/wallet/challenges', { address: key.address, provider: 'manual' });
  if (ch.status !== 201) throw new Error(`challenge failed ${JSON.stringify(ch.body)}`);
  const sig = signDogecoinMessage(key.priv, ch.body.message);
  const conn = await user.api.post('/wallet/connections', { challenge_id: ch.body.challenge_id, signature: sig, provider: 'manual' });
  if (conn.status !== 201) throw new Error(`verify failed ${JSON.stringify(conn.body)}`);
  return { key, wallet: conn.body };
}

export const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
