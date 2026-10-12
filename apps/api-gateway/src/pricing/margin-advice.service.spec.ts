import {
  BadRequestException,
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
  /** inventory_lots rows: the last price paid (F-1172). */
  lots?: Row[];
  lotsError?: { message: string } | null;
  /** house_price_locks rows (ADR 0193 round 3). */
  locks?: Row[];
  locksError?: { message: string } | null;
  users?: Row[];
  usersError?: { message: string } | null;
  /** menu_items rows: which stock rows only kitchen lines link to (F-1170). */
  menuLines?: Row[];
  menuLinesError?: { message: string } | null;
  rpc?: (fn: string, args: Row) => { data: unknown; error: unknown };
  /** house_tax_rates rows (F-620). */
  taxRates?: Row[];
  taxRatesError?: { message: string } | null;
  /**
   * PostgREST's max_rows (F-1369): when set, every answer stops at this many
   * rows, a page honours its id cursor and limit, and an exact count is told.
   */
  serverCap?: number;
}

function fakeClient(o: FakeOpts) {
  const selects: Array<[string, string]> = [];
  const inserts: Array<[string, Row]> = [];
  const rpcs: Array<[string, Row]> = [];
  /** Every .in() list, by table, with its length (F-1369). */
  const inLists: Array<[string, number]> = [];
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const extra: Array<(r: Row) => boolean> = [];
    let insertRow: Row | null = null;
    let after: string | null = null;
    let limitN: number | null = null;
    // Under a server cap, the answer is cut as PostgREST cuts it.
    const capped = (r: { data: any; error: any }) => {
      if (o.serverCap === undefined || !Array.isArray(r.data)) return r;
      let d: Row[] = r.data
        .slice()
        .sort((a: Row, b: Row) => (String(a.id) < String(b.id) ? -1 : 1));
      if (after !== null) d = d.filter((x) => String(x.id) > (after as string));
      const count = d.length;
      if (limitN !== null) d = d.slice(0, limitN);
      return { ...r, data: d.slice(0, o.serverCap), count };
    };
    const rows = (): { data: any; error: any } => {
      if (table === "house_price_locks") {
        if (o.locksError) return { data: null, error: o.locksError };
        return {
          data: (o.locks ?? []).filter((r) => filters.every(([c, v]) => r[c] === v) && extra.every((f) => f(r))),
          error: null,
        };
      }
      if (table === "users") {
        if (o.usersError) return { data: null, error: o.usersError };
        return { data: (o.users ?? []).filter((r) => extra.every((f) => f(r))), error: null };
      }
      if (table === "menu_items") {
        if (o.menuLinesError) return { data: null, error: o.menuLinesError };
        return {
          data: (o.menuLines ?? []).filter((r) => extra.every((f) => f(r))),
          error: null,
        };
      }
      // F-620: a house row states its tax basis (NOT NULL DEFAULT 'unset').
      if (table === "restaurants")
        return {
          data: o.house ? { tax_basis: "unset", ...o.house } : null,
          error: o.houseError ?? null,
        };
      if (table === "house_tax_rates") {
        if (o.taxRatesError) return { data: null, error: o.taxRatesError };
        return { data: o.taxRates ?? [], error: null };
      }
      if (table === "restaurant_inventory") {
        if (o.inventoryError) return { data: null, error: o.inventoryError };
        return {
          data: (o.inventory ?? []).filter((r) => filters.every(([c, v]) => c === "is_active" || r[c] === v)),
          error: null,
        };
      }
      if (table === "inventory_lots") {
        if (o.lotsError) return { data: null, error: o.lotsError };
        return {
          data: (o.lots ?? []).filter(
            (r) =>
              filters.every(([c, v]) => r[c] === v) && extra.every((f) => f(r)),
          ),
          error: null,
        };
      }
      if (table === "inventory_lot_rollup") {
        if (o.rollupError) return { data: null, error: o.rollupError };
        return {
          data: (o.rollup ?? []).filter(
            (r) =>
              filters.every(([c, v]) => r[c] === v || c === "restaurant_id") &&
              extra.every((f) => f(r)),
          ),
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
      is(c: string, v: unknown) {
        extra.push((r) => (r[c] ?? null) === v);
        return api;
      },
      in(c: string, vs: unknown[]) {
        inLists.push([table, vs.length]);
        extra.push((r) => vs.includes(r[c]));
        return api;
      },
      not(c: string, op: string, v: unknown) {
        if (op === "is" && v === null)
          extra.push((r) => (r[c] ?? null) !== null);
        return api;
      },
      neq(c: string, v: unknown) {
        extra.push((r) => r[c] !== v);
        return api;
      },
      gt(_c: string, v: string) {
        after = v;
        return api;
      },
      order() {
        return api;
      },
      limit(n: number) {
        limitN = n;
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
        resolve(capped(rows()));
      },
    };
    return api;
  };
  const rpc = async (fn: string, args: Row) => {
    rpcs.push([fn, args]);
    return o.rpc ? o.rpc(fn, args) : { data: { outcome: "changed" }, error: null };
  };
  return { client: { from, rpc } as any, selects, inserts, rpcs, inLists };
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

// F-1170: a food line set aside on the menu gets no margin advice.
describe("MarginAdviceService.adviseHouse -- a kitchen line's stock row is set aside", () => {
  const FOOD = { ...WINE_A, id: "inv-food", wine_name: "Grilled octopus" };
  const lines = [
    {
      id: "mi-1",
      inventory_item_id: "inv-food",
      category: "Starters",
      raw_extracted_text: "Grilled octopus,,24",
    },
    {
      id: "mi-2",
      inventory_item_id: "inv-a",
      category: "red",
      raw_extracted_text: "Barolo,Vietti,2019,red,50",
    },
  ];

  it("leaves out a row only kitchen lines link to, and advises the wine", async () => {
    const { svc } = service({
      house: HOUSE_SET,
      inventory: [WINE_A, FOOD],
      rollup: ROLLUP,
      menuLines: lines,
    });
    const out = await svc.adviseHouse("rest-1");
    expect(out.wines.map((w) => w.inventoryId)).toEqual(["inv-a"]);
  });

  it("keeps a row a drink line also links to", async () => {
    const both = [
      ...lines,
      {
        id: "mi-3",
        inventory_item_id: "inv-food",
        category: "white",
        raw_extracted_text: null,
      },
    ];
    const { svc } = service({
      house: HOUSE_SET,
      inventory: [WINE_A, FOOD],
      rollup: ROLLUP,
      menuLines: both,
    });
    const out = await svc.adviseHouse("rest-1");
    expect(out.wines.map((w) => w.inventoryId).sort()).toEqual([
      "inv-a",
      "inv-food",
    ]);
  });

  it("a failed read of the menu lines is an error, not food advised as a drink", async () => {
    const { svc } = service({
      house: HOUSE_SET,
      inventory: [WINE_A, FOOD],
      rollup: ROLLUP,
      menuLinesError: { message: "down" },
    });
    await expect(svc.adviseHouse("rest-1")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  // F-1234: the list leaves the row out, so a direct accept must not price it.
  it("accept refuses advice on a row only kitchen lines link to (400), and writes nothing", async () => {
    const { svc, inserts, rpcs } = service({
      house: HOUSE_SET,
      inventory: [WINE_A, FOOD],
      rollup: [{ ...ROLLUP[0], inventory_id: "inv-food" }],
      menuLines: lines,
      rpc: () => ({
        data: { outcome: "changed", bottle_price: 57.14 },
        error: null,
      }),
    });
    const p = svc.accept("rest-1", "inv-food", "bottle", 57.14, "user-9");
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(
      "This is a kitchen item on the menu, and price advice is for drinks only. Nothing was changed.",
    );
    expect(inserts).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it("accept still applies advice on a row a drink line also links to", async () => {
    const { svc, rpcs } = service({
      house: HOUSE_SET,
      inventory: [WINE_A],
      rollup: ROLLUP,
      menuLines: lines,
      rpc: () => ({
        data: { outcome: "changed", bottle_price: 57.14 },
        error: null,
      }),
    });
    await expect(
      svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9"),
    ).resolves.toMatchObject({
      outcome: "changed",
    });
    expect(rpcs).toHaveLength(1);
  });

  it("accept refuses when the menu lines cannot be read, never pricing blind", async () => {
    const { svc, inserts, rpcs } = service({
      house: HOUSE_SET,
      inventory: [WINE_A],
      rollup: ROLLUP,
      menuLinesError: { message: "down" },
    });
    await expect(
      svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(inserts).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });
});

describe("MarginAdviceService -- a cost in another money is never set against the menu (F-343)", () => {
  const TRY_HOUSE = { ...HOUSE_SET, currency: "TRY" };
  const EUR_LOT = [
    { ...ROLLUP[0], cost_currency: "EUR", cost_currency_count: 1 },
  ];

  it("a lot bought in EUR is not advised on against a menu in TRY, and says why", async () => {
    const { svc } = service({
      house: TRY_HOUSE,
      inventory: [WINE_A],
      rollup: EUR_LOT,
    });
    const a = (await svc.adviseHouse("rest-1")).wines[0];
    expect(a.costBasis).toBe("other_currency");
    expect(a.bottleCost).toBeNull();
    expect(a.bottle).toMatchObject({ state: "no_cost", advisedPrice: null });
    expect(a.bottle!.sentence).toMatch(
      /different currency from your menu prices/,
    );
    expect(a.glass).toMatchObject({ state: "no_cost", advisedPrice: null });
  });

  it("a WAC mixing two currencies is not advised on, whatever the house's money", async () => {
    const mixed = [
      { ...ROLLUP[0], cost_currency: null, cost_currency_count: 2 },
    ];
    const { svc } = service({
      house: TRY_HOUSE,
      inventory: [WINE_A],
      rollup: mixed,
    });
    const a = (await svc.adviseHouse("rest-1")).wines[0];
    expect(a.costBasis).toBe("other_currency");
    expect(a.bottle!.state).toBe("no_cost");
  });

  it("a lot in the house's own money is advised on as before", async () => {
    const tryLot = [
      { ...ROLLUP[0], cost_currency: "TRY", cost_currency_count: 1 },
    ];
    const { svc } = service({
      house: TRY_HOUSE,
      inventory: [WINE_A],
      rollup: tryLot,
    });
    const a = (await svc.adviseHouse("rest-1")).wines[0];
    expect(a.bottle).toMatchObject({ state: "raise", advisedPrice: 57.14 });
  });

  it("accept refuses to apply a price worked from a cost in another money", async () => {
    const { svc, inserts, rpcs } = service({
      house: TRY_HOUSE,
      inventory: [WINE_A],
      rollup: EUR_LOT,
    });
    await expect(
      svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inserts).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
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

/**
 * ADR 0193 round 3. The founder, 2026-09-21, verbatim: "Yes, confirmed per
 * wine" (a wine's own pour, used for glass advice only once an owner or
 * manager confirms it, else the house's confirmed pour); and "add a section
 * to that where you can lock price" (a locked kind keeps its advice, marked,
 * and cannot be accepted -- L7, L22, L25).
 */
describe("MarginAdviceService -- a wine's own confirmed pour (round 6c answer 3)", () => {
  const confirmed = (ml: number) => ({ pour_size_ml: ml, pour_size_confirmed_by: "user-1", pour_size_confirmed_at: "2026-09-21T10:00:00Z" });

  it("a confirmed 75 ml wine pour prices the glass: cost 20 x 75 / 750 = 2, 75 % target -> 8.00, so 10 is 'lower to 8'", async () => {
    const { svc } = service({ house: HOUSE_SET, inventory: [{ ...WINE_A, ...confirmed(75) }], rollup: ROLLUP });
    const a = (await svc.adviseHouse("rest-1")).wines[0];
    expect(a.pour).toEqual({ ml: 75, source: "wine" });
    expect(a.glass!.unitCost).toBeCloseTo(2, 10);
    expect(a.glass).toMatchObject({ state: "lower", advisedPrice: 8 });
  });

  it("a confirmed wine pour advises the glass even before the HOUSE confirms its own", async () => {
    const { svc } = service({ house: HOUSE_POUR_UNCONFIRMED, inventory: [{ ...WINE_A, ...confirmed(75) }], rollup: ROLLUP });
    const a = (await svc.adviseHouse("rest-1")).wines[0];
    expect(a.pour).toEqual({ ml: 75, source: "wine" });
    expect(a.glass!.state).toBe("lower");
  });

  it("an UNCONFIRMED wine pour is never read: the house's confirmed 150 ml prices the glass", async () => {
    // WINE_A carries pour_size_ml 50 with no confirmation.
    const { svc } = service({ house: HOUSE_SET, inventory: [WINE_A], rollup: ROLLUP });
    const a = (await svc.adviseHouse("rest-1")).wines[0];
    expect(a.pour).toEqual({ ml: 150, source: "house" });
    expect(a.glass!.unitCost).toBeCloseTo(4, 10);
  });

  it("a confirmation without its person is not a confirmation", async () => {
    const { svc } = service({
      house: HOUSE_POUR_UNCONFIRMED,
      inventory: [{ ...WINE_A, pour_size_ml: 75, pour_size_confirmed_at: "2026-09-21T10:00:00Z", pour_size_confirmed_by: null }],
      rollup: ROLLUP,
    });
    const a = (await svc.adviseHouse("rest-1")).wines[0];
    expect(a.pour).toEqual({ ml: null, source: null });
    expect(a.glass!.state).toBe("pour_unconfirmed");
  });

  it("the accepted glass advice records which pour priced it", async () => {
    const { svc, inserts } = service({
      house: HOUSE_SET,
      inventory: [{ ...WINE_A, ...confirmed(75) }],
      rollup: ROLLUP,
      rpc: () => ({ data: { outcome: "changed", held: [] }, error: null }),
    });
    await svc.accept("rest-1", "inv-a", "glass", 8, "user-9");
    expect(inserts[0][1].inputs).toMatchObject({ pourMl: 75, pourSource: "wine" });
  });
});

describe("MarginAdviceService -- a locked price keeps its advice and cannot be accepted (round 3)", () => {
  const LOCK_A_BOTTLE = {
    id: "lock-1",
    restaurant_id: "rest-1",
    inventory_id: "inv-a",
    kind: "bottle",
    locked_price: "50.00",
    locked_by: "user-5",
    locked_at: "2026-09-02T09:00:00Z",
    released_at: null,
  };
  const USERS = [{ user_id: "user-5", name: "Aylin" }];

  it("L22: the locked bottle is still advised (a true margin is never hidden) and marked with who and when", async () => {
    const { svc } = service({ house: HOUSE_SET, inventory: [WINE_A], rollup: ROLLUP, locks: [LOCK_A_BOTTLE] });
    const out = await svc.adviseHouse("rest-1");
    const a = out.wines[0];
    expect(a.bottle).toMatchObject({ state: "raise", advisedPrice: 57.14, locked: { lockId: "lock-1", lockedPrice: 50, lockedBy: "user-5" } });
    expect(a.glass!.locked).toBeNull();
    expect(out.locks).toEqual({ readable: true, reason: null, held: 1 });
  });

  it("a released lock marks nothing", async () => {
    const { svc } = service({
      house: HOUSE_SET,
      inventory: [WINE_A],
      rollup: ROLLUP,
      locks: [{ ...LOCK_A_BOTTLE, released_at: "2026-09-10T00:00:00Z" }],
    });
    const out = await svc.adviseHouse("rest-1");
    expect(out.wines[0].bottle!.locked).toBeNull();
    expect(out.locks.held).toBe(0);
  });

  it("L7: accepting advice on a locked kind is a 409 naming who locked it and when, and NOTHING is written", async () => {
    const { svc, inserts, rpcs } = service({ house: HOUSE_SET, inventory: [WINE_A], rollup: ROLLUP, locks: [LOCK_A_BOTTLE], users: USERS });
    const p = svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9");
    await expect(p).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9")).rejects.toThrow(
      /bottle price is locked at 50\.00 by Aylin since 2026-09-02\. Nothing was changed/,
    );
    expect(inserts).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it("L7: the free kind of a wine whose other kind is locked can still be accepted", async () => {
    const { svc, rpcs } = service({
      house: HOUSE_SET,
      inventory: [WINE_A],
      rollup: ROLLUP,
      locks: [LOCK_A_BOTTLE],
      rpc: () => ({ data: { outcome: "changed", held: [] }, error: null }),
    });
    await expect(svc.accept("rest-1", "inv-a", "glass", 16, "user-9")).resolves.toMatchObject({ outcome: "changed" });
    expect(rpcs).toHaveLength(1);
  });

  it("L25: a lock read that fails is said on the advice, and accept refuses (500) with nothing written", async () => {
    const { svc, inserts, rpcs } = service({ house: HOUSE_SET, inventory: [WINE_A], rollup: ROLLUP, locksError: { message: "denied" } });
    const out = await svc.adviseHouse("rest-1");
    expect(out.locks.readable).toBe(false);
    expect(out.locks.reason).toMatch(/could not be read \(denied\)/);
    await expect(svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9")).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(inserts).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it("L25: a lock whose author cannot be named still refuses, and says the name could not be read", async () => {
    const { svc } = service({ house: HOUSE_SET, inventory: [WINE_A], rollup: ROLLUP, locks: [LOCK_A_BOTTLE], usersError: { message: "timeout" } });
    await expect(svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9")).rejects.toThrow(
      /by a person whose name could not be read \(timeout\)/,
    );
  });

  it("L7 race: a lock landing between the check and the write is a 409; the advice record stays unapplied", async () => {
    const { svc, inserts, rpcs } = service({
      house: HOUSE_SET,
      inventory: [WINE_A],
      rollup: ROLLUP,
      rpc: () => ({
        data: { outcome: "locked", held: [{ kind: "bottle", lock_id: "lock-2", locked_price: 50, locked_by: "user-5", locked_at: "2026-09-21T12:00:00Z" }] },
        error: null,
      }),
    });
    await expect(svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9")).rejects.toThrow(
      /locked a moment ago at 50\.00, so it was not changed\. The advice is recorded \(analysis-1\) and not applied/,
    );
    expect(inserts).toHaveLength(1);
    expect(rpcs).toHaveLength(1);
  });
});

describe("MarginAdviceService -- a glass is a wine's pour (F-1171)", () => {
  // Coordinator's call 2026-10-10: the house's pour is a wine pour; until a
  // pour per kind exists, a rakı, a spirit or a beer gets no glass advice and
  // nothing to accept. Before, a 70 cl rakı at 150 ml read a fifth of the
  // bottle and was offered a one-tap Raise.
  const RAKI = {
    ...WINE_A,
    id: "inv-r",
    wine_name: "Yeni Rakı",
    kind: "spirit",
    bottle_size_ml: 700,
    pour_size_confirmed_by: "user-1",
    pour_size_confirmed_at: "2026-09-21T09:00:00Z",
  };
  const RAKI_LOT = [
    {
      inventory_id: "inv-r",
      restaurant_id: "rest-1",
      live_qty: 6,
      wac: "20",
      has_invoice_cost: true,
      wac_qty: 6,
    },
  ];

  it("a spirit gets no glass advice and its own sentence; its bottle is advised as before", async () => {
    const { svc } = service({
      house: HOUSE_SET,
      inventory: [RAKI],
      rollup: RAKI_LOT,
    });
    const out = await svc.adviseHouse("rest-1");
    const r = out.wines[0];
    expect(r.glass).toMatchObject({
      state: "pour_unconfirmed",
      advisedPrice: null,
      currentMarginPct: null,
      unitCost: null,
    });
    expect(r.glass!.sentence).toMatch(/No glass advice for this drink yet/);
    expect(r.pour).toEqual({ ml: null, source: null });
    expect(r.bottle).toMatchObject({ state: "raise", advisedPrice: 57.14 });
  });

  it("a spirit's glass cannot be accepted (409), nothing is written", async () => {
    const { svc, inserts, rpcs } = service({
      house: HOUSE_SET,
      inventory: [RAKI],
      rollup: RAKI_LOT,
    });
    await expect(
      svc.accept("rest-1", "inv-r", "glass", 16, "user-9"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inserts).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it("a wine row keeps its glass advice", async () => {
    const { svc } = service({
      house: HOUSE_SET,
      inventory: [{ ...WINE_A, kind: "wine" }],
      rollup: ROLLUP,
    });
    const out = await svc.adviseHouse("rest-1");
    expect(out.wines[0].glass).toMatchObject({
      state: "raise",
      advisedPrice: 16,
    });
  });
});

describe("MarginAdviceService -- a sold-out wine is costed at the last price paid (F-1172)", () => {
  // Nothing on hand: the rollup's WAC is null (it averages live bottles), so
  // the advice said "no recorded cost" with the invoices on file.
  const SOLD_OUT = [
    {
      inventory_id: "inv-a",
      restaurant_id: "rest-1",
      live_qty: 0,
      wac: null,
      has_invoice_cost: true,
      wac_qty: 0,
    },
  ];
  const LOTS = [
    {
      inventory_id: "inv-a",
      restaurant_id: "rest-1",
      stock_state: "live",
      qty: 0,
      unit_cost: "18.00",
      unit_cost_currency: null,
      cost_provenance: "invoice",
      received_at: "2026-08-01T00:00:00Z",
    },
    {
      inventory_id: "inv-a",
      restaurant_id: "rest-1",
      stock_state: "live",
      qty: 0,
      unit_cost: "20.00",
      unit_cost_currency: null,
      cost_provenance: "invoice",
      received_at: "2026-09-01T00:00:00Z",
    },
    {
      inventory_id: "inv-a",
      restaurant_id: "rest-1",
      stock_state: "live",
      qty: 0,
      unit_cost: "0",
      unit_cost_currency: null,
      cost_provenance: "sample",
      received_at: "2026-09-15T00:00:00Z",
    },
  ];

  it("advises on the most recent costed lot and says it is the last price paid", async () => {
    const { svc } = service({
      house: HOUSE_SET,
      inventory: [WINE_A],
      rollup: SOLD_OUT,
      lots: LOTS,
    });
    const out = await svc.adviseHouse("rest-1");
    const a = out.wines[0];
    expect(a.costBasis).toBe("last_paid_lot");
    expect(a.costBasisLabel).toBe("last price paid (none on hand)");
    expect(a.bottleCost).toBe(20);
    expect(a.bottle).toMatchObject({ state: "raise", advisedPrice: 57.14 });
    expect(a.bottle!.sentence).not.toMatch(/no recorded cost/);
    expect(a.bottle!.sentence).toMatch(
      /The cost is the last price paid, 20\.00 on 2026-09-01; none is on hand now\./,
    );
  });

  it("accepts the advice it showed", async () => {
    const { svc, rpcs } = service({
      house: HOUSE_SET,
      inventory: [WINE_A],
      rollup: SOLD_OUT,
      lots: LOTS,
    });
    const res = await svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9");
    expect(res.price).toBe(57.14);
    expect(rpcs).toHaveLength(1);
  });

  it("a lot bought in other money is not the cost", async () => {
    const eur = LOTS.map((l) => ({ ...l, unit_cost_currency: "EUR" }));
    const { svc } = service({
      house: { ...HOUSE_SET, currency: "TRY" },
      inventory: [WINE_A],
      rollup: SOLD_OUT,
      lots: eur,
    });
    const out = await svc.adviseHouse("rest-1");
    expect(out.wines[0].costBasis).toBe("unknown");
    expect(out.wines[0].bottle!.state).toBe("no_cost");
  });

  it("a failed read of the last prices paid is an error, never 'no recorded cost'", async () => {
    const { svc } = service({
      house: HOUSE_SET,
      inventory: [WINE_A],
      rollup: SOLD_OUT,
      lotsError: { message: "lots down" },
    });
    await expect(svc.adviseHouse("rest-1")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe("MarginAdviceService -- money in the house's own (F-1174)", () => {
  const TR_HOUSE = { ...HOUSE_SET, currency: "TRY", country: "TR" };

  it("the advice sentence prints the house's money and marks, not a bare 57.14", async () => {
    const { svc } = service({
      house: TR_HOUSE,
      inventory: [WINE_A],
      rollup: ROLLUP,
    });
    const out = await svc.adviseHouse("rest-1");
    const s = out.wines[0].bottle!.sentence;
    expect(s).not.toMatch(/57\.14/);
    expect(s).toMatch(/₺57,14/);
  });

  it("a lock refusal names the held price in the house's money", async () => {
    const { svc } = service({
      house: TR_HOUSE,
      inventory: [WINE_A],
      rollup: ROLLUP,
      locks: [
        {
          id: "lock-1",
          restaurant_id: "rest-1",
          inventory_id: "inv-a",
          kind: "bottle",
          locked_price: 1250,
          locked_by: "user-2",
          locked_at: "2026-09-21T10:00:00Z",
          released_at: null,
        },
      ],
      users: [{ user_id: "user-2", name: "Ayse" }],
    });
    const err = await svc
      .accept("rest-1", "inv-a", "bottle", 57.14, "user-9")
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toMatch(/locked at ₺1\.250,00/);
  });
});

// F-1369: a house past PostgREST's 1,000 rows. The wines and their lot costs
// were read unranged, so most wines got no advice and costed ones read "no
// recorded cost"; the uncosted ids went into one .in() of any length.
describe("MarginAdviceService -- a house with more than 1,000 wines (F-1369)", () => {
  const id = (i: number) => `inv-${String(i).padStart(5, "0")}`;
  const COSTED = 1200;
  const SOLD_OUT = 300;
  const inventory = Array.from({ length: COSTED + SOLD_OUT }, (_, i) => ({
    ...WINE_A,
    id: id(i),
    wine_name: `Wine ${i}`,
  }));
  const rollup = inventory.slice(0, COSTED).map((w) => ({
    ...ROLLUP[0],
    inventory_id: w.id,
  }));
  // Each sold-out wine has four costed lots on file: 1,200 rows in all.
  const lots = inventory.slice(COSTED).flatMap((w, i) =>
    [0, 1, 2, 3].map((k) => ({
      id: `lot-${String(i).padStart(5, "0")}-${k}`,
      inventory_id: w.id,
      restaurant_id: "rest-1",
      stock_state: "live",
      unit_cost: String(10 + k),
      unit_cost_currency: null,
      cost_provenance: "invoice",
      received_at: `2026-0${k + 1}-01T00:00:00Z`,
    })),
  );

  it("advises every wine, on its own cost, and no .in() list runs past 150 ids", async () => {
    const { svc, inLists } = service({
      house: HOUSE_SET,
      inventory,
      rollup,
      lots,
      serverCap: 1000,
    });
    const out = await svc.adviseHouse("rest-1");
    expect(out.wines).toHaveLength(COSTED + SOLD_OUT);
    const byId = new Map(out.wines.map((w) => [w.inventoryId, w]));
    for (let i = 0; i < COSTED; i++) {
      expect(byId.get(id(i))!.costBasis).toBe("invoice_lot_wac");
    }
    for (let i = COSTED; i < COSTED + SOLD_OUT; i++) {
      const w = byId.get(id(i))!;
      expect(w.costBasis).toBe("last_paid_lot");
      // The most recent lot: April, 13.
      expect(w.bottleCost).toBe(13);
    }
    expect(out.counts.no_cost).toBe(0);
    expect(inLists.length).toBeGreaterThan(0);
    for (const [, n] of inLists) expect(n).toBeLessThanOrEqual(150);
  });
});

/**
 * F-620, lane 4 of the tax-inclusive decision (founder 2026-10-12, S218: F1
 * build it, F2 only from now, F3 stamp cost basis). A house whose till prices
 * include tax is advised on the price without tax, only on a cost proven
 * pre-tax, only at a rate known for the wine, and only once its target has
 * been confirmed on the new basis. Every other house is advised exactly as
 * before.
 */
describe("MarginAdviceService -- a house whose till prices include tax (F-620)", () => {
  const SWITCH = "2026-10-12T08:00:00Z";
  const INCLUSIVE = {
    ...HOUSE_SET,
    currency: "TRY",
    timezone: "Europe/Istanbul",
    country: "TR",
    tax_basis: "prices_include_tax",
    tax_basis_confirmed_at: SWITCH,
    // The target was confirmed again after the switch.
    target_margin_set_at: "2026-10-12T09:00:00Z",
  };
  const KDV = { id: "r1", restaurant_id: "rest-1", version: 1, key_kind: "house", key: "", rate: "0.2000", effective_from: "2026-01-01", effective_to: null };
  // The ledger's wine: 600 on the menu, 200 cost.
  const RAKI_WINE = {
    ...WINE_A,
    id: "inv-k",
    wine_name: "Kavaklidere",
    sale_type: "bottle",
    menu_price_current: "600.00",
    menu_price_glass: null,
  };
  const STAMPED = [{ inventory_id: "inv-k", restaurant_id: "rest-1", live_qty: 6, wac: "200", has_invoice_cost: true, wac_qty: 6, wac_pre_tax_qty: 6, wac_tax_included_qty: 0 }];
  const UNSTAMPED = [{ ...STAMPED[0], wac_pre_tax_qty: 0 }];

  const strip = (o: any) => ({ ...o, generatedAt: "-" });

  it.each(["unset", "prices_exclude_tax", "not_vat_charging"])(
    "%s is a strict no-op: the same advice, key for key, and no rate is read",
    async (basis) => {
      const plain = await service({ house: HOUSE_SET, inventory: [WINE_A, WINE_NO_COST], rollup: ROLLUP }).svc.adviseHouse("rest-1");
      const f = service({
        house: { ...HOUSE_SET, tax_basis: basis, tax_basis_confirmed_at: basis === "unset" ? null : SWITCH, timezone: "America/New_York" },
        inventory: [WINE_A, WINE_NO_COST],
        rollup: ROLLUP,
        taxRates: [KDV],
      });
      const out = await f.svc.adviseHouse("rest-1");
      expect(strip(out)).toEqual(strip(plain));
      expect("pricesIncludeTax" in out).toBe(false);
      expect(Object.keys(out.counts).sort()).toEqual(
        ["lower", "no_cost", "no_price", "no_target", "on_target", "pour_unconfirmed", "raise"],
      );
      for (const w of out.wines) for (const a of [w.bottle, w.glass]) if (a) expect("taxRate" in a).toBe(false);
      expect(f.selects.some(([t]) => t === "house_tax_rates")).toBe(false);
    },
  );

  it("unset: accept records the rule it always did, with no tax key", async () => {
    const { svc, inserts } = service({ house: HOUSE_SET, inventory: [WINE_A], rollup: ROLLUP });
    await svc.accept("rest-1", "inv-a", "bottle", 57.14, "user-9");
    expect(inserts[0][1].inputs.rule).toBe("price = cost / (1 - target)");
    expect("taxRate" in inserts[0][1].inputs).toBe(false);
  });

  it("600 with 20 % KDV inside and a 200 cost proven pre-tax: a 60 % margin, raise to 685.71 on the menu", async () => {
    const { svc } = service({ house: INCLUSIVE, inventory: [RAKI_WINE], rollup: STAMPED, taxRates: [KDV] });
    const out = await svc.adviseHouse("rest-1");
    expect(out.pricesIncludeTax).toEqual({ since: SWITCH, targetReconfirm: false });
    const b = out.wines[0].bottle!;
    expect(b.currentMarginPct).toBeCloseTo(60, 6);
    expect(b).toMatchObject({ state: "raise", advisedPrice: 685.71, taxRate: 0.2 });
    expect(out.counts).toMatchObject({ raise: 1, cost_not_pre_tax: 0, no_tax_rate: 0, target_unconfirmed: 0 });
  });

  it("accept applies the tax-inclusive price and records the rate it divided out", async () => {
    const { svc, inserts, rpcs } = service({ house: INCLUSIVE, inventory: [RAKI_WINE], rollup: STAMPED, taxRates: [KDV] });
    await svc.accept("rest-1", "inv-k", "bottle", 685.71, "user-9");
    expect(inserts[0][1]).toMatchObject({ recommended_price: 685.71, current_price: 600 });
    expect(inserts[0][1].current_margin_pct).toBeCloseTo(0.6, 6);
    expect(inserts[0][1].inputs).toMatchObject({
      rule: "price = cost / (1 - target) * (1 + tax rate)",
      taxRate: 0.2,
      taxBasis: "prices_include_tax",
    });
    expect(rpcs[0][1]).toMatchObject({ p_bottle_price: 685.71 });
  });

  it("a WAC whose bottles do not say whether tax is inside: 'cost basis not stated', no margin, nothing to accept", async () => {
    const { svc, inserts, rpcs } = service({ house: INCLUSIVE, inventory: [RAKI_WINE], rollup: UNSTAMPED, taxRates: [KDV] });
    const b = (await svc.adviseHouse("rest-1")).wines[0].bottle!;
    expect(b.state).toBe("cost_not_pre_tax");
    expect(b.sentence).toMatch(/^Cannot advise: cost basis not stated\./);
    expect(b.currentMarginPct).toBeNull();
    await expect(svc.accept("rest-1", "inv-k", "bottle", 685.71, "user-9")).rejects.toBeInstanceOf(ConflictException);
    expect(inserts).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it("a WAC only partly stamped pre-tax is not proven", async () => {
    const { svc } = service({
      house: INCLUSIVE,
      inventory: [RAKI_WINE],
      rollup: [{ ...STAMPED[0], wac_pre_tax_qty: 5, wac_tax_included_qty: 1 }],
      taxRates: [KDV],
    });
    expect((await svc.adviseHouse("rest-1")).wines[0].bottle!.sentence).toMatch(/cost basis not stated/);
  });

  it("a cost recorded with tax inside is refused in its own words", async () => {
    const { svc } = service({
      house: INCLUSIVE,
      inventory: [RAKI_WINE],
      rollup: [{ ...STAMPED[0], wac_pre_tax_qty: 0, wac_tax_included_qty: 6 }],
      taxRates: [KDV],
    });
    const b = (await svc.adviseHouse("rest-1")).wines[0].bottle!;
    expect(b.state).toBe("cost_not_pre_tax");
    expect(b.sentence).toMatch(/recorded cost includes tax/);
  });

  it("the last purchase price is used only when it says no tax is inside", async () => {
    const proven = service({
      house: INCLUSIVE,
      inventory: [{ ...RAKI_WINE, last_purchase_price: "200", last_purchase_price_tax_basis: "excludes_tax" }],
      rollup: [],
      taxRates: [KDV],
    });
    expect((await proven.svc.adviseHouse("rest-1")).wines[0].bottle).toMatchObject({ state: "raise", advisedPrice: 685.71 });
    const unstated = service({
      house: INCLUSIVE,
      inventory: [{ ...RAKI_WINE, last_purchase_price: "200", last_purchase_price_tax_basis: null }],
      rollup: [],
      taxRates: [KDV],
    });
    expect((await unstated.svc.adviseHouse("rest-1")).wines[0].bottle!.state).toBe("cost_not_pre_tax");
  });

  it("the last price paid (F-1172) is used only when its lot says no tax is inside", async () => {
    const lot = { id: "lot-1", restaurant_id: "rest-1", inventory_id: "inv-k", stock_state: "live", unit_cost: "200", unit_cost_currency: "TRY", cost_provenance: "invoice", received_at: "2026-10-01" };
    const proven = service({ house: INCLUSIVE, inventory: [RAKI_WINE], rollup: [], lots: [{ ...lot, unit_cost_tax_basis: "excludes_tax" }], taxRates: [KDV] });
    expect((await proven.svc.adviseHouse("rest-1")).wines[0].bottle).toMatchObject({ state: "raise", advisedPrice: 685.71 });
    const unstated = service({ house: INCLUSIVE, inventory: [RAKI_WINE], rollup: [], lots: [lot], taxRates: [KDV] });
    expect((await unstated.svc.adviseHouse("rest-1")).wines[0].bottle!.state).toBe("cost_not_pre_tax");
  });

  it("the wine's own rate wins over the whole-house rate", async () => {
    const own = { ...KDV, id: "r2", version: 2, key_kind: "house_item", key: "inv-k", rate: "0.1000" };
    const { svc } = service({ house: INCLUSIVE, inventory: [RAKI_WINE], rollup: STAMPED, taxRates: [{ ...KDV, rate: "0.2000" }, own] });
    const b = (await svc.adviseHouse("rest-1")).wines[0].bottle!;
    // 200 / 0.35 * 1.1 = 628.57
    expect(b).toMatchObject({ taxRate: 0.1, advisedPrice: 628.57 });
  });

  it("rates set by till category are not guessed onto a wine, even with a whole-house rate", async () => {
    const cat = { ...KDV, id: "r2", version: 2, key_kind: "pos_category", key: "Alcohol", rate: "0.2000" };
    const { svc } = service({ house: INCLUSIVE, inventory: [RAKI_WINE], rollup: STAMPED, taxRates: [{ ...KDV, rate: "0.1000" }, cat] });
    const b = (await svc.adviseHouse("rest-1")).wines[0].bottle!;
    expect(b.state).toBe("no_tax_rate");
    expect(b.sentence).toMatch(/set by till category/);
  });

  it("no rate in force today, or no time zone: no_tax_rate, said", async () => {
    const none = service({ house: INCLUSIVE, inventory: [RAKI_WINE], rollup: STAMPED, taxRates: [] });
    expect((await none.svc.adviseHouse("rest-1")).wines[0].bottle!.sentence).toMatch(/no tax rate of this house is in force today/);
    const noZone = service({ house: { ...INCLUSIVE, timezone: null, country: null }, inventory: [RAKI_WINE], rollup: STAMPED, taxRates: [KDV] });
    expect((await noZone.svc.adviseHouse("rest-1")).wines[0].bottle!.sentence).toMatch(/time zone isn't set/);
  });

  it("a target set before the switch is asked for again on every line, and cannot be accepted", async () => {
    const { svc, inserts } = service({
      house: { ...INCLUSIVE, target_margin_set_at: "2026-09-21T09:00:00Z" },
      inventory: [RAKI_WINE],
      rollup: STAMPED,
      taxRates: [KDV],
    });
    const out = await svc.adviseHouse("rest-1");
    expect(out.pricesIncludeTax).toEqual({ since: SWITCH, targetReconfirm: true });
    expect(out.wines[0].bottle).toMatchObject({ state: "target_unconfirmed", currentMarginPct: null });
    expect(out.counts.target_unconfirmed).toBe(1);
    await expect(svc.accept("rest-1", "inv-k", "bottle", 685.71, "user-9")).rejects.toBeInstanceOf(ConflictException);
    expect(inserts).toHaveLength(0);
  });

  it("a basis or rate table that cannot be read is a refusal, never 'unset'", async () => {
    const rates = service({ house: INCLUSIVE, inventory: [RAKI_WINE], rollup: STAMPED, taxRatesError: { message: "denied" } });
    await expect(rates.svc.adviseHouse("rest-1")).rejects.toThrow(/prices include tax could not be read/);
    await expect(rates.svc.accept("rest-1", "inv-k", "bottle", 685.71, "user-9")).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(rates.inserts).toHaveLength(0);
    const odd = service({ house: { ...INCLUSIVE, tax_basis: "sometimes" }, inventory: [RAKI_WINE], rollup: STAMPED });
    await expect(odd.svc.adviseHouse("rest-1")).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
