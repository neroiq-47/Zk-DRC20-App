// Chain amounts are decimal strings of base units. All math here is string/BigInt based:
// never parse an on-chain amount into a JS number.

const UINT = /^\d+$/;
const DECIMAL_INPUT = /^(\d*)(?:\.(\d*))?$/;

export const DOGE_DECIMALS = 8; // 1 DOGE = 100,000,000 koinu

function assertDecimals(decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) throw new RangeError(`Invalid decimals: ${decimals}`);
}

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface FormatOptions {
  /** Insert thousands separators in the integer part. */
  group?: boolean;
  /** Cut (never round up) the fraction to this many digits for compact display. */
  maxFractionDigits?: number;
}

/**
 * Formats a base-unit integer string as a human amount, e.g. formatUnits('150000000', 8) === '1.5'.
 * Trailing fractional zeros are removed. Returns '—' for input that is not a base-unit integer.
 */
export function formatUnits(base: string, decimals: number, opts: FormatOptions = {}): string {
  assertDecimals(decimals);
  const raw = String(base ?? '').trim();
  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  if (!UINT.test(digits)) return '—';
  const normalized = BigInt(digits).toString();
  let int: string;
  let frac: string;
  if (decimals === 0) {
    int = normalized;
    frac = '';
  } else {
    const padded = normalized.padStart(decimals + 1, '0');
    int = padded.slice(0, padded.length - decimals);
    frac = padded.slice(padded.length - decimals);
  }
  if (opts.maxFractionDigits !== undefined && frac.length > opts.maxFractionDigits) frac = frac.slice(0, opts.maxFractionDigits);
  frac = frac.replace(/0+$/, '');
  const intOut = opts.group ? groupThousands(int) : int;
  const sign = negative && (int !== '0' || frac !== '') ? '-' : '';
  return `${sign}${intOut}${frac ? `.${frac}` : ''}`;
}

/**
 * Parses a user-entered decimal amount into base units, e.g. parseUnits('1.5', 8) === '150000000'.
 * Accepts digits with an optional single '.', ignores surrounding whitespace and thousands commas.
 * Returns null for empty or malformed input, or when it has more fraction digits than the token allows.
 */
export function parseUnits(input: string, decimals: number): string | null {
  assertDecimals(decimals);
  const cleaned = String(input ?? '').trim().replace(/,/g, '');
  const m = DECIMAL_INPUT.exec(cleaned);
  if (!m) return null;
  const int = m[1] ?? '';
  const frac = m[2] ?? '';
  if (int === '' && frac === '') return null;
  if (frac.length > decimals) {
    // Allow extra digits only when they are zeros ("1.500" for a 2-decimals token).
    if (/[^0]/.test(frac.slice(decimals))) return null;
  }
  const fracUsed = frac.slice(0, decimals).padEnd(decimals, '0');
  return BigInt(`${int || '0'}${fracUsed}`).toString();
}

/** Compares two base-unit strings. Returns -1, 0 or 1. */
export function compareUnits(a: string, b: string): -1 | 0 | 1 {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function formatDoge(koinu: string | null | undefined, opts: FormatOptions = { group: true }): string {
  if (koinu == null) return '—';
  return formatUnits(koinu, DOGE_DECIMALS, opts);
}
