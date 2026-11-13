/**
 * QA round 4 B5: an entry over several days was drawn on its first day only,
 * and the month it ran into did not show it at all. The gateway now returns
 * a running entry with its window; the page draws it on every day it covers.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
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
  useOrdersSubscription: () => {},
}));
vi.mock('../../../services/api/providers', () => ({ fetchProviders: async () => [] }));

import { daysCovered } from './expand-series';
import { useCalendarNextData, type CalEvent } from './useCalendarNextData';
import { placed } from './TimeGrid';
import { Ribbon } from './MonthLedger';

describe('daysCovered — the days of a window an entry is on', () => {
  it('is every day from the start to the end', () => {
    expect(daysCovered('2026-12-28', '2027-01-03', '2026-12-01', '2027-01-31')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });

  it('is cut to the window at both ends', () => {
    expect(daysCovered('2026-12-28', '2027-01-03', '2027-01-01', '2027-01-31')).toEqual([
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
    expect(daysCovered('2026-12-28', '2027-01-03', '2026-12-01', '2026-12-29')).toEqual([
      '2026-12-28',
      '2026-12-29',
    ]);
  });

  it('is the start day alone for a one-day entry, an end before the start, or an unreadable end', () => {
    expect(daysCovered('2026-12-28', null, '2026-12-01', '2026-12-31')).toEqual(['2026-12-28']);
    expect(daysCovered('2026-12-28', '2026-12-20', '2026-12-01', '2026-12-31')).toEqual(['2026-12-28']);
    expect(daysCovered('2026-12-28', 'soon', '2026-12-01', '2026-12-31')).toEqual(['2026-12-28']);
  });
});

const ev = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  restaurantId: 'r-1',
  title: `Entry ${id}`,
  eventType: 'other',
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

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

let rows: unknown[] = [];
beforeEach(() => {
  rows = [];
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/calendar/events')) {
      return { data: { events: rows, total: rows.length, hasMore: false, linkedOrders: [], linkedOrdersReadable: true } };
    }
    if (url.startsWith('/calendar/event-types')) return { data: [] };
    return { data: null };
  });
});

describe('useCalendarNextData — a multi-day entry is drawn on each of its days', () => {
  // September 2026's month grid runs 2026-08-31 .. 2026-10-04.
  const cursor = new Date(2026, 8, 15, 12);

  it('draws the entry on every day it covers, and counts it once', async () => {
    rows = [ev('c1', { title: 'Autumn closure', eventDate: '2026-09-28', eventDateEnd: '2026-10-02' })];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
    for (const d of days) expect(result.current.byDay.get(d)?.map((e) => e.seriesId)).toEqual(['c1']);
    expect(result.current.byDay.get('2026-10-03')).toBeUndefined();
    expect(result.current.byDay.get('2026-09-28')?.[0].continuesFrom).toBeUndefined();
    expect(result.current.byDay.get('2026-09-29')?.[0].continuesFrom).toBe('2026-09-28');
  });

  it('draws an entry that began before the window on the window days it still covers', async () => {
    rows = [ev('c2', { title: 'Summer closure', eventDate: '2026-08-25', eventDateEnd: '2026-09-02' })];
    const { result } = renderHook(() => useCalendarNextData('month', cursor), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect([...result.current.byDay.keys()].sort()).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
    for (const list of result.current.byDay.values()) expect(list[0].continuesFrom).toBe('2026-08-25');
  });
});

const calEvent = (over: Partial<CalEvent> = {}): CalEvent => ({
  id: 'c1',
  seriesId: 'c1',
  isOccurrence: false,
  title: 'Late shift',
  description: null,
  type: 'other',
  date: '2026-09-28',
  endDate: '2026-09-29',
  startTime: '22:00',
  endTime: '02:00',
  allDay: false,
  status: 'pending',
  providerId: null,
  orderId: null,
  source: 'manual',
  color: null,
  isRecurring: false,
  reminderEnabled: false,
  reminderDaysBefore: 1,
  reminderSent: false,
  ...over,
} as CalEvent);

describe('a later day of a multi-day entry', () => {
  it('is not placed on the hour grid again: it fills its day', () => {
    expect(placed(calEvent())).not.toBeNull();
    expect(placed(calEvent({ continuesFrom: '2026-09-28' }))).toBeNull();
  });

  it('cannot be dragged, and says where it began', () => {
    render(
      <>
        <Ribbon event={calEvent()} ruled={false} onOpen={() => {}} onDragStart={() => {}} />
        <Ribbon
          event={calEvent({ id: 'c1-cont', continuesFrom: '2026-09-28' })}
          ruled={false}
          onOpen={() => {}}
          onDragStart={() => {}}
        />
      </>,
    );
    const [first, later] = screen.getAllByRole('button');
    expect(first).toHaveAttribute('draggable', 'true');
    expect(first).toHaveTextContent('22:00');
    expect(later).toHaveAttribute('draggable', 'false');
    expect(later).not.toHaveTextContent('22:00');
    expect(later.getAttribute('title')).toMatch(/continues from/);
  });
});
