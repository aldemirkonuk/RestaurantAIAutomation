/**
 * F-196: editing an entry could not clear a field. The sheet now sends null
 * for an emptied note, time or end date; the DTO must let null through and
 * updateEvent must write it as a cleared column, while an absent key still
 * means "leave it". Making an entry all day clears both clock times.
 */
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CalendarService } from "./calendar.service";
import { BadRequestException } from "@nestjs/common";
import {
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from "./dto/calendar.dto";

const stored = {
  id: "ev-1",
  restaurant_id: "r-1",
  provider_id: null,
  order_id: null,
  title: "Party",
  description: "Bring the long table",
  event_type: "meeting",
  start_date: "2026-09-12",
  end_date: "2026-09-13",
  all_day: false,
  start_time: "18:00",
  end_time: "23:00",
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
};

function harness() {
  const writes: Record<string, unknown>[] = [];
  const builder = () => {
    let pending: Record<string, unknown> | null = null;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) b[m] = () => b;
    b.update = (payload: Record<string, unknown>) => {
      pending = payload;
      writes.push(payload);
      return b;
    };
    b.single = async () => ({
      data: pending ? { ...stored, ...pending } : stored,
      error: null,
    });
    return b;
  };
  const db = { supabase: { from: builder } };
  const events = { createEvent: jest.fn(async () => undefined) };
  return { svc: new CalendarService(db as never, events as never), writes };
}

describe("UpdateCalendarEventDto — null clears (F-196)", () => {
  it("accepts null for the note, the times and the end date", async () => {
    const dto = plainToInstance(UpdateCalendarEventDto, {
      description: null,
      eventTime: null,
      eventTimeEnd: null,
      eventDateEnd: null,
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });
});

describe("CalendarService.updateEvent — clearing a field (F-196)", () => {
  it("writes null for a cleared field and leaves an absent one alone", async () => {
    const { svc, writes } = harness();
    await svc.updateEvent("r-1", "u-1", "ev-1", {
      description: null,
      eventTimeEnd: null,
      eventDateEnd: null,
    });
    const w = writes[0];
    expect(w.description).toBeNull();
    expect(w.end_time).toBeNull();
    expect(w.end_date).toBeNull();
    expect(w).not.toHaveProperty("start_time");
    expect(w).not.toHaveProperty("title");
  });

  it("clears both clock times when an entry is made all day", async () => {
    const { svc, writes } = harness();
    await svc.updateEvent("r-1", "u-1", "ev-1", { allDay: true });
    expect(writes[0]).toMatchObject({ all_day: true, start_time: null, end_time: null });
  });
});

describe("an entry may not end before it starts (F-937)", () => {
  it("the bodies refuse a reversed range and keep a same-day or later end", async () => {
    const base = {
      title: "Party",
      eventType: "meeting",
      eventDate: "2026-09-12",
    };
    const bad = plainToInstance(CreateCalendarEventDto, {
      ...base,
      eventDateEnd: "2026-09-11",
    });
    expect((await validate(bad)).map((e) => e.property)).toEqual([
      "eventDateEnd",
    ]);
    const same = plainToInstance(CreateCalendarEventDto, {
      ...base,
      eventDateEnd: "2026-09-12",
    });
    expect(await validate(same)).toEqual([]);
    const edit = plainToInstance(UpdateCalendarEventDto, {
      eventDate: "2026-09-12",
      eventDateEnd: "2026-09-10",
    });
    expect((await validate(edit)).map((e) => e.property)).toEqual([
      "eventDateEnd",
    ]);
  });

  it("createEvent saves nothing for a reversed range", async () => {
    const { svc, writes } = harness();
    await expect(
      svc.createEvent("r-1", "u-1", {
        title: "Party",
        eventType: "meeting",
        eventDate: "2026-09-12",
        eventDateEnd: "2026-09-11",
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toHaveLength(0);
  });

  it("updateEvent checks a one-sided edit against the stored day", async () => {
    const { svc, writes } = harness();
    // Stored: 12th to 13th. Moving only the end before the 12th is refused,
    await expect(
      svc.updateEvent("r-1", "u-1", "ev-1", { eventDateEnd: "2026-09-11" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // and so is moving only the start past the stored end.
    await expect(
      svc.updateEvent("r-1", "u-1", "ev-1", { eventDate: "2026-09-14" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toHaveLength(0);
    await svc.updateEvent("r-1", "u-1", "ev-1", {
      eventDate: "2026-09-14",
      eventDateEnd: null,
    });
    expect(writes[0]).toMatchObject({
      start_date: "2026-09-14",
      end_date: null,
    });
  });
});
