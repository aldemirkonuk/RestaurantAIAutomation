/**
 * useCellarNextData — the book's pagination (cellar confirmer BLOCKER).
 *
 * "Load 500 more" used to widen a single request's `limit` by one page each
 * press — 500, then 1000 — but `GET /wines` validates `limit` against
 * `WINE_SEARCH_MAX_LIMIT` (500, `wines.dto.ts` `@Max`), so the second press
 * asked for something the gateway refuses and nothing new ever arrived. This
 * goes through the real client contract (`apiClient`), not a mocked hook —
 * the confirmer's own instruction — so a regression back to "widen `limit`"
 * fails here on the actual request shape, not on a rendered string.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, isAuthenticated: true }),
}));
vi.mock('../../../hooks/queries/useInventoryQueries', () => ({
  useInventory: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [], isError: false, error: null }),
}));

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: (...args: unknown[]) => api.get(...args) },
}));

import { BOOK_READ_LIMIT, useCellarNextData } from './useCellarNextData';

/** One wine of the "library" this fake server holds, `n` of them, by offset. */
function page(offset: number, total: number) {
  const start = offset;
  const end = Math.min(offset + BOOK_READ_LIMIT, total);
  const rows = [];
  for (let i = start; i < end; i++) {
    rows.push({ id: `w${i}`, name: `Wine ${i}`, producer: 'Someone', price_reference: 0 });
  }
  return rows;
}

function mockLibraryOf(total: number) {
  api.get.mockImplementation(async (path: string, opts?: { params?: Record<string, unknown> }) => {
    if (path === '/wines') {
      const offset = Number(opts?.params?.offset ?? 0);
      return { data: page(offset, total) };
    }
    // Registers/settings/etc. this hook also reads are irrelevant to the
    // book's pagination and are not this test's subject — a rejected read
    // is a real, handled state (`registersError`) for every one of them.
    throw new Error('not read in this test');
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  api.get.mockReset();
});

describe('useCellarNextData — the book never asks for more than BOOK_READ_LIMIT in one request', () => {
  it('reads the first page at the fixed limit, offset 0', async () => {
    mockLibraryOf(120);
    const { result } = renderHook(() => useCellarNextData(), { wrapper });
    await waitFor(() => expect(result.current.bottles).not.toBeNull());

    const wineCalls = api.get.mock.calls.filter(([p]) => p === '/wines');
    expect(wineCalls).toHaveLength(1);
    const [, opts] = wineCalls[0] as [string, { params: Record<string, unknown> }];
    expect(opts.params.limit).toBe(BOOK_READ_LIMIT);
    expect(opts.params.offset).toBe(0);
    expect(result.current.bottles).toHaveLength(120);
    // Fewer than a full page came back: this genuinely is the whole library.
    expect(result.current.bookTruncated).toBe(false);
  });

  it('a full first page reports truncated, and "load more" pages by OFFSET at the SAME fixed limit — never a widened limit', async () => {
    mockLibraryOf(650); // more than one page of 500
    const { result } = renderHook(() => useCellarNextData(), { wrapper });
    await waitFor(() => expect(result.current.bottles).not.toBeNull());

    expect(result.current.bottles).toHaveLength(BOOK_READ_LIMIT);
    expect(result.current.bookTruncated).toBe(true);
    expect(result.current.bookLimit).toBe(BOOK_READ_LIMIT);

    await act(async () => {
      result.current.loadMoreBook();
    });
    await waitFor(() => expect(result.current.bottles).toHaveLength(650));

    const wineCalls = api.get.mock.calls.filter(([p]) => p === '/wines');
    expect(wineCalls).toHaveLength(2);
    // THE fix, pinned directly: every request's `limit` is the same fixed
    // page size — this is the exact value the gateway's `@Max` accepts, and
    // a regression to "widen limit by one page" changes this assertion, not
    // a rendered "Load more" string.
    for (const [, opts] of wineCalls as [string, { params: Record<string, unknown> }][]) {
      expect(opts.params.limit).toBe(BOOK_READ_LIMIT);
    }
    const offsetsSent = (wineCalls as [string, { params: Record<string, unknown> }][]).map(
      ([, opts]) => opts.params.offset,
    );
    expect(offsetsSent.sort()).toEqual([0, BOOK_READ_LIMIT]);

    // The second, short page (150 of a possible 500) ends the walk.
    expect(result.current.bookTruncated).toBe(false);
    expect(result.current.bookLimit).toBe(650);
  });

  it('"loadingMoreBook" is true only while the SECOND page is in flight, never during the first', async () => {
    mockLibraryOf(650);
    const { result } = renderHook(() => useCellarNextData(), { wrapper });
    await waitFor(() => expect(result.current.bottles).not.toBeNull());
    expect(result.current.loadingMoreBook).toBe(false);

    let resolveSecondPage!: (rows: unknown) => void;
    api.get.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          if (path !== '/wines') throw new Error('not read in this test');
          resolveSecondPage = (rows) => resolve({ data: rows });
        }),
    );

    act(() => {
      result.current.loadMoreBook();
    });
    await waitFor(() => expect(result.current.loadingMoreBook).toBe(true));

    await act(async () => {
      resolveSecondPage(page(BOOK_READ_LIMIT, 650));
    });
    await waitFor(() => expect(result.current.loadingMoreBook).toBe(false));
  });
});
