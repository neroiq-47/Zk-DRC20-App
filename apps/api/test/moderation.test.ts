import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestApp, hasDb, registerUser, setRole, type TestCtx, type TestUser } from './helpers.js';

describe.skipIf(!hasDb)('reports and moderation RBAC (EP07)', () => {
  let ctx: TestCtx;
  let reporter: TestUser, abuser: TestUser, mod: TestUser, admin: TestUser;
  beforeAll(async () => {
    ctx = await createTestApp();
    [reporter, abuser, mod, admin] = await Promise.all([1, 2, 3, 4].map(() => registerUser(ctx.app)));
    await setRole(ctx.deps, mod.id, 'moderator');
    await setRole(ctx.deps, admin.id, 'admin');
  });
  afterAll(async () => ctx?.close());

  it('users can report; only moderators/admins can see and act on the queue', async () => {
    const post = await abuser.api.post('/posts', { body: 'spammy spam' }, { 'idempotency-key': 'p1' });
    const rep = await reporter.api.post('/reports', { target_kind: 'post', target_id: post.body.id, reason: 'spam', details: 'obvious spam' });
    expect(rep.status).toBe(201);
    expect(rep.body).toEqual({ id: expect.any(String), status: 'open' });
    expect((await reporter.api.post('/reports', { target_kind: 'post', target_id: crypto.randomUUID(), reason: 'spam' })).status).toBe(404);
    expect((await reporter.api.post('/reports', { target_kind: 'post', target_id: post.body.id, reason: 'meh' })).status).toBe(422);

    // RBAC: regular users get 403 on queue and actions.
    const q403 = await reporter.api.get('/moderation/reports');
    expect(q403.status).toBe(403);
    expect(q403.body.code).toBe('forbidden_role');
    expect((await abuser.api.post(`/moderation/reports/${rep.body.id}/actions`, { action: 'dismiss', reason: 'x' })).status).toBe(403);
    expect((await client(ctx.app).get('/moderation/reports')).status).toBe(401);

    const queue = await mod.api.get('/moderation/reports?status=open');
    expect(queue.status).toBe(200);
    const item = queue.body.items.find((r: any) => r.id === rep.body.id);
    expect(item).toMatchObject({ target_kind: 'post', target_id: post.body.id, reason: 'spam', status: 'open', reporter: { handle: reporter.handle } });

    const act = await mod.api.post(`/moderation/reports/${rep.body.id}/actions`, { action: 'hide_post', reason: 'spam policy' });
    expect(act.status).toBe(201);
    expect(act.body.status).toBe('resolved');
    expect((await reporter.api.get(`/posts/${post.body.id}`)).status).toBe(404);
    const actions = await ctx.deps.db.query(`SELECT action, moderator_id FROM moderation_actions WHERE report_id = $1`, [rep.body.id]);
    expect(actions.rows).toEqual([{ action: 'hide_post', moderator_id: mod.id }]);
    const audit = await ctx.deps.db.query(`SELECT action, actor_id FROM audit_events WHERE subject_id = $1`, [post.body.id]);
    expect(audit.rows).toContainEqual({ action: 'moderation.hide_post', actor_id: mod.id });
  });

  it('suspending a user revokes their sessions; moderators cannot suspend admins', async () => {
    const rep = await reporter.api.post('/reports', { target_kind: 'user', target_id: abuser.id, reason: 'harassment' });
    const act = await mod.api.post(`/moderation/reports/${rep.body.id}/actions`, { action: 'suspend_user', reason: 'harassment' });
    expect(act.status).toBe(201);
    const after = await abuser.api.get('/users/me');
    expect(after.status).toBe(401);
    const login = await client(ctx.app).post('/auth/login', { email: abuser.email, password: abuser.password });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('account_suspended');
    expect((await reporter.api.get(`/users/${abuser.handle}`)).status).toBe(404);

    const restore = await admin.api.post(`/moderation/reports/${rep.body.id}/actions`, { action: 'restore', reason: 'appeal granted' });
    expect(restore.status).toBe(201);
    expect((await client(ctx.app).post('/auth/login', { email: abuser.email, password: abuser.password })).status).toBe(201);

    const repAdmin = await reporter.api.post('/reports', { target_kind: 'user', target_id: admin.id, reason: 'other' });
    expect((await mod.api.post(`/moderation/reports/${repAdmin.body.id}/actions`, { action: 'suspend_user', reason: 'x' })).status).toBe(403);
    const dismissed = await mod.api.post(`/moderation/reports/${repAdmin.body.id}/actions`, { action: 'dismiss', reason: 'not abuse' });
    expect(dismissed.body.status).toBe('dismissed');
  });

  it('message reports require membership', async () => {
    const sender = await registerUser(ctx.app);
    const conv = await sender.api.post('/conversations', { handle: reporter.handle });
    const msg = await sender.api.post(`/conversations/${conv.body.id}/messages`, { body: 'nasty' });
    expect((await mod.api.post('/reports', { target_kind: 'message', target_id: msg.body.id, reason: 'harassment' })).status).toBe(404);
    expect((await reporter.api.post('/reports', { target_kind: 'message', target_id: msg.body.id, reason: 'harassment' })).status).toBe(201);
  });
});
