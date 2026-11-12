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

function family(goals: Array<Record<string, unknown>>) {
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
    { availability: new Set(["goals"]), goals },
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

  it("a days-of-stock goal is not paced in a feed every role reads", () => {
    expect(
      family([goal({ metric_key: "days_of_inventory", direction: "at_most", target_value: 30, current_value: 40 })]),
    ).toEqual([]);
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
    expect(x.sentence).toContain(`(read on ${at.toISOString().slice(0, 10)})`);
  });
});
