import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import * as E from "./engine";
import { stateBookFrom } from "./insights/item-state";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { EXPORT_CUTTINGS } from "../reports/exports/report-export-cuttings";
import { isWithheld } from "../reports/exports/report-export-doc";

/**
 * "Jameson Irish Whiskey ranks #1 of 134 by stockout risk (61.0%). Only 0
 * bottles on hand."
 *
 * Read from production on 2026-10-03 (AW29 / A-025). The restock register
 * listed eight wines at exactly 61% — Pierre Ferrand first, with 45 true days
 * of cover — for two reasons, both fixed here (ADR 0299):
 *
 *  1. On hand counted sealed bottles only. A spirit poured by the glass sits in
 *     an OPEN bottle: Pierre Ferrand held 950 of 1,000 ml and read 0 bottles.
 *  2. Every demand series held one day (the import day, F-129), so its swing
 *     was sqrt(90) for every wine, and a wine with nothing sealed and any sale
 *     at all read the same 1 - Φ(-sqrt(7/90)) = 0.6098. A probability needs a
 *     demand history that has a swing to measure: 14 days with a sale.
 *
 * Every test marked "fails before" fails on the tree before ADR 0299.
 */

type Rows = Record<string, any[]>;
type Failing = Record<string, { code: string; message: string }>;

/** The thenable PostgREST stand-in cost-honesty.spec.ts uses, plus refusals. */
function makeClient(rowsByTable: Rows, failing: Failing = {}) {
  const passthrough = [
    "select",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "is",
    "or",
    "not",
    "order",
    "limit",
    "range",
    "in",
  ];
  return {
    from: (table: string) => {
      const builder: any = {};
      for (const m of passthrough) builder[m] = () => builder;
      const answer = () =>
        failing[table]
          ? { data: null, error: failing[table] }
          : { data: rowsByTable[table] ?? [], error: null };
      builder.maybeSingle = () => Promise.resolve(answer());
      builder.single = () => Promise.resolve(answer());
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve(answer()).then(resolve, reject);
      return builder;
    },
  };
}

const R = "44444444-4444-4444-4444-444444444444";

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

interface Wine {
  name: string;
  /** Sealed bottles in live lots. */
  sealed: number;
  /** Open-bottle ml in live lots; `undefined` leaves the column off the row. */
  openMl?: number;
  bottleSizeMl: number | null;
  /** [days back, units] — each one consumption line. */
  sales: Array<[number, number]>;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, "-");

function tables(wines: Wine[]): Rows {
  return {
    restaurant_inventory: wines.map((w) => ({
      id: `inv-${slug(w.name)}`,
      wine_name: w.name,
      stock_live: w.sealed,
      menu_price_current: 60,
      last_purchase_price: null,
      threshold_min: 0,
      master_wine_id: `mw-${slug(w.name)}`,
      bottle_size_ml: w.bottleSizeMl,
      master_wine_library: { primary_type: "spirit" },
    })),
    inventory_lot_rollup: wines.map((w) => ({
      inventory_id: `inv-${slug(w.name)}`,
      live_qty: w.sealed,
      wac: null,
      has_invoice_cost: false,
      wac_qty: 0,
      ...(w.openMl === undefined ? {} : { open_ml: w.openMl }),
    })),
    wine_consumption_log: wines.flatMap((w) =>
      w.sales.map(([back, units], i) => ({
        id: `c-${slug(w.name)}-${i}`,
        inventory_id: `inv-${slug(w.name)}`,
        quantity: units,
        volume_ml: null,
        created_at: `${dayBack(back)}T12:00:00.000Z`,
        restaurant_inventory: { master_wine_id: `mw-${slug(w.name)}` },
      })),
    ),
  };
}

/**
 * One import day: every unit of the window on a single date (F-129), in five
 * lines — the insight skips a wine with fewer than five, which would make its
 * one-day test pass for the wrong reason.
 */
const oneDay = (units: number): Array<[number, number]> =>
  Array.from({ length: 5 }, () => [30, units / 5] as [number, number]);
/** `days` days with a sale, one unit each, ending yesterday. */
const everyDay = (days: number): Array<[number, number]> =>
  Array.from({ length: days }, (_, i) => [i + 1, 1] as [number, number]);

/**
 * Tuzlu's eight rows at 61% (raw/sl-stockout-tie.digest.json), with the open
 * ml the stock books held for them. Nothing sealed; one import day of demand.
 */
const TUZLU: Wine[] = [
  {
    name: "Pierre Ferrand 1840",
    sealed: 0,
    openMl: 950,
    bottleSizeMl: 1000,
    sales: oneDay(4),
  },
  {
    name: "Jameson Irish Whiskey",
    sealed: 0,
    openMl: 50,
    bottleSizeMl: 1000,
    sales: oneDay(5),
  },
  {
    name: "Beefeater Gin",
    sealed: 0,
    openMl: 600,
    bottleSizeMl: 1000,
    sales: oneDay(4),
  },
  {
    name: "Metaxa 7 Stars",
    sealed: 0,
    openMl: 450,
    bottleSizeMl: 750,
    sales: oneDay(3),
  },
  {
    name: "Efe Black Raki",
    sealed: 0,
    openMl: 250,
    bottleSizeMl: 750,
    sales: oneDay(13),
  },
  {
    name: "Sonoma Chardonnay",
    sealed: 0,
    openMl: 0,
    bottleSizeMl: 750,
    sales: oneDay(15),
  },
  {
    name: "Yeni Raki",
    sealed: 0,
    openMl: 0,
    bottleSizeMl: 750,
    sales: oneDay(69),
  },
  {
    name: "Tekirdag Raki",
    sealed: 0,
    openMl: 0,
    bottleSizeMl: 750,
    sales: oneDay(30),
  },
];

/** A 90-day series holding `ones` days of one unit: the engine's own input. */
function series(ones: number): number[] {
  return Array.from({ length: 90 }, (_, i) => (i < ones ? 1 : 0));
}

const analytics = (rows: Rows) =>
  new AnalyticsService({ getClient: () => makeClient(rows) } as any);

const advanced = (rows: Rows) =>
  new AdvancedAnalyticsService(
    { getClient: () => makeClient(rows) } as any,
    {
      getDemandForecast: async () => ({
        totalForecastDemand: null,
        model: "none",
      }),
    } as any,
    {} as any,
    {} as any,
  );

const STOCKOUT = "wine.stockout_risk.peer_rank";

function generator(rows: Rows, failing: Failing = {}) {
  const client = makeClient(
    {
      pos_checks: [],
      procurement_orders: [],
      restaurant_tables: [],
      restaurant_venue_profiles: [],
      analytics_goals: [],
      ...rows,
    },
    failing,
  );
  return new InsightGeneratorService(
    { getClient: () => client, supabase: client } as any,
    {
      load: async () => ({ dates: new Set(), readable: true, problem: null }),
    } as any,
    {
      readState: async () => ({
        book: stateBookFrom([]),
        readable: true,
        problem: null,
      }),
    } as any,
  );
}

const stockoutRecords = async (svc: InsightGeneratorService) =>
  (await svc.generate("r1", { candidateKeys: [STOCKOUT] })).insights.filter(
    (i) => i.candidateKey === STOCKOUT,
  );

// The engine reads this lane adds. Looked up loosely so that, on the tree
// before ADR 0299, each engine test fails on its own instead of the suite
// failing to load.
const engine = E as any;

describe("the engine: on hand counts the open bottle (ADR 0299 §1)", () => {
  it("adds open ml over the writer's bottle size (fails before)", () => {
    expect(engine.bottlesOnHand(0, 950, 1000)).toBeCloseTo(0.95, 12);
    // No stated size: the writer pours from 750 ml (record_glass_pour's
    // COALESCE(bottle_size_ml, 750)), so that is the size it is read back at.
    expect(engine.bottlesOnHand(2, 300, null)).toBeCloseTo(2.4, 12);
    expect(engine.bottlesOnHand(1, 0, 750)).toBe(1);
    // A size the writer refuses (ADR 0285) converts nothing.
    expect(engine.bottlesOnHand(1, 500, 0)).toBe(1);
  });
});

describe("the engine: a risk needs a measured history (ADR 0299 §2-3)", () => {
  const read = (onHand: number, dailyDemand: number[], serviceLevel = 0.95) =>
    engine.restockReading({ onHand, dailyDemand, leadTime: 7, serviceLevel });

  it("gives a one-day spike no swing, no risk and no reorder point, and keeps its mean (fails before)", () => {
    const spike = Array.from({ length: 90 }, (_, i) => (i === 40 ? 5 : 0));
    const r = read(0, spike);
    expect(r.measured).toBe(false);
    expect(r.demandDays).toBe(1);
    expect(r.stockoutProbability).toBeNull();
    expect(r.safetyStock).toBeNull();
    expect(r.reorderPoint).toBeNull();
    expect(r.cv).toBeNull();
    expect(r.stdev).toBeNull();
    expect(r.mean).toBeCloseTo(5 / 90, 12);
    expect(r.daysOfCover).toBe(0);
    // Nothing on hand does not cover the mean lead-time demand.
    expect(r.needsReorder).toBe(true);
    // 0.95 of a bottle covers 7 × 4/90 = 0.31 bottles: not below.
    const four = Array.from({ length: 90 }, (_, i) => (i === 40 ? 4 : 0));
    expect(read(0.95, four).needsReorder).toBe(false);
  });

  it("measures at 14 days with a sale, not at 13, with the engine's own math unchanged (fails before)", () => {
    expect(engine.MIN_DEMAND_DAYS).toBe(14);
    expect(read(1, series(13)).measured).toBe(false);
    expect(read(1, series(13)).stockoutProbability).toBeNull();
    const r = read(1, series(14));
    expect(r.measured).toBe(true);
    expect(r.demandDays).toBe(14);
    const p = E.demandProfile(series(14))!;
    expect(r.stockoutProbability).toBe(
      E.stockoutProbability({
        onHand: 1,
        avgDemandPerPeriod: p.mean,
        demandStdev: p.stdev,
        leadTime: 7,
      }),
    );
    const rop = E.reorderPoint({
      serviceLevel: 0.95,
      avgDemandPerPeriod: p.mean,
      demandStdev: p.stdev,
      avgLeadTime: 7,
    })!;
    expect(r.reorderPoint).toBe(rop.reorderPoint);
    expect(r.safetyStock).toBe(rop.safetyStock);
    expect(r.cv).toBe(p.cv);
    expect(r.needsReorder).toBe(1 <= rop.reorderPoint);
  });

  it("flags an unmeasured row only where the flag is provable, and keeps a wine with no sales flagged at nothing on hand (fails before)", () => {
    // Below a 0.5 service level the safety stock is negative, so "below the
    // reorder point" cannot be shown without the swing.
    expect(read(0, series(3), 0.4).needsReorder).toBe(false);
    const none = read(0, series(0));
    expect(none.measured).toBe(false);
    expect(none.demandDays).toBe(0);
    expect(none.daysOfCover).toBeNull();
    expect(none.stockoutProbability).toBeNull();
    expect(none.needsReorder).toBe(true);
    expect(read(2, series(0)).needsReorder).toBe(false);
  });
});

describe("getInventoryScience counts open ml and withholds an unmeasured risk (AW29 / A-025)", () => {
  it("gives none of Tuzlu's eight one-day wines the 61% tie (fails before)", async () => {
    const out = await analytics(tables(TUZLU)).getInventoryScience(R);
    expect(out.skus).toHaveLength(8);
    for (const s of out.skus) {
      expect([s.name, s.stockoutProbability]).toEqual([s.name, null]);
      expect([s.name, s.reorderPoint, s.safetyStock]).toEqual([
        s.name,
        null,
        null,
      ]);
      expect([s.name, s.xyzClass, s.demandCv]).toEqual([
        s.name,
        "unknown",
        null,
      ]);
    }
    expect((out.params as any).minDemandDays).toBe(14);
  });

  it("counts the open bottle in on hand (fails before)", async () => {
    const out = await analytics(tables(TUZLU)).getInventoryScience(R);
    const onHand = (name: string) =>
      out.skus.find((s: any) => s.name === name)!.onHand;
    expect(onHand("Pierre Ferrand 1840")).toBe(0.95);
    expect(onHand("Efe Black Raki")).toBe(0.33);
    expect(onHand("Metaxa 7 Stars")).toBe(0.6);
    expect(onHand("Sonoma Chardonnay")).toBe(0);
  });

  it("lists only the wines whose bottles do not cover the lead time, soonest out first (fails before)", async () => {
    const out = await analytics(tables(TUZLU)).getInventoryScience(R);
    // Pierre Ferrand (0.95 against 0.31), Beefeater (0.6 against 0.31) and
    // Metaxa (0.6 against 0.23) cover the week; the walk's truth gave them
    // 45, 18.5 and 17.9 days.
    expect(out.reorderCount).toBe(5);
    expect(out.reorderList.map((s: any) => s.name)).toEqual([
      "Sonoma Chardonnay",
      "Tekirdag Raki",
      "Yeni Raki",
      "Jameson Irish Whiskey",
      "Efe Black Raki",
    ]);
    const cover = (name: string) =>
      out.reorderList.find((s: any) => s.name === name)!.daysOfCover;
    expect(cover("Jameson Irish Whiskey")).toBeCloseTo(0.9, 9);
    expect(cover("Efe Black Raki")).toBeCloseTo((250 / 750) * (90 / 13), 9);
  });

  it("keeps the engine's risk for a wine sold on 20 days, lists it first, and counts its open ml (fails before)", async () => {
    const malbec: Wine = {
      name: "Measured Malbec",
      sealed: 1,
      openMl: 375,
      bottleSizeMl: 750,
      sales: everyDay(20),
    };
    const out = await analytics(tables([...TUZLU, malbec])).getInventoryScience(
      R,
    );
    const row = out.skus.find((s: any) => s.name === "Measured Malbec")!;
    const p = E.demandProfile(series(20))!;
    expect(row.onHand).toBe(1.5);
    expect(row.stockoutProbability).toBeCloseTo(
      E.stockoutProbability({
        onHand: 1.5,
        avgDemandPerPeriod: p.mean,
        demandStdev: p.stdev,
        leadTime: 7,
      })!,
      12,
    );
    expect(row.demandCv).toBeCloseTo(p.cv!, 12);
    expect(row.xyzClass).toBe(E.xyzClassify(p.cv));
    expect(out.reorderList[0].name).toBe("Measured Malbec");
  });

  it("leaves on hand at the sealed count when the rollup carries no open ml (control: passes before too)", async () => {
    const plain: Wine = {
      name: "Plain Pinot",
      sealed: 3,
      bottleSizeMl: 750,
      sales: oneDay(2),
    };
    const out = await analytics(tables([plain])).getInventoryScience(R);
    expect(out.skus[0].onHand).toBe(3);
  });
});

describe("Wine-360 reads stock and risk the same way (AW29, third site)", () => {
  it("counts open ml and gives a one-day series no risk, reorder point or safety stock (fails before)", async () => {
    const wine: Wine = {
      name: "Single Day Syrah",
      sealed: 2,
      openMl: 300,
      bottleSizeMl: null,
      sales: oneDay(5),
    };
    const out = await advanced(tables([wine])).getWine360(
      R,
      "mw-single-day-syrah",
    );
    expect(out.onHand).toBeCloseTo(2.4, 9);
    expect(out.stockoutProbability).toBeNull();
    expect(out.reorderPoint).toBeNull();
    expect(out.safetyStock).toBeNull();
    expect(out.daysOfCover).toBeCloseTo(2.4 / (5 / 90), 9);
  });
});

describe("the stockout #1 insight (AW29)", () => {
  it("withholds a one-day wine for lack of history, alone or in a tie (fails before)", async () => {
    const eight = await stockoutRecords(generator(tables(TUZLU)));
    expect(eight).toEqual([]);
    // Alone there is no tie to withhold it, which is what the old code
    // printed as "#1 by stockout risk (61.0%)".
    const one = await stockoutRecords(
      generator(
        tables([
          {
            name: "Lonely Gin",
            sealed: 0,
            openMl: 0,
            bottleSizeMl: 750,
            sales: oneDay(10),
          },
        ]),
      ),
    );
    expect(one).toEqual([]);
  });

  // 250 of 750 ml is 0.3333…, so the sentence's rounding to the tenth is
  // pinned: unrounded it would print "0.3333333333333333".
  const measured: Wine = {
    name: "Open Rioja",
    sealed: 0,
    openMl: 250,
    bottleSizeMl: 750,
    sales: everyDay(20),
  };

  it("ranks a wine sold on 20 days by the risk of what it holds, open bottle included (fails before)", async () => {
    const s = await stockoutRecords(generator(tables([measured])));
    expect(s).toHaveLength(1);
    const p = E.demandProfile(series(20))!;
    const prob = E.stockoutProbability({
      onHand: 250 / 750,
      avgDemandPerPeriod: p.mean,
      demandStdev: p.stdev,
      leadTime: 7,
    })!;
    expect(s[0].evidence.value).toBeCloseTo(prob, 12);
    expect(s[0].effectPct).toBeCloseTo(prob, 12);
    expect(s[0].sentence).toContain("Only 0.3 bottles on hand");
    expect(s[0].z).toBeNull();
  });

  it("stays silent, and says why in the log, when the open-bottle read is refused (fails before)", async () => {
    const svc = generator(tables([measured]), {
      inventory_lot_rollup: { code: "42501", message: "permission denied" },
    });
    const log = jest
      .spyOn((svc as any).logger, "error")
      .mockImplementation(() => undefined);
    expect(await stockoutRecords(svc)).toEqual([]);
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(
      /inventory_lot_rollup/,
    );
  });
});

describe("the restock export says why a risk is missing (ADR 0299)", () => {
  it("names the 14-day floor for a wine with cover and no risk, and keeps 'no measured demand' for one without (fails before)", () => {
    const doc = EXPORT_CUTTINGS.restock.write(
      {
        params: {
          serviceLevel: 0.95,
          leadTimeDays: 7,
          demandWindowDays: 90,
          minDemandDays: 14,
        },
        basis: {},
        skuCount: 12,
        reorderCount: 5,
        reorderList: [
          {
            id: "w1",
            name: "Yeni Raki",
            onHand: 0,
            daysOfCover: 0,
            reorderPoint: null,
            safetyStock: null,
            stockoutProbability: null,
          },
          {
            id: "w2",
            name: "Unsold Gamay",
            onHand: 0,
            daysOfCover: null,
            reorderPoint: null,
            safetyStock: null,
            stockoutProbability: null,
          },
        ],
      },
      { days: null },
    );
    const [yeni, gamay] = doc.tables[0].rows;
    for (const i of [3, 4, 5]) {
      expect(isWithheld(yeni[i])).toBe(true);
      expect((yeni[i] as any).why).toContain("sold on fewer than 14 days");
      expect((gamay[i] as any).why).toContain("no measured demand");
    }
    expect(doc.tables[0].note).toContain(
      "5 wines are below their reorder point",
    );
    expect(doc.tables[0].note).toContain(
      "highest measured risk first, then the fewest days of cover",
    );
  });
});
