import { ForbiddenException } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { awaitsStatedCost, OpeningCostService } from "./opening-cost.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * r38 invoices (R1 web half, the read): the item sheet asks "What did these
 * cost?" only when the item has stock from no delivery that still has no cost.
 * The read counts exactly the lots state_opening_lot_cost would restate,
 * sold-out lots included. SYNTHETIC data.
 */
type Lot = {
  id: string;
  qty: number | string | null;
  delivery_id: string | null;
  source_order_id: string | null;
  cost_state: string | null;
  unit_cost: number | string | null;
};

const lot = (over: Partial<Lot>): Lot => ({
  id: "l",
  qty: 6,
  delivery_id: null,
  source_order_id: null,
  cost_state: "provisional",
  unit_cost: null,
  ...over,
});

/** A fake query builder that records its filters and serves pages from `pages`. */
function lotsDb(pages: Lot[][], error: { message: string } | null = null) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let page = 0;
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "or", "order"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.range = async (...args: unknown[]) => {
    calls.push({ method: "range", args });
    if (error) return { data: null, error };
    return { data: pages[page++] ?? [], error: null };
  };
  const from = jest.fn(() => builder);
  return { db: { getClient: () => ({ from }) } as never, from, calls };
}

describe("awaitsStatedCost — the function's own filter, row by row", () => {
  it("an uncosted lot from no delivery and no order awaits a cost", () => {
    expect(awaitsStatedCost(lot({}))).toBe(true);
    expect(awaitsStatedCost(lot({ cost_state: "final", unit_cost: null }))).toBe(true);
    expect(awaitsStatedCost(lot({ cost_state: "provisional", unit_cost: 12 }))).toBe(true);
  });

  it("a delivery's lot, an order's lot or a settled cost never does", () => {
    expect(awaitsStatedCost(lot({ delivery_id: "d-1" }))).toBe(false);
    expect(awaitsStatedCost(lot({ source_order_id: "o-1" }))).toBe(false);
    expect(awaitsStatedCost(lot({ cost_state: "final", unit_cost: 18 }))).toBe(false);
  });
});

describe("OpeningCostService.uncosted", () => {
  it("reads only this house's item, live, from no delivery or order, with no settled cost", async () => {
    const { db, from, calls } = lotsDb([[lot({ id: "a", qty: 6 })]]);
    await new OpeningCostService(db).uncosted("rest-1", "inv-1");
    expect(from).toHaveBeenCalledWith("inventory_lots");
    const eqs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual(
      expect.arrayContaining([
        ["restaurant_id", "rest-1"],
        ["inventory_id", "inv-1"],
        ["stock_state", "live"],
      ]),
    );
    const iss = calls.filter((c) => c.method === "is").map((c) => c.args);
    expect(iss).toEqual(expect.arrayContaining([["delivery_id", null], ["source_order_id", null]]));
    expect(calls.find((c) => c.method === "or")?.args[0]).toBe("cost_state.eq.provisional,unit_cost.is.null");
  });

  it("counts lots and units, and a sold-out lot still counts as waiting", async () => {
    const { db } = lotsDb([[lot({ id: "a", qty: 6 }), lot({ id: "b", qty: "3" }), lot({ id: "c", qty: 0 })]]);
    const r = await new OpeningCostService(db).uncosted("rest-1", "inv-1");
    expect(r).toEqual({ inventoryId: "inv-1", lots: 3, units: 9, emptyLots: 1 });
  });

  it("a row the filter should have dropped is not counted (a settled delivery lot)", async () => {
    const { db } = lotsDb([[lot({ id: "a", qty: 6 }), lot({ id: "d", qty: 12, delivery_id: "d-1", cost_state: "final", unit_cost: 9 })]]);
    const r = await new OpeningCostService(db).uncosted("rest-1", "inv-1");
    expect(r).toEqual({ inventoryId: "inv-1", lots: 1, units: 6, emptyLots: 0 });
  });

  it("reads past the 1000-row cap, page by page", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => lot({ id: `p${i}`, qty: 1 }));
    const { db, calls } = lotsDb([full, [lot({ id: "last", qty: 2 })]]);
    const r = await new OpeningCostService(db).uncosted("rest-1", "inv-1");
    expect(r.lots).toBe(1001);
    expect(r.units).toBe(1002);
    expect(calls.filter((c) => c.method === "range").map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("nothing uncosted reads as zero lots, which hides the question", async () => {
    const { db } = lotsDb([[]]);
    const r = await new OpeningCostService(db).uncosted("rest-1", "inv-1");
    expect(r).toEqual({ inventoryId: "inv-1", lots: 0, units: 0, emptyLots: 0 });
  });

  it("a failed read is a 500, never a zero", async () => {
    const { db } = lotsDb([], { message: "timeout" });
    await expect(new OpeningCostService(db).uncosted("rest-1", "inv-1")).rejects.toMatchObject({ status: 500 });
  });
});

describe("GET /inventory/:restaurantId/item/:itemId/opening-cost — who may read it", () => {
  function controller(role: string | null) {
    const organizations = new OrganizationsService({} as never);
    jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
    const uncosted = jest.fn(async () => ({ lots: 1 }));
    const c = new InventoryController({} as any, organizations, {} as any, { uncosted } as unknown as OpeningCostService);
    return { c, uncosted };
  }

  it.each(["owner", "manager"])("a %s reads it for the house in the path", async (role) => {
    const { c, uncosted } = controller(role);
    await c.readOpeningCost("rest-1", "inv-1", { userId: "u-1" });
    expect(uncosted).toHaveBeenCalledWith("rest-1", "inv-1");
  });

  it.each(["staff", null])("%s is refused, and nothing is read", async (role) => {
    const { c, uncosted } = controller(role as string | null);
    await expect(c.readOpeningCost("rest-1", "inv-1", { userId: "u-1" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(uncosted).not.toHaveBeenCalled();
  });

  it("a session naming nobody is refused before the role is read", async () => {
    const { c, uncosted } = controller("owner");
    await expect(c.readOpeningCost("rest-1", "inv-1", undefined)).rejects.toMatchObject({ status: 403 });
    expect(uncosted).not.toHaveBeenCalled();
  });
});
