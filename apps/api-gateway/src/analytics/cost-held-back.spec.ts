import { AnalyticsService } from "./analytics.service";
import { cogsHeldBackOf, HELD_BACK_NAMED } from "./cost-held-back";
import type { TillCostRead } from "./cost-of-goods";

/**
 * r36 invoices R2: while "what it cost" is withheld, the figures of record
 * name the goods that hold it back, so the owner knows which to cost.
 * SYNTHETIC data.
 */
type Item = NonNullable<TillCostRead["items"]>[number];
const item = (id: string, over: Partial<Item> = {}): Item => ({
  inventory_id: id,
  bottles_out: 6,
  bottles_back: 0,
  cost: "0",
  settled_after_sale: "0",
  uncosted_out: 0,
  uncosted_back: 0,
  in_house: true,
  ...over,
});

const names = new Map<string, string | null>([
  ["a", "Ribolla"],
  ["b", "Flour"],
  ["c", "Chablis"],
  ["d", "  "],
]);

describe("cogsHeldBackOf", () => {
  it("names only the goods with something uncosted, alphabetically", () => {
    const r = cogsHeldBackOf(
      {
        items: [
          item("a", { uncosted_out: 2 }),
          item("c", { uncosted_out: 0, cost: "120" }),
          item("b", { uncosted_out: "4500" }),
        ],
      },
      names,
    );
    expect(r).toEqual({
      goods: [
        { inventoryId: "b", name: "Flour" },
        { inventoryId: "a", name: "Ribolla" },
      ],
      more: 0,
    });
  });

  it("a void given back with no cost holds the figure back too", () => {
    const r = cogsHeldBackOf({ items: [item("c", { uncosted_back: 1 })] }, names);
    expect(r?.goods.map((g) => g.inventoryId)).toEqual(["c"]);
  });

  it("an unreadable count is an unknown, so the good is named", () => {
    const r = cogsHeldBackOf({ items: [item("c", { uncosted_out: "n/a" })] }, names);
    expect(r?.goods.map((g) => g.inventoryId)).toEqual(["c"]);
  });

  it("another house's item is never named", () => {
    expect(cogsHeldBackOf({ items: [item("a", { uncosted_out: 2, in_house: false })] }, names)).toBeNull();
  });

  it("a good no longer on the list is named as such, after the named ones, never by a blank", () => {
    const r = cogsHeldBackOf(
      { items: [item("zz", { uncosted_out: 1 }), item("d", { uncosted_out: 1 }), item("a", { uncosted_out: 1 })] },
      names,
    );
    expect(r?.goods).toEqual([
      { inventoryId: "a", name: "Ribolla" },
      { inventoryId: "d", name: null },
      { inventoryId: "zz", name: null },
    ]);
  });

  it("names at most the cap and counts the rest", () => {
    const many = Array.from({ length: HELD_BACK_NAMED + 3 }, (_, i) => item(`g${String(i).padStart(2, "0")}`, { uncosted_out: 1 }));
    const r = cogsHeldBackOf({ items: many }, new Map());
    expect(r?.goods).toHaveLength(HELD_BACK_NAMED);
    expect(r?.more).toBe(3);
  });

  it("an item listed twice is named once", () => {
    const r = cogsHeldBackOf({ items: [item("a", { uncosted_out: 1 }), item("a", { uncosted_out: 2 })] }, names);
    expect(r?.goods).toHaveLength(1);
  });

  it("nothing held back is null", () => {
    expect(cogsHeldBackOf({ items: [item("a")] }, names)).toBeNull();
    expect(cogsHeldBackOf({}, names)).toBeNull();
  });
});

describe("getFinancialSummary carries the goods that hold what it cost back", () => {
  const RESTAURANT = "44444444-4444-4444-4444-444444444444";
  const STOCKED = [
    { id: "inv-1", wine_name: "Stamped Chablis", stock_live: 5, menu_price_current: 60, last_purchase_price: 20, threshold_min: 2, master_wine_id: "mw-1" },
    { id: "inv-2", wine_name: null, display_name: "Opening Ribolla", stock_live: 3, menu_price_current: 70, last_purchase_price: null, threshold_min: 1, master_wine_id: null },
  ];
  const SALES = { items: [{ inventory_id: "inv-1", sales: 900, in_house: true }, { inventory_id: "inv-2", sales: 420, in_house: true }], checks: 30, lines: 30, unmapped_lines: 0, unreadable_lines: 0 };
  const cost = (uncosted: number) => ({
    items: [
      { inventory_id: "inv-1", bottles_out: 15, bottles_back: 0, cost: "300.000000", settled_after_sale: "0", uncosted_out: 0, uncosted_back: 0, in_house: true },
      { inventory_id: "inv-2", bottles_out: 6, bottles_back: 0, cost: uncosted > 0 ? "0" : "120.000000", settled_after_sale: "0", uncosted_out: uncosted, uncosted_back: 0, in_house: true },
    ],
    cost: uncosted > 0 ? "300.000000" : "420.000000",
    settled_after_sale: "0",
    rows: 21,
    rows_unstamped: 0,
    first_move_at: new Date(Date.now() - 59 * 86400000).toISOString(),
  });

  function service(costRead: unknown) {
    const client = {
      from: jest.fn((table: string) => {
        const b: any = {};
        for (const m of ["select", "eq", "neq", "gt", "gte", "lt", "lte", "is", "or", "not", "order", "limit", "in", "range"]) b[m] = jest.fn(() => b);
        b.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
        b.then = (ok: any, no: any) =>
          Promise.resolve({
            data: table === "restaurant_inventory" ? STOCKED : [],
            error: null,
            count: table === "restaurant_inventory" ? STOCKED.length : 0,
          }).then(ok, no);
        return b;
      }),
      rpc: jest.fn((fn: string) =>
        Promise.resolve(
          fn === "pos_item_sales" ? { data: SALES, error: null } : fn === "pos_cost_of_goods" ? { data: costRead, error: null } : { data: null, error: { message: `no ${fn}` } },
        ),
      ),
    };
    return new AnalyticsService({ getClient: () => client } as any);
  }

  it("names the uncosted good by the house's name while what it cost is withheld", async () => {
    const out: any = await service(cost(6)).getFinancialSummary(RESTAURANT, 0, { withSales: true });
    expect(out.cogs).toBeNull();
    expect(out.cogsHeldBack).toEqual({ goods: [{ inventoryId: "inv-2", name: "Opening Ribolla" }], more: 0 });
  });

  it("is null once every good sold carries its cost", async () => {
    const out: any = await service(cost(0)).getFinancialSummary(RESTAURANT, 0, { withSales: true });
    expect(out.cogs).toBe(420);
    expect(out.cogsHeldBack).toBeNull();
  });

  it("is never read for a caller who does not see the till", async () => {
    const out: any = await service(cost(6)).getFinancialSummary(RESTAURANT, 0, {});
    expect(out.cogsHeldBack).toBeNull();
  });
});
