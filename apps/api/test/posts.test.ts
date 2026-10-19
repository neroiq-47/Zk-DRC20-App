import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDb, registerUser, setRole, type TestCtx, type TestUser } from './helpers.js';

let n = 0;
const key = () => ({ 'idempotency-key': `k-${Date.now()}-${++n}` });

describe.skipIf(!hasDb)('posts, visibility and blocks (EP03)', () => {
  let ctx: TestCtx;
  let alice: TestUser, bob: TestUser, carol: TestUser;
  beforeAll(async () => {
    ctx = await createTestApp();
    [alice, bob, carol] = await Promise.all([registerUser(ctx.app), registerUser(ctx.app), registerUser(ctx.app)]);
  });
  afterAll(async () => ctx?.close());

  it('validates post body, media count and requires an Idempotency-Key', async () => {
    expect((await alice.api.post('/posts', { body: 'no key' })).body.code).toBe('idempotency_key_required');
    const tooLong = await alice.api.post('/posts', { body: 'x'.repeat(501) }, key());
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.code).toBe('post_too_long');
    expect((await alice.api.post('/posts', { body: '🐕'.repeat(500) }, key())).status).toBe(201); // counts characters, not bytes
    const empty = await alice.api.post('/posts', { body: '   ' }, key());
    expect(empty.status).toBe(422);
    expect(empty.body.code).toBe('post_empty');
    const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
    const tooMany = await alice.api.post('/posts', { body: 'hi', media_ids: ids }, key());
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.errors.media_ids).toBeDefined();
    const notMine = await alice.api.post('/posts', { body: 'hi', media_ids: [crypto.randomUUID()] }, key());
    expect(notMine.body.code).toBe('invalid_media');
  });

  it('is idempotent per user + key', async () => {
    const k = key();
    const a = await alice.api.post('/posts', { body: 'only once #idem' }, k);
    const b = await alice.api.post('/posts', { body: 'only once #idem' }, k);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers['idempotent-replayed']).toBe('true');
    const count = await ctx.deps.db.query(`SELECT count(*)::int AS n FROM posts WHERE author_id = $1 AND body = 'only once #idem'`, [alice.id]);
    expect(count.rows[0].n).toBe(1);
    const reused = await alice.api.post('/posts', { body: 'different body' }, k);
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('idempotency_key_reused');
    // Same key from another user is independent.
    const other = await bob.api.post('/posts', { body: 'only once #idem' }, k);
    expect(other.status).toBe(201);
    expect(other.body.id).not.toBe(a.body.id);
  });

  it('concurrent retries with the same key create one post', async () => {
    const k = key();
    const results = await Promise.all(Array.from({ length: 5 }, () => alice.api.post('/posts', { body: 'race' }, k)));
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
  });

  it('enforces followers-only visibility', async () => {
    const p = await alice.api.post('/posts', { body: 'followers only', visibility: 'followers' }, key());
    expect(p.status).toBe(201);
    expect((await bob.api.get(`/posts/${p.body.id}`)).status).toBe(404);
    expect((await bob.api.post(`/posts/${p.body.id}/like`)).status).toBe(404);
    expect((await bob.api.post('/posts', { body: 'reply', parent_id: p.body.id }, key())).status).toBe(404);
    expect((await bob.api.get(`/users/${alice.handle}/posts`)).body.items.map((x: any) => x.id)).not.toContain(p.body.id);
    await bob.api.post(`/users/${alice.handle}/follow`);
    expect((await bob.api.get(`/posts/${p.body.id}`)).status).toBe(200);
    expect((await bob.api.get('/feed')).body.items.map((x: any) => x.id)).toContain(p.body.id);
    // Not public: never in discover, can't be reposted.
    expect((await carol.api.get('/feed/discover')).body.items.map((x: any) => x.id)).not.toContain(p.body.id);
    expect((await bob.api.post(`/posts/${p.body.id}/repost`)).body.code).toBe('cannot_quote_private');
    await bob.api.del(`/users/${alice.handle}/follow`);
  });

  it('replies, likes, bookmarks, reposts and counts hydrate correctly', async () => {
    const p = await alice.api.post('/posts', { body: 'hello @' + carol.handle + ' #zoko' }, key());
    const reply = await bob.api.post('/posts', { body: 'nice', parent_id: p.body.id }, key());
    expect(reply.body.reply_to_handle).toBe(alice.handle);
    expect((await bob.api.post(`/posts/${p.body.id}/like`)).status).toBe(204);
    expect((await bob.api.post(`/posts/${p.body.id}/like`)).status).toBe(204); // idempotent
    expect((await bob.api.post(`/posts/${p.body.id}/bookmark`)).status).toBe(204);
    const rp = await bob.api.post(`/posts/${p.body.id}/repost`);
    expect(rp.status).toBe(201);
    expect(rp.body.body).toBe('');
    expect(rp.body.quote.id).toBe(p.body.id);
    const rp2 = await bob.api.post(`/posts/${p.body.id}/repost`);
    expect(rp2.body.id).toBe(rp.body.id);
    const seen = await bob.api.get(`/posts/${p.body.id}`);
    expect(seen.body).toMatchObject({ like_count: 1, reply_count: 1, repost_count: 1, liked_by_me: true, bookmarked_by_me: true, reposted_by_me: true });
    const replies = await carol.api.get(`/posts/${p.body.id}/replies`);
    expect(replies.body.items.map((x: any) => x.id)).toEqual([reply.body.id]);
    const bookmarks = await bob.api.get('/users/me/bookmarks');
    expect(bookmarks.body.items[0].id).toBe(p.body.id);
    expect((await bob.api.del(`/posts/${p.body.id}/repost`)).status).toBe(204);
    expect((await bob.api.get(`/posts/${p.body.id}`)).body.reposted_by_me).toBe(false);

    const notes = await alice.api.get('/notifications');
    const kinds = notes.body.items.map((x: any) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['like', 'reply', 'repost']));
    expect(notes.body.unread_count).toBeGreaterThanOrEqual(3);
    const mention = (await carol.api.get('/notifications')).body.items.find((x: any) => x.kind === 'mention');
    expect(mention.post.id).toBe(p.body.id);
    expect(mention.actor.handle).toBe(alice.handle);
    expect((await alice.api.post('/notifications/read')).status).toBe(204);
    expect((await alice.api.get('/notifications')).body.unread_count).toBe(0);
  });

  it('blocks apply in both directions', async () => {
    const [x, y] = [await registerUser(ctx.app), await registerUser(ctx.app)];
    const xp = await x.api.post('/posts', { body: 'x public post' }, key());
    await y.api.post(`/users/${x.handle}/follow`);
    expect((await x.api.post(`/users/${y.handle}/block`)).status).toBe(204);
    // The blocked user can't see, follow, reply, like or message the blocker.
    expect((await y.api.get(`/posts/${xp.body.id}`)).status).toBe(404);
    expect((await y.api.get(`/users/${x.handle}`)).status).toBe(404);
    expect((await y.api.post(`/users/${x.handle}/follow`)).status).toBe(404);
    expect((await y.api.post('/posts', { body: 'r', parent_id: xp.body.id }, key())).status).toBe(404);
    expect((await y.api.post('/conversations', { handle: x.handle })).status).toBe(404);
    expect((await y.api.get('/feed/discover?limit=50')).body.items.map((p: any) => p.id)).not.toContain(xp.body.id);
    expect((await y.api.get(`/search?q=${x.handle}`)).body.users).toHaveLength(0);
    // The follow was removed by the block.
    expect((await y.api.get('/feed')).body.items.map((p: any) => p.id)).not.toContain(xp.body.id);
    // The blocker sees the profile as blocked and can't interact either.
    const prof = await x.api.get(`/users/${y.handle}`);
    expect(prof.body.is_blocked).toBe(true);
    expect((await x.api.post(`/users/${y.handle}/follow`)).body.code).toBe('blocked');
    expect((await x.api.post('/conversations', { handle: y.handle })).body.code).toBe('blocked');
    // Unblock restores visibility.
    expect((await x.api.del(`/users/${y.handle}/block`)).status).toBe(204);
    expect((await y.api.get(`/posts/${xp.body.id}`)).status).toBe(200);
  });

  it('lets authors and moderators delete, but not others', async () => {
    const p = await alice.api.post('/posts', { body: 'delete me' }, key());
    expect((await bob.api.del(`/posts/${p.body.id}`)).status).toBe(403);
    await setRole(ctx.deps, carol.id, 'moderator');
    expect((await carol.api.del(`/posts/${p.body.id}`)).status).toBe(204);
    expect((await alice.api.get(`/posts/${p.body.id}`)).status).toBe(404);
    const audit = await ctx.deps.db.query(`SELECT action FROM audit_events WHERE subject_id = $1`, [p.body.id]);
    expect(audit.rows.map((r) => r.action)).toContain('moderation.delete_post');
    await setRole(ctx.deps, carol.id, 'user');
    const own = await alice.api.post('/posts', { body: 'mine' }, key());
    expect((await alice.api.del(`/posts/${own.body.id}`)).status).toBe(204);
  });

  it('profiles, follows lists, search, trends and suggestions', async () => {
    await carol.api.post(`/users/${alice.handle}/follow`);
    const prof = await carol.api.get(`/users/${alice.handle.toUpperCase()}`);
    expect(prof.body).toMatchObject({ handle: alice.handle, is_following: true, is_me: false });
    expect(prof.body.followers_count).toBeGreaterThanOrEqual(1);
    const followers = await carol.api.get(`/users/${alice.handle}/followers`);
    expect(followers.body.items.map((u: any) => u.handle)).toContain(carol.handle);
    const following = await carol.api.get(`/users/${carol.handle}/following`);
    expect(following.body.items.map((u: any) => u.handle)).toContain(alice.handle);
    const search = await carol.api.get(`/search?q=${alice.handle.slice(0, 5)}&type=users`);
    expect(search.body.users.map((u: any) => u.handle)).toContain(alice.handle);
    expect(search.body.posts).toEqual([]);
    const tagSearch = await carol.api.get('/search?q=%23zoko&type=posts');
    expect(tagSearch.body.posts.length).toBeGreaterThan(0);
    const trends = await carol.api.get('/trends');
    expect(trends.body.items.map((t: any) => t.tag)).toContain('zoko');
    const sugg = await carol.api.get('/users/suggested');
    expect(sugg.status).toBe(200);
    expect(sugg.body.items.map((u: any) => u.id)).not.toContain(carol.id);
    const upd = await carol.api.patch('/users/me', { display_name: 'Carol C', bio: 'hi', settings: { theme: 'dark' } });
    expect(upd.body).toMatchObject({ display_name: 'Carol C', bio: 'hi', settings: { theme: 'dark', default_visibility: 'public' } });
    const badSettings = await carol.api.patch('/users/me', { settings: { theme: 'neon' } });
    expect(badSettings.status).toBe(422);
  });
});
