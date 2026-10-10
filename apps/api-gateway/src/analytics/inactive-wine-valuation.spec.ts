import { AnalyticsService } from "./analytics.service";

/**
 * F-442 — a wine marked inactive that still holds bottles dropped out of the
 * /reports stock value, because `loadInventory` read active rows only. The
 * bottles are still in the cellar, so they are still stock: the valuation
 * counts them, while the reorder lens (inventory science) does not restock a
 * wine the house took off its list.
 *
 * The client below honours `.eq()` filters, so a read that filters on
 * `is_active` is seen doing so — a stub that ignored filters would pass with
 * the old read too.
 */

type Rows = Record<string, any[]>;

function makeClient(rowsByTable: Rows) {
  return {
    from: jest.fn((table: string) => {
      const filters: Array<[string, any]> = [];
      const builder: any = {};
      for (const m of ["select", "gte", "in", "order", "limit", "not", "or"])
        builder[m] = jest.fn(() => builder);
      builder.eq = jest.fn((col: string, val: any) => {
        filters.push([col, val]);
        return builder;
      });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({
          data: (rowsByTable[table] ?? []).filter((r) =>
            filters.every(([c, v]) => !(c in r) || r[c] === v),
          ),
          error: null,
        }).then(resolve, reject);
      // The house's currency read (F-343) asks for one row (integ stub).
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({
          data: (rowsByTable[table] ?? [])[0] ?? null,
          error: null,
        }),
      );
      return builder;
    }),
  };
}

const RESTAURANT = "33333333-3333-3333-3333-333333333333";

const ACTIVE = {
  id: "inv-active",
  restaurant_id: RESTAURANT,
  wine_name: "House Rioja",
  stock_live: 10,
  menu_price_current: 40,
  last_purchase_price: 10,
  threshold_min: 4,
  master_wine_id: "mw-active",
  is_active: true,
};
const INACTIVE_HELD = {
  id: "inv-retired",
  restaurant_id: RESTAURANT,
  wine_name: "Retired Barolo",
  stock_live: 6,
  menu_price_current: 90,
  last_purchase_price: 20,
  threshold_min: 4,
  master_wine_id: "mw-retired",
  is_active: false,
};
const INACTIVE_EMPTY = {
  ...INACTIVE_HELD,
  id: "inv-gone",
  wine_name: "Gone Chablis",
  stock_live: 0,
  master_wine_id: "mw-gone",
};

const build = (rows: Rows) =>
  new AnalyticsService({ getClient: () => makeClient(rows) } as any);

const rows = {
  restaurant_inventory: [ACTIVE, INACTIVE_HELD, INACTIVE_EMPTY],
};

describe("F-442: bottles of an inactive wine still count in the stock value", () => {
  it("values the inactive wine's bottles on hand, and says so", async () => {
    const fin = await build(rows).getFinancialSummary(RESTAURANT);
    // 10 × 10 (active) + 6 × 20 (inactive, still in the cellar).
    expect(fin.inventoryValue).toBe(220);
    expect(fin.basis.inventoryValue).toContain(
      "includes 1 wine marked inactive that still hold bottles",
    );
  });

  it("an inactive wine with nothing on hand adds nothing", async () => {
    const fin = await build({
      restaurant_inventory: [ACTIVE, INACTIVE_EMPTY],
    }).getFinancialSummary(RESTAURANT);
    expect(fin.inventoryValue).toBe(100);
    expect(fin.basis.inventoryValue).not.toContain("inactive");
    // Gone from every lens, not only valued at zero.
    expect(fin.basis.revenue).toContain("1 inventory row valued");
  });

  it("the reorder lens keeps active wines only", async () => {
    const sci = await build(rows).getInventoryScience(RESTAURANT);
    expect(sci.skus.map((s: any) => s.id)).toEqual(["inv-active"]);
    expect(sci.skuCount).toBe(1);
  });
});
