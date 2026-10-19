import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createTestApp, hasDb, registerUser, type TestCtx, type TestUser } from './helpers.js';

function openWs(url: string): Promise<{ ws: WebSocket; frames: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames: any[] = [];
    ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, frames }));
    ws.on('unexpected-response', (_req, res) => reject(Object.assign(new Error('rejected'), { status: res.statusCode })));
    ws.on('error', reject);
  });
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasDb)('messaging and realtime (EP06)', () => {
  let ctx: TestCtx;
  let alice: TestUser, bob: TestUser, eve: TestUser;
  let base: string;
  beforeAll(async () => {
    ctx = await createTestApp();
    [alice, bob, eve] = await Promise.all([registerUser(ctx.app), registerUser(ctx.app), registerUser(ctx.app)]);
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = ctx.app.server.address() as { port: number };
    base = `ws://127.0.0.1:${addr.port}/api/v1/ws`;
  });
  afterAll(async () => ctx?.close());

  it('message requests, membership checks, unread counts', async () => {
    const conv = await alice.api.post('/conversations', { handle: bob.handle });
    expect(conv.status).toBe(201);
    expect(conv.body).toMatchObject({ other: { handle: bob.handle }, is_request: false, unread_count: 0, last_message: null });
    const again = await alice.api.post('/conversations', { handle: bob.handle });
    expect(again.body.id).toBe(conv.body.id);
    const id = conv.body.id;

    const m1 = await alice.api.post(`/conversations/${id}/messages`, { body: 'hi bob', client_id: 'c1' });
    expect(m1.status).toBe(201);
    expect(m1.body).toMatchObject({ conversation_id: id, sender_id: alice.id, body: 'hi bob', client_id: 'c1' });
    // Retried send with the same client_id doesn't duplicate.
    expect((await alice.api.post(`/conversations/${id}/messages`, { body: 'hi bob', client_id: 'c1' })).body.id).toBe(m1.body.id);

    // Bob doesn't follow Alice -> it's a request for him.
    const bobView = await bob.api.get(`/conversations/${id}`);
    expect(bobView.body).toMatchObject({ is_request: true, unread_count: 1, other: { handle: alice.handle } });
    expect(bobView.body.last_message.body).toBe('hi bob');

    // Non-members can't read, write or mark read.
    expect((await eve.api.get(`/conversations/${id}`)).status).toBe(404);
    expect((await eve.api.get(`/conversations/${id}/messages`)).status).toBe(404);
    expect((await eve.api.post(`/conversations/${id}/messages`, { body: 'intrude' })).status).toBe(404);
    expect((await eve.api.post(`/conversations/${id}/read`)).status).toBe(404);
    expect((await eve.api.get('/conversations')).body.items).toHaveLength(0);

    // Replying accepts the request; reading clears unread.
    await bob.api.post(`/conversations/${id}/messages`, { body: 'hey alice' });
    expect((await bob.api.get(`/conversations/${id}`)).body.is_request).toBe(false);
    expect((await alice.api.get(`/conversations/${id}`)).body.unread_count).toBe(1);
    expect((await alice.api.post(`/conversations/${id}/read`)).status).toBe(204);
    expect((await alice.api.get('/conversations')).body.items[0]).toMatchObject({ id, unread_count: 0 });
    const msgs = await alice.api.get(`/conversations/${id}/messages`);
    expect(msgs.body.items.map((m: any) => m.body)).toEqual(['hey alice', 'hi bob']);

    const notes = await bob.api.get('/notifications');
    expect(notes.body.items.some((n: any) => n.kind === 'message' && n.entity_id === id)).toBe(true);
  });

  it('respects allow_message_requests and accept', async () => {
    const [x, y] = [await registerUser(ctx.app), await registerUser(ctx.app)];
    await y.api.patch('/users/me', { settings: { allow_message_requests: 'nobody' } });
    expect((await x.api.post('/conversations', { handle: y.handle })).body.code).toBe('messages_not_allowed');
    await y.api.patch('/users/me', { settings: { allow_message_requests: 'following' } });
    expect((await x.api.post('/conversations', { handle: y.handle })).status).toBe(403);
    await y.api.post(`/users/${x.handle}/follow`);
    const c = await x.api.post('/conversations', { handle: y.handle });
    expect(c.status).toBe(201);
    expect((await y.api.get(`/conversations/${c.body.id}`)).body.is_request).toBe(false);
    const [p, q] = [await registerUser(ctx.app), await registerUser(ctx.app)];
    const req = await p.api.post('/conversations', { handle: q.handle });
    expect((await q.api.get(`/conversations/${req.body.id}`)).body.is_request).toBe(true);
    expect((await q.api.post(`/conversations/${req.body.id}/accept`)).status).toBe(204);
    expect((await q.api.get(`/conversations/${req.body.id}`)).body.is_request).toBe(false);
  });

  it('rejects unauthenticated websocket connections', async () => {
    await expect(openWs(base)).rejects.toMatchObject({ status: 401 });
    await expect(openWs(`${base}?access_token=garbage`)).rejects.toMatchObject({ status: 401 });
  });

  it('pushes message frames only to conversation members', async () => {
    const conv = await alice.api.post('/conversations', { handle: bob.handle });
    const a = await openWs(`${base}?access_token=${alice.token}`);
    const b = await openWs(`${base}?access_token=${bob.token}`);
    const e = await openWs(`${base}?access_token=${eve.token}`);
    await alice.api.post(`/conversations/${conv.body.id}/messages`, { body: 'realtime!' });
    await wait(150);
    for (const s of [a, b]) {
      const f = s.frames.find((x) => x.type === 'message');
      expect(f.message).toMatchObject({ conversation_id: conv.body.id, body: 'realtime!' });
    }
    expect(e.frames.filter((x) => x.type === 'message')).toHaveLength(0);
    // Bob also gets a notification frame.
    expect(b.frames.some((x) => x.type === 'notification' && x.notification.kind === 'message')).toBe(true);

    // Explicit subscription to someone else's conversation is rejected and the socket closed.
    const closed = new Promise<number>((r) => e.ws.on('close', (code) => r(code)));
    e.ws.send(JSON.stringify({ type: 'subscribe', conversation_id: conv.body.id }));
    expect(await closed).toBe(4403);
    expect(e.frames.at(-1)).toEqual({ type: 'error', code: 'forbidden' });
    a.ws.send(JSON.stringify({ type: 'subscribe', conversation_id: conv.body.id }));
    await wait(100);
    expect(a.frames.at(-1)).toEqual({ type: 'subscribed', conversation_id: conv.body.id });
    a.ws.close();
    b.ws.close();
  });

  it('blocked users cannot message in an existing conversation', async () => {
    const conv = await alice.api.post('/conversations', { handle: bob.handle });
    await bob.api.post(`/users/${alice.handle}/block`);
    const res = await alice.api.post(`/conversations/${conv.body.id}/messages`, { body: 'still there?' });
    expect(res.status).toBe(403);
    expect((await alice.api.get('/conversations')).body.items.map((c: any) => c.id)).not.toContain(conv.body.id);
    await bob.api.del(`/users/${alice.handle}/block`);
  });

  it('registers Expo push devices', async () => {
    expect((await alice.api.post('/devices', { expo_push_token: 'ExponentPushToken[abc123]', platform: 'ios' })).status).toBe(204);
    expect((await alice.api.post('/devices', { expo_push_token: 'bogus', platform: 'ios' })).status).toBe(422);
  });
});
