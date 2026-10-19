import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDb, registerUser, type TestCtx, type TestUser } from './helpers.js';

let n = 0;
const key = () => ({ 'idempotency-key': `f-${Date.now()}-${++n}` });

describe.skipIf(!hasDb)('feeds (EP04)', () => {
  let ctx: TestCtx;
  let me: TestUser, a: TestUser, b: TestUser, stranger: TestUser;
  beforeAll(async () => {
    ctx = await createTestApp();
    [me, a, b, stranger] = await Promise.all([1, 2, 3, 4].map(() => registerUser(ctx.app)));
    await me.api.post(`/users/${a.handle}/follow`);
    await me.api.post(`/users/${b.handle}/follow`);
  });
  afterAll(async () => ctx?.close());

  it('following feed contains me + followed users only, newest first', async () => {
    const mine = await me.api.post('/posts', { body: 'mine' }, key());
    const pa = await a.api.post('/posts', { body: 'from a' }, key());
    const ps = await stranger.api.post('/posts', { body: 'stranger' }, key());
    const feed = await me.api.get('/feed');
    const ids = feed.body.items.map((p: any) => p.id);
    expect(ids).toContain(mine.body.id);
    expect(ids).toContain(pa.body.id);
    expect(ids).not.toContain(ps.body.id);
    expect(ids.indexOf(pa.body.id)).toBeLessThan(ids.indexOf(mine.body.id));
  });

  it('cursor pagination is stable under concurrent inserts (no duplicates, no skips)', async () => {
    const created: string[] = [];
    for (let i = 0; i < 25; i++) {
      const author = i % 2 ? a : b;
      created.push((await author.api.post('/posts', { body: `bulk ${i}` }, key())).body.id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: { status: number; body: any } = await me.api.get(`/feed?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((p: any) => p.id));
      cursor = res.body.next_cursor;
      // New posts arrive while the client is paginating.
      await a.api.post('/posts', { body: `concurrent ${pages}` }, key());
      await b.api.post('/posts', { body: `concurrent b ${pages}` }, key());
      pages++;
    } while (cursor && pages < 50);
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of created) expect(seen).toContain(id);
  });

  it('rejects malformed cursors', async () => {
    const res = await me.api.get('/feed?cursor=garbage');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('deduplicates reposts of the same post', async () => {
    const original = await stranger.api.post('/posts', { body: 'viral' }, key());
    const r1 = await a.api.post(`/posts/${original.body.id}/repost`);
    const r2 = await b.api.post(`/posts/${original.body.id}/repost`);
    const feed = await me.api.get('/feed?limit=50');
    const reposts = feed.body.items.filter((p: any) => p.quote?.id === original.body.id && p.body === '');
    expect(reposts).toHaveLength(1);
    expect(reposts[0].id).toBe(r1.body.id);
    expect(feed.body.items.map((p: any) => p.id)).not.toContain(r2.body.id);
    // If I follow the original author, the original shows and reposts are dropped.
    await me.api.post(`/users/${stranger.handle}/follow`);
    const feed2 = await me.api.get('/feed?limit=50');
    const ids = feed2.body.items.map((p: any) => p.id);
    expect(ids).toContain(original.body.id);
    expect(ids).not.toContain(r1.body.id);
    await me.api.del(`/users/${stranger.handle}/follow`);
  });

  it('discover shows public posts and filters blocked, suspended and replies', async () => {
    const pub = await stranger.api.post('/posts', { body: 'discover me' }, key());
    const reply = await stranger.api.post('/posts', { body: 'a reply', parent_id: pub.body.id }, key());
    let ids = (await me.api.get('/feed/discover?limit=50')).body.items.map((p: any) => p.id);
    expect(ids).toContain(pub.body.id);
    expect(ids).not.toContain(reply.body.id);
    await me.api.post(`/users/${stranger.handle}/block`);
    ids = (await me.api.get('/feed/discover?limit=50')).body.items.map((p: any) => p.id);
    expect(ids).not.toContain(pub.body.id);
    await me.api.del(`/users/${stranger.handle}/block`);
    await ctx.deps.db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [stranger.id]);
    ids = (await me.api.get('/feed/discover?limit=50')).body.items.map((p: any) => p.id);
    expect(ids).not.toContain(pub.body.id);
    await ctx.deps.db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [stranger.id]);
  });

  it('profile post filters (posts, replies)', async () => {
    const p = await a.api.post('/posts', { body: 'top' }, key());
    const r = await a.api.post('/posts', { body: 'rep', parent_id: p.body.id }, key());
    const posts = (await me.api.get(`/users/${a.handle}/posts?filter=posts&limit=50`)).body.items.map((x: any) => x.id);
    const replies = (await me.api.get(`/users/${a.handle}/posts?filter=replies`)).body.items.map((x: any) => x.id);
    expect(posts).toContain(p.body.id);
    expect(posts).not.toContain(r.body.id);
    expect(replies).toEqual([r.body.id]);
  });
});
