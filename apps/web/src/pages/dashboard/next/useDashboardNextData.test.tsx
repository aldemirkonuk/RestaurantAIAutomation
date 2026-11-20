import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useDashboardSpine, useMonthLedger } from "./useDashboardNextData";
import { dashboardApi, inventoryApi, ordersApi } from "@/services/api";

vi.mock("@/services/api", () => ({
  dashboardApi: {
    getCalendarRevenue: vi.fn(),
    getDashboardStats: vi.fn(),
    getRecentActivity: vi.fn(),
    getAlerts: vi.fn(),
  },
  inventoryApi: { getLowStockItems: vi.fn() },
  ordersApi: { getOrdersNeedingApproval: vi.fn() },
}));
const month = (spend: number) => ({
  year: 2026,
  month: 9,
  daily: [
    {
      date: "2026-09-01",
      procurement_spend: spend,
      bottles_sold: 1,
      order_count: 1,
      events: [],
    },
  ],
  monthly_procurement_spend: spend,
});
beforeEach(() => vi.clearAllMocks());

it("reads a distinct calendar for a new house even when year and month are unchanged", async () => {
  vi.mocked(dashboardApi.getCalendarRevenue)
    .mockResolvedValueOnce(month(10) as any)
    .mockResolvedValueOnce(month(90) as any);
  const { result, rerender } = renderHook(
    ({ house }) => useMonthLedger(house, 2026, 9),
    { initialProps: { house: "A" } },
  );
  await waitFor(() =>
    expect(result.current.month).toMatchObject({
      state: "ready",
      ledger: { monthlySpend: 10 },
    }),
  );
  rerender({ house: "B" });
  await waitFor(() =>
    expect(result.current.month).toMatchObject({
      state: "ready",
      ledger: { monthlySpend: 90 },
    }),
  );
  expect(dashboardApi.getCalendarRevenue).toHaveBeenLastCalledWith(
    2026,
    9,
    "B",
  );
});

it("does not let a delayed response replace a different house restored from cache", async () => {
  let finishB!: (value: any) => void;
  vi.mocked(dashboardApi.getCalendarRevenue)
    .mockResolvedValueOnce(month(10) as any)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishB = resolve;
        }),
    );
  const { result, rerender } = renderHook(
    ({ house }) => useMonthLedger(house, 2026, 9),
    { initialProps: { house: "A" } },
  );
  await waitFor(() => expect(result.current.month.state).toBe("ready"));
  rerender({ house: "B" });
  await waitFor(() => expect(result.current.month.state).toBe("loading"));
  rerender({ house: "A" });
  await act(async () => {
    finishB(month(90));
  });
  expect(result.current.month).toMatchObject({
    state: "ready",
    ledger: { monthlySpend: 10 },
  });
});

// DASH-W3 / DASH-W11: the spine used to fold a failed activity or alerts read
// into `[]`, which the panels printed as a quiet day. A failed read is `null`
// (unreachable); only a list that was actually read may be empty.
function spineAnswers(activity: Promise<unknown>, alerts: Promise<unknown>) {
  vi.mocked(dashboardApi.getDashboardStats).mockResolvedValue({} as any);
  vi.mocked(ordersApi.getOrdersNeedingApproval).mockResolvedValue([]);
  vi.mocked(inventoryApi.getLowStockItems).mockResolvedValue([]);
  vi.mocked(dashboardApi.getRecentActivity).mockReturnValue(activity as any);
  vi.mocked(dashboardApi.getAlerts).mockReturnValue(alerts as any);
}

it("keeps a failed activity or alerts read as null, never an empty list", async () => {
  spineAnswers(
    Promise.reject(new Error("503")),
    Promise.reject(new Error("503")),
  );
  const { result } = renderHook(() => useDashboardSpine("A"));
  await waitFor(() => expect(result.current.stats).not.toBeUndefined());
  expect(result.current.activity).toBeNull();
  expect(result.current.alerts).toBeNull();
});

it("keeps a real empty activity or alerts list as an empty list", async () => {
  spineAnswers(Promise.resolve([]), Promise.resolve([]));
  const { result } = renderHook(() => useDashboardSpine("A"));
  await waitFor(() => expect(result.current.stats).not.toBeUndefined());
  expect(result.current.activity).toEqual([]);
  expect(result.current.alerts).toEqual([]);
});
