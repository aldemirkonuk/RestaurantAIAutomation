import { Logger } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";

/**
 * r110 g3: after a checked paper, the sales of its good that sold with no
 * cost are costed from it (cost_unpriced_sales), in the house's currency only.
 * A paper in another currency costs nothing and says why (DD-r105-19).
 */
function build(orderCurrency: string | null, houseCurrency: string | null) {
  const rpc = jest.fn().mockResolvedValue({ data: { rows_costed: 2 }, error: null });
  const seen: Record<string, Record<string, unknown>> = {};
  const supabase = {
    from(table: string) {
      seen[table] = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => ((seen[table][k] = v), q),
        then: (res: any, rej: any) =>
          Promise.resolve({
            data: [{ currency: table === "restaurants" ? houseCurrency : orderCurrency }],
            error: null,
          }).then(res, rej),
      };
      return q;
    },
    rpc,
  };
  const svc = new ProcurementService({ supabase } as any, {} as any, {} as any);
  return { svc, rpc, seen };
}

describe("costUnpricedSales — the house's currency only", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("a paper in the house's currency costs the sales, naming the order and the house", async () => {
    const { svc, rpc, seen } = build("usd", "USD");
    await expect(svc.costUnpricedSales("house-a", "inv-1", "ord-1", 7.77, "u1")).resolves.toEqual({
      rowsCosted: 2,
      refused: null,
    });
    expect(rpc).toHaveBeenCalledWith("cost_unpriced_sales", {
      p_restaurant_id: "house-a",
      p_inventory_id: "inv-1",
      p_order_id: "ord-1",
      p_unit_cost: 7.77,
      p_performed_by: "u1",
    });
    expect(seen.procurement_orders).toEqual({ id: "ord-1", restaurant_id: "house-a" });
  });

  it("a TRY paper in a USD house costs nothing and says why", async () => {
    const { svc, rpc } = build("TRY", "USD");
    const out = await svc.costUnpricedSales("house-a", "inv-1", "ord-1", 300);
    expect(rpc).not.toHaveBeenCalled();
    expect(out.rowsCosted).toBe(0);
    expect(out.refused).toBe(
      "a paper in TRY costs nothing in a USD house, so the sales that sold with no cost were not costed from it",
    );
    expect(warn).toHaveBeenCalled();
  });

  it("an unstated currency costs nothing, never assumed to be the house's", async () => {
    const { svc, rpc } = build(null, "USD");
    const out = await svc.costUnpricedSales("house-a", "inv-1", "ord-1", 7.77);
    expect(rpc).not.toHaveBeenCalled();
    expect(out.refused).toMatch(/not stated/);
  });
});

describe("verifyReceipt's price correction costs the unpriced sales after the restate", () => {
  it("calls cost_unpriced_sales once, after restate_sale_cost, with the verified cost", async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const order: string[] = [];
    const rpc = jest.fn(async (name: string) => {
      order.push(name);
      if (name === "revalue_lot") return { data: { lots_matched: 1, lots_revalued: 1 }, error: null };
      if (name === "restate_sale_cost") return { data: { rows_restated: 0, rows_capped: 0 }, error: null };
      return { data: { rows_costed: 1 }, error: null };
    });
    const supabase = {
      from(table: string) {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: { id: "inv-1" }, error: null }),
          then: (res: any, rej: any) =>
            Promise.resolve({ data: [{ currency: "USD" }], error: null }).then(res, rej),
        };
        return q;
      },
      rpc,
    };
    const svc = new ProcurementService({ supabase } as any, {} as any, {} as any);
    await (svc as any).applyReceiptAdjustment("house-a", "ord-1", "inv-1", 0, "r", 7.77, "u1");
    expect(order).toEqual(["revalue_lot", "restate_sale_cost", "cost_unpriced_sales"]);
    expect(rpc).toHaveBeenLastCalledWith("cost_unpriced_sales", expect.objectContaining({ p_unit_cost: 7.77 }));
    jest.restoreAllMocks();
  });
});
