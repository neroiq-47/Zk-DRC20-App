import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { NotificationPage } from '@zoko/contracts';
import { api } from '@/lib/api';
import { notificationKeys } from './keys';

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.all,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => api<NotificationPage>('/notifications', { query: { cursor: pageParam, limit: 30 }, signal }),
    getNextPageParam: (last) => last.next_cursor,
  });
}

/** Unread count from the first page (for a bell badge). */
export function selectUnreadCount(data: InfiniteData<NotificationPage> | undefined): number {
  return data?.pages[0]?.unread_count ?? 0;
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/notifications/read', { method: 'POST' }),
    onSuccess: () => {
      // Keep row highlights for this visit; only clear the badge count.
      qc.setQueryData<InfiniteData<NotificationPage, string | null>>(notificationKeys.all, (d) =>
        d ? { ...d, pages: d.pages.map((p, i) => (i === 0 ? { ...p, unread_count: 0 } : p)) } : d,
      );
    },
  });
}
