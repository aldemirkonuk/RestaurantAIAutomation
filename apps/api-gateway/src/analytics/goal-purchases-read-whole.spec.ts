import { GoalsService } from "./goals.service";
import { WholeReadError } from "../common/read-whole-window";
import { cappedPostgrest } from "../common/testing/capped-postgrest";

/**
 * Reports lane r3: a "keep purchases under" goal reads every delivered order
 * in its window, or refuses. Its read kept neither the 1,000-row cap nor its
 * error, so a failed read summed nothing and the goal read as met.
 */

const HOUSE = "house-1";
const orders = Array.from({ length: 1500 }, (_, i) => {
  const at = `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00Z`;
  return { id: `ord-${String(i).padStart(5, "0")}`, restaurant_id: HOUSE, status: "DELIVERED", total_cost: 10, final_price: 10, created_at: at, delivered_at: at };
});

const read = (failOn?: (table: string, n: number) => boolean) =>
  (
    new GoalsService(
      { getClient: () => cappedPostgrest({ procurement_orders: orders }, failOn) } as any,
      { getStored: async () => [] } as any,
      { get: () => undefined } as any,
      {} as any,
      { record: () => {} } as any,
      {} as any,
    ) as any
  ).computeMetricWithSeries(HOUSE, "purchase_spend", "2026-01-01", "2026-09-30", "UTC", { withSales: true });

describe("a purchases goal reads every order, or refuses", () => {
  it("sums 1,500 orders, not the first thousand", async () => {
    expect((await read()).current).toBe(15000);
  });

  it("refuses when a later page fails, never answering $0 or a part", async () => {
    await expect(read((t, n) => t === "procurement_orders" && n === 2)).rejects.toBeInstanceOf(WholeReadError);
  });
});
