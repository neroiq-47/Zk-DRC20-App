import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Me, UpdateMeRequest, UserSettings } from '@zoko/contracts';
import { api } from '@/lib/api';
import { meKey } from '@/lib/useMe';
import { useSession } from '@/lib/session';

/** PATCH /users/me for settings, with an optimistic update of the cached Me. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  const setUser = useSession((s) => s.setUser);
  return useMutation({
    mutationFn: (settings: Partial<UserSettings>) => api<Me>('/users/me', { method: 'PATCH', body: { settings } satisfies UpdateMeRequest }),
    onMutate: async (settings) => {
      await qc.cancelQueries({ queryKey: meKey });
      const prev = qc.getQueryData<Me>(meKey);
      if (prev) qc.setQueryData<Me>(meKey, { ...prev, settings: { ...prev.settings, ...settings } });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(meKey, ctx.prev);
    },
    onSuccess: (me) => {
      qc.setQueryData(meKey, me);
      setUser(me);
    },
  });
}
