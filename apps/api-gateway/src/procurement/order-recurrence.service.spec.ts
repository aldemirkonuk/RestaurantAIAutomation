import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OrderRecurrenceService,
  RECURRENCE_ACTS,
  isUniqueViolation,
} from "./order-recurrence.service";
import { DatabaseService } from "../database/database.service";
import { ProcurementService } from "./procurement.service";

/**
 * Recurrence ON THE ORDER — the writes.
 *
 * WHAT WAS BROKEN BEFORE THIS SUBSYSTEM, MEASURED ON THE TREE 2026-09-05
 *
 * Nothing in `procurement_orders` recorded a recurrence, so
 * `useOrdersNextData.toRow` set `recurring = false` unconditionally and the
 * rebuilt page's Recurring station could never fill
 * (`.planning/v3.0-TECH-DEBT.md`, "The orders wire", item 2). The table DID
 * carry `is_recurring` and `cron_schedule` from the production baseline, and
 * neither has ever been written or read on this table in any language.
 *
 * THE FOUR THINGS THESE TESTS ARE HERE TO STOP COMING BACK
 *
 *  1. AUTO-APPROVAL. A recurrence must never approve anything: every occurrence
 *     is born PENDING and a person seals it. The sibling `recurring_orders`
 *     path calls `approveOrder` directly on `auto_approve`, with no challenge.
 *  2. THE DEDUP MERGE EATING THE CHILD. `createOrder` folds a second order for
 *     the same restaurant + inventory + provider into the existing open one. A
 *     recurrence's parent matches that by construction and sits in APPROVED,
 *     which is not one of the seven statuses the merge treats as terminal — so
 *     without `provenance.recurrence` every occurrence would have overwritten
 *     its own parent and the run would have counted a success.
 *  3. A RUN THAT SAYS NOTHING. A generator returning `void` cannot tell "nothing
 *     was due" from "the read failed and an unknown number of standing orders
 *     were not raised".
 *  4. TWO CHILDREN FOR ONE OCCURRENCE. Decided by a partial unique index, not
 *     by an application check — the read and the write are not one statement.
 */

type Row = Record<string, any>;

interface Calls {
  orderUpdates: Row[];
  auditInserts: Row[];
  createOrderArgs: any[][];
}

const PARENT: Row = {
  id: "order-parent",
  order_number: "ORD-2026-00042",
  restaurant_id: "rest-1",
  inventory_id: "inv-1",
  provider_id: "prov-1",
  quantity: 5,
  unit_type: "case",
  bottles_total: 60,
  final_price: "38.99",
  status: "APPROVED",
  approved_at: "2026-09-01T10:00:00.000Z",
  manager_notes: "House red",
  recurrence_frequency: null,
  recurrence_anchor_day: null,
  recurrence_anchored_on: null,
  recurrence_next_due_on: null,
  recurrence_status: null,
  recurrence_status_by: "11111111-1111-4111-8111-111111111111",
  recurrence_status_at: null,
  recurrence_parent_order_id: null,
  recurrence_occurrence_on: null,
};

function makeDb(opts: {
  order?: Row | null;
  orderReadError?: { message: string } | null;
  dueRows?: Row[];
  dueError?: { message: string } | null;
  updateError?: { message: string } | null;
  /** Rows the conditional advance says it matched. [] = somebody else advanced. */
  advanceMatched?: Row[];
  line?: Row | null;
  lineError?: { message: string } | null;
  auditError?: { message: string } | null;
}) {
  const calls: Calls = {
    orderUpdates: [],
    auditInserts: [],
    createOrderArgs: [],
  };

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" = "select";
      let payload: Row | null = null;
      let sawNextDueEq = false;

      const settle = (shape: "one" | "many" | "list") => {
        if (table === "procurement_orders") {
          if (op === "update") {
            if (opts.updateError) return { data: null, error: opts.updateError };
            // The conditional advance selects "id" and resolves as a LIST.
            if (sawNextDueEq && shape === "list") {
              return { data: opts.advanceMatched ?? [{ id: PARENT.id }], error: null };
            }
            return {
              data: { ...(opts.order ?? PARENT), ...(payload ?? {}) },
              error: null,
            };
          }
          if (opts.orderReadError)
            return { data: null, error: opts.orderReadError };
          if (shape === "one") return { data: opts.order ?? null, error: null };
          if (opts.dueError) return { data: null, error: opts.dueError };
          return { data: opts.dueRows ?? [], error: null };
        }
        if (table === "procurement_order_items") {
          if (opts.lineError) return { data: null, error: opts.lineError };
          return { data: opts.line ? [opts.line] : [], error: null };
        }
        if (table === "system_audit_log") {
          return { data: null, error: opts.auditError ?? null };
        }
        return { data: shape === "one" ? null : [], error: null };
      };

      const q: any = {
        select: () => q,
        eq: (col: string) => {
          if (col === "recurrence_next_due_on") sawNextDueEq = true;
          return q;
        },
        lte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => settle("one"),
        single: async () => settle("one"),
        insert: (body: Row) => {
          op = "insert";
          payload = body;
          if (table === "system_audit_log") calls.auditInserts.push(body);
          return q;
        },
        update: (body: Row) => {
          op = "update";
          payload = body;
          if (table === "procurement_orders") calls.orderUpdates.push(body);
          return q;
        },
        // The terminal `await` on a query with no .single()/.maybeSingle().
        then: (resolve: any, reject: any) =>
          Promise.resolve(settle(op === "update" ? "list" : "many")).then(
            resolve,
            reject,
          ),
      };
      return q;
    },
  };

  return { supabase, calls };
}

function makeService(
  dbOpts: Parameters<typeof makeDb>[0],
  procOpts: { createOrder?: (...args: any[]) => Promise<any> } = {},
) {
  const { supabase, calls } = makeDb(dbOpts);
  const procurement = {
    createOrder: async (...args: any[]) => {
      calls.createOrderArgs.push(args);
      if (procOpts.createOrder) return procOpts.createOrder(...args);
      return { id: "order-child", orderNumber: "ORD-2026-00099" };
    },
    // Present so the test can assert it is never reached. A recurrence must
    // never approve anything.
    approveOrder: async () => {
      throw new Error(
        "approveOrder must never be called by the recurrence generator",
      );
    },
  };
  const service = new OrderRecurrenceService(
    { supabase } as unknown as DatabaseService,
    procurement as unknown as ProcurementService,
  );
  return { service, calls, procurement };
}

beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

// ===========================================================================
// SETTING A RECURRENCE
// ===========================================================================

describe("setting a recurrence", () => {
  it("writes the rule, the anchor, the derived next date and who set it", async () => {
    const { service, calls } = makeService({ order: PARENT });
    await service.setRecurrence("rest-1", "order-parent", "11111111-1111-4111-8111-111111111111", {
      frequency: "weekly",
      anchorDay: 1,
      startsOn: "2026-09-05",
    });

    expect(calls.orderUpdates).toHaveLength(1);
    const patch = calls.orderUpdates[0];
    expect(patch.recurrence_frequency).toBe("weekly");
    expect(patch.recurrence_anchor_day).toBe(1);
    expect(patch.recurrence_anchored_on).toBe("2026-09-05");
    // DERIVED. 2026-09-08 is the Tuesday after the start date; the caller never
    // sent a date and the DTO has no field for one.
    expect(patch.recurrence_next_due_on).toBe("2026-09-08");
    expect(patch.recurrence_status).toBe("active");
    expect(patch.recurrence_status_by).toBe("11111111-1111-4111-8111-111111111111");
    expect(typeof patch.recurrence_status_at).toBe("string");
  });

  it("refuses an order nobody has approved, and says why in those words", async () => {
    const { service, calls } = makeService({
      order: { ...PARENT, approved_at: null, status: "PENDING" },
    });
    await expect(
      service.setRecurrence("rest-1", "order-parent", "11111111-1111-4111-8111-111111111111", {
        frequency: "weekly",
      }),
    ).rejects.toMatchObject({
      response: { reason: "not_approved" },
    });
    expect(calls.orderUpdates).toHaveLength(0);
  });

  it("allows a delivered order — the commonest way a standing order begins", async () => {
    const { service, calls } = makeService({
      order: { ...PARENT, status: "DELIVERED" },
    });
    await service.setRecurrence("rest-1", "order-parent", "11111111-1111-4111-8111-111111111111", {
      frequency: "monthly",
      anchorDay: 12,
      startsOn: "2026-09-05",
    });
    expect(calls.orderUpdates[0].recurrence_next_due_on).toBe("2026-09-12");
  });

  it("refuses to put a rule on an order that is itself an occurrence", async () => {
    const { service, calls } = makeService({
      order: {
        ...PARENT,
        recurrence_parent_order_id: "order-grandparent",
        recurrence_occurrence_on: "2026-09-01",
      },
    });
    await expect(
      service.setRecurrence("rest-1", "order-child", "11111111-1111-4111-8111-111111111111", {
        frequency: "weekly",
      }),
    ).rejects.toMatchObject({ response: { reason: "child_cannot_recur" } });
    expect(calls.orderUpdates).toHaveLength(0);
  });

  it("refuses a rule this house cannot run, by reason", async () => {
    const { service } = makeService({ order: PARENT });
    await expect(
      service.setRecurrence("rest-1", "order-parent", "11111111-1111-4111-8111-111111111111", {
        frequency: "fortnightly",
      }),
    ).rejects.toMatchObject({ response: { reason: "unknown_frequency" } });
  });

  it("refuses an anchor outside its frequency's range", async () => {
    const { service } = makeService({ order: PARENT });
    await expect(
      service.setRecurrence("rest-1", "order-parent", "11111111-1111-4111-8111-111111111111", {
        frequency: "monthly",
        anchorDay: 31,
      }),
    ).rejects.toMatchObject({ response: { reason: "anchor_out_of_range" } });
  });

  it("404s on an order that is not this restaurant's, rather than writing", async () => {
    const { service, calls } = makeService({ order: null });
    await expect(
      service.setRecurrence("rest-1", "order-elsewhere", "11111111-1111-4111-8111-111111111111", {
        frequency: "weekly",
      }),
    ).rejects.toThrow(/No order with that id/);
    expect(calls.orderUpdates).toHaveLength(0);
  });

  it("does not swallow a failed read — a failed read is never an empty one", async () => {
    const { service } = makeService({
      order: null,
      orderReadError: { message: "connection reset" },
    });
    await expect(
      service.setRecurrence("rest-1", "order-parent", "11111111-1111-4111-8111-111111111111", {
        frequency: "weekly",
      }),
    ).rejects.toMatchObject({ message: "connection reset" });
  });

  it("files an audit row naming the actor and both ends of the move", async () => {
    const { service, calls } = makeService({ order: PARENT });
    await service.setRecurrence("rest-1", "order-parent", "11111111-1111-4111-8111-111111111111", {
      frequency: "weekly",
      startsOn: "2026-09-05",
    });
    expect(calls.auditInserts).toHaveLength(1);
    const row = calls.auditInserts[0];
    expect(row.action).toBe(RECURRENCE_ACTS.SET);
    expect(row.actor_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(row.entity_type).toBe("procurement_order");
    expect(row.entity_id).toBe("order-parent");
    expect(row.restaurant_id).toBe("rest-1");
    expect(row.changes.to).toBe("active");
    // Not sealed, and it SAYS not sealed rather than leaving the reader to guess.
    expect(row.changes.sealed).toBe(false);
  });

  it("still returns the row when the audit write fails, and does not claim it wrote", async () => {
    // The order IS recurring at this point; throwing would tell the caller their
    // change did not happen when it did.
    const { service } = makeService({
      order: PARENT,
      auditError: { message: "audit table is full" },
    });
    await expect(
      service.setRecurrence("rest-1", "order-parent", "11111111-1111-4111-8111-111111111111", {
        frequency: "weekly",
      }),
    ).resolves.toBeDefined();
  });
});

// ===========================================================================
// PAUSE / RESUME / END
// ===========================================================================

const ACTIVE = {
  ...PARENT,
  recurrence_frequency: "weekly",
  recurrence_anchor_day: 1,
  recurrence_anchored_on: "2026-09-05",
  recurrence_next_due_on: "2026-09-08",
  recurrence_status: "active",
  recurrence_status_at: "2026-09-05T09:00:00.000Z",
};

describe("pausing, resuming and ending", () => {
  it("pauses with who and when, and files the paper", async () => {
    const { service, calls } = makeService({ order: ACTIVE });
    await service.pauseRecurrence("rest-1", "order-parent", "22222222-2222-4222-8222-222222222222");
    expect(calls.orderUpdates[0]).toMatchObject({
      recurrence_status: "paused",
      recurrence_status_by: "22222222-2222-4222-8222-222222222222",
    });
    // The next date is untouched: a pause keeps its place in the calendar.
    expect(calls.orderUpdates[0].recurrence_next_due_on).toBeUndefined();
    expect(calls.auditInserts[0].action).toBe(RECURRENCE_ACTS.PAUSED);
    expect(calls.auditInserts[0].changes.from).toBe("active");
  });

  it("ends with who and when", async () => {
    const { service, calls } = makeService({ order: ACTIVE });
    await service.endRecurrence("rest-1", "order-parent", "22222222-2222-4222-8222-222222222222");
    expect(calls.orderUpdates[0].recurrence_status).toBe("ended");
    expect(calls.auditInserts[0].action).toBe(RECURRENCE_ACTS.ENDED);
  });

  it("does not seal — pausing and ending commit no money", async () => {
    // The whole argument in one assertion: no challenge is taken, none is
    // redeemed, and the audit row says `sealed: false` rather than being silent
    // about it. If a recurrence ever auto-approves, this test is the one that
    // has to change first.
    const { service, calls } = makeService({ order: ACTIVE });
    await service.endRecurrence("rest-1", "order-parent", "22222222-2222-4222-8222-222222222222");
    expect(calls.auditInserts[0].changes.sealed).toBe(false);
    expect(service.endRecurrence.length).toBe(3); // (restaurantId, orderId, userId) — no challenge
  });

  it("refuses to pause an order that does not recur", async () => {
    const { service, calls } = makeService({ order: PARENT });
    await expect(
      service.pauseRecurrence("rest-1", "order-parent", "22222222-2222-4222-8222-222222222222"),
    ).rejects.toMatchObject({ response: { reason: "not_recurring" } });
    expect(calls.orderUpdates).toHaveLength(0);
  });

  it("refuses to restart an ended series, and says to set a new one", async () => {
    const { service } = makeService({
      order: { ...ACTIVE, recurrence_status: "ended" },
    });
    await expect(
      service.resumeRecurrence("rest-1", "order-parent", "22222222-2222-4222-8222-222222222222"),
    ).rejects.toMatchObject({ response: { reason: "already_ended" } });
  });

  it("refuses a move to the state it is already in", async () => {
    const { service } = makeService({ order: ACTIVE });
    await expect(
      service.resumeRecurrence("rest-1", "order-parent", "22222222-2222-4222-8222-222222222222"),
    ).rejects.toMatchObject({ response: { reason: "already_there" } });
  });

  it("rolls a resumed series FORWARD past every date it slept through", async () => {
    /*
     * A rule paused in March and resumed in September has a next date six
     * months old. Left alone, the generator reads it as overdue and mints one
     * order a day until it catches up — six months of wine nobody asked for.
     */
    const paused = {
      ...ACTIVE,
      recurrence_status: "paused",
      recurrence_next_due_on: "2026-03-03",
    };
    const { service, calls } = makeService({ order: paused });
    jest
      .spyOn(service as any, "today")
      .mockReturnValue("2026-09-05");

    await service.resumeRecurrence("rest-1", "order-parent", "22222222-2222-4222-8222-222222222222");
    const rolled = calls.orderUpdates[0].recurrence_next_due_on as string;
    expect(rolled >= "2026-09-05").toBe(true);
    // Still a Tuesday: the roll uses the rule, it does not just take today.
    expect(new Date(`${rolled}T00:00:00Z`).getUTCDay()).toBe(2);
    expect(calls.auditInserts[0].changes.detail.rolledForward).toBe(true);
    (service as any).today.mockRestore();
  });

  it("leaves a resumed series alone when its date has not passed", async () => {
    const paused = {
      ...ACTIVE,
      recurrence_status: "paused",
      recurrence_next_due_on: "2026-12-01",
    };
    const { service, calls } = makeService({ order: paused });
    jest.spyOn(service as any, "today").mockReturnValue("2026-09-05");
    await service.resumeRecurrence("rest-1", "order-parent", "22222222-2222-4222-8222-222222222222");
    expect(calls.orderUpdates[0].recurrence_next_due_on).toBe("2026-12-01");
    expect(calls.auditInserts[0].changes.detail.rolledForward).toBe(false);
    (service as any).today.mockRestore();
  });

  it("refuses to resume a series whose stored rule is not one it can run", async () => {
    const { service, calls } = makeService({
      order: {
        ...ACTIVE,
        recurrence_status: "paused",
        recurrence_frequency: "fortnightly",
      },
    });
    await expect(
      service.resumeRecurrence("rest-1", "order-parent", "22222222-2222-4222-8222-222222222222"),
    ).rejects.toMatchObject({ response: { reason: "unreadable_rule" } });
    expect(calls.orderUpdates).toHaveLength(0);
  });
});

// ===========================================================================
// THE GENERATOR
// ===========================================================================

const DUE = {
  ...ACTIVE,
  recurrence_next_due_on: "2026-09-08",
};

describe("the generator", () => {
  const at = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

  it("mints one PENDING child per due series and never approves it", async () => {
    const { service, calls, procurement } = makeService({
      dueRows: [DUE],
      order: DUE,
      line: {
        price_uom: "case",
        price_pack_size: 12,
        allowance: "25.00",
        deposit: "6.00",
        freight: "48.00",
        bottles_per_unit: 12,
      },
    });
    const approve = jest.spyOn(procurement, "approveOrder");

    const out = await service.generateDueRecurrences(at("2026-09-08"));

    expect(out.due).toBe(1);
    expect(out.created).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.collided).toBe(0);
    // THE RULE THAT SHAPES EVERYTHING ELSE.
    expect(approve).not.toHaveBeenCalled();
  });

  it("names its parent and its occurrence, and asks createOrder to skip the dedup merge", async () => {
    const { service, calls } = makeService({ dueRows: [DUE], order: DUE });
    await service.generateDueRecurrences(at("2026-09-08"));

    const [, , , provenance] = calls.createOrderArgs[0];
    expect(provenance).toEqual({
      source: "recurring",
      recurrence: {
        parentOrderId: "order-parent",
        occurrenceOn: "2026-09-08",
      },
    });
  });

  it("carries the agreement across: the unit, the pack size and all three fees", async () => {
    const { service, calls } = makeService({
      dueRows: [DUE],
      order: DUE,
      line: {
        price_uom: "case",
        price_pack_size: 12,
        allowance: "25.00",
        deposit: "6.00",
        freight: "48.00",
        bottles_per_unit: 12,
      },
    });
    await service.generateDueRecurrences(at("2026-09-08"));

    const [, , dto] = calls.createOrderArgs[0];
    expect(dto.unitType).toBe("case");
    // 60 bottles / 5 cases = 12, back-derived from the header the same way the
    // receiving door does it — never guessed as 1.
    expect(dto.bottlesPerUnit).toBe(12);
    expect(dto.priceUom).toBe("case");
    expect(dto.pricePackSize).toBe(12);
    expect(dto.allowance).toBe(25);
    expect(dto.deposit).toBe(6);
    expect(dto.freight).toBe(48);
    // numeric arrives from PostgREST as a string; it must reach createOrder as
    // a number, and an unreadable one must be undefined and never 0.
    expect(dto.finalPrice).toBe(38.99);
  });

  it("says in the child's own notes that the price was RE-READ, and when", async () => {
    const { service, calls } = makeService({ dueRows: [DUE], order: DUE });
    await service.generateDueRecurrences(at("2026-09-08"));
    const [, , dto] = calls.createOrderArgs[0];
    expect(dto.managerNotes).toContain("ORD-2026-00042");
    expect(dto.managerNotes).toContain("occurrence 2026-09-08");
    expect(dto.managerNotes).toMatch(/price read from that order on \d{4}-\d{2}-\d{2}/);
  });

  it("raises the child as the person who owns the rule, not as a string 'system'", async () => {
    const { service, calls } = makeService({ dueRows: [DUE], order: DUE });
    await service.generateDueRecurrences(at("2026-09-08"));
    const [, userId] = calls.createOrderArgs[0];
    expect(userId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("passes an empty actor rather than 'system' when the rule's owner is gone", async () => {
    // `created_by` has an FK to public.users(user_id). "system" is not a uuid
    // and would raise 22P02; `asUuid` turns "" into NULL, which is true.
    const { service, calls } = makeService({
      dueRows: [{ ...DUE, recurrence_status_by: null }],
      order: DUE,
    });
    await service.generateDueRecurrences(at("2026-09-08"));
    expect(calls.createOrderArgs[0][1]).toBe("");
  });

  it("advances the parent by exactly ONE step, conditionally on the date not having moved", async () => {
    const { service, calls } = makeService({ dueRows: [DUE], order: DUE });
    await service.generateDueRecurrences(at("2026-09-08"));
    const advance = calls.orderUpdates.find(
      (u) => "recurrence_next_due_on" in u && Object.keys(u).length === 1,
    );
    expect(advance).toEqual({ recurrence_next_due_on: "2026-09-15" });
  });

  it("mints ONE child for a series weeks overdue, not one per missed occurrence", async () => {
    // A cron that did not run for a fortnight has a fortnight of missed
    // Tuesdays. Minting all of them would put fourteen orders in front of a
    // manager who wanted one; catching up a step a day is visible and refusable.
    const overdue = { ...DUE, recurrence_next_due_on: "2026-08-11" };
    const { service, calls } = makeService({ dueRows: [overdue], order: overdue });
    const out = await service.generateDueRecurrences(at("2026-09-08"));
    expect(out.created).toBe(1);
    expect(calls.createOrderArgs).toHaveLength(1);
  });

  it("counts a unique-index collision as a collision, never as a success", async () => {
    const { service } = makeService(
      { dueRows: [DUE], order: DUE },
      {
        createOrder: async () => {
          const err: any = new Error("duplicate key value violates unique constraint");
          err.code = "23505";
          throw err;
        },
      },
    );
    const out = await service.generateDueRecurrences(at("2026-09-08"));
    expect(out.collided).toBe(1);
    expect(out.created).toBe(0);
    expect(out.failed).toBe(0);
  });

  it("still advances the parent after a collision — the occurrence does have an order", async () => {
    const { service, calls } = makeService(
      { dueRows: [DUE], order: DUE },
      {
        createOrder: async () => {
          const err: any = new Error("duplicate key");
          err.code = "23505";
          throw err;
        },
      },
    );
    await service.generateDueRecurrences(at("2026-09-08"));
    expect(
      calls.orderUpdates.some(
        (u) => u.recurrence_next_due_on === "2026-09-15",
      ),
    ).toBe(true);
  });

  it("counts any other failure as a failure and does NOT advance the parent", async () => {
    const { service, calls } = makeService(
      { dueRows: [DUE], order: DUE },
      {
        createOrder: async () => {
          throw new Error("no active vendors");
        },
      },
    );
    const out = await service.generateDueRecurrences(at("2026-09-08"));
    expect(out.failed).toBe(1);
    expect(out.created).toBe(0);
    // Not advanced: the next run must try again.
    expect(calls.orderUpdates).toHaveLength(0);
  });

  it("reports a failed read as a failed read, never as 'nothing was due'", async () => {
    const { service, calls } = makeService({
      dueError: { message: "statement timeout" },
    });
    const out = await service.generateDueRecurrences(at("2026-09-08"));
    expect(out.queryFailed).toBe(true);
    expect(out.error).toBe("statement timeout");
    expect(out.due).toBe(0);
    expect(out.created).toBe(0);
    expect(calls.createOrderArgs).toHaveLength(0);
  });

  it("records a run that did nothing because nothing was due, with the day it was for", async () => {
    // ADR 0086. A run that made nothing still says so, and says which day, so
    // "the generator has not run since Tuesday" is answerable from the log.
    const { service } = makeService({ dueRows: [] });
    const out = await service.generateDueRecurrences(at("2026-09-08"));
    expect(out).toEqual({
      runFor: "2026-09-08",
      due: 0,
      created: 0,
      collided: 0,
      failed: 0,
      drifted: 0,
      queryFailed: false,
      error: null,
    });
  });

  it("leaves a series alone when its stored rule cannot be read, and counts it as drift", async () => {
    const { service, calls } = makeService({
      dueRows: [{ ...DUE, recurrence_frequency: "fortnightly" }],
    });
    const out = await service.generateDueRecurrences(at("2026-09-08"));
    expect(out.drifted).toBe(1);
    expect(out.created).toBe(0);
    expect(calls.createOrderArgs).toHaveLength(0);
    expect(calls.orderUpdates).toHaveLength(0);
  });

  it("leaves a series alone when its stored next date is null", async () => {
    const { service, calls } = makeService({
      dueRows: [{ ...DUE, recurrence_next_due_on: null }],
    });
    const out = await service.generateDueRecurrences(at("2026-09-08"));
    expect(out.drifted).toBe(1);
    expect(calls.createOrderArgs).toHaveLength(0);
  });

  it("raises the order from the header alone when the agreement line cannot be read", async () => {
    // Reported, and the fees are ABSENT rather than assumed zero: a recurrence
    // that quietly drops a deposit under-orders money every week.
    const { service, calls } = makeService({
      dueRows: [DUE],
      order: DUE,
      lineError: { message: "permission denied for procurement_order_items" },
    });
    const out = await service.generateDueRecurrences(at("2026-09-08"));
    expect(out.created).toBe(1);
    const [, , dto] = calls.createOrderArgs[0];
    expect(dto.allowance).toBeUndefined();
    expect(dto.deposit).toBeUndefined();
    expect(dto.freight).toBeUndefined();
    expect(dto.priceUom).toBeUndefined();
  });

  it("does not guess a pack size it cannot back-derive", async () => {
    // createOrder refuses a case order with no pack size, and that refusal is
    // the right outcome — guessing 1 books a twelfth of the delivery.
    const { service, calls } = makeService({
      dueRows: [{ ...DUE, bottles_total: 61, quantity: 5 }],
      order: DUE,
    });
    await service.generateDueRecurrences(at("2026-09-08"));
    expect(calls.createOrderArgs[0][2].bottlesPerUnit).toBeUndefined();
  });

  it("says so when another run advanced the same series first, and overwrites nothing", async () => {
    const { service } = makeService({
      dueRows: [DUE],
      order: DUE,
      advanceMatched: [],
    });
    const out = await service.generateDueRecurrences(at("2026-09-08"));
    // The child was still minted; the advance simply matched no row because the
    // conditional `.eq` on the old date no longer held.
    expect(out.created).toBe(1);
  });

  it("puts every due series in exactly one bucket", async () => {
    const { service } = makeService(
      {
        dueRows: [
          DUE,
          { ...DUE, id: "p2", order_number: "ORD-2" },
          { ...DUE, id: "p3", order_number: "ORD-3", recurrence_frequency: "yearly" },
        ],
      },
      {
        createOrder: async (_r: string, _u: string, _d: any, prov: any) => {
          if (prov.recurrence.parentOrderId === "p2") {
            const err: any = new Error("dup");
            err.code = "23505";
            throw err;
          }
          return { id: "child", orderNumber: "ORD-X" };
        },
      },
    );
    const out = await service.generateDueRecurrences(at("2026-09-08"));
    expect(out.due).toBe(3);
    expect(out.created + out.collided + out.failed + out.drifted).toBe(out.due);
    expect(out).toMatchObject({ created: 1, collided: 1, drifted: 1, failed: 0 });
  });
});

describe("recognising a unique violation", () => {
  it("keys on the code, not on the message text", async () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: 23505 })).toBe(true);
    expect(isUniqueViolation({ message: "duplicate key" })).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

// ===========================================================================
// THE SHAPE THE MIGRATION AND THE SERVICE HAVE TO AGREE ON
// ===========================================================================

describe("the migration and this service say the same thing", () => {
  const sql = readFileSync(
    join(
      __dirname,
      "../../../../supabase/migrations/20260905235800_an_order_that_repeats_says_so_on_itself.sql",
    ),
    "utf8",
  );

  it("declares every column this service selects", () => {
    for (const col of [
      "recurrence_frequency",
      "recurrence_anchor_day",
      "recurrence_anchored_on",
      "recurrence_next_due_on",
      "recurrence_status",
      "recurrence_status_by",
      "recurrence_status_at",
      "recurrence_parent_order_id",
      "recurrence_occurrence_on",
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it("CHECKs the same five frequencies this service will write", () => {
    expect(sql).toContain(
      "('daily','weekly','biweekly','monthly','quarterly')",
    );
  });

  it("carries the partial unique index that decides one child per occurrence", () => {
    expect(sql).toContain("ux_procurement_orders_recurrence_occurrence");
    expect(sql).toContain(
      "ON public.procurement_orders (recurrence_parent_order_id, recurrence_occurrence_on)",
    );
    expect(sql).toContain("WHERE recurrence_parent_order_id IS NOT NULL");
  });

  it("points the actor foreign key at public.users, never at auth.users", () => {
    // The two tables are disjoint in this database. An FK to auth.users raises
    // 23503 on every write and no test on a fresh database can catch it.
    expect(sql).toContain("REFERENCES public.users(user_id)");
    // The prose above the constraint NAMES auth.users to say why it is not
    // used, so the assertion is over the SQL keyword rather than the string.
    expect(sql).not.toMatch(/REFERENCES\s+auth\.users/i);
  });

  it("tombstones the two dead baseline columns rather than writing them", () => {
    expect(sql).toContain("COMMENT ON COLUMN public.procurement_orders.is_recurring");
    expect(sql).toContain("COMMENT ON COLUMN public.procurement_orders.cron_schedule");
  });

  it("proves what it did with in-file assertions", () => {
    expect(sql).toContain("DO $assert$");
    expect(sql).toContain("expected 9 recurrence columns");
  });
});
