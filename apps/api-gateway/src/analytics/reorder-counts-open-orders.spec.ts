import { AnalyticsService } from "./analytics.service";
import { RecommendationsService } from "./recommendations.service";

/**
 * F-630: "Stockout imminent — place the order today" for a wine already on
 * order. Reorder science read the shelf alone; an order placed on Monday did
 * not count, and Tuesday's card asked for it again.
 */

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/** A client whose reads answer per table, with every filter passed through. */
function client(rows: Record<string, any[] | "fail">) {
  return {
    from: (table: string) => {
      const b: any = {};
      for (const m of ["select", "eq", "in", "not", "gte", "order", "limit"])
        b[m] = () => b;
      b.then = (resolve: any, reject: any) =>
        Promise.resolve(
          rows[table] === "fail"
            ? { data: null, error: { message: "statement timeout" } }
            : { data: rows[table] ?? [], error: null },
        ).then(resolve, reject);
      // The house's currency read (F-343) asks for one row (integ stub).
      b.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return b;
    },
  };
}

async function science(orders: any[] | "fail") {
  const db = client({
    restaurant_inventory: [
      {
        id: "inv-1",
        wine_name: "Etna Rosso",
        stock_live: 3,
        menu_price_current: 60,
        last_purchase_price: 20,
        threshold_min: 0,
        master_wine_id: "m-1",
      },
    ],
    inventory_lot_rollup: [],
    procurement_orders: orders,
  });
  const service = new AnalyticsService({ getClient: () => db } as any);
  // Two bottles a night for the whole window.
  jest.spyOn(service as any, "loadConsumption").mockResolvedValue(
    Array.from({ length: 89 }, (_, i) => ({
      masterWineId: "m-1",
      inventoryId: "inv-1",
      qty: 2,
      date: dayBack(i + 1),
    })),
  );
  return service.getInventoryScience("r1");
}

describe("reorder science counts bottles already on order (F-630)", () => {
  it("control: three bottles on the shelf and nothing on order is a reorder", async () => {
    const out: any = await science([]);
    expect(out.reorderList.map((s: any) => s.id)).toEqual(["inv-1"]);
    expect(out.reorderList[0].onOrder).toBe(0);
  });

  it("[REVERT-FAILS] a wine whose open order covers its reorder point is not on the list", async () => {
    const out: any = await science([
      {
        inventory_id: "inv-1",
        bottles_total: 48,
        expected_delivery_date: "2026-10-12",
      },
    ]);
    expect(out.reorderList).toEqual([]);
    const sku = out.skus.find((s: any) => s.id === "inv-1");
    expect(sku.onHand).toBe(3);
    expect(sku.onOrder).toBe(48);
    expect(sku.nextArrival).toBe("2026-10-12");
  });

  it("an open order with no bottle count is not counted, and says it could not be", async () => {
    const out: any = await science([
      { inventory_id: "inv-1", bottles_total: null, expected_delivery_date: null },
    ]);
    expect(out.reorderList[0].onOrder).toBeNull();
  });

  it("a failed read of the orders is not 'nothing on order'", async () => {
    const out: any = await science("fail");
    expect(out.reorderList[0].onOrder).toBeNull();
  });
});

function recs(top: Record<string, unknown>) {
  const supabase = client({});
  return new RecommendationsService(
    {
      getFinancialSummary: async () => null,
      getRiskProfile: async () => null,
      getInventoryScience: async () => ({ reorderList: [top] }),
    } as any,
    {
      getMenuEngineering: async () => null,
      getSeasonality: async () => null,
      getCashflow: async () => null,
    } as any,
    { generate: async () => ({ insights: [] }) } as any,
    { listGoals: async () => [] } as any,
    {
      readDispositions: async () => ({
        map: new Map(),
        readable: true,
        problem: null,
      }),
    } as any,
    { supabase, getClient: () => supabase } as any,
  );
}

async function stockoutCard(top: Record<string, unknown>) {
  const out = await recs({
    name: "Etna Rosso",
    stockoutProbability: 0.7,
    onHand: 3,
    reorderPoint: 30,
    ...top,
  }).getRecommendations("r1");
  return out.recommendations.find((r) => r.ruleKey === "stockout_imminent");
}

describe("the stockout card names what is already on order (F-630)", () => {
  it("control: nothing on order — place the order today", async () => {
    const card = await stockoutCard({ onOrder: 0 });
    expect(card?.recommendation).toMatch(/^Place the order today/);
    expect(card?.observation).not.toContain("already on order");
  });

  it("[REVERT-FAILS] an order already open is named, with its arrival, and the ask is for more", async () => {
    const card = await stockoutCard({ onOrder: 12, nextArrival: "2026-10-12" });
    expect(card?.observation).toContain(
      "already on order: 12, arriving 2026-10-12",
    );
    expect(card?.recommendation).toMatch(
      /^Order more today — even with the 12 bottles already on order/,
    );
  });

  it("[REVERT-FAILS] an uncounted order sends the owner to Orders first", async () => {
    const card = await stockoutCard({ onOrder: null });
    expect(card?.recommendation).toMatch(/^Check Orders before you order more/);
  });
});
