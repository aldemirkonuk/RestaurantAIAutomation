import { ReceivingService } from "./receiving.service";
import { DatabaseService } from "../database/database.service";

/**
 * The append-only receiving verdict ledger (ADR 0149 row 23; sketch
 * 107-receiving-structure). These are SERVICE-layer tests: they prove the
 * gateway shapes the right reads/writes (mapping a request to a query and a
 * database refusal to a sentence a manager can act on) against a mocked
 * Supabase client.
 *
 * WHAT THIS FILE DOES NOT PROVE, STATED PLAINLY (§0.5): the over-take guard,
 * the append-only trigger, the unit-comparability guard and the view's own
 * lockdown live in SQL
 * (`20260919170000_receiving_line_verdicts_are_append_only.sql`) and cannot
 * be exercised against a mock — a mock can only return what this file tells
 * it to. Those are proved on a REAL Postgres by
 * `p4-scratch/pglite-probe/pgrecv-verdict-ledger.mjs` (wired as
 * `pglite:pgrecv-verdict-ledger.mjs` in verify_index.sh), which applies the
 * migration's actual SQL and runs real inserts/updates/deletes — including
 * the Doluca fixture, the over-take guard (single row and two partial
 * takings), immutability, and the unit guard. This file used to carry a
 * "the derivation rule, transcribed" test that defined the arithmetic
 * INSIDE itself and asserted on that copy — no edit to the view's actual SQL
 * could ever have failed it (fixer review, 2026-09-18). Removed in favour of
 * the probe, which runs the real formula and was mutation-tested against it
 * (flipping the unit guard's condition to `false` turns two of its
 * assertions red).
 */

type Row = Record<string, any>;

function makeDb(opts: {
  order?: Row | null;
  verdictRows?: Row[];
  currentRows?: Row[];
  users?: Row[];
  insertError?: { code?: string; message: string } | null;
  countError?: { message: string } | null;
}) {
  const table: Row[] = [...(opts.verdictRows ?? [])];
  let nextId = 100;
  const inserts: Row[] = [];

  const client: any = {
    from(tableName: string) {
      const filters: Array<[string, any]> = [];
      let ltFilter: [string, string] | null = null;
      // `.or("recorded_at.lt.T,and(recorded_at.eq.T,id.lt.I)")` — the only
      // shape the ledger's pager sends; parsed, never trusted blindly.
      let orExpr: string | null = null;
      let limitN: number | null = null;
      const orderKeys: Array<{ col: string; asc: boolean }> = [];
      const q: any = {
        select: (_cols: string, sopts?: { count?: string; head?: boolean }) => {
          q._countMode = !!sopts?.count;
          return q;
        },
        eq: (col: string, val: any) => {
          filters.push([col, val]);
          return q;
        },
        lt: (col: string, val: any) => {
          ltFilter = [col, val];
          return q;
        },
        or: (expr: string) => {
          orExpr = expr;
          return q;
        },
        in: () => q,
        order: (col: string, o: { ascending: boolean }) => {
          orderKeys.push({ col, asc: o.ascending });
          return q;
        },
        limit: (n: number) => {
          limitN = n;
          return q;
        },
        maybeSingle: async () => {
          if (tableName === "procurement_orders")
            return { data: opts.order ?? null, error: null };
          if (tableName === "receiving_line_verdicts") {
            const hit = table.find((r) =>
              filters.every(([c, v]) => r[c] === v),
            );
            return { data: hit ?? null, error: null };
          }
          return { data: null, error: null };
        },
        insert(payload: Row) {
          inserts.push(payload);
          const chain: any = {
            select: () => chain,
            single: async () => {
              if (opts.insertError) return { data: null, error: opts.insertError };
              const row = { id: `verdict-${nextId++}`, recorded_at: new Date().toISOString(), ...payload };
              table.push(row);
              return { data: row, error: null };
            },
          };
          return chain;
        },
        then: (resolve: any) => {
          // Terminal await for list/count queries.
          if (tableName === "receiving_line_verdict_current") {
            return resolve({ data: opts.currentRows ?? [], error: null });
          }
          if (tableName === "users") {
            const ids = filters.find(([c]) => c === "user_id")?.[1];
            return resolve({
              data: (opts.users ?? []).filter((u) => !ids || u.user_id === ids),
              error: null,
            });
          }
          if (tableName === "receiving_line_verdicts") {
            if (q._countMode) {
              const matched = table.filter((r) =>
                filters.every(([c, v]) => r[c] === v),
              );
              if (opts.countError)
                return resolve({ count: null, error: opts.countError });
              return resolve({ count: matched.length, error: null });
            }
            let rows = table.filter((r) => filters.every(([c, v]) => r[c] === v));
            if (ltFilter) rows = rows.filter((r) => r[ltFilter![0]] < ltFilter![1]);
            if (orExpr) {
              const m = /^recorded_at\.lt\.([^,]+),and\(recorded_at\.eq\.\1,id\.lt\.([^)]+)\)$/.exec(orExpr);
              if (!m) throw new Error(`unrecognised or() filter: ${orExpr}`);
              const [, ts, id] = m;
              rows = rows.filter(
                (r) => r.recorded_at < ts || (r.recorded_at === ts && r.id < id),
              );
            }
            if (orderKeys.length) {
              rows = [...rows].sort((a, b) => {
                for (const { col, asc } of orderKeys) {
                  const d = a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0;
                  if (d !== 0) return asc ? d : -d;
                }
                return 0;
              });
            }
            if (limitN != null) rows = rows.slice(0, limitN);
            return resolve({ data: rows, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return q;
    },
  };

  return { client, inserts };
}

function service(db: ReturnType<typeof makeDb>["client"]): ReceivingService {
  const dbService = { getClient: () => db } as unknown as DatabaseService;
  return new ReceivingService(dbService);
}

const ORDER = { id: "order-1", quantity: 3, bottles_total: 18, unit_type: "case" };

describe("appendLineVerdict", () => {
  it("converts qty+uom to qty_bottles via the order's own pack size, and never re-derives it later", async () => {
    const { client, inserts } = makeDb({ order: ORDER, currentRows: [] });
    const svc = service(client);
    await svc.appendLineVerdict({
      restaurantId: "r1",
      orderId: "order-1",
      userId: "u1",
      verdict: "accepted",
      qty: 2,
      uom: "case",
      reason: "counted at the door",
    });
    expect(inserts).toHaveLength(1);
    // 3 cases = 18 bottles ⇒ pack size 6; 2 cases ⇒ 12 bottles.
    expect(inserts[0].qty_bottles).toBe(12);
    expect(inserts[0].qty).toBe(2);
    expect(inserts[0].uom).toBe("case");
  });

  it("refuses an unrecognised unit before any write — fail-closed, same rule as the door (ADR 0011)", async () => {
    const { client, inserts } = makeDb({ order: ORDER });
    const svc = service(client);
    await expect(
      svc.appendLineVerdict({
        restaurantId: "r1",
        orderId: "order-1",
        userId: "u1",
        verdict: "accepted",
        qty: 1,
        uom: "flagons",
        reason: "x",
      }),
    ).rejects.toThrow(/not a unit/);
    expect(inserts).toHaveLength(0);
  });

  it("refuses when the order does not belong to this restaurant", async () => {
    const { client } = makeDb({ order: null });
    const svc = service(client);
    await expect(
      svc.appendLineVerdict({
        restaurantId: "r1",
        orderId: "order-x",
        userId: "u1",
        verdict: "accepted",
        qty: 1,
        uom: "bottle",
        reason: "x",
      }),
    ).rejects.toThrow(/No order/);
  });

  it("turns a database refusal (the over-take trigger, in production) into a 409, not a 500", async () => {
    // The service's own pre-check reads `supersedes` before writing (a
    // friendlier error than a raw trigger message) — it must find this row,
    // and within its own bounds (6 <= its 6 bottles), so the write is
    // actually attempted and this test exercises the insertError path it
    // names, not the pre-check's NotFoundException for a row absent here.
    const { client } = makeDb({
      order: ORDER,
      verdictRows: [
        { id: "verdict-1", restaurant_id: "r1", order_id: "order-1", line_no: 1, uom: "case", qty_bottles: 6 },
      ],
      // P0001 is what Postgres actually reports for a plain `raise exception`
      // inside our trigger — measured against a real Postgres by
      // pgrecv-verdict-ledger.mjs. A mock error with no code at all (the
      // shape this test used before) is not what production sends, and
      // would map to a 500 under the fixer review's own tightened mapping.
      insertError: { code: "P0001", message: "over-take on row verdict-1: 6 already taken + 6 now = 12 bottles, more than its 6 bottles" },
    });
    const svc = service(client);
    await expect(
      svc.appendLineVerdict({
        restaurantId: "r1",
        orderId: "order-1",
        userId: "u1",
        verdict: "accepted",
        qty: 1,
        uom: "case",
        reason: "x",
        supersedes: "verdict-1",
        supersedesQtyBottles: 6,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("says a trigger over-take as a sentence — no row id, no raw arithmetic — and still says nothing was written", async () => {
    const { client } = makeDb({
      order: ORDER,
      verdictRows: [
        { id: "verdict-1", restaurant_id: "r1", order_id: "order-1", line_no: 1, uom: "case", qty_bottles: 6 },
      ],
      insertError: {
        code: "P0001",
        message:
          "over-take on row 3f0c1c5e-0000-4000-8000-000000000001: 4 already taken + 3 now = 7 bottles, more than its 6 bottles",
      },
    });
    const err: any = await service(client)
      .appendLineVerdict({
        restaurantId: "r1", orderId: "order-1", userId: "u1", verdict: "damaged", qty: 1, uom: "case",
        reason: "x", supersedes: "verdict-1", supersedesQtyBottles: 3,
      })
      .catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.message).toBe(
      "That entry has only 2 of its 6 bottles left — 4 are already taken by later entries — so it cannot give up 3 more. Nothing was appended.",
    );
    expect(err.message).not.toMatch(/3f0c1c5e|already taken \+|over-take on row/);
  });

  it("does not echo a trigger message it does not recognise — it can name another row's order", async () => {
    const { client } = makeDb({
      order: ORDER,
      verdictRows: [
        { id: "verdict-1", restaurant_id: "r1", order_id: "order-1", line_no: 1, uom: "case", qty_bottles: 6 },
      ],
      insertError: { code: "P0001", message: "some future rule about order 9d2f0000-0000-4000-8000-00000000abcd" },
    });
    const err: any = await service(client)
      .appendLineVerdict({
        restaurantId: "r1", orderId: "order-1", userId: "u1", verdict: "damaged", qty: 1, uom: "case",
        reason: "x", supersedes: "verdict-1",
      })
      .catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.message).toBe("The ledger refused this append. Nothing was appended.");
  });

  it("is idempotent: a retried append with the same key returns the first row rather than writing twice", async () => {
    const existing = {
      id: "verdict-9",
      restaurant_id: "r1",
      order_id: "order-1",
      line_no: 1,
      verdict: "accepted",
      qty: 1,
      uom: "case",
      qty_bottles: 6,
      beyond_order: false,
      reason: "first attempt",
      evidence: null,
      supersedes: null,
      supersedes_qty_bottles: null,
      recorded_by: "u1",
      recorded_at: new Date().toISOString(),
      client_captured_at: null,
      idempotency_key: "retry-key-1",
    };
    const { client, inserts } = makeDb({ order: ORDER, verdictRows: [existing] });
    const svc = service(client);
    const { entry } = await svc.appendLineVerdict({
      restaurantId: "r1",
      orderId: "order-1",
      userId: "u1",
      verdict: "accepted",
      qty: 1,
      uom: "case",
      reason: "first attempt",
      idempotencyKey: "retry-key-1",
    });
    expect(entry.id).toBe("verdict-9");
    expect(inserts).toHaveLength(0); // never re-inserted
  });

  it("resolves the recorder's name from public.users, and says so — not 'nobody' — when that read fails", async () => {
    const { client } = makeDb({
      order: ORDER,
      currentRows: [],
      users: [{ user_id: "u1", name: "Deniz K." }],
    });
    const svc = service(client);
    const { entry } = await svc.appendLineVerdict({
      restaurantId: "r1",
      orderId: "order-1",
      userId: "u1",
      verdict: "short",
      qty: 1,
      uom: "case",
      reason: "one case never arrived",
    });
    expect(entry.recordedByName).toBe("Deniz K.");
  });
});

describe("listLineVerdicts", () => {
  const V1 = {
    id: "v1", restaurant_id: "r1", order_id: "order-1", line_no: 1,
    verdict: "accepted", qty: 2, uom: "case", qty_bottles: 12, beyond_order: false,
    reason: "door count", evidence: null, supersedes: null, supersedes_qty_bottles: null,
    recorded_by: "u1", recorded_at: "2026-09-17T14:12:00Z", client_captured_at: null,
  };
  const V2 = {
    id: "v2", restaurant_id: "r1", order_id: "order-1", line_no: 1,
    verdict: "short", qty: 1, uom: "case", qty_bottles: 6, beyond_order: false,
    reason: "one case missing", evidence: null, supersedes: null, supersedes_qty_bottles: null,
    recorded_by: "u1", recorded_at: "2026-09-17T14:12:05Z", client_captured_at: null,
  };

  it("returns entries oldest-first even though the query orders newest-first internally", async () => {
    // Rows deliberately inserted out of chronological order to prove the
    // service reorders for display rather than trusting insertion order.
    const { client } = makeDb({ order: ORDER, verdictRows: [V2, V1], currentRows: [] });
    const svc = service(client);
    const ledger = await svc.listLineVerdicts("r1", "order-1");
    expect(ledger.entries.map((e) => e.id)).toEqual(["v1", "v2"]);
  });

  it("pages rather than growing without end — hasEarlier is true only when more rows exist behind the limit", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      ...V1,
      id: `v${i}`,
      recorded_at: new Date(2026, 8, 17, 14, i).toISOString(),
    }));
    const { client } = makeDb({ order: ORDER, verdictRows: rows, currentRows: [] });
    const svc = service(client);
    const ledger = await svc.listLineVerdicts("r1", "order-1", { limit: 10 });
    expect(ledger.entries).toHaveLength(10);
    expect(ledger.hasEarlier).toBe(true);
    expect(ledger.earliestCursor).not.toBeNull();
  });

  it("does not skip rows that share the boundary row's timestamp (cursor is (recorded_at, id), not recorded_at alone)", async () => {
    // Three appends in the same instant (a batch), one earlier. Page size 2:
    // page 1 is the two newest by (recorded_at, id) — c and b — and the cursor
    // sits ON b. With a timestamp-only cursor page 2 asks for
    // `recorded_at < T`, which drops `a` (same T) and shows only the earlier row.
    const T = "2026-09-17T14:12:05.000Z";
    const rows = [
      { ...V1, id: "00000000-0000-4000-8000-0000000000a1", recorded_at: T },
      { ...V1, id: "00000000-0000-4000-8000-0000000000b2", recorded_at: T },
      { ...V1, id: "00000000-0000-4000-8000-0000000000c3", recorded_at: T },
      { ...V1, id: "00000000-0000-4000-8000-0000000000e0", recorded_at: "2026-09-17T14:00:00.000Z" },
    ];
    const { client } = makeDb({ order: ORDER, verdictRows: rows, currentRows: [] });
    const svc = service(client);

    const page1 = await svc.listLineVerdicts("r1", "order-1", { limit: 2 });
    expect(page1.entries.map((e) => e.id)).toEqual(["00000000-0000-4000-8000-0000000000b2", "00000000-0000-4000-8000-0000000000c3"]);
    expect(page1.hasEarlier).toBe(true);
    expect(page1.earliestCursor).toBe(`${T}|00000000-0000-4000-8000-0000000000b2`);

    const page2 = await svc.listLineVerdicts("r1", "order-1", { limit: 2, before: page1.earliestCursor });
    expect(page2.entries.map((e) => e.id)).toEqual(["00000000-0000-4000-8000-0000000000e0", "00000000-0000-4000-8000-0000000000a1"]);
    expect(page2.hasEarlier).toBe(false);
  });

  it("still honours a legacy timestamp-only cursor rather than refusing an in-flight client", async () => {
    const rows = [
      { ...V1, id: "older", recorded_at: "2026-09-17T14:00:00.000Z" },
      { ...V1, id: "newer", recorded_at: "2026-09-17T14:10:00.000Z" },
    ];
    const { client } = makeDb({ order: ORDER, verdictRows: rows, currentRows: [] });
    const ledger = await service(client).listLineVerdicts("r1", "order-1", {
      before: "2026-09-17T14:10:00.000Z",
    });
    expect(ledger.entries.map((e) => e.id)).toEqual(["older"]);
  });

  it.each([
    "2026-09-17T14:10:00.000Z,id.gt.0",
    "2026-09-17T14:10:00.000Z|not-a-uuid",
    "x)),restaurant_id.neq.r1,and(a.eq.b",
    "",
  ])("refuses a malformed cursor %j before it can reach a query string", async (bad) => {
    const { client } = makeDb({ order: ORDER, verdictRows: [], currentRows: [] });
    await expect(
      service(client).listLineVerdicts("r1", "order-1", { before: bad || "  " }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("states the order's pack size once, so the client never re-multiplies 5 cases into 60 bottles itself", async () => {
    const { client } = makeDb({ order: ORDER, verdictRows: [], currentRows: [] });
    const svc = service(client);
    const ledger = await svc.listLineVerdicts("r1", "order-1");
    expect(ledger.packSize).toBe(6); // 18 bottles / 3 cases
    expect(ledger.orderedUnitType).toBe("case");
  });

  it("throws NotFoundException for an order outside this restaurant, never an empty ledger", async () => {
    const { client } = makeDb({ order: null });
    const svc = service(client);
    await expect(svc.listLineVerdicts("r1", "order-x")).rejects.toThrow(/No order/);
  });

  // Regression (confirmer review, 2026-09-18): notCountedBottles used to sum
  // beyond-order buckets into the same total as within-order ones. 18
  // ordered, 12 accepted WITHIN order + 6 refused BEYOND order (extra stock
  // the order never asked for) summed to 18 and printed "not counted 0",
  // hiding that 6 of the original 18 were still unaccounted for.
  it("keeps within-order and beyond-order bottle counts apart", async () => {
    const currentRows = [
      { verdict: "accepted", beyond_order: false, unit: "bottle", current_qty: 12, entry_count: 1, last_recorded_at: "2026-09-17T14:12:00Z" },
      { verdict: "refused", beyond_order: true, unit: "bottle", current_qty: 6, entry_count: 1, last_recorded_at: "2026-09-17T14:13:00Z" },
    ];
    const { client } = makeDb({ order: ORDER, verdictRows: [], currentRows });
    const svc = service(client);
    const ledger = await svc.listLineVerdicts("r1", "order-1");
    // 18 ordered − 12 counted WITHIN order = 6 still not counted; the 6
    // beyond-order refused bottles must not pay that remainder down.
    expect(ledger.notCountedBottles).toBe(6);
  });
});

// The Doluca-fixture derivation (accepted 16, damaged 2, short dropped out)
// and the over-take/immutability/unit-comparability guards behind it are
// proved on real Postgres by p4-scratch/pglite-probe/pgrecv-verdict-ledger.mjs
// — see the file header for why a mock-based test cannot cover this.
