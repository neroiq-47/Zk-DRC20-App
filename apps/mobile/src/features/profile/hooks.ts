import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { Conversation, Me, Profile, UpdateMeRequest, UserSummary } from '@zoko/contracts';
import { api } from '@/lib/api';
import { meKey } from '@/lib/useMe';
import { useInfiniteList } from '@/features/posts/hooks';

export type UserListKind = 'followers' | 'following';

export const profileKeys = {
  profile: (handle: string) => ['profile', handle] as const,
  list: (handle: string, kind: UserListKind) => ['userList', handle, kind] as const,
  suggested: () => ['suggested'] as const,
};

export function useProfile(handle: string | undefined) {
  return useQuery({
    queryKey: profileKeys.profile(handle ?? ''),
    enabled: !!handle,
    queryFn: ({ signal }) => api<Profile>(`/users/${encodeURIComponent(handle!)}`, { signal }),
  });
}

export function useUserList(handle: string, kind: UserListKind) {
  return useInfiniteList<UserSummary>(profileKeys.list(handle, kind), `/users/${encodeURIComponent(handle)}/${kind}`, undefined, !!handle);
}

function patchProfile(qc: ReturnType<typeof useQueryClient>, handle: string, fn: (p: Profile) => Profile) {
  qc.setQueryData<Profile>(profileKeys.profile(handle), (p) => (p ? fn(p) : p));
}

/** Follow / unfollow with an optimistic update of the profile header counts. */
export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ handle, next }: { handle: string; next: boolean }) =>
      api<void>(`/users/${encodeURIComponent(handle)}/follow`, { method: next ? 'POST' : 'DELETE' }),
    onMutate: async ({ handle, next }) => {
      await qc.cancelQueries({ queryKey: profileKeys.profile(handle) });
      const prev = qc.getQueryData<Profile>(profileKeys.profile(handle));
      const prevMe = qc.getQueryData<Me>(meKey);
      patchProfile(qc, handle, (p) =>
        p.is_following === next ? p : { ...p, is_following: next, followers_count: Math.max(0, p.followers_count + (next ? 1 : -1)) },
      );
      if (prevMe) qc.setQueryData<Me>(meKey, { ...prevMe, following_count: Math.max(0, prevMe.following_count + (next ? 1 : -1)) });
      return { prev, prevMe };
    },
    onError: (_e, { handle }, ctx) => {
      if (ctx?.prev) qc.setQueryData(profileKeys.profile(handle), ctx.prev);
      if (ctx?.prevMe) qc.setQueryData(meKey, ctx.prevMe);
    },
    onSettled: (_d, _e, { handle }) => {
      qc.invalidateQueries({ queryKey: ['feed', 'following'] });
      qc.invalidateQueries({ queryKey: ['userList', handle] });
      qc.invalidateQueries({ queryKey: meKey });
    },
  });
}

export function useBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ handle, next }: { handle: string; next: boolean }) =>
      api<void>(`/users/${encodeURIComponent(handle)}/block`, { method: next ? 'POST' : 'DELETE' }),
    onSuccess: (_d, { handle, next }) => {
      patchProfile(qc, handle, (p) => ({ ...p, is_blocked: next, is_following: next ? false : p.is_following }));
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: profileKeys.profile(handle) });
    },
  });
}

export function useStartConversation() {
  return useMutation({
    mutationFn: (handle: string) => api<Conversation>('/conversations', { method: 'POST', body: { handle } }),
    onSuccess: (c) => router.push({ pathname: '/chat/[id]', params: { id: c.id } }),
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeRequest) => api<Me>('/users/me', { method: 'PATCH', body }),
    onSuccess: (me) => {
      qc.setQueryData(meKey, me);
      qc.setQueryData(profileKeys.profile(me.handle), me);
      // author summaries embedded in cached posts are refreshed on next fetch
      qc.invalidateQueries({ queryKey: ['userPosts', me.handle] });
    },
  });
}
