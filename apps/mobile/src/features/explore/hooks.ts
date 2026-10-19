import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SearchResults, Trend, UserSummary } from '@zoko/contracts';
import { api } from '@/lib/api';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['search', query],
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api<SearchResults>('/search', { query: { q: query, type: 'all' }, signal }),
  });
}

export function useTrends() {
  return useQuery({
    queryKey: ['trends'],
    queryFn: ({ signal }) => api<{ items: Trend[] }>('/trends', { signal }),
    select: (d) => d.items,
    staleTime: 5 * 60_000,
  });
}

export function useSuggested() {
  return useQuery({
    queryKey: ['suggested'],
    queryFn: ({ signal }) => api<{ items: UserSummary[] }>('/users/suggested', { signal }),
    select: (d) => d.items,
    staleTime: 5 * 60_000,
  });
}
