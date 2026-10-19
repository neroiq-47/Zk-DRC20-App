import fs from 'node:fs';
import { createHash } from 'node:crypto';

export interface IndexedTip {
  height: number;
  hash: string | null;
}
export interface IndexedDoge {
  height: number | null;
  amount_koinu: string;
}
export interface IndexedDrc20 {
  ticker: string;
  deploy_txid: string;
  decimals: number;
  max_supply: string | null;
  amount_base_units: string;
}
export interface IndexedDrc20Balances {
  height: number | null;
  balances: IndexedDrc20[];
}

/**
 * One independent source of DOGE / DRC-20 balances. The reconciler queries several adapters and only
 * marks a balance 'confirmed' when all available adapters agree.
 */
export interface IndexerAdapter {
  readonly id: string;
  getTip(): Promise<IndexedTip>;
  getDogeBalance(address: string): Promise<IndexedDoge>;
  getDrc20Balances(address: string): Promise<IndexedDrc20Balances>;
}

export interface IndexerFixture {
  tip?: { height: number; hash?: string | null };
  tokens: Array<{ ticker: string; deploy_txid: string; decimals: number; max_supply: string | null }>;
  /** Explicit balances per address. */
  addresses?: Record<string, { doge_koinu: string; drc20?: Record<string, string> }>;
  /**
   * When true, addresses not listed get deterministic balances derived from sha256(address), so any
   * wallet connected in development shows assets. Dev/test only.
   */
  deterministic?: boolean;
}

/** Deterministic balances from a JSON fixture. Development and tests only (refused in production). */
export class FixtureIndexerAdapter implements IndexerAdapter {
  constructor(
    readonly id: string,
    private fixture: IndexerFixture,
    private heightFn: () => Promise<number | null> = async () => fixture.tip?.height ?? null,
  ) {}

  static fromFile(id: string, file: string, heightFn?: () => Promise<number | null>): FixtureIndexerAdapter {
    return new FixtureIndexerAdapter(id, JSON.parse(fs.readFileSync(file, 'utf8')) as IndexerFixture, heightFn);
  }

  private seed(address: string): number {
    return createHash('sha256').update(address).digest().readUInt32BE(0);
  }

  async getTip(): Promise<IndexedTip> {
    return { height: (await this.heightFn()) ?? 0, hash: this.fixture.tip?.hash ?? null };
  }

  async getDogeBalance(address: string): Promise<IndexedDoge> {
    const height = await this.heightFn();
    const listed = this.fixture.addresses?.[address];
    if (listed) return { height, amount_koinu: listed.doge_koinu };
    if (!this.fixture.deterministic) return { height, amount_koinu: '0' };
    const doge = BigInt((this.seed(address) % 5000) + 100);
    return { height, amount_koinu: (doge * 100_000_000n).toString() };
  }

  async getDrc20Balances(address: string): Promise<IndexedDrc20Balances> {
    const height = await this.heightFn();
    const listed = this.fixture.addresses?.[address];
    const balances: IndexedDrc20[] = [];
    for (const t of this.fixture.tokens) {
      let amount: string | undefined;
      if (listed) amount = listed.drc20?.[t.ticker];
      else if (this.fixture.deterministic) {
        const whole = BigInt((this.seed(`${address}:${t.ticker}`) % 100_000) + 1_000);
        amount = (whole * 10n ** BigInt(t.decimals)).toString();
      }
      if (amount && amount !== '0') balances.push({ ...t, amount_base_units: amount });
    }
    return { height, balances };
  }
}

/**
 * HTTP adapter for an indexer service that speaks the *Zoko indexer adapter protocol* below. This is our
 * own minimal contract: an operator runs a small shim in front of whichever DRC-20 indexer they trust
 * (one shim per independent indexer). No third-party endpoints are assumed.
 *
 *   GET {base}/v1/tip
 *     -> { "height": 5123456, "hash": "<block hash hex>" }
 *   GET {base}/v1/addresses/{address}/doge
 *     -> { "address": "D...", "height": 5123456, "amount_koinu": "123400000000" }
 *   GET {base}/v1/addresses/{address}/drc20
 *     -> { "address": "D...", "height": 5123456, "balances": [
 *          { "ticker": "dogi", "deploy_txid": "<64 hex>", "decimals": 18, "max_supply": "21000000..." | null,
 *            "amount_base_units": "1000000000000000000" } ] }
 *
 * Amounts are decimal strings of base units; heights are the indexer's processed block height.
 */
export class HttpIndexerAdapter implements IndexerAdapter {
  readonly id: string;
  constructor(
    private baseUrl: string,
    private timeoutMs = 5000,
  ) {
    this.id = `http:${new URL(baseUrl).host}`;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`indexer ${this.id} ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private static amount(v: unknown): string {
    if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new Error('indexer returned a malformed amount');
    return v;
  }

  async getTip(): Promise<IndexedTip> {
    const r = await this.get<{ height: number; hash?: string }>(`/v1/tip`);
    if (!Number.isInteger(r.height)) throw new Error('indexer returned a malformed tip');
    return { height: r.height, hash: r.hash ?? null };
  }

  async getDogeBalance(address: string): Promise<IndexedDoge> {
    const r = await this.get<{ height?: number; amount_koinu: string }>(`/v1/addresses/${encodeURIComponent(address)}/doge`);
    return { height: r.height ?? null, amount_koinu: HttpIndexerAdapter.amount(r.amount_koinu) };
  }

  async getDrc20Balances(address: string): Promise<IndexedDrc20Balances> {
    const r = await this.get<{ height?: number; balances: IndexedDrc20[] }>(`/v1/addresses/${encodeURIComponent(address)}/drc20`);
    if (!Array.isArray(r.balances)) throw new Error('indexer returned malformed balances');
    return {
      height: r.height ?? null,
      balances: r.balances.map((b) => {
        if (typeof b.ticker !== 'string' || !/^[0-9a-f]{64}$/i.test(b.deploy_txid) || !Number.isInteger(b.decimals)) {
          throw new Error('indexer returned a malformed token');
        }
        return { ...b, amount_base_units: HttpIndexerAdapter.amount(b.amount_base_units) };
      }),
    };
  }
}
