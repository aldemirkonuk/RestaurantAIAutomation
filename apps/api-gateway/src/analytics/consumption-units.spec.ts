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
import { stateBookFrom } from "./insights/item-state";
import { EXPORT_CUTTINGS } from "../reports/exports/report-export-cuttings";

/**
 * A glass is not a bottle (AW02, ADR 0297).
 *
 * `wine_consumption_log.quantity` counts servings in the line's own mode
 * (ADR 0011; pos-hub.service.ts:1583-1587, :1625). Every demand reader took
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

  it("H7b: a bottle line with a negative quantity has no bottle figure, never a negative sale", () => {
    // The POS mirror never writes one (pos-hub.service.ts:1257-1258 clamps the
    // count at 0 and skips a 0), and no CHECK holds `quantity` at 0 or more
    // (baseline_from_production.sql:6385), so only a
    // `manual` or `ai_agent` row can carry it (ADR 0297).
    for (const quantity of [-1, -0.5, "-2"])
      expect(
        bottlesOf({
          consumption_type: "bottle",
          quantity,
          volume_ml: 750,
          restaurant_inventory: { bottle_size_ml: 750 },
        }),
      ).toEqual({ bottles: null, how: "uncounted" });
    // Zero is still a count: the boundary sits below 0, not at it.
    expect(bottlesOf({ consumption_type: "bottle", quantity: 0 })).toEqual({
      bottles: 0,
      how: "bottle",
    });
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
    // Every cause bottlesOf has, the negative bottle line among them.
    expect(s).toContain(
      "(no bottle or glass mode, a bottle line with no quantity of 0 or more, or a glass line with no millilitres above 0)",
    );

    const sized = summarizeUnits([
      { how: "bottle", inventoryId: "a" },
      { how: "stated_size", inventoryId: "b" },
    ]);
    expect(sized.complete).toBe(true);
    expect(unitsBasisSentence(sized)).toContain(
      "every glass line's item states its bottle size",
    );
    expect(unitsBasisSentence(sized)).toContain(
      "every line has a bottle figure",
    );
    expect(unitsBasisSentence(summarizeUnits([]))).toBe(
      "no consumption lines in this window",
    );
  });
});

// ---------------------------------------------------------------------------
// The readers, through a stub that pages the way readWholeWindow reads
// ---------------------------------------------------------------------------

type Rows = Record<string, any[]>;

/**
 * Keep only the columns a select names: `col` and `rel(sub, sub)`, as
 * PostgREST returns them. Applied to the consumption lines only, so a reader
 * that stops selecting `consumption_type` or `bottle_size_ml` reads lines
 * without them here too, as it would in production (merge of 2026-10-07:
 * analytics.service.ts loadConsumption's select was re-applied by hand).
 */
function project(cols: string, row: any) {
  const out: any = {};
  for (const part of cols.split(/,(?![^(]*\))/)) {
    const m = part.trim().match(/^(\w+)(?:\((.*)\))?$/);
    if (!m) throw new Error(`unparsed select part: ${part}`);
    const [, name, subs] = m;
    if (!(name in row)) continue;
    out[name] =
      subs === undefined || row[name] == null
        ? row[name]
        : project(subs, row[name]);
  }
  return out;
}

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
      let selected: string | null = null;
      const b: any = {};
      for (const m of [
        "eq",
        "neq",
        "gte",
        "lte",
        "lt",
        "in",
        "is",
        "or",
        "not",
      ])
        b[m] = () => b;
      b.select = (cols: string, opts?: { count?: string }) => {
        if (opts?.count === "exact") counted = true;
        if (table === "wine_consumption_log") selected = cols;
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
      b.single = () => Promise.resolve({ data: all[0] ?? null, error: null });
      b.update = () => b;
      b.then = (resolve: any, reject: any) => {
        const past =
          cursor === null
            ? all
            : all.filter(
                (r) => String(r.id).localeCompare(cursor as string) > 0,
              );
        const page = lim === null ? past : past.slice(0, lim);
        return Promise.resolve({
          data:
            selected === null
              ? page
              : page.map((r) => project(selected as string, r)),
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
  line: {
    consumption_type: unknown;
    quantity: number;
    volume_ml: number | null;
  },
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
    expect(out.unitsCoverage).toMatchObject({
      standInLines: 5,
      standInItems: 1,
    });
    expect(out.basis.velocity).toContain("750 ml stand-in");
  });
});

describe("the restock list counts bottles, not pours", () => {
  const analytics = (rows: Rows) => new AnalyticsService(dbOver(rows));

  it("R3: 25 glasses are 5 bottles over 90 days; an item with no bottle figure is unassessed, never reordered on a guess", async () => {
    const out: any = await analytics({
      restaurant_inventory: [item(1), item(2, { stock_live: 0 })],
      wine_consumption_log: [
        ...lines(1, 25, GLASS),
        ...lines(2, 12, NO_FIGURE),
      ],
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

  it("R6b: a glass line with no millilitres has no bottle figure, but its servings are still movement", async () => {
    // Movement is a serving or a millilitre, not a bottle figure
    // (analytics.service.ts getFinancialSummary's dead-stock join): Item 1 poured
    // two glasses whose millilitres were not recorded, so it moved, and only
    // the untouched Item 3 is idle. Item 2's bottle line gives the window a
    // movement signal of its own, so the case does not rest on Item 1 alone.
    const out: any = await analytics({
      restaurant_inventory: [item(1), item(2), item(3)],
      wine_consumption_log: [...lines(1, 1, NO_FIGURE), ...lines(2, 1, BOTTLE)],
    }).getFinancialSummary(RESTAURANT);
    expect(bottlesOf(NO_FIGURE)).toEqual({ bottles: null, how: "uncounted" });
    expect(out.deadStockTop.map((d: any) => d.name)).toEqual(["Item 3"]);
  });
});

describe("the insight bundle counts bottles, not pours", () => {
  it("R4: a 150 ml glass of a 750 ml wine is 0.2 of a bottle in the bundle", async () => {
    const svc = new InsightGeneratorService(
      dbOver({ wine_consumption_log: lines(1, 1, GLASS) }),
      {
        load: async () => ({ dates: new Set<string>(), readable: true }),
      } as any,
      {} as any,
    );
    const bundle = await (svc as any).loadBundle(RESTAURANT);
    expect(bundle.consumption).toHaveLength(1);
    expect(bundle.consumption[0].qty).toBeCloseTo(0.2, 12);
  });

  it("keeps a line with no bottle figure in the bundle as null, never 1", async () => {
    const svc = new InsightGeneratorService(
      dbOver({ wine_consumption_log: lines(2, 1, NO_FIGURE) }),
      {
        load: async () => ({ dates: new Set<string>(), readable: true }),
      } as any,
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
    const out = await (
      goals({
        wine_consumption_log: lines(1, 10, GLASS),
      }) as any
    ).computeMetricWithSeries(RESTAURANT, "bottles_sold", since);
    expect(out.current).toBeCloseTo(2, 12);
    expect(out.rowCount).toBe(10);
  });

  it("R5: a line with no bottle figure refuses the total instead of summing it short", async () => {
    const err = await (
      goals({
        wine_consumption_log: [
          ...lines(1, 10, GLASS),
          ...lines(2, 1, NO_FIGURE),
        ],
      }) as any
    )
      .computeMetricWithSeries(RESTAURANT, "bottles_sold", since)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UncountedConsumptionError);
    expect((err as Error).message).toContain(
      "1 consumption line across 1 item",
    );
  });

  it("R5b: a bottle line with a negative quantity refuses the total instead of subtracting from it", async () => {
    const err = await (
      goals({
        wine_consumption_log: [
          ...lines(1, 10, GLASS),
          ...lines(2, 1, {
            consumption_type: "bottle",
            quantity: -3,
            volume_ml: 750,
          }),
        ],
      }) as any
    )
      .computeMetricWithSeries(RESTAURANT, "bottles_sold", since)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UncountedConsumptionError);
    expect((err as Error).message).toContain(
      "1 consumption line across 1 item",
    );
    // The refusal names the negative bottle line among its causes.
    expect((err as Error).message).toContain(
      "a bottle line with no quantity of 0 or more",
    );
  });
});

// The stub above returns only the columns a reader selects, so each case here
// fails if that reader stops selecting `restaurant_inventory(bottle_size_ml)`:
// a 1.5 l item would then rest on the 750 ml stand-in and read double.
describe("each reader divides by the item's stated size, which it must select", () => {
  const MAGNUM = 1500;

  it("menu engineering: ten 150 ml glasses of a 1.5 l item move 1/90 bottles a day", async () => {
    const out: any = await advanced({
      restaurant_inventory: [item(1, { bottle_size_ml: MAGNUM })],
      wine_consumption_log: lines(1, 10, GLASS, MAGNUM),
    }).getMenuEngineering(RESTAURANT, 90);
    const row = out.items.find((i: any) => i.id === "inv-1");
    expect(row.velocityPerDay).toBeCloseTo(1 / 90, 12);
    expect(row.sizeStandIn).toBe(false);
  });

  it("the restock list (loadConsumption): 25 glasses of a 1.5 l item are 2.5 bottles over 90 days", async () => {
    const out: any = await new AnalyticsService(
      dbOver({
        restaurant_inventory: [item(1, { bottle_size_ml: MAGNUM })],
        wine_consumption_log: lines(1, 25, GLASS, MAGNUM),
      }),
    ).getInventoryScience(RESTAURANT);
    const one = out.skus.find((s: any) => s.id === "inv-1");
    expect(one.avgDailyDemand).toBeCloseTo(2.5 / 90, 12);
    expect(out.unitsCoverage).toMatchObject({ standInLines: 0 });
  });

  it("the insight bundle: a 150 ml glass of a 1.5 l item is 0.1 of a bottle", async () => {
    const svc = new InsightGeneratorService(
      dbOver({ wine_consumption_log: lines(1, 1, GLASS, MAGNUM) }),
      {
        load: async () => ({ dates: new Set<string>(), readable: true }),
      } as any,
      {} as any,
    );
    const bundle = await (svc as any).loadBundle(RESTAURANT);
    expect(bundle.consumption[0].qty).toBeCloseTo(0.1, 12);
  });

  it("the Bottles sold goal: ten 150 ml glasses of a 1.5 l item are 1 bottle sold", async () => {
    const out = await (
      new GoalsService(
        dbOver({ wine_consumption_log: lines(1, 10, GLASS, MAGNUM) }),
        { getStored: async () => [] } as any,
        {} as any,
        {} as any,
        {} as any,
        { getFinancialSummary: async () => ({}) } as any,
      ) as any
    ).computeMetricWithSeries(
      RESTAURANT,
      "bottles_sold",
      daysAgo(30).slice(0, 10),
    );
    expect(out.current).toBeCloseTo(1, 12);
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

describe("the exported quadrant cutting says why an item has no quadrant", () => {
  it("does not call a costed item with no bottle figure uncosted", () => {
    const out = EXPORT_CUTTINGS.quadrants.write(
      {
        medians: { velocityPerDay: 0.03, marginPerBottle: 40 },
        counts: { star: 1, unclassified: 1, unmeasured: 1 },
        items: [
          {
            id: "a",
            name: "Counted Red",
            velocityPerDay: 0.05,
            marginPerBottle: 45,
            marginPct: 0.6,
            quadrant: "star",
          },
          {
            id: "b",
            name: "Unmeasured Single",
            velocityPerDay: null,
            marginPerBottle: 30,
            marginPct: 0.5,
            quadrant: null,
          },
          {
            id: "c",
            name: "Uncosted White",
            velocityPerDay: 0.02,
            marginPerBottle: null,
            marginPct: null,
            quadrant: null,
          },
        ],
      },
      { days: null },
    );
    const rows = out.tables[0].rows;
    const why = (row: unknown[], col: number) =>
      (row[col] as { why?: string }).why;
    const b = rows.find((r) => r[0] === "Unmeasured Single")!;
    expect(why(b, 1)).toBe("some of its sales carry no bottle figure");
    expect(why(b, 4)).toBe("some of its sales carry no bottle figure");
    const c = rows.find((r) => r[0] === "Uncosted White")!;
    expect(why(c, 4)).toBe("no recorded cost — unknown, not a dog");
    expect(out.notes.join(" ")).toContain(
      "1 item has no velocity and no quadrant: some of its sales carry no bottle figure.",
    );
    // Both the uncosted and the unmeasured item sit outside the quadrants.
    expect(out.figures.find((x) => x.label === "No quadrant")?.value).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Each sub-behaviour ADR 0297 lists under Decision, pinned one by one: every
// case below fails if the rule it names is dropped from its reader.
// ---------------------------------------------------------------------------

/** Noon UTC `d` days back, so a line's date never slides across midnight. */
const noonDaysAgo = (d: number) => {
  const t = new Date();
  t.setUTCHours(12, 0, 0, 0);
  return new Date(t.getTime() - d * 86400000).toISOString();
};

type Line = {
  consumption_type: unknown;
  quantity: number;
  volume_ml: number | null;
};

/** One line of item `n` on the day `d` days back. */
function on(n: number, d: number, line: Line, sizeMl: number | null = 750) {
  return {
    id: `d-${String(++seq).padStart(6, "0")}`,
    restaurant_id: RESTAURANT,
    inventory_id: `inv-${n}`,
    ...line,
    created_at: noonDaysAgo(d),
    restaurant_inventory: { master_wine_id: `mw-${n}`, bottle_size_ml: sizeMl },
  };
}

/** `perDay` lines of item `n` on every day from `from` back to `to`. */
function everyDay(
  n: number,
  from: number,
  to: number,
  line: Line,
  sizeMl: number | null = 750,
  perDay = 1,
) {
  const out: any[] = [];
  for (let d = from; d <= to; d++)
    for (let k = 0; k < perDay; k++) out.push(on(n, d, line, sizeMl));
  return out;
}

const NO_STATE = {
  readState: async () => ({
    book: stateBookFrom([]),
    readable: true,
    problem: null,
  }),
} as any;

const insightsOver = (rows: Rows) =>
  new InsightGeneratorService(
    dbOver(rows),
    { load: async () => ({ dates: new Set<string>(), readable: true }) } as any,
    NO_STATE,
  );

/** The records one family emits over these rows. */
async function familyOver(
  rows: Rows,
  family: "computeConsumptionFamily" | "computeInventoryFamily",
) {
  const svc: any = insightsOver(rows);
  const bundle = await svc.loadBundle(RESTAURANT);
  const out: any[] = [];
  svc[family](bundle, (r: any) => {
    if (r) out.push(r);
  });
  return out;
}
const keyed = (records: any[], key: string) =>
  records.find((r) => r.candidateKey === key);

describe("the insight bundle withholds what a line with no bottle figure would bend", () => {
  /** Five wines selling 2, 4, 6, 8 and 10 bottles. */
  const FIVE = [1, 2, 3, 4, 5].flatMap((n) => everyDay(n, 1, n * 2, BOTTLE));

  it("I1: concentration is withheld while any wine holds such a line", async () => {
    const control = await familyOver(
      { wine_consumption_log: FIVE },
      "computeConsumptionFamily",
    );
    // It carries the bottle basis of the 30 lines it shares out.
    expect(
      keyed(control, "wine.consumption_qty.concentration").evidence.units,
    ).toMatchObject({ lines: 30, standInLines: 0, uncountedLines: 0 });

    const out = await familyOver(
      { wine_consumption_log: [...FIVE, on(6, 3, NO_FIGURE)] },
      "computeConsumptionFamily",
    );
    expect(keyed(out, "wine.consumption_qty.concentration")).toBeUndefined();
  });

  it("I2: the Holt-Winters forecast gap is withheld while any day holds such a line", async () => {
    const daily = everyDay(1, 1, 85, BOTTLE);
    const control = await familyOver(
      { wine_consumption_log: daily },
      "computeConsumptionFamily",
    );
    expect(keyed(control, "overall.bottles.forecast_gap")).toBeDefined();

    const out = await familyOver(
      { wine_consumption_log: [...daily, on(2, 40, NO_FIGURE)] },
      "computeConsumptionFamily",
    );
    expect(keyed(out, "overall.bottles.forecast_gap")).toBeUndefined();
  });

  it("I3: a wine holding such a line is left out of the movers", async () => {
    // Twice the bottles this week as last: a +100% mover.
    const moving = [
      ...everyDay(1, 1, 7, BOTTLE, 750, 2),
      ...everyDay(1, 8, 14, BOTTLE),
    ];
    const control = await familyOver(
      { restaurant_inventory: [item(1)], wine_consumption_log: moving },
      "computeConsumptionFamily",
    );
    expect(keyed(control, "wine.bottles.vs_prev_period_7d")?.entityLabel).toBe(
      "Item 1",
    );

    const out = await familyOver(
      {
        restaurant_inventory: [item(1)],
        wine_consumption_log: [...moving, on(1, 30, NO_FIGURE)],
      },
      "computeConsumptionFamily",
    );
    expect(keyed(out, "wine.bottles.vs_prev_period_7d")).toBeUndefined();
  });

  it("I4: a wine holding such a line is left out of the stockout #1", async () => {
    const selling = everyDay(1, 1, 30, BOTTLE);
    const inventory = [item(1, { stock_live: 1 })];
    const control = await familyOver(
      { restaurant_inventory: inventory, wine_consumption_log: selling },
      "computeInventoryFamily",
    );
    expect(keyed(control, "wine.stockout_risk.peer_rank")?.entityLabel).toBe(
      "Item 1",
    );

    const out = await familyOver(
      {
        restaurant_inventory: inventory,
        wine_consumption_log: [...selling, on(1, 40, NO_FIGURE)],
      },
      "computeInventoryFamily",
    );
    expect(keyed(out, "wine.stockout_risk.peer_rank")).toBeUndefined();
  });
});

describe("every figure resting on the 750 ml stand-in says so, with its counts (fork 1)", () => {
  // Item 1 states no size and sells by the glass: 4 a day this week, 2 a day
  // before that. Item 2 states its size and sells a bottle a day.
  const rows = () => ({
    restaurant_inventory: [
      item(1, { bottle_size_ml: null, stock_live: 1 }),
      item(2, { stock_live: 50 }),
    ],
    wine_consumption_log: [
      ...everyDay(1, 1, 7, GLASS, null, 4),
      ...everyDay(1, 8, 85, GLASS, null, 2),
      ...everyDay(2, 1, 85, BOTTLE),
    ],
  });
  const STAND_IN_LINES = 7 * 4 + 78 * 2; // 184

  it("L1: each consumption insight carries the counts of the lines it was built from", async () => {
    const out = await familyOver(rows(), "computeConsumptionFamily");
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) expect(r.evidence.units).toBeDefined();

    const gap = keyed(out, "overall.bottles.forecast_gap");
    expect(gap.evidence.units).toMatchObject({
      lines: STAND_IN_LINES + 85,
      standInLines: STAND_IN_LINES,
      standInItems: 1,
      uncountedLines: 0,
    });
    expect(gap.evidence.units.basis).toContain(
      `${STAND_IN_LINES} glass lines across 1 item with no stated bottle size rest on the 750 ml stand-in`,
    );

    // The mover counts only its own wine over the two weeks it compares.
    const mover = keyed(out, "wine.bottles.vs_prev_period_7d");
    expect(mover.entityLabel).toBe("Item 1");
    expect(mover.evidence.units).toMatchObject({
      lines: 7 * 4 + 7 * 2,
      standInLines: 7 * 4 + 7 * 2,
      standInItems: 1,
    });
  });

  it("L2: the stockout #1 carries its own wine's stand-in count", async () => {
    const out = await familyOver(rows(), "computeInventoryFamily");
    const top = keyed(out, "wine.stockout_risk.peer_rank");
    expect(top.entityLabel).toBe("Item 1");
    expect(top.evidence.units).toMatchObject({
      lines: STAND_IN_LINES,
      standInLines: STAND_IN_LINES,
      standInItems: 1,
    });
  });

  it("L3: the bundle names every line it read, stand-in and all", async () => {
    const out: any = await insightsOver(rows()).generate(RESTAURANT);
    expect(out.units).toMatchObject({
      lines: STAND_IN_LINES + 85,
      standInLines: STAND_IN_LINES,
      standInItems: 1,
    });
  });

  it("L4: a Bottles sold goal counts the lines in its window resting on the stand-in", async () => {
    const goals = new GoalsService(
      dbOver({
        analytics_goals: [
          {
            id: "g-1",
            restaurant_id: RESTAURANT,
            metric_key: "bottles_sold",
            target_value: 100,
            direction: "at_least",
            created_at: noonDaysAgo(20),
            deadline: null,
          },
        ],
        wine_consumption_log: [
          ...everyDay(1, 1, 10, GLASS, null),
          ...everyDay(2, 1, 10, BOTTLE),
        ],
      }),
      { getStored: async () => [] } as any,
      {} as any,
      {} as any,
      {} as any,
      { getFinancialSummary: async () => ({}) } as any,
    );
    const out: any = await goals.getGoalProgress(RESTAURANT, "g-1");
    expect(out.current).toBeCloseTo(10 * 0.2 + 10, 12);
    expect(out.units).toMatchObject({
      lines: 20,
      standInLines: 10,
      standInItems: 1,
    });
    expect(out.units.basis).toContain("750 ml stand-in");
  });
});

describe("seasonality reads counted lines only, and names the rest", () => {
  it("S1: a line with no bottle figure moves no weekday, and the basis counts it", async () => {
    const counted = everyDay(1, 1, 60, BOTTLE);
    const base: any = await advanced({
      restaurant_inventory: [item(1)],
      wine_consumption_log: counted,
    }).getSeasonality(RESTAURANT, 90);
    const out: any = await advanced({
      restaurant_inventory: [item(1)],
      // Quantity 2 on a day of its own: read as its servings it would move
      // that weekday's mean.
      wine_consumption_log: [...counted, on(2, 70, NO_FIGURE)],
    }).getSeasonality(RESTAURANT, 90);
    expect(out.weekdayProfile).toEqual(base.weekdayProfile);
    expect(out.basis.units).toContain(
      "1 line across 1 item carries no bottle figure",
    );
  });

  it("S2: a category's weekday winner needs ten counted lines; one with no figure is not one of them", async () => {
    const red = { master_wine_library: { primary_type: "red" } };
    const control: any = await advanced({
      restaurant_inventory: [item(1, red)],
      wine_consumption_log: everyDay(1, 1, 10, BOTTLE),
    }).getSeasonality(RESTAURANT, 90);
    expect(control.categoryProfiles.map((p: any) => p.type)).toEqual(["red"]);

    const out: any = await advanced({
      restaurant_inventory: [item(1, red)],
      wine_consumption_log: [
        ...everyDay(1, 1, 9, BOTTLE),
        on(1, 12, NO_FIGURE),
      ],
    }).getSeasonality(RESTAURANT, 90);
    expect(out.categoryProfiles).toEqual([]);
  });
});

describe("a series reader's basis says what it does with a line with no bottle figure (ADR 0297)", () => {
  // The three series readers zero-fill a daily series from counted lines, so
  // a line with no bottle figure is left out and a day holding only it reads
  // 0. Their basis must say that, not that the figures resting on the line
  // are null (audit of PR #626 at b9580443e).
  const SERIES_WORDS =
    "1 line across 1 item carries no bottle figure (no bottle or glass mode, a bottle line with no quantity of 0 or more, or a glass line with no millilitres above 0), so it is left out of this series: a day holding it counts only its other lines, and reads 0 if it has none";

  it("SB1: seasonality's basis.units says the line is left out of the series, not that figures are null", async () => {
    const counted = everyDay(1, 1, 60, BOTTLE);
    const base: any = await advanced({
      restaurant_inventory: [item(1)],
      wine_consumption_log: counted,
    }).getSeasonality(RESTAURANT, 90);
    const out: any = await advanced({
      restaurant_inventory: [item(1)],
      // Day 70 holds only the line with no figure, so it reads 0 as before.
      wine_consumption_log: [...counted, on(2, 70, NO_FIGURE)],
    }).getSeasonality(RESTAURANT, 90);
    expect(out.weekdayProfile).toEqual(base.weekdayProfile);
    expect(out.basis.units).toContain(SERIES_WORDS);
    expect(out.basis.units).not.toContain("is null");
  });

  it("SB2: the risk profile's basis.demand says the same, and its series is unchanged", async () => {
    const counted = everyDay(1, 1, 60, BOTTLE);
    const run = (rows: any[]) =>
      new AnalyticsService(
        dbOver({ restaurant_inventory: [item(1)], wine_consumption_log: rows }),
      ).getRiskProfile(RESTAURANT);
    const base: any = await run(counted);
    const out: any = await run([...counted, on(2, 70, NO_FIGURE)]);
    expect(out.demandRisk).toEqual(base.demandRisk);
    expect(out.basis.demand).toContain(SERIES_WORDS);
    expect(out.basis.demand).not.toContain("is null");
  });

  it("SB3: the house forecast's history reads 0 on a day holding only that line, and its basis says so", async () => {
    const rows = [
      ...everyDay(1, 1, 49, BOTTLE),
      ...everyDay(1, 51, 100, BOTTLE),
      on(2, 50, NO_FIGURE),
    ];
    const out: any = await new AnalyticsService(
      dbOver({ restaurant_inventory: [item(1)], wine_consumption_log: rows }),
    ).getDemandForecast(RESTAURANT);
    const day50 = noonDaysAgo(50).substring(0, 10);
    const i = out.history.dates.indexOf(day50);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(out.history.values[i]).toBe(0);
    expect(out.basis.demand).toContain(SERIES_WORDS);
    expect(out.basis.demand).not.toContain("is null");
  });

  it("SB4: a per-item reader keeps the null wording", () => {
    const cov = summarizeUnits([{ how: "uncounted", inventoryId: "inv-1" }]);
    expect(unitsBasisSentence(cov)).toContain("is null rather than guessed");
  });
});

describe("Wine 360 ranks only wines whose every line has a bottle figure", () => {
  it("W1: a wine holding such a line leaves the peer ranks", async () => {
    const base = [
      ...lines(1, 10, GLASS), // 2 bottles
      ...lines(2, 5, BOTTLE), // 5
      ...lines(3, 20, BOTTLE), // 20
    ];
    const inventory = [item(1), item(2), item(3)];
    const control: any = await advanced({
      restaurant_inventory: inventory,
      wine_consumption_log: base,
    }).getWine360(RESTAURANT, "mw-1");
    expect(control.peerCount).toBe(3);
    expect(control.rankByVolume).toBe(3);

    const out: any = await advanced({
      restaurant_inventory: inventory,
      wine_consumption_log: [...base, ...lines(3, 1, NO_FIGURE)],
    }).getWine360(RESTAURANT, "mw-1");
    expect(out.peerCount).toBe(2);
    expect(out.rankByVolume).toBe(2);
  });
});

describe("the risk profile reads counted lines only, and names the rest", () => {
  it("RP1: a line with no bottle figure moves no demand-risk figure, and the basis counts it", async () => {
    const counted = everyDay(1, 1, 60, BOTTLE);
    const base: any = await new AnalyticsService(
      dbOver({
        restaurant_inventory: [item(1)],
        wine_consumption_log: counted,
      }),
    ).getRiskProfile(RESTAURANT);
    const out: any = await new AnalyticsService(
      dbOver({
        restaurant_inventory: [item(1)],
        // Quantity 2 on a day of its own, so reading it as servings would
        // add a demand day the counted series does not have.
        wine_consumption_log: [...counted, on(2, 70, NO_FIGURE)],
      }),
    ).getRiskProfile(RESTAURANT);
    expect(out.demandRisk).toEqual(base.demandRisk);
    expect(base.basis.demand).toContain("every line has a bottle figure");
    expect(out.basis.demand).toContain(
      "1 line across 1 item carries no bottle figure",
    );
  });
});

describe("the demand forecast does not project one wine from a history it cannot count", () => {
  const daily = () => everyDay(1, 1, 100, BOTTLE);
  const forecastOver = (rows: any[], masterWineId?: string) =>
    new AnalyticsService(
      dbOver({ restaurant_inventory: [item(1)], wine_consumption_log: rows }),
    ).getDemandForecast(RESTAURANT, masterWineId ? { masterWineId } : {});

  it("F1: one wine holding such a line has no projection and no accuracy, and says why", async () => {
    const control: any = await forecastOver(daily(), "mw-1");
    expect(control.modelFitted).toBe(true);
    expect(control.accuracy).not.toBeNull();

    const out: any = await forecastOver(
      [...daily(), on(1, 50, NO_FIGURE)],
      "mw-1",
    );
    expect(out.modelFitted).toBe(false);
    expect(out.model).toBeNull();
    expect(out.forecast).toEqual([]);
    expect(out.totalForecastDemand).toBeNull();
    expect(out.accuracy).toBeNull();
    expect(out.basis.model).toContain("carry no bottle figure");
  });

  it("F2: the house series still projects, from counted lines, and names the gap", async () => {
    const out: any = await forecastOver([...daily(), on(2, 50, NO_FIGURE)]);
    expect(out.modelFitted).toBe(true);
    expect(out.basis.demand).toContain(
      "1 line across 1 item carries no bottle figure",
    );
  });
});

describe("the exports carry the stand-in label the registers return", () => {
  const STAND_IN =
    "3 glass lines across 1 item with no stated bottle size rest on the 750 ml stand-in the stock moves by";

  it("X1: the week's shape writes the units sentence into its basis", () => {
    const out = EXPORT_CUTTINGS.week.write(
      {
        weekdayProfile: [{ day: "Monday", mean: 1, stdev: 0, n: 4 }],
        basis: { weekday: "mean bottles per weekday", units: STAND_IN },
      },
      { days: null },
    );
    expect(out.basis).toContain(STAND_IN);
  });

  it("X2: a Bottles sold goal names its stand-in lines, and the basis states the rule", () => {
    const out = EXPORT_CUTTINGS.goals.write(
      {
        total: 1,
        goals: [
          {
            goal: { name: "Sell more by the glass" },
            metricLabel: "Bottles sold",
            unit: "count",
            current: 4,
            target: 10,
            progressPct: 0.4,
            onTrack: null,
            units: { standInLines: 3, standInItems: 1 },
          },
        ],
        basis: { current: "recomputed", units: "the rule" },
      },
      { days: null },
    );
    expect(out.notes).toContain(
      "Sell more by the glass: 3 glass lines across 1 item with no stated bottle size are read at the 750 ml stand-in the stock moves by.",
    );
    expect(out.basis).toContain("the rule");
  });

  it("X3: the reading counts the sentences resting on the stand-in", () => {
    const out = EXPORT_CUTTINGS.reading.write(
      {
        insights: [
          {
            sentence: "Bottles sold rose 20%.",
            category: "sales",
            score: 2,
            evidence: { units: { standInLines: 3 } },
          },
          { sentence: "Table 4 leads.", category: "tables", score: 1 },
        ],
      },
      { days: null },
    );
    expect(out.notes.join(" ")).toContain(
      "1 of these sentences rests in part on glass lines of items with no stated bottle size",
    );
  });
});
