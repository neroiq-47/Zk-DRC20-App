import type { InfiniteData } from '@tanstack/react-query';
import type { Conversation, Message, Page } from '@zoko/contracts';

export const inboxKeys = {
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
};

/** A message as kept in the cache: server messages plus optimistic local ones. */
export interface ChatMessage extends Message {
  local_state?: 'sending' | 'failed';
}

export type MessagePages = InfiniteData<Page<ChatMessage>, string | null>;
export type ConversationPages = InfiniteData<Page<Conversation>, string | null>;

const sameMessage = (a: Message, b: Message) => a.id === b.id || (!!a.client_id && a.client_id === b.client_id);

/**
 * Inserts or replaces a message in newest-first pages. A server message replaces the optimistic
 * one with the same client_id. Pure: returns new data.
 */
export function upsertMessage(data: MessagePages | undefined, message: ChatMessage): MessagePages {
  if (!data || data.pages.length === 0) {
    return { pages: [{ items: [message], next_cursor: null }], pageParams: [null] };
  }
  let found = false;
  const pages = data.pages.map((p) => ({
    ...p,
    items: p.items.map((m) => {
      if (!found && sameMessage(m, message)) {
        found = true;
        return message;
      }
      return m;
    }),
  }));
  if (!found) pages[0] = { ...pages[0], items: [message, ...pages[0].items] };
  return { ...data, pages };
}

export function removeMessage(data: MessagePages | undefined, idOrClientId: string): MessagePages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((m) => m.id !== idOrClientId && m.client_id !== idOrClientId) })) };
}

/**
 * Moves a conversation to the top with a new last message. Returns null when the conversation
 * is not in the cache (the caller should refetch the list).
 */
export function bumpConversation(
  data: ConversationPages | undefined,
  message: Message,
  opts: { incrementUnread: boolean },
): ConversationPages | null {
  if (!data) return null;
  let target: Conversation | undefined;
  const pages = data.pages.map((p) => ({
    ...p,
    items: p.items.filter((c) => {
      if (c.id === message.conversation_id) {
        target = c;
        return false;
      }
      return true;
    }),
  }));
  if (!target) return null;
  const updated: Conversation = {
    ...target,
    last_message: message,
    updated_at: message.created_at,
    unread_count: opts.incrementUnread ? target.unread_count + 1 : target.unread_count,
  };
  pages[0] = { ...pages[0], items: [updated, ...pages[0].items] };
  return { ...data, pages };
}

export function patchConversation(data: ConversationPages | undefined, id: string, patch: Partial<Conversation>): ConversationPages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((c) => (c.id === id ? { ...c, ...patch } : c)) })) };
}

export function flattenPages<T>(data: InfiniteData<Page<T>, unknown> | undefined): T[] {
  return data ? data.pages.flatMap((p) => p.items) : [];
}

/** The conversation the user is looking at right now (no unread bump for it). */
let activeConversationId: string | null = null;
export const activeConversation = {
  get: () => activeConversationId,
  set: (id: string | null) => {
    activeConversationId = id;
  },
};
