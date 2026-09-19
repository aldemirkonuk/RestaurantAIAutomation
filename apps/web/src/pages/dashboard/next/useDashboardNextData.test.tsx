import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useMonthLedger } from "./useDashboardNextData";
import { dashboardApi } from "@/services/api";

vi.mock("@/services/api", () => ({
  dashboardApi: { getCalendarRevenue: vi.fn() },
  inventoryApi: {},
  ordersApi: {},
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
