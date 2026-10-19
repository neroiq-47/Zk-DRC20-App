import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/**
 * Object storage for media. The MVP ships a local-disk driver whose upload URL points back at this API
 * (PUT /api/v1/media/:id/blob). An S3-compatible driver would implement createUploadTarget() with a
 * presigned PUT URL (and the API would skip the blob route); the rest of the media flow is unchanged.
 */
export interface MediaStorage {
  readonly driver: string;
  createUploadTarget(input: { mediaId: string; objectKey: string; mimeType: string; byteSize: number; expiresAt: Date }): UploadTarget;
  /** Streams bytes into the object. Rejects with TooLargeError when more than maxBytes arrive. */
  put(objectKey: string, body: Readable, maxBytes: number): Promise<{ bytes: number }>;
  stat(objectKey: string): Promise<{ size: number } | null>;
  readHead(objectKey: string, n: number): Promise<Buffer>;
  createReadStream(objectKey: string, range?: { start: number; end: number }): Readable;
  delete(objectKey: string): Promise<void>;
}

export class TooLargeError extends Error {}

export class LocalDiskStorage implements MediaStorage {
  readonly driver = 'local';
  constructor(
    private rootDir: string,
    private publicBaseUrl: string,
  ) {}

  private file(objectKey: string): string {
    if (!/^[a-zA-Z0-9/_-]+$/.test(objectKey) || objectKey.includes('..')) throw new Error('invalid object key');
    return path.join(this.rootDir, 'media', objectKey);
  }

  createUploadTarget(input: { mediaId: string; mimeType: string }): UploadTarget {
    return {
      url: `${this.publicBaseUrl}/api/v1/media/${input.mediaId}/blob`,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
    };
  }

  async put(objectKey: string, body: Readable, maxBytes: number): Promise<{ bytes: number }> {
    const target = this.file(objectKey);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.part`;
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) cb(new TooLargeError('upload exceeds declared size'));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(body, counter, fs.createWriteStream(tmp));
      await fsp.rename(tmp, target);
    } catch (err) {
      await fsp.rm(tmp, { force: true });
      throw err;
    }
    return { bytes };
  }

  async stat(objectKey: string): Promise<{ size: number } | null> {
    try {
      const s = await fsp.stat(this.file(objectKey));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async readHead(objectKey: string, n: number): Promise<Buffer> {
    const fh = await fsp.open(this.file(objectKey), 'r');
    try {
      const buf = Buffer.alloc(n);
      const { bytesRead } = await fh.read(buf, 0, n, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }

  createReadStream(objectKey: string, range?: { start: number; end: number }): Readable {
    return fs.createReadStream(this.file(objectKey), range);
  }

  async delete(objectKey: string): Promise<void> {
    await fsp.rm(this.file(objectKey), { force: true });
  }
}
