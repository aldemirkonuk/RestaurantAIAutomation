/**
 * Sweep 2026-09-28 row 16: a repeating event showed only on its first date.
 *
 * Two gateway causes, both pinned here:
 *  1. `listEvents` mapped each row without its `recurrenceRule`, so the web had
 *     nothing to expand (getEvent attached it; the list never did).
 *  2. The window filter was `start_date >= startDate`, so a series that began
 *     before the visible window was not returned at all, even though it has
 *     occurrences inside it.
 *
 * And the repo rule: a failed rule read is a failed read, never a row that
 * quietly stops repeating.
 */
import { CalendarService } from "./calendar.service";

type Call = { method: string; args: unknown[] };

function fakeDb(tables: Record<string, { data: unknown; error: unknown; count?: number }>) {
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
  title: "Cellar count",
  description: null,
  event_type: "meeting",
  start_date: "2026-08-03",
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
  is_recurring: true,
  parent_event_id: null,
  occurrence_date: null,
  recurrence_rule_id: "rule-1",
  created_by: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  ...over,
});

const rule = {
  id: "rule-1",
  restaurant_id: "r-1",
  calendar_event_id: "ev-1",
  frequency: "weekly",
  interval_value: 1,
  days_of_week: [1],
  day_of_month: null,
  week_of_month: null,
  month_of_year: null,
  end_type: "never",
  end_after_count: null,
  end_on_date: null,
  last_generated_date: null,
  next_generation_date: null,
  generation_horizon_days: 90,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

function service(db: ReturnType<typeof fakeDb>) {
  return new CalendarService(db as never, {} as never);
}

describe("CalendarService.listEvents — repeating series (sweep row 16)", () => {
  it("attaches each row's recurrence rule, read from this house only", async () => {
    const db = fakeDb({
      calendar_events: {
        data: [row(), row({ id: "ev-2", is_recurring: false, recurrence_rule_id: null })],
        error: null,
        count: 2,
      },
      calendar_recurrence_rules: { data: [rule], error: null },
    });
    const out = await service(db).listEvents("r-1", {
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(out.events[0].recurrenceRule).toMatchObject({
      id: "rule-1",
      frequency: "weekly",
      interval: 1,
      daysOfWeek: [1],
      endType: "never",
    });
    expect(out.events[1].recurrenceRule).toBeUndefined();
    const ruleCalls = db.calls.calendar_recurrence_rules;
    expect(ruleCalls).toContainEqual({ method: "eq", args: ["restaurant_id", "r-1"] });
    expect(ruleCalls).toContainEqual({ method: "in", args: ["id", ["rule-1"]] });
  });

  it("returns a series that began before the window, since it repeats inside it", async () => {
    const db = fakeDb({
      calendar_events: { data: [], error: null, count: 0 },
    });
    await service(db).listEvents("r-1", {
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      includeEarlierSeries: true,
    });
    const ev = db.calls.calendar_events;
    // Nothing may be cut purely for starting before the window…
    expect(ev).not.toContainEqual({ method: "gte", args: ["start_date", "2026-09-01"] });
    // …except rows that do not repeat.
    expect(ev).toContainEqual({
      method: "or",
      args: ['start_date.gte."2026-09-01",is_recurring.eq.true'],
    });
    expect(ev).toContainEqual({ method: "lte", args: ["start_date", "2026-09-30"] });
  });

  it("keeps the strict lower bound for callers that count rows as dated entries", async () => {
    // house-day, /calendar/today and /calendar/upcoming count what comes back;
    // a series master dated last month must not appear in "today".
    const db = fakeDb({ calendar_events: { data: [], error: null, count: 0 } });
    await service(db).listEvents("r-1", { startDate: "2026-09-01", endDate: "2026-09-30" });
    const ev = db.calls.calendar_events;
    expect(ev).toContainEqual({ method: "gte", args: ["start_date", "2026-09-01"] });
    expect(ev.some((c) => c.method === "or")).toBe(false);
  });

  it("fails the read when the rules cannot be read — never a series that stops repeating", async () => {
    const db = fakeDb({
      calendar_events: { data: [row()], error: null, count: 1 },
      calendar_recurrence_rules: { data: null, error: { message: "rules offline" } },
    });
    await expect(
      service(db).listEvents("r-1", { startDate: "2026-09-01", endDate: "2026-09-30" }),
    ).rejects.toMatchObject({ message: "rules offline" });
  });

  it("does not read the rules table when nothing in the window repeats", async () => {
    const db = fakeDb({
      calendar_events: {
        data: [row({ is_recurring: false, recurrence_rule_id: null })],
        error: null,
        count: 1,
      },
    });
    await service(db).listEvents("r-1", {});
    expect(db.calls.calendar_recurrence_rules).toBeUndefined();
  });
});
