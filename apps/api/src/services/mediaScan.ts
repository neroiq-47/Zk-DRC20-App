/**
 * Media "scan" for the MVP: verifies the file's magic bytes match the declared MIME type and that the
 * size is within limits. This blocks disguised executables/HTML and mislabeled files from being served.
 * Production gap: malware/CSAM scanning (e.g. a hash-matching service) and video transcoding /
 * thumbnail generation are NOT implemented; videos are served as uploaded.
 */
export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export const VIDEO_MIME = ['video/mp4', 'video/quicktime'] as const;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const QT_ATOMS = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

function ascii(buf: Buffer, start: number, end: number): string {
  return buf.subarray(start, end).toString('latin1');
}

export function detectMime(head: Buffer): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp';
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  if (head.length >= 8 && QT_ATOMS.has(ascii(head, 4, 8))) return 'video/quicktime';
  return null;
}

export interface ScanResult {
  ok: boolean;
  reason?: string;
  width?: number;
  height?: number;
}

export function scanMedia(input: { declaredMime: string; declaredSize: number; actualSize: number; head: Buffer }): ScanResult {
  const { declaredMime, declaredSize, actualSize, head } = input;
  if (actualSize !== declaredSize) return { ok: false, reason: 'size_mismatch' };
  const limit = declaredMime.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (actualSize > limit) return { ok: false, reason: 'too_large' };
  const detected = detectMime(head);
  if (!detected) return { ok: false, reason: 'unrecognized_format' };
  // MP4 and QuickTime share the ISO BMFF container; accept either for video uploads.
  const compatible = detected === declaredMime || (declaredMime.startsWith('video/') && detected.startsWith('video/'));
  if (!compatible) return { ok: false, reason: 'content_does_not_match_type' };
  const dims = detected === 'image/png' && head.length >= 24 ? { width: head.readUInt32BE(16), height: head.readUInt32BE(20) } : {};
  return { ok: true, ...dims };
}
