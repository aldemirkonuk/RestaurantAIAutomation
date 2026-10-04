/**
 * A POS sale is dated by its check, and the import says what it did (ADR 0281).
 *
 * Two defects, one path:
 *
 * - A-007 / A-009: a check that reached the hub days after it closed had its
 *   stock and its consumption dated on the day it arrived, because neither
 *   stock RPC took an instant and the consumption row took its column
 *   defaults. A back-filled July landed on one October day.
 * - A-029: a refused or skipped stock write was only logged. `ingest()`
 *   returned a clean result over 811 pours that moved no stock.
 *
 * Every test here fails on the code before ADR 0281: `saleInstant` and
 * `inventoryVolumesFromRow` did not exist, no RPC carried `p_occurred_at`, the
 * consumption row carried no date, and `ingest()` returned no `stock` block.
 * Fixtures are synthetic.
 */
import { Logger } from "@nestjs/common";
import {
  BACKDATED_AFTER_MS,
  PosHubService,
  inventoryVolumesFromRow,
  saleInstant,
} from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

type Row = Record<string, any>;
type Result = { data?: any; error: any };

interface DbOpts {
  mappings?: Row[];
  inventory?: Row[];
  rpc?: (fn: string, args: Row) => Result;
  consumption?: (row: Row) => Result;
  queue?: (row: Row) => Result;
}

function makeDb(opts: DbOpts = {}) {
  const calls = {
    rpc: [] as Array<{ fn: string; args: Row }>,
    consumption: [] as Row[],
    queued: [] as Row[],
  };
  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: async () => ({ data: [], error: null }),
        upsert: async () => ({ error: null }),
        insert: async (row: Row) => {
          if (table === "wine_consumption_log") {
            calls.consumption.push(row);
            return opts.consumption ? opts.consumption(row) : { error: null };
          }
          if (table === "pos_unresolved_lines") {
            calls.queued.push(row);
            return opts.queue ? opts.queue(row) : { error: null };
          }
          return { error: null };
        },
      };
      if (table === "pos_item_mappings") {
        q.in = async () => ({ data: opts.mappings ?? [], error: null });
      }
      if (table === "restaurant_inventory") {
        q.in = async (_col: string, ids: string[]) => ({
          data: (opts.inventory ?? []).filter((r) => ids.includes(r.id)),
          error: null,
        });
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      }
      return q;
    },
    rpc: async (fn: string, args: Row) => {
      calls.rpc.push({ fn, args });
      return opts.rpc ? opts.rpc(fn, args) : { data: "tx-1", error: null };
    },
  };
  return {
    service: new PosHubService({
      getClient: () => client,
    } as unknown as DatabaseService),
    calls,
  };
}

const BOTTLE = {
  external_item_id: "btl-1",
  item_name: "SYNTHETIC Yakut bottle",
  is_wine: true,
  inventory_id: "inv-1",
  sale_unit: "bottle",
  sale_volume_ml: null,
};
const GLASS = {
  external_item_id: "gls-1",
  item_name: "SYNTHETIC Yakut glass",
  is_wine: true,
  inventory_id: "inv-1",
  sale_unit: null,
  sale_volume_ml: 150,
};
const NO_VOLUME = {
  external_item_id: "nv-1",
  item_name: "SYNTHETIC Moscofilero",
  is_wine: true,
  inventory_id: "inv-2",
  sale_unit: null,
  sale_volume_ml: null,
};
const INVENTORY = [
  { id: "inv-1", bottle_size_ml: 750, pour_size_ml: 150 },
  { id: "inv-2", bottle_size_ml: 750, pour_size_ml: null },
];

const line = (m: Row, qty = 1) => ({
  name: m.item_name,
  externalItemId: m.external_item_id,
  qty,
  price: 10,
});
const check = (
  id: string,
  closedAt: unknown,
  items: Row[],
  extra: Row = {},
) => ({
  externalCheckId: id,
  openedAt: "2026-07-14T18:00:00Z",
  closedAt,
  items,
  ...extra,
});

const ingest = async (service: PosHubService, checks: Row[]) =>
  (await service.ingest("r-1", "generic_webhook", checks)) as any;

let warn: jest.SpyInstance;
let error: jest.SpyInstance;
beforeEach(() => {
  warn = jest
    .spyOn(Logger.prototype, "warn")
    .mockImplementation(() => undefined);
  error = jest
    .spyOn(Logger.prototype, "error")
    .mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("saleInstant — when one closed check's stock is dated", () => {
  const NOW = Date.parse("2026-10-03T12:00:00Z");

  it("dates a past check by its own closed_at, passed through as the till sent it", () => {
    const at = "2026-07-14T21:30:00+03:00";
    expect(saleInstant(at, NOW)).toEqual({
      at,
      fellBack: false,
      clamped: false,
      backdatedOver72h: true,
    });
  });

  it("clamps a closed_at in the future to now", () => {
    expect(saleInstant("2026-10-04T12:00:00Z", NOW)).toEqual({
      at: "2026-10-03T12:00:00.000Z",
      fellBack: false,
      clamped: true,
      backdatedOver72h: false,
    });
  });

  it.each([["not a date"], [""], [null], [undefined], [1784000000000]])(
    "falls back to import time, and says so, for closed_at %p",
    (closedAt) => {
      const got = saleInstant(closedAt, NOW);
      expect(got.at).toBe("2026-10-03T12:00:00.000Z");
      expect(got.fellBack).toBe(true);
      expect(got.backdatedOver72h).toBe(false);
    },
  );

  it("counts as back-dated only strictly past 72 hours", () => {
    const exactly = new Date(NOW - BACKDATED_AFTER_MS).toISOString();
    const past = new Date(NOW - BACKDATED_AFTER_MS - 1000).toISOString();
    expect(BACKDATED_AFTER_MS).toBe(72 * 3600 * 1000);
    expect(saleInstant(exactly, NOW).backdatedOver72h).toBe(false);
    expect(saleInstant(past, NOW).backdatedOver72h).toBe(true);
  });
});

describe("inventoryVolumesFromRow — the one rule for an inventory row's sizes", () => {
  it("reads a size that is not a finite positive number as no size", () => {
    expect(
      inventoryVolumesFromRow({
        bottle_size_ml: 0,
        pour_size_ml: -150,
        menu_price_current: null,
      }),
    ).toEqual({ bottleMl: null, pourMl: null, menuPrice: null });
    expect(
      inventoryVolumesFromRow({
        bottle_size_ml: "750",
        pour_size_ml: 150,
        menu_price_current: "",
      }),
    ).toEqual({ bottleMl: 750, pourMl: 150, menuPrice: null });
  });
});

describe("ingest dates stock and consumption by the check (A-007 / A-009)", () => {
  const CLOSED = "2026-07-14T21:30:00Z";

  it("a bottle sale: apply_stock_movement and the consumption row both carry closed_at", async () => {
    const { service, calls } = makeDb({
      mappings: [BOTTLE],
      inventory: INVENTORY,
    });
    await ingest(service, [check("c-1", CLOSED, [line(BOTTLE, 2)])]);

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].fn).toBe("apply_stock_movement");
    expect(calls.rpc[0].args).toMatchObject({
      p_delta: -2,
      p_transaction_type: "sale",
      p_restaurant_id: "r-1",
      p_occurred_at: CLOSED,
    });
    expect(calls.consumption).toHaveLength(1);
    expect(calls.consumption[0]).toMatchObject({
      recorded_at: CLOSED,
      created_at: CLOSED,
    });
  });

  it("a glass sale: record_glass_pour and the consumption row both carry closed_at", async () => {
    const { service, calls } = makeDb({
      mappings: [GLASS],
      inventory: INVENTORY,
    });
    await ingest(service, [check("c-2", CLOSED, [line(GLASS, 3)])]);

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].fn).toBe("record_glass_pour");
    expect(calls.rpc[0].args).toMatchObject({
      p_pours: 3,
      p_pour_ml: 150,
      p_occurred_at: CLOSED,
    });
    expect(calls.consumption[0]).toMatchObject({
      volume_ml: 450,
      recorded_at: CLOSED,
      created_at: CLOSED,
    });
  });

  it("a void is dated by the voided check's closed_at, and writes no consumption", async () => {
    const { service, calls } = makeDb({
      mappings: [BOTTLE],
      inventory: INVENTORY,
    });
    await ingest(service, [
      check("c-3", CLOSED, [line(BOTTLE, 1)], { voided: true }),
    ]);

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].args).toMatchObject({
      p_transaction_type: "return",
      p_delta: 1,
      p_occurred_at: CLOSED,
    });
    expect(calls.consumption).toHaveLength(0);
  });
});

describe("ingest says what it did to stock (A-029)", () => {
  it("partitions every line: booked, queued by reason, not stock", async () => {
    const { service } = makeDb({
      mappings: [BOTTLE, NO_VOLUME],
      inventory: INVENTORY,
    });
    const res = await ingest(service, [
      check("c-10", new Date().toISOString(), [
        line(BOTTLE),
        line(NO_VOLUME),
        { name: "SYNTHETIC house wine carafe", externalItemId: "x-9", qty: 1 },
        { name: "SYNTHETIC espresso", externalItemId: "x-10", qty: 1 },
      ]),
    ]);

    expect(res.stock).toEqual({
      lines: 4,
      notStock: 1,
      booked: 1,
      alreadyBooked: 0,
      queued: { unmapped: 1, no_sale_volume: 1 },
      failed: 0,
      consumptionNotWritten: 0,
      backdatedOver72h: 0,
      datedAtImportTime: 0,
    });
    expect(res.errors).toEqual([]);
  });

  it("a replay is counted as already booked, not booked again", async () => {
    const seen = new Set<string>();
    const { service } = makeDb({
      mappings: [BOTTLE],
      inventory: INVENTORY,
      consumption: (row) => {
        if (seen.has(row.notes))
          return { error: { code: "23505", message: "duplicate key value" } };
        seen.add(row.notes);
        return { error: null };
      },
    });
    const payload = [check("c-11", "2026-07-14T21:30:00Z", [line(BOTTLE)])];

    const first = await ingest(service, payload);
    const again = await ingest(service, payload);

    expect(first.stock).toMatchObject({ booked: 1, alreadyBooked: 0 });
    expect(first.stock.backdatedOver72h).toBe(1);
    expect(again.stock).toMatchObject({
      booked: 0,
      alreadyBooked: 1,
      backdatedOver72h: 0,
    });
    expect(again.errors).toEqual([]);
  });

  it("a refused stock write is failed, and its lines are one grouped sentence in errors[]", async () => {
    const { service } = makeDb({
      mappings: [GLASS],
      inventory: INVENTORY,
      rpc: () => ({
        data: null,
        error: { message: "no stock to pour for inventory inv-1" },
      }),
    });
    const res = await ingest(service, [
      check("c-20", "2026-07-14T21:30:00Z", [line(GLASS)]),
      check("c-21", "2026-07-15T21:30:00Z", [line(GLASS)]),
      check("c-22", "2026-07-16T21:30:00Z", [line(GLASS)]),
    ]);

    expect(res.stock).toMatchObject({ lines: 3, booked: 0, failed: 3 });
    expect(res.stock.backdatedOver72h).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain('"SYNTHETIC Yakut glass"');
    expect(res.errors[0]).toContain("3 lines");
    expect(res.errors[0]).toContain("no stock to pour for inventory inv-1");
    expect(res.errors[0]).toContain("c-20");
  });

  it("a line that could not be queued is failed, never counted as queued", async () => {
    const { service } = makeDb({
      mappings: [NO_VOLUME],
      inventory: INVENTORY,
      queue: () => ({ error: { code: "57014", message: "statement timeout" } }),
    });
    const res = await ingest(service, [
      check("c-30", new Date().toISOString(), [line(NO_VOLUME)]),
    ]);

    expect(res.stock.queued).toEqual({ unmapped: 0, no_sale_volume: 0 });
    expect(res.stock.failed).toBe(1);
    expect(res.errors).toEqual([
      expect.stringContaining(
        "could not be queued for review: statement timeout",
      ),
    ]);
  });

  it("a line already open in the queue (23505) is queued, not failed", async () => {
    const { service } = makeDb({
      mappings: [NO_VOLUME],
      inventory: INVENTORY,
      queue: () => ({ error: { code: "23505", message: "duplicate key" } }),
    });
    const res = await ingest(service, [
      check("c-31", new Date().toISOString(), [line(NO_VOLUME)]),
    ]);

    expect(res.stock).toMatchObject({
      queued: { unmapped: 0, no_sale_volume: 1 },
      failed: 0,
    });
    expect(res.errors).toEqual([]);
  });

  it("stock that moved without its consumption row is booked and said", async () => {
    const { service } = makeDb({
      mappings: [BOTTLE],
      inventory: INVENTORY,
      consumption: () => ({
        error: { code: "42P10", message: "no matching constraint" },
      }),
    });
    const res = await ingest(service, [
      check("c-40", new Date().toISOString(), [line(BOTTLE)]),
    ]);

    expect(res.stock).toMatchObject({ booked: 1, consumptionNotWritten: 1 });
    expect(res.errors).toEqual([
      expect.stringContaining("consumption log row was not written"),
    ]);
    // The database error itself is still logged once, as before.
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("an unreadable closed_at dates at import time and is counted and said", async () => {
    const { service, calls } = makeDb({
      mappings: [BOTTLE],
      inventory: INVENTORY,
    });
    const before = Date.now();
    const res = await ingest(service, [
      check("c-50", "sometime on Tuesday", [line(BOTTLE)]),
    ]);

    const at = Date.parse(calls.rpc[0].args.p_occurred_at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
    expect(res.stock).toMatchObject({ booked: 1, datedAtImportTime: 1 });
    expect(res.errors).toEqual([
      expect.stringContaining("closed_at that could not be read"),
    ]);
  });

  it("bounds errors[]: fifty groups, then one line that counts the rest", async () => {
    const mappings = Array.from({ length: 60 }, (_, i) => ({
      ...BOTTLE,
      external_item_id: `btl-${i}`,
      item_name: `SYNTHETIC wine ${i}`,
    }));
    const { service } = makeDb({
      mappings,
      inventory: INVENTORY,
      rpc: () => ({ data: null, error: { message: "refused" } }),
    });
    const res = await ingest(service, [
      check(
        "c-60",
        new Date().toISOString(),
        mappings.map((m) => line(m)),
      ),
    ]);

    expect(res.stock.failed).toBe(60);
    expect(res.errors).toHaveLength(51);
    expect(res.errors[50]).toBe(
      "stock: 10 more failures across 10 more items are counted in stock but not listed here",
    );
    expect(warn).toHaveBeenCalled();
  });
});
