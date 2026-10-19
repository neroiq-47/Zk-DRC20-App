import type { AppDeps } from './context.js';
import { many, one, tx } from './db.js';
import { syncChain } from './chain/sync.js';
import { monitorTransfers } from './transfers/service.js';
import type { PushMessage } from './services/push.js';

const LOCK_KEY = 0x5a6f6b6f; // 'Zoko' — only one API instance runs the jobs at a time

const PUSH_COPY: Record<string, string> = {
  like: 'liked your post',
  reply: 'replied to your post',
  follow: 'started following you',
  repost: 'reposted your post',
  mention: 'mentioned you',
  message: 'sent you a message',
};

/** Delivers queued notification pushes (best effort; failures are retried a few times). */
export async function processOutbox(deps: AppDeps, batch = 100): Promise<number> {
  return tx(deps.db, async (c) => {
    const events = await many(
      c,
      `SELECT id, aggregate_id, payload FROM outbox_events
        WHERE processed_at IS NULL AND event_kind = 'notification.created' AND attempts < 5
        ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [batch],
    );
    for (const e of events) {
      try {
        if (deps.push.enabled) {
          const n = await one(
            c,
            `SELECT n.kind, n.entity_id, n.post_id, a.display_name, d_tokens.tokens
               FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
               CROSS JOIN LATERAL (SELECT array_agg(expo_push_token) AS tokens FROM devices WHERE user_id = n.recipient_id) d_tokens
              WHERE n.id = $1`,
            [e.aggregate_id],
          );
          if (n?.tokens?.length) {
            const body =
              n.kind === 'transfer'
                ? 'Your transfer status changed.'
                : `${n.display_name ?? 'Someone'} ${PUSH_COPY[n.kind] ?? 'sent you a notification'}`;
            const messages: PushMessage[] = n.tokens.map((to: string) => ({
              to,
              title: 'Zoko',
              body,
              data: { kind: n.kind, entity_id: n.entity_id, post_id: n.post_id },
            }));
            const results = await deps.push.send(messages);
            for (const [i, r] of results.entries()) {
              if (!r.ok && r.error === 'DeviceNotRegistered') await c.query(`DELETE FROM devices WHERE expo_push_token = $1`, [messages[i].to]);
            }
          }
        }
        await c.query(`UPDATE outbox_events SET processed_at = now(), attempts = attempts + 1 WHERE id = $1`, [e.id]);
      } catch (err) {
        await c.query(`UPDATE outbox_events SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [e.id, String((err as Error).message).slice(0, 500)]);
      }
    }
    return events.length;
  });
}

export async function runJobsOnce(deps: AppDeps, log?: (msg: string, err?: unknown) => void): Promise<void> {
  const client = await deps.db.connect();
  try {
    const got = await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_KEY]);
    if (!got.rows[0].ok) return;
    try {
      for (const [name, job] of [
        ['chain sync', () => syncChain(deps)],
        ['transfer monitor', () => monitorTransfers(deps)],
        ['outbox', () => processOutbox(deps)],
      ] as const) {
        try {
          await job();
        } catch (err) {
          log?.(`${name} failed`, err);
        }
      }
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/** Background loop in the API process (WORKER_ENABLED). Also auto-mines the dev simulated chain. */
export function startWorker(deps: AppDeps, log: (msg: string, err?: unknown) => void): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runJobsOnce(deps, log);
    } finally {
      running = false;
    }
  };
  const timers = [setInterval(tick, deps.config.workerIntervalMs)];
  if (deps.simChain && deps.config.simBlockIntervalMs > 0) {
    timers.push(setInterval(() => deps.simChain!.mine(1), deps.config.simBlockIntervalMs));
  }
  void tick();
  return () => timers.forEach(clearInterval);
}
