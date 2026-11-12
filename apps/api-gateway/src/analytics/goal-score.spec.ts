import {
  datedReading,
  figureOrNull,
  goalSchedule,
  goalShape,
  presentStoredReading,
  readOnIfNotToday,
  scoreGoal,
  storedGoalSchedule,
} from "./goal-score";

const DAY = 86400000;
const START = Date.UTC(2026, 10, 1);
const END = START + 30 * DAY;
const HALF = START + 15 * DAY;

const run = (over: Partial<Parameters<typeof scoreGoal>[0]>) =>
  scoreGoal({
    direction: "at_least",
    shape: "cumulative",
    current: 50,
    target: 100,
    baseline: null,
    start: START,
    end: END,
    at: HALF,
    ...over,
  });

describe("scoreGoal — one score for every goal reader (reports lane r2)", () => {
  it("an unknown current or target, or a target of 0, is no score, never 0%", () => {
    for (const over of [{ current: null }, { target: null }, { target: 0 }, { current: NaN }]) {
      const s = run(over);
      expect(s.progressPct).toBeNull();
      expect(s.met).toBeNull();
      expect(s.onTrack).toBeNull();
    }
  });

  it("a running total to reach: half way at half time is on pace; far short is behind", () => {
    expect(run({ current: 50 })).toMatchObject({ progressPct: 0.5, met: false, onTrack: true, daysLeft: 15 });
    expect(run({ current: 20 }).onTrack).toBe(false);
    expect(run({ current: 120 })).toMatchObject({ met: true, onTrack: true });
  });

  it("a ceiling on a running total: under it at a slow burn is on pace, over it never is", () => {
    const s = run({ direction: "at_most", current: 40 });
    expect(s).toMatchObject({ direction: "at_most", progressPct: 0.4, met: true, onTrack: true });
    // Spending faster than the ceiling allows by now.
    expect(run({ direction: "at_most", current: 80 }).onTrack).toBe(false);
    // Over the ceiling near the deadline, inside the old 10% slack: still behind.
    expect(run({ direction: "at_most", current: 105, at: END }).onTrack).toBe(false);
  });

  it("a level that already meets its ceiling is on pace on day one (it read behind before)", () => {
    const s = run({ direction: "at_most", shape: "level", current: 25, target: 30, baseline: 45, at: START + DAY });
    expect(s).toMatchObject({ met: true, onTrack: true });
  });

  it("a level not yet at its target is paced from its baseline, not from 0", () => {
    // Average check from 60 to 95; half way it should be about 77.5.
    expect(run({ shape: "level", current: 76, target: 95, baseline: 60 }).onTrack).toBe(true);
    // 62 at half time is well behind, though a schedule from 0 would expect 47.5 and call it ahead.
    expect(run({ shape: "level", current: 62, target: 95, baseline: 60 }).onTrack).toBe(false);
    // Days of stock from 45 down to 30: 44 at half time is behind, 37 is on pace.
    expect(run({ direction: "at_most", shape: "level", current: 44, target: 30, baseline: 45 }).onTrack).toBe(false);
    expect(run({ direction: "at_most", shape: "level", current: 37, target: 30, baseline: 45 }).onTrack).toBe(true);
  });

  it("a level with no baseline has no schedule: pace unknown, not behind", () => {
    const s = run({ shape: "level", current: 60, target: 95, baseline: null });
    expect(s.onTrack).toBeNull();
    expect(s.expectedByNow).toBeNull();
  });

  it("a level that met its target when set and has slipped past it is behind", () => {
    expect(run({ direction: "at_most", shape: "level", current: 34, target: 30, baseline: 28 }).onTrack).toBe(false);
  });

  it("no deadline, no schedule", () => {
    const s = run({ end: null });
    expect(s).toMatchObject({ progressPct: 0.5, met: false, onTrack: null, daysLeft: null, expectedByNow: null });
  });

  it("levels are the three metrics read at an instant", () => {
    expect(["avg_check", "wine_attach_rate", "days_of_inventory"].map(goalShape)).toEqual(["level", "level", "level"]);
    expect(["wine_revenue", "bottles_sold", "purchase_spend", "checks"].map(goalShape)).toEqual([
      "cumulative",
      "cumulative",
      "cumulative",
      "cumulative",
    ]);
  });

  it("figureOrNull never turns a missing figure into 0", () => {
    expect([null, undefined, "", "x", NaN].map(figureOrNull)).toEqual([null, null, null, null, null]);
    expect(figureOrNull("312.07")).toBe(312.07);
    expect(figureOrNull(0)).toBe(0);
  });
});

describe("a stored reading", () => {
  const row = {
    id: "g1",
    current_value: 312.07,
    current_read_at: "2026-11-09T10:00:00Z",
    current_unread: null as string | null,
  };

  it("a refused latest reading takes the older number off the row, keeping the reason", () => {
    const shown = presentStoredReading({ ...row, current_unread: "a good on hand has no recorded cost" });
    expect(shown.current_value).toBeNull();
    expect(shown.current_unread).toBe("a good on hand has no recorded cost");
    expect(presentStoredReading(row)).toBe(row);
  });

  it("a pace claim needs a dated, unrefused reading", () => {
    expect(datedReading(row)).toEqual({ current: 312.07, at: Date.parse("2026-11-09T10:00:00Z") });
    expect(datedReading({ ...row, current_read_at: null })).toBeNull();
    expect(datedReading({ ...row, current_unread: "refused" })).toBeNull();
    // The column's default 0 on a row nobody read is not a reading.
    expect(datedReading({ id: "g2", current_value: 0 })).toBeNull();
  });
});

describe("one clock for every reader (fix round 2026-11-12)", () => {
  const LA = "America/Los_Angeles";

  it("the schedule runs between the house's midnights, not the raw instant or UTC's", () => {
    // Created 23:00 on Jan 12 in Los Angeles (07:00Z on the 13th): the goal
    // opened on the house's 12th, as the desk opens it.
    const s = storedGoalSchedule({ created_at: "2026-01-13T07:00:00Z", deadline: "2026-01-20" }, LA);
    expect(s).toEqual({
      start: Date.parse("2026-01-12T08:00:00Z"),
      end: Date.parse("2026-01-20T08:00:00Z"),
    });
    expect(s).toEqual(goalSchedule("2026-01-12", "2026-01-20T00:00:00Z", LA));
  });

  it("no zone, no deadline or no opening day is no schedule", () => {
    const none = { start: null, end: null };
    expect(storedGoalSchedule({ created_at: "2026-01-13T07:00:00Z", deadline: "2026-01-20" }, null)).toEqual(none);
    expect(storedGoalSchedule({ created_at: "2026-01-13T07:00:00Z", deadline: null }, LA)).toEqual(none);
    expect(storedGoalSchedule({ created_at: null, deadline: "2026-01-20" }, LA)).toEqual(none);
    expect(goalSchedule("2026-01-12", "soon", LA)).toEqual(none);
  });

  it("a reading is dated by the house's day, and today's reading carries no date", () => {
    const at = Date.parse("2026-01-15T04:00:00Z"); // 20:00 on the 14th in Los Angeles
    expect(readOnIfNotToday(at, LA, new Date("2026-01-16T20:00:00Z"))).toBe("2026-01-14");
    expect(readOnIfNotToday(at, LA, new Date("2026-01-15T07:59:00Z"))).toBeNull();
    // Without a zone the days are UTC's, as before.
    expect(readOnIfNotToday(at, null, new Date("2026-01-15T07:59:00Z"))).toBeNull();
    expect(readOnIfNotToday(at, null, new Date("2026-01-16T00:00:00Z"))).toBe("2026-01-15");
  });
});

describe("the slack is a tenth of the schedule's span (fix round 2026-11-12)", () => {
  it("a little spent in a ceiling's first hours is not on course to go over", () => {
    // 25k a month, set at 10:00, read at 12:00 with 500 spent.
    const start = Date.UTC(2026, 0, 1);
    const s = scoreGoal({
      direction: "at_most",
      shape: "cumulative",
      current: 500,
      target: 25000,
      start,
      end: start + 30 * DAY,
      at: start + 12 * 3600000,
    });
    expect(s.onTrack).toBe(true);
  });

  it("nothing yet in a target's first hours is not behind", () => {
    expect(run({ current: 0, at: START + 2 * 3600000 }).onTrack).toBe(true);
  });

  it("a ceiling spent well ahead of its schedule still reads off pace", () => {
    // A quarter of the month in, 60% of the ceiling gone.
    expect(run({ direction: "at_most", current: 60, at: START + 7.5 * DAY }).onTrack).toBe(false);
  });
});
