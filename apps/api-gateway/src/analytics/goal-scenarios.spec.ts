/**
 * Parity for the book of goal scenarios.
 *
 * A picker entry that names a metric the gateway does not serve is worse than
 * no entry: the manager chooses it, fills in a target, presses the button and
 * gets a 400 saying "Unsupported metric" — a fake control discovered at the
 * moment of commitment. Every cross-reference in `goal-scenarios.ts` is
 * therefore pinned here against the file that actually owns it, so a rename in
 * the goals module or the cutting catalogue breaks a test rather than a page.
 *
 * The second half of these cases is about the honesty of the table itself: no
 * row may carry a target, every published range must carry a URL and a date,
 * and every row that names no metric must say which measure it would need.
 */

import {
  GOAL_SCENARIOS,
  SCENARIO_IDS,
  SCENARIO_PERIODS,
  THE_CAVEAT,
  goalScenarioBook,
  producerFor,
  scenarioById,
} from "./goal-scenarios";
import { GoalsService } from "./goals.service";
import { CUTTING_CATALOGUE } from "./report-cuttings";

describe("goal scenarios — every cross-reference resolves", () => {
  it("names at least one scenario per served metric, and no unserved metric", () => {
    for (const s of GOAL_SCENARIOS) {
      if (s.metricKey === null) continue;
      expect(GoalsService.SUPPORTED_METRICS[s.metricKey]).toBeDefined();
    }
  });

  it("covers every metric the goals module serves", () => {
    // The other direction, and the one that catches a metric being ADDED with
    // no scenario to reach it — a measure nobody can find in the picker.
    const covered = new Set(
      GOAL_SCENARIOS.map((s) => s.metricKey).filter(
        (k): k is string => k !== null,
      ),
    );
    for (const key of Object.keys(GoalsService.SUPPORTED_METRICS)) {
      expect(covered.has(key)).toBe(true);
    }
  });

  it("names only cuttings the reports sheet carries", () => {
    for (const s of GOAL_SCENARIOS) {
      if (s.cuttingId === null) continue;
      expect(
        Object.prototype.hasOwnProperty.call(CUTTING_CATALOGUE, s.cuttingId),
      ).toBe(true);
    }
  });

  it("names only rules the recommendation engine evaluates", () => {
    for (const s of GOAL_SCENARIOS) {
      for (const key of s.ruleKeys) {
        expect(GoalsService.isRecommendationRuleKey(key)).toBe(true);
      }
    }
  });

  it("uses only periods the picker offers", () => {
    for (const s of GOAL_SCENARIOS) {
      expect(SCENARIO_PERIODS).toContain(s.period);
    }
  });

  it("has unique ids, and scenarioById finds each one", () => {
    expect(new Set(SCENARIO_IDS).size).toBe(SCENARIO_IDS.length);
    for (const id of SCENARIO_IDS) expect(scenarioById(id)?.id).toBe(id);
    expect(scenarioById("not-a-scenario")).toBeUndefined();
  });
});

describe("goal scenarios — the honesty rules of the table", () => {
  it("carries no target on any row", () => {
    // The whole point: a scenario says what to measure, never what number to
    // hit. This asserts on the KEYS rather than the values, so a `targetValue`
    // added later fails here even if it is left undefined.
    for (const s of GOAL_SCENARIOS) {
      const keys = Object.keys(s);
      for (const forbidden of ["target", "targetValue", "target_value", "suggestedTarget"]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });

  it("gives every published range a source, a URL and a date", () => {
    for (const s of GOAL_SCENARIOS) {
      if (s.range.kind !== "published") continue;
      expect(s.range.words.trim().length).toBeGreaterThan(0);
      expect(s.range.source.trim().length).toBeGreaterThan(0);
      expect(s.range.url).toMatch(/^https:\/\//);
      expect(s.range.published).toMatch(/^\d{4}(-\d{2}-\d{2})?$/);
      expect(s.range.caveat.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every absent range a reason", () => {
    for (const s of GOAL_SCENARIOS) {
      if (s.range.kind !== "none") continue;
      expect(s.range.why.trim().length).toBeGreaterThan(0);
    }
  });

  it("says which measure it would need, exactly when it names no metric", () => {
    for (const s of GOAL_SCENARIOS) {
      if (s.metricKey === null) {
        expect(typeof s.needsMetric).toBe("string");
        expect((s.needsMetric ?? "").trim().length).toBeGreaterThan(0);
      } else {
        expect(s.needsMetric).toBeNull();
      }
    }
  });

  it("always says why a cutting was chosen, or why none was", () => {
    for (const s of GOAL_SCENARIOS) {
      expect(s.cuttingWhy.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the standing caveat on the payload, not on the rows", () => {
    // A caveat repeated per row can be edited away one row at a time. One
    // constant cannot.
    expect(THE_CAVEAT).toMatch(/not about yours/);
    expect(goalScenarioBook().caveat).toBe(THE_CAVEAT);
  });
});

describe("producerFor — derived from direction, never stored", () => {
  it("sends a floor to goal-reached and a ceiling to ceiling-held", () => {
    // Mirrors the two producers' own filters: GoalReachedProducer skips
    // `at_most` (goal-reached.producer.ts:121) and CeilingHeldProducer selects
    // `.eq("direction", "at_most")` (ceiling-held.producer.ts:95).
    for (const s of GOAL_SCENARIOS) {
      if (s.metricKey === null) {
        expect(producerFor(s)).toBeNull();
        continue;
      }
      expect(producerFor(s)).toBe(
        s.direction === "at_most" ? "ceiling-held" : "goal-reached",
      );
    }
  });

  it("announces nothing for a scenario that cannot be set", () => {
    const unservable = GOAL_SCENARIOS.filter((s) => s.metricKey === null);
    expect(unservable.length).toBeGreaterThan(0);
    for (const s of unservable) expect(producerFor(s)).toBeNull();
  });
});

describe("goalScenarioBook — the served payload", () => {
  const book = goalScenarioBook();

  it("reads no tenant data", () => {
    // The strongest form of this assertion available in a unit test: the
    // function takes no argument, so there is no id it could have read.
    expect(goalScenarioBook.length).toBe(0);
  });

  it("counts servable and unservable, and the two add up", () => {
    expect(book.counts.total).toBe(GOAL_SCENARIOS.length);
    expect(book.counts.servable + book.counts.needsAMetric).toBe(
      book.counts.total,
    );
    expect(book.counts.servable).toBeGreaterThan(0);
    expect(book.counts.needsAMetric).toBeGreaterThan(0);
  });

  it("labels each servable scenario from the goals module, not from itself", () => {
    for (const s of book.scenarios) {
      if (!s.servable) {
        expect(s.metricLabel).toBeNull();
        continue;
      }
      expect(s.metricLabel).toBe(
        GoalsService.SUPPORTED_METRICS[s.metricKey as string].label,
      );
    }
  });

  it("echoes what each named cutting answers, from the cutting catalogue", () => {
    for (const s of book.scenarios) {
      if (s.cuttingId === null) {
        expect(s.cuttingAnswers).toBeNull();
        continue;
      }
      expect(s.cuttingAnswers).toBe(CUTTING_CATALOGUE[s.cuttingId].answers);
    }
  });

  it("hands the picker the same metric list the goals desk uses", () => {
    expect(book.metrics.map((m) => m.key).sort()).toEqual(
      Object.keys(GoalsService.SUPPORTED_METRICS).sort(),
    );
  });
});
