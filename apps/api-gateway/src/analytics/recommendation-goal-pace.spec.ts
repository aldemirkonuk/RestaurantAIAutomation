import { goalBehindPace } from "./recommendations.service";

/**
 * The "goal is behind its pace" card judges a goal the way the goals desk
 * does (F-383, ADR 0296): from the house date the goal was set on, to the
 * midnight that opens its deadline day, both on the house's clock; an
 * at-most goal is behind when it is OVER its share; a goal not yet measured
 * is not judged at all.
 */
const LA = "America/Los_Angeles";

describe("goalBehindPace (F-383)", () => {
  // Set at 23:00 on Sep 30 in Los Angeles (06:00 UTC on Oct 1), due Oct 11.
  // On the house's clock the schedule runs Sep 30 00:00 → Oct 11 00:00 PDT,
  // eleven days; an hour after it was set, one day of it has passed.
  const setLate = {
    target_value: 110,
    direction: "at_least",
    deadline: "2026-10-11",
    created_at: "2026-10-01T06:00:00Z",
  };
  const anHourLater = Date.parse("2026-10-01T07:00:00Z");

  it("paces from the house date the goal was set on, not the UTC instant", () => {
    // One day of eleven is 10 expected; 8 is under 90% of that.
    expect(goalBehindPace({ ...setLate, current_value: 8 }, LA, anHourLater)).toBe(true);
    expect(goalBehindPace({ ...setLate, current_value: 10 }, LA, anHourLater)).toBe(false);
  });

  const halfway = {
    target_value: 1000,
    deadline: "2026-10-31",
    created_at: "2026-10-01T19:00:00Z",
  };
  // Oct 16 00:00 PDT: fifteen of thirty house days have passed.
  const midMonth = Date.parse("2026-10-16T07:00:00Z");

  it("an at-most goal under its share of the limit is not behind", () => {
    expect(
      goalBehindPace({ ...halfway, direction: "at_most", current_value: 100 }, LA, midMonth),
    ).toBe(false);
  });

  it("an at-most goal over its share of the limit is behind", () => {
    expect(
      goalBehindPace({ ...halfway, direction: "at_most", current_value: 700 }, LA, midMonth),
    ).toBe(true);
  });

  it("an at-least goal under its share is behind, over it is not", () => {
    expect(goalBehindPace({ ...halfway, current_value: 300 }, LA, midMonth)).toBe(true);
    expect(goalBehindPace({ ...halfway, current_value: 600 }, LA, midMonth)).toBe(false);
  });

  it("a goal not yet measured is not judged — never read as 0% done", () => {
    expect(goalBehindPace({ ...halfway, current_value: null }, LA, midMonth)).toBe(false);
  });

  it("a house with no zone, or a goal with no deadline, is not judged", () => {
    expect(goalBehindPace({ ...halfway, current_value: 0 }, null, midMonth)).toBe(false);
    expect(
      goalBehindPace({ ...halfway, deadline: null, current_value: 0 }, LA, midMonth),
    ).toBe(false);
  });
});
