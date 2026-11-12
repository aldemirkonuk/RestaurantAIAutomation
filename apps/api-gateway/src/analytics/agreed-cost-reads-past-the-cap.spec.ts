import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { MarginAdviceService } from "../pricing/margin-advice.service";
import { BY_IDS_CHUNK } from "../common/read-by-ids";

/**
 * Readers lane r4: the three readers #945 taught the agreed cost read the
 * house's wines and both lot views past PostgREST's 1,000 rows, or refuse.
 * Unranged, a house with 1,500 wines (the measured house holds 1,510) was
 * priced on its first thousand, and a wine past the thousandth agreed-cost
 * row fell back to "no recorded cost".
 *
 * The double answers as PostgREST does: never more than 1,000 rows, an exact
 * count when asked, and the filters a reader hands it.
 */

const HOUSE = "house-1";
const CAP = 1000;
const N = 1500;
const pad = (i: number) => String(i).padStart(5, "0");

function capped(tables: Record<string, any[]>, failOn?: (t: string, n: number) => boolean) {
  const calls: Record<string, number> = {};
  const asked: Record<string, number[]> = {};
  return {
    asked,
    from(table: string) {
      const keep: Array<(r: any) => boolean> = [];
      let counted = false;
      let orderBy: string | null = null;
      let limit = Infinity;
      const q: any = {
        select: (_c: string, o?: { count?: string }) => ((counted = o?.count === "exact"), q),
        eq: (c: string, v: unknown) => (keep.push((r) => c === "is_active" || r[c] === v), q),
        in: (c: string, vs: unknown[]) => {
          (asked[table] ??= []).push(vs.length);
          keep.push((r) => vs.includes(r[c]));
          return q;
        },
        gt: (c: string, v: string) => (keep.push((r) => String(r[c]) > v), q),
        is: (c: string, v: unknown) => (keep.push((r) => (r[c] ?? null) === v), q),
        maybeSingle: () => q.then((r: any) => ({ data: r.data?.[0] ?? null, error: r.error })),
        order: (c: string) => ((orderBy = c), q),
        limit: (n: number) => ((limit = n), q),
        then: (res: any, rej: any) => {
          const n = (calls[table] = (calls[table] ?? 0) + 1);
          if (failOn?.(table, n))
            return Promise.resolve({ data: null, error: { code: "57014", message: "timeout" }, count: null }).then(res, rej);
          const all = (tables[table] ?? []).filter((r) => keep.every((f) => f(r)));
          if (orderBy) {
            const k = orderBy;
            all.sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0));
          }
          return Promise.resolve({
            data: all.slice(0, Math.min(limit, CAP)),
            error: null,
            count: counted ? all.length : null,
          }).then(res, rej);
        },
      };
      return q;
    },
  };
}

/** 1,500 wines; every wine's only cost is agreed at delivery, at 10 + i/1000. */
function house() {
  const ids = Array.from({ length: N }, (_, i) => `inv-${pad(i)}`);
  return {
    ids,
    tables: {
      restaurants: [{ id: HOUSE, target_margin_pct: 70 }],
      restaurant_inventory: ids.map((id, i) => ({
        id,
        restaurant_id: HOUSE,
        wine_name: `Wine ${i}`,
        sale_type: "bottle",
        stock_live: 6,
        menu_price_current: 60,
        menu_price_glass: null,
        last_purchase_price: null,
        threshold_min: 1,
        bottle_size_ml: 750,
        master_wine_id: `mw-${i}`,
        master_wine_library: { primary_type: "red", name: `Wine ${i}`, bottle_size_ml: 750 },
      })),
      inventory_lot_rollup: [],
      inventory_lot_agreed_cost: ids.map((id, i) => ({
        inventory_id: id,
        restaurant_id: HOUSE,
        has_agreed_cost: true,
        agreed_wac: String(10 + i / 1000),
      })),
      house_price_locks: [],
    } as Record<string, any[]>,
  };
}

const analytics = (db: any) => new AnalyticsService({ getClient: () => db } as any) as any;
const advanced = (db: any) =>
  new AdvancedAnalyticsService({ getClient: () => db } as any, {} as any, {} as any, {} as any) as any;

describe.each([
  ["AnalyticsService.loadInventory", analytics, "loadInventory"],
  ["AdvancedAnalyticsService.loadInventoryWithCost", advanced, "loadInventoryWithCost"],
] as const)("%s reads every wine and its agreed cost", (_n, make, method) => {
  it("prices all 1,500 wines, the last one at its own agreed cost", async () => {
    const { tables } = house();
    const db = capped(tables);
    const out = await make(db)[method](HOUSE);
    expect(out).toHaveLength(N);
    const last = out.find((r: any) => r.id === `inv-${pad(N - 1)}`);
    expect(last.costBasis).toBe("agreed_lot_wac");
    expect(last.unitCost).toBeCloseTo(10 + (N - 1) / 1000, 6);
    expect(out.every((r: any) => r.costBasis === "agreed_lot_wac")).toBe(true);
    // Each view is asked for the ids in hand, a batch at a time.
    expect(Math.max(...db.asked.inventory_lot_agreed_cost)).toBeLessThanOrEqual(BY_IDS_CHUNK);
  });

  it("refuses when a later batch of agreed costs keeps failing", async () => {
    const { tables } = house();
    const db = capped(tables, (t, n) => t === "inventory_lot_agreed_cost" && n >= 9);
    await expect(make(db)[method](HOUSE)).rejects.toThrow(/could not be read whole/);
  });

  // Fix round: a batch that errors once is asked once more, so one transient
  // timeout in a 1,510-item house's 32 requests does not refuse the page.
  it("asks a batch that errored once more, and prices every wine", async () => {
    const { tables } = house();
    const db = capped(tables, (t, n) => t === "inventory_lot_agreed_cost" && n === 9);
    const out = await make(db)[method](HOUSE);
    expect(out).toHaveLength(N);
    expect(out.every((r: any) => r.costBasis === "agreed_lot_wac")).toBe(true);
  });
});

describe("MarginAdviceService.adviseHouse reads every wine and its agreed cost", () => {
  const advise = (db: any) =>
    new MarginAdviceService({ client: { ...db, rpc: async () => ({ data: null, error: null }) } } as any).adviseHouse(HOUSE);

  it("advises all 1,500 wines, none of them 'no recorded cost'", async () => {
    const { tables } = house();
    const out: any = await advise(capped(tables));
    expect(out.wines).toHaveLength(N);
    expect(out.counts.no_cost ?? 0).toBe(0);
  });

  it("refuses, naming the cost read, when a later batch fails", async () => {
    const { tables } = house();
    await expect(
      advise(capped(tables, (t, n) => t === "inventory_lot_agreed_cost" && n >= 9)),
    ).rejects.toThrow(/recorded costs could not be read/);
  });
});
