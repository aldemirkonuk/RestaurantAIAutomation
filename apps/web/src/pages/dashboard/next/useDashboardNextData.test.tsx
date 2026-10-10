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

// F-220: the dashboard is not remounted by a house switch everywhere it is
// drawn, so the spine itself must not let the last house land.
it("a house switch drops the last house's approvals and low stock, even when they come back late", async () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const late: Array<() => void> = [];
  const held = <T,>(house: string, value: T) =>
    house === A
      ? new Promise<T>((resolve) => late.push(() => resolve(value)))
      : Promise.resolve(value);
  vi.mocked(dashboardApi.getDashboardStats).mockImplementation(
    (h?: string) => held(h ?? "", { totalWines: h === A ? 1 : 2 }) as any,
  );
  vi.mocked(ordersApi.getOrdersNeedingApproval).mockImplementation(
    (h?: string) => held(h ?? "", [{ id: `order-in-${h}` }]) as any,
  );
  vi.mocked(inventoryApi.getLowStockItems).mockImplementation(
    (h?: string) => held(h ?? "", [{ id: `wine-in-${h}` }]) as any,
  );
  vi.mocked(dashboardApi.getRecentActivity).mockImplementation(
    (_n?: number, h?: string) => held(h ?? "", []) as any,
  );
  vi.mocked(dashboardApi.getAlerts).mockImplementation(
    (h?: string) => held(h ?? "", []) as any,
  );

  const { result, rerender } = renderHook(
    ({ house }) => useDashboardSpine(house),
    { initialProps: { house: A } },
  );
  rerender({ house: B });
  await waitFor(() =>
    expect(result.current.pending).toEqual([{ id: `order-in-${B}` }]),
  );
  // House A's reads answer only now.
  await act(async () => {
    late.forEach((answer) => answer());
  });
  expect(result.current.pending).toEqual([{ id: `order-in-${B}` }]);
  expect(result.current.lowStock).toEqual([{ id: `wine-in-${B}` }]);
});

it("a house switch shows nothing of the last house while the next one's figures are read", async () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const never = new Promise<never>(() => {});
  vi.mocked(dashboardApi.getDashboardStats).mockImplementation(
    (h?: string) => (h === A ? Promise.resolve({ totalWines: 1 }) : never) as any,
  );
  vi.mocked(ordersApi.getOrdersNeedingApproval).mockImplementation(
    (h?: string) => (h === A ? Promise.resolve([{ id: "a-order" }]) : never) as any,
  );
  vi.mocked(inventoryApi.getLowStockItems).mockImplementation(
    (h?: string) => (h === A ? Promise.resolve([{ id: "a-wine" }]) : never) as any,
  );
  vi.mocked(dashboardApi.getRecentActivity).mockImplementation(
    (_n?: number, h?: string) => (h === A ? Promise.resolve([]) : never) as any,
  );
  vi.mocked(dashboardApi.getAlerts).mockImplementation(
    (h?: string) => (h === A ? Promise.resolve([]) : never) as any,
  );
  const { result, rerender } = renderHook(
    ({ house }) => useDashboardSpine(house),
    { initialProps: { house: A } },
  );
  await waitFor(() => expect(result.current.pending).toEqual([{ id: "a-order" }]));
  rerender({ house: B });
  expect(result.current.pending).toBeUndefined();
  expect(result.current.lowStock).toBeUndefined();
  expect(result.current.stats).toBeUndefined();
});
