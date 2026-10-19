import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { Page, Post, SearchResults } from '@zoko/contracts';
import { POST_CONTAINING_ROOTS } from './keys';

type Updater = (p: Post) => Post;

function mapPost(p: Post, id: string, fn: Updater): Post {
  let next = p.id === id ? fn(p) : p;
  if (next.quote) {
    const q = mapPost(next.quote, id, fn);
    if (q !== next.quote) next = { ...next, quote: q };
  }
  return next;
}

function mapList(items: Post[], id: string, fn: Updater): Post[] {
  let changed = false;
  const out = items.map((p) => {
    const n = mapPost(p, id, fn);
    if (n !== p) changed = true;
    return n;
  });
  return changed ? out : items;
}

function isInfinite(d: unknown): d is InfiniteData<Page<Post>> {
  return !!d && typeof d === 'object' && Array.isArray((d as InfiniteData<unknown>).pages);
}
function isSearch(d: unknown): d is SearchResults {
  return !!d && typeof d === 'object' && Array.isArray((d as SearchResults).posts) && Array.isArray((d as SearchResults).users);
}
function isPost(d: unknown): d is Post {
  return !!d && typeof d === 'object' && typeof (d as Post).id === 'string' && 'like_count' in (d as object);
}

/** Applies `fn` to every cached copy of a post (feeds, detail, replies, profile lists, bookmarks, search, nested quotes). */
export function updatePostEverywhere(qc: QueryClient, id: string, fn: Updater) {
  qc.setQueriesData({ predicate: (q) => POST_CONTAINING_ROOTS.has(String(q.queryKey[0])) }, (data: unknown) => {
    if (!data) return data;
    if (isInfinite(data)) {
      let changed = false;
      const pages = data.pages.map((pg) => {
        const items = mapList(pg.items, id, fn);
        if (items !== pg.items) changed = true;
        return items === pg.items ? pg : { ...pg, items };
      });
      return changed ? { ...data, pages } : data;
    }
    if (isSearch(data)) {
      const posts = mapList(data.posts, id, fn);
      return posts === data.posts ? data : { ...data, posts };
    }
    if (isPost(data)) return mapPost(data, id, fn);
    return data;
  });
}

/** Removes a post (and reposts of it) from every cached list; detail queries for it are dropped. */
export function removePostEverywhere(qc: QueryClient, id: string) {
  const keep = (p: Post) => p.id !== id && !(p.body === '' && p.quote?.id === id);
  qc.setQueriesData({ predicate: (q) => POST_CONTAINING_ROOTS.has(String(q.queryKey[0])) && q.queryKey[0] !== 'post' }, (data: unknown) => {
    if (!data) return data;
    if (isInfinite(data)) return { ...data, pages: data.pages.map((pg) => ({ ...pg, items: pg.items.filter(keep) })) };
    if (isSearch(data)) return { ...data, posts: data.posts.filter(keep) };
    return data;
  });
  qc.removeQueries({ queryKey: ['post', id], exact: true });
}

/** Snapshot every post-containing query so an optimistic change can be rolled back. */
export function snapshotPosts(qc: QueryClient) {
  return qc.getQueriesData({ predicate: (q) => POST_CONTAINING_ROOTS.has(String(q.queryKey[0])) });
}

export function restoreSnapshot(qc: QueryClient, snap: ReturnType<typeof snapshotPosts>) {
  for (const [key, data] of snap) qc.setQueryData(key, data);
}

/** The post that a feed row represents: for a plain repost (empty body + quote), the original. */
export function displayedPost(p: Post): { post: Post; repostedBy: Post['author'] | null } {
  if (p.body === '' && p.quote && p.media.length === 0) return { post: p.quote, repostedBy: p.author };
  return { post: p, repostedBy: null };
}
