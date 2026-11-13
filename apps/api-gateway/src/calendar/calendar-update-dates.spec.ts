/**
 * Correcting an entry's days (QA round 4 B5, B9 on the update path):
 *  - a new start after the stored end, or a new end before the stored start,
 *    is refused in a sentence and nothing is written;
 *  - `eventDateEnd: null` clears the end day in BOTH copies of the column,
 *    because the date-sync trigger copies `event_date_end` back into a NULL
 *    `end_date`;
 *  - the controller keeps the service's 400 and sentence on update, as it
 *    does on create.
 */
import { BadRequestException, HttpException, ValidationPipe } from "@nestjs/common";
import { CalendarService } from "./calendar.service";
import { CalendarController } from "./calendar.controller";
import { UpdateCalendarEventDto } from "./dto/calendar.dto";

type Call = { table: string; method: string; args: unknown[] };

function fakeDb(stored: Record<string, unknown>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    for (const m of ["select", "insert", "update", "delete", "eq", "in", "is"]) {
      b[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        if (m === "update") patch = args[0] as Record<string, unknown>;
        return b;
      };
    }
    const answer = () =>
      Promise.resolve({ data: patch ? { ...stored, ...patch } : stored, error: null });
    b.single = answer;
    b.maybeSingle = answer;
    b.then = (res: (v: unknown) => void, rej: (e: unknown) => void) => answer().then(res, rej);
    return b;
  };
  return { supabase: { from }, calls };
}

const R = "r-1";
const closure = {
  id: "ev-1",
  restaurant_id: R,
  title: "Winter closure",
  event_type: "other",
  start_date: "2026-12-28",
  end_date: "2027-01-03",
  all_day: true,
  is_recurring: false,
  recurrence_rule_id: null,
  parent_event_id: null,
  source: "manual",
  status: "pending",
  reminder_enabled: true,
  reminder_days_before: 1,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

function service(db: ReturnType<typeof fakeDb>) {
  return new CalendarService(db as never, { createEvent: async () => ({}) } as never);
}

const updates = (db: ReturnType<typeof fakeDb>) =>
  db.calls.filter((c) => c.method === "update").map((c) => c.args[0] as Record<string, unknown>);

const REFUSAL = new BadRequestException("An entry cannot end before the day it starts.");

describe("CalendarService.updateEvent — the days as they will stand", () => {
  it("refuses a new start after the stored end, writing nothing", async () => {
    const db = fakeDb(closure);
    await expect(
      service(db).updateEvent(R, "u-1", "ev-1", { eventDate: "2027-01-05" }),
    ).rejects.toThrow(REFUSAL);
    expect(updates(db)).toEqual([]);
  });

  it("refuses a new end before the stored start, writing nothing", async () => {
    const db = fakeDb(closure);
    await expect(
      service(db).updateEvent(R, "u-1", "ev-1", { eventDateEnd: "2026-12-20" }),
    ).rejects.toThrow(REFUSAL);
    expect(updates(db)).toEqual([]);
  });

  it("accepts a move of both days together", async () => {
    const db = fakeDb(closure);
    const out = await service(db).updateEvent(R, "u-1", "ev-1", {
      eventDate: "2027-01-05",
      eventDateEnd: "2027-01-10",
    });
    expect(out).toMatchObject({ eventDate: "2027-01-05", eventDateEnd: "2027-01-10" });
  });

  it("accepts a new start that only moves later within the stored end", async () => {
    const db = fakeDb(closure);
    await expect(
      service(db).updateEvent(R, "u-1", "ev-1", { eventDate: "2027-01-03" }),
    ).resolves.toMatchObject({ eventDate: "2027-01-03" });
  });

  it("clears the end day in both copies, so the sync trigger cannot put it back", async () => {
    const db = fakeDb(closure);
    await service(db).updateEvent(R, "u-1", "ev-1", { eventDateEnd: null });
    expect(updates(db)[0]).toMatchObject({ end_date: null, event_date_end: null });
  });

  it("lets a start move past the old end when the same edit clears the end", async () => {
    const db = fakeDb(closure);
    await expect(
      service(db).updateEvent(R, "u-1", "ev-1", { eventDate: "2027-01-05", eventDateEnd: null }),
    ).resolves.toMatchObject({ eventDate: "2027-01-05" });
  });
});

describe("CalendarService.updateEvent — this and future dates", () => {
  it("starts the new series with no end day when the edit clears it", async () => {
    const occurrence = {
      ...closure,
      is_recurring: true,
      parent_event_id: "ev-0",
      recurrence_rule_id: "rule-1",
      occurrence_date: "2027-01-04",
      start_date: "2027-01-04",
      end_date: "2027-01-05",
    };
    const db = fakeDb(occurrence);
    await service(db)
      .updateEvent(R, "u-1", "ev-1", { eventDateEnd: null, updateScope: "this_and_future" })
      .catch(() => undefined); // only the new parent row is under test here
    const inserted = db.calls.find(
      (c) => c.table === "calendar_events" && c.method === "insert",
    )?.args[0] as Record<string, unknown> | undefined;
    expect(inserted).toMatchObject({ start_date: "2027-01-04", end_date: null });
  });
});

describe("UpdateCalendarEventDto — clearing the end day", () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const meta = { type: "body" as const, metatype: UpdateCalendarEventDto, data: "" };

  it("accepts null as 'no end day' and still refuses a non-date", async () => {
    await expect(pipe.transform({ eventDateEnd: null }, meta)).resolves.toMatchObject({
      eventDateEnd: null,
    });
    await expect(pipe.transform({ eventDateEnd: "soon" }, meta)).rejects.toThrow();
  });
});

describe("CalendarController.updateEvent — a worded refusal keeps its status", () => {
  it("returns the service's 400 and sentence, not a generic 500", async () => {
    const svc = {
      updateEvent: async () => {
        throw REFUSAL;
      },
    };
    const ctrl = new CalendarController(svc as never, {} as never, {} as never, {} as never, {} as never);
    const err = (await ctrl
      .updateEvent("ev-1", { eventDateEnd: "2026-12-20" }, { userId: "u-1", restaurantId: R })
      .catch((e: unknown) => e)) as HttpException;
    expect(err.getStatus()).toBe(400);
    expect(err.message).toBe("An entry cannot end before the day it starts.");
  });

  it("still turns an unworded failure into a 500", async () => {
    const svc = {
      updateEvent: async () => {
        throw new Error("connection reset");
      },
    };
    const ctrl = new CalendarController(svc as never, {} as never, {} as never, {} as never, {} as never);
    const err = (await ctrl
      .updateEvent("ev-1", { title: "x" }, { userId: "u-1", restaurantId: R })
      .catch((e: unknown) => e)) as HttpException;
    expect(err.getStatus()).toBe(500);
  });
});
