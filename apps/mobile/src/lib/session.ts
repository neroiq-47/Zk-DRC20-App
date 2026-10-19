import { storage } from './storage';
import { create } from 'zustand';
import type { Me, TokenPair } from '@zoko/contracts';

const TOKENS_KEY = 'zoko.tokens';

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

interface SessionState {
  status: 'loading' | 'signedOut' | 'signedIn';
  tokens: StoredTokens | null;
  user: Me | null;
  hydrate: () => Promise<void>;
  setTokens: (pair: TokenPair) => Promise<void>;
  setUser: (user: Me | null) => void;
  signOut: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  tokens: null,
  user: null,
  hydrate: async () => {
    try {
      const raw = await storage.get(TOKENS_KEY);
      const tokens = raw ? (JSON.parse(raw) as StoredTokens) : null;
      set({ tokens, status: tokens ? 'signedIn' : 'signedOut' });
    } catch {
      set({ tokens: null, status: 'signedOut' });
    }
  },
  setTokens: async (pair) => {
    const tokens: StoredTokens = {
      access_token: pair.access_token,
      refresh_token: pair.refresh_token,
      expires_at: Date.now() + pair.expires_in * 1000,
    };
    await storage.set(TOKENS_KEY, JSON.stringify(tokens));
    set({ tokens, status: 'signedIn' });
  },
  setUser: (user) => set({ user }),
  signOut: async () => {
    await storage.remove(TOKENS_KEY);
    set({ tokens: null, user: null, status: 'signedOut' });
  },
}));
