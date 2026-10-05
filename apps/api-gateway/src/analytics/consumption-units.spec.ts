import {
  STOCK_STAND_IN_BOTTLE_ML,
  UncountedConsumptionError,
  bottlesOf,
  summarizeUnits,
  unitsBasisSentence,
} from "./consumption-units";
import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { GoalsService } from "./goals.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";

/**
 * A glass is not a bottle (AW02, ADR 0297).
 *
 * `wine_consumption_log.quantity` counts servings in the line's own mode
 * (ADR 0011; pos-hub.service.ts:1018-1022, :1060). Every demand reader took
 * it as bottles, so ten 150 ml glasses from a 750 ml bottle read as ten
 * bottles sold instead of two. The reader cases below FAIL on the readers as
 * they stood at efd8de7ea and pass once each one converts through
 * `bottlesOf`.
 */

// ---------------------------------------------------------------------------
// The helper
// ---------------------------------------------------------------------------

describe("bottlesOf — a line's bottles come from its own mode", () => {
  it("H1: a bottle line is its quantity", () => {
    expect(
      bottlesOf({
        consumption_type: "bottle",
        quantity: 2,
        volume_ml: 1500,
        restaurant_inventory: { bottle_size_ml: 750 },
      }),
    ).toEqual({ bottles: 2, how: "bottle" });
  });

  it("H2: a bottle line of an unsized item is its quantity; a bottle line never reads the size", () => {
    expect(
      bottlesOf({
        consumption_type: "bottle",
        quantity: 1,
        volume_ml: 750,
        restaurant_inventory: { bottle_size_ml: null },
      }),
    ).toEqual({ bottles: 1, how: "bottle" });
    // A magnum sold whole is one bottle off the shelf, not two.
    expect(
      bottlesOf({
        consumption_type: "bottle",
        quantity: 1,
        volume_ml: 1500,
        restaurant_inventory: { bottle_size_ml: 1500 },
      }).bottles,
    ).toBe(1);
  });

  it("H3: a 150 ml glass of a 750 ml bottle is a fifth of a bottle", () => {
    expect(
      bottlesOf({
        consumption_type: "glass",
        quantity: 1,
        volume_ml: 150,
        restaurant_inventory: { bottle_size_ml: 750 },
      }),
    ).toEqual({ bottles: 0.2, how: "stated_size" });
  });

  it("H4: three rakı singles read over the item's own 700 ml, not 750", () => {
    const out = bottlesOf({
      consumption_type: "glass",
      quantity: 3,
      volume_ml: 150,
      restaurant_inventory: { bottle_size_ml: 700 },
    });
    expect(out.bottles).toBeCloseTo(150 / 700, 12);
    expect(out.how).toBe("stated_size");
  });

  it("H5: a glass of an unsized item rests on the stock's 750 ml stand-in, labelled (fork 1)", () => {
    expect(STOCK_STAND_IN_BOTTLE_ML).toBe(750);
    expect(
      bottlesOf({
        consumption_type: "glass",
        quantity: 1,
        volume_ml: 150,
        restaurant_inventory: { bottle_size_ml: null },
      }),
    ).toEqual({ bottles: 0.2, how: "stand_in" });
    // No embed at all is the same: no size was stated.
    expect(
      bottlesOf({ consumption_type: "glass", quantity: 1, volume_ml: 150 }).how,
    ).toBe("stand_in");
  });

  it("H6: a glass line with no positive millilitres has no bottle figure, never 1", () => {
    for (const volume_ml of [0, null, undefined, -150, "abc"])
      expect(
        bottlesOf({
          consumption_type: "glass",
          quantity: 1,
          volume_ml,
          restaurant_inventory: { bottle_size_ml: 750 },
        }),
      ).toEqual({ bottles: null, how: "uncounted" });
  });

  it("H7: a line with no mode has no bottle figure, never its quantity", () => {
    for (const consumption_type of [undefined, null, "", "carafe"])
      expect(
        bottlesOf({
          consumption_type,
          quantity: 4,
          volume_ml: 600,
          restaurant_inventory: { bottle_size_ml: 750 },
        }),
      ).toEqual({ bottles: null, how: "uncounted" });
    // A bottle line with no usable count is not counted either.
    expect(bottlesOf({ consumption_type: "bottle", quantity: null }).how).toBe(
      "uncounted",
    );
  });

  it("H8: a size of 0 or below is no size, so the line rests on the stand-in", () => {
    for (const bottle_size_ml of [0, -750, "0"])
      expect(
        bottlesOf({
          consumption_type: "glass",
          quantity: 1,
          volume_ml: 150,
          restaurant_inventory: { bottle_size_ml },
        }),
      ).toEqual({ bottles: 0.2, how: "stand_in" });
  });

  it("H9: the coverage counts lines and items, and the sentence names both", () => {
    const cov = summarizeUnits([
      { how: "bottle", inventoryId: "a" },
      { how: "stated_size", inventoryId: "b" },
      { how: "stand_in", inventoryId: "c" },
      { how: "stand_in", inventoryId: "c" },
      { how: "stand_in", inventoryId: "d" },
      { how: "uncounted", inventoryId: "e" },
    ]);
    expect(cov).toEqual({
      lines: 6,
      glassLines: 4,
      standInLines: 3,
      standInItems: 2,
      uncountedLines: 1,
      uncountedItems: 1,
      complete: false,
    });
    const s = unitsBasisSentence(cov);
    expect(s).toContain("3 glass lines across 2 items");
    expect(s).toContain("750 ml stand-in");
    expect(s).toContain("1 line across 1 item carries no bottle figure");

    const sized = summarizeUnits([
      { how: "bottle", inventoryId: "a" },
      { how: "stated_size", inventoryId: "b" },
    ]);
    expect(sized.complete).toBe(true);
    expect(unitsBasisSentence(sized)).toContain(
      "every glass line's item states its bottle size",
    );
    expect(unitsBasisSentence(sized)).toContain("every line has a bottle figure");
    expect(unitsBasisSentence(summarizeUnits([]))).toBe(
      "no consumption lines in this window",
    );
  });
});

// ---------------------------------------------------------------------------
// The readers, through a stub that pages the way readWholeWindow reads
// ---------------------------------------------------------------------------

type Rows = Record<string, any[]>;

/** Keyset paging on `id`, an exact count past the cursor, filters ignored. */
function dbOver(rowsByTable: Rows) {
  const client = {
    from(table: string) {
      const all = [...(rowsByTable[table] ?? [])].sort((a, b) =>
        String(a.id ?? "").localeCompare(String(b.id ?? "")),
      );
      let cursor: string | null = null;
      let lim: number | null = null;
      let counted = false;
      const b: any = {};
      for (const m of ["eq", "neq", "gte", "lte", "lt", "in", "is", "or", "not"])
        b[m] = () => b;
      b.select = (_cols: string, opts?: { count?: string }) => {
        if (opts?.count === "exact") counted = true;
        return b;
      };
      b.order = () => b;
      b.gt = (col: string, v: unknown) => {
        if (col === "id") cursor = String(v);
        return b;
      };
      b.limit = (n: number) => {
        lim = n;
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: null, error: null });
      b.then = (resolve: any, reject: any) => {
        const past =
          cursor === null
            ? all
            : all.filter((r) => String(r.id).localeCompare(cursor as string) > 0);
        return Promise.resolve({
          data: lim === null ? past : past.slice(0, lim),
          error: null,
          count: counted ? past.length : undefined,
        }).then(resolve, reject);
      };
      return b;
    },
  };
  return { getClient: () => client } as any;
}

const RESTAURANT = "44444444-4444-4444-4444-444444444444";
const daysAgo = (d: number) =>
  new Date(Date.now() - d * 86400000 - 3600000).toISOString();

/** A priced, on-hand row whose size is stated. */
const item = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `inv-${n}`,
  wine_name: `Item ${n}`,
  stock_live: 6,
  menu_price_current: 60,
  last_purchase_price: 20,
  threshold_min: 2,
  master_wine_id: `mw-${n}`,
  bottle_size_ml: 750,
  is_active: true,
  ...extra,
});

let seq = 0;
/** `count` lines of one item, one per day going back. */
function lines(
  n: number,
  count: number,
  line: { consumption_type: unknown; quantity: number; volume_ml: number | null },
  sizeMl: number | null = 750,
) {
  return Array.from({ length: count }, (_, i) => ({
    id: `c-${String(++seq).padStart(6, "0")}`,
    restaurant_id: RESTAURANT,
    inventory_id: `inv-${n}`,
    ...line,
    created_at: daysAgo(1 + (i % 20)),
    restaurant_inventory: { master_wine_id: `mw-${n}`, bottle_size_ml: sizeMl },
  }));
}

const GLASS = { consumption_type: "glass", quantity: 1, volume_ml: 150 };
const BOTTLE = { consumption_type: "bottle", quantity: 1, volume_ml: 750 };
/** A line with no bottle figure: a glass with no millilitres. */
const NO_FIGURE = { consumption_type: "glass", quantity: 2, volume_ml: 0 };

const advanced = (rows: Rows) =>
  new AdvancedAnalyticsService(
    dbOver(rows),
    {
      // A projection is always on offer, so the null below is Wine 360's own.
      getDemandForecast: async () => ({
        totalForecastDemand: 9,
        model: "holt_winters",
      }),
    } as any,
    {} as any,
    {} as any,
  );

describe("menu engineering counts bottles, not pours", () => {
  it("R1: ten 150 ml glasses of a 750 ml wine over 90 days move 2/90 bottles a day, not 10/90", async () => {
    const out: any = await advanced({
      restaurant_inventory: [item(1)],
      wine_consumption_log: lines(1, 10, GLASS),
    }).getMenuEngineering(RESTAURANT, 90);
    const row = out.items.find((i: any) => i.id === "inv-1");
    expect(row.velocityPerDay).toBeCloseTo(2 / 90, 12);
    expect(out.basis.velocity).toMatch(/^bottles\/day over 90d/);
    expect(out.unitsCoverage).toMatchObject({ lines: 10, glassLines: 10 });
  });

  it("R2: a wine with a line that carries no bottle figure has no velocity and no quadrant, and is counted apart", async () => {
    const out: any = await advanced({
      restaurant_inventory: [item(1), item(2), item(3)],
      wine_consumption_log: [
        ...lines(1, 10, GLASS), // 2 bottles
        ...lines(2, 1, NO_FIGURE),
        ...lines(3, 4, BOTTLE), // 4 bottles
      ],
    }).getMenuEngineering(RESTAURANT, 90);
    const row = out.items.find((i: any) => i.id === "inv-2");
    expect(row.velocityPerDay).toBeNull();
    expect(row.quadrant).toBeNull();
    expect(row.action).toBeNull();
    expect(out.counts.unmeasured).toBe(1);
    expect(out.counts.unclassified).toBe(0);
    // The median is over the two velocities that are known.
    expect(out.medians.velocityPerDay).toBeCloseTo(3 / 90, 12);
    expect(out.basis.velocity).toContain("carries no bottle figure");
  });

  it("labels a glass of an unsized wine as resting on the stand-in", async () => {
    const out: any = await advanced({
      restaurant_inventory: [item(1, { bottle_size_ml: null })],
      wine_consumption_log: lines(1, 5, GLASS, null),
    }).getMenuEngineering(RESTAURANT, 90);
    const row = out.items.find((i: any) => i.id === "inv-1");
    expect(row.velocityPerDay).toBeCloseTo(1 / 90, 12);
    expect(row.sizeStandIn).toBe(true);
    expect(out.unitsCoverage).toMatchObject({ standInLines: 5, standInItems: 1 });
    expect(out.basis.velocity).toContain("750 ml stand-in");
  });
});

describe("the restock list counts bottles, not pours", () => {
  const analytics = (rows: Rows) => new AnalyticsService(dbOver(rows));

  it("R3: 25 glasses are 5 bottles over 90 days; an item with no bottle figure is unassessed, never reordered on a guess", async () => {
    const out: any = await analytics({
      restaurant_inventory: [item(1), item(2, { stock_live: 0 })],
      wine_consumption_log: [...lines(1, 25, GLASS), ...lines(2, 12, NO_FIGURE)],
    }).getInventoryScience(RESTAURANT);
    const one = out.skus.find((s: any) => s.id === "inv-1");
    expect(one.avgDailyDemand).toBeCloseTo(5 / 90, 12);
    expect(one.daysOfCover).toBeCloseTo(6 / (5 / 90), 9);
    expect(one.demandUnknown).toBe(false);

    const two = out.skus.find((s: any) => s.id === "inv-2");
    expect(two.demandUnknown).toBe(true);
    expect(two.avgDailyDemand).toBeNull();
    expect(two.reorderPoint).toBeNull();
    expect(two.stockoutProbability).toBeNull();
    expect(two.needsReorder).toBe(false);
    expect(out.reorderList.map((s: any) => s.id)).not.toContain("inv-2");
    expect(out.unassessed).toBe(1);
    expect(out.basis.demand).toContain("carry no bottle figure");
  });

  it("R6: a wine sold only by the glass is moving, not dead stock", async () => {
    const out: any = await analytics({
      restaurant_inventory: [item(1), item(2)],
      wine_consumption_log: lines(1, 3, GLASS),
    }).getFinancialSummary(RESTAURANT);
    expect(out.deadStockTop.map((d: any) => d.name)).toEqual(["Item 2"]);
  });
});

describe("the insight bundle counts bottles, not pours", () => {
  it("R4: a 150 ml glass of a 750 ml wine is 0.2 of a bottle in the bundle", async () => {
    const svc = new InsightGeneratorService(
      dbOver({ wine_consumption_log: lines(1, 1, GLASS) }),
      { load: async () => ({ dates: new Set<string>(), readable: true }) } as any,
      {} as any,
    );
    const bundle = await (svc as any).loadBundle(RESTAURANT);
    expect(bundle.consumption).toHaveLength(1);
    expect(bundle.consumption[0].qty).toBeCloseTo(0.2, 12);
  });

  it("keeps a line with no bottle figure in the bundle as null, never 1", async () => {
    const svc = new InsightGeneratorService(
      dbOver({ wine_consumption_log: lines(2, 1, NO_FIGURE) }),
      { load: async () => ({ dates: new Set<string>(), readable: true }) } as any,
      {} as any,
    );
    const bundle = await (svc as any).loadBundle(RESTAURANT);
    expect(bundle.consumption).toHaveLength(1);
    expect(bundle.consumption[0].wineId).toBe("mw-2");
    expect(bundle.consumption[0].qty).toBeNull();
  });
});

describe("the Bottles sold goal counts bottles, or refuses", () => {
  const goals = (rows: Rows) =>
    new GoalsService(
      dbOver(rows),
      { getStored: async () => [] } as any,
      {} as any,
      {} as any,
      {} as any,
      { getFinancialSummary: async () => ({}) } as any,
    );
  const since = daysAgo(30).slice(0, 10);

  it("R5: ten 150 ml glasses of a 750 ml wine are 2 bottles sold", async () => {
    const out = await (goals({
      wine_consumption_log: lines(1, 10, GLASS),
    }) as any).computeMetricWithSeries(RESTAURANT, "bottles_sold", since);
    expect(out.current).toBeCloseTo(2, 12);
    expect(out.rowCount).toBe(10);
  });

  it("R5: a line with no bottle figure refuses the total instead of summing it short", async () => {
    const err = await (goals({
      wine_consumption_log: [...lines(1, 10, GLASS), ...lines(2, 1, NO_FIGURE)],
    }) as any)
      .computeMetricWithSeries(RESTAURANT, "bottles_sold", since)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UncountedConsumptionError);
    expect((err as Error).message).toContain("1 consumption line across 1 item");
  });
});

describe("Wine 360 counts bottles, not pours", () => {
  it("R7: ten 150 ml glasses over 90 days are a demand of 2/90 bottles a day", async () => {
    const out: any = await advanced({
      restaurant_inventory: [item(1)],
      wine_consumption_log: lines(1, 10, GLASS),
    }).getWine360(RESTAURANT, "mw-1");
    expect(out.demand.mean).toBeCloseTo(2 / 90, 12);
    expect(out.daysOfCover).toBeCloseTo(6 / (2 / 90), 9);
    expect(out.basis.demand).toMatch(/^bottles\/day over 90d/);
  });

  it("a wine with a line that carries no bottle figure has no demand, and says why", async () => {
    const out: any = await advanced({
      restaurant_inventory: [item(2)],
      wine_consumption_log: lines(2, 3, NO_FIGURE),
    }).getWine360(RESTAURANT, "mw-2");
    expect(out.demand).toBeNull();
    expect(out.daysOfCover).toBeNull();
    expect(out.stockoutProbability).toBeNull();
    expect(out.reorderPoint).toBeNull();
    expect(out.forecast14d).toBeNull();
    expect(out.basis.demand).toContain("carry no bottle figure");
  });
});
