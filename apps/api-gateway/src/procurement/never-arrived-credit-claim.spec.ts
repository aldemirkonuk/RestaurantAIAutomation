/**
 * The founder's box on the never-arrived cancel (ADR 0207 round 5, question
 * 20, round 6z, verbatim): "Add the box (Recommended)" — "We paid for this,
 * we are owed {total}", opening a credit claim with the order's vendor and
 * currency. Also covers the round-4-named gap this round closes:
 * `openCreditClaim` (the invoice-match writer) now records `provider_id`
 * and `currency` too.
 *
 * A small, purpose-built fake Supabase client rather than the generic
 * `FakeQuery` double other specs use — the call shapes this file exercises
 * are few and exact, and a bespoke fake makes each one legible at its call
 * site instead of behind a general filter engine.
 */

import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { OrganizationsService } from "../organizations/organizations.service";

const REST = "11111111-1111-4111-8111-111111111111";
const OTHER_REST = "99999999-9999-4999-8999-999999999999";
const ORDER = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const PROVIDER = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, any>;

interface CreditInsert {
  row: Row;
}

/** Only what `openNeverArrivedCreditClaim` and `openCreditClaim` actually call. */
class FakeDb {
  orders: Row[] = [];
  credits: Row[] = [];
  creditInserts: CreditInsert[] = [];
  /** Force the NEXT order read, or every credits read/insert, to error. */
  failOrderRead: string | null = null;
  failCreditsRead: string | null = null;
  failCreditsInsert: string | null = null;
  /** Simulate a unique-constraint hit on the insert (23505), once. */
  raceOnInsert = false;

  from(table: string) {
    if (table === "procurement_orders") return new OrdersQuery(this);
    if (table === "procurement_credits") return new CreditsQuery(this);
    throw new Error(`FakeDb: unexpected table ${table}`);
  }
}

class OrdersQuery {
  private restaurantId: string | null = null;
  private id: string | null = null;
  constructor(private readonly db: FakeDb) {}
  select() {
    return this;
  }
  eq(col: string, v: string) {
    if (col === "restaurant_id") this.restaurantId = v;
    if (col === "id") this.id = v;
    return this;
  }
  async maybeSingle() {
    if (this.db.failOrderRead) return { data: null, error: { message: this.db.failOrderRead } };
    const row = this.db.orders.find(
      (o) => o.id === this.id && o.restaurant_id === this.restaurantId,
    );
    return { data: row ?? null, error: null };
  }
}

class CreditsQuery {
  private filters: ((r: Row) => boolean)[] = [];
  private insertRow: Row | null = null;
  constructor(private readonly db: FakeDb) {}
  select() {
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  insert(row: Row) {
    this.insertRow = row;
    return this;
  }
  async maybeSingle() {
    if (this.insertRow) return this.doInsert(false);
    if (this.db.failCreditsRead) return { data: null, error: { message: this.db.failCreditsRead } };
    const row = this.db.credits.find((r) => this.filters.every((f) => f(r)));
    return { data: row ?? null, error: null };
  }
  async single() {
    return this.doInsert(true);
  }
  /**
   * Real Supabase query builders are thenable: `await .from(t).insert(row)`
   * with no `.select()` runs the write directly (`openCreditClaim`'s own
   * shape). `.select()...maybeSingle()`/`.single()` above cover every OTHER
   * call in this file; this is only reached by that one bare-insert path.
   */
  then<T1 = { data: Row | null; error: Row | null }, T2 = never>(
    onfulfilled?: ((value: { data: Row | null; error: Row | null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ) {
    return this.maybeSingle().then(onfulfilled, onrejected);
  }
  private async doInsert(wantSingle: boolean) {
    if (!this.insertRow) throw new Error("FakeDb: .single()/.maybeSingle() with no prior insert()");
    if (this.db.failCreditsInsert) return { data: null, error: { message: this.db.failCreditsInsert } };
    if (this.db.raceOnInsert) {
      this.db.raceOnInsert = false;
      // A concurrent request's insert is what a real 23505 means: by the
      // time THIS one is refused, some other row already committed. The
      // fake models that by adding it now, so the code's own read-back
      // finds exactly what actually won.
      this.db.credits.push({
        id: "credit-winner",
        restaurant_id: this.insertRow!.restaurant_id,
        order_id: this.insertRow!.order_id,
        provider_id: this.insertRow!.provider_id ?? null,
        reason: this.insertRow!.reason,
        state: "open",
        claimed_amount: this.insertRow!.claimed_amount,
        currency: this.insertRow!.currency ?? "USD",
      });
      return { data: null, error: { code: "23505", message: "duplicate" } };
    }
    const id = `credit-${this.db.credits.length + 1}`;
    const row: Row = {
      id,
      restaurant_id: this.insertRow.restaurant_id,
      provider_id: this.insertRow.provider_id ?? null,
      order_id: this.insertRow.order_id ?? null,
      reason: this.insertRow.reason,
      summary: this.insertRow.summary ?? null,
      currency: this.insertRow.currency ?? "USD",
      claimed_amount: this.insertRow.claimed_amount,
      state: this.insertRow.state ?? "open",
      opened_by: this.insertRow.opened_by ?? null,
      self_evidenced: this.insertRow.self_evidenced ?? false,
      evidence: this.insertRow.evidence ?? null,
    };
    this.db.credits.push(row);
    this.db.creditInserts.push({ row: this.insertRow });
    if (!wantSingle) return { data: row, error: null };
    return { data: { id: row.id, claimed_amount: row.claimed_amount, currency: row.currency, state: row.state }, error: null };
  }
}

function order(over: Row = {}): Row {
  return {
    id: ORDER,
    restaurant_id: REST,
    status: "CANCELLED",
    cancel_reason_code: "never_arrived",
    provider_id: PROVIDER,
    currency: "USD",
    total_cost: "240.00",
    ...over,
  };
}

function make(over: { role?: "owner" | "manager" | "staff" | null } = {}) {
  const db = new FakeDb();
  const role = over.role ?? "manager";
  const organizations = {
    assertCanManageRestaurant: async (_userId: string, restaurantId: string, action: string) => {
      if (restaurantId !== REST || role !== "owner" && role !== "manager") {
        throw new ForbiddenException(
          `Only a manager or an owner may ${action}. Nothing was changed.`,
        );
      }
    },
  } as unknown as OrganizationsService;
  const svc = new ProcurementService(
    { supabase: db } as unknown as DatabaseService,
    {} as EventsService,
    {} as InventoryLedgerService,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    organizations,
  );
  return { db, svc };
}

describe("openNeverArrivedCreditClaim — the founder's box, round 6z", () => {
  it("refuses a caller who is not a manager or an owner", async () => {
    const { db, svc } = make({ role: "staff" });
    db.orders.push(order());
    await expect(svc.openNeverArrivedCreditClaim(REST, ORDER, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.creditInserts).toHaveLength(0);
  });

  it("404s an order that is not this restaurant's", async () => {
    const { db, svc } = make();
    db.orders.push(order({ restaurant_id: OTHER_REST }));
    await expect(svc.openNeverArrivedCreditClaim(REST, ORDER, USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("refuses an order that was not cancelled never_arrived", async () => {
    const { db, svc } = make();
    db.orders.push(order({ cancel_reason_code: "house_decision" }));
    await expect(svc.openNeverArrivedCreditClaim(REST, ORDER, USER)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(db.creditInserts).toHaveLength(0);
  });

  it("refuses an order that is not CANCELLED at all", async () => {
    const { db, svc } = make();
    db.orders.push(order({ status: "CONFIRMED", cancel_reason_code: null }));
    await expect(svc.openNeverArrivedCreditClaim(REST, ORDER, USER)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it("refuses an order with no positive total to claim back", async () => {
    const { db, svc } = make();
    db.orders.push(order({ total_cost: 0 }));
    await expect(svc.openNeverArrivedCreditClaim(REST, ORDER, USER)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it("opens a claim for the order's own total, vendor and currency", async () => {
    const { db, svc } = make();
    db.orders.push(order());
    const result = await svc.openNeverArrivedCreditClaim(REST, ORDER, USER);
    expect(result.opened).toBe(true);
    expect(result.alreadyOpen).toBe(false);
    expect(result.claim.claimedAmount).toBe(240);
    expect(result.claim.currency).toBe("USD");
    expect(db.creditInserts).toHaveLength(1);
    const written = db.creditInserts[0].row;
    expect(written).toMatchObject({
      restaurant_id: REST,
      order_id: ORDER,
      provider_id: PROVIDER,
      reason: "never_arrived",
      claimed_amount: 240,
      currency: "USD",
      state: "open",
      opened_by: USER,
    });
  });

  it("never writes a currency the order did not state", async () => {
    const { db, svc } = make();
    db.orders.push(order({ currency: null, total_cost: 88.5 }));
    await svc.openNeverArrivedCreditClaim(REST, ORDER, USER);
    const written = db.creditInserts[0].row;
    expect("currency" in written).toBe(false);
  });

  it("is idempotent — a second call finds the open claim and opens no second one", async () => {
    const { db, svc } = make();
    db.orders.push(order());
    const first = await svc.openNeverArrivedCreditClaim(REST, ORDER, USER);
    const second = await svc.openNeverArrivedCreditClaim(REST, ORDER, USER);
    expect(second.opened).toBe(false);
    expect(second.alreadyOpen).toBe(true);
    expect(second.claim.id).toBe(first.claim.id);
    expect(db.creditInserts).toHaveLength(1);
  });

  it("reads back the winner rather than failing when a same-instant concurrent request wins the insert race", async () => {
    const { db, svc } = make();
    db.orders.push(order());
    // Nothing exists yet when the pre-check runs; the race is entirely at
    // the INSERT, which the fake resolves by having a concurrent winner's
    // row appear at that exact moment (see doInsert's raceOnInsert branch).
    db.raceOnInsert = true;
    const result = await svc.openNeverArrivedCreditClaim(REST, ORDER, USER);
    expect(result.opened).toBe(false);
    expect(result.alreadyOpen).toBe(true);
    expect(result.claim.id).toBe("credit-winner");
    // This caller's own attempt never became a second row.
    expect(db.credits.filter((c) => c.order_id === ORDER)).toHaveLength(1);
  });

  it("500s, rather than silently succeeding, when the insert fails for a reason that is not a race", async () => {
    const { db, svc } = make();
    db.orders.push(order());
    db.failCreditsInsert = "connection reset";
    await expect(svc.openNeverArrivedCreditClaim(REST, ORDER, USER)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe("openCreditClaim — the invoice-match writer now states its vendor and currency", () => {
  it("writes provider_id and currency when the order carries them", async () => {
    const { db, svc } = make();
    const match = {
      verdict: "overbilled_vs_ship",
      creditDue: true,
      creditAmount: 42,
      selfEvidenced: true,
      summary: "Billed 42 more than the ship-to slip.",
    } as any;
    await (svc as any).openCreditClaim(REST, ORDER, USER, match, {
      provider_id: PROVIDER,
      currency: "EUR",
    });
    expect(db.creditInserts).toHaveLength(1);
    expect(db.creditInserts[0].row).toMatchObject({
      restaurant_id: REST,
      order_id: ORDER,
      provider_id: PROVIDER,
      currency: "EUR",
      reason: "overbilled_vs_ship",
      claimed_amount: 42,
    });
  });

  it("writes no currency when the order states none, rather than defaulting to USD", async () => {
    const { db, svc } = make();
    const match = {
      verdict: "qty_short",
      creditDue: true,
      creditAmount: 10,
      selfEvidenced: false,
      summary: "Short one case.",
    } as any;
    await (svc as any).openCreditClaim(REST, ORDER, USER, match, {
      provider_id: PROVIDER,
      currency: null,
    });
    expect("currency" in db.creditInserts[0].row).toBe(false);
  });

  it("writes no provider_id when the caller gives no order at all — the pre-round-5 shape, still safe", async () => {
    const { db, svc } = make();
    const match = {
      // "rejected" is the match verdict; draftClaimFromMatch names its
      // credit REASON "damaged" (invoice-match.ts / credit-ledger.ts).
      verdict: "rejected",
      creditDue: true,
      creditAmount: 5,
      selfEvidenced: true,
      summary: "One bottle broken.",
    } as any;
    await (svc as any).openCreditClaim(REST, ORDER, USER, match);
    expect(db.creditInserts[0].row.provider_id).toBeNull();
    expect(db.creditInserts[0].row.reason).toBe("damaged");
  });
});
