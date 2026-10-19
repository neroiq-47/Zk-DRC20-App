import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Media, UploadTicket } from '@zoko/contracts';
import type { AppDeps } from '../context.js';
import { mediaUrl } from '../context.js';
import { one } from '../db.js';
import { requireAuth } from '../auth/hook.js';
import { HttpProblem, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { TooLargeError } from '../storage/storage.js';
import { IMAGE_MIME, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_MIME, scanMedia } from '../services/mediaScan.js';

const uploadSchema = z
  .object({
    kind: z.enum(['image', 'video']),
    mime_type: z.string(),
    byte_size: z.number().int().positive(),
  })
  .superRefine((v, ctx) => {
    const allowed: readonly string[] = v.kind === 'image' ? IMAGE_MIME : VIDEO_MIME;
    if (!allowed.includes(v.mime_type)) {
      ctx.addIssue({ code: 'custom', path: ['mime_type'], message: `Use ${allowed.join(', ')}.` });
    }
    const max = v.kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (v.byte_size > max) {
      ctx.addIssue({ code: 'custom', path: ['byte_size'], message: `Files can be up to ${Math.round(max / 1024 / 1024)} MB.` });
    }
  });

const completeSchema = z.object({
  alt_text: z.string().trim().max(1000).optional(),
  width: z.number().int().min(1).max(20000).optional(),
  height: z.number().int().min(1).max(20000).optional(),
});
const idParams = z.object({ id: z.uuid() });

const UPLOAD_TTL_MS = 15 * 60 * 1000;

export function toMedia(deps: AppDeps, r: any): Media {
  return {
    id: r.id,
    kind: r.kind,
    processing_state: r.processing_state,
    url: r.processing_state === 'ready' ? mediaUrl(deps.config, r.id) : null,
    thumbnail_url: null,
    alt_text: r.alt_text,
  };
}

export default async function mediaRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, storage } = deps;

  // Raw upload bodies are streamed straight to storage (never buffered in memory).
  app.addContentTypeParser(/^(image|video)\/|^application\/octet-stream/, (_req, payload, done) => done(null, payload));

  app.post('/media/uploads', async (req, reply) => {
    const me = requireAuth(req);
    const body = parse(uploadSchema, req.body);
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
    const row = await one(
      db,
      `INSERT INTO media (owner_id, object_key, kind, mime_type, byte_size, storage_driver, upload_expires_at)
       VALUES ($1, $7, $2, $3, $4, $5, $6) RETURNING id, object_key`,
      [me.id, body.kind, body.mime_type, body.byte_size, storage.driver, expiresAt, `${me.id}/${randomUUID()}`],
    );
    const target = storage.createUploadTarget({
      mediaId: row.id,
      objectKey: row.object_key,
      mimeType: body.mime_type,
      byteSize: body.byte_size,
      expiresAt,
    });
    const ticket: UploadTicket = {
      media_id: row.id,
      upload_url: target.url,
      method: 'PUT',
      headers: target.headers,
      expires_at: expiresAt.toISOString(),
    };
    return reply.code(201).send(ticket);
  });

  app.put('/media/:id/blob', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const m = await one(db, `SELECT * FROM media WHERE id = $1`, [id]);
    if (!m || m.owner_id !== me.id) throw notFound('Media');
    if (m.processing_state !== 'pending') throw new HttpProblem(409, 'upload_closed', 'This upload is already complete.');
    if (m.upload_expires_at && new Date(m.upload_expires_at) < new Date()) {
      throw new HttpProblem(410, 'upload_expired', 'This upload link expired. Start a new upload.');
    }
    const ctype = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (ctype !== m.mime_type) {
      throw new HttpProblem(415, 'content_type_mismatch', `Upload with Content-Type ${m.mime_type}.`);
    }
    const declared = Number(m.byte_size);
    const len = req.headers['content-length'];
    if (len !== undefined && Number(len) !== declared) {
      throw new HttpProblem(422, 'size_mismatch', `This upload must be exactly ${declared} bytes.`);
    }
    if (!req.body) throw new HttpProblem(400, 'empty_upload', 'The upload body is empty.');
    let bytes: number;
    try {
      ({ bytes } = await storage.put(m.object_key, req.body as Readable, declared));
    } catch (err) {
      if (err instanceof TooLargeError) throw new HttpProblem(413, 'size_mismatch', `This upload must be exactly ${declared} bytes.`);
      throw err;
    }
    if (bytes !== declared) {
      await storage.delete(m.object_key);
      throw new HttpProblem(422, 'size_mismatch', `This upload must be exactly ${declared} bytes.`);
    }
    await db.query(`UPDATE media SET uploaded_at = now(), updated_at = now() WHERE id = $1`, [id]);
    return reply.code(204).send();
  });

  app.post('/media/:id/complete', async (req, reply) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const body = parse(completeSchema, req.body);
    const m = await one(db, `SELECT * FROM media WHERE id = $1`, [id]);
    if (!m || m.owner_id !== me.id) throw notFound('Media');
    if (m.processing_state !== 'pending') return reply.code(201).send(toMedia(deps, m)); // already scanned
    const stat = await storage.stat(m.object_key);
    if (!m.uploaded_at || !stat) throw new HttpProblem(409, 'upload_missing', 'Upload the file before completing it.');

    await db.query(`UPDATE media SET processing_state = 'scanning', updated_at = now() WHERE id = $1`, [id]);
    const head = await storage.readHead(m.object_key, 64);
    const result = scanMedia({ declaredMime: m.mime_type, declaredSize: Number(m.byte_size), actualSize: stat.size, head });
    let updated;
    if (result.ok) {
      // Video: no transcoding or thumbnail generation in the MVP; the original file is served once scanned.
      updated = await one(
        db,
        `UPDATE media SET processing_state = 'ready', scanned_at = now(), updated_at = now(),
            alt_text = $2, width = COALESCE($3, width), height = COALESCE($4, height)
          WHERE id = $1 RETURNING *`,
        [id, body.alt_text || null, result.width ?? body.width ?? null, result.height ?? body.height ?? null],
      );
    } else {
      await storage.delete(m.object_key);
      updated = await one(
        db,
        `UPDATE media SET processing_state = 'rejected', scanned_at = now(), updated_at = now(), rejection_reason = $2
          WHERE id = $1 RETURNING *`,
        [id, result.reason],
      );
    }
    return reply.code(201).send(toMedia(deps, updated));
  });

  app.get('/media/:id', async (req) => {
    const me = requireAuth(req);
    const { id } = parse(idParams, req.params);
    const m = await one(db, `SELECT * FROM media WHERE id = $1`, [id]);
    if (!m || (m.owner_id !== me.id && m.processing_state !== 'ready')) throw notFound('Media');
    return toMedia(deps, m);
  });

  /**
   * Serves media bytes. Only 'ready' (scanned) media is ever served. The UUID URL acts as a capability
   * so <Image>/<Video> components can load it without auth headers.
   * Production gap: signed, expiring CDN URLs that also enforce followers-only post visibility.
   */
  app.get('/media/:id/file', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const m = await one(
      db,
      `SELECT m.*, u.status AS owner_status FROM media m JOIN users u ON u.id = m.owner_id WHERE m.id = $1`,
      [id],
    );
    if (!m || m.processing_state !== 'ready' || m.owner_status === 'deleting') throw notFound('Media');
    const stat = await storage.stat(m.object_key);
    if (!stat) throw notFound('Media');
    reply.header('Content-Type', m.mime_type);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.header('X-Content-Type-Options', 'nosniff');
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, stat.size - 1);
      if (start > end) {
        reply.header('Content-Range', `bytes */${stat.size}`);
        throw new HttpProblem(416, 'range_not_satisfiable', 'Requested range not satisfiable.');
      }
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      reply.header('Content-Length', String(end - start + 1));
      return reply.send(storage.createReadStream(m.object_key, { start, end }));
    }
    reply.header('Content-Length', String(stat.size));
    return reply.send(storage.createReadStream(m.object_key));
  });
}
