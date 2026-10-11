/**
 * F-545: "Repeats weekly" used to be saved as a one-off when the recurrence
 * rule insert failed — the event row stayed, `is_recurring` was flipped back,
 * and the request returned 201, so the sheet closed as a success.
 *
 * A repeating entry is saved whole or not at all: any failure after the event
 * row exists deletes it (rule and occurrences cascade) and fails the request.
 */
import { InternalServerErrorException } from "@nestjs/common";
import { CalendarService, NOTHING_SAVED_REASON } from "./calendar.service";

type Answer = { data: unknown; error: { message: string } | null };

function fakeDb(opts: {
  rule?: Answer;
  link?: Answer;
  rpc?: Answer;
  undo?: Answer;
}) {
  const ops: string[] = [];
  const event = {
    id: "ev-1",
    restaurant_id: "r-1",
    title: "Tuesday tasting",
    event_type: "meeting",
    start_date: "2026-10-13",
    all_day: true,
    is_recurring: true,
  };
  const rule = { id: "rule-1", frequency: "weekly", interval_value: 1 };
  const from = (table: string) => {
    let op = "select";
    const b: Record<string, unknown> = {};
    const answer = (): Answer => {
      if (table === "calendar_events" && op === "insert")
        return { data: event, error: null };
      if (table === "calendar_events" && op === "update")
        return opts.link ?? { data: null, error: null };
      if (table === "calendar_events" && op === "delete")
        return opts.undo ?? { data: null, error: null };
      if (table === "calendar_recurrence_rules" && op === "insert")
        return opts.rule ?? { data: rule, error: null };
      return { data: null, error: null };
    };
    for (const m of ["insert", "update", "delete"]) {
      b[m] = () => {
        op = m;
        ops.push(`${table}.${m}`);
        return b;
      };
    }
    for (const m of ["select", "eq"]) b[m] = () => b;
    b.single = () => Promise.resolve(answer());
    b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(answer()).then(resolve, reject);
    return b;
  };
  const rpc = () => Promise.resolve(opts.rpc ?? { data: 4, error: null });
  return { db: { supabase: { from, rpc } }, ops };
}

const dto = {
  title: "Tuesday tasting",
  eventType: "meeting",
  eventDate: "2026-10-13",
  recurrence: { frequency: "weekly", interval: 1, endType: "never" },
} as never;

function service(db: unknown) {
  const events = { createEvent: jest.fn().mockResolvedValue(undefined) };
  return new CalendarService(db as never, events as never);
}

describe("createEvent with a repeat (F-545)", () => {
  it("fails and deletes the event when the recurrence rule cannot be written", async () => {
    const { db, ops } = fakeDb({
      rule: { data: null, error: { message: "rule insert refused" } },
    });

    await expect(
      service(db).createEvent("r-1", "u-1", dto),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(ops).toContain("calendar_events.delete");
    expect(ops).not.toContain("calendar_events.update");
  });

  it("fails and deletes the event when linking the rule fails", async () => {
    const { db, ops } = fakeDb({
      link: { data: null, error: { message: "update refused" } },
    });

    await expect(service(db).createEvent("r-1", "u-1", dto)).rejects.toThrow(
      /nothing was saved/,
    );
    expect(ops).toContain("calendar_events.delete");
  });

  // F-1147: the rolled-back 500 carries a typed reason, so the web can tell
  // it from a 5xx that may have landed.
  it("marks the rolled-back failure with reason nothing_saved", async () => {
    const { db } = fakeDb({
      link: { data: null, error: { message: "update refused" } },
    });

    const err = await service(db)
      .createEvent("r-1", "u-1", dto)
      .catch((e: InternalServerErrorException) => e);
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect((err as InternalServerErrorException).getResponse()).toMatchObject({
      reason: NOTHING_SAVED_REASON,
    });
  });

  it("fails and deletes the event when the first occurrences cannot be generated", async () => {
    const { db, ops } = fakeDb({
      rpc: { data: null, error: { message: "rpc failed" } },
    });

    await expect(service(db).createEvent("r-1", "u-1", dto)).rejects.toThrow(
      /nothing was saved/,
    );
    expect(ops).toContain("calendar_events.delete");
  });

  it("says the single entry is still there when the rollback itself fails", async () => {
    const { db } = fakeDb({
      rule: { data: null, error: { message: "rule insert refused" } },
      undo: { data: null, error: { message: "delete refused" } },
    });

    await expect(service(db).createEvent("r-1", "u-1", dto)).rejects.toThrow(
      /could not be removed/,
    );
  });

  it("returns the event with its rule when every write lands", async () => {
    const { db, ops } = fakeDb({});

    const out = await service(db).createEvent("r-1", "u-1", dto);
    expect(out.recurrenceRule).toBeDefined();
    expect(ops).not.toContain("calendar_events.delete");
  });
});
