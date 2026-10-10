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
const post = vi.hoisted(() => vi.fn());
vi.mock('../../../services/api/client', () => ({
  apiClient: { get, post, patch: vi.fn(), delete: vi.fn() },
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
import { expandSeries } from './expand-series';

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

// F-199: "Every month" from the 29th-31st used to skip the short months. Same
// rule as the gateway's calendar-occurrences.ts.
describe('expandSeries — month-end series', () => {
  const monthly = (date: string, extra: Record<string, unknown> = {}) => ({
    id: 'ev-end',
    date,
    endDate: null,
    isRecurring: true,
    recurrenceRule: { frequency: 'monthly', interval: 1, endType: 'never', ...extra },
  });

  it('falls on the last day of each shorter month', () => {
    const out = expandSeries([monthly('2026-01-31')], '2026-01-01', '2026-05-31');
    expect(out.events.map((e) => e.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('counts a clamped date as one of the times', () => {
    const out = expandSeries([monthly('2027-12-30', { endType: 'after_count', endAfterCount: 3 })], '2027-12-01', '2028-06-30');
    expect(out.events.map((e) => e.date)).toEqual(['2027-12-30', '2028-01-30', '2028-02-29']);
  });

  it('keeps a yearly Feb 29 for leap years', () => {
    const out = expandSeries(
      [{ ...monthly('2024-02-29'), recurrenceRule: { frequency: 'yearly', interval: 1, endType: 'never' } }],
      '2024-01-01',
      '2028-12-31',
    );
    expect(out.events.map((e) => e.date)).toEqual(['2024-02-29', '2028-02-29']);
  });
});

describe('useCalendarNextData — entries that span days (F-198)', () => {
  it('places a multi-day all-day entry on every day it covers', async () => {
    rows = [
      {
        ...base,
        id: 'ev-fest',
        title: 'Harvest festival',
        eventDate: '2026-09-11',
        eventDateEnd: '2026-09-13',
        isRecurring: false,
      },
    ];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.events.length).toBe(1));
    for (const day of ['2026-09-11', '2026-09-12', '2026-09-13']) {
      expect(result.current.byDay.get(day)?.map((e) => e.id)).toEqual(['ev-fest']);
    }
    expect(result.current.byDay.get('2026-09-14')).toBeUndefined();
  });

  it('places an entry that began before the window on the window days it still covers', async () => {
    rows = [
      {
        ...base,
        id: 'ev-long',
        title: 'Terrace closed',
        eventDate: '2026-08-25',
        eventDateEnd: '2026-09-01',
        isRecurring: false,
      },
    ];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.events.length).toBe(1));
    expect([...result.current.byDay.keys()].sort()).toEqual(['2026-08-31', '2026-09-01']);
  });
});

// F-1083: a create that lost its answer may have landed. The sheet's draft key
// goes out as the Idempotency-Key header and never in the body (the gateway's
// `forbidNonWhitelisted` refuses a field it does not know), and the book is
// read again so the person can check it.
describe('useCalendarNextData — a create whose answer was lost (F-1083)', () => {
  const payload = {
    restaurantId: 'r-1',
    title: 'Tasting',
    eventType: 'meeting',
    eventDate: '2026-09-17',
    allDay: true,
  } as never;

  it('sends the draft key as a header, not a field', async () => {
    post.mockReset().mockResolvedValue({ data: { ...base, id: 'ev-1', title: 'Tasting', eventDate: '2026-09-17' } });
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await result.current.create.mutateAsync({ ...(payload as object), writeKey: 'calendar-event:k1' } as never);
    expect(post).toHaveBeenCalledWith('/calendar/events', payload, {
      headers: { 'Idempotency-Key': 'calendar-event:k1' },
    });
    expect('writeKey' in (post.mock.calls[0][1] as object)).toBe(false);
  });

  it('reads the book again after a 5xx', async () => {
    post.mockReset().mockRejectedValue(
      Object.assign(new Error('Request failed with status code 502'), { response: { status: 502 } }),
    );
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalled());
    const reads = () => get.mock.calls.filter((c) => String(c[0]).startsWith('/calendar/events')).length;
    await waitFor(() => expect(reads()).toBeGreaterThan(0));
    const before = reads();
    await expect(result.current.create.mutateAsync(payload)).rejects.toThrow();
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });
});
