/**
 * F-607: a repeating entry could not be stopped from a date. The only way out
 * was deleting the series, past dates included, and `?fromDate=` deleted only
 * stored dates while the rule went on drawing every later one. endSeriesFrom
 * cuts the rule the day before, keeps every earlier date, and refuses a cut
 * that would leave no date at all.
 */
import { BadRequestException } from "@nestjs/common";
import { CalendarService } from "./calendar.service";

const series = {
  id: "ev-s",
  restaurant_id: "r-1",
  title: "Tasting",
  event_type: "tasting",
  start_date: "2026-04-07",
  end_date: null,
  all_day: true,
  start_time: null,
  end_time: null,
  source: "manual",
  status: "pending",
  reminder_enabled: true,
  reminder_days_before: 1,
  reminder_sent: false,
  is_recurring: true,
  parent_event_id: null,
  occurrence_date: null,
  recurrence_rule_id: "rule-1",
};

function harness(
  rule: Record<string, unknown>,
  event: Record<string, unknown> = series,
) {
  const ruleUpdates: Record<string, unknown>[] = [];
  const deletes: Array<Array<[string, unknown]>> = [];
  const from = (table: string) => {
    let mode: "select" | "update" | "delete" = "select";
    const filters: Array<[string, unknown]> = [];
    const b: Record<string, any> = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => (filters.push([c, v]), b);
    b.gte = (c: string, v: unknown) => (filters.push([`>=${c}`, v]), b);
    b.update = (p: Record<string, unknown>) => {
      mode = "update";
      if (table === "calendar_recurrence_rules") ruleUpdates.push(p);
      return b;
    };
    b.delete = () => ((mode = "delete"), b);
    b.single = async () => ({
      data:
        table === "calendar_events"
          ? event
          : { restaurant_id: "r-1", calendar_event_id: "ev-s", ...rule },
      error: null,
    });
    b.then = (resolve: any) => {
      if (mode === "delete") deletes.push(filters);
      return Promise.resolve({ data: [], error: null }).then(resolve);
    };
    return b;
  };
  const db = { supabase: { from } };
  const events = { createEvent: jest.fn(async () => undefined) };
  return {
    svc: new CalendarService(db as never, events as never),
    ruleUpdates,
    deletes,
  };
}

const weekly = {
  id: "rule-1",
  frequency: "weekly",
  interval_value: 1,
  days_of_week: null,
};

describe("CalendarService.endSeriesFrom (F-607)", () => {
  it("ends an open-ended series the day before and keeps every earlier date", async () => {
    const { svc, ruleUpdates, deletes } = harness({
      ...weekly,
      end_type: "never",
    });
    await svc.endSeriesFrom("r-1", "u-1", "ev-s", "2026-11-03");
    expect(ruleUpdates).toEqual([
      expect.objectContaining({
        end_type: "on_date",
        end_on_date: "2026-11-02",
      }),
    ]);
    // Only the parent's stored dates from that day on; never the series row.
    expect(deletes).toEqual([
      [
        ["restaurant_id", "r-1"],
        ["parent_event_id", "ev-s"],
        [">=start_date", "2026-11-03"],
      ],
    ]);
  });

  it("cuts a counted series to the dates before the day, never adds to it", async () => {
    // Tuesdays from 7 April: 7, 14, 21, 28 April fall before 1 May.
    const cut = harness({
      ...weekly,
      end_type: "after_count",
      end_after_count: 10,
    });
    await cut.svc.endSeriesFrom("r-1", "u-1", "ev-s", "2026-05-01");
    expect(cut.ruleUpdates).toEqual([
      expect.objectContaining({ end_after_count: 4 }),
    ]);

    const short = harness({
      ...weekly,
      end_type: "after_count",
      end_after_count: 2,
    });
    await short.svc.endSeriesFrom("r-1", "u-1", "ev-s", "2026-05-01");
    expect(short.ruleUpdates).toEqual([]);
  });

  it("never moves an earlier end later", async () => {
    const { svc, ruleUpdates } = harness({
      ...weekly,
      end_type: "on_date",
      end_on_date: "2026-06-30",
    });
    await svc.endSeriesFrom("r-1", "u-1", "ev-s", "2026-09-01");
    expect(ruleUpdates).toEqual([]);
  });

  it("refuses to end a series on its first date, which would remove all of it", async () => {
    const { svc, ruleUpdates, deletes } = harness({
      ...weekly,
      end_type: "never",
    });
    await expect(
      svc.endSeriesFrom("r-1", "u-1", "ev-s", "2026-04-07"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ruleUpdates).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("refuses an entry that does not repeat", async () => {
    const { svc } = harness(
      {},
      { ...series, is_recurring: false, recurrence_rule_id: null },
    );
    await expect(
      svc.endSeriesFrom("r-1", "u-1", "ev-s", "2026-05-01"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
