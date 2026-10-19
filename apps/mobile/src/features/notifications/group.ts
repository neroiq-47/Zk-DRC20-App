import type { Notification, NotificationKind, UserSummary } from '@zoko/contracts';

export interface NotificationGroup {
  key: string;
  kind: NotificationKind;
  actors: UserSummary[]; // unique, most recent first
  latest: Notification;
  items: Notification[];
  unread: boolean;
}

// Kinds that collapse when they repeat about the same thing.
const GROUPABLE: NotificationKind[] = ['like', 'repost', 'follow'];

function groupTarget(n: Notification): string {
  if (n.kind === 'follow') return 'follow';
  return n.post?.id ?? n.entity_id ?? n.id;
}

/**
 * Groups notifications (newest first) by kind and target: likes and reposts of the same post and
 * follows collapse into one row when they arrive back to back within a day.
 */
export function groupNotifications(items: Notification[], windowMs = 24 * 3600 * 1000): NotificationGroup[] {
  const out: NotificationGroup[] = [];
  for (const n of items) {
    const prev = out[out.length - 1];
    const canMerge =
      prev &&
      GROUPABLE.includes(n.kind) &&
      prev.kind === n.kind &&
      groupTarget(prev.latest) === groupTarget(n) &&
      Date.parse(prev.latest.created_at) - Date.parse(n.created_at) <= windowMs;
    if (canMerge) {
      prev.items.push(n);
      if (n.actor && !prev.actors.some((a) => a.id === n.actor!.id)) prev.actors.push(n.actor);
      prev.unread = prev.unread || !n.read;
      continue;
    }
    out.push({ key: n.id, kind: n.kind, actors: n.actor ? [n.actor] : [], latest: n, items: [n], unread: !n.read });
  }
  return out;
}

const VERB: Record<NotificationKind, string> = {
  like: 'liked your post',
  reply: 'replied to your post',
  repost: 'reposted your post',
  follow: 'followed you',
  mention: 'mentioned you',
  message: 'sent you a message',
  transfer: 'Transfer update',
};

export function notificationText(g: Pick<NotificationGroup, 'kind' | 'actors'>): string {
  if (g.kind === 'transfer') {
    return g.actors[0] ? `@${g.actors[0].handle} sent you a transfer` : 'There is an update on your transfer';
  }
  const [first, ...rest] = g.actors;
  const who = first ? `@${first.handle}` : 'Someone';
  const others = rest.length === 0 ? '' : rest.length === 1 ? ` and @${rest[0].handle}` : ` and ${rest.length} others`;
  return `${who}${others} ${VERB[g.kind]}`;
}

/** Where tapping a notification goes. */
export function notificationHref(n: Notification): string | null {
  switch (n.kind) {
    case 'like':
    case 'repost':
    case 'reply':
    case 'mention': {
      const id = n.post?.id ?? n.entity_id;
      return id ? `/post/${id}` : n.actor ? `/user/${n.actor.handle}` : null;
    }
    case 'follow':
      return n.actor ? `/user/${n.actor.handle}` : null;
    case 'message':
      return n.entity_id ? `/chat/${n.entity_id}` : '/inbox';
    case 'transfer':
      return n.entity_id ? `/wallet/transfer/${n.entity_id}` : '/wallet';
  }
}
