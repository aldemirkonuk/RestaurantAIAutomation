/**
 * Creating a calendar entry refuses what the calendar could never draw or
 * trust, in a sentence, and never leaves half an entry behind (QA round 4):
 *  - B6: a repeat that could not be saved used to leave a one-off behind and
 *    still answer 201, so "every Tuesday" existed for one Tuesday;
 *  - B9: an end day before the start day was saved and then never drawn;
 *        "25:99" was a valid time;
 *  - IMPROVE 6: a vendor or order from another house could be linked.
 */
import { BadRequestException, HttpException, ValidationPipe } from "@nestjs/common";
import { CalendarService, linkedOrderMovedEntry } from "./calendar.service";
import { CalendarController } from "./calendar.controller";
import {
  CalendarEventType,
  CreateCalendarEventDto,
  RecurrenceEndType,
  RecurrenceFrequency,
  UpdateCalendarEventDto,
} from "./dto/calendar.dto";

type Answer = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

/**
 * Each table answers from its own queue, one answer per awaited chain, so a
 * test says exactly what the house's tables hold.
 */
function fakeDb(answers: Record<string, Answer[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "delete", "eq", "in", "is"]) {
      b[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return b;
      };
    }
    const next = () => {
      const q = answers[table] ?? [];
      return Promise.resolve(q.length ? q.shift()! : { data: null, error: null });
    };
    b.single = () => next();
    b.maybeSingle = () => next();
    b.then = (res: (v: unknown) => void, rej: (e: unknown) => void) => next().then(res, rej);
    return b;
  };
  return { supabase: { from, rpc: async () => ({ data: 0, error: null }) }, calls };
}

const R = "r-1";
const eventRow = {
  id: "ev-1",
  restaurant_id: R,
  title: "Fish",
  event_type: "delivery",
  start_date: "2026-09-03",
  is_recurring: false,
  source: "manual",
  status: "pending",
  reminder_enabled: true,
  reminder_days_before: 1,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

function service(db: ReturnType<typeof fakeDb>) {
  return new CalendarService(db as never, { createEvent: async () => ({}) } as never);
}

const base: CreateCalendarEventDto = {
  title: "Fish",
  eventType: CalendarEventType.DELIVERY,
  eventDate: "2026-09-03",
};

const weekly = {
  frequency: RecurrenceFrequency.WEEKLY,
  interval: 1,
  daysOfWeek: [2],
  endType: RecurrenceEndType.NEVER,
};

describe("CalendarService.createEvent — refusals", () => {
  it("refuses an entry that ends on a day before it starts, writing nothing", async () => {
    const db = fakeDb({});
    await expect(
      service(db).createEvent(R, "u-1", { ...base, eventDateEnd: "2026-09-02" }),
    ).rejects.toThrow(new BadRequestException("An entry cannot end before the day it starts."));
    expect(db.calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("accepts an entry that ends on the day it starts", async () => {
    const db = fakeDb({ calendar_events: [{ data: eventRow, error: null }] });
    await expect(
      service(db).createEvent(R, "u-1", { ...base, eventDateEnd: "2026-09-03" }),
    ).resolves.toMatchObject({ id: "ev-1" });
  });

  it("refuses a vendor from another house, checked against this house only", async () => {
    const db = fakeDb({ providers: [{ data: null, error: null }] });
    await expect(
      service(db).createEvent(R, "u-1", { ...base, providerId: "pv-elsewhere" }),
    ).rejects.toThrow("That vendor is not in this house's vendor book.");
    expect(db.calls).toContainEqual({ table: "providers", method: "eq", args: ["restaurant_id", R] });
    expect(db.calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("refuses an order from another house", async () => {
    const db = fakeDb({ procurement_orders: [{ data: null, error: null }] });
    await expect(
      service(db).createEvent(R, "u-1", { ...base, orderId: "o-elsewhere" }),
    ).rejects.toThrow("That order is not in this house's orders book.");
    expect(db.calls).toContainEqual({ table: "procurement_orders", method: "eq", args: ["restaurant_id", R] });
  });

  it("creates the entry when its vendor and order are this house's", async () => {
    const db = fakeDb({
      providers: [{ data: { id: "pv-1" }, error: null }],
      procurement_orders: [{ data: { id: "o-1" }, error: null }],
      calendar_events: [{ data: { ...eventRow, provider_id: "pv-1", order_id: "o-1" }, error: null }],
    });
    const out = await service(db).createEvent(R, "u-1", { ...base, providerId: "pv-1", orderId: "o-1" });
    expect(out).toMatchObject({ providerId: "pv-1", orderId: "o-1" });
  });

  // r29 walk, finding 3: the table's insert trigger (ADR 0284) files a
  // delivery whose order has already arrived on the day it arrived, ruled off.
  // The insert's own RETURNING row predates that, so the answer used to say
  // the typed date and "pending" over a row stored otherwise.
  it("a delivery linked to an arrived order answers the stored row and says the order moved it", async () => {
    const sent = { ...eventRow, start_date: "2026-11-16", order_id: "o-1" };
    const db = fakeDb({
      procurement_orders: [{ data: { id: "o-1" }, error: null }],
      calendar_events: [
        { data: sent, error: null },
        { data: { ...sent, start_date: "2026-10-15", status: "completed", reminder_enabled: false }, error: null },
      ],
    });
    const out = await service(db).createEvent(R, "u-1", { ...base, eventDate: "2026-11-16", orderId: "o-1" });
    expect(out).toMatchObject({ eventDate: "2026-10-15", status: "completed", reminderEnabled: false });
    expect(out.notice).toBe(
      "Its order has already arrived, so this delivery is on 2026-10-15, the day it arrived, not 2026-11-16, and it is ruled off.",
    );
    expect(db.calls).toContainEqual({ table: "calendar_events", method: "eq", args: ["restaurant_id", R] });
  });

  it("an open order leaves the entry as sent, and no notice is added", async () => {
    const sent = { ...eventRow, order_id: "o-1" };
    const db = fakeDb({
      procurement_orders: [{ data: { id: "o-1" }, error: null }],
      calendar_events: [{ data: sent, error: null }, { data: sent, error: null }],
    });
    const out = await service(db).createEvent(R, "u-1", { ...base, orderId: "o-1" });
    expect(out).toMatchObject({ eventDate: "2026-09-03", status: "pending" });
    expect(out.notice).toBeUndefined();
  });

  it("an entry that cannot be read back says so instead of vouching for the typed date", async () => {
    const sent = { ...eventRow, order_id: "o-1" };
    const db = fakeDb({
      procurement_orders: [{ data: { id: "o-1" }, error: null }],
      calendar_events: [{ data: sent, error: null }, { data: null, error: { message: "down" } }],
    });
    const out = await service(db).createEvent(R, "u-1", { ...base, orderId: "o-1" });
    expect(out.notice).toMatch(/^The entry was saved, but it could not be read back\./);
  });

  it("an entry with no order is not read back", async () => {
    const db = fakeDb({ calendar_events: [{ data: eventRow, error: null }] });
    const out = await service(db).createEvent(R, "u-1", base);
    expect(out.notice).toBeUndefined();
    expect(db.calls.filter((c) => c.table === "calendar_events" && c.method === "select")).toHaveLength(1);
  });

  it("a cancelled order's delivery says it is not coming", () => {
    expect(
      linkedOrderMovedEntry({ status: "pending", start_date: "2026-11-16" }, { status: "cancelled", start_date: "2026-11-16" }),
    ).toBe("Its order was cancelled, rejected or failed, so this delivery is not coming and is marked cancelled.");
    expect(
      linkedOrderMovedEntry({ status: "pending", start_date: "2026-11-16" }, { status: "completed", start_date: "2026-11-16" }),
    ).toBe("Its order has already arrived, so this delivery is ruled off.");
  });

  it("does not create an entry whose links could not be checked", async () => {
    const db = fakeDb({ providers: [{ data: null, error: { message: "down" } }] });
    await expect(
      service(db).createEvent(R, "u-1", { ...base, providerId: "pv-1" }),
    ).rejects.toThrow(/could not be checked, so the entry was not created/);
    expect(db.calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("takes the entry back out when its repeat cannot be saved, and says so", async () => {
    const db = fakeDb({
      calendar_events: [
        { data: { ...eventRow, is_recurring: true }, error: null },
        { data: null, error: null }, // the delete
      ],
      calendar_recurrence_rules: [{ data: null, error: { message: "rule refused" } }],
    });
    await expect(
      service(db).createEvent(R, "u-1", { ...base, recurrence: weekly }),
    ).rejects.toThrow(/The repeat could not be saved, so the entry was not created\. Nothing was written/);
    const del = db.calls.filter((c) => c.method === "delete");
    expect(del.map((c) => c.table)).toEqual(["calendar_events"]);
    expect(db.calls).toContainEqual({ table: "calendar_events", method: "eq", args: ["id", "ev-1"] });
    // Never the old silent path: no row is turned into a one-off.
    expect(
      db.calls.some((c) => c.method === "update" && (c.args[0] as Record<string, unknown>)?.is_recurring === false),
    ).toBe(false);
  });

  it("removes the rule and the entry when the rule cannot be tied to the entry", async () => {
    const db = fakeDb({
      calendar_events: [
        { data: { ...eventRow, is_recurring: true }, error: null },
        { data: null, error: { message: "update refused" } }, // tying the rule
        { data: null, error: null }, // the delete
      ],
      calendar_recurrence_rules: [
        { data: { id: "rule-1", frequency: "weekly", interval_value: 1, end_type: "never" }, error: null },
        { data: null, error: null }, // the delete
      ],
    });
    await expect(
      service(db).createEvent(R, "u-1", { ...base, recurrence: weekly }),
    ).rejects.toThrow(/Nothing was written/);
    expect(db.calls.filter((c) => c.method === "delete").map((c) => c.table)).toEqual([
      "calendar_recurrence_rules",
      "calendar_events",
    ]);
  });

  it("does not claim nothing was written when the entry could not be taken back", async () => {
    const db = fakeDb({
      calendar_events: [
        { data: { ...eventRow, is_recurring: true }, error: null },
        { data: null, error: { message: "delete refused" } },
      ],
      calendar_recurrence_rules: [{ data: null, error: { message: "rule refused" } }],
    });
    const err = await service(db)
      .createEvent(R, "u-1", { ...base, recurrence: weekly })
      .catch((e: Error) => e);
    expect((err as Error).message).toMatch(/may be on the calendar once, without repeating/);
    expect((err as Error).message).not.toMatch(/Nothing was written/);
  });
});

describe("CalendarController.createEvent — a worded refusal keeps its status", () => {
  it("returns the service's 400 and sentence, not a generic 500", async () => {
    const svc = {
      createEvent: async () => {
        throw new BadRequestException("That order is not in this house's orders book.");
      },
    };
    const ctrl = new CalendarController(svc as never, {} as never, {} as never, {} as never, {} as never);
    const err = (await ctrl
      .createEvent(base, { userId: "u-1", restaurantId: R })
      .catch((e: unknown) => e)) as HttpException;
    expect(err.getStatus()).toBe(400);
    expect(err.message).toBe("That order is not in this house's orders book.");
  });
});

describe("Calendar entry validation — times and titles", () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const create = { type: "body" as const, metatype: CreateCalendarEventDto, data: "" };
  const update = { type: "body" as const, metatype: UpdateCalendarEventDto, data: "" };

  it.each(["09:30", "23:59", "00:00", "09:30:00"])("accepts the time %s", async (t) => {
    await expect(pipe.transform({ ...base, eventTime: t, eventTimeEnd: t }, create)).resolves.toBeDefined();
    await expect(pipe.transform({ eventTime: t }, update)).resolves.toBeDefined();
  });

  it.each(["25:99", "24:00", "9:30", "09:60", "noon", "09:30:61"])("refuses the time %s", async (t) => {
    await expect(pipe.transform({ ...base, eventTime: t }, create)).rejects.toThrow();
    await expect(pipe.transform({ ...base, eventTimeEnd: t }, create)).rejects.toThrow();
    await expect(pipe.transform({ eventTime: t }, update)).rejects.toThrow();
    await expect(pipe.transform({ eventTimeEnd: t }, update)).rejects.toThrow();
  });

  it("keeps an empty time as 'no time' on create, and refuses it on update", async () => {
    await expect(pipe.transform({ ...base, eventTime: "" }, create)).resolves.toBeDefined();
    await expect(pipe.transform({ eventTime: "" }, update)).rejects.toThrow();
  });

  it("refuses a blank or overlong title", async () => {
    await expect(pipe.transform({ ...base, title: "   " }, create)).rejects.toThrow();
    await expect(pipe.transform({ ...base, title: "x".repeat(301) }, create)).rejects.toThrow();
    await expect(pipe.transform({ title: "" }, update)).rejects.toThrow();
    await expect(pipe.transform({ ...base, title: "x".repeat(300) }, create)).resolves.toBeDefined();
  });
});
