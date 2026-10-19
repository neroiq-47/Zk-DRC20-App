import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import type { Page, Post, ReportReason, ReportRequest, Report } from '@zoko/contracts';
import { api } from '@/lib/api';
import { postKeys, type FeedKind, type UserPostsFilter } from './keys';
import { removePostEverywhere, restoreSnapshot, snapshotPosts, updatePostEverywhere } from './cache';

const PAGE_SIZE = 20;

/** Cursor-paginated list helper over `Page<T>` endpoints. */
export function useInfiniteList<T>(queryKey: QueryKey, path: string, query?: Record<string, string | undefined>, enabled = true) {
  const q = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => api<Page<T>>(path, { query: { ...query, limit: PAGE_SIZE, cursor: pageParam ?? undefined }, signal }),
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return {
    ...q,
    items,
    loadMore: () => {
      if (q.hasNextPage && !q.isFetchingNextPage && !q.isError) void q.fetchNextPage();
    },
  };
}

export function useFeed(kind: FeedKind) {
  return useInfiniteList<Post>(postKeys.feed(kind), kind === 'following' ? '/feed' : '/feed/discover');
}

export function useUserPosts(handle: string, filter: UserPostsFilter) {
  return useInfiniteList<Post>(postKeys.userPosts(handle, filter), `/users/${encodeURIComponent(handle)}/posts`, { filter }, !!handle);
}

export function useBookmarks() {
  return useInfiniteList<Post>(postKeys.bookmarks(), '/users/me/bookmarks');
}

export function useReplies(id: string) {
  return useInfiniteList<Post>(postKeys.replies(id), `/posts/${id}/replies`, undefined, !!id);
}

export function usePost(id: string | undefined) {
  return useQuery({
    queryKey: postKeys.post(id ?? ''),
    enabled: !!id,
    queryFn: ({ signal }) => api<Post>(`/posts/${id}`, { signal }),
  });
}

type Toggle = { post: Post; next: boolean };

function useOptimisticToggle(
  path: (id: string) => string,
  apply: (p: Post, next: boolean) => Post,
  onSettledExtra?: (qc: ReturnType<typeof useQueryClient>, v: Toggle) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ post, next }: Toggle) => api<unknown>(path(post.id), { method: next ? 'POST' : 'DELETE' }),
    onMutate: async ({ post, next }) => {
      await qc.cancelQueries({ predicate: (q) => ['feed', 'post', 'replies', 'userPosts', 'bookmarks', 'search'].includes(String(q.queryKey[0])) });
      const snap = snapshotPosts(qc);
      updatePostEverywhere(qc, post.id, (p) => apply(p, next));
      return { snap };
    },
    onError: (_e, _v, ctx) => {
      if (ctx) restoreSnapshot(qc, ctx.snap);
    },
    onSettled: (_d, _e, v) => onSettledExtra?.(qc, v),
  });
}

const bump = (n: number, next: boolean) => Math.max(0, n + (next ? 1 : -1));

export function useLike() {
  return useOptimisticToggle(
    (id) => `/posts/${id}/like`,
    (p, next) => (p.liked_by_me === next ? p : { ...p, liked_by_me: next, like_count: bump(p.like_count, next) }),
  );
}

export function useBookmark() {
  return useOptimisticToggle(
    (id) => `/posts/${id}/bookmark`,
    (p, next) => (p.bookmarked_by_me === next ? p : { ...p, bookmarked_by_me: next }),
    (qc) => qc.invalidateQueries({ queryKey: postKeys.bookmarks() }),
  );
}

export function useRepost() {
  return useOptimisticToggle(
    (id) => `/posts/${id}/repost`,
    (p, next) => (p.reposted_by_me === next ? p : { ...p, reposted_by_me: next, repost_count: bump(p.repost_count, next) }),
    (qc) => qc.invalidateQueries({ queryKey: postKeys.feed('following') }),
  );
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (post: Post) => api<void>(`/posts/${post.id}`, { method: 'DELETE' }),
    onSuccess: (_d, post) => {
      removePostEverywhere(qc, post.id);
      if (post.parent_id) {
        updatePostEverywhere(qc, post.parent_id, (p) => ({ ...p, reply_count: Math.max(0, p.reply_count - 1) }));
      }
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useReport() {
  return useMutation({
    mutationFn: (req: ReportRequest) => api<Report>('/reports', { method: 'POST', body: req }),
  });
}

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Something else' },
];

/** Prepends a freshly created post to the matching cached lists so it shows immediately. */
export function prependToList(qc: ReturnType<typeof useQueryClient>, key: QueryKey, post: Post) {
  qc.setQueryData<InfiniteData<Page<Post>>>(key, (data) => {
    if (!data || data.pages.length === 0) return data;
    const [first, ...rest] = data.pages;
    if (first.items.some((p) => p.id === post.id)) return data;
    return { ...data, pages: [{ ...first, items: [post, ...first.items] }, ...rest] };
  });
}
