/**
 * r41 recipes audit, gap 1: /cocktails mounts the cellar's data hook, which
 * read the whole wine library (500 rows of every column), the house inventory
 * (re-read every minute) and the vendors, and the cocktail register showed
 * none of them. The book is now read only where it is drawn: the overview and
 * the wine register. These count the requests through the real hooks and the
 * real client contract (`apiClient`), not through mocked hooks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, isAuthenticated: true }),
}));
vi.mock('../../../lib/offline-storage', () => ({
  offlineStorage: {
    cacheEntity: () => Promise.resolve(),
    markSynced: () => Promise.resolve(),
    getCachedEntity: () => Promise.resolve(null),
  },
}));
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: (...args: unknown[]) => api.get(...args) },
}));

import { drawsTheBook, useCellarNextData } from './useCellarNextData';
import type { RegisterId } from './cellar-format';

/** The three house-wide reads the cocktail register never shows. */
const BOOK = (path: string) =>
  path === '/wines' || path.startsWith('/inventory/') || path.startsWith('/providers');

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Every GET the hook sent for a register, once the first wave has gone out. */
async function readsFor(open: RegisterId | null | undefined): Promise<string[]> {
  api.get.mockReset();
  api.get.mockResolvedValue({ data: [] });
  const view = renderHook(() => (open === undefined ? useCellarNextData() : useCellarNextData(open)), { wrapper });
  await new Promise((r) => setTimeout(r, 30));
  view.unmount();
  return api.get.mock.calls.map(([p]) => String(p));
}

beforeEach(() => api.get.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('the cellar reads the wine book only where it draws it', () => {
  it('/cocktails reads no wine library, no inventory and no vendors', async () => {
    const reads = await readsFor('cocktails');
    expect(reads.filter(BOOK)).toEqual([]);
  });

  it('the wine register still reads all three', async () => {
    const reads = await readsFor('wines');
    expect(reads.some((p) => p === '/wines')).toBe(true);
    expect(reads.some((p) => p === '/inventory/r1')).toBe(true);
    expect(reads.some((p) => p.startsWith('/providers?'))).toBe(true);
  });

  it('the overview, and a caller that names no register, read all three', async () => {
    for (const open of [null, undefined] as const) {
      const reads = await readsFor(open);
      expect(reads.filter(BOOK).map((p) => p.split('?')[0])).toEqual(
        expect.arrayContaining(['/wines', '/inventory/r1', '/providers']),
      );
    }
  });

  it('a /cocktails mount sends three fewer requests than the overview', async () => {
    const overview = await readsFor(null);
    const cocktails = await readsFor('cocktails');
    expect(overview.length - cocktails.length).toBe(3);
  });

  it('only the overview and the wine register draw the book', () => {
    const all: RegisterId[] = ['wines', 'beer', 'whiskey', 'spirits', 'cocktails', 'non_alcoholic', 'soft_drinks'];
    expect(all.filter(drawsTheBook)).toEqual(['wines']);
    expect(drawsTheBook(null)).toBe(true);
  });

  it('/cocktails does not listen for stock moves, so a sale does not re-render it', async () => {
    api.get.mockResolvedValue({ data: [] });
    const add = vi.spyOn(window, 'addEventListener');
    const view = renderHook(() => useCellarNextData('cocktails'), { wrapper });
    const cellarListens = add.mock.calls.filter(([type]) => type === 'inventory_change').length;
    view.unmount();
    add.mockClear();
    const wine = renderHook(() => useCellarNextData('wines'), { wrapper });
    const wineListens = add.mock.calls.filter(([type]) => type === 'inventory_change').length;
    wine.unmount();
    // The wine register adds the live listener and useInventory's own one.
    expect(wineListens - cellarListens).toBe(1);
  });
});
