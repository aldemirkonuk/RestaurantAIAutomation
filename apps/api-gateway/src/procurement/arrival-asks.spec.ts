/**
 * "Did it arrive?" and the Incomplete orders register (ADR 0207, round 3).
 *
 * The real controller, service and OrganizationsService run over an in-memory
 * PostgREST double that honours its filters, seeded with a second house whose
 * rows are cross-linked to the first house's orders.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ArrivalAsksController } from "./arrival-asks.controller";
import { ArrivalAsksService } from "./arrival-asks.service";
import { mayAnswerArrival } from "./arrival-asks";
import { OrganizationsService } from "../organizations/organizations.service";

type Row = Record<string, any>;

/**
 * A PostgREST double that HONOURS the filters it is handed (a stub that
 * returned fixed rows would pass with every house clause deleted) and records
 * every write. Per-table failures stand in for a register that refuses.
 */
class FakeQuery {
  private filters: ((r: Row) => boolean)[] = [];
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private limitN: number | null = null;
  private single = false;
  private orderKey: string | null = null;
  private desc = false;
  private write: {
    kind: "insert" | "upsert" | "update";
    row: Row;
    keys?: string[];
  } | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select() {
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  not(col: string, op: string, v: unknown) {
    if (op !== "is" || v !== null) throw new Error(`fake: not(${col}, ${op})`);
    this.filters.push((r) => (r[col] ?? null) !== null);
    return this;
  }
  ilike(col: string, v: string) {
    this.filters.push(
      (r) => String(r[col] ?? "").toLowerCase() === v.toLowerCase(),
    );
    return this;
  }
  gte(col: string, v: string) {
    this.filters.push((r) => r[col] != null && String(r[col]) >= v);
    return this;
  }
  lte(col: string, v: string) {
    this.filters.push((r) => r[col] != null && String(r[col]) <= v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    if (this.orderKey === null) {
      this.orderKey = col;
      this.desc = opts?.ascending === false;
    }
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  insert(row: Row) {
    this.write = { kind: "insert", row };
    return this;
  }
  upsert(row: Row, opts?: { onConflict?: string }) {
    this.write = { kind: "upsert", row, keys: opts?.onConflict?.split(",") };
    return this;
  }
  update(row: Row) {
    this.write = { kind: "update", row };
    return this;
  }
  then(
    resolve: (v: { data: any; error: any }) => unknown,
    reject?: (e: unknown) => unknown,
  ) {
    try {
      return Promise.resolve(resolve(this.run())).catch(reject);
    } catch (e) {
      return Promise.reject(e).catch(reject);
    }
  }
  private run(): { data: any; error: any } {
    const fail = this.db.failures[this.table];
    if (fail) return { data: null, error: { code: "57014", message: fail } };
    if (this.write) {
      this.db.writes.push({ table: this.table, ...this.write });
      const t = (this.db.tables[this.table] ??= []);
      const w = this.write;
      if (w.kind === "update") {
        for (const r of t)
          if (this.filters.every((f) => f(r))) Object.assign(r, w.row);
      } else if (w.kind === "upsert" && w.keys) {
        const hit = t.find((r) => w.keys!.every((k) => r[k] === w.row[k]));
        if (hit) Object.assign(hit, w.row);
        else t.push({ ...w.row });
      } else t.push({ ...w.row });
      return { data: null, error: null };
    }
    let rows = (this.db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
    if (this.orderKey) {
      const k = this.orderKey;
      rows = [...rows].sort((a, b) => String(a[k]).localeCompare(String(b[k])));
      if (this.desc) rows.reverse();
    }
    if (this.rangeTo !== null)
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  failures: Record<string, string> = {};
  writes: { table: string; kind: string; row: Row }[] = [];
  from(table: string) {
    return new FakeQuery(this, table);
  }
  get supabase() {
    return this;
  }
  get client() {
    return this;
  }
  getClient() {
    return this;
  }
}

const A = "house-A";
const B = "house-B";
const NOW = new Date("2026-09-21T12:00:00Z");

function seed(db: FakeDb) {
  db.tables.restaurants = [
    { id: B, timezone: "Pacific/Kiritimati", country: "KI" },
    { id: A, timezone: "Europe/Istanbul", country: "TR" },
  ];
  db.tables.user_restaurant_access = [
    { user_id: "owner-a", restaurant_id: A, role: "owner", is_active: true },
    { user_id: "staff-a", restaurant_id: A, role: "staff", is_active: true },
    { user_id: "owner-b", restaurant_id: B, role: "owner", is_active: true },
  ];
  db.tables.users = [];
  db.tables.providers = [
    { id: "pa", restaurant_id: A, name: "Kestrel Wine Co." },
    { id: "pb", restaurant_id: B, name: "Foreign" },
  ];
  const order = (
    id: string,
    house: string,
    expected: string,
    status = "CONFIRMED",
  ) => ({
    id,
    order_number: id.toUpperCase(),
    restaurant_id: house,
    provider_id: house === A ? "pa" : "pb",
    status,
    expected_delivery_date: expected,
  });
  db.tables.procurement_orders = [
    order("late-silent", A, "2026-09-18"), // 3 days past: asked
    order("late-said", A, "2026-09-15", "IN_TRANSIT"), // answered Not yet
    order("not-due", A, "2026-09-22"),
    order("old", A, "2026-08-10"), // 42 days past on the Istanbul clock: incomplete
    order("credited", A, "2026-09-16"), // closed with a credit
    order("received", A, "2026-09-10", "DELIVERED"),
    order("b-late", B, "2026-09-18"),
  ];
  db.tables.procurement_order_arrival_answers = [
    {
      restaurant_id: A,
      order_id: "late-said",
      answer: "not_yet",
      expected_date: "2026-09-15",
      answered_at: "2026-09-17T09:00:00Z",
      answered_by: "owner-a",
    },
    // House B's answer on house A's silent order must not confirm it.
    {
      restaurant_id: B,
      order_id: "late-silent",
      answer: "not_yet",
      expected_date: "2026-09-18",
      answered_at: "2026-09-20T09:00:00Z",
      answered_by: "owner-b",
    },
  ];
  db.tables.procurement_credits = [
    { restaurant_id: A, order_id: "credited", state: "credited" },
    // House B's credited claim on house A's order must not close it.
    { restaurant_id: B, order_id: "late-silent", state: "credited" },
  ];
}

function make() {
  const db = new FakeDb();
  seed(db);
  const svc = new ArrivalAsksService(
    { getClient: () => db } as never,
    new OrganizationsService({ supabase: db } as never),
  );
  svc.clock = () => NOW;
  return { db, controller: new ArrivalAsksController(svc) };
}
const owner = { userId: "owner-a", restaurantId: A };
const staff = { userId: "staff-a", restaurantId: A };

describe("who is asked", () => {
  it("owners and managers always; anyone else only in the receiving area", () => {
    expect(mayAnswerArrival("owner", "u", null)).toBe(true);
    expect(mayAnswerArrival("manager", "u", null)).toBe(true);
    expect(mayAnswerArrival("staff", "u", null)).toBe(false);
    expect(mayAnswerArrival("staff", "u", ["u"])).toBe(true);
    expect(mayAnswerArrival("staff", "u", ["v"])).toBe(false);
    expect(mayAnswerArrival(null, "u", ["u"])).toBe(true);
    expect(mayAnswerArrival(null, "", [""])).toBe(false);
  });
});

describe("GET /procurement/arrival-asks", () => {
  it("asks house A's owner about house A's orders past their date — the silent one first, the answered one waiting", async () => {
    const { controller } = make();
    const r = await controller.list(owner);
    expect(r.forYou).toBe(true);
    expect(r.asks.map((a) => [a.orderId, a.standing, a.daysPast])).toEqual([
      ["late-silent", "unconfirmed", 3],
      ["late-said", "confirmed_late", 6],
    ]);
    expect(r.asks[0].providerName).toBe("Kestrel Wine Co.");
    expect(r.asks[0].choices.map((c) => c.key)).toEqual([
      "receive",
      "not_yet",
      "cancel",
    ]);
    expect(r.asks[0].choices[0]).toMatchObject({
      route: "/receiving/late-silent/door",
    });
    // ADR 0207 round 4 — the typed cancel carries the category the gateway
    // requires, so a reader following it is not refused with a 400.
    expect(r.asks[0].choices[2]).toMatchObject({
      key: "cancel",
      method: "DELETE",
      reasonCode: "never_arrived",
    });
    // A "Not yet" already given is not asked again.
    expect(r.asks[1].choices.map((c) => c.key)).toEqual(["receive", "cancel"]);
  });

  it("asks staff nothing, and says why — a rule, not a failure", async () => {
    const { controller } = make();
    const r = await controller.list(staff);
    expect(r).toMatchObject({ forYou: false, asks: [] });
    expect(r.sentence).toContain("owners and managers");
  });

  it("refuses with the reason when the answers cannot be read — never 'nothing is overdue'", async () => {
    const { controller, db } = make();
    db.failures.procurement_order_arrival_answers = "statement timeout";
    await expect(controller.list(owner)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe("POST /procurement/orders/:id/arrival-answers", () => {
  it("records Not yet for the order's expected date, by the token's person, and the order is then confirmed late", async () => {
    const { controller, db } = make();
    const ask = await controller.notYet(owner, "late-silent", {
      answer: "not_yet",
    });
    expect(ask).toMatchObject({
      orderId: "late-silent",
      standing: "confirmed_late",
    });
    const w = db.writes.filter(
      (x) => x.table === "procurement_order_arrival_answers",
    );
    expect(w).toHaveLength(1);
    expect(w[0].row).toMatchObject({
      restaurant_id: A,
      order_id: "late-silent",
      answer: "not_yet",
      expected_date: "2026-09-18",
      answered_by: "owner-a",
    });
    const after = await controller.list(owner);
    expect(after.asks.find((a) => a.orderId === "late-silent")?.standing).toBe(
      "confirmed_late",
    );
  });

  it("refuses staff (403), another house's order (404), an order not due (409) and an incomplete one (409)", async () => {
    const { controller, db } = make();
    await expect(
      controller.notYet(staff, "late-silent", { answer: "not_yet" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.notYet(owner, "b-late", { answer: "not_yet" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.notYet(owner, "not-due", { answer: "not_yet" }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      controller.notYet(owner, "old", { answer: "not_yet" }),
    ).rejects.toBeInstanceOf(ConflictException);
    // An incomplete order is told WHERE it is, not only that it is not due.
    await expect(
      controller.notYet(owner, "old", { answer: "not_yet" }),
    ).rejects.toThrow(/in Incomplete orders under Documents & Reports/);
    await expect(
      controller.notYet(owner, "late-silent", { answer: "yes" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.writes).toHaveLength(0);
  });
});

describe("GET /procurement/incomplete-orders", () => {
  it("lists house A's order 30 days past its date with receive and cancel, and nothing closed with a credit", async () => {
    const { controller } = make();
    const r = await controller.incomplete(owner);
    expect(r.forYou).toBe(true);
    expect(r.afterDays).toBe(30);
    expect(r.orders.map((o) => [o.orderId, o.daysPast, o.confirmed])).toEqual([
      ["old", 42, false],
    ]);
    expect(r.orders[0].choices.map((c) => c.key)).toEqual([
      "receive",
      "cancel",
    ]);
  });
});
