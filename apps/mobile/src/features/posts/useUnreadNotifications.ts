import { useQuery } from '@tanstack/react-query';
import type { NotificationPage } from '@zoko/contracts';
import { api } from '@/lib/api';

/** Unread notification count for the Home bell (uses GET /notifications?limit=1). */
export function useUnreadNotifications() {
  return useQuery({
    queryKey: ['notifications', 'unread-badge'],
    queryFn: ({ signal }) => api<NotificationPage>('/notifications', { query: { limit: 1 }, signal }),
    select: (d) => d.unread_count,
    refetchInterval: 60_000,
  });
}
