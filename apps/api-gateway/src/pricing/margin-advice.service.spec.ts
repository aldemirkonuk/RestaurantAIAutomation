import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { MarginAdviceService } from "./margin-advice.service";

/**
 * ADR 0193 -- per-wine advice toward the house's target margin, and the one
 * tap that applies it. The service runs for real against a fake Supabase
 * client that answers by table and records every select, insert and rpc, so
 * what is exercised is the service's own reading, arithmetic and writing.
 */

type Row = Record<string, any>;

interface FakeOpts {
  house?: Row | null;
  houseError?: { message: string } | null;
  inventory?: Row[];
  inventoryError?: { message: string } | null;
  rollup?: Row[];
  rollupError?: { message: string } | null;
  rpc?: (fn: string, args: Row) => { data: unknown; error: unknown };
}

function fakeClient(o: FakeOpts) {
  const selects: Array<[string, string]> = [];
  const inserts: Array<[string, Row]> = [];
  const rpcs: Array<[string, Row]> = [];
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let insertRow: Row | null = null;
    const rows = (): { data: any; error: any } => {
      if (table === "restaurants") return { data: o.house ?? null, error: o.houseError ?? null };
      if (table === "restaurant_inventory") {
        if (o.inventoryError) return { data: null, error: o.inventoryError };
        return {
          data: (o.inventory ?? []).filter((r) => filters.every(([c, v]) => c === "is_active" || r[c] === v)),
          error: null,
        };
      }
      if (table === "inventory_lot_rollup") {
        if (o.rollupError) return { data: null, error: o.rollupError };
        return {
          data: (o.rollup ?? []).filter((r) => filters.every(([c, v]) => r[c] === v || c === "restaurant_id")),
          error: null,
        };
      }
      return { data: [], error: null };
    };
    const api: any = {
      select(cols: string) {
        selects.push([table, cols]);
        return api;
      },
      eq(c: string, v: unknown) {
        filters.push([c, v]);
        return api;
      },
      insert(row: Row) {
        insertRow = row;
        inserts.push([table, row]);
        return api;
      },
      maybeSingle: async () => {
        const r = rows();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      single: async () => {
        if (insertRow) return { data: { id: "analysis-1" }, error: null };
        const r = rows();
        return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error };
      },
      then(resolve: any) {
        resolve(rows());
      },
    };
    return api;
  };
  const rpc = async (fn: string, args: Row) => {
    rpcs.push([fn, args]);
    return o.rpc ? o.rpc(fn, args) : { data: { outcome: "changed" }, error: null };
  };
  return { client: { from, rpc } as any, selects, inserts, rpcs };
}

function service(o: FakeOpts) {
  const f = fakeClient(o);
  const svc = new MarginAdviceService({ client: f.client } as any);
  return { svc, ...f };
}

// "Close enough" is a PERCENT of the advised price (founder, 2026-09-21). The
// house has confirmed a 150 ml pour, so glasses are advised.
const HOUSE_SET = {
  target_margin_bottle_pct: "65.00",
  target_margin_glass_pct: "75.00",
  target_margin_band_pct: "2.00",
  target_margin_set_by: "user-1",
  target_margin_set_at: "2026-09-21T09:00:00Z",
  default_pour_ml: 150,
  pour_size_confirmed_by: "user-1",
  pour_size_confirmed_at: "2026-09-21T09:05:00Z",
};
// Same targets, pour never confirmed: default_pour_ml is the column's DEFAULT 150.
const HOUSE_POUR_UNCONFIRMED = {
  ...HOUSE_SET,
  pour_size_confirmed_by: null,
  pour_size_confirmed_at: null,
};
const HOUSE_UNSET = {
  target_margin_bottle_pct: null,
  target_margin_glass_pct: null,
  target_margin_band_pct: null,
  target_margin_set_by: null,
  target_margin_set_at: null,
  default_pour_ml: 150,
  pour_size_confirmed_by: null,
  pour_size_confirmed_at: null,
};

const WINE_A = {
  id: "inv-a",
  restaurant_id: "rest-1",
  wine_name: "Barolo",
  sale_type: "both",
  menu_price_current: "50.00",
  menu_price_glass: "10.00",
  last_purchase_price: null,
  bottle_size_ml: 750,
  // A per-wine pour the advice must NOT read: it carries a database DEFAULT
  // and cannot be told from a typed value (ADR 0193 F7). Were it read, the
  // glass cost below would be 20 x 50 / 750 = 1.33, not 4.
  pour_size_ml: 50,
  master_wine_library: { name: "Barolo DOCG", bottle_size_ml: 750 },
};
const WINE_NO_COST = {
  ...WINE_A,
  id: "inv-b",
  wine_name: "Mystery",
  sale_type: "bottle",
  menu_price_glass: null,
};
// Invoiced lot WAC 20 for wine A; nothing for B.
const ROLLUP = [{ inventory_id: "inv-a", restaurant_id: "rest-1", live_qty: 6, wac: "20", has_invoice_cost: true, wac_qty: 6 }];

describe("MarginAdviceService.adviseHouse", () => {
  it("advises each wine toward the house's own target: bottle 50 -> raise to 57.14, glass 10 (cost 4, 75 %) -> raise to 16.00", async () => {
    const { svc } = service({ house: HOUSE_SET, inventory: [WINE_A, WINE_NO_COST], rollup: ROLLUP });
    const out = await svc.adviseHouse("rest-1");

    expect(out.target).toEqual({
      bottlePct: 65,
      glassPct: 75,
      bandPct: 2,
      set: true,
      pourConfirmed: true,
      pourMl: 150,
    });
    const a = out.wines.find((w) => w.inventoryId === "inv-a")!;
    expect(a.costBasis).toBe("invoice_lot_wac");
    expect(a.bottle).toMatchObject({ state: "raise", advisedPrice: 57.14, price: 50 });
    expect(a.glass).toMatchObject({ state: "raise", advisedPrice: 16, price: 10 });
    expect(a.glass!.unitCost).toBeCloseTo(4, 10);
    expect(a.bottle!.gapPct).toBeCloseTo(-12.5, 6);

    const b = out.wines.find((w) => w.inventoryId === "inv-b")!;
    expect(b.bottle!.state).toBe("no_cost");
    expect(b.glass).toBeNull(); // bottle-only wine, no glass price: no glass line at all
    expect(out.counts).toMatchObject({ raise: 2, no_cost: 1, lower: 0, on_target: 0 });
  });

  it("the house has not confirmed its pour: every glass waits, bottles are advised as before", async () => {
    const { svc } = service({ house: HOUSE_POUR_UNCONFIRMED, inventory: [WINE_A], rollup: ROLLUP });
    const out = await svc.adviseHouse("rest-1");
    expect(out.target).toMatchObject({ pourConfirmed: false, pourMl: null });
    const a = out.wines[0];
    expect(a.glass).toMatchObject({ state: "pour_unconfirmed", advisedPrice: null, currentMarginPct: null });
    expect(a.bottle).toMatchObject({ state: "raise", advisedPrice: 57.14 });
    expect(out.counts).toMatchObject({ pour_unconfirmed: 1, raise: 1 });
  });

  it("an unconfirmed pour cannot be accepted for a glass (409), nothing is written", async () => {
    const { svc, inserts, rpcs } = service({ house: HOUSE_POUR_UNCONFIRMED, inventory: [WINE_A], rollup: ROLLUP });
    await expect(svc.accept("rest-1", "inv-a", "glass", 16, "user-9")).rejects.toBeInstanceOf(ConflictException);
    expect(inserts).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it("no target set: every line says 'no target', and nothing is advised", async () => {
    const { svc } = service({ house: HOUSE_UNSET, inventory: [WINE_A], rollup: ROLLUP });
    const out = await svc.adviseHouse("rest-1");
    expect(out.target.set).toBe(false);
    expect(out.wines[0].bottle!.state).toBe("no_target");
    expect(out.wines[0].glass!.state).toBe("no_target");
    expect(out.counts.raise + out.counts.lower).toBe(0);
  });

  it("a failed wine read is an error, never an empty list", async () => {
    const { svc } = service({ house: HOUSE_SET, inventoryError: { message: "boom" } });
    await expect(svc.adviseHouse("rest-1")).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("a failed cost read is an error -- not every wine silently 'no recorded cost'", async () => {
    const { svc } = service({ house: HOUSE_SET, inventory: [WINE_A], rollupError: { message: "view down" } });
    await expect(svc.adviseHouse("rest-1")).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("a failed target read is an error -- not 'no target set'", async () => {
    const { svc } = service({ houseError: { message: "denied" }, inventory: [WINE_A], rollup: ROLLUP });
    await expect(svc.adviseHouse("rest-1")).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("never reads the market average (founder: 'We don't want market average')", async () => {
    const { svc, selects } = service({ house: HOUSE_SET, inventory: [WINE_A], rollup: ROLLUP });
    await svc.adviseHouse("rest-1");
    for (const [, cols] of selects) {
      expect(cols).not.toMatch(/retail_price_avg|price_reference|markup_ratio/);
    }
  });
});

describe("MarginAdviceService.accept — one tap, applied only when a manager accepts", () => {
  it("records the why, then writes the advised price as 'agent_accepted' by the person, pointing at that record", async () => {
    const { svc, inserts, rpcs } = service({
      house: HOUSE_SET,
      inventory: [WINE_A],
      rollup: ROLLUP,
      rpc: () => ({ data: { outcome: "changed", bottle_price: 57.14, glass_price: 10 }, error: null }),
    });

    const r = await svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9");

    expect(inserts).toHaveLength(1);
    const [table, row] = inserts[0];
    expect(table).toBe("pricing_analyses");
    expect(row).toMatchObject({
      restaurant_id: "rest-1",
      inventory_id: "inv-a",
      recommended_price: 57.14,
      margin_floor_pct: 0.65,
      price_kind: "bottle",
      band_pct: 2,
      elasticity_method: null,
      engine_version: "margin-to-target/1",
    });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0][0]).toBe("set_house_menu_price");
    expect(rpcs[0][1]).toMatchObject({
      p_restaurant_id: "rest-1",
      p_inventory_id: "inv-a",
      p_set_bottle: true,
      p_bottle_price: 57.14,
      p_set_glass: false,
      p_change_source: "agent_accepted",
      p_changed_by: "user-9",
      p_pricing_analysis_id: "analysis-1",
      p_unit_cost: 20,
    });
    expect(r).toMatchObject({ outcome: "changed", price: 57.14, previousPrice: 50, pricingAnalysisId: "analysis-1" });
  });

  it("a stale screen (the advice moved) is a 409 and NOTHING is written", async () => {
    const { svc, inserts, rpcs } = service({ house: HOUSE_SET, inventory: [WINE_A], rollup: ROLLUP });
    await expect(svc.accept("rest-1", "inv-a", "bottle", 57.0, "user-9")).rejects.toBeInstanceOf(ConflictException);
    expect(inserts).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it("no target set: there is nothing to accept (409), nothing is written", async () => {
    const { svc, inserts, rpcs } = service({ house: HOUSE_UNSET, inventory: [WINE_A], rollup: ROLLUP });
    await expect(svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9")).rejects.toBeInstanceOf(ConflictException);
    expect(inserts).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it("a wine on target has no advice to accept (409)", async () => {
    const { svc, rpcs } = service({
      house: HOUSE_SET,
      inventory: [{ ...WINE_A, menu_price_current: "57.14" }],
      rollup: ROLLUP,
    });
    await expect(svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9")).rejects.toBeInstanceOf(ConflictException);
    expect(rpcs).toHaveLength(0);
  });

  it("another house's wine (not found under this house) is a 404", async () => {
    const { svc, rpcs } = service({
      house: HOUSE_SET,
      inventory: [{ ...WINE_A, restaurant_id: "rest-2" }],
      rollup: ROLLUP,
    });
    await expect(svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9")).rejects.toBeInstanceOf(NotFoundException);
    expect(rpcs).toHaveLength(0);
  });
});
