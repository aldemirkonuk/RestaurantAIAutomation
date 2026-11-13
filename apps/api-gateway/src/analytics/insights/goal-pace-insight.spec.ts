import { InsightGeneratorService } from "./insight-generator.service";
import { verbalize } from "./insight-verbalizer";

/**
 * The feed's goal sentence (reports browser walk 2026-11-11, screenshots 01
 * and 02: "You're 0% of the way to 'Wine revenue to 60k'" for every goal).
 *
 * It read the stored `current_value` with no date and no direction: a row
 * nobody had read carried the column's default 0, a "keep at most" goal was
 * scored as if more were better, and a days-of-stock goal, which is read from
 * the till, was paced in a feed every role reads.
 */

const DAY = 86400000;

const LA = "America/Los_Angeles";

function family(
  goals: Array<Record<string, unknown>>,
  house: { zone?: string | null; zoneUnread?: boolean; unread?: string[] } = {},
) {
  const pushed: Array<{ key: string; ev: any; opts: any; sentence: string | null }> = [];
  const fakeThis = {
    record: (key: string, _cat: string, template: string, ev: any, opts: any) => ({
      key,
      ev,
      opts,
      sentence: verbalize(template, ev),
    }),
  };
  (InsightGeneratorService.prototype as any).computeGoalsFamily.call(
    fakeThis,
    {
      availability: new Set(["goals"]),
      goals,
      zone: house.zone === undefined ? LA : house.zone,
      zoneUnread: house.zoneUnread ?? false,
      unread: house.unread ?? [],
    },
    (x: any) => pushed.push(x),
  );
  return pushed;
}

const now = new Date();
const goal = (over: Record<string, unknown>) => ({
  id: "g",
  name: "Wine revenue to 60k",
  metric_key: "wine_revenue",
  direction: "at_least",
  target_value: 60000,
  baseline_value: 0,
  current_value: 30000,
  current_read_at: now.toISOString(),
  current_unread: null,
  created_at: new Date(now.getTime() - 30 * DAY).toISOString(),
  deadline: new Date(now.getTime() + 30 * DAY).toISOString().slice(0, 10),
  ...over,
});

describe("the feed's goal sentence reads a dated reading, by direction", () => {
  it("a row nobody read (default 0, no read stamp) says nothing, not '0% of the way'", () => {
    expect(family([goal({ current_value: 0, current_read_at: null })])).toEqual([]);
  });

  it("a reading the gateway refused says nothing", () => {
    expect(family([goal({ current_unread: "no time zone is set" })])).toEqual([]);
  });

  // Merged with the goals trio (r22): every goal's pace is stored and each
  // read filters it per viewer (ADR 0298 decision 9a; the read is pinned in
  // analytics/days-of-stock-goal-feeds.spec.ts), so a sales holder keeps it.
  it("a days-of-stock goal's pace is stored, for the read to keep for a sales holder", () => {
    expect(
      family([goal({ metric_key: "days_of_inventory", direction: "at_most", target_value: 30, current_value: 40 })]),
    ).toHaveLength(1);
  });

  it("a target half reached at half time", () => {
    const [x] = family([goal({})]);
    expect(x.sentence).toMatch(/^You're 50% of the way to "Wine revenue to 60k" with (30|31) days left\. Current pace gets you there\.$/);
  });

  it("a ceiling held reads as a ceiling, not as progress toward it", () => {
    const [x] = family([
      goal({ name: "Keep purchases under $25k", metric_key: "purchase_spend", direction: "at_most", target_value: 25000, current_value: 10000 }),
    ]);
    expect(x.sentence).toMatch(/^"Keep purchases under \$25k" stands at 40% of its ceiling with (30|31) days left\. At this pace it stays under\.$/);
    expect(x.opts.effectPct).toBe(0);
  });

  it("a ceiling broken says over", () => {
    const [x] = family([
      goal({ name: "Keep purchases under $25k", metric_key: "purchase_spend", direction: "at_most", target_value: 25000, current_value: 30000 }),
    ]);
    expect(x.sentence).toMatch(/^"Keep purchases under \$25k" is over its ceiling: 120% of it with (30|31) days left\.$/);
    expect(x.opts.boost).toBe(1.5);
  });

  it("an older reading is dated", () => {
    const at = new Date(now.getTime() - 2 * DAY);
    const [x] = family([goal({ current_read_at: at.toISOString() })]);
    // By the house's day, as the desk files its days.
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: LA }).format(at);
    expect(x.sentence).toContain(`(read on ${day})`);
  });
});

describe("the feed schedules a goal on the desk's clock (fix round 2026-11-12)", () => {
  // Los Angeles in January (UTC-8). Created 10:00 on the 13th, deadline the
  // 15th, read at 20:00 on the 14th, 85 of 100. The desk's schedule runs
  // midnight to midnight on the house's clock (48 h, 44 run): on pace. The
  // feed used the raw creation instant and UTC's midnight, which had closed
  // four hours before the reading, and called the same goal behind.
  const edge = (over: Record<string, unknown> = {}) =>
    goal({
      target_value: 100,
      current_value: 85,
      created_at: "2026-01-13T18:00:00Z",
      deadline: "2026-01-15",
      current_read_at: "2026-01-15T04:00:00Z",
      ...over,
    });

  it("a goal the desk calls on pace reads on pace here", () => {
    const [x] = family([edge()]);
    expect(x.ev.goalOnTrack).toBe(true);
    expect(x.ev.goalReadOn).toBe("2026-01-14");
    expect(x.opts.boost).toBe(1);
  });

  it("control: well short of its pace is behind", () => {
    const [x] = family([edge({ current_value: 60 })]);
    expect(x.ev.goalOnTrack).toBe(false);
  });

  it("no zone: the progress is said, the pace is not", () => {
    const [x] = family([edge({ current_value: 60 })], { zone: null });
    expect(x.ev.goalOnTrack).toBeUndefined();
    expect(x.ev.goalProgressPct).toBeCloseTo(0.6);
  });

  it("a failed zone read that held a pace back is named once", () => {
    const unread: string[] = [];
    family([edge({ id: "a" }), edge({ id: "b" })], { zone: null, zoneUnread: true, unread });
    expect(unread).toEqual(["house time zone"]);
  });
});
