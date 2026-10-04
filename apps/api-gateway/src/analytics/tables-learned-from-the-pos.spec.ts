import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { PosHubService } from "../pos-hub/pos-hub.service";
import { EXPORT_CUTTINGS } from "../reports/exports/report-export-cuttings";
import { AnalyticsController } from "./analytics.controller";
import { TableAnalyticsService } from "./table-analytics.service";

/**
 * ADR 0303 — tables learned from the till (analytics walk 2026-10-03, AW25 /
 * A-051 and AW30 / A-055; founder ruling 2026-10-04 "Learn from the POS").
 *
 * Before: the till's table word was used once, in memory, and thrown away;
 * a check whose word matched no hand-added table was dropped from the room
 * register without a count (`if (!c.table_id) continue`); the room register
 * told the owner to draw a room no screen can draw; an unrecorded distance
 * or seat count entered the geometry model as a measured 0; and no route
 * could rename or hide a table.
 *
 * After: the database reads the word out of `raw` into pos_checks.table_ref
 * and learns the table from it (supabase/tests/20261220110000_tables_learned_
 * from_the_pos_test.sql), so pos-hub writes no new column; checks without a
 * table and checks at hidden tables are counted; hidden tables leave the room,
 * its export and the hot list (the insight generator's part is owed, ADR 0303
 * residual 1); an unrecorded value is absent; and
 * PATCH /analytics/tables/:rid/:tableId renames or hides, owner or manager
 * only.
 */

type Row = Record<string, any>;
type Result = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

const ok = (data: unknown): Result => ({ data, error: null });

/**
 * Chainable Supabase stub. Each `.from(table)` read takes the next queued
 * result for that table (an exhausted queue reads as an empty page, so a
 * paged reader that asks again gets an end). Every builder call is recorded.
 * Tolerates the filters other lanes add (order/gt/limit/range/count).
 */
function makeDb(queue: Record<string, Result[]>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = jest.fn((table: string) => {
    const next = queue[table]?.shift() ?? ok([]);
    const builder: Record<string, unknown> = {};
    for (const method of [
      "select",
      "eq",
      "gte",
      "gt",
      "lt",
      "lte",
      "in",
      "is",
      "order",
      "limit",
      "range",
      "update",
    ])
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    builder.maybeSingle = () => {
      calls.push({ table, method: "maybeSingle", args: [] });
      return Promise.resolve(next);
    };
    builder.single = builder.maybeSingle;
    builder.then = (
      resolve: (r: Result) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(next).then(resolve, reject);
    return builder;
  });
  const db = { getClient: () => ({ from }) } as unknown as DatabaseService;
  return { service: new TableAnalyticsService(db), from, calls };
}

const table = (over: Row = {}): Row => ({
  id: "t1",
  label: "T1",
  zone: null,
  seats: null,
  is_outdoor: null,
  distance_to_kitchen_m: null,
  distance_to_bar_m: null,
  distance_to_pool_m: null,
  pos_refs: { csv_import: "T1" },
  is_active: true,
  learned_at: "2026-10-04T00:31:00.000Z",
  hidden_at: null,
  ...over,
});

let n = 0;
const check = (over: Row = {}): Row => ({
  id: `c${++n}`,
  table_id: "t1",
  server_name: "Maya",
  server_external_id: null,
  opened_at: "2026-09-20T19:00:00+00:00",
  closed_at: "2026-09-20T20:30:00+00:00",
  covers: 2,
  total: 100,
  tip: 10,
  items: [],
  ...over,
});

/* ── pos-hub keeps the till's payload; the database reads the word ───── */

function makeHub(tables: Row[]) {
  const checkRows: Row[] = [];
  const client: any = {
    from(t: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        update: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: { id: "x" }, error: null }),
        upsert: async (row: Row) => {
          if (t === "pos_checks") checkRows.push(row);
          return { data: null, error: null };
        },
        insert: async () => ({ data: null, error: null }),
      };
      q.then = (res: any) =>
        res({ data: t === "restaurant_tables" ? tables : [], error: null });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  const hub = new PosHubService({
    getClient: () => client,
    supabase: client,
  } as any);
  return { hub, checkRows };
}

const generic = (externalCheckId: string, tableRef: unknown) => ({
  externalCheckId,
  tableRef,
  openedAt: "2026-10-04T18:00:00.000Z",
  closedAt: null,
  voided: false,
  items: [],
});

describe("pos-hub keeps the till's payload and writes no new column (ADR 0303)", () => {
  // The database reads the table word out of `raw` (pos_checks_find_or_learn_table),
  // so the gateway names no column the migration adds. Deploying the gateway
  // before or after the migration therefore stores every check either way.
  it("keeps the table word inside raw as the till sent it, and names no table_ref", async () => {
    const { hub, checkRows } = makeHub([
      { id: "tab-7", label: "7", pos_refs: {} },
    ]);
    await (hub as any).ingest("r-1", "csv_import", [
      generic("k1", "T7"),
      generic("k2", "table 7"),
      generic("k3", 14),
    ]);
    const byId = Object.fromEntries(
      checkRows.map((r) => [r.external_check_id, r]),
    );
    expect(Object.keys(byId).sort()).toEqual(["k1", "k2", "k3"]);
    expect(byId.k1.raw).toMatchObject({ tableRef: "T7" });
    expect(byId.k3.raw).toMatchObject({ tableRef: 14 });
    // The in-memory resolve still links what it can.
    expect(byId.k1.table_id).toBeNull();
    expect(byId.k2.table_id).toBe("tab-7");
    for (const row of checkRows) expect(row).not.toHaveProperty("table_ref");
  });
});

/* ── the room counts what it does not show ─────────────────────────────── */

describe("table performance counts checks it cannot place, and leaves hidden tables out (ADR 0303)", () => {
  const learned = ["t1", "t2", "t3", "t4", "t5", "t6"].map((id, i) =>
    table({
      id,
      label: `T${i + 1}`,
      // Four tables carry a kitchen distance and two do not.
      distance_to_kitchen_m: i < 4 ? 5 * (i + 1) : null,
      learned_at: i === 5 ? null : "2026-10-04T00:31:00.000Z",
    }),
  );
  const hidden = table({
    id: "th",
    label: "Staff",
    hidden_at: "2026-10-04T09:00:00.000Z",
  });
  const perTable = learned.flatMap((t, i) =>
    [0, 1, 2].map(() => check({ table_id: t.id, total: 80 + 20 * i })),
  );
  const windowChecks = [
    ...perTable,
    check({ table_id: null }),
    check({ table_id: null }),
    check({ table_id: "th" }),
    check({ table_id: "th" }),
    check({ table_id: "th" }),
    // A retired table (is_active false) is not listed at all.
    check({ table_id: "t-retired" }),
  ];

  async function perf() {
    const { service } = makeDb({
      restaurant_tables: [ok([...learned, hidden])],
      pos_checks: [ok(windowChecks)],
    });
    return (await service.getTablePerformance("r-1", 90)) as any;
  }

  it("counts checks without a table and checks at hidden tables instead of dropping them", async () => {
    const r = await perf();
    expect(r.checksWithoutTable).toBe(2);
    expect(r.checksAtHiddenTables).toBe(4);
    expect(r.hiddenTables).toBe(2);
    expect(r.checksInWindow).toBe(windowChecks.length);
  });

  it("shows only tables nobody hid, and says how many were learned", async () => {
    const r = await perf();
    expect(r.tables.map((t: any) => t.tableId).sort()).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
    ]);
    expect(r.learnedTables).toBe(5);
    expect(r.geometryRecorded).toBe(4);
  });

  it("withholds every per-seat figure when the seats are not recorded", async () => {
    const r = await perf();
    for (const t of r.tables) {
      expect(t.seats).toBeNull();
      expect(t.revenuePerSeat).toBeNull();
      expect(t.seatUtilization).toBeNull();
      expect(t.checksPerSeat).toBeNull();
    }
  });

  it("reads an unrecorded distance as absent, never as a measured 0", async () => {
    const r = await perf();
    const kitchen = r.correlations.filter(
      (c: any) => c.attribute === "distance to kitchen",
    );
    expect(kitchen.length).toBeGreaterThan(0);
    for (const c of kitchen) expect(c.n).toBe(4);
    expect(r.correlations.some((c: any) => c.attribute === "seats")).toBe(
      false,
    );
  });

  it("fits no driver model over features nobody recorded", async () => {
    const r = await perf();
    // Only 4 tables carry a distance, seats and outdoor are unrecorded: no
    // feature reaches 5 recorded tables, so there is no model at all.
    expect(r.drivers).toBeNull();
  });

  it("keeps a feature recorded on enough tables, and only that one", async () => {
    const withSeats = learned.map((t, i) => ({ ...t, seats: 2 + (i % 3) * 2 }));
    const { service } = makeDb({
      restaurant_tables: [ok(withSeats)],
      pos_checks: [ok(perTable)],
    });
    const r = (await service.getTablePerformance("r-1", 90)) as any;
    expect(r.drivers).not.toBeNull();
    expect(r.drivers.weights.map((w: any) => w.attribute)).toEqual(["seats"]);
  });
});

describe("the live watchlist leaves hidden tables out (ADR 0303)", () => {
  it("counts an open check at a hidden table instead of watching it", async () => {
    const opened = new Date(Date.now() - 30 * 60000).toISOString();
    const { service } = makeDb({
      pos_checks: [
        ok([
          check({
            table_id: "t1",
            closed_at: null,
            opened_at: opened,
            total: 40,
          }),
          check({
            table_id: "th",
            closed_at: null,
            opened_at: opened,
            total: 90,
          }),
        ]),
      ],
      restaurant_tables: [
        ok([table(), table({ id: "th", label: "Staff", hidden_at: opened })]),
      ],
    });
    const r = (await service.getHotTables("r-1")) as any;
    expect(r.openChecks).toBe(1);
    expect(r.all.map((h: any) => h.table)).toEqual(["T1"]);
    expect(r.openChecksAtHiddenTables).toBe(1);
  });
});

/* ── rename or hide ────────────────────────────────────────────────────── */

describe("renameOrHideTable (ADR 0303)", () => {
  const RID = "11111111-1111-4111-8111-111111111111";
  const T7 = "77777777-7777-4777-8777-777777777777";
  const T9 = "99999999-9999-4999-8999-999999999999";
  const OLD = "00000000-0000-4000-8000-000000000000";
  const house = () => [
    { id: T7, label: "T7", hidden_at: null, is_active: true },
    {
      id: T9,
      label: "Window",
      hidden_at: "2026-10-04T09:00:00.000Z",
      is_active: true,
    },
    { id: OLD, label: "Old bar", hidden_at: null, is_active: false },
  ];
  const run = (
    tableId: string,
    body: unknown,
    write: Result = ok({ id: tableId }),
  ) => {
    const m = makeDb({ restaurant_tables: [ok(house()), write] });
    return { ...m, result: m.service.renameOrHideTable(RID, tableId, body) };
  };
  const patchOf = (calls: Array<{ method: string; args: unknown[] }>) =>
    calls.find((c) => c.method === "update")?.args[0] as Row | undefined;

  it.each<[unknown, string]>([
    [{}, "an empty body"],
    [{ label: "" }, "a blank name"],
    [{ label: "   " }, "a name of spaces"],
    [{ label: "x".repeat(61) }, "a name over 60 characters"],
    [{ label: 7 }, "a name that is not text"],
    [{ hidden: "yes" }, "hidden that is not a boolean"],
    [null, "no body"],
  ])("refuses %j (%s) with 400 and writes nothing", async (body) => {
    const { result, calls } = run(T7, body);
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    expect(patchOf(calls)).toBeUndefined();
  });

  it("answers 404 for an id that is not one of the house's tables, and for a retired one", async () => {
    for (const id of [
      "not-a-uuid",
      "22222222-2222-4222-8222-222222222222",
      OLD,
    ]) {
      const { result, calls } = run(id, { label: "Patio" });
      await expect(result).rejects.toBeInstanceOf(NotFoundException);
      expect(patchOf(calls)).toBeUndefined();
    }
  });

  it("answers 409 when another table of the house answers to the name in any case", async () => {
    const { result, calls } = run(T9, { label: " t7 " });
    await expect(result).rejects.toThrow(/already called "T7"/);
    expect(patchOf(calls)).toBeUndefined();
    const retired = run(T7, { label: "OLD BAR" });
    await expect(retired.result).rejects.toBeInstanceOf(ConflictException);
  });

  it("answers 409 when the database refuses a duplicate name (23505)", async () => {
    const { result } = run(
      T7,
      { label: "Patio" },
      {
        data: null,
        error: {
          code: "23505",
          message: "duplicate key value violates unique constraint",
        },
      },
    );
    await expect(result).rejects.toBeInstanceOf(ConflictException);
  });

  it("renames, trimmed, scoped to the house and the table", async () => {
    const { result, calls } = run(T7, { label: "  Window 7 " });
    await expect(result).resolves.toEqual({ id: T7 });
    expect(patchOf(calls)).toMatchObject({ label: "Window 7" });
    const scope = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(scope).toEqual(
      expect.arrayContaining([
        ["restaurant_id", RID],
        ["id", T7],
      ]),
    );
  });

  it("hides a shown table and shows a hidden one", async () => {
    const hide = run(T7, { hidden: true });
    await hide.result;
    expect(typeof patchOf(hide.calls)?.hidden_at).toBe("string");
    const show = run(T9, { hidden: false });
    await show.result;
    expect(patchOf(show.calls)).toHaveProperty("hidden_at", null);
    // Hiding a table already hidden keeps its first date.
    const again = run(T9, { hidden: true });
    await again.result;
    expect(patchOf(again.calls)).not.toHaveProperty("hidden_at");
  });
});

describe("the route is the owner's or a manager's (founder fork F1)", () => {
  it("guards PATCH tables/:restaurantId/:tableId with RolesGuard and ['owner', 'manager']", () => {
    const handler = AnalyticsController.prototype.renameOrHideTable;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      "owner",
      "manager",
    ]);
    expect(Reflect.getMetadata("__guards__", handler)).toContain(RolesGuard);
    expect(Reflect.getMetadata("path", handler)).toBe(
      "tables/:restaurantId/:tableId",
    );
  });
});

/* ── the export says what the page says ────────────────────────────────── */

describe("the room export (ADR 0303)", () => {
  const seats = (extra: Row) =>
    EXPORT_CUTTINGS.seats.write(
      { sinceDays: 90, dataStatus: "live", tables: [], ...extra },
      { days: null },
    );

  it("never asks for a drawing, and says the till has not named a table", () => {
    const d = seats({ checksWithoutTable: 0, checksAtHiddenTables: 0 });
    expect(d.say).not.toMatch(/drawn/);
    expect(d.say).toBe(
      "The till has not named a table yet, so no check can be attributed to a seat. Tables appear here as checks arrive with one on them; rename or hide them under Settings → Point of sale.",
    );
  });

  it("counts the checks that came without a table", () => {
    expect(seats({ checksWithoutTable: 12 }).say).toBe(
      "12 checks in this window came from the till without a table, so none can be attributed to a seat. They are in takings.",
    );
  });

  it("notes both counts beside the tables it shows", () => {
    const d = seats({
      checksWithoutTable: 3,
      checksAtHiddenTables: 5,
      hiddenTables: 2,
      checksInWindow: 20,
      tables: [
        {
          tableId: "t1",
          label: "T1",
          zone: null,
          seats: null,
          checks: 12,
          revenue: 900,
          covers: 20,
          avgCheck: 75,
          wineAttachRate: 0.5,
        },
      ],
    });
    expect(d.notes).toEqual([
      "3 checks came from the till without a table: counted in takings, not in the room.",
      "5 checks were at 2 hidden tables: counted in takings, not shown here.",
    ]);
    expect(d.basis.join(" ")).toContain("attributed to a shown table");
  });
});
