/**
 * Sweep 2026-09-28 row 16 — a repeating entry showed only on its first date.
 *
 * Driven through the real data hook with a mocked gateway: the hook must ask
 * for series that began before the window, and draw every date a series falls
 * on inside it — on the house's own calendar days, whatever zone the browser
 * is in. This file runs west of Greenwich on purpose: the shared expander read
 * `YYYY-MM-DD` as UTC midnight and back with local getters, which moved every
 * occurrence a day early here.
 */
process.env.TZ = 'America/Los_Angeles';

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../../services/api/client', () => ({
  apiClient: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r-1' }),
}));
vi.mock('../../../contexts/RealtimeContext', () => ({
  useCalendarEventsSubscription: () => {},
}));
vi.mock('../../../services/api/providers', () => ({ fetchProviders: async () => [] }));
vi.mock('../../../hooks/queries/useOrderQueries', () => ({
  useOrders: () => ({ data: [], isError: false, isLoading: false }),
}));

import { useCalendarNextData } from './useCalendarNextData';

const base = {
  restaurantId: 'r-1',
  eventType: 'meeting',
  allDay: true,
  source: 'manual',
  status: 'pending',
  reminderEnabled: false,
  reminderDaysBefore: 1,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

let rows: unknown[] = [];

beforeEach(() => {
  rows = [];
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/calendar/events')) return { data: { events: rows, total: rows.length, hasMore: false } };
    if (url.startsWith('/calendar/event-types')) return { data: [] };
    return { data: null };
  });
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** September 2026, month view: the grid spans 2026-08-31 .. 2026-10-04. */
const cursor = new Date(2026, 8, 15, 12);

describe('useCalendarNextData — repeating entries (sweep row 16)', () => {
  it('runs west of Greenwich', () => {
    expect(new Date(2026, 8, 7).getTimezoneOffset()).toBeGreaterThan(0);
  });

  it('asks the gateway for series that began before the window', async () => {
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.hasEvents).toBe(true));
    const url = get.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/calendar/events'))!;
    expect(url).toContain('includeEarlierSeries=true');
  });

  it('draws a weekly Monday series that began in August on every Monday of the window', async () => {
    rows = [
      {
        ...base,
        id: 'ev-mon',
        title: 'Cellar count',
        eventDate: '2026-08-03', // a Monday, before the window
        isRecurring: true,
        recurrenceRule: { id: 'rule-1', frequency: 'weekly', interval: 1, daysOfWeek: [1], endType: 'never' },
      },
    ];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.events.length).toBeGreaterThan(0));
    expect(result.current.events.map((e) => e.date)).toEqual([
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
    ]);
    for (const e of result.current.events) {
      expect(e.seriesId).toBe('ev-mon');
      expect(e.isOccurrence).toBe(true);
    }
    expect(result.current.unexpandedSeries).toEqual([]);
  });

  it('honours interval, count and end date on house calendar days', async () => {
    rows = [
      {
        ...base,
        id: 'ev-fortnight',
        title: 'Fortnightly tasting',
        eventDate: '2026-09-02', // Wednesday
        isRecurring: true,
        recurrenceRule: { id: 'r2', frequency: 'weekly', interval: 2, endType: 'after_count', endAfterCount: 2 },
      },
      {
        ...base,
        id: 'ev-daily',
        title: 'Walk-in temp log',
        eventDate: '2026-09-28',
        isRecurring: true,
        recurrenceRule: { id: 'r3', frequency: 'daily', interval: 1, endType: 'on_date', endOnDate: '2026-09-30' },
      },
    ];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.events.length).toBeGreaterThan(0));
    const by = (id: string) => result.current.events.filter((e) => e.seriesId === id).map((e) => e.date);
    expect(by('ev-fortnight')).toEqual(['2026-09-02', '2026-09-16']);
    expect(by('ev-daily')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
  });

  it('says so when a repeating row came back without its rule — never a quiet single date', async () => {
    rows = [{ ...base, id: 'ev-orphan', title: 'Orphan', eventDate: '2026-09-10', isRecurring: true }];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.events.length).toBe(1));
    expect(result.current.unexpandedSeries).toEqual([
      { id: 'ev-orphan', title: 'Orphan', reason: 'its repeat rule was not returned' },
    ]);
  });
});
