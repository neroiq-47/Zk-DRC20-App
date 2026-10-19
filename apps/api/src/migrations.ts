import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { REPO_ROOT } from './config.js';

export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'migrations');

export function listMigrations(dir = MIGRATIONS_DIR): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f) && !f.endsWith('_rollback.sql'))
    .sort();
}

async function ensureTable(client: pg.Client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
}

/** Applies pending migrations in filename order (each file manages its own transaction). */
export async function migrate(databaseUrl: string, log: (m: string) => void = () => undefined): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`SELECT pg_advisory_lock(727272)`);
    await ensureTable(client);
    const done = new Set((await client.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
    for (const file of listMigrations()) {
      if (done.has(file)) continue;
      log(`applying ${file}`);
      await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      applied.push(file);
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(727272)`).catch(() => undefined);
    await client.end();
  }
  return applied;
}

/** Rolls back the most recently applied migration using its NNNN_rollback.sql file. */
export async function rollbackLast(databaseUrl: string, log: (m: string) => void = () => undefined): Promise<string | null> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await ensureTable(client);
    const last = (await client.query(`SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`)).rows[0]?.name as string | undefined;
    if (!last) return null;
    const prefix = last.split('_')[0];
    const file = path.join(MIGRATIONS_DIR, `${prefix}_rollback.sql`);
    if (!fs.existsSync(file)) throw new Error(`No rollback file for ${last} (expected ${prefix}_rollback.sql)`);
    log(`rolling back ${last}`);
    await client.query(fs.readFileSync(file, 'utf8'));
    await client.query(`DELETE FROM schema_migrations WHERE name = $1`, [last]);
    return last;
  } finally {
    await client.end();
  }
}
