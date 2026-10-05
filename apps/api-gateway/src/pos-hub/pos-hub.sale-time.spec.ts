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
 * Every test here but one fails on the code before ADR 0281 (measured
 * against origin/main 1aa4dcb8c, 2026-10-04, and again against origin/main
 * 28d32de36 once the cases for the audit at 1a7a4137d were added: 54 of 55
 * fail): `saleInstant` and `inventoryVolumesFromRow` did not exist, no RPC
 * carried `p_occurred_at`, the consumption row carried no date, and
 * `ingest()` returned no `stock` block. The exception is the open-check case,
 * which pins behaviour that did not change. The zone-less and future cases in
 * the "one reading" block also fail on PR #603 at 01ac04eaa, which read
 * closed_at with JavaScript but handed the till's own string on for Postgres
 * to read again (the ADR 0090 audit's BLOCK).
 *
 * PR #603 at 1a7a4137d read closed_at with V8's lenient `Date.parse`, so a
 * string Postgres refuses ("12", "0", "2026-02-30", "2026-09-31T21:00:00Z")
 * dated a sale on an instant the till never sent (the ADR 0090 audit's
 * BLOCK there). Run against that head's service, 22 of the 55 cases here
 * fail, among them each of those strings in the saleInstant block and in the
 * refusal case of the A-029 block; the other 33 pass there too and pin
 * behaviour the strict read keeps.
 * Fixtures are synthetic.
 */
import { execFileSync } from "child_process";
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
  /** What the pos_checks upsert answers; accepted when absent. */
  checkUpsert?: (row: Row) => Result;
}

function makeDb(opts: DbOpts = {}) {
  const calls = {
    checks: [] as Row[],
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
        upsert: async (row: Row) => {
          if (table === "pos_checks") {
            calls.checks.push(row);
            if (opts.checkUpsert) return opts.checkUpsert(row);
          }
          return { error: null };
        },
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

  it("dates a past check by its own closed_at, read once and carried as one UTC instant", () => {
    expect(saleInstant("2026-07-14T21:30:00+03:00", NOW)).toEqual({
      closedAt: "2026-07-14T18:30:00.000Z",
      at: "2026-07-14T18:30:00.000Z",
      fellBack: false,
      clamped: false,
      backdatedOver72h: true,
    });
  });

  it("clamps a closed_at in the future to now for stock, and keeps it on the check", () => {
    expect(saleInstant("2026-10-04T12:00:00Z", NOW)).toEqual({
      closedAt: "2026-10-04T12:00:00.000Z",
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
      // The check keeps what the till sent; only the stock falls back.
      expect(got.closedAt).toBe(closedAt ?? null);
    },
  );

  // The ADR 0090 audit of PR #603 at 1a7a4137d. V8's Date.parse reads each of
  // these as a real day ("12" and "Table 12" as 2001-12-01, "0" as
  // 2000-01-01, "2026-02-30" as 2 March, "2026-09-31" as 1 October), and
  // Postgres refuses every one (read-only casts in PostgreSQL 17.11, recorded
  // in p4-scratch/sim-run/fixes/audits/603-closed-at-casts.txt). Read by
  // Date.parse, each dated a sale on an instant the till never sent.
  it.each([
    ["12"],
    ["Table 12"],
    ["0"],
    ["2026-02-30"],
    ["2026-02-30T10:00:00Z"],
    ["2026-09-31T21:00:00Z"],
  ])(
    "does not read %p, which Postgres refuses: it falls back, never counted as back-dated",
    (closedAt) => {
      expect(saleInstant(closedAt, NOW)).toEqual({
        closedAt,
        at: "2026-10-03T12:00:00.000Z",
        fellBack: true,
        clamped: false,
        backdatedOver72h: false,
      });
    },
  );

  // Postgres reads these, but they are outside the strict read, so each falls
  // back: 24:00 and a leap second fail the round trip, +15:00 is wider than any
  // real offset and :60 is no minute, and the rest are not the ISO-8601 shape
  // read here (RFC 2822, a two-digit year, a POSIX-looking zone, lower-case z,
  // the basic format).
  it.each([
    ["2026-10-01T24:00:00Z"],
    ["2026-10-01T23:59:60Z"],
    ["2026-10-01T22:00:00+15:00"],
    ["2026-10-01T22:00:00+03:60"],
    ["Thu, 01 Oct 2026 22:00:00 +0300"],
    ["1/1/50"],
    ["2026-10-01 15:00:00 UTC+3"],
    ["2026-10-01T22:00:00z"],
    ["20261001T220000Z"],
  ])("falls back on %p, which is not a strict ISO-8601 instant", (closedAt) => {
    const got = saleInstant(closedAt, NOW);
    expect(got).toMatchObject({ closedAt, fellBack: true });
    expect(got.at).toBe("2026-10-03T12:00:00.000Z");
  });

  it.each([
    // An offset in hours alone: V8's Date.parse gives NaN, Postgres +03:00.
    ["2026-07-14T21:30:00+03", "2026-07-14T18:30:00.000Z"],
    ["2026-07-14T21:30:00+0300", "2026-07-14T18:30:00.000Z"],
    ["2026-07-14T21:30:00-02:30", "2026-07-15T00:00:00.000Z"],
    ["2026-07-14T21:30Z", "2026-07-14T21:30:00.000Z"],
    // A space for T, and a fraction kept to the millisecond.
    ["2026-07-14 21:30:00.123456Z", "2026-07-14T21:30:00.123Z"],
    // A date alone is UTC midnight, as ECMAScript reads a date-only form.
    ["2026-07-14", "2026-07-14T00:00:00.000Z"],
    // A leap day; a year below 100, which Date.UTC would move to 19xx.
    ["2024-02-29T12:00:00Z", "2024-02-29T12:00:00.000Z"],
    ["0050-01-01T00:00:00Z", "0050-01-01T00:00:00.000Z"],
    ["  2026-07-14T21:30:00Z  ", "2026-07-14T21:30:00.000Z"],
  ])("reads %p as %p", (closedAt, read) => {
    expect(saleInstant(closedAt, NOW)).toMatchObject({
      closedAt: read,
      at: read,
      fellBack: false,
    });
  });

  it("keeps a zone-less reading only within 14 hours of the written wall clock", () => {
    // The gateway's zone is injected through Date.parse, as in the Istanbul
    // case below; only a zone-less string reaches Date.parse.
    const ZONELESS = "2026-07-14 21:30:00";
    const wall = Date.parse("2026-07-14T21:30:00Z");
    const realParse = Date.parse;
    const parse = jest.spyOn(Date, "parse");
    parse.mockImplementation((s: string) =>
      s === ZONELESS ? wall - 14 * 3600 * 1000 : realParse(s),
    );
    expect(saleInstant(ZONELESS, NOW)).toMatchObject({
      at: "2026-07-14T07:30:00.000Z",
      fellBack: false,
    });
    parse.mockImplementation((s: string) =>
      s === ZONELESS ? wall - 14 * 3600 * 1000 - 1 : realParse(s),
    );
    expect(saleInstant(ZONELESS, NOW).fellBack).toBe(true);
  });

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
  // What the one reading of CLOSED sends: the same instant, in UTC.
  const AT = "2026-07-14T21:30:00.000Z";

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
      p_occurred_at: AT,
    });
    expect(calls.consumption).toHaveLength(1);
    expect(calls.consumption[0]).toMatchObject({
      recorded_at: AT,
      created_at: AT,
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
      p_occurred_at: AT,
    });
    expect(calls.consumption[0]).toMatchObject({
      volume_ml: 450,
      recorded_at: AT,
      created_at: AT,
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
      p_occurred_at: AT,
    });
    expect(calls.consumption).toHaveLength(0);
  });
});

describe("one reading of closed_at dates the check, its stock and its consumption", () => {
  // The ADR 0090 audit of PR #603 at 01ac04eaa measured strings that
  // JavaScript and Postgres read differently. That head decided past or
  // future with JavaScript and handed the till's string on, so Postgres read
  // it again: the ledger took LEAST(its reading, now()), while pos_checks and
  // the consumption row kept its reading, and a sale's stock and revenue could
  // land on different days. Now every row is handed the gateway's one reading
  // as a UTC string, which Postgres reads the same in any zone. Since the
  // audit at 1a7a4137d the gateway reads only a strict ISO-8601 instant; a
  // string the two parsers read apart in other ways is not read, so it stays
  // on the check for Postgres, and the stock and consumption are dated at
  // import time and said.
  const NOW = Date.parse("2026-10-05T00:00:00Z");

  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });

  /** Ingest one check with a bottle line and a glass line, so both RPCs run. */
  const ingestBoth = async (closedAt: string) => {
    const { service, calls } = makeDb({
      mappings: [BOTTLE, GLASS],
      inventory: INVENTORY,
    });
    const res = await ingest(service, [
      check("c-one", closedAt, [line(BOTTLE), line(GLASS)]),
    ]);
    expect(calls.checks).toHaveLength(1);
    expect(calls.rpc.map((c) => c.fn).sort()).toEqual([
      "apply_stock_movement",
      "record_glass_pour",
    ]);
    expect(calls.consumption).toHaveLength(2);
    return { calls, res };
  };

  /** Every date the import wrote for the check, in one list. */
  const datesWritten = (
    calls: Awaited<ReturnType<typeof ingestBoth>>["calls"],
  ) => [
    calls.checks[0].closed_at,
    ...calls.rpc.map((c) => c.args.p_occurred_at),
    ...calls.consumption.flatMap((r) => [r.recorded_at, r.created_at]),
  ];

  it.each([
    // A two-digit year: V8 reads 1950, Postgres 2050.
    ["1/1/50"],
    // A POSIX-looking zone: V8 reads +3 as ahead of UTC (12:00Z), Postgres
    // with POSIX's sign (18:00Z).
    ["2026-10-04 15:00:00 UTC+3"],
  ])(
    "%p is not read: the check keeps it, and its stock and consumption are dated at import time and said",
    async (closedAt) => {
      const { calls, res } = await ingestBoth(closedAt);
      expect(calls.checks[0].closed_at).toBe(closedAt);
      expect(datesWritten(calls).slice(1)).toEqual(
        Array(6).fill(new Date(NOW).toISOString()),
      );
      expect(res.stock).toMatchObject({
        booked: 2,
        datedAtImportTime: 2,
        backdatedOver72h: 0,
      });
      expect(res.errors).toEqual([
        expect.stringContaining(
          "closed_at that is not an ISO-8601 date the import reads",
        ),
      ]);
    },
  );

  it("a zone-less string on a gateway in Europe/Istanbul is that gateway's reading everywhere", async () => {
    // Setting process.env.TZ inside a jest test does not reach the Date the
    // test runs (measured 2026-10-04: no effect), so the gateway's zone is
    // injected through Date.parse, with the value Node itself reads under
    // TZ=Europe/Istanbul. Postgres in a UTC session reads the same string as
    // 15:00Z.
    const ZONELESS = "2026-10-04 15:00:00";
    const istanbul = Number(
      execFileSync(
        process.execPath,
        [
          "-e",
          `process.stdout.write(String(Date.parse(${JSON.stringify(ZONELESS)})))`,
        ],
        { env: { ...process.env, TZ: "Europe/Istanbul" } },
      ).toString(),
    );
    expect(new Date(istanbul).toISOString()).toBe("2026-10-04T12:00:00.000Z");
    const realParse = Date.parse;
    jest
      .spyOn(Date, "parse")
      .mockImplementation((s: string) =>
        s === ZONELESS ? istanbul : realParse(s),
      );

    const { calls } = await ingestBoth(ZONELESS);
    expect(datesWritten(calls)).toEqual(
      Array(7).fill("2026-10-04T12:00:00.000Z"),
    );
  });

  it("a future closed_at stays on the check, and its stock and consumption are clamped to now", async () => {
    const { calls } = await ingestBoth("2026-10-06T09:00:00+03:00");
    expect(calls.checks[0].closed_at).toBe("2026-10-06T06:00:00.000Z");
    expect(datesWritten(calls).slice(1)).toEqual(
      Array(6).fill(new Date(NOW).toISOString()),
    );
  });

  it("an open check is stored with no closed_at and moves no stock", async () => {
    const { service, calls } = makeDb({
      mappings: [BOTTLE],
      inventory: INVENTORY,
    });
    await ingest(service, [check("c-open", null, [line(BOTTLE)])]);
    expect(calls.checks[0].closed_at).toBeNull();
    expect(calls.rpc).toHaveLength(0);
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
    // The check keeps the till's string: only its stock is dated at import
    // time, and errors[] says so.
    expect(calls.checks[0].closed_at).toBe("sometime on Tuesday");
    expect(res.stock).toMatchObject({ booked: 1, datedAtImportTime: 1 });
    expect(res.errors).toEqual([
      expect.stringContaining(
        "closed_at that is not an ISO-8601 date the import reads",
      ),
    ]);
  });

  it.each([
    ["12"],
    ["Table 12"],
    ["0"],
    ["2026-02-30"],
    ["2026-09-31T21:00:00Z"],
  ])(
    "a closed_at Postgres refuses (%p) reaches it as sent: the check is not stored, moves no stock, and errors[] says so",
    async (closedAt) => {
      // The upsert refuses the till's own string, as Postgres 17.11 does
      // (603-closed-at-casts.txt; the message is a stand-in), and accepts
      // anything else, so a reading of the string would be stored.
      const { service, calls } = makeDb({
        mappings: [BOTTLE, GLASS],
        inventory: INVENTORY,
        checkUpsert: (row) =>
          row.closed_at === closedAt
            ? {
                error: {
                  message: `Postgres refused "${closedAt}"`,
                },
              }
            : { error: null },
      });
      const res = await ingest(service, [
        check("c-bad", closedAt, [line(BOTTLE), line(GLASS)]),
      ]);

      expect(calls.checks[0].closed_at).toBe(closedAt);
      expect(res.upserted).toBe(0);
      expect(calls.rpc).toHaveLength(0);
      expect(calls.consumption).toHaveLength(0);
      expect(res.stock).toMatchObject({
        lines: 0,
        booked: 0,
        backdatedOver72h: 0,
        datedAtImportTime: 0,
      });
      expect(res.errors).toEqual([`c-bad: Postgres refused "${closedAt}"`]);
    },
  );

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
