import type { InfiniteData } from '@tanstack/react-query';
import type { Page, Transfer } from '@zoko/contracts';

export const walletKeys = {
  providers: ['wallet', 'providers'] as const,
  connections: ['wallet', 'connections'] as const,
  assets: ['wallet', 'assets'] as const,
  transfers: ['transfers'] as const,
  transfer: (id: string) => ['transfer', id] as const,
  signing: (id: string) => ['transfer-signing', id] as const,
};

export type TransferPages = InfiniteData<Page<Transfer>, string | null>;

export function upsertTransferInPages(data: TransferPages | undefined, t: Transfer): TransferPages | undefined {
  if (!data || !data.pages.length) return data;
  let found = false;
  const pages = data.pages.map((p) => ({
    ...p,
    items: p.items.map((x) => {
      if (x.id === t.id) {
        found = true;
        return t;
      }
      return x;
    }),
  }));
  if (!found) pages[0] = { ...pages[0], items: [t, ...pages[0].items] };
  return { ...data, pages };
}
