import type { RealtimeEvent } from '@zoko/contracts';

export interface RealtimeSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

/**
 * In-process fan-out of RealtimeEvent frames to the sockets of specific users. Every publish names its
 * recipients explicitly (e.g. the members of a conversation), so a socket only ever receives events
 * addressed to its authenticated user.
 *
 * Production gap: with more than one API instance this needs a shared bus (Postgres LISTEN/NOTIFY or Redis).
 */
export class RealtimeHub {
  private sockets = new Map<string, Set<RealtimeSocket>>();

  add(userId: string, socket: RealtimeSocket): () => void {
    const set = this.sockets.get(userId) ?? new Set();
    set.add(socket);
    this.sockets.set(userId, set);
    return () => {
      set.delete(socket);
      if (!set.size) this.sockets.delete(userId);
    };
  }

  publish(userIds: Iterable<string>, event: RealtimeEvent): void {
    const frame = JSON.stringify(event);
    for (const id of new Set(userIds)) {
      for (const s of this.sockets.get(id) ?? []) {
        if (s.readyState === 1) {
          try {
            s.send(frame);
          } catch {
            // dropped connection; cleaned up on close
          }
        }
      }
    }
  }

  connectionCount(userId?: string): number {
    if (userId) return this.sockets.get(userId)?.size ?? 0;
    let n = 0;
    for (const s of this.sockets.values()) n += s.size;
    return n;
  }

  closeAll(): void {
    for (const set of this.sockets.values()) for (const s of set) s.close(1001, 'server shutting down');
    this.sockets.clear();
  }
}
