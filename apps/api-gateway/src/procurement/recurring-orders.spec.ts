import { RecurringOrdersService } from "./recurring-orders.service";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";

/**
 * A standing order that can actually be materialised.
 *
 * WHAT WAS BROKEN, VERIFIED AGAINST PRODUCTION 2026-09-01
 *
 * `RecurringOrderRow` declared eight columns `recurring_orders` did not have —
 * inventory_id, provider_id, wine_name, target_price, created_by, notes,
 * last_executed_at, execution_count — and `createRecurringOrder` inserted seven
 * of them while omitting `unit_type`, which is NOT NULL with no default. So
 * every create failed twice over, and the table held 0 rows. That zero is the
 * symptom, not a coincidence.
 *
 * `executeRecurringOrder` then read `.inventory_id` and `.provider_id` off a row
 * that had neither and handed both to `createOrder`, whose `procurement_orders`
 * columns are `uuid NOT NULL`. The 8 AM cron has never produced an order.
 *
 * `calculateNextOrderDate` had a `default:` arm returning +1 month. `daily` —
 * offered by the DB's own CHECK and by the web form — fell through it, so a
 * daily schedule would have re-ordered monthly and said nothing.
 */

type Row = Record<string, any>;

interface Calls {
  scheduleInserts: Row[];
  scheduleUpdates: Row[];
  orderInserts: Row[];
  calendarInserts: Row[];
}

function makeDb(opts: {
  dueSchedules?: Row[];
  storedSchedule?: Row | null;
  insertedSchedule?: Row;
  insertedOrder?: Row;
  inventory?: Row | null;
}) {
  const calls: Calls = {
    scheduleInserts: [],
    scheduleUpdates: [],
    orderInserts: [],
    calendarInserts: [],
  };

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";

      const settle = (shape: "one" | "many") => {
        if (table === "providers") return { data: null, count: 1, error: null };
        if (table === "restaurant_inventory")
          return { data: opts.inventory ?? null, error: null };
        if (table === "procurement_orders")
          return {
            data: op === "insert" ? (opts.insertedOrder ?? null) : null,
            error: null,
          };
        if (table === "recurring_orders") {
          if (op === "insert")
            return { data: opts.insertedSchedule ?? null, error: null };
          if (shape === "one")
            return { data: opts.storedSchedule ?? null, error: null };
          return { data: opts.dueSchedules ?? [], error: null };
        }
        return { data: shape === "many" ? [] : null, error: null };
      };

      const q: any = {
        select: () => q,
        eq: () => q,
        neq: () => q,
        not: () => q,
        in: () => q,
        is: () => q,
        gt: () => q,
        lte: () => q,
        like: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        insert(payload: Row) {
          op = "insert";
          if (table === "recurring_orders") calls.scheduleInserts.push(payload);
          if (table === "procurement_orders") calls.orderInserts.push(payload);
          if (table === "calendar_events")
            calls.calendarInserts.push(
              ...(Array.isArray(payload) ? payload : [payload]),
            );
          return q;
        },
        update(payload: Row) {
          op = "update";
          if (table === "recurring_orders") calls.scheduleUpdates.push(payload);
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
const orchestrator = {
  publishEvent: jest.fn().mockResolvedValue({}),
  triggerDraftHttp: jest.fn().mockResolvedValue({}),
} as unknown as OrchestratorService;

const MASTER_WINE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SCHEDULE = "33333333-3333-4333-8333-333333333333";
const INVENTORY = "55555555-5555-4555-8555-555555555555";
const PROVIDER = "66666666-6666-4666-8666-666666666666";

const inventoryRow = {
  master_wine_id: MASTER_WINE,
  wine_name: "Barolo Riserva",
  sku: "INT-9001",
  master_wine_library: {
    name: "Barolo Riserva",
    producer: "Giacomo Conterno",
    vintage: 2016,
  },
};

const insertedOrder = {
  id: "44444444-4444-4444-8444-444444444444",
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

/** A row as the table is AFTER 20260901180000_recurring_orders_shape.sql. */
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
    auto_approve: false,
    next_order_date: "2026-09-01",
    last_order_date: null,
    active: true,
    created_by: USER,
    notes: null,
    execution_count: 3,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    inventory: { wine_name: "Barolo Riserva" },
    ...over,
  };
}

/**
 * Every column `recurring_orders` has after the migration in this change.
 * Taken from production's information_schema on 2026-09-01 plus
 * 20260901150000 (bottles_per_unit) and 20260901180000 (the six added here).
 */
const RECURRING_COLUMNS = new Set([
  "id",
  "restaurant_id",
  "wine_id",
  "quantity",
  "unit_type",
  "frequency",
  "frequency_day",
  "preferred_providers",
  "auto_approve",
  "next_order_date",
  "last_order_date",
  "active",
  "created_at",
  "updated_at",
  "bottles_per_unit",
  "inventory_id",
  "provider_id",
  "target_price",
  "created_by",
  "notes",
  "execution_count",
]);

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

function service(db: DatabaseService) {
  return new RecurringOrdersService(
    db,
    new ProcurementService(db, events, ledger, orchestrator),
    orchestrator,
  );
}

describe("createRecurringOrder — the insert can actually succeed", () => {
  it("names no column recurring_orders does not have", async () => {
    // The pre-fix payload carried wine_name, target_price, created_by, notes,
    // execution_count, inventory_id and provider_id against a table that had
    // none of them. PostgREST answers PGRST204 and the create 500s.
    const { db, calls } = makeDb({
      insertedSchedule: scheduleRow(),
      inventory: inventoryRow,
    });
    await service(db).createRecurringOrder("rest-1", USER, template);

    expect(calls.scheduleInserts).toHaveLength(1);
    const unknown = Object.keys(calls.scheduleInserts[0]).filter(
      (k) => !RECURRING_COLUMNS.has(k),
    );
    expect(unknown).toEqual([]);
    expect(calls.scheduleInserts[0]).not.toHaveProperty("wine_name");
  });

  it("writes unit_type, which is NOT NULL and was never written at all", async () => {
    const { db, calls } = makeDb({
      insertedSchedule: scheduleRow(),
      inventory: inventoryRow,
    });
    await service(db).createRecurringOrder("rest-1", USER, template);

    // Canonical singular, so the widened CHECK accepts it and it can be handed
    // straight to createOrder.
    expect(calls.scheduleInserts[0].unit_type).toBe("case");
    expect(calls.scheduleInserts[0].bottles_per_unit).toBe(12);
  });

  it("refuses a case schedule with no pack size, and writes nothing", async () => {
    // Accepting it would create a schedule the 8 AM cron is refused on every
    // morning forever — a silent bug traded for a loud one with no fix.
    const { db, calls } = makeDb({
      insertedSchedule: scheduleRow(),
      inventory: inventoryRow,
    });
    await expect(
      service(db).createRecurringOrder("rest-1", USER, {
        ...template,
        bottles_per_unit: undefined,
      }),
    ).rejects.toThrow(/needs bottlesPerUnit/);
    expect(calls.scheduleInserts).toHaveLength(0);
  });

  it("does not try to store a non-uuid actor in a uuid column", async () => {
    // The controller's old default was the literal string "system", and
    // recurring_orders.created_by now has an FK to public.users(user_id).
    // Writing "system" is a 22P02 that takes the whole create down.
    //
    // Both halves: a real uuid must still be stored, or this passes against
    // code that nulls every actor.
    const good = makeDb({
      insertedSchedule: scheduleRow(),
      inventory: inventoryRow,
    });
    await service(good.db).createRecurringOrder("rest-1", USER, template);
    expect(good.calls.scheduleInserts[0].created_by).toBe(USER);

    const bad = makeDb({
      insertedSchedule: scheduleRow(),
      inventory: inventoryRow,
    });
    await service(bad.db).createRecurringOrder("rest-1", "system", template);
    expect(bad.calls.scheduleInserts[0].created_by).toBeNull();
  });

  it("projects wine_name from inventory rather than storing a second copy", async () => {
    const { db } = makeDb({
      insertedSchedule: scheduleRow(),
      inventory: inventoryRow,
    });
    const row = await service(db).createRecurringOrder(
      "rest-1",
      USER,
      template,
    );
    expect(row.wine_name).toBe("Barolo Riserva");
    expect(row).not.toHaveProperty("inventory");
  });
});

describe("executeDueRecurringOrders — the cron finally produces an order", () => {
  it("carries inventory_id and provider_id through to the order", async () => {
    // Pre-fix both were `undefined` on every materialisation, against two
    // `uuid NOT NULL` columns. The cron has never produced an order.
    const { db, calls } = makeDb({
      dueSchedules: [scheduleRow()],
      insertedOrder,
      inventory: inventoryRow,
    });
    await service(db).executeDueRecurringOrders();

    expect(calls.orderInserts).toHaveLength(1);
    expect(calls.orderInserts[0].inventory_id).toBe(INVENTORY);
    expect(calls.orderInserts[0].provider_id).toBe(PROVIDER);
    expect(calls.orderInserts[0].source).toBe("recurring");
    expect(calls.orderInserts[0].recurring_order_id).toBe(SCHEDULE);
  });

  it("books five cases of twelve as sixty bottles", async () => {
    const { db, calls } = makeDb({
      dueSchedules: [scheduleRow()],
      insertedOrder,
      inventory: inventoryRow,
    });
    await service(db).executeDueRecurringOrders();
    expect(calls.orderInserts[0].bottles_total).toBe(60);
    expect(calls.orderInserts[0].unit_type).toBe("case");
  });

  it("carries the schedule's note onto the order it creates", async () => {
    // `notes` had no reader anywhere before this — written on create and never
    // looked at again.
    const { db, calls } = makeDb({
      dueSchedules: [
        scheduleRow({ notes: "Ask for the 2019 if they have it" }),
      ],
      insertedOrder,
      inventory: inventoryRow,
    });
    await service(db).executeDueRecurringOrders();
    expect(calls.orderInserts[0].manager_notes).toContain(
      "Ask for the 2019 if they have it",
    );
    expect(calls.orderInserts[0].manager_notes).toContain("recurring order");
  });

  it("stamps last_order_date, not the last_executed_at that never existed", async () => {
    const { db, calls } = makeDb({
      dueSchedules: [scheduleRow()],
      insertedOrder,
      inventory: inventoryRow,
    });
    await service(db).executeDueRecurringOrders();

    const update = calls.scheduleUpdates.at(-1)!;
    expect(update).not.toHaveProperty("last_executed_at");
    expect(update.last_order_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(update.execution_count).toBe(4);
    const unknown = Object.keys(update).filter(
      (k) => !RECURRING_COLUMNS.has(k),
    );
    expect(unknown).toEqual([]);
  });
});

describe("the schedule interval is the one the operator chose", () => {
  async function nextDateFor(frequency: string, from = "2026-09-01") {
    const { db, calls } = makeDb({
      dueSchedules: [scheduleRow({ frequency, next_order_date: from })],
      insertedOrder,
      inventory: inventoryRow,
    });
    await service(db).executeDueRecurringOrders();
    return calls.scheduleUpdates.at(-1)?.next_order_date;
  }

  it("runs a daily schedule daily, not monthly", async () => {
    // The pre-fix `default:` arm returned +1 month for `daily`, which the
    // database CHECK and the web form both offer. A schedule set to run every
    // day would have run twelve times a year.
    expect(await nextDateFor("daily")).toBe("2026-09-02");
  });

  it("still runs weekly, biweekly, monthly and quarterly correctly", async () => {
    expect(await nextDateFor("weekly")).toBe("2026-09-08");
    expect(await nextDateFor("biweekly")).toBe("2026-09-15");
    expect(await nextDateFor("monthly")).toBe("2026-10-01");
    // Un-insertable before this change: the CHECK did not list it, though the
    // TypeScript type and this switch both did.
    expect(await nextDateFor("quarterly")).toBe("2026-12-01");
  });

  it("clamps a month-end date instead of overflowing into the next month", async () => {
    // Two bugs in one line, and the second only appears west of Greenwich.
    // `new Date("2026-01-31")` is UTC midnight while every setter is LOCAL, so
    // in a negative-offset zone the date read back as 30 January; and
    // `setMonth(+1)` on the 31st asks for 31 February, which JavaScript rolls
    // forward rather than clamping. A monthly schedule drifted later every
    // month, correctly in Railway's UTC and wrongly on any laptop — the worst
    // possible shape for a scheduling bug.
    expect(await nextDateFor("monthly", "2026-01-31")).toBe("2026-02-28");
    expect(await nextDateFor("monthly", "2026-08-31")).toBe("2026-09-30");
    expect(await nextDateFor("quarterly", "2026-11-30")).toBe("2027-02-28");
    // A plain year boundary, which the month arithmetic has to carry.
    expect(await nextDateFor("monthly", "2026-12-15")).toBe("2027-01-15");
  });

  it("refuses an unknown frequency instead of quietly making it monthly", async () => {
    const { db, calls } = makeDb({
      dueSchedules: [scheduleRow({ frequency: "fortnightly" })],
      insertedOrder,
      inventory: inventoryRow,
    });
    // executeDueRecurringOrders catches per row, so one bad schedule is logged
    // and skipped rather than taking the whole cron down — but its date is NOT
    // advanced to a guess.
    await service(db).executeDueRecurringOrders();
    const advanced = calls.scheduleUpdates.filter((u) => u.next_order_date);
    expect(advanced).toHaveLength(0);
  });
});

describe("updateRecurringOrder — an allow-list, not a spread", () => {
  it("drops a field the table has never had instead of failing the statement", async () => {
    // `RecurringOrders.tsx:182` PUTs `{ manager_override_price }`. The old
    // `{...updates}` spread sent it straight into the UPDATE, where it failed
    // the whole statement with a 42703 — so `active` toggles sharing that path
    // failed too.
    //
    // Both halves: a legitimate field must still get through.
    const { db, calls } = makeDb({
      storedSchedule: scheduleRow(),
      insertedSchedule: scheduleRow(),
      inventory: inventoryRow,
    });
    await service(db).updateRecurringOrder("rest-1", SCHEDULE, {
      active: false,
      manager_override_price: 31.5,
    } as any);

    const patch = calls.scheduleUpdates[0];
    expect(patch.active).toBe(false);
    expect(patch).not.toHaveProperty("manager_override_price");
    const unknown = Object.keys(patch).filter((k) => !RECURRING_COLUMNS.has(k));
    expect(unknown).toEqual([]);
  });

  it("cannot be used to move a schedule between tenants", async () => {
    const { db, calls } = makeDb({
      storedSchedule: scheduleRow(),
      insertedSchedule: scheduleRow(),
      inventory: inventoryRow,
    });
    await service(db).updateRecurringOrder("rest-1", SCHEDULE, {
      restaurant_id: "rest-2",
      notes: "moved",
    } as any);
    expect(calls.scheduleUpdates[0]).not.toHaveProperty("restaurant_id");
    expect(calls.scheduleUpdates[0].notes).toBe("moved");
  });

  it("re-resolves the pack size when only the unit changes", async () => {
    // Switching a bottle schedule to cases without restating the pack size
    // would otherwise keep bottles_per_unit = 1 and book a twelfth of the
    // delivery.
    const { db } = makeDb({
      storedSchedule: scheduleRow({ unit_type: "bottle", bottles_per_unit: 1 }),
      insertedSchedule: scheduleRow(),
      inventory: inventoryRow,
    });
    await expect(
      service(db).updateRecurringOrder("rest-1", SCHEDULE, {
        unit_type: "case",
      } as any),
    ).rejects.toThrow(/needs bottlesPerUnit/);
  });
});
