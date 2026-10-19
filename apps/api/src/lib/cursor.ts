import { HttpProblem } from './errors.js';

/**
 * Opaque, stable keyset cursor over (timestamp, id). The timestamp is kept as a microsecond-precision
 * ISO string produced by Postgres (`cursorTs` below) so no precision is lost in JS Date conversion.
 */
export interface CursorKey {
  t: string;
  i: string;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined | null): CursorKey | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof v?.t === 'string' && typeof v?.i === 'string' && /^[0-9a-f-]{36}$/.test(v.i) && v.t.length < 40) {
      return { t: v.t, i: v.i };
    }
  } catch {
    // fallthrough
  }
  throw new HttpProblem(400, 'invalid_cursor', 'The cursor is invalid.');
}

/** SQL expression rendering a timestamptz column as a lossless UTC string usable as a cursor. */
export const cursorTs = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Builds a page from limit+1 fetched rows. Rows must carry `_ct` (cursorTs) and `_ci` (id). */
export function pageFrom<R extends { _ct: string; _ci: string }>(rows: R[], limit: number): { rows: R[]; next_cursor: string | null } {
  const has = rows.length > limit;
  const slice = has ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  return { rows: slice, next_cursor: has && last ? encodeCursor({ t: last._ct, i: last._ci }) : null };
}
