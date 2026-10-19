import type { Config } from './config.js';
import type { Db } from './db.js';
import type { TokenService } from './auth/tokens.js';
import type { MediaStorage } from './storage/storage.js';
import type { RealtimeHub } from './realtime/hub.js';
import type { ChainSource } from './chain/chainSource.js';
import type { IndexerAdapter } from './indexer/adapter.js';
import type { TransferBuilder } from './transfers/builder.js';
import type { PushSender } from './services/push.js';
import type { SimulatedChain } from './chain/simulated.js';

/** Everything route handlers and jobs need. Built once in buildDeps() and injected (tests swap parts). */
export interface AppDeps {
  config: Config;
  db: Db;
  tokens: TokenService;
  storage: MediaStorage;
  hub: RealtimeHub;
  /** null when CHAIN_SOURCE=none: chain sync and broadcast are unavailable. */
  chain: ChainSource | null;
  /** Set only when the chain source is the dev/test simulation (enables dev endpoints). */
  simChain: SimulatedChain | null;
  indexers: IndexerAdapter[];
  /** null when no real transfer builder is configured: prepare returns 501. */
  builder: TransferBuilder | null;
  push: PushSender;
}

export interface AuthUser {
  id: string;
  handle: string;
  role: 'user' | 'moderator' | 'admin';
}

export function mediaUrl(cfg: Config, mediaId: string | null | undefined): string | null {
  return mediaId ? `${cfg.publicBaseUrl}/api/v1/media/${mediaId}/file` : null;
}
