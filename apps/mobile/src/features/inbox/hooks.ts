import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Conversation, Message, Page, SearchResults } from '@zoko/contracts';
import { api, newIdempotencyKey } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useRealtimeStatus } from '@/features/realtime/status';
import {
  bumpConversation,
  inboxKeys,
  patchConversation,
  upsertMessage,
  type ChatMessage,
  type ConversationPages,
  type MessagePages,
} from './cache';

const PAGE = 30;

export function useConversations() {
  return useInfiniteQuery({
    queryKey: inboxKeys.conversations,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => api<Page<Conversation>>('/conversations', { query: { cursor: pageParam, limit: PAGE }, signal }),
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useConversation(id: string) {
  const qc = useQueryClient();
  return useQuery<Conversation>({
    queryKey: inboxKeys.conversation(id),
    queryFn: ({ signal }) => api<Conversation>(`/conversations/${id}`, { signal }),
    enabled: !!id,
    placeholderData: (): Conversation | undefined => {
      const list = qc.getQueryData<ConversationPages>(inboxKeys.conversations);
      return list?.pages.flatMap((p) => p.items).find((c) => c.id === id);
    },
  });
}

/** Messages newest first. Polls every 5s while `focused` and the realtime socket is not open. */
export function useMessages(id: string, focused: boolean) {
  const socket = useRealtimeStatus((s) => s.status);
  return useInfiniteQuery({
    queryKey: inboxKeys.messages(id),
    initialPageParam: null as string | null,
    enabled: !!id,
    queryFn: ({ pageParam, signal }) => api<Page<ChatMessage>>(`/conversations/${id}/messages`, { query: { cursor: pageParam, limit: PAGE }, signal }),
    getNextPageParam: (last) => last.next_cursor,
    refetchInterval: focused && socket !== 'open' ? 5000 : false,
    // Keep optimistic (unsent/failed) messages when a refetch replaces the first page.
    structuralSharing: (oldData, newData) => mergeLocal(oldData as MessagePages | undefined, newData as MessagePages),
  });
}

function mergeLocal(oldData: MessagePages | undefined, newData: MessagePages): MessagePages {
  const local = oldData?.pages[0]?.items.filter((m) => m.local_state) ?? [];
  if (!local.length || !newData.pages.length) return newData;
  let merged = newData;
  for (const m of [...local].reverse()) {
    const delivered = newData.pages.some((p) => p.items.some((x) => x.client_id && x.client_id === m.client_id));
    if (!delivered) merged = upsertMessage(merged, m);
  }
  return merged;
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  const meId = useSession((s) => s.user?.id ?? '');

  const send = async (body: string, retryClientId?: string) => {
    const client_id = retryClientId ?? newIdempotencyKey();
    const optimistic: ChatMessage = {
      id: `local-${client_id}`,
      conversation_id: conversationId,
      sender_id: meId,
      body,
      created_at: new Date().toISOString(),
      client_id,
      local_state: 'sending',
    };
    await qc.cancelQueries({ queryKey: inboxKeys.messages(conversationId) });
    qc.setQueryData<MessagePages>(inboxKeys.messages(conversationId), (d) => upsertMessage(d, optimistic));
    try {
      const saved = await api<Message>(`/conversations/${conversationId}/messages`, { method: 'POST', body: { body, client_id } });
      const withClient: ChatMessage = { ...saved, client_id: saved.client_id ?? client_id };
      qc.setQueryData<MessagePages>(inboxKeys.messages(conversationId), (d) => upsertMessage(d, withClient));
      const bumped = bumpConversation(qc.getQueryData(inboxKeys.conversations), withClient, { incrementUnread: false });
      if (bumped) qc.setQueryData(inboxKeys.conversations, bumped);
      else qc.invalidateQueries({ queryKey: inboxKeys.conversations });
      // Replying accepts a request.
      qc.setQueryData<Conversation>(inboxKeys.conversation(conversationId), (c) => (c ? { ...c, is_request: false, last_message: withClient } : c));
      qc.setQueryData<ConversationPages>(inboxKeys.conversations, (d) => patchConversation(d, conversationId, { is_request: false }));
    } catch {
      qc.setQueryData<MessagePages>(inboxKeys.messages(conversationId), (d) => upsertMessage(d, { ...optimistic, local_state: 'failed' }));
    }
  };

  return { send };
}

export function useMarkRead(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/conversations/${conversationId}/read`, { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData<ConversationPages>(inboxKeys.conversations, (d) => patchConversation(d, conversationId, { unread_count: 0 }));
      qc.setQueryData<Conversation>(inboxKeys.conversation(conversationId), (c) => (c ? { ...c, unread_count: 0 } : c));
    },
  });
}

export function useAcceptRequest(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/conversations/${conversationId}/accept`, { method: 'POST' }),
    onSuccess: () => {
      qc.setQueryData<Conversation>(inboxKeys.conversation(conversationId), (c) => (c ? { ...c, is_request: false } : c));
      qc.setQueryData<ConversationPages>(inboxKeys.conversations, (d) => patchConversation(d, conversationId, { is_request: false }));
    },
  });
}

export function useStartConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (handle: string) => api<Conversation>('/conversations', { method: 'POST', body: { handle } }),
    onSuccess: (c) => {
      qc.setQueryData(inboxKeys.conversation(c.id), c);
      qc.invalidateQueries({ queryKey: inboxKeys.conversations });
    },
  });
}

export function useUserSearch(q: string) {
  const term = q.trim().replace(/^@/, '');
  return useQuery({
    queryKey: ['search', 'users', term],
    enabled: term.length >= 1,
    staleTime: 60_000,
    queryFn: ({ signal }) => api<SearchResults>('/search', { query: { q: term, type: 'users' }, signal }),
  });
}

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (handle: string) => api<void>(`/users/${encodeURIComponent(handle)}/block`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxKeys.conversations }),
  });
}
