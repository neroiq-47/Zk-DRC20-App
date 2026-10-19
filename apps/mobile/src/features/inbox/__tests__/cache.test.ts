import { describe, expect, it } from '@jest/globals';
import type { Conversation, Message } from '@zoko/contracts';
import { bumpConversation, removeMessage, upsertMessage, type ConversationPages, type MessagePages } from '../cache';

const msg = (id: string, extra: Partial<Message> = {}): Message => ({
  id,
  conversation_id: 'c1',
  sender_id: 'u2',
  body: id,
  created_at: '2026-10-19T10:00:00Z',
  client_id: null,
  ...extra,
});

const conv = (id: string): Conversation => ({
  id,
  other: { id: 'u2', handle: 'ana', display_name: 'Ana', avatar_url: null, has_verified_wallet: false },
  last_message: null,
  unread_count: 0,
  is_request: false,
  updated_at: '2026-10-18T10:00:00Z',
});

describe('upsertMessage', () => {
  it('prepends new messages (newest first)', () => {
    const data: MessagePages = { pages: [{ items: [msg('a')], next_cursor: null }], pageParams: [null] };
    expect(upsertMessage(data, msg('b')).pages[0].items.map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('replaces the optimistic message by client_id and dedupes by id', () => {
    const data: MessagePages = {
      pages: [{ items: [{ ...msg('local-x', { client_id: 'x' }), local_state: 'sending' }, msg('a')], next_cursor: null }],
      pageParams: [null],
    };
    const once = upsertMessage(data, msg('srv', { client_id: 'x' }));
    expect(once.pages[0].items.map((m) => m.id)).toEqual(['srv', 'a']);
    const twice = upsertMessage(once, msg('srv', { client_id: 'x' }));
    expect(twice.pages[0].items).toHaveLength(2);
  });

  it('creates a page when the cache is empty', () => {
    expect(upsertMessage(undefined, msg('a')).pages[0].items).toHaveLength(1);
  });

  it('removes by client id', () => {
    const data: MessagePages = { pages: [{ items: [msg('l', { client_id: 'x' })], next_cursor: null }], pageParams: [null] };
    expect(removeMessage(data, 'x')!.pages[0].items).toHaveLength(0);
  });
});

describe('bumpConversation', () => {
  it('moves the conversation to the top and bumps unread', () => {
    const data: ConversationPages = { pages: [{ items: [conv('c0'), conv('c1')], next_cursor: 'n' }], pageParams: [null] };
    const out = bumpConversation(data, msg('m'), { incrementUnread: true })!;
    expect(out.pages[0].items.map((c) => c.id)).toEqual(['c1', 'c0']);
    expect(out.pages[0].items[0].unread_count).toBe(1);
    expect(out.pages[0].items[0].last_message?.id).toBe('m');
  });

  it('returns null when unknown', () => {
    const data: ConversationPages = { pages: [{ items: [conv('c0')], next_cursor: null }], pageParams: [null] };
    expect(bumpConversation(data, msg('m'), { incrementUnread: true })).toBeNull();
  });
});
