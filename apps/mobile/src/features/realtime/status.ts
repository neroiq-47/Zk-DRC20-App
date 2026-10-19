import { create } from 'zustand';

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'closed';

export const useRealtimeStatus = create<{ status: SocketStatus; setStatus: (s: SocketStatus) => void }>((set) => ({
  status: 'idle',
  setStatus: (status) => set({ status }),
}));
