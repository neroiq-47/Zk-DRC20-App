import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDb, PNG_1x1, registerUser, type TestCtx, type TestUser } from './helpers.js';
import { detectMime, scanMedia } from '../src/services/mediaScan.js';

describe('media magic-byte scan (unit)', () => {
  it('detects formats by content, not by name', () => {
    expect(detectMime(PNG_1x1)).toBe('image/png');
    expect(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(detectMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(detectMime(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0', 'latin1'))).toBe('image/heic');
    expect(detectMime(Buffer.from('\0\0\0\x18ftypisom\0\0\0\0', 'latin1'))).toBe('video/mp4');
    expect(detectMime(Buffer.from('\0\0\0\x14ftypqt  \0\0\0\0', 'latin1'))).toBe('video/quicktime');
    expect(detectMime(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
  });
  it('rejects size mismatches and wrong types', () => {
    expect(scanMedia({ declaredMime: 'image/png', declaredSize: 10, actualSize: 9, head: PNG_1x1 }).reason).toBe('size_mismatch');
    expect(scanMedia({ declaredMime: 'image/jpeg', declaredSize: PNG_1x1.length, actualSize: PNG_1x1.length, head: PNG_1x1 }).reason).toBe(
      'content_does_not_match_type',
    );
    expect(scanMedia({ declaredMime: 'image/png', declaredSize: PNG_1x1.length, actualSize: PNG_1x1.length, head: PNG_1x1 })).toMatchObject({
      ok: true,
      width: 1,
      height: 1,
    });
  });
});

describe.skipIf(!hasDb)('media uploads (EP05)', () => {
  let ctx: TestCtx;
  let alice: TestUser, bob: TestUser;
  beforeAll(async () => {
    ctx = await createTestApp();
    [alice, bob] = await Promise.all([registerUser(ctx.app), registerUser(ctx.app)]);
  });
  afterAll(async () => ctx?.close());

  const put = (user: TestUser | null, mediaId: string, body: Buffer, type: string) =>
    ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/media/${mediaId}/blob`,
      headers: { 'content-type': type, ...(user ? { authorization: `Bearer ${user.token}` } : {}) },
      payload: body,
    });

  it('validates upload requests', async () => {
    const bad = await alice.api.post('/media/uploads', { kind: 'image', mime_type: 'image/gif', byte_size: 10 });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.mime_type).toBeDefined();
    const big = await alice.api.post('/media/uploads', { kind: 'image', mime_type: 'image/png', byte_size: 16 * 1024 * 1024 });
    expect(big.body.errors.byte_size).toBeDefined();
  });

  it('upload -> scan -> ready -> served, and attachable to a post', async () => {
    const t = await alice.api.post('/media/uploads', { kind: 'image', mime_type: 'image/png', byte_size: PNG_1x1.length });
    expect(t.status).toBe(201);
    expect(t.body.method).toBe('PUT');
    expect(t.body.upload_url).toBe(`http://localhost:4000/api/v1/media/${t.body.media_id}/blob`);
    expect(t.body.headers['Content-Type']).toBe('image/png');
    const id = t.body.media_id;

    // Unscanned media is never served.
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/media/${id}/file` })).statusCode).toBe(404);
    // Only the owner can upload, with the declared content type.
    expect((await put(bob, id, PNG_1x1, 'image/png')).statusCode).toBe(404);
    expect((await put(null, id, PNG_1x1, 'image/png')).statusCode).toBe(401);
    expect((await put(alice, id, PNG_1x1, 'image/jpeg')).statusCode).toBe(415);
    expect((await put(alice, id, PNG_1x1, 'image/png')).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/media/${id}/file` })).statusCode).toBe(404);
    expect((await bob.api.get(`/media/${id}`)).status).toBe(404);

    const done = await alice.api.post(`/media/${id}/complete`, { alt_text: 'a dot' });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ id, kind: 'image', processing_state: 'ready', alt_text: 'a dot' });
    expect(done.body.url).toBe(`http://localhost:4000/api/v1/media/${id}/file`);
    const file = await ctx.app.inject({ method: 'GET', url: `/api/v1/media/${id}/file` });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.rawPayload.equals(PNG_1x1)).toBe(true);
    const range = await ctx.app.inject({ method: 'GET', url: `/api/v1/media/${id}/file`, headers: { range: 'bytes=0-3' } });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload.length).toBe(4);

    const post = await alice.api.post('/posts', { body: '', media_ids: [id] }, { 'idempotency-key': 'm1' });
    expect(post.status).toBe(201);
    expect(post.body.media).toEqual([
      { id, kind: 'image', url: done.body.url, thumbnail_url: null, alt_text: 'a dot', width: 1, height: 1 },
    ]);
    // Can't attach the same media twice, nor someone else's media.
    expect((await alice.api.post('/posts', { body: 'again', media_ids: [id] }, { 'idempotency-key': 'm2' })).body.code).toBe('invalid_media');
    expect((await bob.api.post('/posts', { body: 'steal', media_ids: [id] }, { 'idempotency-key': 'm3' })).body.code).toBe('invalid_media');
  });

  it('rejects files whose bytes do not match the declared type and never serves them', async () => {
    const fake = Buffer.from('<html><script>alert("x")</script></html>');
    const t = await alice.api.post('/media/uploads', { kind: 'image', mime_type: 'image/jpeg', byte_size: fake.length });
    expect((await put(alice, t.body.media_id, fake, 'image/jpeg')).statusCode).toBe(204);
    const done = await alice.api.post(`/media/${t.body.media_id}/complete`, {});
    expect(done.body.processing_state).toBe('rejected');
    expect(done.body.url).toBeNull();
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/media/${t.body.media_id}/file` })).statusCode).toBe(404);
    expect((await alice.api.post('/posts', { body: 'x', media_ids: [t.body.media_id] }, { 'idempotency-key': 'm4' })).body.code).toBe('invalid_media');
  });

  it('rejects uploads larger than declared and completion without upload', async () => {
    const t = await alice.api.post('/media/uploads', { kind: 'image', mime_type: 'image/png', byte_size: 10 });
    expect((await alice.api.post(`/media/${t.body.media_id}/complete`, {})).body.code).toBe('upload_missing');
    const res = await put(alice, t.body.media_id, PNG_1x1, 'image/png');
    expect([413, 422]).toContain(res.statusCode);
  });

  it('sets an avatar only from my own ready image', async () => {
    const t = await alice.api.post('/media/uploads', { kind: 'image', mime_type: 'image/png', byte_size: PNG_1x1.length });
    expect((await bob.api.patch('/users/me', { avatar_media_id: t.body.media_id })).body.code).toBe('media_not_owned');
    expect((await alice.api.patch('/users/me', { avatar_media_id: t.body.media_id })).body.code).toBe('media_not_ready');
    await put(alice, t.body.media_id, PNG_1x1, 'image/png');
    await alice.api.post(`/media/${t.body.media_id}/complete`, {});
    const me = await alice.api.patch('/users/me', { avatar_media_id: t.body.media_id });
    expect(me.status).toBe(200);
    expect(me.body.avatar_url).toBe(`http://localhost:4000/api/v1/media/${t.body.media_id}/file`);
  });
});
