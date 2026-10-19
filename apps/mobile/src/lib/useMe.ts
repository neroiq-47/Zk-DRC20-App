import { useQuery } from '@tanstack/react-query';
import type { Me } from '@zoko/contracts';
import { api } from './api';
import { useSession } from './session';

export const meKey = ['me'] as const;

export function useMe() {
  const status = useSession((s) => s.status);
  const setUser = useSession((s) => s.setUser);
  return useQuery({
    queryKey: meKey,
    enabled: status === 'signedIn',
    queryFn: async () => {
      const me = await api<Me>('/users/me');
      setUser(me);
      return me;
    },
  });
}
