import {
  RecurringOrdersService,
  describeScheduleSubject,
  recurringRemindersArmed,
  RECURRING_REMINDER_FLAG,
} from "./recurring-orders.service";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";

/**
 * The recurring materialiser's calendar writes, and the reminder it sends.
 *
 * FOUR FAILURES, ALL VERIFIED AGAINST PRODUCTION 2026-09-02 (ADR 0068)
 *
 * 1. `priority` and `tags` are not columns of `calendar_events`. 0 of 2 present
 *    in information_schema. Every insert and update from this file named both,
 *    so PostgREST answered PGRST204 and rejected the whole statement.
 * 2. `source` is `varchar(50) NOT NULL` with NO DEFAULT and was never written.
 *    An independent, sufficient reason for the same failure.
 * 3. The link was a JSON string in the phantom `tags` column, read back with
 *    `.like("tags", '%<uuid>%')` — an unindexable substring scan against a
 *    column that does not exist. It is now `recurring_order_id uuid`, FK,
 *    partial-indexed.
 * 4. The status vocabulary was invented. The code wrote `"SCHEDULED"` and
 *    `"COMPLETED"` and filtered on `"SCHEDULED"`. That table's 19 real rows
 *    hold exactly `pending` (16), `active` (2) and `completed` (1), all
 *    lowercase; the column default is `pending`; and `CalendarEventStatus`
 *    (calendar/dto/calendar.dto.ts:36) has no SCHEDULED member in any casing.
 *    There is no CHECK constraint, so every bad write was accepted in silence
 *    and every read matched nothing.
 *
 * And the fabrication the reminder carried: `wine_name || "Unknown"`, straight
 * into a push + email TITLE (`notification_agent.py:161,171`). 53 of
 * production's 72 inventory rows have a NULL `wine_name` and all 53 reach a
 * real one through `master_wine_library.name`, so "Unknown" was the MAJORITY
 * outcome, not an edge (ADR 0051 / 0020).
 */

type Row = Record<string, any>;

/**
 * Every column `calendar_events` has.
 *
 * Transcribed from `20260805000000_baseline_from_production.sql:2341-2375`
 * plus `recurring_order_id` from `20260902100000_calendar_events_recurring_order_link.sql`.
 * Confirmed against production's information_schema on 2026-09-02: `priority`
 * and `tags` are absent, and `recurring_order_id` is absent until this
 * migration applies.
 */
const CALENDAR_COLUMNS = new Set([
  "id",
  "restaurant_id",
  "provider_id",
  "order_id",
  "title",
  "description",
  "event_type",
  "event_date",
  "event_date_end",
  "all_day",
  "event_time",
  "source",
  "ai_confidence",
  "detected_from_conversation_id",
  "status",
  "reminder_enabled",
  "reminder_days_before",
  "reminder_sent",
  "reminder_sent_at",
  "created_by",
  "created_at",
  "updated_at",
  "is_recurring",
  "recurrence_rule_id",
  "parent_event_id",
  "occurrence_date",
  "is_exception",
  "exception_type",
  "color",
  "start_date",
  "end_date",
  "start_time",
  "end_time",
  "recurring_order_id",
]);

interface Filter {
  op: string;
  column: string;
  value: any;
}

interface Calls {
  calendarInserts: Row[];
  calendarUpdates: Row[];
  /** Filters applied to each `.from("calendar_events").select()` chain. */
  calendarSelectFilters: Filter[][];
  scheduleQueries: number;
}

function makeDb(opts: {
  dueSchedules?: Row[];
  insertedSchedule?: Row;
  insertedOrder?: Row;
  inventory?: Row | null;
  /** Rows the calendar lookup returns. */
  calendarLookup?: Row[];
  /** Force the recurring_orders read to fail, as PostgREST would. */
  scheduleQueryError?: string;
  /** Force the calendar bulk insert to fail. */
  calendarInsertError?: string;
}) {
  const calls: Calls = {
    calendarInserts: [],
    calendarUpdates: [],
    calendarSelectFilters: [],
    scheduleQueries: 0,
  };

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";
      const filters: Filter[] = [];
      if (table === "calendar_events")
        calls.calendarSelectFilters.push(filters);

      const settle = (shape: "one" | "many") => {
        if (table === "providers") return { data: null, count: 1, error: null };
        if (table === "restaurant_inventory")
          return { data: opts.inventory ?? null, error: null };
        if (table === "procurement_orders")
          return {
            data: op === "insert" ? (opts.insertedOrder ?? null) : null,
            error: null,
          };
        if (table === "calendar_events") {
          if (op === "insert")
            return {
              data: null,
              error: opts.calendarInsertError
                ? { message: opts.calendarInsertError }
                : null,
            };
          if (op === "update") return { data: null, error: null };
          return { data: opts.calendarLookup ?? [], error: null };
        }
        if (table === "recurring_orders") {
          if (op === "insert")
            return { data: opts.insertedSchedule ?? null, error: null };
          if (op === "update") return { data: null, error: null };
          calls.scheduleQueries += 1;
          if (opts.scheduleQueryError)
            return { data: null, error: { message: opts.scheduleQueryError } };
          if (shape === "one")
            return { data: opts.insertedSchedule ?? null, error: null };
          return { data: opts.dueSchedules ?? [], error: null };
        }
        return { data: shape === "many" ? [] : null, error: null };
      };

      const record = (o: string) => (c: string, v: any) => {
        filters.push({ op: o, column: c, value: v });
        return q;
      };

      const q: any = {
        select: () => q,
        eq: record("eq"),
        neq: record("neq"),
        like: record("like"),
        ilike: record("ilike"),
        lte: record("lte"),
        gt: record("gt"),
        not: () => q,
        in: () => q,
        is: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        insert(payload: Row) {
          op = "insert";
          if (table === "calendar_events")
            calls.calendarInserts.push(
              ...(Array.isArray(payload) ? payload : [payload]),
            );
          return q;
        },
        update(payload: Row) {
          op = "update";
          if (table === "calendar_events") calls.calendarUpdates.push(payload);
          return q;
        },
        delete() {
          op = "delete";
          return q;
        },
        single: async () => settle("one"),
        maybeSingle: async () => settle("one"),
        then: (res: any, rej: any) =>
          Promise.resolve(settle("many")).then(res, rej),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({}) },
  };

  return {
    calls,
    db: {
      supabase,
      getClient: () => supabase,
      client: supabase,
    } as unknown as DatabaseService,
  };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

function makeOrchestrator(behaviour: { publishThrows?: boolean } = {}) {
  return {
    publishEvent: jest.fn().mockImplementation(async () => {
      if (behaviour.publishThrows) throw new Error("broker unreachable");
      return {};
    }),
    triggerDraftHttp: jest.fn().mockResolvedValue({}),
  } as unknown as OrchestratorService;
}

const SCHEDULE = "33333333-3333-4333-8333-333333333333";
const INVENTORY = "55555555-5555-4555-8555-555555555555";
const PROVIDER = "66666666-6666-4666-8666-666666666666";
const USER = "22222222-2222-4222-8222-222222222222";
const ORDER = "44444444-4444-4444-8444-444444444444";

const insertedOrder = {
  id: ORDER,
  order_number: "ORD-2026-00007",
  restaurant_id: "rest-1",
  inventory_id: INVENTORY,
  provider_id: PROVIDER,
  quantity: 5,
  unit_type: "case",
  bottles_total: 60,
  final_price: 40,
  total_cost: 2400,
  status: "PENDING",
  inventory: { wine_name: "Barolo Riserva" },
};

/**
 * A `recurring_orders` row as PostgREST returns it under RECURRING_SELECT.
 *
 * `inventory.wine_name` is deliberately NULL by default with the real name one
 * hop away in `master_wine_library` — the shape 53 of production's 72 inventory
 * rows are actually in.
 */
function scheduleRow(over: Row = {}): Row {
  return {
    id: SCHEDULE,
    restaurant_id: "rest-1",
    inventory_id: INVENTORY,
    provider_id: PROVIDER,
    quantity: 5,
    unit_type: "case",
    bottles_per_unit: 12,
    target_price: 40,
    frequency: "weekly",
    frequency_day: null,
    // false: approveOrder reads the order back, which this harness does not
    // model; the approval-needed branch exercises the same calendar block.
    auto_approve: false,
    next_order_date: "2026-09-01",
    last_order_date: null,
    active: true,
    created_by: USER,
    notes: null,
    execution_count: 0,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    inventory: {
      wine_name: null,
      master_wine_library: { name: "Barolo Riserva" },
    },
    provider: { name: "Vinoteca Milano" },
    ...over,
  };
}

function service(db: DatabaseService, orchestrator: OrchestratorService) {
  return new RecurringOrdersService(
    db,
    new ProcurementService(db, events, ledger, orchestrator),
    orchestrator,
  );
}

/** Keys a payload names that `calendar_events` does not have. */
function phantomKeys(payload: Row): string[] {
  return Object.keys(payload).filter((k) => !CALENDAR_COLUMNS.has(k));
}

const template = {
  inventory_id: INVENTORY,
  provider_id: PROVIDER,
  quantity: 5,
  unit_type: "case",
  bottles_per_unit: 12,
  target_price: 40,
  frequency: "weekly" as const,
  auto_approve: false,
  next_order_date: "2026-09-07",
  active: true,
};

// ===========================================================================

describe("preCreateCalendarEvents — the rows can actually be written", () => {
  async function preCreate(over: Row = {}) {
    const orchestrator = makeOrchestrator();
    const { db, calls } = makeDb({
      insertedSchedule: scheduleRow(over),
      inventory: { wine_name: "Barolo Riserva" },
    });
    const row = await service(db, orchestrator).createRecurringOrder(
      "rest-1",
      USER,
      template,
    );
    return { calls, row };
  }

  it("names no column calendar_events does not have", async () => {
    // Pre-fix: every event carried `priority: "MEDIUM"` and a `tags` JSON
    // string. Neither is a column, so PostgREST rejected the whole bulk insert
    // and the calendar stayed empty — quietly, behind a warn.
    const { calls } = await preCreate();
    expect(calls.calendarInserts.length).toBeGreaterThan(0);
    for (const payload of calls.calendarInserts) {
      expect(phantomKeys(payload)).toEqual([]);
    }
  });

  it("writes `source`, which is NOT NULL with no default", async () => {
    const { calls } = await preCreate();
    for (const payload of calls.calendarInserts) {
      expect(payload.source).toBe("system_generated");
    }
  });

  it("uses the status vocabulary the table actually holds", async () => {
    // `SCHEDULED` has never existed in this table in any casing. `pending` is
    // the column default and 16 of the 19 real rows.
    const { calls } = await preCreate();
    for (const payload of calls.calendarInserts) {
      expect(payload.status).toBe("pending");
      expect(payload.status).not.toBe("SCHEDULED");
    }
  });

  it("links the event with a real uuid column, not a JSON blob", async () => {
    const { calls } = await preCreate();
    for (const payload of calls.calendarInserts) {
      expect(payload.recurring_order_id).toBe(SCHEDULE);
      expect(payload.provider_id).toBe(PROVIDER);
      expect(payload).not.toHaveProperty("tags");
    }
  });

  it("titles the event with the wine's real name, reached through the master library", async () => {
    // The single-hop embed returns null for 74% of production's inventory.
    // Falling back to the literal "Wine" put a fabricated subject on a diary
    // entry a human reads.
    const { calls } = await preCreate();
    expect(calls.calendarInserts[0].title).toContain("Barolo Riserva");
    expect(calls.calendarInserts[0].title).not.toContain("Wine (");
  });

  it("counts the event in the schedule's own unit, not 'units'", async () => {
    const { calls } = await preCreate();
    expect(calls.calendarInserts[0].title).toContain("5 cases");
  });

  it("reports a failed calendar write instead of returning a clean schedule", async () => {
    // The defect in one line: the schedule is created, the calendar is empty,
    // and the API answers 201 with no hint that half of it did not happen.
    const orchestrator = makeOrchestrator();
    const { db } = makeDb({
      insertedSchedule: scheduleRow(),
      inventory: { wine_name: "Barolo Riserva" },
      calendarInsertError: "PGRST204: column not found",
    });
    const row: any = await service(db, orchestrator).createRecurringOrder(
      "rest-1",
      USER,
      template,
    );
    expect(row.id).toBe(SCHEDULE);
    expect(row.calendar.written).toBe(0);
    expect(row.calendar.requested).toBeGreaterThan(0);
    expect(row.calendar.error).toContain("PGRST204");
  });

  it("still reports success when the calendar really was written", async () => {
    // Both directions. A test that only checks the failure passes against code
    // that reports failure unconditionally.
    const { row } = await preCreate();
    expect((row as any).calendar.error).toBeNull();
    expect((row as any).calendar.written).toBe((row as any).calendar.requested);
    expect((row as any).calendar.written).toBeGreaterThan(0);
  });
});

describe("executeRecurringOrder — the calendar is found by key, and updated", () => {
  async function execute(over: Row = {}, lookup: Row[] = [{ id: "evt-1" }]) {
    const orchestrator = makeOrchestrator();
    const { db, calls } = makeDb({
      dueSchedules: [scheduleRow(over)],
      insertedOrder,
      inventory: { wine_name: "Barolo Riserva" },
      calendarLookup: lookup,
    });
    await service(db, orchestrator).executeDueRecurringOrders();
    return { calls, orchestrator };
  }

  it("finds the pre-created event by recurring_order_id, never by a tags substring", async () => {
    const { calls } = await execute();
    const lookup = calls.calendarSelectFilters.find((f) =>
      f.some((x) => x.op === "eq" && x.column === "recurring_order_id"),
    );
    expect(lookup).toBeDefined();
    expect(lookup!.map((f) => f.column)).toContain("event_date");
    // The old query. `.like("tags", '%uuid%')` is a leading-wildcard scan that
    // no index can serve, against a column that does not exist.
    for (const chain of calls.calendarSelectFilters) {
      expect(chain.some((f) => f.op === "like")).toBe(false);
      expect(chain.some((f) => f.column === "tags")).toBe(false);
    }
  });

  it("filters on the status the pre-create actually wrote", async () => {
    const { calls } = await execute();
    const statuses = calls.calendarSelectFilters
      .flat()
      .filter((f) => f.column === "status")
      .map((f) => f.value);
    expect(statuses).toContain("pending");
    expect(statuses).not.toContain("SCHEDULED");
  });

  it("marks the event completed in lowercase and stamps the real order_id", async () => {
    const { calls } = await execute();
    expect(calls.calendarUpdates).toHaveLength(1);
    const update = calls.calendarUpdates[0];
    expect(update.status).toBe("completed");
    expect(update.status).not.toBe("COMPLETED");
    expect(update.order_id).toBe(ORDER);
    expect(phantomKeys(update)).toEqual([]);
  });

  it("writes a delivery event with every real column and no phantom one", async () => {
    const { calls } = await execute();
    const delivery = calls.calendarInserts.find(
      (e) => e.event_type === "delivery",
    );
    expect(delivery).toBeDefined();
    expect(phantomKeys(delivery!)).toEqual([]);
    expect(delivery!.source).toBe("system_generated");
    expect(delivery!.status).toBe("pending");
    expect(delivery!.order_id).toBe(ORDER);
    expect(delivery!.provider_id).toBe(PROVIDER);
    expect(delivery!.recurring_order_id).toBe(SCHEDULE);
  });

  it("does not fail the order when the calendar lookup finds nothing", async () => {
    // Non-negotiable: step 5 advances next_order_date. Throwing here would
    // leave the order placed and the schedule still due, and tomorrow's cron
    // would place it again.
    const { calls } = await execute({}, []);
    expect(calls.calendarUpdates).toHaveLength(0);
    const delivery = calls.calendarInserts.find(
      (e) => e.event_type === "delivery",
    );
    expect(delivery).toBeDefined();
  });
});

describe("sendRecurringOrderReminders — nothing fabricated, nothing silent", () => {
  const OLD_ENV = process.env[RECURRING_REMINDER_FLAG];
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env[RECURRING_REMINDER_FLAG];
    else process.env[RECURRING_REMINDER_FLAG] = OLD_ENV;
  });

  function arm(value = "true") {
    process.env[RECURRING_REMINDER_FLAG] = value;
  }

  it("is off unless the flag says true or 1, and reads no rows while off", async () => {
    // The gate PR #227 / ADR 0061 added to the OTHER recurring-order reminder.
    // Two crons telling the same person the same thing with different gating is
    // its own defect; this one was the ungated, unreviewed half.
    delete process.env[RECURRING_REMINDER_FLAG];
    const orchestrator = makeOrchestrator();
    const { db, calls } = makeDb({ dueSchedules: [scheduleRow()] });
    const out = await service(db, orchestrator).sendRecurringOrderReminders();

    expect(out.armed).toBe(false);
    expect(out.sent).toBe(0);
    expect(calls.scheduleQueries).toBe(0);
    expect(orchestrator.publishEvent).not.toHaveBeenCalled();

    for (const off of ["yes", "on", "TRUE ", "", "0", "false"]) {
      expect(
        recurringRemindersArmed({ [RECURRING_REMINDER_FLAG]: off } as any),
      ).toBe(off === "TRUE ");
    }
    expect(
      recurringRemindersArmed({ [RECURRING_REMINDER_FLAG]: "1" } as any),
    ).toBe(true);
  });

  it("never sends the word Unknown — it reaches the master library for the name", async () => {
    // 53 of production's 72 inventory rows have a NULL wine_name and every one
    // of them has a real name one hop further. `wine_name || "Unknown"` went
    // straight into a push + email TITLE.
    arm();
    const orchestrator = makeOrchestrator();
    const { db } = makeDb({ dueSchedules: [scheduleRow()] });
    const out = await service(db, orchestrator).sendRecurringOrderReminders();

    expect(out.sent).toBe(1);
    expect(out.sentUnnamed).toBe(0);
    const payload = (orchestrator.publishEvent as jest.Mock).mock.calls[0][2];
    expect(payload.wine_name).toBe("Barolo Riserva");
    expect(payload.message).not.toContain("Unknown");
    expect(payload.message).not.toContain("for wine ");
  });

  it("names the schedule by its id when no name is reachable at all", async () => {
    // The recipient gets something they can act on — the uuid every action
    // button in the notification already keys on — instead of a placeholder.
    arm();
    const orchestrator = makeOrchestrator();
    const { db } = makeDb({
      dueSchedules: [
        scheduleRow({
          inventory: { wine_name: null, master_wine_library: null },
        }),
      ],
    });
    const out = await service(db, orchestrator).sendRecurringOrderReminders();

    expect(out.sent).toBe(1);
    expect(out.sentUnnamed).toBe(1);
    const payload = (orchestrator.publishEvent as jest.Mock).mock.calls[0][2];
    expect(payload.wine_name).toBe(`schedule ${SCHEDULE}`);
    expect(payload.wine_name).not.toContain("Unknown");
  });

  it("sends the unit, frequency and provider the consumer would otherwise invent", async () => {
    // notification_agent.py:1766-1772 defaults a missing unit_type to
    // "bottles", a missing frequency to "scheduled" and a missing provider list
    // to ["Default provider"]. Omitting the keys is what activated all three.
    arm();
    const orchestrator = makeOrchestrator();
    const { db } = makeDb({ dueSchedules: [scheduleRow()] });
    await service(db, orchestrator).sendRecurringOrderReminders();

    const payload = (orchestrator.publishEvent as jest.Mock).mock.calls[0][2];
    expect(payload.unit_type).toBe("case");
    expect(payload.frequency).toBe("weekly");
    expect(payload.preferred_providers).toEqual(["Vinoteca Milano"]);
  });

  it("reports a failed query as a failure, not as 'no reminders due'", async () => {
    // Supabase returns {data, error} rather than throwing, so the pre-fix
    // try/catch was inert for exactly this case and it logged a warn and
    // returned void — indistinguishable from a quiet, healthy day.
    arm();
    const orchestrator = makeOrchestrator();
    const { db } = makeDb({
      dueSchedules: [scheduleRow()],
      scheduleQueryError: "57014 statement timeout",
    });
    const out = await service(db, orchestrator).sendRecurringOrderReminders();

    expect(out.queryFailed).toBe(true);
    expect(out.sent).toBe(0);
    expect(out.scanned).toBe(0);
    expect(orchestrator.publishEvent).not.toHaveBeenCalled();
  });

  it("counts a publish that threw, rather than logging it away", async () => {
    arm();
    const orchestrator = makeOrchestrator({ publishThrows: true });
    const { db } = makeDb({ dueSchedules: [scheduleRow()] });
    const out = await service(db, orchestrator).sendRecurringOrderReminders();

    expect(out.scanned).toBe(1);
    expect(out.sent).toBe(0);
    expect(out.failed).toBe(1);
    expect(out.queryFailed).toBe(false);
  });
});

describe("describeScheduleSubject", () => {
  it("prefers the real name and says so", () => {
    expect(
      describeScheduleSubject({ id: SCHEDULE, wine_name: "Chablis" }),
    ).toEqual({ label: "Chablis", resolved: true });
  });

  it("treats a blank name as no name", () => {
    // "   " is not a name, and rendering it produces a title with a hole in it.
    expect(describeScheduleSubject({ id: SCHEDULE, wine_name: "   " })).toEqual(
      { label: `schedule ${SCHEDULE}`, resolved: false },
    );
  });

  it("never returns a placeholder", () => {
    for (const v of [null, undefined, ""]) {
      const out = describeScheduleSubject({ id: SCHEDULE, wine_name: v });
      expect(out.resolved).toBe(false);
      expect(out.label).toContain(SCHEDULE);
      expect(out.label).not.toMatch(/unknown|^wine$|^—$/i);
    }
  });
});
