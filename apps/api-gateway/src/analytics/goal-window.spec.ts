import { goalPeriodStart, goalSchedule, goalWindow } from "./goal-window";

/**
 * F-865: a goal's deadline day is counted in full (`houseDayBounds` ends at
 * the midnight after it), so its pace runs through that day too. The
 * schedule ended at the midnight that OPENS the deadline day: a month was
 * paced over 30 of its 31 days, a week over 6 of 7, and all of the last day
 * read "0 days left" with the whole target expected.
 *
 * F-864: the window is one function, shared by the goals desk and the
 * insight feed's goal card.
 */
const at = (iso: string) => new Date(iso).getTime();

describe("a goal's pace runs through its deadline day (F-865)", () => {
  const october = {
    periodStart: "2026-10-01",
    periodEnd: "2026-11-01",
    deadlineDay: "2026-10-31",
  };

  it("paces October over all 31 of its days", () => {
    expect(
      goalSchedule(october, "UTC", at("2026-10-16T12:00:00Z")).totalDays,
    ).toBe(31);
  });

  it("on the last day, one day is left and the day is not yet over", () => {
    const s = goalSchedule(october, "UTC", at("2026-10-31T12:00:00Z"));
    expect(s.daysLeft).toBe(1);
    expect(s.elapsedDays / s.totalDays).toBeLessThan(1);
    expect(s.elapsedDays).toBeCloseTo(30.5, 5);
  });

  it("is over at the midnight after the deadline day", () => {
    const s = goalSchedule(october, "UTC", at("2026-11-01T00:00:00Z"));
    expect(s.daysLeft).toBe(0);
    expect(s.elapsedDays).toBe(s.totalDays);
  });

  it("paces a week over its seven days", () => {
    const week = {
      periodStart: "2026-10-04",
      periodEnd: "2026-10-11",
      deadlineDay: "2026-10-10",
    };
    expect(
      goalSchedule(week, "UTC", at("2026-10-05T00:00:00Z")).totalDays,
    ).toBe(7);
  });

  it("stops at the period's own end when that comes before the deadline", () => {
    const week = {
      periodStart: "2026-10-04",
      periodEnd: "2026-10-11",
      deadlineDay: "2026-12-31",
    };
    expect(
      goalSchedule(week, "UTC", at("2026-10-05T00:00:00Z")).totalDays,
    ).toBe(7);
  });

  it("counts the house's midnights, not UTC's", () => {
    const s = goalSchedule(
      october,
      "Europe/Istanbul",
      at("2026-10-16T12:00:00Z"),
    );
    expect(s.startAt).toBe(at("2026-09-30T21:00:00Z"));
    expect(s.endAt).toBe(at("2026-10-31T21:00:00Z"));
  });
});

describe("a goal's window (F-864)", () => {
  it("a 'this month' goal set on the 20th counts from the 1st", () => {
    const w = goalWindow(
      {
        period: "month",
        created_at: "2026-10-20T09:00:00Z",
        deadline: "2026-10-31",
      },
      "UTC",
      "2026-10-25",
    );
    expect(w).toEqual({
      periodStart: "2026-10-01",
      periodEnd: "2026-11-01",
      deadlineDay: "2026-10-31",
    });
  });

  it("a custom goal counts from the house day it was set", () => {
    const w = goalWindow(
      {
        period: "custom",
        created_at: "2026-10-20T22:30:00Z",
        deadline: "2026-12-01",
      },
      "America/Los_Angeles",
      "2026-10-25",
    );
    expect(w).toEqual({
      periodStart: "2026-10-20",
      periodEnd: null,
      deadlineDay: "2026-12-01",
    });
  });

  it("a goal past its deadline counts the period the deadline fell in", () => {
    const w = goalWindow(
      {
        period: "month",
        created_at: "2026-09-02T09:00:00Z",
        deadline: "2026-09-30",
      },
      "UTC",
      "2026-10-25",
    );
    expect(w.periodStart).toBe("2026-09-01");
  });
});

describe("a goal's week opens on Monday, the product's week (F-1287)", () => {
  it("counts a Sunday in the week that opened the Monday before", () => {
    expect(goalPeriodStart("week", "Europe/Istanbul", "2026-10-11")).toBe(
      "2026-10-05",
    );
  });

  it("opens a new week on Monday and keeps it through the week", () => {
    expect(goalPeriodStart("week", "Europe/Istanbul", "2026-10-12")).toBe(
      "2026-10-12",
    );
    expect(goalPeriodStart("week", "America/New_York", "2026-10-17")).toBe(
      "2026-10-12",
    );
  });

  it("a weekly goal's window runs Monday to the next Monday", () => {
    const w = goalWindow({ period: "week" }, "UTC", "2026-10-14");
    expect(w.periodStart).toBe("2026-10-12");
    expect(w.periodEnd).toBe("2026-10-19");
  });
});
