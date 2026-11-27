/**
 * perf-p1-5 — the composer's four letter reads (sender, book, templates,
 * queued) are keyed on the house. Asked before the session had named the
 * house they went out under the '' key and again under the real one: two
 * requests per path on a cold /communications load.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({ get: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('../../../../services/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => h.get(...a) },
}));
vi.mock('../../../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../contexts/AuthContext')>()),
  useAuth: () => h.auth,
}));

import { useComposeData } from './useComposeData';

const PATHS = ['letters/sender', 'letters/book', 'letters/templates', 'letters/queued'];

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const asked = (p: string) => h.get.mock.calls.filter((c) => String(c[0]).includes(p)).length;

beforeEach(() => {
  h.get.mockReset();
  h.get.mockResolvedValue({ data: { entries: [], templates: [], queued: [], insights: [] } });
});

describe('useComposeData asks each letter read once', () => {
  it('asks nothing before the house is known, then once per path', async () => {
    h.auth = { user: null, activeRestaurantId: null };
    const { rerender } = renderHook(() => useComposeData(), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 20));
    for (const p of PATHS) expect(asked(p)).toBe(0);

    h.auth = { user: { restaurantId: 'R1' }, activeRestaurantId: 'R1' };
    rerender();
    await waitFor(() => {
      for (const p of PATHS) expect(asked(p)).toBe(1);
    });
  });
});
