/**
 * What the consumption log says a table-side sale took in, and what a void
 * takes back out (r56, table-side money audit).
 *
 * THE RULES, written before the cases that test them:
 *
 *  R1 A line is booked at the price the till rang. A zero is a zero: a comped
 *     glass took no money (ADR 0105 D5), so its row says no money. It is
 *     never filled from the item's menu price.
 *  R2 The bottle's menu price is a bottle's price. It never stands in for a
 *     pour: a glass line with no usable price books no revenue, not a bottle's.
 *  R3 A voided line "never happened". Its stock came back, and the consumption
 *     row it booked when it sold is zeroed, so velocity, revenue and top
 *     sellers stop counting it. The row stays (the partial unique index on
 *     notes still holds), so a replayed sale cannot book it a second time.
 *  R4 A void with no earlier sale row changes nothing.
 */
import { Logger } from "@nestjs/common";
import { PosHubService, consumptionUnitPrice } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

type Row = Record<string, any>;

function makeDb(opts: { bottleMl?: number; pourMl?: number; menu?: number }) {
  const consumption = new Map<string, Row>();
  const updates: Array<{ patch: Row; filters: Row }> = [];
  const client: any = {
    from(table: string) {
      const filters: Row = {};
      let patch: Row | null = null;
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => {
          filters[k] = v;
          return q;
        },
        in: () => q,
        upsert: async () => ({ error: null }),
        update: (p: Row) => {
          patch = p;
          return q;
        },
        insert: async (row: Row) => {
          if (table !== "wine_consumption_log") return { error: null };
          if (consumption.has(row.notes))
            return { error: { code: "23505", message: "duplicate" } };
          consumption.set(row.notes, { ...row });
          return { error: null };
        },
        then: (res: any, rej: any) => {
          if (table === "wine_consumption_log" && patch) {
            updates.push({ patch, filters: { ...filters } });
            const hit = consumption.get(filters.notes);
            if (
              hit &&
              hit.restaurant_id === filters.restaurant_id &&
              hit.source === filters.source
            )
              Object.assign(hit, patch);
          }
          return Promise.resolve({ error: null }).then(res, rej);
        },
      };
      if (table === "pos_item_mappings")
        q.in = async () => ({
          data: [
            {
              external_item_id: "item-1",
              item_name: "House Red",
              is_wine: true,
              inventory_id: "inv-1",
              sale_unit: "glass",
            },
          ],
          error: null,
        });
      if (table === "restaurant_inventory")
        q.in = async () => ({
          data: [
            {
              id: "inv-1",
              bottle_size_ml: opts.bottleMl ?? 750,
              pour_size_ml: opts.pourMl ?? 150,
              menu_price_current: opts.menu ?? 90,
            },
          ],
          error: null,
        });
      if (table === "restaurant_tables")
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      return q;
    },
    rpc: async () => ({ data: "tx-1", error: null }),
  };
  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    consumption,
    updates,
  };
}

const check = (over: Row = {}, item: Row = {}) => ({
  externalCheckId: "chk-1",
  openedAt: "2026-09-02T18:00:00Z",
  closedAt: "2026-09-02T19:00:00Z",
  items: [
    { name: "House Red", externalItemId: "item-1", qty: 2, price: 12, ...item },
  ],
  ...over,
});
// r57 D2: the key names the line by item, modifiers, price and occurrence.
const KEY = "pos:generic_webhook:chk-1:item-1||12.0000:#0";
const KEY_COMPED = "pos:generic_webhook:chk-1:item-1||0.0000:#0";

describe("consumptionUnitPrice (R1, R2)", () => {
  it("a rung price is the price, and a rung zero is a zero", () => {
    expect(consumptionUnitPrice(12, "volume", 90)).toBe(12);
    expect(consumptionUnitPrice(0, "volume", 90)).toBe(0);
    expect(consumptionUnitPrice(0, "whole_bottle", 90)).toBe(0);
  });
  it("only a price that is not a number falls back, and only to a bottle's price for a bottle", () => {
    expect(consumptionUnitPrice(NaN, "whole_bottle", 90)).toBe(90);
    expect(consumptionUnitPrice(NaN, "whole_bottle", null)).toBeNull();
    expect(consumptionUnitPrice(NaN, "volume", 90)).toBeNull();
    expect(consumptionUnitPrice(undefined as any, "volume", 90)).toBeNull();
    expect(consumptionUnitPrice(null as any, "whole_bottle", 90)).toBe(90);
  });
  it("property: over seeded prices the result is the rung price whenever one was rung", () => {
    let s = 20261118;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 500; i++) {
      const price = rnd() < 0.2 ? 0 : Math.round(rnd() * 20000) / 100;
      const menu = rnd() < 0.3 ? null : Math.round(rnd() * 50000) / 100;
      const mode = rnd() < 0.5 ? "volume" : "whole_bottle";
      expect(consumptionUnitPrice(price, mode as any, menu)).toBe(price);
    }
  });
});

describe("the consumption row a till line books", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it("a comped glass books no revenue, not the bottle's menu price", async () => {
    const { db, consumption } = makeDb({});
    await new PosHubService(db).ingest("r1", "generic_webhook", [
      check({}, { price: 0 }),
    ]);
    const row = consumption.get(KEY_COMPED)!;
    expect(row.unit_price).toBe(0);
    expect(row.total_revenue).toBe(0);
  });

  it("a paid glass books its own price times its count", async () => {
    const { db, consumption } = makeDb({});
    await new PosHubService(db).ingest("r1", "generic_webhook", [check()]);
    expect(consumption.get(KEY)).toMatchObject({
      unit_price: 12,
      total_revenue: 24,
      consumption_type: "glass",
      volume_ml: 300,
    });
  });
});

describe("a void takes its sale out of the consumption log (R3, R4)", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it("zeroes the row the sale booked", async () => {
    const { db, consumption } = makeDb({});
    const svc = new PosHubService(db);
    await svc.ingest("r1", "generic_webhook", [check()]);
    expect(consumption.get(KEY)!.quantity).toBe(2);
    await svc.ingest("r1", "generic_webhook", [check({ voided: true })]);
    expect(consumption.get(KEY)).toMatchObject({
      quantity: 0,
      volume_ml: 0,
      total_revenue: 0,
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("a replay of the sale after the void does not book it again", async () => {
    const { db, consumption } = makeDb({});
    const svc = new PosHubService(db);
    await svc.ingest("r1", "generic_webhook", [check()]);
    await svc.ingest("r1", "generic_webhook", [check({ voided: true })]);
    await svc.ingest("r1", "generic_webhook", [check()]);
    expect(consumption.get(KEY)!.quantity).toBe(0);
  });

  it("a void that arrives with no earlier sale writes no row and no error", async () => {
    const { db, consumption } = makeDb({});
    await new PosHubService(db).ingest("r1", "generic_webhook", [
      check({ voided: true }),
    ]);
    expect(consumption.size).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("the update is scoped to this house's POS row for this key", async () => {
    const { db, updates } = makeDb({});
    const svc = new PosHubService(db);
    await svc.ingest("r1", "generic_webhook", [check()]);
    await svc.ingest("r1", "generic_webhook", [check({ voided: true })]);
    expect(updates).toHaveLength(1);
    expect(updates[0].filters).toMatchObject({
      restaurant_id: "r1",
      source: "pos",
      notes: KEY,
    });
  });
});
