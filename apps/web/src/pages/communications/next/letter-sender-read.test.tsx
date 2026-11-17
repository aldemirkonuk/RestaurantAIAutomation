/**
 * Mail's tab, the composer and the composer's send standing read the house's
 * sender through one definition (r41 mail gap 11). One request answers all
 * three, and no other file spells the cache key by hand.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: { get: h.get } }));
vi.mock('../../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../contexts/AuthContext')>()),
  useAuth: () => ({ activeRestaurantId: 'r1', user: { restaurantId: 'r1' } }),
}));

import { useMailSender } from './useMailData';
import { useLetterSenderStanding } from './Compose/useComposeData';
import { letterSenderKey } from './letter-sender-read';

describe('the sender read is defined once', () => {
  it('Mail and the composer standing share one request and one cache entry', async () => {
    h.get.mockResolvedValue({ data: { sendable: true, sendOrAsk: { readable: true, maySend: true } } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const mail = renderHook(() => useMailSender(false), { wrapper: wrap });
    const standing = renderHook(() => useLetterSenderStanding(), { wrapper: wrap });
    await waitFor(() => expect(mail.result.current.data).toBeTruthy());
    await waitFor(() => expect(standing.result.current.canRelease).toBe(true));
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(letterSenderKey('r1'))).toBeTruthy();
  });

  it('only letter-sender-read.ts spells the cache key', () => {
    const root = join(__dirname, '..', '..', '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && readFileSync(p, 'utf8').includes("'house-letter-sender'")) hits.push(n);
      }
    };
    walk(root);
    expect(hits).toEqual(['letter-sender-read.ts']);
  });
});
