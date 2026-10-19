export type FeedKind = 'following' | 'discover';
export type UserPostsFilter = 'posts' | 'replies' | 'media';

export const postKeys = {
  feed: (kind: FeedKind) => ['feed', kind] as const,
  post: (id: string) => ['post', id] as const,
  replies: (id: string) => ['replies', id] as const,
  userPosts: (handle: string, filter: UserPostsFilter) => ['userPosts', handle, filter] as const,
  bookmarks: () => ['bookmarks'] as const,
  search: (q: string) => ['search', q] as const,
};

/** Root keys of every query whose data contains Post objects. */
export const POST_CONTAINING_ROOTS = new Set(['feed', 'post', 'replies', 'userPosts', 'bookmarks', 'search']);
