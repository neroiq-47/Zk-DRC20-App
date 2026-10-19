import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../src/migrations.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection URL of a migrated template database, or null when no Postgres is configured. */
    testDbTemplateUrl: string | null;
  }
}

let adminUrl: string | null = null;
let templateName: string | null = null;

export function dbUrlWithName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export async function setup(project: TestProject) {
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!base) {
    console.warn(
      '\n[zoko api tests] Skipping database tests: set TEST_DATABASE_URL (or DATABASE_URL) to a PostgreSQL 16 server, e.g.\n' +
        '  TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @zoko/api test\n',
    );
    project.provide('testDbTemplateUrl', null);
    return;
  }
  adminUrl = base;
  templateName = `zoko_test_tpl_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${templateName} ENCODING 'UTF8' TEMPLATE template0`);
  await admin.end();
  const url = dbUrlWithName(base, templateName);
  await migrate(url);
  project.provide('testDbTemplateUrl', url);
}

export async function teardown() {
  if (!adminUrl || !templateName) return;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const dbs = await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY datname = $2`, [`${templateName}%`, templateName]);
  for (const { datname } of dbs.rows) {
    await admin.query(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`).catch(() => undefined);
  }
  await admin.end();
}
