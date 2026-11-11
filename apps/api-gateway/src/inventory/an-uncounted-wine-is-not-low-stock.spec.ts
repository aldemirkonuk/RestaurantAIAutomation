/**
 * OD-161 (rule half): a wine nobody has counted is unknown, not zero.
 *
 * Menu linking inserts a `restaurant_inventory` row with no count, so it reads
 * `stock_live` 0 against the house's default par. `last_counted_at` is stamped
 * only by a count (a_count_is_a_record). The /inventory summary classified
 * that row `critical`; it is now `unknown`, and `v_low_stock_items` (migration
 * an_uncounted_wine_is_not_low_stock) leaves the same row out.
 */
import { Logger } from "@nestjs/common";
import { InventoryService } from "./inventory.service";

const NEVER_COUNTED = {
  id: "inv-new",
  stock_live: 0,
  threshold_min: 3,
  is_active: true,
  last_counted_at: null,
};
const COUNTED_EMPTY = {
  id: "inv-empty",
  stock_live: 0,
  threshold_min: 3,
  is_active: true,
  last_counted_at: "2026-11-01T10:00:00Z",
};

function serviceWith(inventory: any[], lowStock: any[]) {
  const db = {
    getRestaurantInventory: jest.fn().mockResolvedValue(inventory),
    getLowStockItems: jest.fn().mockResolvedValue(lowStock),
  };
  return new InventoryService(db as any);
}

describe("OD-161 — the /inventory summary does not call an uncounted wine low", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  it("counts a never-counted row as unknown, not critical or low", async () => {
    // The view, after the migration, returns only the counted row.
    const summary = await serviceWith(
      [NEVER_COUNTED, COUNTED_EMPTY],
      [COUNTED_EMPTY],
    ).getInventorySummary("r1");

    expect(summary).toMatchObject({
      totalItems: 2,
      lowStockCount: 1,
      criticalCount: 1,
      unknownCount: 1,
      healthyCount: 0,
    });
  });

  it("agrees with the view, so no disagreement is logged", async () => {
    await serviceWith(
      [NEVER_COUNTED, COUNTED_EMPTY],
      [COUNTED_EMPTY],
    ).getInventorySummary("r1");

    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Low-stock count disagreement"),
    );
  });

  // Second half (a_received_wine_not_counted_yet_can_run_low): receipts and
  // sales give an uncounted wine a figure, and the view holds it when that
  // figure is below par. The summary classifies it then, and only then.
  it("counts a received, never-counted wine below par as low, as the view does", async () => {
    const RECEIVED_LOW = {
      id: "inv-received",
      stock_live: 2,
      threshold_min: 3,
      is_active: true,
      last_counted_at: null,
    };
    const summary = await serviceWith(
      [NEVER_COUNTED, RECEIVED_LOW],
      [RECEIVED_LOW],
    ).getInventorySummary("r1");

    expect(summary).toMatchObject({
      totalItems: 2,
      lowStockCount: 1,
      criticalCount: 0,
      unknownCount: 1,
      healthyCount: 0,
    });
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Low-stock count disagreement"),
    );
  });

  it("refuses, rather than read 0 low, when the view could not be read", async () => {
    const db = {
      getRestaurantInventory: jest.fn().mockResolvedValue([
        { ...NEVER_COUNTED, id: "inv-received", stock_live: 2 },
      ]),
      getLowStockItems: jest.fn().mockResolvedValue(null),
    };
    await expect(
      new InventoryService(db as any).getInventorySummary("r1"),
    ).rejects.toThrow("The low-stock list was not read");
  });
});
