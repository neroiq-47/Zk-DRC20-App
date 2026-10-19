import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { BlockHeader, ChainSource, ChainTx } from './chainSource.js';
import { txidFromHex } from './dogecoin.js';

interface SimBlock {
  hash: string;
  height: number;
  prev: string | null;
  time: number;
  txids: string[];
}

interface SimState {
  blocks: SimBlock[]; // index = height - baseHeight
  baseHeight: number;
  mempool: string[];
  salt: number;
}

/**
 * Deterministic in-process Dogecoin chain for development and tests (CHAIN_SOURCE=simulated).
 * Supports mining, mempool, and reorgs (replacing the last N blocks, optionally dropping txs) so the
 * sync job, confirmation counting and reorg rollback can be exercised end to end.
 * State can be persisted to a JSON file so `tsx watch` restarts keep the same chain.
 */
export class SimulatedChain implements ChainSource {
  readonly kind = 'simulated';
  private state: SimState;

  constructor(
    private statePath: string | null = null,
    baseHeight = 5_000_000,
  ) {
    this.state = this.load() ?? { blocks: [], baseHeight, mempool: [], salt: 0 };
    // Start with some history so the sync job can begin a few blocks below the tip.
    if (!this.state.blocks.length) this.mine(20);
  }

  private load(): SimState | null {
    if (!this.statePath) return null;
    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as SimState;
    } catch {
      return null;
    }
  }

  private save(): void {
    if (!this.statePath) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(this.state));
  }

  get tipHeight(): number {
    return this.state.baseHeight + this.state.blocks.length - 1;
  }

  private makeBlock(height: number, prev: string | null, txids: string[]): SimBlock {
    this.state.salt += 1;
    const hash = createHash('sha256').update(`sim:${height}:${prev}:${txids.join(',')}:${this.state.salt}`).digest('hex');
    return { hash, height, prev, time: Math.floor(Date.now() / 1000), txids };
  }

  /** Mines n blocks; the first one includes the whole mempool. */
  mine(n = 1): string[] {
    const hashes: string[] = [];
    for (let i = 0; i < n; i++) {
      const tip = this.state.blocks[this.state.blocks.length - 1];
      const txids = i === 0 ? this.state.mempool.splice(0) : [];
      const b = this.makeBlock(tip ? tip.height + 1 : this.state.baseHeight, tip?.hash ?? null, txids);
      this.state.blocks.push(b);
      hashes.push(b.hash);
    }
    this.save();
    return hashes;
  }

  /**
   * Replaces the last `depth` blocks with `depth + 1` new blocks (a longer competing chain).
   * Transactions from the orphaned blocks are dropped (simulating a double spend) unless
   * `returnToMempool` is set, in which case they are re-mined in the first replacement block.
   */
  reorg(depth: number, opts: { returnToMempool?: boolean } = {}): void {
    if (depth < 1 || depth >= this.state.blocks.length) throw new Error('invalid reorg depth');
    const orphaned = this.state.blocks.splice(this.state.blocks.length - depth, depth);
    if (opts.returnToMempool) this.state.mempool.unshift(...orphaned.flatMap((b) => b.txids));
    this.state.salt += 1000;
    this.mine(depth + 1);
  }

  async getBlockCount(): Promise<number> {
    return this.tipHeight;
  }
  async getBlockHash(height: number): Promise<string> {
    const b = this.state.blocks[height - this.state.baseHeight];
    if (!b) throw new Error('Block height out of range');
    return b.hash;
  }
  async getBlockHeader(hash: string): Promise<BlockHeader> {
    const b = this.state.blocks.find((x) => x.hash === hash);
    if (!b) throw new Error('Block not found');
    return { hash: b.hash, height: b.height, previousblockhash: b.prev, time: b.time };
  }
  async getRawTransaction(txid: string): Promise<ChainTx | null> {
    if (this.state.mempool.includes(txid)) return { txid, blockhash: null };
    const b = this.state.blocks.find((x) => x.txids.includes(txid));
    return b ? { txid, blockhash: b.hash } : null;
  }
  async testMempoolAccept(txHex: string) {
    if (!/^[0-9a-f]+$/i.test(txHex) || txHex.length % 2) return { supported: true, allowed: false, reason: 'TX decode failed' };
    const txid = txidFromHex(txHex);
    if (this.state.mempool.includes(txid) || this.state.blocks.some((b) => b.txids.includes(txid))) {
      return { supported: true, allowed: false, reason: 'txn-already-known' };
    }
    return { supported: true, allowed: true };
  }
  async sendRawTransaction(txHex: string): Promise<string> {
    const check = await this.testMempoolAccept(txHex);
    if (!check.allowed) throw new Error(check.reason);
    const txid = txidFromHex(txHex);
    this.state.mempool.push(txid);
    this.save();
    return txid;
  }
}
