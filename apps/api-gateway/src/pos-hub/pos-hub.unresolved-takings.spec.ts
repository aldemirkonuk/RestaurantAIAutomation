import { PosHubController } from "./pos-hub.controller";

/**
 * F-1387: GET /pos-hub/unresolved/:restaurantId gave every member the till's
 * takings per unmapped button (`revenue_total`). A role that does not hold
 * the house's money now reads the buttons, counts and units without it, per
 * button and in the summary, and the reply says the amounts were left out.
 */

const queue = () => ({
  restaurant_id: "r1",
  summary: {
    open_lines: 3,
    distinct_items: 1,
    unmapped: 3,
    no_sale_volume: 0,
    qty_total: 3,
    revenue_total: 1350,
    truncated: false,
  },
  items: [
    {
      source: "square",
      external_item_id: "b1",
      item_name: "Barolo glass",
      reason: "unmapped",
      mapped_inventory_id: null,
      occurrences: 3,
      qty_total: 3,
      revenue_total: 1350,
      first_seen: null,
      last_seen: null,
      line_ids: ["l1", "l2", "l3"],
    },
  ],
});

const controllerWith = () =>
  new PosHubController(
    {} as any,
    {} as any,
    { listUnresolvedLines: jest.fn(async () => queue()) } as any,
  );

describe("unresolved POS lines and the house's takings (F-1387)", () => {
  it("leaves out revenue_total, per button and in the summary, for staff", async () => {
    const out: any = await controllerWith().listUnresolved("r1", {
      role: "staff",
    });
    expect(out.amountsWithheld).toBe(true);
    expect("revenue_total" in out.summary).toBe(false);
    expect("revenue_total" in out.items[0]).toBe(false);
    expect(out.items[0].qty_total).toBe(3);
    expect(out.summary.open_lines).toBe(3);
  });

  it("fails closed for a reader with no role", async () => {
    const out: any = await controllerWith().listUnresolved("r1", {});
    expect(out.amountsWithheld).toBe(true);
    expect("revenue_total" in out.items[0]).toBe(false);
  });

  it("keeps the takings for an owner or a manager", async () => {
    for (const role of ["owner", "manager"]) {
      const out: any = await controllerWith().listUnresolved("r1", { role });
      expect(out.amountsWithheld).toBeUndefined();
      expect(out.summary.revenue_total).toBe(1350);
      expect(out.items[0].revenue_total).toBe(1350);
    }
  });
});
