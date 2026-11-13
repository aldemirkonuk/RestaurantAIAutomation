/**
 * /calendar read its orders from the orders book's newest 50, and drew only
 * the first 500 entries of a window. Both made the page's counts short without
 * saying so: a delivery linked to an older order read "order not in the book"
 * and never ruled off, and a busy 90-day agenda counted only its first page.
 *
 * Driven through the real data hook with a mocked gateway.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const get = vi.hoisted(() => vi.fn());
const ordersSub = vi.hoisted(() => ({ cb: null as null | (() => void) }));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r-1' }),
}));
vi.mock('../../../contexts/RealtimeContext', () => ({
  useCalendarEventsSubscription: () => {},
  useOrdersSubscription: (cb: () => void) => {
    ordersSub.cb = cb;
  },
}));
vi.mock('../../../services/api/providers', () => ({ fetchProviders: async () => [] }));

import {
  EVENT_WINDOW_MAX_PAGES,
  orderStateWords,
  useCalendarNextData,
} from './useCalendarNextData';

const ev = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  restaurantId: 'r-1',
  title: `Entry ${id}`,
  eventType: 'delivery',
  eventDate: '2026-09-17',
  allDay: true,
  source: 'manual',
  status: 'pending',
  reminderEnabled: false,
  reminderDaysBefore: 1,
  isRecurring: false,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  ...over,
});

type Page = Record<string, unknown>;
let pages: Page[] = [];

function pageOf(url: string): number {
  return Number(new URL(url, 'http://x').searchParams.get('page') ?? '1');
}

beforeEach(() => {
  pages = [];
  ordersSub.cb = null;
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/calendar/events')) return { data: pages[pageOf(url) - 1] ?? { events: [] } };
    if (url.startsWith('/calendar/event-types')) return { data: [] };
    return { data: null };
  });
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const cursor = new Date(2026, 8, 15, 12);
const eventUrls = () =>
  get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/calendar/events'));

describe('useCalendarNextData — linked orders come with the window', () => {
  it('never reads the orders book list, and asks the calendar for its linked orders', async () => {
    pages = [{ events: [], total: 0, hasMore: false, linkedOrders: [], linkedOrdersReadable: true }];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.hasEvents).toBe(true));
    expect(eventUrls()[0]).toContain('withOrders=true');
    expect(get.mock.calls.some((c) => String(c[0]).startsWith('/procurement/orders'))).toBe(false);
  });

  it('rules off a delivery whose linked order arrived, however old the order', async () => {
    pages = [
      {
        events: [ev('e1', { orderId: 'o-old' }), ev('e2', { orderId: 'o-moving' })],
        total: 2,
        hasMore: false,
        linkedOrders: [
          { id: 'o-old', orderNumber: 'PO-0001', status: 'DELIVERED' },
          { id: 'o-moving', orderNumber: 'PO-0900', status: 'IN_TRANSIT' },
        ],
        linkedOrdersReadable: true,
      },
    ];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.hasEvents).toBe(true));
    expect(result.current.ordersKnown).toBe(true);
    const [a, b] = result.current.events;
    expect(result.current.isRuledOff(a)).toBe(true);
    expect(result.current.isRuledOff(b)).toBe(false);
    expect(result.current.ordersById?.get('o-old')?.orderNumber).toBe('PO-0001');
  });

  it('keeps the orders unknown — never "not in the book" — when the orders read failed', async () => {
    pages = [
      {
        events: [ev('e1', { orderId: 'o-1' })],
        total: 1,
        hasMore: false,
        linkedOrders: [],
        linkedOrdersReadable: false,
      },
    ];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.hasEvents).toBe(true));
    expect(result.current.ordersKnown).toBe(false);
    expect(result.current.ordersById).toBeNull();
    expect(result.current.isRuledOff(result.current.events[0])).toBe(false);
  });

  it('still draws the entries from a gateway that does not know withOrders yet', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/calendar/events')) {
        if (url.includes('withOrders')) throw Object.assign(new Error('400'), { response: { status: 400 } });
        return { data: { events: [ev('e1', { orderId: 'o-1' })], total: 1, hasMore: false } };
      }
      return { data: [] };
    });
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.hasEvents).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.events).toHaveLength(1);
    expect(result.current.ordersKnown).toBe(false);
  });

  it('does not retry a refusal that is not about withOrders', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/calendar/events')) throw Object.assign(new Error('500'), { response: { status: 500 } });
      return { data: [] };
    });
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(eventUrls()).toHaveLength(1);
  });

  it('refreshes the window when an order moves', async () => {
    pages = [{ events: [], total: 0, hasMore: false, linkedOrders: [], linkedOrdersReadable: true }];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.hasEvents).toBe(true));
    const before = eventUrls().length;
    ordersSub.cb?.();
    await waitFor(() => expect(eventUrls().length).toBeGreaterThan(before));
  });
});

describe('useCalendarNextData — the whole window, not its first page', () => {
  it('reads every page of a window past 500 entries and counts them all', async () => {
    const all = Array.from({ length: 1203 }, (_, i) => ev(`e${String(i).padStart(4, '0')}`));
    pages = [0, 1, 2].map((p) => ({
      events: all.slice(p * 500, p * 500 + 500),
      total: all.length,
      hasMore: p < 2,
      linkedOrders: [],
      linkedOrdersReadable: true,
    }));
    const { result } = renderHook(() => useCalendarNextData('agenda', cursor), { wrapper });
    await waitFor(() => expect(result.current.hasEvents).toBe(true));
    expect(eventUrls().map(pageOf).sort()).toEqual([1, 2, 3]);
    expect(result.current.events).toHaveLength(1203);
    expect(result.current.truncated).toBe(false);
    expect(result.current.windowTotal).toBe(1203);
  });

  it('draws a row that two pages both returned once', async () => {
    // A row written between two page reads can shift the boundary by one.
    pages = [
      { events: [ev('a'), ev('b')], total: 501, hasMore: true, linkedOrders: [], linkedOrdersReadable: true },
      { events: [ev('b'), ev('c')], total: 501, hasMore: false, linkedOrders: [], linkedOrdersReadable: true },
    ];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.hasEvents).toBe(true));
    expect(eventUrls()).toHaveLength(2);
    expect(result.current.events.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('stops at the read cap and says the window is partial', async () => {
    const total = EVENT_WINDOW_MAX_PAGES * 500 + 7;
    pages = Array.from({ length: EVENT_WINDOW_MAX_PAGES + 1 }, (_, p) => ({
      events: Array.from({ length: p === EVENT_WINDOW_MAX_PAGES ? 7 : 500 }, (_, i) => ev(`p${p}-${i}`)),
      total,
      hasMore: p < EVENT_WINDOW_MAX_PAGES,
      linkedOrders: [],
      linkedOrdersReadable: true,
    }));
    const { result } = renderHook(() => useCalendarNextData('agenda', cursor), { wrapper });
    await waitFor(() => expect(result.current.hasEvents).toBe(true));
    expect(eventUrls()).toHaveLength(EVENT_WINDOW_MAX_PAGES);
    expect(result.current.truncated).toBe(true);
    expect(result.current.windowRead).toBe(EVENT_WINDOW_MAX_PAGES * 500);
    expect(result.current.windowTotal).toBe(total);
  });

  it('counts a page that could not read the orders as orders unknown for the whole window', async () => {
    pages = [
      { events: [ev('a')], total: 501, hasMore: true, linkedOrders: [], linkedOrdersReadable: true },
      { events: [ev('b', { orderId: 'o-1' })], total: 501, hasMore: false, linkedOrders: [], linkedOrdersReadable: false },
    ];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.hasEvents).toBe(true));
    expect(result.current.ordersKnown).toBe(false);
  });
});

describe('orderStateWords', () => {
  it('says the book\'s codes in words', () => {
    expect(orderStateWords('PARTIALLY_RECEIVED')).toBe('partly arrived');
    expect(orderStateWords('APPROVAL_NEEDED')).toBe('waiting for approval');
    expect(orderStateWords('CONFIRMED')).toBe('sent to the vendor');
    expect(orderStateWords('IN_TRANSIT')).toBe('on the way');
    expect(orderStateWords('PENDING')).toBe('not sent yet');
    expect(orderStateWords('')).toBe('not sent yet');
  });

  it('quotes a state it does not know instead of guessing "not sent yet"', () => {
    expect(orderStateWords('ON_HOLD')).toBe('marked “on hold”');
  });
});
