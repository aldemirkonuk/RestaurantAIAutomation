import { stateBookFrom } from "./item-state";
import {
  InsightGeneratorService,
  InsightRecord,
} from "./insight-generator.service";

/**
 * Sim 40 (S171), the insight math lane:
 *
 * F-1189 — the forecast gap summed a day the manager ruled out: one 150-bottle
 *          event day in the last week read "running 127% ahead of forecast".
 * F-1191 — a sold-out wine with a demand read Φ(μ/σ) < 1, ranked below wines
 *          still in stock, and the card said "Only 0 bottles on hand".
 * F-1192 — the stockout card (a re-hit of F-630) counted no bottles on order,
 *          averaged demand over 90 days for a wine listed last week, and keyed
 *          demand by master wine, so a drink with no wine record never ranked.
 */

const GAP = "overall.bottles.forecast_gap";
const STOCKOUT = "wine.stockout_risk.peer_rank";
const VENDORS = "vendor.purchase_spend.concentration";
const HOUSE_ROW = [{ timezone: "UTC", country: null }];

/** A PostgREST stand-in that honours the keyset page `readWholeWindow` asks for. */
function makeClient(rowsByTable: Record<string, any[]>) {
  const passthrough = ["select", "eq", "neq", "gte", "lt", "lte", "is", "or"];
  return {
    from: (table: string) => {
      const all =
        rowsByTable[table] ?? (table === "restaurants" ? HOUSE_ROW : []);
      const page: { after?: string; limit?: number } = {};
      const builder: any = {};
      for (const m of [...passthrough, "not", "in", "order"])
        builder[m] = () => builder;
      builder.gt = (col: string, val: unknown) => {
        if (col === "id") page.after = String(val);
        return builder;
      };
      builder.limit = (n: number) => {
        page.limit = n;
        return builder;
      };
      const rows = () => {
        let out = [...all].sort((a, b) =>
          String(a.id) < String(b.id) ? -1 : 1,
        );
        if (page.after !== undefined)
          out = out.filter((r) => String(r.id) > page.after!);
        return page.limit === undefined ? out : out.slice(0, page.limit);
      };
      builder.maybeSingle = () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null });
      builder.single = builder.maybeSingle;
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
      return builder;
    },
  };
}

async function fire(
  rows: Record<string, any[]>,
  excluded: string[] = [],
): Promise<InsightRecord[]> {
  const client = makeClient(rows);
  const gen = new InsightGeneratorService(
    { getClient: () => client, supabase: client } as any,
    {
      load: async () => ({
        dates: new Set(excluded),
        readable: true,
        problem: null,
      }),
    } as any,
    {
      readState: async () => ({
        book: stateBookFrom([]),
        readable: true,
        problem: null,
      }),
    } as any,
  );
  const out = await gen.generate("r1", {
    candidateKeys: [GAP, STOCKOUT, VENDORS],
  });
  return out.insights;
}

const of = (xs: InsightRecord[], key: string) =>
  xs.filter((i) => i.candidateKey === key);

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

let seq = 0;
/** One bottle line for an inventory row on a day back. */
function pour(inv: string, master: string | null, back: number, qty: number) {
  seq += 1;
  return {
    id: `c${String(seq).padStart(6, "0")}`,
    inventory_id: inv,
    consumption_type: "bottle",
    quantity: qty,
    volume_ml: null,
    created_at: `${dayBack(back)}T12:00:00.000Z`,
    restaurant_inventory: { master_wine_id: master },
  };
}

/** A daily demand over `days` days back, `perDay(i)` bottles on day back i. */
function demand(
  inv: string,
  master: string | null,
  days: number,
  perDay: (back: number) => number,
) {
  const out: any[] = [];
  for (let back = days; back >= 1; back--) {
    const q = perDay(back);
    if (q > 0) out.push(pour(inv, master, back, q));
  }
  return out;
}

const item = (id: string, stock: number, extra: Record<string, any> = {}) => ({
  id,
  wine_name: `Wine ${id}`,
  stock_live: stock,
  master_wine_id: `m-${id}`,
  ...extra,
});

describe("the forecast gap leaves out a day the manager ruled out (F-1189)", () => {
  it("does not read an excluded 150-bottle day as running ahead", async () => {
    // A flat 10 a day for 90 days; three days back held a private event the
    // manager ruled out of every baseline.
    const event = 3;
    const rows = demand("inv-a", "m-inv-a", 90, (back) =>
      back === event ? 150 : 10,
    );
    const xs = await fire(
      {
        wine_consumption_log: rows,
        restaurant_inventory: [item("inv-a", 500)],
      },
      [dayBack(event)],
    );
    const gap = of(xs, GAP);
    for (const g of gap)
      expect(Math.abs(g.evidence.forecastGapPct as number)).toBeLessThan(0.05);
    expect(xs.some((i) => /ahead of forecast/.test(i.sentence))).toBe(false);
  });

  it("still scores the week when the ruled-out day sits in the training weeks", async () => {
    const rows = demand("inv-a", "m-inv-a", 90, (back) =>
      back === 30 ? 400 : 10,
    );
    const xs = await fire(
      {
        wine_consumption_log: rows,
        restaurant_inventory: [item("inv-a", 500)],
      },
      [dayBack(30)],
    );
    for (const g of of(xs, GAP))
      expect(Math.abs(g.evidence.forecastGapPct as number)).toBeLessThan(0.05);
  });
});

describe("the stockout card (F-1191, F-1192)", () => {
  it("ranks a sold-out wine with a demand as out of stock, never 'Only 0 bottles'", async () => {
    // A: 6 sales in 90 days and an empty shelf — Φ(μ/σ) read 0.759.
    // B: in stock, a steady demand a little above its shelf — about 0.9.
    const soldOut = demand("inv-a", "m-inv-a", 90, (back) =>
      back % 15 === 0 ? 1 : 0,
    );
    const steady = demand("inv-b", "m-inv-b", 90, (back) => (back % 2 ? 2 : 1));
    const xs = await fire({
      wine_consumption_log: [...soldOut, ...steady],
      restaurant_inventory: [item("inv-a", 0), item("inv-b", 8)],
    });
    const s = of(xs, STOCKOUT);
    expect(s).toHaveLength(1);
    expect(s[0].entityLabel).toBe("Wine inv-a");
    expect(s[0].evidence.value).toBe(1);
    expect(s[0].sentence).toMatch(/Out of stock — reorder now\./);
    expect(s[0].sentence).not.toMatch(/Only 0 bottles/);
  });

  it("counts bottles already on order before it says reorder", async () => {
    const rows = demand("inv-a", "m-inv-a", 90, (back) => (back % 2 ? 2 : 1));
    const xs = await fire({
      wine_consumption_log: rows,
      restaurant_inventory: [item("inv-a", 0)],
      procurement_orders: [
        { id: "o1", inventory_id: "inv-a", bottles_total: 36 },
      ],
    });
    expect(of(xs, STOCKOUT)).toEqual([]);
  });

  it("withholds the card when an open order states no bottle count", async () => {
    const rows = demand("inv-a", "m-inv-a", 90, (back) => (back % 2 ? 2 : 1));
    const xs = await fire({
      wine_consumption_log: rows,
      restaurant_inventory: [item("inv-a", 0)],
      procurement_orders: [
        { id: "o1", inventory_id: "inv-a", bottles_total: null },
      ],
    });
    expect(of(xs, STOCKOUT)).toEqual([]);
  });

  it("averages demand over the days a wine was on the list", async () => {
    // Listed 12 days ago, about 1.5 a day since; 6 on the shelf. Over 90
    // days that read 0.18 a day and no risk at all.
    const rows = demand("inv-a", "m-inv-a", 11, (back) => (back % 2 ? 2 : 1));
    const xs = await fire({
      wine_consumption_log: rows,
      restaurant_inventory: [
        item("inv-a", 6, { created_at: `${dayBack(12)}T09:00:00.000Z` }),
      ],
    });
    const s = of(xs, STOCKOUT);
    expect(s).toHaveLength(1);
    expect(s[0].sentence).toMatch(/Only 6 bottles on hand/);
  });

  it("ranks a drink with no wine record by its own inventory row", async () => {
    const rows = demand("inv-gin", null, 90, (back) => (back % 2 ? 2 : 1));
    const xs = await fire({
      wine_consumption_log: rows,
      restaurant_inventory: [
        { id: "inv-gin", wine_name: "House gin", stock_live: 0 },
      ],
    });
    const s = of(xs, STOCKOUT);
    expect(s).toHaveLength(1);
    expect(s[0].entityLabel).toBe("House gin");
    expect(s[0].sentence).toMatch(/Out of stock/);
  });
});

describe("vendor concentration reads three equal vendors as even (F-1190)", () => {
  it("hands the verbalizer how many vendors the spend splits across", async () => {
    const orders = ["v1", "v2", "v3"].flatMap((v, i) =>
      [0, 1].map((k) => ({
        id: `o${i}${k}`,
        provider_id: v,
        providers: { name: `Vendor ${v}` },
        total_cost: 500,
        currency: "USD",
        delivered_at: `${dayBack(10 + k)}T10:00:00.000Z`,
        created_at: `${dayBack(12 + k)}T10:00:00.000Z`,
        status: "delivered",
      })),
    );
    const xs = await fire({ procurement_orders: orders });
    const c = of(xs, VENDORS);
    expect(c).toHaveLength(1);
    expect(c[0].evidence.entityCount).toBe(3);
    expect(c[0].sentence).toMatch(/evenly spread across your 3 vendors/);
  });
});
