// In-browser stand-in for the Zoko API, used only by the web preview build (EXPO_PUBLIC_DEMO=1).
// It serves responses recorded from the seeded API (fixture.json) and keeps likes, follows,
// new posts and messages in memory so the preview feels live. Nothing leaves the browser.
import type { Conversation, Me, Message, Post, Profile, UserSummary } from '@zoko/contracts';
import fixture from './fixture.json';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Shift recorded timestamps so the newest one lands a few minutes ago, keeping "2h ago" labels fresh.
const isStamp = (k: string, v: unknown): v is string => k.endsWith('_at') && k !== 'expires_at' && typeof v === 'string' && !isNaN(Date.parse(v));
let latest = 0;
JSON.stringify(fixture, (k, v) => (isStamp(k, v) && (latest = Math.max(latest, Date.parse(v))), v));
const offset = latest ? Date.now() - 5 * 60_000 - latest : 0;
const data: Record<string, Json> = JSON.parse(JSON.stringify(fixture), (k, v) => (isStamp(k, v) ? new Date(Date.parse(v) + offset).toISOString() : v));
const postPatch = new Map<string, Partial<Post>>();
const profilePatch = new Map<string, Partial<Profile>>();
const deleted = new Set<string>();
const createdPosts: Post[] = [];
const extraReplies = new Map<string, Post[]>();
let seq = 0;

const me = (): Me => data['/users/me'];
const meSummary = (): UserSummary => {
  const m = me();
  return { id: m.id, handle: m.handle, display_name: m.display_name, avatar_url: m.avatar_url, has_verified_wallet: m.has_verified_wallet };
};
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const now = () => new Date().toISOString();

function keyFor(pathname: string, params: URLSearchParams): string {
  const filter = params.get('filter');
  const candidates = Object.keys(data).filter((k) => k.split('?')[0] === pathname);
  if (filter) return candidates.find((k) => k.includes(`filter=${filter}`)) ?? '';
  return candidates[0] ?? '';
}

function allPosts(): Post[] {
  const seen = new Map<string, Post>();
  const visit = (v: Json) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') {
      if (typeof v.id === 'string' && v.author && 'body' in v) seen.set(v.id, v);
      Object.values(v).forEach(visit);
    }
  };
  visit(data);
  createdPosts.forEach((p) => seen.set(p.id, p));
  return [...seen.values()].filter((p) => !deleted.has(p.id));
}

function allUsers(): UserSummary[] {
  const seen = new Map<string, UserSummary>();
  for (const [k, v] of Object.entries(data)) if (/^\/users\/[^/]+$/.test(k) && v?.handle) seen.set(v.handle, v);
  return [...seen.values()];
}

// Applies in-memory changes to every post and profile inside a response.
function patch(v: Json): Json {
  if (Array.isArray(v)) return v.filter((x) => !(x && x.author && deleted.has(x.id))).map(patch);
  if (!v || typeof v !== 'object') return v;
  const out: Json = {};
  for (const [k, x] of Object.entries(v)) out[k] = patch(x);
  if (typeof v.id === 'string' && v.author && postPatch.has(v.id)) Object.assign(out, postPatch.get(v.id));
  if (typeof v.handle === 'string' && profilePatch.has(v.handle) && 'followers_count' in v) Object.assign(out, profilePatch.get(v.handle));
  return out;
}

function bumpPost(id: string, change: (p: Post) => Partial<Post>) {
  const base = allPosts().find((p) => p.id === id);
  if (!base) return;
  const merged = { ...base, ...postPatch.get(id) };
  postPatch.set(id, { ...postPatch.get(id), ...change(merged) });
}

function page(items: Json[]) {
  return { items, next_cursor: null };
}

function problem(status: number, title: string, code: string) {
  return { status, body: { type: 'about:blank', title, status, detail: title, code } };
}

function makePost(body: Json): Post {
  const quote = body.quote_post_id ? allPosts().find((p) => p.id === body.quote_post_id) ?? null : null;
  const parent = body.parent_id ? allPosts().find((p) => p.id === body.parent_id) ?? null : null;
  return {
    id: uid(),
    author: meSummary(),
    body: body.body ?? '',
    visibility: body.visibility ?? 'public',
    created_at: now(),
    parent_id: parent?.id ?? null,
    reply_to_handle: parent?.author.handle ?? null,
    quote,
    media: [],
    like_count: 0,
    reply_count: 0,
    repost_count: 0,
    liked_by_me: false,
    bookmarked_by_me: false,
    reposted_by_me: false,
  };
}

type Result = { status: number; body?: Json };

function route(method: string, pathname: string, params: URLSearchParams, body: Json): Result {
  const m = (re: RegExp) => pathname.match(re);
  let r: RegExpMatchArray | null;

  // Auth: any email and password sign in as the demo account.
  if (method === 'POST' && /^\/auth\/(login|register)$/.test(pathname)) return { status: 201, body: data.__login };
  if (method === 'POST' && pathname === '/auth/refresh') {
    const { user: _u, ...tokens } = data.__login;
    return { status: 201, body: tokens };
  }
  if (pathname === '/auth/logout' || pathname === '/devices' || pathname === '/notifications/read') return { status: 204 };

  if (method === 'PATCH' && pathname === '/users/me') {
    const { settings, avatar_media_id: _a, cover_media_id: _c, ...rest } = body ?? {};
    data['/users/me'] = { ...me(), ...rest, settings: { ...me().settings, ...settings } };
    return { status: 200, body: me() };
  }
  if (method === 'DELETE' && pathname === '/users/me') return { status: 202 };
  if (pathname === '/users/me/export') return { status: 200, body: { generated_at: now(), user: me(), posts: createdPosts, following: [], wallets: data['/wallet/connections']?.items ?? [] } };

  if ((r = m(/^\/users\/([^/]+)\/(follow|block)$/))) {
    const [, handle, what] = r;
    const on = method === 'POST';
    const prof = data[`/users/${handle}`];
    const cur = { ...prof, ...profilePatch.get(handle) };
    if (what === 'follow' && cur.is_following !== on) {
      profilePatch.set(handle, { ...profilePatch.get(handle), is_following: on, followers_count: cur.followers_count + (on ? 1 : -1) });
    }
    if (what === 'block') profilePatch.set(handle, { ...profilePatch.get(handle), is_blocked: on });
    return { status: 204 };
  }

  if (method === 'GET' && pathname === '/search') {
    const q = (params.get('q') ?? '').toLowerCase().replace(/^[@#]/, '');
    const users = allUsers().filter((u) => u.handle.includes(q) || u.display_name.toLowerCase().includes(q));
    const posts = allPosts().filter((p) => p.body.toLowerCase().includes(q));
    const type = params.get('type');
    return { status: 200, body: patch({ users: type === 'posts' ? [] : users, posts: type === 'users' ? [] : posts }) };
  }

  if (method === 'POST' && pathname === '/posts') {
    const post = makePost(body);
    createdPosts.unshift(post);
    if (post.parent_id) {
      extraReplies.set(post.parent_id, [...(extraReplies.get(post.parent_id) ?? []), post]);
      bumpPost(post.parent_id, (p) => ({ reply_count: p.reply_count + 1 }));
    }
    return { status: 201, body: post };
  }
  if ((r = m(/^\/posts\/([^/]+)\/(like|bookmark|repost)$/))) {
    const [, id, what] = r;
    const on = method === 'POST';
    if (what === 'like') bumpPost(id, (p) => (p.liked_by_me === on ? {} : { liked_by_me: on, like_count: p.like_count + (on ? 1 : -1) }));
    if (what === 'bookmark') bumpPost(id, () => ({ bookmarked_by_me: on }));
    if (what === 'repost') {
      bumpPost(id, (p) => (p.reposted_by_me === on ? {} : { reposted_by_me: on, repost_count: p.repost_count + (on ? 1 : -1) }));
      if (on) {
        const post = makePost({ body: '', quote_post_id: id });
        createdPosts.unshift(post);
        return { status: 201, body: post };
      }
    }
    return { status: 204 };
  }
  if (method === 'DELETE' && (r = m(/^\/posts\/([^/]+)$/))) {
    deleted.add(r[1]);
    return { status: 204 };
  }
  if (method === 'GET' && (r = m(/^\/posts\/([^/]+)$/))) {
    const post = allPosts().find((p) => p.id === r![1]);
    return post ? { status: 200, body: patch(post) } : problem(404, 'Post not found', 'not_found');
  }
  if (method === 'GET' && (r = m(/^\/posts\/([^/]+)\/replies$/))) {
    const recorded = data[keyFor(pathname, params)]?.items ?? [];
    return { status: 200, body: patch(page([...recorded, ...(extraReplies.get(r[1]) ?? [])])) };
  }

  if (method === 'GET' && (pathname === '/feed' || pathname === '/feed/discover')) {
    const recorded = data[keyFor(pathname, params)]?.items ?? [];
    return { status: 200, body: patch(page([...createdPosts.filter((p) => !p.parent_id), ...recorded])) };
  }
  if (method === 'GET' && pathname === `/users/${me().handle}/posts`) {
    const filter = params.get('filter') ?? 'posts';
    const recorded = data[keyFor(pathname, params)]?.items ?? [];
    const mine = createdPosts.filter((p) => (filter === 'replies' ? !!p.parent_id : filter === 'posts' ? !p.parent_id : false));
    return { status: 200, body: patch(page([...mine, ...recorded])) };
  }

  // Messaging
  if (method === 'POST' && pathname === '/conversations') {
    const list: Conversation[] = data['/conversations?limit=50'].items;
    const existing = list.find((c) => c.other.handle === body?.handle);
    if (existing) return { status: 201, body: existing };
    const other = allUsers().find((u) => u.handle === body?.handle);
    if (!other) return problem(404, 'User not found', 'not_found');
    const conv: Conversation = { id: uid(), other, last_message: null, unread_count: 0, is_request: false, updated_at: now() };
    list.unshift(conv);
    data[`/conversations/${conv.id}`] = conv;
    data[`/conversations/${conv.id}/messages?limit=50`] = page([]);
    return { status: 201, body: conv };
  }
  if ((r = m(/^\/conversations\/([^/]+)\/(read|accept)$/))) {
    const conv: Conversation | undefined = data['/conversations?limit=50'].items.find((c: Conversation) => c.id === r![1]);
    if (conv) {
      if (r[2] === 'read') conv.unread_count = 0;
      else conv.is_request = false;
      data[`/conversations/${conv.id}`] = conv;
    }
    return { status: 204 };
  }
  if (method === 'POST' && (r = m(/^\/conversations\/([^/]+)\/messages$/))) {
    const id = r[1];
    const msg: Message = { id: uid(), conversation_id: id, sender_id: me().id, body: body?.body ?? '', created_at: now(), client_id: body?.client_id ?? null };
    const key = `/conversations/${id}/messages?limit=50`;
    data[key] = page([msg, ...(data[key]?.items ?? [])]);
    const conv: Conversation | undefined = data['/conversations?limit=50'].items.find((c: Conversation) => c.id === id);
    if (conv) {
      Object.assign(conv, { last_message: msg, updated_at: msg.created_at, is_request: false });
      data[`/conversations/${id}`] = conv;
    }
    return { status: 201, body: msg };
  }

  // Features that need the real server stay off in the preview.
  if (pathname.startsWith('/media/')) return problem(501, 'Photo and video uploads are off in this web preview.', 'preview_disabled');
  if (method === 'POST' && pathname.startsWith('/wallet/')) return problem(501, 'Wallet verification is off in this web preview.', 'preview_disabled');
  if (method === 'POST' && pathname.startsWith('/transfers')) return problem(501, "Transfers aren't available on this server yet.", 'transfer_builder_unavailable');
  if (method === 'POST' && pathname === '/reports') return { status: 201, body: { id: uid(), status: 'open' } };
  if (pathname.startsWith('/moderation')) return { status: 200, body: page([]) };

  if (method === 'GET') {
    const key = keyFor(pathname, params);
    if (key) {
      const v = data[key];
      return { status: 200, body: patch(v && 'next_cursor' in v ? { ...v, next_cursor: null } : v) };
    }
    if (pathname.endsWith('/messages')) return { status: 200, body: page([]) };
  }
  return problem(404, 'Not available in the preview', 'not_found');
}

export function installDemoApi(baseUrl: string) {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(baseUrl)) return realFetch(input, init);
    const u = new URL(url);
    const pathname = u.pathname.replace(new URL(baseUrl).pathname, '') || '/';
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Json;
    try {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    } catch {
      body = undefined;
    }
    await new Promise((res) => setTimeout(res, 120));
    const result = route(method, pathname, u.searchParams, body);
    const isJson = result.body !== undefined;
    return new Response(isJson ? JSON.stringify(result.body) : null, {
      status: result.status,
      headers: { 'Content-Type': result.status >= 400 ? 'application/problem+json' : 'application/json' },
    });
  }) as typeof fetch;
}
