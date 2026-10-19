import pg from 'pg';

export type Db = pg.Pool;
export type Queryable = pg.Pool | pg.PoolClient;

// Return int8 (bigint) as JS numbers when they are safe (counts, heights); amounts use numeric and stay strings.
pg.types.setTypeParser(20, (v: string) => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
});

export function createPool(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: Number(process.env.DB_POOL_MAX || 10) });
}

export type AfterCommit = (fn: () => void | Promise<void>) => void;

/**
 * Runs fn inside a transaction. Callbacks registered with `after` run only once the transaction has
 * committed (used for realtime pushes so clients never see rows that were rolled back).
 */
export async function tx<T>(db: Db, fn: (client: pg.PoolClient, after: AfterCommit) => Promise<T>): Promise<T> {
  const client = await db.connect();
  const afters: Array<() => void | Promise<void>> = [];
  try {
    await client.query('BEGIN');
    const result = await fn(client, (cb) => afters.push(cb));
    await client.query('COMMIT');
    client.release();
    for (const cb of afters) {
      try {
        await cb();
      } catch {
        // post-commit side effects are best effort
      }
    }
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    throw err;
  }
}

export async function one<T = any>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query(sql, params);
  return (r.rows[0] as T) ?? null;
}

export async function many<T = any>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}
