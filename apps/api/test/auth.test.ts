import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestApp, hasDb, registerUser, uniqueHandle, type TestCtx } from './helpers.js';

describe.skipIf(!hasDb)('auth (EP01)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx?.close());

  it('registers, returns Me and a token pair', async () => {
    const handle = uniqueHandle('reg');
    const res = await client(ctx.app).post('/auth/register', {
      email: `${handle}@Example.test`,
      password: 'twelve chars!',
      handle,
      display_name: 'Reg User',
    });
    expect(res.status).toBe(201);
    expect(res.body.access_token).toBeTypeOf('string');
    expect(res.body.refresh_token).toBeTypeOf('string');
    expect(res.body.expires_in).toBe(900);
    expect(res.body.user).toMatchObject({ handle, display_name: 'Reg User', role: 'user', is_me: true, email: `${handle}@Example.test` });
    expect(res.body.user.settings).toEqual({
      theme: 'system',
      default_visibility: 'public',
      allow_message_requests: 'everyone',
      show_wallet_on_profile: true,
    });
    const me = await client(ctx.app, res.body.access_token).get('/users/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(res.body.user.id);
  });

  it('validates input with problem+json field errors', async () => {
    const res = await client(ctx.app).post('/auth/register', { email: 'not-an-email', password: 'short', handle: 'a!' });
    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 422, code: 'validation_failed', title: expect.any(String), type: expect.any(String) });
    expect(Object.keys(res.body.errors).sort()).toEqual(['email', 'handle', 'password']);
  });

  it('enforces case-insensitive unique handles and emails', async () => {
    const u = await registerUser(ctx.app);
    const dupHandle = await client(ctx.app).post('/auth/register', {
      email: `other_${u.handle}@example.test`,
      password: 'long enough password',
      handle: u.handle.toUpperCase(),
    });
    expect(dupHandle.status).toBe(409);
    expect(dupHandle.body.code).toBe('handle_taken');
    const dupEmail = await client(ctx.app).post('/auth/register', {
      email: u.email.toUpperCase(),
      password: 'long enough password',
      handle: uniqueHandle('x'),
    });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.code).toBe('email_taken');
  });

  it('logs in and rejects wrong passwords', async () => {
    const u = await registerUser(ctx.app);
    const ok = await client(ctx.app).post('/auth/login', { email: u.email.toUpperCase(), password: u.password });
    expect(ok.status).toBe(201);
    expect(ok.body.user.id).toBe(u.id);
    const bad = await client(ctx.app).post('/auth/login', { email: u.email, password: 'wrong password!!' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('invalid_credentials');
    const unknown = await client(ctx.app).post('/auth/login', { email: 'nobody@example.test', password: 'whatever whatever' });
    expect(unknown.status).toBe(401);
  });

  it('rotates refresh tokens; reusing a rotated token revokes the whole family', async () => {
    const u = await registerUser(ctx.app);
    const r1 = await client(ctx.app).post('/auth/refresh', { refresh_token: u.refresh });
    expect(r1.status).toBe(201);
    expect(r1.body.refresh_token).not.toBe(u.refresh);
    const r2 = await client(ctx.app).post('/auth/refresh', { refresh_token: r1.body.refresh_token });
    expect(r2.status).toBe(201);

    // Replay the first (already rotated) token: theft detected.
    const replay = await client(ctx.app).post('/auth/refresh', { refresh_token: u.refresh });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('refresh_token_reused');

    // The newest token of the family is revoked too, and so are access tokens of the family.
    const after = await client(ctx.app).post('/auth/refresh', { refresh_token: r2.body.refresh_token });
    expect(after.status).toBe(401);
    const me = await client(ctx.app, r2.body.access_token).get('/users/me');
    expect(me.status).toBe(401);

    // Other sessions (other families) are unaffected.
    const login = await client(ctx.app).post('/auth/login', { email: u.email, password: u.password });
    expect((await client(ctx.app, login.body.access_token).get('/users/me')).status).toBe(200);
  });

  it('logout revokes the session family', async () => {
    const u = await registerUser(ctx.app);
    expect((await client(ctx.app).post('/auth/logout', { refresh_token: u.refresh })).status).toBe(204);
    expect((await client(ctx.app).post('/auth/refresh', { refresh_token: u.refresh })).status).toBe(401);
    expect((await u.api.get('/users/me')).status).toBe(401);
  });

  it('requires auth on protected routes and rejects garbage tokens', async () => {
    expect((await client(ctx.app).get('/feed')).status).toBe(401);
    const bad = await client(ctx.app, 'not.a.jwt').get('/feed');
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('token_invalid');
  });

  it('account deletion revokes sessions and hides the profile', async () => {
    const u = await registerUser(ctx.app);
    const other = await registerUser(ctx.app);
    expect((await u.api.post('/posts', { body: 'bye' }, { 'idempotency-key': 'k1' })).status).toBe(201);
    expect((await u.api.del('/users/me')).status).toBe(202);
    expect((await u.api.get('/users/me')).status).toBe(401);
    expect((await other.api.get(`/users/${u.handle}`)).status).toBe(404);
    expect((await client(ctx.app).post('/auth/login', { email: u.email, password: u.password })).status).toBe(401);
  });

  it('exports account data as JSON', async () => {
    const u = await registerUser(ctx.app);
    await u.api.post('/posts', { body: 'export me #data' }, { 'idempotency-key': 'e1' });
    const res = await u.api.get('/users/me/export');
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(u.id);
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.generated_at).toBeTypeOf('string');
    expect(res.body.wallets).toEqual([]);
  });
});

describe.skipIf(!hasDb)('auth rate limiting', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({ config: { authRateLimitMax: 3 } });
  });
  afterAll(async () => ctx?.close());

  it('returns 429 problem after too many attempts', async () => {
    const statuses: number[] = [];
    let last: any;
    for (let i = 0; i < 5; i++) {
      last = await client(ctx.app).post('/auth/login', { email: 'x@example.test', password: 'nope nope nope' });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[4]).toBe(429);
    expect(last.body.code).toBe('rate_limited');
  });
});
