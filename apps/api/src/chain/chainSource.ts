/**
 * Read/write access to a Dogecoin node. The method set mirrors Dogecoin Core JSON-RPC so the
 * production implementation is a thin client (see DogecoinRpcChainSource).
 */
export interface BlockHeader {
  hash: string;
  height: number;
  previousblockhash: string | null;
  time: number; // unix seconds
}

export interface ChainTx {
  txid: string;
  /** Hash of the block containing the tx, or null while in the mempool. */
  blockhash: string | null;
}

export interface ChainSource {
  readonly kind: string;
  getBlockCount(): Promise<number>;
  getBlockHash(height: number): Promise<string>;
  getBlockHeader(hash: string): Promise<BlockHeader>;
  /** null when the node does not know the tx (never seen, evicted, or dropped by a reorg). */
  getRawTransaction(txid: string): Promise<ChainTx | null>;
  /** Policy pre-check before broadcast; `supported: false` when the node lacks testmempoolaccept. */
  testMempoolAccept(txHex: string): Promise<{ supported: boolean; allowed: boolean; reason?: string }>;
  sendRawTransaction(txHex: string): Promise<string>;
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
  }
}

/** Dogecoin Core JSON-RPC (HTTP basic auth). Requires `txindex=1` for getrawtransaction of confirmed txs. */
export class DogecoinRpcChainSource implements ChainSource {
  readonly kind = 'dogecoin-rpc';
  private id = 0;
  constructor(
    private url: string,
    private user: string | null,
    private password: string | null,
    private timeoutMs = 10_000,
  ) {}

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.user) headers.Authorization = `Basic ${Buffer.from(`${this.user}:${this.password ?? ''}`).toString('base64')}`;
    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '1.0', id: ++this.id, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let json: { result: T; error: { code: number; message: string } | null };
    try {
      json = JSON.parse(text);
    } catch {
      throw new RpcError(`RPC ${method}: HTTP ${res.status}`, null);
    }
    if (json.error) throw new RpcError(`RPC ${method}: ${json.error.message}`, json.error.code);
    return json.result;
  }

  getBlockCount() {
    return this.call<number>('getblockcount');
  }
  getBlockHash(height: number) {
    return this.call<string>('getblockhash', [height]);
  }
  async getBlockHeader(hash: string): Promise<BlockHeader> {
    const h = await this.call<{ hash: string; height: number; previousblockhash?: string; time: number }>('getblockheader', [hash, true]);
    return { hash: h.hash, height: h.height, previousblockhash: h.previousblockhash ?? null, time: h.time };
  }
  async getRawTransaction(txid: string): Promise<ChainTx | null> {
    try {
      const tx = await this.call<{ txid: string; blockhash?: string }>('getrawtransaction', [txid, true]);
      return { txid: tx.txid, blockhash: tx.blockhash ?? null };
    } catch (err) {
      // -5: No such mempool or blockchain transaction
      if (err instanceof RpcError && err.code === -5) return null;
      throw err;
    }
  }
  async testMempoolAccept(txHex: string) {
    try {
      const [r] = await this.call<Array<{ allowed: boolean; 'reject-reason'?: string }>>('testmempoolaccept', [[txHex]]);
      return { supported: true, allowed: r.allowed, reason: r['reject-reason'] };
    } catch (err) {
      // Dogecoin Core 1.14.x predates testmempoolaccept (-32601 Method not found): skip the pre-check.
      if (err instanceof RpcError && err.code === -32601) return { supported: false, allowed: true };
      throw err;
    }
  }
  sendRawTransaction(txHex: string) {
    return this.call<string>('sendrawtransaction', [txHex]);
  }
}
