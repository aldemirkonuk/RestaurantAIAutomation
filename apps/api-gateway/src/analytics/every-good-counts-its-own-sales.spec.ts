import { AnalyticsService, UNNAMED_ITEM } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";

/**
 * Every good counts its own sales (r28 /reports audit, gaps 2 and 3).
 *
 * Menu engineering and the restock list keyed each consumption line by the
 * MASTER WINE of the row it was poured from. Two things followed:
 *
 *  - A beer, a spirit or a soft drink has no master wine, so every one of its
 *    lines was dropped. A priced non-wine good read 0 bottles a day, fell into
 *    "dog" and was told "candidate to delist"; the restock list never saw its
 *    demand and never reordered it.
 *  - Two inventory rows of one master wine (two vintages, two sizes) each took
 *    BOTH rows' lines, so the house's sales were counted twice and each row
 *    was reordered on the other's pours.
 *
 * Invariant: a row's velocity and demand are the bottles of the lines poured
 * from THAT row (`wine_consumption_log.inventory_id`), and a row with any line
 * that carries no bottle figure has none (ADR 0297). Summed over the rows, the
 * bottles equal the bottles of the lines, never more.
 *
 * Every case marked [REVERT-FAILS] fails against the readers before this fix.
 */

type Rows = Record<string, any[]>;

/** Keep only the columns a select names, `col` and `rel(sub, sub)`, as PostgREST does. */
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

/** Keyset paging on `id` with an exact count; filters ignored; selects projected. */
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
      for (const m of ["eq", "neq", "gte", "lte", "lt", "in", "is", "or", "not"])
        b[m] = () => b;
      b.select = (cols: string, opts?: { count?: string }) => {
        if (opts?.count === "exact") counted = true;
        selected = cols;
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
        const page = lim === null ? past : past.slice(0, lim);
        return Promise.resolve({
          data:
            selected === null || selected === "*"
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

const HOUSE = "44444444-4444-4444-4444-444444444444";
const daysAgo = (d: number) =>
  new Date(Date.now() - d * 86400000 - 3600000).toISOString();

/** Two rows of one master wine, a beer with no master wine, and a gin. */
const WINE_A = {
  id: "inv-a",
  wine_name: "Öküzgözü 2021",
  display_name: null,
  stock_live: 6,
  menu_price_current: 60,
  last_purchase_price: 20,
  threshold_min: 2,
  master_wine_id: "mw-1",
  is_active: true,
  master_wine_library: { primary_type: "red", name: "Öküzgözü" },
};
const WINE_B = {
  ...WINE_A,
  id: "inv-b",
  wine_name: "Öküzgözü 2022",
  menu_price_current: 70,
};
const BEER = {
  id: "inv-c",
  wine_name: null,
  display_name: "Efes Pilsen 50 cl",
  stock_live: 48,
  menu_price_current: 9,
  last_purchase_price: 3,
  threshold_min: 12,
  master_wine_id: null,
  is_active: true,
  master_wine_library: null,
};
const GIN = {
  ...BEER,
  id: "inv-d",
  display_name: "",
  wine_name: "",
  master_wine_library: null,
  menu_price_current: 14,
  last_purchase_price: 4,
};

let seq = 0;
/** `count` whole-bottle lines poured from one row, one a day going back. */
function bottles(row: { id: string; master_wine_id: string | null }, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `c-${String(++seq).padStart(6, "0")}`,
    restaurant_id: HOUSE,
    inventory_id: row.id,
    consumption_type: "bottle",
    quantity: 1,
    volume_ml: 750,
    created_at: daysAgo(1 + (i % 20)),
    restaurant_inventory: { master_wine_id: row.master_wine_id, bottle_size_ml: 750 },
  }));
}
/** A line with no bottle figure: a glass with no millilitres. */
function unmeasured(row: { id: string; master_wine_id: string | null }) {
  return {
    ...bottles(row, 1)[0],
    consumption_type: "glass",
    quantity: 2,
    volume_ml: 0,
  };
}

const ROWS: Rows = {
  restaurant_inventory: [WINE_A, WINE_B, BEER, GIN],
  inventory_lot_rollup: [],
  wine_consumption_log: [
    ...bottles(WINE_A, 9),
    ...bottles(WINE_B, 3),
    ...bottles(BEER, 45),
    ...bottles(GIN, 18),
  ],
};

const advanced = (rows: Rows) =>
  new AdvancedAnalyticsService(
    dbOver(rows),
    {} as any,
    {} as any,
    {} as any,
  );
const analytics = (rows: Rows) => new AnalyticsService(dbOver(rows));

const byId = (list: any[], id: string) => list.find((i: any) => i.id === id);

describe("menu engineering: every good counts its own sales", () => {
  it("[REVERT-FAILS] a beer with no master wine has its own velocity, not 0", async () => {
    const out: any = await advanced(ROWS).getMenuEngineering(HOUSE, 90);
    expect(byId(out.items, "inv-c").velocityPerDay).toBeCloseTo(45 / 90, 12);
    expect(byId(out.items, "inv-d").velocityPerDay).toBeCloseTo(18 / 90, 12);
  });

  it("[REVERT-FAILS] the best-selling beer is not told it is a candidate to delist", async () => {
    const out: any = await advanced(ROWS).getMenuEngineering(HOUSE, 90);
    const beer = byId(out.items, "inv-c");
    expect(beer.quadrant).not.toBe("dog");
    expect(beer.quadrant).not.toBe("puzzle");
    expect(beer.action ?? "").not.toMatch(/delist/);
  });

  it("[REVERT-FAILS] two rows of one wine each count only their own bottles", async () => {
    const out: any = await advanced(ROWS).getMenuEngineering(HOUSE, 90);
    expect(byId(out.items, "inv-a").velocityPerDay).toBeCloseTo(9 / 90, 12);
    expect(byId(out.items, "inv-b").velocityPerDay).toBeCloseTo(3 / 90, 12);
    // Summed over the rows, never more than the lines.
    const total = out.items.reduce((s: number, i: any) => s + i.velocityPerDay * 90, 0);
    expect(total).toBeCloseTo(9 + 3 + 45 + 18, 9);
  });

  it("[REVERT-FAILS] a row with an unmeasured line has no velocity; its sibling of the same wine keeps its own", async () => {
    const out: any = await advanced({
      ...ROWS,
      wine_consumption_log: [...ROWS.wine_consumption_log, unmeasured(WINE_B)],
    }).getMenuEngineering(HOUSE, 90);
    expect(byId(out.items, "inv-b").velocityPerDay).toBeNull();
    expect(byId(out.items, "inv-a").velocityPerDay).toBeCloseTo(9 / 90, 12);
    expect(out.counts.unmeasured).toBe(1);
  });

  it("[REVERT-FAILS] an unmeasured line of a beer leaves the beer with no velocity, never its counted part", async () => {
    const out: any = await advanced({
      ...ROWS,
      wine_consumption_log: [...ROWS.wine_consumption_log, unmeasured(BEER)],
    }).getMenuEngineering(HOUSE, 90);
    expect(byId(out.items, "inv-c").velocityPerDay).toBeNull();
    expect(byId(out.items, "inv-c").quadrant).toBeNull();
  });

  it("[REVERT-FAILS] a good is named by its own name, then its display name, never by an id", async () => {
    const out: any = await advanced(ROWS).getMenuEngineering(HOUSE, 90);
    expect(byId(out.items, "inv-a").name).toBe("Öküzgözü 2021");
    expect(byId(out.items, "inv-c").name).toBe("Efes Pilsen 50 cl");
    // Blank names and no library row: said as unnamed, not as "inv-d".
    expect(byId(out.items, "inv-d").name).toBe(UNNAMED_ITEM);
  });

  it("[REVERT-FAILS] a wine row with no name of its own reads the library's", async () => {
    const out: any = await advanced({
      ...ROWS,
      restaurant_inventory: [{ ...WINE_A, wine_name: null }, WINE_B, BEER, GIN],
    }).getMenuEngineering(HOUSE, 90);
    expect(byId(out.items, "inv-a").name).toBe("Öküzgözü");
  });
});

describe("the restock list: every good reorders on its own demand", () => {
  it("[REVERT-FAILS] a beer with no master wine has demand and days of cover", async () => {
    const out: any = await analytics(ROWS).getInventoryScience(HOUSE);
    const beer = byId(out.skus, "inv-c");
    expect(beer.avgDailyDemand).toBeCloseTo(45 / 90, 12);
    expect(beer.daysOfCover).toBeCloseTo(48 / (45 / 90), 9);
    expect(beer.demandUnknown).toBe(false);
  });

  it("[REVERT-FAILS] two rows of one wine are not each reordered on both rows' pours", async () => {
    const out: any = await analytics(ROWS).getInventoryScience(HOUSE);
    expect(byId(out.skus, "inv-a").avgDailyDemand).toBeCloseTo(9 / 90, 12);
    expect(byId(out.skus, "inv-b").avgDailyDemand).toBeCloseTo(3 / 90, 12);
    const total = out.skus.reduce((s: number, k: any) => s + k.avgDailyDemand * 90, 0);
    expect(total).toBeCloseTo(9 + 3 + 45 + 18, 9);
  });

  it("[REVERT-FAILS] an unmeasured line marks only its own row unassessed", async () => {
    const out: any = await analytics({
      ...ROWS,
      wine_consumption_log: [...ROWS.wine_consumption_log, unmeasured(WINE_B)],
    }).getInventoryScience(HOUSE);
    expect(byId(out.skus, "inv-b").demandUnknown).toBe(true);
    expect(byId(out.skus, "inv-b").reorderPoint).toBeNull();
    expect(byId(out.skus, "inv-a").demandUnknown).toBe(false);
    expect(byId(out.skus, "inv-a").avgDailyDemand).toBeCloseTo(9 / 90, 12);
  });

  it("[REVERT-FAILS] an unmeasured line of a beer leaves the beer unassessed, never reordered on its counted part", async () => {
    const out: any = await analytics({
      ...ROWS,
      wine_consumption_log: [...ROWS.wine_consumption_log, unmeasured(BEER)],
    }).getInventoryScience(HOUSE);
    expect(byId(out.skus, "inv-c").demandUnknown).toBe(true);
    expect(byId(out.skus, "inv-c").needsReorder).toBe(false);
  });
});
