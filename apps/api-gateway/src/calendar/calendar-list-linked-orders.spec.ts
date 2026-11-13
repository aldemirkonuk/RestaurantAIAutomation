/**
 * The calendar rules a delivery off when its linked order has arrived. The web
 * used to learn that from the orders book's newest 50 orders, so any delivery
 * linked to an older order read "order not in the book" and never ruled off.
 *
 * `withOrders=true` makes the list carry the orders its own rows link to, read
 * from this house only. Pinned here:
 *  - exactly the linked ids are read, scoped to the house, deduplicated;
 *  - a failed orders read keeps the events and says the book is unreadable;
 *  - callers that did not ask get the old shape, and no orders read at all;
 *  - pages break start-date ties by id, so a window read page by page is whole.
 */
import { CalendarService } from "./calendar.service";

type Call = { method: string; args: unknown[] };

function fakeDb(
  tables: Record<string, { data: unknown; error: unknown; count?: number }>,
) {
  const calls: Record<string, Call[]> = {};
  const builder = (table: string) => {
    const log: Call[] = (calls[table] = calls[table] ?? []);
    const answer = tables[table] ?? { data: [], error: null };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "is", "in", "or", "order", "range"]) {
      b[m] = (...args: unknown[]) => {
        log.push({ method: m, args });
        return b;
      };
    }
    b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve({ count: answer.count ?? null, ...answer }).then(resolve, reject);
    return b;
  };
  return { supabase: { from: builder }, calls };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "ev-1",
  restaurant_id: "r-1",
  provider_id: null,
  order_id: null,
  title: "Produce delivery",
  description: null,
  event_type: "delivery",
  start_date: "2026-09-03",
  end_date: null,
  all_day: true,
  start_time: null,
  end_time: null,
  color: null,
  source: "manual",
  status: "pending",
  reminder_enabled: true,
  reminder_days_before: 1,
  reminder_sent: false,
  is_recurring: false,
  parent_event_id: null,
  occurrence_date: null,
  recurrence_rule_id: null,
  created_by: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  ...over,
});

function service(db: ReturnType<typeof fakeDb>) {
  return new CalendarService(db as never, {} as never);
}

const window = { startDate: "2026-09-01", endDate: "2026-09-30" };

describe("CalendarService.listEvents — linked orders (withOrders)", () => {
  it("reads exactly the linked orders, from this house only, once each", async () => {
    const db = fakeDb({
      calendar_events: {
        data: [
          row({ id: "ev-1", order_id: "o-old" }),
          row({ id: "ev-2", order_id: "o-old" }),
          row({ id: "ev-3", order_id: "o-new" }),
          row({ id: "ev-4" }),
        ],
        error: null,
        count: 4,
      },
      procurement_orders: {
        data: [
          { id: "o-old", order_number: "PO-0007", status: "DELIVERED" },
          { id: "o-new", order_number: null, status: "IN_TRANSIT" },
        ],
        error: null,
      },
    });
    const out = await service(db).listEvents("r-1", { ...window, withOrders: true });

    expect(out.linkedOrdersReadable).toBe(true);
    expect(out.linkedOrders).toEqual([
      { id: "o-old", orderNumber: "PO-0007", status: "DELIVERED" },
      { id: "o-new", orderNumber: null, status: "IN_TRANSIT" },
    ]);
    const oc = db.calls.procurement_orders;
    expect(oc).toContainEqual({ method: "eq", args: ["restaurant_id", "r-1"] });
    expect(oc).toContainEqual({ method: "in", args: ["id", ["o-old", "o-new"]] });
    expect(oc.filter((c) => c.method === "in")).toHaveLength(1);
  });

  it("reads more than a hundred linked orders in chunks, never one oversized list", async () => {
    const rows = Array.from({ length: 230 }, (_, i) =>
      row({ id: `ev-${i}`, order_id: `o-${i}` }),
    );
    const db = fakeDb({
      calendar_events: { data: rows, error: null, count: rows.length },
      procurement_orders: { data: [], error: null },
    });
    await service(db).listEvents("r-1", { ...window, withOrders: true, limit: 500 });
    const ins = db.calls.procurement_orders.filter((c) => c.method === "in");
    expect(ins.map((c) => (c.args[1] as string[]).length)).toEqual([100, 100, 30]);
    const asked = ins.flatMap((c) => c.args[1] as string[]);
    expect(new Set(asked).size).toBe(230);
  });

  it("keeps the events when the orders book cannot be read, and says so", async () => {
    const db = fakeDb({
      calendar_events: {
        data: [row({ order_id: "o-1" })],
        error: null,
        count: 1,
      },
      procurement_orders: { data: null, error: { message: "orders offline" } },
    });
    const out = await service(db).listEvents("r-1", { ...window, withOrders: true });
    expect(out.events).toHaveLength(1);
    expect(out.linkedOrdersReadable).toBe(false);
    expect(out.linkedOrders).toEqual([]);
  });

  it("asks the orders book nothing when no row links an order", async () => {
    const db = fakeDb({
      calendar_events: { data: [row()], error: null, count: 1 },
    });
    const out = await service(db).listEvents("r-1", { ...window, withOrders: true });
    expect(db.calls.procurement_orders).toBeUndefined();
    expect(out.linkedOrders).toEqual([]);
    expect(out.linkedOrdersReadable).toBe(true);
  });

  it("leaves callers that did not ask with the old shape and no orders read", async () => {
    const db = fakeDb({
      calendar_events: { data: [row({ order_id: "o-1" })], error: null, count: 1 },
    });
    const out = await service(db).listEvents("r-1", window);
    expect(db.calls.procurement_orders).toBeUndefined();
    expect(out).not.toHaveProperty("linkedOrders");
    expect(out).not.toHaveProperty("linkedOrdersReadable");
  });

  it("breaks start-date ties by id so a window read page by page is whole", async () => {
    const db = fakeDb({ calendar_events: { data: [], error: null, count: 0 } });
    await service(db).listEvents("r-1", { ...window, page: 2, limit: 500 });
    const orders = db.calls.calendar_events.filter((c) => c.method === "order");
    expect(orders).toEqual([
      { method: "order", args: ["start_date", { ascending: true }] },
      { method: "order", args: ["id", { ascending: true }] },
    ]);
    expect(db.calls.calendar_events).toContainEqual({ method: "range", args: [500, 999] });
  });
});
