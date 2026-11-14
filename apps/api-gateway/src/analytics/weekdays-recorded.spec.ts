import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { leftOutWords, onRecordedWeekdays } from "./weekdays-recorded";
import { EXTREMES_TOO_FEW } from "./engine";

/**
 * r37 walk w3, R-F10: a weekday the house never recorded a line on is not
 * measured, so it is left out of the week's shape, not read as the quietest.
 */

// 2026-11-02 is a Monday.
const WEEK = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"];
const TWO_WEEKS = [...WEEK, "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"];
const weekdayName = (d: string) =>
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    new Date(`${d}T00:00:00Z`).getUTCDay()
  ];

describe("onRecordedWeekdays", () => {
  it("[REVERT-FAILS] a weekday with no line on any of its days is left out", () => {
    const recorded = new Set(TWO_WEEKS.filter((d) => weekdayName(d) !== "Monday"));
    const out = onRecordedWeekdays(TWO_WEEKS, TWO_WEEKS.map(() => 3), (d) => recorded.has(d));
    expect(out.leftOut).toEqual(["Monday"]);
    expect(out.dates).not.toContain("2026-11-02");
    expect(out.dates).not.toContain("2026-11-09");
    expect(out.dates).toHaveLength(12);
  });

  it("inside a measured weekday, a day with no line still counts as 0", () => {
    // Tuesday the 3rd has no line, Tuesday the 10th has one.
    const recorded = new Set(TWO_WEEKS.filter((d) => d !== "2026-11-03"));
    const values = TWO_WEEKS.map((d) => (d === "2026-11-03" ? 0 : 3));
    const out = onRecordedWeekdays(TWO_WEEKS, values, (d) => recorded.has(d));
    expect(out.leftOut).toEqual([]);
    expect(out.dates).toContain("2026-11-03");
    expect(out.values[out.dates.indexOf("2026-11-03")]).toBe(0);
  });

  it("nothing recorded at all leaves nothing, and names no weekday", () => {
    expect(onRecordedWeekdays(WEEK, WEEK.map(() => 0), () => false)).toEqual({
      dates: [],
      values: [],
      leftOut: [],
    });
  });

  it("names the weekdays left out in week order", () => {
    const recorded = new Set(["2026-11-07"]); // a Saturday
    expect(onRecordedWeekdays(WEEK, WEEK.map(() => 1), (d) => recorded.has(d)).leftOut).toEqual([
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);
  });
});

describe("leftOutWords", () => {
  it("is empty when nothing is left out", () => {
    expect(leftOutWords([])).toBe("");
  });

  it("one weekday", () => {
    expect(leftOutWords(["Monday"])).toBe(
      "; Monday has no consumption line in the window, so it is not measured and left out (a day the house is closed is not its quietest day)",
    );
  });

  it("several weekdays", () => {
    expect(leftOutWords(["Sunday", "Monday", "Tuesday"])).toBe(
      "; Sunday, Monday and Tuesday have no consumption line in the window, so they are not measured and left out (a day the house is closed is not its quietest day)",
    );
  });
});

/* ── getSeasonality, end to end ── */

const RID = "r-week";
const dayAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().substring(0, 10);

/** The service over a house whose first line is older than the window. */
async function seasonality(lines: Array<{ date: string; qty: number }>) {
  const client = {
    from: (table: string) => {
      const b: any = {};
      b.select = () => b;
      b.eq = () =>
        table === "restaurant_inventory" ? Promise.resolve({ data: [], error: null }) : b;
      b.order = () => b;
      b.limit = async () => ({ data: [{ created_at: "2020-01-01T12:00:00Z" }], error: null });
      return b;
    },
  };
  const svc = new AdvancedAnalyticsService(
    { getClient: () => client } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  jest.spyOn(svc as any, "loadConsumption").mockResolvedValue(
    lines.map((l) => ({ wineId: "mw-1", inventoryId: "inv-1", qty: l.qty, how: "bottle", date: l.date })),
  );
  return (await svc.getSeasonality(RID, 90)) as any;
}

/** One line a day for the last 90 days, by a rule on the weekday. */
const byWeekday = (qty: (weekday: string) => number | null) =>
  Array.from({ length: 90 }, (_, i) => dayAgo(i + 1))
    .map((date) => ({ date, qty: qty(weekdayName(date)) }))
    .filter((l): l is { date: string; qty: number } => l.qty !== null);

describe("the week's shape reads only the weekdays recorded", () => {
  it("[REVERT-FAILS] a house closed on Mondays is told its real quietest day", async () => {
    const out = await seasonality(
      byWeekday((w) => (w === "Monday" ? null : w === "Tuesday" ? 1 : w === "Saturday" ? 9 : 4)),
    );
    expect(out.weekdayProfile.map((p: any) => p.day)).not.toContain("Monday");
    expect(out.weekdayProfile).toHaveLength(6);
    expect(out.worstDay).toBe("Tuesday");
    expect(out.bestDay).toBe("Saturday");
    expect(out.basis.weekday).toContain("Monday has no consumption line in the window");
  });

  it("[REVERT-FAILS] a house that recorded only Saturdays names no day and says fewer than two have a reading", async () => {
    const out = await seasonality(byWeekday((w) => (w === "Saturday" ? 5 : null)));
    expect(out.weekdayProfile).toHaveLength(1);
    expect(out.bestDay).toBeNull();
    expect(out.worstDay).toBeNull();
    expect(out.tie).toBe(true);
    expect(out.basis.extremes).toBe(EXTREMES_TOO_FEW);
    expect(out.basis.weekday).toContain(
      "Sunday, Monday, Tuesday, Wednesday, Thursday and Friday have no consumption line",
    );
  });

  it("a house that records every weekday keeps all seven and adds no clause", async () => {
    const out = await seasonality(byWeekday((w) => (w === "Friday" ? 8 : 3)));
    expect(out.weekdayProfile).toHaveLength(7);
    expect(out.bestDay).toBe("Friday");
    expect(out.basis.weekday).not.toContain("left out");
  });

  it("the trend still reads every day in order", async () => {
    const out = await seasonality(byWeekday((w) => (w === "Monday" ? null : 3)));
    expect(out.trendPerDayPct).not.toBeNull();
  });
});
