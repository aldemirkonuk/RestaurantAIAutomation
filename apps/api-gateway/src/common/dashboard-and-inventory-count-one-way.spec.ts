/**
 * OD-161, QA round 9c: the dashboard and /inventory summaries must give the
 * same counts for the same wines, because both now read one pure helper
 * (`summarizeStock`, common/stock-status.ts).
 *
 * Before this, the dashboard counted `stock_live === 0` over counted rows and
 * /inventory counted `classifyStock` over counted rows plus uncounted rows the
 * view holds. A wine received 5 and sold 5, never counted, par 3, in
 * `v_low_stock_items`, fired a critical alert and read criticalCount 1 on
 * /inventory and 0 on the dashboard.
 */
import { Logger } from "@nestjs/common";
import { DashboardService } from "../dashboard/dashboard.service";
import { InventoryService } from "../inventory/inventory.service";
import { LowStockListUnreadError, summarizeStock } from "./stock-status";

const COUNTED = "2026-11-01T10:00:00Z";

// One house, every case the rule distinguishes.
const ROWS = [
  // received 5, sold 5, never counted: in the view, alert critical
  { id: "recv-zero", stock_live: 0, threshold_min: 3, last_counted_at: null },
  // received 10, sold 8, never counted: in the view, alert low
  { id: "recv-low", stock_live: 2, threshold_min: 3, last_counted_at: null },
  // linked from the menu, nothing moved: not in the view, unknown
  { id: "never-moved", stock_live: 0, threshold_min: 3, last_counted_at: null },
  // counted empty: out, critical
  {
    id: "counted-out",
    stock_live: 0,
    threshold_min: 3,
    last_counted_at: COUNTED,
  },
  // counted 2 of 5: critical by ratio, not out
  {
    id: "counted-2of5",
    stock_live: 2,
    threshold_min: 5,
    last_counted_at: COUNTED,
  },
  {
    id: "counted-at",
    stock_live: 3,
    threshold_min: 3,
    last_counted_at: COUNTED,
  },
  {
    id: "counted-full",
    stock_live: 9,
    threshold_min: 3,
    last_counted_at: COUNTED,
  },
];
// The view after OD-161's second half: counted rows below par, and uncounted
// rows a live stock movement put below par.
const VIEW = ROWS.filter((r) =>
  ["recv-zero", "recv-low", "counted-out", "counted-2of5"].includes(r.id),
);

function dbWith(inventory: any[] | null, lowStock: any[] | null) {
  return {
    getRestaurantInventory: jest.fn().mockResolvedValue(inventory),
    getLowStockItems: jest.fn().mockResolvedValue(lowStock),
  };
}

async function both(inventory: any[] | null, lowStock: any[] | null) {
  const db = dbWith(inventory, lowStock);
  const inv = await new InventoryService(db as any).getInventorySummary("r1");
  const dash = await (
    new DashboardService(db as any) as any
  ).getInventorySummary("r1");
  return { inv, dash };
}

describe("OD-161 — the dashboard and /inventory count the same wines one way", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("gives the same criticalCount, lowStockCount and healthyCount for one fixture", async () => {
    const { inv, dash } = await both(ROWS, VIEW);

    // recv-zero (0/3, alert critical), counted-out (0/3), counted-2of5 (2/5)
    expect(inv.criticalCount).toBe(3);
    expect(dash.criticalCount).toBe(inv.criticalCount);
    expect(dash.lowStockCount).toBe(inv.lowStockCount);
    expect(dash.healthyCount).toBe(inv.healthyCount);
    expect(inv).toMatchObject({
      lowStockCount: 4,
      atParCount: 1,
      healthyCount: 1,
      unknownCount: 1,
    });
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Low-stock count disagreement"),
    );
  });

  it("both refuse, never 0 low, when the view could not be read", async () => {
    const db = dbWith(ROWS, null);
    await expect(
      new InventoryService(db as any).getInventorySummary("r1"),
    ).rejects.toThrow(LowStockListUnreadError);
    await expect(
      (new DashboardService(db as any) as any).getInventorySummary("r1"),
    ).rejects.toThrow(LowStockListUnreadError);
  });

  it("is one pure helper both summaries read", () => {
    expect(summarizeStock(ROWS, VIEW)).toEqual({
      lowStockCount: 4,
      criticalCount: 3,
      atParCount: 1,
      unknownCount: 1,
      healthyCount: 1,
    });
    expect(() => summarizeStock(null, VIEW)).toThrow(LowStockListUnreadError);
    expect(() => summarizeStock(ROWS, null)).toThrow(LowStockListUnreadError);
    expect(summarizeStock([], [])).toEqual({
      lowStockCount: 0,
      criticalCount: 0,
      atParCount: 0,
      unknownCount: 0,
      healthyCount: 0,
    });
  });
});
