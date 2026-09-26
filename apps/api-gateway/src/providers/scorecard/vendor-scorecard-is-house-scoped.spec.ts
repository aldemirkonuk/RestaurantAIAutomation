/**
 * The vendor scorecard answers only for the caller's house — ADR 0207.
 *
 * The gateway reads with the service-role client, which bypasses RLS, so the
 * `.eq("restaurant_id", house)` on each query in vendor-scorecard.service.ts IS
 * the tenant boundary. This spec runs the real service and the real controller
 * against an in-memory store that HONOURS the filters it is given (a stub that
 * returned fixed rows would pass with every clause deleted), seeded with a
 * second house whose rows are CROSS-LINKED to the first house's vendor — a
 * house-B order, door event, invoice line, message and claim all stamped with
 * house A's provider id, and a house-B agreed line on a house-A order. That is
 * representable (no composite key ties `restaurant_id` to
 * `providers.restaurant_id`), and it is the only fixture in which a missing
 * house clause changes a number: without it, the vendor filter alone would
 * hide the leak and the guard would be a no-op.
 *
 * MUTATION RECORD (2026-09-21): each of the 15 house clauses in the service,
 * and the controller's `houseOf` refusal, was removed one at a time; every
 * removal turned at least one case below red. The run is recorded in ADR 0207.
 * The house's own record (its time zone and country) is read by the token's
 * house id; house B is seeded FIRST, in a zone (UTC+14) that turns every one
 * of house A's deliveries late, so a read that lost its id clause is visible.
 */

import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { VendorScorecardService } from "./vendor-scorecard.service";
import {
  VendorScorecardController,
  houseOf,
  parseMeasure,
  parseWindow,
} from "./vendor-scorecard.controller";
import type { MeasureResult, VendorScorecard } from "./vendor-scorecard";

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((r: Row) => boolean)[] = [];
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private limitN: number | null = null;
  private single = false;
  private orderKey: string | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {
    db.touched.push(table);
  }

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
    if (op !== "is" || v !== null)
      throw new Error(`fake: not(${col}, ${op}) unsupported`);
    this.filters.push((r) => (r[col] ?? null) !== null);
    return this;
  }
  gte(col: string, v: string) {
    this.filters.push(
      (r) =>
        r[col] != null && new Date(r[col]).getTime() >= new Date(v).getTime(),
    );
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  order(col: string) {
    this.orderKey = col;
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
    let rows = (this.db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
    if (this.orderKey) {
      const k = this.orderKey;
      rows = [...rows].sort((a, b) => String(a[k]).localeCompare(String(b[k])));
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
  touched: string[] = [];
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const A = "house-A";
const B = "house-B";
const PA = "prov-A-skurnik";
const PB = "prov-B-other";
const NOW = new Date("2026-09-17T12:00:00Z");

function day(n: number, hour = 10): string {
  return `2026-09-${String(n).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
}

/**
 * House A: one vendor with exactly five of everything, so every measure is
 * answered and a single leaked row changes a figure or an outcome.
 * House B: its own vendor, and a copy of every register stamped with house
 * A's vendor — the cross-links that make a missing clause visible.
 */
function seed(db: FakeDb) {
  // House B first: a read of `restaurants` that lost its id clause takes it.
  db.tables.restaurants = [
    { id: B, timezone: "Pacific/Kiritimati", country: "KI" },
    { id: A, timezone: "UTC", country: null },
  ];
  db.tables.providers = [
    { id: PA, name: "Skurnik", restaurant_id: A, deleted_at: null },
    { id: PB, name: "Foreign Vendor", restaurant_id: B, deleted_at: null },
  ];
  const orders: Row[] = [];
  const items: Row[] = [];
  const events: Row[] = [];
  const mail: Row[] = [];
  const credits: Row[] = [];
  for (let i = 1; i <= 5; i++) {
    // House A: on time, as ordered, at the agreed price, answered in 2 h, credited.
    orders.push({
      id: `a-ord-${i}`,
      order_number: `A-${i}`,
      restaurant_id: A,
      provider_id: PA,
      currency: "USD",
      status: "COMPLETED",
      expected_delivery_date: `2026-09-0${i}`,
      delivered_at: day(i),
      match_verified_at: day(i, 14),
      match_status: "matched",
      price_verified: true,
      invoice_unit_price: 20,
      final_price: 20,
      negotiated_price: null,
      quoted_price: null,
    });
    events.push({
      id: `a-ev-${i}`,
      restaurant_id: A,
      order_id: `a-ord-${i}`,
      stage: "case_count",
      outcome: "accepted",
      refusal_reason: null,
      rejected_qty: 0,
      damage_photo_path: null,
      occurred_at: day(i, 11),
    });
    mail.push({
      id: `a-out-${i}`,
      restaurant_id: A,
      provider_id: PA,
      direction: "outbound",
      status: "SENT",
      sent_at: day(i, 8),
      received_at: null,
      thread_key: `a-t${i}`,
      gmail_thread_id: null,
      thread_id: null,
      detected_sentiment: null,
    });
    mail.push({
      id: `a-in-${i}`,
      restaurant_id: A,
      provider_id: PA,
      direction: "inbound",
      status: "RECEIVED",
      sent_at: null,
      received_at: day(i, 10),
      thread_key: `a-t${i}`,
      gmail_thread_id: null,
      thread_id: null,
      detected_sentiment: null,
    });
    credits.push({
      id: `a-claim-${i}`,
      restaurant_id: A,
      provider_id: PA,
      order_id: `a-ord-${i}`,
      reason: "qty_short",
      // The column's DEFAULT, as the only writer leaves it: never read.
      currency: "USD",
      claimed_amount: 10,
      credited_amount: 10,
      state: "credited",
      opened_at: day(i),
      promised_at: null,
    });

    // House B, stamped with house A's vendor: late, short, above agreed, 30 h, rejected.
    orders.push({
      id: `b-ord-${i}`,
      order_number: `B-${i}`,
      restaurant_id: B,
      provider_id: PA,
      currency: "EUR",
      status: "COMPLETED",
      expected_delivery_date: `2026-09-0${i}`,
      delivered_at: day(i + 10),
      match_verified_at: day(i + 10, 14),
      match_status: "price_variance",
      price_verified: false,
      invoice_unit_price: 25,
      final_price: 20,
      negotiated_price: null,
      quoted_price: null,
    });
    events.push({
      id: `b-ev-${i}`,
      restaurant_id: B,
      order_id: `b-ord-${i}`,
      stage: "case_count",
      outcome: "short",
      refusal_reason: null,
      rejected_qty: 0,
      damage_photo_path: null,
      occurred_at: day(i + 10, 11),
    });
    mail.push({
      id: `b-out-${i}`,
      restaurant_id: B,
      provider_id: PA,
      direction: "outbound",
      status: "SENT",
      sent_at: day(i + 10, 1),
      received_at: null,
      thread_key: `b-t${i}`,
      gmail_thread_id: null,
      thread_id: null,
      detected_sentiment: null,
    });
    mail.push({
      id: `b-in-${i}`,
      restaurant_id: B,
      provider_id: PA,
      direction: "inbound",
      status: "RECEIVED",
      sent_at: null,
      received_at: `2026-09-${i + 11}T07:00:00Z`,
      thread_key: `b-t${i}`,
      gmail_thread_id: null,
      thread_id: null,
      detected_sentiment: "negative",
    });
    credits.push({
      id: `b-claim-${i}`,
      restaurant_id: B,
      provider_id: PA,
      order_id: `b-ord-${i}`,
      reason: "qty_short",
      currency: "USD",
      claimed_amount: 1000,
      credited_amount: null,
      state: "rejected",
      opened_at: day(i + 10),
      promised_at: null,
    });
  }
  // A house-B door event on a house-A order: without the event clause, A's
  // order gains a second, later verdict ("refused").
  events.push({
    id: "b-ev-on-a",
    restaurant_id: B,
    order_id: "a-ord-1",
    stage: "case_count",
    outcome: "refused",
    refusal_reason: "other",
    rejected_qty: 0,
    damage_photo_path: null,
    occurred_at: day(15, 11),
  });
  // A house-A door event on a house-B order stamped with A's vendor: without
  // the order-lookup clause, it is attributed to A's vendor.
  events.push({
    id: "a-ev-on-b",
    restaurant_id: A,
    order_id: "b-ord-1",
    stage: "case_count",
    outcome: "short",
    refusal_reason: null,
    rejected_qty: 0,
    damage_photo_path: null,
    occurred_at: day(12, 11),
  });
  // A house-B agreed line on a house-A order, priced per keg: without the
  // agreed-lines clause, A's line becomes "not compared".
  items.push({
    id: "b-item-on-a",
    restaurant_id: B,
    order_id: "a-ord-1",
    price_uom: "keg",
    price_pack_size: 1,
    final_unit_price: 400,
    currency: "USD",
  });

  // A house-A claim that names no vendor — as `openCreditClaim` writes every
  // claim — attributed through its own house's order.
  credits.push({
    id: "a-claim-via-order",
    restaurant_id: A,
    provider_id: null,
    order_id: "a-ord-1",
    reason: "damaged",
    currency: "USD",
    claimed_amount: 10,
    credited_amount: 10,
    state: "credited",
    opened_at: day(2),
    promised_at: null,
  });
  // A house-A claim naming no vendor, on a house-B order stamped with A's
  // vendor: without the claims' order-lookup clause it is attributed to A.
  credits.push({
    id: "a-claim-on-b-order",
    restaurant_id: A,
    provider_id: null,
    order_id: "b-ord-1",
    reason: "qty_short",
    currency: "USD",
    claimed_amount: 500,
    credited_amount: null,
    state: "open",
    opened_at: day(3),
    promised_at: null,
  });

  // A house-B order still out with the vendor, past its date, stamped with
  // house A's vendor: without the outstanding-orders clause, A's on-time line
  // gains an open "past its expected date and not landed" entry.
  orders.push({
    id: "b-ord-overdue",
    order_number: "B-OVERDUE",
    restaurant_id: B,
    provider_id: PA,
    currency: "EUR",
    status: "IN_TRANSIT",
    expected_delivery_date: "2026-09-03",
    delivered_at: null,
    match_verified_at: null,
    match_status: null,
    price_verified: null,
    invoice_unit_price: null,
    final_price: 20,
    negotiated_price: null,
    quoted_price: null,
  });

  db.tables.procurement_orders = orders;
  db.tables.procurement_order_items = items;
  db.tables.procurement_receipt_events = events;
  db.tables.procurement_conversations = mail;
  db.tables.procurement_credits = credits;
}

function make() {
  const db = new FakeDb();
  seed(db);
  const service = new VendorScorecardService({ getClient: () => db } as any);
  service.clock = () => NOW;
  // The mail route's two collaborators are not exercised in this file (its
  // own spec is vendor-mail-tone.spec.ts); bare doubles keep this one gate.
  const controller = new VendorScorecardController(
    service,
    {} as never,
    {} as never,
  );
  return { db, service, controller };
}

const userA = { userId: "u-a", restaurantId: A };

function m(card: VendorScorecard, key: MeasureResult["key"]): MeasureResult {
  return card.measures.find((x) => x.key === key) as MeasureResult;
}

/** What house A's vendor must read, and nothing from house B may move. */
function expectHouseAOnly(card: VendorScorecard) {
  expect(m(card, "onTime")).toMatchObject({
    outcome: "answered",
    sample: 5,
    hits: 5,
    rows: 5,
  });
  expect(m(card, "linesAsOrdered")).toMatchObject({
    outcome: "answered",
    sample: 5,
    hits: 5,
    rows: 5,
  });
  expect(m(card, "priceAsAgreed")).toMatchObject({
    outcome: "answered",
    sample: 5,
    hits: 5,
    rows: 5,
  });
  expect(m(card, "replyTime")).toMatchObject({
    outcome: "answered",
    sample: 5,
    value: 2,
    rows: 5,
  });
  expect(m(card, "credits")).toMatchObject({
    outcome: "answered",
    sample: 6,
    hits: 6,
    percent: "100%",
  });
  expect(m(card, "credits").money).toEqual([
    { currency: "USD", allowed: 60, asked: 60, share: 1, percent: "100%" },
  ]);
  expect(card.house).toMatchObject({ zone: "UTC", zoneSource: "house" });
  // How the vendor's mail reads is its own owners-and-managers route now.
  expect(card).not.toHaveProperty("tone");
}

describe("the vendor scorecard is house-scoped", () => {
  it("the ledger card counts house A's rows alone, though house B's rows carry A's vendor", async () => {
    const { controller } = make();
    const card = await controller.card(userA, PA, "90");
    expectHouseAOnly(card);
  });

  it("the Roll Call lists house A's vendors only, each counted from house A's rows", async () => {
    const { controller } = make();
    const roll = await controller.rollCall(userA, undefined);
    expect(roll.vendors.map((v) => v.providerId)).toEqual([PA]);
    expectHouseAOnly(roll.vendors[0]);
    expect(roll.window.days).toBe(90);
  });

  it("the Docket holds house A's entries only, and its tallies equal its rows", async () => {
    const { controller } = make();
    const docket = await controller.docket(userA, PA, "90", undefined);
    expect(docket.entries.every((e) => !e.source.id.startsWith("b-"))).toBe(
      true,
    );
    expect(docket.entries).toHaveLength(26);
    for (const x of docket.card.measures)
      expect(docket.entries.filter((e) => e.measure === x.key)).toHaveLength(
        x.rows,
      );
    const onTime = await controller.docket(userA, PA, "90", "onTime");
    expect(onTime.entries.map((e) => e.title)).toEqual([
      "A-5",
      "A-4",
      "A-3",
      "A-2",
      "A-1",
    ]);
  });

  it("counts house A's own order late once house A answered Not yet — and reads neither house B's answers nor its credits", async () => {
    const { controller, db } = make();
    db.tables.procurement_orders.push(
      {
        id: "a-ord-overdue",
        order_number: "A-OVERDUE",
        restaurant_id: A,
        provider_id: PA,
        status: "CONFIRMED",
        expected_delivery_date: "2026-09-04",
        delivered_at: null,
      },
      {
        id: "a-ord-silent",
        order_number: "A-SILENT",
        restaurant_id: A,
        provider_id: PA,
        status: "IN_TRANSIT",
        expected_delivery_date: "2026-09-05",
        delivered_at: null,
      },
    );
    db.tables.procurement_order_arrival_answers = [
      // House B first, cross-linked to house A's silent order: a read that lost
      // its house clause would confirm A-SILENT late.
      {
        restaurant_id: B,
        order_id: "a-ord-silent",
        answer: "not_yet",
        expected_date: "2026-09-05",
        answered_at: "2026-09-07T09:00:00Z",
      },
      {
        restaurant_id: A,
        order_id: "a-ord-overdue",
        answer: "not_yet",
        expected_date: "2026-09-04",
        answered_at: "2026-09-06T09:00:00Z",
      },
    ];
    // House B's credited claim on house A's confirmed order: a credits read
    // that lost its house clause would close A-OVERDUE and drop it.
    db.tables.procurement_credits.push({
      id: "b-closing-credit",
      restaurant_id: B,
      order_id: "a-ord-overdue",
      provider_id: PA,
      state: "credited",
      claimed_amount: 1,
      credited_amount: 1,
      opened_at: day(8),
      reason: "qty_short",
      currency: "USD",
      promised_at: null,
    });
    const card = await controller.card(userA, PA, "90");
    expect(m(card, "onTime")).toMatchObject({
      outcome: "answered",
      sample: 6,
      hits: 5,
      open: 2,
      rows: 7,
      overdue: { confirmed: 1, unconfirmed: 1, incomplete: 0 },
    });
    expect(card.fact.text).toBe(
      "83% on time · 5 of 6 · 1 overdue · 1 unconfirmed, not counted",
    );
    const docket = await controller.docket(userA, PA, "90", "onTime");
    expect(
      docket.entries.filter((e) => e.open).map((e) => [e.title, e.overdue]),
    ).toEqual([
      ["A-SILENT", "unconfirmed"],
      ["A-OVERDUE", "confirmed"],
    ]);
  });

  it("refuses the on-time line when the arrival answers cannot be read — never reads every order as unconfirmed", async () => {
    const { controller, db } = make();
    db.tables.procurement_orders.push({
      id: "a-ord-overdue",
      order_number: "A-OVERDUE",
      restaurant_id: A,
      provider_id: PA,
      status: "CONFIRMED",
      expected_delivery_date: "2026-09-04",
      delivered_at: null,
    });
    db.failures.procurement_order_arrival_answers = "statement timeout";
    const card = await controller.card(userA, PA, "90");
    expect(m(card, "onTime").outcome).toBe("could_not_read");
    expect(m(card, "onTime").reason).toContain(
      "the arrival answers did not answer",
    );
    expect(m(card, "linesAsOrdered").outcome).toBe("answered");
  });

  it("another house's vendor is a 404 — the same answer as no vendor at all", async () => {
    const { controller } = make();
    await expect(controller.card(userA, PB, "90")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      controller.docket(userA, PB, "90", undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.card(userA, "no-such-vendor", "90"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a house that never used a register reads 'not collected', though another house did", async () => {
    const { controller, db } = make();
    // House A keeps its vendor and nothing else; house B keeps everything.
    for (const t of [
      "procurement_orders",
      "procurement_receipt_events",
      "procurement_conversations",
      "procurement_credits",
      "procurement_order_items",
    ])
      db.tables[t] = db.tables[t].filter((r) => r.restaurant_id !== A);
    const card = await controller.card(userA, PA, "90");
    expect(card.measures.map((x) => [x.key, x.outcome])).toEqual([
      ["onTime", "not_collected"],
      ["linesAsOrdered", "not_collected"],
      ["priceAsAgreed", "not_collected"],
      ["replyTime", "not_collected"],
      ["credits", "not_collected"],
    ]);
  });

  it.each([
    [
      "GET /vendor-scorecard",
      (c: VendorScorecardController, u: any) => c.rollCall(u, undefined),
    ],
    [
      "GET /vendor-scorecard/:id",
      (c: VendorScorecardController, u: any) => c.card(u, PA, undefined),
    ],
    [
      "GET /vendor-scorecard/:id/docket",
      (c: VendorScorecardController, u: any) =>
        c.docket(u, PA, undefined, undefined),
    ],
  ])(
    "%s refuses a session that names no house, before any table is read",
    async (_route, call) => {
      const { controller, db } = make();
      const before = db.touched.length;
      await expect(call(controller, { userId: "u-x" })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(db.touched.length).toBe(before);
    },
  );
});

describe("a claim's money is in its order's currency, never the column default", () => {
  it("prints no currency when the order states none, though the claim row says USD", async () => {
    const { controller, db } = make();
    for (const o of db.tables.procurement_orders)
      if (o.restaurant_id === A) o.currency = null;
    const card = await controller.card(userA, PA, "90");
    expect(m(card, "credits").money).toEqual([
      { currency: null, allowed: 60, asked: 60, share: 1, percent: "100%" },
    ]);
    expect(m(card, "credits").sentence).toContain(
      "100% recovered — 60.00 by credit memo of 60.00 asked",
    );
    expect(m(card, "credits").sentence).not.toContain("$");
  });
});

describe("a failed read is never an empty one", () => {
  it("writes a failing register into its own line and leaves the others standing", async () => {
    const { controller, db } = make();
    db.failures.procurement_credits =
      "canceling statement due to statement timeout";
    const card = await controller.card(userA, PA, "90");
    expect(m(card, "credits")).toMatchObject({
      outcome: "could_not_read",
      value: null,
      money: null,
    });
    expect(m(card, "credits").sentence).toContain(
      "canceling statement due to statement timeout",
    );
    expect(m(card, "onTime").outcome).toBe("answered");
  });

  it("a Roll Call whose register fails writes the failure into that column for every vendor", async () => {
    const { controller, db } = make();
    db.tables.providers.push({
      id: "prov-A-2",
      name: "Second",
      restaurant_id: A,
      deleted_at: null,
    });
    db.failures.procurement_conversations = "502";
    const roll = await controller.rollCall(userA, "30");
    expect(roll.vendors).toHaveLength(2);
    for (const v of roll.vendors)
      expect(m(v, "replyTime").outcome).toBe("could_not_read");
  });

  it("an unreadable house record is a 503 on every route — never a silent UTC", async () => {
    const { controller, db } = make();
    db.failures.restaurants = "connection refused";
    await expect(controller.rollCall(userA, undefined)).rejects.toMatchObject({
      status: 503,
    });
    await expect(controller.card(userA, PA, "90")).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      controller.docket(userA, PA, "90", undefined),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("a house with no record of its own is a 404, never a default clock", async () => {
    const { controller, db } = make();
    db.tables.restaurants = db.tables.restaurants.filter((r) => r.id !== A);
    await expect(controller.card(userA, PA, "90")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("an unreadable vendor book is a 503, never an empty Roll Call", async () => {
    const { controller, db } = make();
    db.failures.providers = "connection refused";
    await expect(controller.rollCall(userA, undefined)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("reads every page, and refuses to score a register larger than it can read whole", async () => {
    const { controller, db } = make();
    // 1,200 extra on-time deliveries for A: past one PostgREST page.
    for (let i = 0; i < 1200; i++)
      db.tables.procurement_orders.push({
        id: `a-bulk-${String(i).padStart(5, "0")}`,
        restaurant_id: A,
        provider_id: PA,
        status: "DELIVERED",
        expected_delivery_date: "2026-09-10",
        delivered_at: day(10),
      });
    const paged = await controller.card(userA, PA, "90");
    expect(m(paged, "onTime")).toMatchObject({
      outcome: "answered",
      sample: 1205,
      hits: 1205,
    });

    for (let i = 0; i < 20_000; i++)
      db.tables.procurement_orders.push({
        id: `a-flood-${String(i).padStart(6, "0")}`,
        restaurant_id: A,
        provider_id: PA,
        status: "DELIVERED",
        expected_delivery_date: "2026-09-10",
        delivered_at: day(10),
      });
    const capped = await controller.card(userA, PA, "90");
    expect(m(capped, "onTime").outcome).toBe("could_not_read");
    expect(m(capped, "onTime").sentence).toContain(
      "too many to read in one answer",
    );
  });
});

describe("the request's own words are checked", () => {
  it("accepts 30, 90 and 365 days, defaults to 90, and refuses anything else", () => {
    expect(parseWindow(undefined)).toBe(90);
    expect(parseWindow("30")).toBe(30);
    expect(parseWindow("365")).toBe(365);
    expect(() => parseWindow("7")).toThrow(BadRequestException);
    expect(() => parseWindow("ninety")).toThrow(BadRequestException);
  });

  it("accepts the five measures and refuses a sixth", () => {
    expect(parseMeasure(undefined)).toBeNull();
    expect(parseMeasure("credits")).toBe("credits");
    expect(() => parseMeasure("tone")).toThrow(BadRequestException);
  });

  it("houseOf takes the house from the token and refuses a token with none", () => {
    expect(houseOf({ restaurantId: A })).toBe(A);
    expect(() => houseOf({})).toThrow("This session names no restaurant.");
    expect(() => houseOf(undefined)).toThrow(ForbiddenException);
  });
});

describe("the house's own clock reaches the orders still out", () => {
  it("dates a late landing at its deadline on the house's clock, at the prior window's edge (a UTC-12 house)", async () => {
    const { controller, db } = make();
    // 180 days before NOW is 2026-03-21T12:00Z. An order expected 2026-03-20
    // in a UTC-12 house falls due at 2026-03-21T12:00Z: inside the prior window.
    // It landed two days later, so it is late and dated at that deadline.
    db.tables.restaurants.find((r) => r.id === A)!.timezone = "Etc/GMT+12";
    db.tables.procurement_orders.push({
      id: "a-ord-edge",
      order_number: "A-EDGE",
      restaurant_id: A,
      provider_id: PA,
      status: "DELIVERED",
      expected_delivery_date: "2026-03-20",
      delivered_at: "2026-03-23T10:00:00Z",
    });
    const docket = await controller.docket(userA, PA, "90", "onTime");
    expect(m(docket.card, "onTime").prior).toMatchObject({
      sample: 1,
      hits: 0,
    });
  });
});
