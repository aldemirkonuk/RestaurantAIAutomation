/**
 * INV-W28 — the page's side reads. Each one that does not answer is named with
 * what it leaves unread, and one call reads every failed one again; when all
 * answer, nothing is named. The page's own words for these live in
 * InventoryNext.test.tsx; this file holds the hook's list.
 */
import { AxiosError } from 'axios';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const m = vi.hoisted(() => ({
  winesError: false,
  winesPending: false,
  role: 'owner' as string,
  locationsLoading: false,
  items: [] as Array<Record<string, unknown>>,
  winesRefetch: vi.fn(),
  listRefetch: vi.fn(),
  locationsUnavailable: false,
  currency: vi.fn(),
  advice: vi.fn(),
  docs: vi.fn(),
  deliveries: vi.fn(),
  providers: { data: [], isError: false } as Record<string, unknown>,
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', activeRole: m.role, user: null, availableRestaurants: [], loading: false }),
}));
vi.mock('../../../hooks/queries/useInventoryQueries', () => ({
  useInventory: () => ({ data: m.items, isError: false, refetch: m.listRefetch }),
}));
vi.mock('../../../hooks/queries/useWineQueries', () => ({
  useWinesByIds: () => ({
    data: m.winesError || m.winesPending ? undefined : [],
    isError: m.winesError,
    isPending: m.winesPending,
    isSuccess: !m.winesError && !m.winesPending,
    refetch: m.winesRefetch,
  }),
}));
vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useProviders: () => m.providers,
}));
vi.mock('../../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => ({
    locations: [],
    locationsLoading: m.locationsLoading,
    locationsUnavailable: m.locationsUnavailable,
    setLocations: vi.fn(),
  }),
}));
vi.mock('../../../services/api/settings', () => ({ settingsApi: { houseCurrency: m.currency } }));
vi.mock('../../../services/api/pricing', () => ({ getPriceAdvice: m.advice }));
vi.mock('../../../services/api/documents', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  documentsApi: { list: m.docs },
}));
vi.mock('../../../services/api/orders', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchDeliveriesToName: m.deliveries,
}));
vi.mock('../../../lib/spotCountOutbox', () => ({
  pendingSpotCountCount: vi.fn(async () => 0),
  watchSpotCountOutbox: () => () => undefined,
}));

import { useInventoryNextData } from './useInventoryNextData';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { ...renderHook(() => useInventoryNextData(), { wrapper }), invalidate };
}

beforeEach(() => {
  m.winesError = false;
  m.locationsUnavailable = false;
  m.winesPending = false;
  m.locationsLoading = false;
  m.role = 'owner';
  m.items = [];
  m.providers = { data: [], isError: false };
  for (const f of [m.winesRefetch, m.listRefetch, m.currency, m.advice, m.docs, m.deliveries]) f.mockReset();
  m.currency.mockResolvedValue({ readable: true, code: 'EUR' });
  m.advice.mockResolvedValue({ wines: [], target: { set: false }, locks: { readable: true } });
  m.docs.mockResolvedValue([]);
  m.deliveries.mockResolvedValue({ deliveries: [] });
});

describe('useInventoryNextData — the vendor book failure in house words (INV-W31)', () => {
  it('says why the vendor book could not be read without the transport text', () => {
    m.providers = { data: undefined, isError: true, error: new AxiosError('Network Error', 'ERR_NETWORK', undefined, {}, undefined) };
    const { result } = mount();
    expect(result.current.providers.error).toBe('no answer came back');
  });

  it('says why the price advice could not be read, for the hover on "advice unavailable"', async () => {
    const response = { status: 500, statusText: '', headers: {}, config: { headers: {} }, data: { message: 'relation "price_locks" does not exist' } };
    m.advice.mockRejectedValue(new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE', undefined, {}, response as never));
    const { result } = mount();
    await waitFor(() => expect(result.current.advice.status).toBe('error'), { timeout: 4000 });
    const advice = result.current.advice as { message: string };
    expect(advice.message).toBe('the price advice could not be read — the server failed before it could answer');
  });
});

describe('useInventoryNextData — side reads that did not answer (INV-W28)', () => {
  it('names each read still in flight as pending, never as answered', async () => {
    m.currency.mockReturnValue(new Promise(() => undefined));
    m.advice.mockReturnValue(new Promise(() => undefined));
    m.docs.mockReturnValue(new Promise(() => undefined));
    m.deliveries.mockReturnValue(new Promise(() => undefined));
    m.winesPending = true;
    m.locationsLoading = true;
    m.items = [{ id: 'i1', restaurantId: 'r1', wineId: 'w1', wineName: 'Barolo', stockLive: 2 }];
    const { result } = mount();
    expect(result.current.pending).toEqual([
      'the wine library',
      'the storage locations',
      'the house’s currency',
      'the price advice',
      'the invoices waiting for a match',
      'the delivered lines waiting for their item',
    ]);
    expect(result.current.unread).toEqual([]);
    expect(result.current.libraryAnswered).toBe(false);
  });

  it('names nothing when every read answered', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.advice.status).toBe('ready'));
    await waitFor(() => expect(result.current.waiting.deliveries.n).toBe(0));
    expect(result.current.currency.state).toBe('recorded');
    expect(result.current.unread).toEqual([]);
    expect(result.current.pending).toEqual([]);
  });

  it('names a failed selling-pace join and reads the stock again for it (INV-W29)', async () => {
    m.items = [
      { id: 'i1', restaurantId: 'r1', wineId: 'w1', wineName: 'Barolo', stockLive: 2, analyticsReadable: false, deadStock: false },
    ];
    const { result } = mount();
    await waitFor(() => expect(result.current.advice.status).toBe('ready'));
    expect(result.current.paceUnread).toBe(true);
    expect(result.current.unread).toContain('the selling pace, so pace, runway and dead stock show —');
    act(() => result.current.rereadUnread());
    expect(m.listRefetch).toHaveBeenCalledTimes(1);
  });

  it('names the pace when even one row could not read it, since the dead count would undercount', async () => {
    m.items = [
      { id: 'i1', restaurantId: 'r1', wineId: 'w1', wineName: 'Barolo', stockLive: 2, analyticsReadable: true },
      { id: 'i2', restaurantId: 'r1', wineId: 'w2', wineName: 'Soave', stockLive: 4, analyticsReadable: false },
    ];
    const { result } = mount();
    await waitFor(() => expect(result.current.advice.status).toBe('ready'));
    expect(result.current.paceUnread).toBe(true);
  });

  it('does not name the pace when it was read', async () => {
    m.items = [{ id: 'i1', restaurantId: 'r1', wineId: 'w1', wineName: 'Barolo', stockLive: 2, analyticsReadable: true }];
    const { result } = mount();
    await waitFor(() => expect(result.current.advice.status).toBe('ready'));
    expect(result.current.paceUnread).toBe(false);
    act(() => result.current.rereadUnread());
    expect(m.listRefetch).not.toHaveBeenCalled();
  });

  it('does not wait on price advice for staff, who are never asked it', async () => {
    m.role = 'staff';
    const { result } = mount();
    await waitFor(() => expect(result.current.waiting.deliveries.n).toBe(0));
    await waitFor(() => expect(result.current.currency.state).toBe('recorded'));
    expect(m.advice).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual([]);
  });

  it('does not wait on a library with nothing to ask (no wine ids, so the query never runs)', async () => {
    m.winesPending = true; // a disabled query stays pending for ever
    const { result } = mount();
    await waitFor(() => expect(result.current.advice.status).toBe('ready'));
    expect(result.current.pending).not.toContain('the wine library');
    expect(result.current.libraryAnswered).toBe(true);
  });

  it('names each failed read, in order, with what it leaves unread', async () => {
    m.winesError = true;
    m.locationsUnavailable = true;
    m.currency.mockRejectedValue(new Error('500'));
    m.advice.mockResolvedValue({}); // a shape the page cannot read is a failed read too
    m.docs.mockRejectedValue(new Error('500'));
    m.deliveries.mockRejectedValue(new Error('500'));
    const { result } = mount();
    await waitFor(() => expect(result.current.unread).toHaveLength(6));
    expect(result.current.unread).toEqual([
      'the wine library, so type shows —, the type filter is off, and grapes are left out of details and search',
      'the storage locations, so zones show — and the zone filter is off',
      'the house’s currency',
      'the price advice',
      'the invoices waiting for a match',
      'the delivered lines waiting for their item',
    ]);
  });

  it('reads every failed one again, and only those', async () => {
    m.winesError = true;
    m.locationsUnavailable = true;
    m.currency.mockRejectedValue(new Error('500'));
    m.advice.mockResolvedValue({});
    m.docs.mockRejectedValue(new Error('500'));
    const { result, invalidate } = mount();
    await waitFor(() => expect(result.current.unread).toHaveLength(5));
    const before = { currency: m.currency.mock.calls.length, advice: m.advice.mock.calls.length, docs: m.docs.mock.calls.length, deliveries: m.deliveries.mock.calls.length };
    act(() => result.current.rereadUnread());
    expect(m.winesRefetch).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['storageLocations', 'r1'] });
    await waitFor(() => expect(m.currency.mock.calls.length).toBe(before.currency + 1));
    await waitFor(() => expect(m.advice.mock.calls.length).toBe(before.advice + 1));
    await waitFor(() => expect(m.docs.mock.calls.length).toBe(before.docs + 1));
    // The delivered lines answered, so they are not read again.
    expect(m.deliveries.mock.calls.length).toBe(before.deliveries);
  });
});
