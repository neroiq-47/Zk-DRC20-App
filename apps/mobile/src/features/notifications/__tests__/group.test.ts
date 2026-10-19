import { describe, expect, it } from '@jest/globals';
import type { Notification, UserSummary } from '@zoko/contracts';
import { groupNotifications, notificationHref, notificationText } from '../group';

const user = (handle: string): UserSummary => ({ id: handle, handle, display_name: handle, avatar_url: null, has_verified_wallet: false });
let seq = 0;
function n(partial: Partial<Notification>): Notification {
  seq += 1;
  return { id: `n${seq}`, kind: 'like', actor: user('ana'), post: { id: 'p1', body: 'hi' }, entity_id: null, read: true, created_at: '2026-10-19T10:00:00Z', ...partial };
}

describe('groupNotifications', () => {
  it('collapses consecutive likes on the same post', () => {
    const groups = groupNotifications([
      n({ actor: user('ana'), read: false }),
      n({ actor: user('ben'), created_at: '2026-10-19T09:00:00Z' }),
      n({ actor: user('cy'), created_at: '2026-10-19T08:00:00Z' }),
      n({ actor: user('ana'), created_at: '2026-10-19T07:00:00Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].actors.map((a) => a.handle)).toEqual(['ana', 'ben', 'cy']);
    expect(groups[0].unread).toBe(true);
    expect(notificationText(groups[0])).toBe('@ana and 2 others liked your post');
  });

  it('keeps different posts and kinds apart', () => {
    const groups = groupNotifications([
      n({}),
      n({ post: { id: 'p2', body: '' } }),
      n({ kind: 'reply', post: { id: 'p2', body: '' } }),
      n({ kind: 'reply', post: { id: 'p2', body: '' } }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['like', 'like', 'reply', 'reply']);
  });

  it('groups follows', () => {
    const groups = groupNotifications([n({ kind: 'follow', post: null, actor: user('ana') }), n({ kind: 'follow', post: null, actor: user('ben') })]);
    expect(groups).toHaveLength(1);
    expect(notificationText(groups[0])).toBe('@ana and @ben followed you');
  });

  it('does not merge across a long gap', () => {
    const groups = groupNotifications([n({}), n({ created_at: '2026-10-10T10:00:00Z' })]);
    expect(groups).toHaveLength(2);
  });
});

describe('notificationHref', () => {
  it('routes by kind', () => {
    expect(notificationHref(n({}))).toBe('/post/p1');
    expect(notificationHref(n({ kind: 'follow', post: null }))).toBe('/user/ana');
    expect(notificationHref(n({ kind: 'message', post: null, entity_id: 'c1' }))).toBe('/chat/c1');
    expect(notificationHref(n({ kind: 'transfer', post: null, entity_id: 't1' }))).toBe('/wallet/transfer/t1');
  });
});
