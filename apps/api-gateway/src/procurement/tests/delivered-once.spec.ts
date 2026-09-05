/**
 * An order is delivered once — `markDelivered` refuses a second delivery for
 * every caller, and the second of two concurrent deliveries loses at the
 * database rather than at the read.
 *
 * ===========================================================================
 * WHY A REAL-STATE FAKE AND NOT A CHAINABLE STUB
 * ===========================================================================
 * The claim under test is about a conditional UPDATE: `status=not.in.(…)` in
 * the WHERE clause, so the loser of a race matches no row. A `mockReturnThis()`
 * builder cannot lose a race — it answers the same canned row to everybody — so
 * it can prove the guard was WRITTEN and never that it WORKS. The fake below
 * holds real rows and applies filter-then-mutate in one uninterrupted
 * synchronous pass after an await, which is the property a conditional UPDATE
 * has in Postgres under READ COMMITTED. Same shape as
 * `approve-draft-concurrency.spec.ts`, for the same reason.
 *
 * ===========================================================================
 * PRE-FIX CONTROL
 * ===========================================================================
 * Every assertion in the "refuses" and "race" blocks is run against
 * `git show HEAD:apps/api-gateway/src/procurement/procurement.service.ts`
 * before being run against the tree. The command and the counts are in the
 * report; the numbers are not restated here, because a number typed into a
 * comment is not a measurement.
 *
 * Run:
 *   cd apps/api-gateway && npx jest --testPathPattern delivered-once --runInBand
 */
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ProcurementService } from "../procurement.service";
import { DatabaseService } from "../../database/database.service";
import { EventsService } from "../../events/events.service";
import { InventoryLedgerService } from "../../inventory-ledger/inventory-ledger.service";
import { ProcurementOrderStatus } from "../dto/procurement.dto";
import {
  deliveredWhenInWords,
  orderInWords,
  refuseSecondDelivery,
} from "../delivered-once";

type Row = Record<string, any>;

const REST = "rest-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const INVENTORY = "11111111-1111-4111-8111-111111111111";

/** One event-loop macrotask, so concurrent callers interleave at every await. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Parse the PostgREST list form `("A","B")` that `toPostgrestInList` produces.
 * Written here rather than imported so the test does not agree with the code by
 * construction: if the producer changes shape, this stops matching and the
 * conditional silently filtering NOTHING would show up as a lost race that no
 * longer happens.
 */
function parsePostgrestList(raw: string): string[] {
  return raw
    .replace(/^\(/, "")
    .replace(/\)$/, "")
    .split(",")
    .map((s) => s.trim().replace(/^"/, "").replace(/"$/, ""))
    .filter(Boolean);
}

interface Calls {
  rpc: { name: string; args: Row }[];
  orderUpdates: Row[];
  notFilters: Array<{ column: string; op: string; value: string }>;
}

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private isUpdate = false;
  private isInsert = false;
  private payload: Row = {};

  constructor(
    private readonly store: Record<string, Row[]>,
    private readonly table: string,
    private readonly calls: Calls,
    private readonly readError: Record<string, any> | null,
  ) {}

  select() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  range() {
    return this;
  }
  update(payload: Row) {
    this.isUpdate = true;
    this.payload = payload;
    if (this.table === "procurement_orders") this.calls.orderUpdates.push(payload);
    return this;
  }
  insert(payload: Row) {
    this.isInsert = true;
    this.payload = payload;
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: any) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  gt(col: string, val: any) {
    this.filters.push((r) => r[col] != null && r[col] > val);
    return this;
  }
  is(col: string, val: any) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  in(col: string, vals: any[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  /** The one filter this file exists to exercise. */
  not(col: string, op: string, val: any) {
    this.calls.notFilters.push({ column: col, op, value: String(val) });
    if (op === "in") {
      const excluded = parsePostgrestList(String(val));
      this.filters.push((r) => !excluded.includes(r[col]));
    } else if (op === "is") {
      this.filters.push((r) => (r[col] ?? null) !== val);
    }
    return this;
  }

  private async run(): Promise<{ data: Row[]; error: any }> {
    await tick();
    if (this.readError && !this.isUpdate && !this.isInsert)
      return { data: [], error: this.readError };
    const rows = (this.store[this.table] ??= []);
    if (this.isInsert) {
      rows.push({ ...this.payload });
      return { data: [{ ...this.payload }], error: null };
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
    // Filter and mutate in one synchronous pass: no await between them, so a
    // concurrent caller cannot observe a half-applied update.
    if (this.isUpdate) matched.forEach((r) => Object.assign(r, this.payload));
    return { data: matched, error: null };
  }

  then(onOk: any, onErr?: any) {
    return this.run().then(onOk, onErr);
  }

  async single() {
    const { data, error } = await this.run();
    if (error) return { data: null, error };
    if (data.length !== 1)
      return {
        data: null,
        error: { code: "PGRST116", message: `${data.length} rows returned` },
      };
    return { data: data[0], error: null };
  }

  async maybeSingle() {
    const { data, error } = await this.run();
    if (error) return { data: null, error };
    return { data: data[0] ?? null, error: null };
  }
}

function makeDb(opts: {
  order: Row;
  /** Forced on every SELECT, to exercise "a failed read is not an absence". */
  readError?: Record<string, any> | null;
  /**
   * The people register. Absent = it holds no row for the receiver (a real
   * case: a user removed from the house). `"unreadable"` = the query itself
   * fails, which is a DIFFERENT fact and must not read as "no name".
   */
  users?: Row[] | "unreadable";
}) {
  const store: Record<string, Row[]> = {
    procurement_orders: [{ ...opts.order }],
    restaurant_inventory: [
      {
        id: INVENTORY,
        restaurant_id: REST,
        master_wine_id: "55555555-5555-4555-8555-555555555555",
        shadow_stock: 0,
        in_transit_quantity: 0,
      },
    ],
    inventory_events: [],
    calendar_events: [],
    users:
      opts.users === "unreadable"
        ? []
        : (opts.users ?? [{ user_id: USER_A, name: "Ada Lovelace" }]),
  };
  const calls: Calls = { rpc: [], orderUpdates: [], notFilters: [] };

  const supabase: any = {
    from: (table: string) =>
      new FakeQuery(
        store,
        table,
        calls,
        // A table-scoped failure, so "the order reads fine but the people
        // register does not" is expressible — which is the case the body's
        // `receivedByNameReason` exists for.
        table === "users" && opts.users === "unreadable"
          ? { code: "42501", message: "permission denied for table users" }
          : (opts.readError ?? null),
      ),
    rpc: async (name: string, args: Row) => {
      calls.rpc.push({ name, args });
      return { data: null, error: null };
    },
    storage: { from: () => ({}) },
  };

  const db = {
    supabase,
    getClient: () => supabase,
    client: supabase,
  } as unknown as DatabaseService;

  return { db, calls, store };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

const service = (db: DatabaseService) =>
  new ProcurementService(db, events, ledger);

const baseOrder = {
  id: ORDER,
  order_number: "ORD-2026-00042",
  restaurant_id: REST,
  inventory_id: INVENTORY,
  provider_id: "prov-1",
  quantity: 12,
  bottles_total: 12,
  unit_type: "bottle",
  final_price: 40,
  quantity_received: null,
  delivered_at: null,
  received_by: null,
  status: "APPROVED",
};

const liveMovements = (calls: Calls) =>
  calls.rpc.filter(
    (c) => c.name === "apply_stock_movement" && c.args.p_stock_state === "live",
  );

// ---------------------------------------------------------------------------
// The first delivery is unchanged
// ---------------------------------------------------------------------------
describe("markDelivered — the first delivery still happens", () => {
  it("marks the order delivered and books the stock", async () => {
    const { db, calls, store } = makeDb({ order: { ...baseOrder } });

    const out = await service(db).markDelivered(REST, ORDER, USER_A);

    expect(out.status).toBe(ProcurementOrderStatus.DELIVERED);
    expect(store.procurement_orders[0].status).toBe("DELIVERED");
    expect(store.procurement_orders[0].quantity_received).toBe(12);
    expect(store.procurement_orders[0].received_by).toBe(USER_A);
    expect(liveMovements(calls)).toHaveLength(1);
    expect(liveMovements(calls)[0].args.p_delta).toBe(12);
  });

  it("sends the goods-arrived exclusion as part of the UPDATE, not only as a read", async () => {
    // The read-then-write check alone is losable. This asserts the same rule
    // reaches the database as a WHERE clause.
    const { db, calls } = makeDb({ order: { ...baseOrder } });
    await service(db).markDelivered(REST, ORDER, USER_A);

    const statusExclusion = calls.notFilters.find(
      (f) => f.column === "status" && f.op === "in",
    );
    expect(statusExclusion).toBeDefined();
    const excluded = parsePostgrestList(statusExclusion!.value);
    expect(excluded.sort()).toEqual(
      ["COMPLETED", "DELIVERED", "PARTIALLY_RECEIVED"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// The second delivery is refused, in words, before any write
// ---------------------------------------------------------------------------
describe("markDelivered — an order is delivered once", () => {
  it("refuses a second delivery with a 409 and writes nothing", async () => {
    const { db, calls, store } = makeDb({ order: { ...baseOrder } });
    const svc = service(db);

    await svc.markDelivered(REST, ORDER, USER_A);
    const updatesAfterFirst = calls.orderUpdates.length;
    const movementsAfterFirst = liveMovements(calls).length;
    const deliveredAtAfterFirst = store.procurement_orders[0].delivered_at;

    await expect(svc.markDelivered(REST, ORDER, USER_B)).rejects.toBeInstanceOf(
      ConflictException,
    );

    // Nothing was attempted, not merely nothing landed: the refusal is before
    // the write, so no UPDATE payload and no RPC were produced at all.
    expect(calls.orderUpdates).toHaveLength(updatesAfterFirst);
    expect(liveMovements(calls)).toHaveLength(movementsAfterFirst);
    // And the record of the real delivery is intact.
    expect(store.procurement_orders[0].received_by).toBe(USER_A);
    expect(store.procurement_orders[0].delivered_at).toBe(deliveredAtAfterFirst);
  });

  it("names the order and when it was delivered", async () => {
    const deliveredAt = "2026-09-04T14:05:00.000Z";
    const { db } = makeDb({
      order: {
        ...baseOrder,
        status: "DELIVERED",
        delivered_at: deliveredAt,
        quantity_received: 12,
      },
    });

    let thrown: any;
    try {
      await service(db).markDelivered(REST, ORDER, USER_B);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect(thrown.getStatus()).toBe(409);
    const body = thrown.getResponse();
    expect(body.reason).toBe("order_already_delivered");
    expect(body.status).toBe(ProcurementOrderStatus.DELIVERED);
    expect(body.deliveredAt).toBe(deliveredAt);
    expect(body.message).toContain("ORD-2026-00042");
    expect(body.message).toContain("2026-09-04");
    expect(body.message).toContain("14:05 UTC");
    // The sentence a person reads is the exception's own message, because the
    // controller answers with `error.message`.
    expect(thrown.message).toBe(body.message);
  });

  // -------------------------------------------------------------------------
  // 409, and the earlier delivery in the body (founder, batch 46)
  // -------------------------------------------------------------------------
  it("answers 409 Conflict, never 400 — the request was well formed", async () => {
    // The founder's words, rejecting 400: the request is well-formed and it is
    // the ORDER'S STATE that conflicts with it. A 400 would tell a caller it
    // sent nonsense, and there is nothing a caller could send differently.
    const { db } = makeDb({
      order: { ...baseOrder, status: "DELIVERED", delivered_at: "2026-09-04T14:05:00.000Z" },
    });
    let thrown: any;
    try {
      await service(db).markDelivered(REST, ORDER, USER_B);
    } catch (e) {
      thrown = e;
    }
    expect(thrown.getStatus()).toBe(409);
    expect(thrown.getStatus()).not.toBe(400);
  });

  it("carries the earlier delivery so a caller can show it instead of an error", async () => {
    const { db } = makeDb({
      order: {
        ...baseOrder,
        status: "DELIVERED",
        delivered_at: "2026-09-04T14:05:00.000Z",
        received_by: USER_A,
        quantity_received: 5,
        unit_type: "case",
        bottles_total: 60,
      },
    });

    let thrown: any;
    try {
      await service(db).markDelivered(REST, ORDER, USER_B);
    } catch (e) {
      thrown = e;
    }

    const body = thrown.getResponse();
    expect(body.orderNumber).toBe("ORD-2026-00042");

    // The exact key set, asserted rather than sampled. Four surfaces read this
    // body (two web pages, the one-tap rail, the mobile outbox) and none of
    // them is type-checked against the gateway, so this list IS the contract.
    expect(Object.keys(body.earlierDelivery).sort()).toEqual(
      [
        "bottlesTotal",
        "deliveredAt",
        "quantityReceived",
        "quantityUnitWhy",
        "receivedBy",
        "receivedByName",
        "receivedByNameReason",
        "summary",
        "unitType",
      ].sort(),
    );

    // A CASE ORDER CANNOT STATE THE COUNT'S UNIT, AND SAYS SO.
    //
    // `quantity_received` has four writers: three write the order's own unit
    // and `recordDoorReceipt` writes BOTTLES, and nothing on the row records
    // which. For `case` the two differ by the pack size, so the unit is
    // REFUSED — `quantity-received-unit.ts`, imported rather than restated.
    // An earlier draft of this file printed "5 cases (60 bottles)" from the
    // order's `unit_type` alone; that is the silent multiplication ADR 0011
    // forbids, and this assertion is what stops it coming back.
    expect(body.earlierDelivery).toMatchObject({
      deliveredAt: "2026-09-04T14:05:00.000Z",
      receivedBy: USER_A,
      receivedByName: "Ada Lovelace",
      receivedByNameReason: null,
      quantityReceived: 5,
      unitType: null,
      bottlesTotal: 60,
    });
    expect(body.earlierDelivery.quantityUnitWhy).toMatch(
      /cannot be placed in a unit/i,
    );
    // The count is left OUT of the sentence rather than printed under a guess.
    expect(body.earlierDelivery.summary).toBe(
      "Delivered on 2026-09-04 at 14:05 UTC by Ada Lovelace.",
    );
    // Not "5 cases", and not a bare "5 booked in" either.
    expect(body.earlierDelivery.summary).not.toMatch(/case/i);
    expect(body.earlierDelivery.summary).not.toMatch(/booked in/i);
  });

  it("states the unit when the order's own unit cannot multiply", async () => {
    // A bottle order: the door's bottle count and the desk's order-unit count
    // are the same number, so the unit is stated and the sentence carries it.
    const { db } = makeDb({
      order: {
        ...baseOrder,
        status: "DELIVERED",
        delivered_at: "2026-09-04T14:05:00.000Z",
        received_by: USER_A,
        quantity_received: 12,
        unit_type: "bottle",
      },
    });
    let thrown: any;
    try {
      await service(db).markDelivered(REST, ORDER, USER_B);
    } catch (e) {
      thrown = e;
    }
    const earlier = thrown.getResponse().earlierDelivery;
    expect(earlier.unitType).toBe("bottle");
    expect(earlier.summary).toBe(
      "Delivered on 2026-09-04 at 14:05 UTC by Ada Lovelace, 12 bottles booked in.",
    );
  });

  it("says a name could not be looked up rather than reporting no name", async () => {
    // A failed read of `users` and an order nobody signed for both leave
    // `receivedByName` null. Reporting them the same way is
    // [[absence-reported-as-health]] on the one line a receiver reads, so the
    // reason travels with the null.
    const { db } = makeDb({
      order: {
        ...baseOrder,
        status: "DELIVERED",
        delivered_at: "2026-09-04T14:05:00.000Z",
        received_by: USER_A,
        quantity_received: 12,
      },
      users: "unreadable",
    });

    let thrown: any;
    try {
      await service(db).markDelivered(REST, ORDER, USER_B);
    } catch (e) {
      thrown = e;
    }
    const earlier = thrown.getResponse().earlierDelivery;
    expect(earlier.receivedBy).toBe(USER_A);
    expect(earlier.receivedByName).toBeNull();
    expect(earlier.receivedByNameReason).toMatch(/could not be read/i);
    expect(earlier.summary).toContain("could not look up");
    expect(earlier.summary).not.toContain("names nobody");
  });

  it("says the record names nobody when it genuinely does", async () => {
    const { db } = makeDb({
      order: {
        ...baseOrder,
        status: "DELIVERED",
        delivered_at: "2026-09-04T14:05:00.000Z",
        received_by: null,
        quantity_received: 12,
      },
    });
    let thrown: any;
    try {
      await service(db).markDelivered(REST, ORDER, USER_B);
    } catch (e) {
      thrown = e;
    }
    const earlier = thrown.getResponse().earlierDelivery;
    expect(earlier.receivedBy).toBeNull();
    expect(earlier.receivedByNameReason).toBeNull();
    expect(earlier.summary).toContain("names nobody");
  });

  it("refuses a partly-received order, naming the door as the way to finish", async () => {
    const { db, calls } = makeDb({
      order: {
        ...baseOrder,
        status: "PARTIALLY_RECEIVED",
        quantity_received: 3,
        delivered_at: "2026-09-04T14:05:00.000Z",
      },
    });

    let thrown: any;
    try {
      await service(db).markDelivered(REST, ORDER, USER_B);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect(thrown.message).toMatch(/receiving door/i);
    expect(thrown.message).toMatch(/3 recorded as received/);
    expect(calls.orderUpdates).toHaveLength(0);
    expect(liveMovements(calls)).toHaveLength(0);
  });

  it("refuses a completed order rather than reopening it", async () => {
    const { db, calls } = makeDb({
      order: {
        ...baseOrder,
        status: "COMPLETED",
        quantity_received: 12,
        delivered_at: "2026-09-04T14:05:00.000Z",
      },
    });

    await expect(
      service(db).markDelivered(REST, ORDER, USER_B),
    ).rejects.toThrow(/completed/i);
    expect(calls.orderUpdates).toHaveLength(0);
  });

  it("refuses a state it cannot read rather than treating it as permission", async () => {
    const { db, calls } = makeDb({
      order: { ...baseOrder, status: "ARRIVED_MAYBE" },
    });

    let thrown: any;
    try {
      await service(db).markDelivered(REST, ORDER, USER_A);
    } catch (e) {
      thrown = e;
    }
    expect(thrown.getStatus()).toBe(422);
    expect(thrown.getResponse().reason).toBe("order_state_unreadable");
    expect(calls.orderUpdates).toHaveLength(0);
    expect(liveMovements(calls)).toHaveLength(0);
  });

  it("still 404s an order that is not this restaurant's", async () => {
    const { db } = makeDb({ order: { ...baseOrder } });
    await expect(
      service(db).markDelivered("rest-2", ORDER, USER_A),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("reports a failed read as a failure, never as a deliverable order", async () => {
    // supabase-js resolves `{ data, error }`. A guard that looks only at `data`
    // sees an unreadable row as an absent one; here it must be a 500 with words.
    const { db, calls } = makeDb({
      order: { ...baseOrder },
      readError: { code: "57014", message: "canceling statement due to timeout" },
    });

    let thrown: any;
    try {
      await service(db).markDelivered(REST, ORDER, USER_A);
    } catch (e) {
      thrown = e;
    }
    expect(thrown.getStatus()).toBe(500);
    expect(thrown.message).toMatch(/could not be read/i);
    expect(thrown.message).toMatch(/nothing was changed/i);
    expect(calls.orderUpdates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The race
// ---------------------------------------------------------------------------
describe("markDelivered — two confirmations at once, one winner", () => {
  it("lets exactly one through and books the stock exactly once", async () => {
    const { db, calls, store } = makeDb({ order: { ...baseOrder } });
    const svc = service(db);

    // Both pre-reads complete before either UPDATE runs (every FakeQuery awaits
    // a macrotask first), so BOTH callers see a deliverable order. Only the
    // conditional UPDATE can separate them — which is the whole point.
    const settled = await Promise.allSettled([
      svc.markDelivered(REST, ORDER, USER_A),
      svc.markDelivered(REST, ORDER, USER_B),
    ]);

    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getStatus()).toBe(409);
    expect(err.message).toMatch(/someone else/i);

    // The loser gets the SAME body shape as an ordinary refusal — the WINNER's
    // delivery. A caller must not have to tell the two 409s apart to render.
    const racedBody = err.getResponse();
    expect(racedBody.reason).toBe("order_already_delivered");
    expect(racedBody.earlierDelivery.summary).toMatch(/^Delivered on /);
    expect(racedBody.earlierDelivery.quantityReceived).toBe(12);
    expect(racedBody.earlierDelivery.unitType).toBe("bottle");

    // One winner in the row, one live movement in the ledger.
    expect(store.procurement_orders[0].status).toBe("DELIVERED");
    expect(liveMovements(calls)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The words themselves
// ---------------------------------------------------------------------------
describe("delivered-once — the sentence", () => {
  it("says a missing timestamp is missing instead of inventing one", () => {
    expect(deliveredWhenInWords(null)).toBe("at a time this order never recorded");
    expect(deliveredWhenInWords("not-a-date")).toMatch(/is not a date/);
  });

  it("renders the time in UTC, not in the server's zone", () => {
    expect(deliveredWhenInWords("2026-09-04T14:05:00.000Z")).toBe(
      "on 2026-09-04 at 14:05 UTC",
    );
  });

  it("falls back to the id when an order has no number", () => {
    expect(orderInWords(null, ORDER)).toContain(ORDER);
    expect(orderInWords("  ", ORDER)).toContain(ORDER);
    expect(orderInWords("ORD-1", ORDER)).toBe("Order ORD-1");
  });

  it("gives each arrived state its own consequence and its own next step", () => {
    const common = {
      orderId: ORDER,
      orderNumber: "ORD-2026-00042",
      deliveredAt: "2026-09-04T14:05:00.000Z",
      quantityReceived: 12,
    };
    const delivered = refuseSecondDelivery({
      ...common,
      status: ProcurementOrderStatus.DELIVERED,
    });
    const partial = refuseSecondDelivery({
      ...common,
      status: ProcurementOrderStatus.PARTIALLY_RECEIVED,
    });
    const completed = refuseSecondDelivery({
      ...common,
      status: ProcurementOrderStatus.COMPLETED,
    });

    expect(new Set([delivered, partial, completed]).size).toBe(3);
    for (const s of [delivered, partial, completed]) {
      expect(s).toContain("ORD-2026-00042");
      expect(s).toMatch(/nothing was changed|Nothing was changed/);
    }
  });
});
