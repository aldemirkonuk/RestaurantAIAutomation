import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";

/**
 * QA round 15 finding 2, the analytics half. `resolveUnitCost` reads a cost
 * agreed at delivery (inventory_lot_agreed_cost) as basis `agreed_lot_wac`, but
 * the two loaders only ever selected inventory_lot_rollup, so an item whose
 * only cost is an agreed (final, 'manual') lot still read as unknown here
 * while a recipe priced it. Each loader below must read the view, merge it by
 * inventory_id, and say so when the view cannot be read.
 */

type Rows = Record<string, any[]>;
type Errors = Record<string, { code?: string; message: string }>;

function client(rows: Rows, errors: Errors = {}, selects: string[] = []) {
  return {
    from: (table: string) => {
      const b: any = {};
      // The loaders read the lot views for the ids in hand (readByIds).
      let only: unknown[] | null = null;
      for (const m of ["select", "eq", "gt", "order", "limit"])
        b[m] = (...a: any[]) => {
          if (m === "select") selects.push(`${table}:${a[0]}`);
          return b;
        };
      b.in = (_c: string, vs: unknown[]) => ((only = vs), b);
      b.then = (res: any, rej: any) =>
        Promise.resolve(
          errors[table]
            ? { data: null, error: errors[table] }
            : {
                data: (rows[table] ?? []).filter(
                  (r) => only === null || only.includes(r.inventory_id),
                ),
                error: null,
              },
        ).then(res, rej);
      return b;
    },
  };
}

const RESTAURANT = "44444444-4444-4444-4444-444444444444";
const base = (id: string, extra: object = {}) => ({
  id,
  wine_name: id,
  stock_live: 6,
  menu_price_current: 50,
  last_purchase_price: null,
  threshold_min: 1,
  master_wine_id: `mw-${id}`,
  ...extra,
});
const ROWS: Rows = {
  restaurant_inventory: [base("agreed-only"), base("invoiced")],
  inventory_lot_rollup: [
    { inventory_id: "invoiced", live_qty: 6, wac: "21.5", has_invoice_cost: true, wac_qty: 6 },
  ],
  inventory_lot_agreed_cost: [
    { inventory_id: "agreed-only", has_agreed_cost: true, agreed_wac: "18.123456" },
  ],
};

const analytics = (rows: Rows, errors?: Errors, selects?: string[]) =>
  new AnalyticsService({ getClient: () => client(rows, errors, selects) } as any);
const advanced = (rows: Rows, errors?: Errors, selects?: string[]) =>
  new AdvancedAnalyticsService(
    { getClient: () => client(rows, errors, selects) } as any,
    {} as any,
    {} as any,
    {} as any,
  );

const loaders: Array<[string, (r: Rows, e?: Errors, s?: string[]) => any, string]> = [
  ["AnalyticsService.loadInventory", analytics, "loadInventory"],
  ["AdvancedAnalyticsService.loadInventoryWithCost", advanced, "loadInventoryWithCost"],
];

describe.each(loaders)("%s reads the agreed lot cost", (_n, make, method) => {
  it("prices an item whose only cost is an agreed lot, at its six places", async () => {
    const out = await (make(ROWS) as any)[method](RESTAURANT);
    const a = out.find((r: any) => r.id === "agreed-only");
    expect(a.costBasis).toBe("agreed_lot_wac");
    expect(a.unitCost).toBe(18.123456);
  });

  it("still reports an invoiced item as invoice_lot_wac", async () => {
    const out = await (make(ROWS) as any)[method](RESTAURANT);
    const i = out.find((r: any) => r.id === "invoiced");
    expect(i.costBasis).toBe("invoice_lot_wac");
    expect(i.unitCost).toBe(21.5);
  });

  it("an invoice wins over an agreed cost on the same item", async () => {
    const rows = {
      ...ROWS,
      inventory_lot_agreed_cost: [
        { inventory_id: "invoiced", has_agreed_cost: true, agreed_wac: "9" },
      ],
    };
    const out = await (make(rows) as any)[method](RESTAURANT);
    const i = out.find((r: any) => r.id === "invoiced");
    expect(i.costBasis).toBe("invoice_lot_wac");
    expect(i.unitCost).toBe(21.5);
  });

  it("selects the view scoped to the house", async () => {
    const selects: string[] = [];
    await (make(ROWS, {}, selects) as any)[method](RESTAURANT);
    expect(selects.some((s) => s.startsWith("inventory_lot_agreed_cost:"))).toBe(true);
  });

  it("refuses when the view cannot be read, and states no cost from half of it", async () => {
    // Readers lane r4: a failed agreed-cost read used to be logged and read
    // as "no recorded cost" on every item it priced. It refuses now, as a
    // failed rollup read does (WholeReadError, 503).
    const svc: any = make(ROWS, {
      inventory_lot_agreed_cost: { code: "42P01", message: "view gone" },
    });
    await expect(svc[method](RESTAURANT)).rejects.toThrow(
      /costs agreed at delivery could not be read whole.*view gone/,
    );
  });
});
