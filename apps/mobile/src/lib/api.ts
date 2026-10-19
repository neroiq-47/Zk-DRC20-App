import * as Crypto from 'expo-crypto';
import type { Problem, TokenPair } from '@zoko/contracts';
import { API_BASE_URL } from './config';
import { useSession } from './session';

export class ApiError extends Error {
  status: number;
  problem: Problem | null;
  constructor(status: number, problem: Problem | null) {
    super(problem?.detail || problem?.title || `Request failed (${status})`);
    this.status = status;
    this.problem = problem;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  idempotent?: boolean; // adds an Idempotency-Key header
  auth?: boolean; // default true
  signal?: AbortSignal;
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const { tokens, setTokens, signOut } = useSession.getState();
  if (!tokens) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) await signOut();
      return false;
    }
    await setTokens((await res.json()) as TokenPair);
    return true;
  } catch {
    return false;
  }
}

function ensureFreshToken(): Promise<boolean> {
  refreshing ??= refreshTokens().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE_URL}${path}`;
  if (!query) return url;
  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return params.length ? `${url}?${params.join('&')}` : url;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, idempotent, auth = true, signal } = opts;
  const idempotencyKey = idempotent ? newIdempotencyKey() : undefined;

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const tokens = useSession.getState().tokens;
    if (auth && tokens) headers.Authorization = `Bearer ${tokens.access_token}`;
    return fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  };

  if (auth) {
    const tokens = useSession.getState().tokens;
    if (tokens && tokens.expires_at - Date.now() < 30_000) await ensureFreshToken();
  }

  let res = await send();
  if (res.status === 401 && auth && useSession.getState().tokens) {
    if (await ensureFreshToken()) res = await send();
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, (data as Problem) ?? null);
  return data as T;
}

/** Uploads a local file (from expo-image-picker) through the media upload flow and returns the media id. */
export async function uploadMedia(file: {
  uri: string;
  mimeType: string;
  fileSize: number;
  kind: 'image' | 'video';
  width?: number;
  height?: number;
  altText?: string;
}): Promise<import('@zoko/contracts').Media> {
  const ticket = await api<import('@zoko/contracts').UploadTicket>('/media/uploads', {
    method: 'POST',
    body: { kind: file.kind, mime_type: file.mimeType, byte_size: file.fileSize },
  });
  const blob = await (await fetch(file.uri)).blob();
  const tokens = useSession.getState().tokens;
  const put = await fetch(ticket.upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': file.mimeType,
      ...(tokens ? { Authorization: `Bearer ${tokens.access_token}` } : {}),
      ...ticket.headers,
    },
    body: blob,
  });
  if (!put.ok) throw new ApiError(put.status, null);
  return api(`/media/${ticket.media_id}/complete`, {
    method: 'POST',
    body: { alt_text: file.altText, width: file.width, height: file.height },
  });
}
