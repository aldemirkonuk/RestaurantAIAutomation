import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { ProvidersService } from "../providers/providers.service";
import { ProvidersController } from "../providers/providers.controller";
import { ProcurementService } from "./procurement.service";
import { removalSentence, settleRemovedVendorsOrders } from "./vendor-removal";

/**
 * Removing a vendor pauses its standing orders, keeps and counts its open
 * orders, and says so (r25 order-vendor-followups, QA round 3b H3).
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER_HOUSE = "22222222-2222-4222-8222-222222222222";
const VENDOR = "33333333-3333-4333-8333-333333333333";
const OTHER_VENDOR = "44444444-4444-4444-8444-444444444444";
const PERSON = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, any>;

/** An in-memory store that applies the filters the code sends. */
function makeStore(seed: Record<string, Row[]>, fail: Set<string> = new Set()) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const writes: Array<{ table: string; op: string; payload: any; filters: string[] }> = [];
  const client: any = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const said: string[] = [];
      let op: "select" | "update" | "insert" = "select";
      let payload: any = null;
      let head = false;
      const run = () => {
        if (fail.has(`${op}:${table}`)) {
          return { data: null, count: null, error: { message: "connection reset" } };
        }
        if (op === "insert") {
          writes.push({ table, op, payload, filters: said });
          const rows = Array.isArray(payload) ? payload : [payload];
          (tables[table] ??= []).push(...rows);
          return { data: rows, count: null, error: null };
        }
        const matched = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (op === "update") {
          writes.push({ table, op, payload, filters: said });
          for (const r of matched) Object.assign(r, payload);
        }
        return { data: head ? null : matched.map((r) => ({ ...r })), count: matched.length, error: null };
      };
      const q: any = {
        select: (_c?: string, o?: { head?: boolean }) => {
          head = Boolean(o?.head);
          return q;
        },
        update: (p: any) => ((op = "update"), (payload = p), q),
        insert: (p: any) => ((op = "insert"), (payload = p), q),
        eq: (c: string, v: unknown) => {
          said.push(`eq ${c}=${String(v)}`);
          filters.push((r) => r[c] === v);
          return q;
        },
        is: (c: string, v: unknown) => {
          filters.push((r) => (r[c] ?? null) === v);
          return q;
        },
        not: (c: string, o: string, v: any) => {
          said.push(`not ${c} ${o} ${String(v)}`);
          if (o === "in") {
            const list = String(v).replace(/[()]/g, "").split(",");
            filters.push((r) => !list.includes(r[c]));
          } else {
            filters.push((r) => (r[c] ?? null) !== v);
          }
          return q;
        },
        lte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          const { data, error } = run();
          return { data: (data ?? [])[0] ?? null, error };
        },
        single: async () => {
          const { data, error } = run();
          return { data: (data ?? [])[0] ?? null, error };
        },
        then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
      };
      return q;
    },
  };
  return { client, tables, writes };
}

function seed(): Record<string, Row[]> {
  const order = (id: string, over: Row) => ({
    id,
    restaurant_id: HOUSE,
    provider_id: VENDOR,
    status: "PENDING",
    recurrence_status: null,
    ...over,
  });
  return {
    providers: [
      { id: VENDOR, restaurant_id: HOUSE, name: "Kavaklidere", is_active: true, deleted_at: null },
      { id: OTHER_VENDOR, restaurant_id: HOUSE, name: "Other", is_active: true, deleted_at: null },
    ],
    procurement_orders: [
      order("o-active-1", { status: "APPROVED", recurrence_status: "active" }),
      order("o-active-2", { status: "COMPLETED", recurrence_status: "active" }),
      order("o-paused", { status: "COMPLETED", recurrence_status: "paused" }),
      order("o-ended", { status: "CANCELLED", recurrence_status: "ended" }),
      order("o-transit", { status: "IN_TRANSIT" }),
      order("o-delivered", { status: "DELIVERED" }),
      order("o-other-vendor", { provider_id: OTHER_VENDOR, recurrence_status: "active" }),
      order("o-other-house", { restaurant_id: OTHER_HOUSE, recurrence_status: "active" }),
    ],
    recurring_orders: [
      { id: "s-on", restaurant_id: HOUSE, provider_id: VENDOR, active: true },
      { id: "s-off", restaurant_id: HOUSE, provider_id: VENDOR, active: false },
      { id: "s-other-vendor", restaurant_id: HOUSE, provider_id: OTHER_VENDOR, active: true },
      { id: "s-other-house", restaurant_id: OTHER_HOUSE, provider_id: VENDOR, active: true },
    ],
    system_audit_log: [],
  };
}

const status = (t: Record<string, Row[]>, id: string) =>
  t.procurement_orders.find((r) => r.id === id)?.recurrence_status;

describe("settleRemovedVendorsOrders", () => {
  it("pauses only this vendor's active order recurrences in this house, naming who and when", async () => {
    const s = makeStore(seed());
    const out = await settleRemovedVendorsOrders(s.client, HOUSE, VENDOR, PERSON);
    expect(out.standingOrdersPaused).toBe(2);
    expect(status(s.tables, "o-active-1")).toBe("paused");
    expect(status(s.tables, "o-active-2")).toBe("paused");
    expect(status(s.tables, "o-ended")).toBe("ended");
    expect(status(s.tables, "o-other-vendor")).toBe("active");
    expect(status(s.tables, "o-other-house")).toBe("active");
    const paused = s.tables.procurement_orders.find((r) => r.id === "o-active-1")!;
    expect(paused.recurrence_status_by).toBe(PERSON);
    expect(typeof paused.recurrence_status_at).toBe("string");
  });

  it("files one audit row per paused series, as a person's pause", async () => {
    const s = makeStore(seed());
    await settleRemovedVendorsOrders(s.client, HOUSE, VENDOR, PERSON);
    const audit = s.tables.system_audit_log;
    expect(audit.map((r) => r.entity_id).sort()).toEqual(["o-active-1", "o-active-2"]);
    expect(audit[0]).toMatchObject({
      actor_type: "user",
      actor_id: PERSON,
      action: "order_recurrence_paused",
      restaurant_id: HOUSE,
      changes: { from: "active", to: "paused", detail: { cause: "vendor_removed", providerId: VENDOR } },
    });
  });

  it("records no person for an actor that is not a user id", async () => {
    const s = makeStore(seed());
    await settleRemovedVendorsOrders(s.client, HOUSE, VENDOR, "system");
    expect(s.tables.procurement_orders.find((r) => r.id === "o-active-1")!.recurrence_status_by).toBeNull();
    expect(s.tables.system_audit_log[0]).toMatchObject({ actor_type: "system", actor_id: null });
  });

  it("switches off only this vendor's running legacy schedules in this house", async () => {
    const s = makeStore(seed());
    const out = await settleRemovedVendorsOrders(s.client, HOUSE, VENDOR, PERSON);
    expect(out.schedulesPaused).toBe(1);
    const active = Object.fromEntries(s.tables.recurring_orders.map((r) => [r.id, r.active]));
    expect(active).toEqual({ "s-on": false, "s-off": false, "s-other-vendor": true, "s-other-house": true });
  });

  it("counts this vendor's orders not delivered or closed, and changes none of them", async () => {
    const s = makeStore(seed());
    const before = s.tables.procurement_orders.map((r) => r.status);
    const out = await settleRemovedVendorsOrders(s.client, HOUSE, VENDOR, PERSON);
    // o-active-1 (APPROVED) and o-transit (IN_TRANSIT); DELIVERED, COMPLETED and CANCELLED are closed.
    expect(out.openOrders).toBe(2);
    expect(s.tables.procurement_orders.map((r) => r.status)).toEqual(before);
    expect(s.writes.some((w) => w.table === "procurement_orders" && "status" in w.payload)).toBe(false);
  });

  it("says what happened in one sentence", async () => {
    const s = makeStore(seed());
    const out = await settleRemovedVendorsOrders(s.client, HOUSE, VENDOR, PERSON);
    expect(out.message).toBe(
      "The vendor was removed. No new order can be placed with them. 3 standing orders were paused. " +
        "2 open orders stay on Orders. You can still write to them about an order already placed.",
    );
  });

  it.each([
    ["update:procurement_orders", "standingOrdersPaused"],
    ["update:recurring_orders", "schedulesPaused"],
    ["select:procurement_orders", "openOrders"],
  ])("a failed %s is null, not zero, does not throw, and the sentence says so", async (failing, key) => {
    const s = makeStore(seed(), new Set([failing]));
    const error = jest.fn();
    const out: any = await settleRemovedVendorsOrders(s.client, HOUSE, VENDOR, PERSON, { error });
    expect(out[key]).toBeNull();
    expect(error).toHaveBeenCalled();
    expect(out.message).toMatch(/could not (all be paused|be counted) just now/);
  });
});

describe("removalSentence", () => {
  it("says only the removal when there was nothing standing and nothing open", () => {
    expect(removalSentence(0, 0, 0)).toBe("The vendor was removed. No new order can be placed with them.");
  });
  it("is singular for one", () => {
    expect(removalSentence(1, 0, 1)).toContain("1 standing order was paused. 1 open order stays on Orders.");
  });
  it("adds both kinds of standing order together", () => {
    expect(removalSentence(2, 3, 0)).toContain("5 standing orders were paused.");
  });
});

function providers(s: ReturnType<typeof makeStore>) {
  const db = { supabase: s.client } as unknown as DatabaseService;
  const events = { createEvent: jest.fn().mockResolvedValue({}) } as unknown as EventsService;
  return new ProvidersService(db, events, {} as ProcurementService);
}

describe("removing a vendor on /vendors", () => {
  it("removes it, then pauses its standing orders, and returns what happened", async () => {
    const s = makeStore(seed());
    const out = await providers(s).softDeleteProvider(VENDOR, HOUSE, PERSON);
    const v = s.tables.providers.find((r) => r.id === VENDOR)!;
    expect(v.is_active).toBe(false);
    expect(v.deleted_at).toEqual(expect.any(String));
    expect(out).toMatchObject({ standingOrdersPaused: 2, schedulesPaused: 1, openOrders: 2 });
    // The removal is written before anything is paused.
    const firstWrite = s.writes.findIndex((w) => w.table === "providers");
    const firstPause = s.writes.findIndex((w) => w.table === "procurement_orders");
    expect(firstWrite).toBeLessThan(firstPause);
  });

  it("pauses nothing when the vendor is not this house's", async () => {
    const s = makeStore(seed());
    await expect(providers(s).softDeleteProvider(VENDOR, OTHER_HOUSE, PERSON)).rejects.toThrow();
    expect(status(s.tables, "o-active-1")).toBe("active");
  });

  it("DELETE /providers/:id answers with the outcome and its sentence", async () => {
    const softDeleteProvider = jest.fn().mockResolvedValue({
      standingOrdersPaused: 1,
      schedulesPaused: 0,
      openOrders: 0,
      message: "m",
    });
    const controller = new (ProvidersController as any)({ softDeleteProvider });
    const res = await controller.deleteProvider(VENDOR, { userId: PERSON, restaurantId: HOUSE });
    expect(res).toEqual({ success: true, standingOrdersPaused: 1, schedulesPaused: 0, openOrders: 0, message: "m" });
    expect(softDeleteProvider).toHaveBeenCalledWith(VENDOR, HOUSE, PERSON);
  });

  it("switching a vendor off pauses its standing orders too", async () => {
    const s = makeStore(seed());
    await providers(s).updateProvider(VENDOR, { isActive: false } as any, HOUSE, PERSON);
    expect(status(s.tables, "o-active-1")).toBe("paused");
    expect(s.tables.recurring_orders.find((r) => r.id === "s-on")!.active).toBe(false);
  });

  it("switching a vendor on, or any other edit, resumes and pauses nothing", async () => {
    const s = makeStore(seed());
    await providers(s).updateProvider(VENDOR, { isActive: true, name: "K" } as any, HOUSE, PERSON);
    expect(status(s.tables, "o-active-1")).toBe("active");
    expect(s.tables.recurring_orders.find((r) => r.id === "s-on")!.active).toBe(true);
  });
});
