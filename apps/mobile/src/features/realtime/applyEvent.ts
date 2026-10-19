import type { QueryClient } from '@tanstack/react-query';
import type { Conversation, RealtimeEvent, Transfer } from '@zoko/contracts';
import { activeConversation, bumpConversation, inboxKeys, upsertMessage, type MessagePages } from '@/features/inbox/cache';
import { notificationKeys } from '@/features/notifications/keys';
import { walletKeys, upsertTransferInPages, type TransferPages } from '@/features/wallet/keys';

/** Applies one server push to the react-query caches. */
export function applyRealtimeEvent(qc: QueryClient, event: RealtimeEvent, meId: string | null) {
  switch (event.type) {
    case 'message': {
      const m = event.message;
      const mine = m.sender_id === meId;
      if (qc.getQueryData(inboxKeys.messages(m.conversation_id))) {
        qc.setQueryData<MessagePages>(inboxKeys.messages(m.conversation_id), (d) => upsertMessage(d, m));
      }
      const viewing = activeConversation.get() === m.conversation_id;
      const bumped = bumpConversation(qc.getQueryData(inboxKeys.conversations), m, { incrementUnread: !mine && !viewing });
      if (bumped) qc.setQueryData(inboxKeys.conversations, bumped);
      else qc.invalidateQueries({ queryKey: inboxKeys.conversations });
      qc.setQueryData<Conversation>(inboxKeys.conversation(m.conversation_id), (c) => (c ? { ...c, last_message: m, updated_at: m.created_at } : c));
      return;
    }
    case 'notification': {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
      return;
    }
    case 'transfer': {
      const t: Transfer = event.transfer;
      qc.setQueryData(walletKeys.transfer(t.id), t);
      qc.setQueryData<TransferPages>(walletKeys.transfers, (d) => upsertTransferInPages(d, t));
      if (t.status === 'confirmed' || t.status === 'reorged') qc.invalidateQueries({ queryKey: walletKeys.assets });
      return;
    }
  }
}

export function parseRealtimeEvent(raw: unknown): RealtimeEvent | null {
  if (typeof raw !== 'string') return null;
  try {
    const e = JSON.parse(raw) as RealtimeEvent;
    if (e && (e.type === 'message' || e.type === 'notification' || e.type === 'transfer')) return e;
  } catch {
    // ignore malformed frames (and pings)
  }
  return null;
}
