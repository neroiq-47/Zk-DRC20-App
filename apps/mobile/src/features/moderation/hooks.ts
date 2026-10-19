import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { ModerationActionRequest, ModerationReport, Page, Report, ReportRequest } from '@zoko/contracts';
import { api } from '@/lib/api';

export const moderationKeys = { open: ['moderation', 'reports', 'open'] as const };

export function useCreateReport() {
  return useMutation({
    mutationFn: (body: ReportRequest) => api<Report>('/reports', { method: 'POST', body }),
  });
}

export function useModerationQueue(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: moderationKeys.open,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api<Page<ModerationReport>>('/moderation/reports', { query: { status: 'open', cursor: pageParam, limit: 30 }, signal }),
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useModerationAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ModerationActionRequest & { id: string }) =>
      api<ModerationReport>(`/moderation/reports/${id}/actions`, { method: 'POST', body }),
    onSuccess: (report) => {
      // Resolved reports leave the open queue.
      qc.setQueryData<InfiniteData<Page<ModerationReport>, string | null>>(moderationKeys.open, (d) =>
        d
          ? {
              ...d,
              pages: d.pages.map((p) => ({
                ...p,
                items: report.status === 'open' ? p.items.map((r) => (r.id === report.id ? report : r)) : p.items.filter((r) => r.id !== report.id),
              })),
            }
          : d,
      );
    },
  });
}
