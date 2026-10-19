import * as ImagePicker from 'expo-image-picker';
import type { Media } from '@zoko/contracts';
import { api, uploadMedia } from '@/lib/api';

export const MAX_MEDIA = 4;
export const MAX_BODY = 500;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export type UploadStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

export interface DraftMedia {
  key: string;
  uri: string;
  kind: 'image' | 'video';
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  alt: string;
  status: UploadStatus;
  mediaId?: string;
  error?: string;
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

function guessMime(asset: ImagePicker.ImagePickerAsset, kind: 'image' | 'video'): string {
  if (asset.mimeType) return asset.mimeType;
  const ext = (asset.fileName ?? asset.uri).split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg');
}

let seq = 0;

export async function toDraft(asset: ImagePicker.ImagePickerAsset): Promise<DraftMedia | { rejected: string }> {
  const kind = asset.type === 'video' || asset.type === 'pairedVideo' ? 'video' : 'image';
  let fileSize = asset.fileSize ?? 0;
  if (!fileSize) {
    try {
      fileSize = (await (await fetch(asset.uri)).blob()).size;
    } catch {
      return { rejected: "We couldn't read that file." };
    }
  }
  if (kind === 'image' && fileSize > MAX_IMAGE_BYTES) return { rejected: 'Photos can be up to 15 MB.' };
  if (kind === 'video' && fileSize > MAX_VIDEO_BYTES) return { rejected: 'Videos can be up to 200 MB.' };
  return {
    key: `m${Date.now()}_${seq++}`,
    uri: asset.uri,
    kind,
    mimeType: guessMime(asset, kind),
    fileSize,
    width: asset.width || undefined,
    height: asset.height || undefined,
    alt: '',
    status: 'idle',
  };
}

const PICK_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images', 'videos'], quality: 0.85, videoMaxDuration: 180 };

export async function pickFromLibrary(remaining: number): Promise<ImagePicker.ImagePickerAsset[] | 'denied'> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return 'denied';
  const res = await ImagePicker.launchImageLibraryAsync({ ...PICK_OPTIONS, allowsMultipleSelection: remaining > 1, selectionLimit: remaining, orderedSelection: true });
  return res.canceled ? [] : res.assets.slice(0, remaining);
}

export async function captureWithCamera(): Promise<ImagePicker.ImagePickerAsset[] | 'denied'> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return 'denied';
  const res = await ImagePicker.launchCameraAsync(PICK_OPTIONS);
  return res.canceled ? [] : res.assets.slice(0, 1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Uploads a draft item and waits (briefly) for scanning/processing to finish.
 * Resolves with the ready media id, or throws with a user-facing message.
 */
export async function uploadDraft(item: DraftMedia, onStatus: (s: UploadStatus) => void): Promise<string> {
  onStatus('uploading');
  let media: Media = await uploadMedia({
    uri: item.uri,
    mimeType: item.mimeType,
    fileSize: item.fileSize,
    kind: item.kind,
    width: item.width,
    height: item.height,
    altText: item.alt.trim() || undefined,
  });
  const deadline = Date.now() + 60_000;
  while (media.processing_state !== 'ready') {
    if (media.processing_state === 'rejected') throw new Error('This file can’t be posted.');
    if (media.processing_state === 'failed') throw new Error('We couldn’t process this file.');
    if (Date.now() > deadline) throw new Error('Processing is taking longer than expected.');
    onStatus('processing');
    await sleep(1500);
    media = await api<Media>(`/media/${media.id}`);
  }
  return media.id;
}
