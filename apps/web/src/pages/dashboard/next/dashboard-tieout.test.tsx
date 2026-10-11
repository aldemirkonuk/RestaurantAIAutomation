/**
 * The dashboard tie-out with the pages it summarises (sim wave 41).
 *
 * F-1201: "This week" drew a repeating entry only on its first date, so a
 * weekly Friday tasting that began last month read "Nothing on the calendar
 * this week" while /calendar drew it every Friday. The panel now asks for the
 * series that began earlier and lays them out with the calendar's expander.
 *
 * F-1202: the day sheet's Deliveries list read the 100 newest orders CREATED
 * in the 45 days around the day, with bounds from the browser's clock. A busy
 * house's older days could not be listed, and a Detroit house lost the orders
 * delivered on its evening. It now reads the house day's own instants by
 * delivery and pages to the end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ordersApi } from '@/services/api';

const useCalendarEvents = vi.fn();
vi.mock('@/hooks/queries/useCalendarQueries', () => ({
  useCalendarEvents: (...args: unknown[]) => useCalendarEvents(...args),
}));
vi.mock('@/services/api', () => ({
  dashboardApi: {},
  inventoryApi: {},
  ordersApi: { getOrderHistory: vi.fn() },
}));

import { WeekAhead } from './RailPanels';
import { useDayOrders } from './useDashboardNextData';


const tasting = {
  id: 'ev-series',
  title: 'Friday tasting',
  type: 'tasting',
  date: '2026-09-04',
  endDate: null,
  startTime: '18:00:00',
  allDay: false,
  color: '#000',
  restaurantId: 'r1',
  isRecurring: true,
  recurrenceRule: { id: 'rule-1', frequency: 'weekly', interval: 1, daysOfWeek: [5], endType: 'never' },
};

describe('WeekAhead — a repeating entry is on this week (F-1201)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Monday 2026-10-05, noon in Chicago.
    vi.setSystemTime(new Date('2026-10-05T17:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    useCalendarEvents.mockReset();
  });

  it('asks for earlier series and draws this Friday of a series begun last month', () => {
    useCalendarEvents.mockReturnValue({ data: [tasting], isLoading: false, isError: false });
    render(
      <MemoryRouter>
        <WeekAhead restaurantId="r1" zone="America/Chicago" />
      </MemoryRouter>,
    );
    expect(useCalendarEvents).toHaveBeenCalledWith('r1', {
      startDate: '2026-10-05',
      endDate: '2026-10-11',
      includeEarlierSeries: true,
    });
    expect(screen.queryByText('Nothing on the calendar this week.')).toBeNull();
    const row = screen.getByText('Friday tasting').closest('li')!;
    expect(row.textContent).toContain('9 Fri');
    expect(screen.getAllByText('Friday tasting')).toHaveLength(1);
  });

  it('a dated entry without a rule is drawn once, with no "could not be laid out" note', () => {
    useCalendarEvents.mockReturnValue({
      data: [{ ...tasting, id: 'ev-legacy', title: 'Delivery', date: '2026-10-07', recurrenceRule: undefined }],
      isLoading: false,
      isError: false,
    });
    render(
      <MemoryRouter>
        <WeekAhead restaurantId="r1" zone="America/Chicago" />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Delivery')).toHaveLength(1);
    expect(screen.queryByText(/could not be laid out/)).toBeNull();
  });
});

const delivered = (n: number, deliveredAt: string) =>
  ({ id: `o-${String(n).padStart(4, "0")}`, deliveredAt }) as any;

describe("useDayOrders — one house day's deliveries, whole (F-1202)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks for the Detroit day's instants by delivery and lists every page", async () => {
    const first = Array.from({ length: 100 }, (_, i) =>
      delivered(i, "2026-10-05T15:00:00.000Z"),
    );
    // 21:00 EDT on the 5th is 01:00Z on the 6th.
    const evening = delivered(100, "2026-10-06T01:00:00.000Z");
    vi.mocked(ordersApi.getOrderHistory)
      .mockResolvedValueOnce({ data: first, total: 101, page: 1, limit: 100, hasMore: true } as any)
      .mockResolvedValueOnce({ data: [evening], total: 101, page: 2, limit: 100, hasMore: false } as any);

    const { result } = renderHook(() =>
      useDayOrders("house-1", "2026-10-05", "America/Detroit"),
    );
    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(ordersApi.getOrderHistory).toHaveBeenNthCalledWith(1, {
      deliveredFrom: "2026-10-05T04:00:00.000Z",
      deliveredTo: "2026-10-06T04:00:00.000Z",
      limit: 100,
      page: 1,
    });
    expect(ordersApi.getOrderHistory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ page: 2 }),
    );
    const orders = (result.current as any).orders as Array<{ id: string }>;
    expect(orders).toHaveLength(101);
    expect(orders.map((o) => o.id)).toContain("o-0100");
  });

  it("says unknown when a page cannot be read, never a short list", async () => {
    vi.mocked(ordersApi.getOrderHistory)
      .mockResolvedValueOnce({ data: [delivered(1, "2026-10-05T15:00:00.000Z")], total: 2, page: 1, limit: 100, hasMore: true } as any)
      .mockRejectedValueOnce(new Error("500"));
    const { result } = renderHook(() =>
      useDayOrders("house-1", "2026-10-05", "America/Detroit"),
    );
    await waitFor(() => expect(result.current.state).toBe("unknown"));
  });
});
