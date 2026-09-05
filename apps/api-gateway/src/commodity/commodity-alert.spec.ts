/**
 * The alert arithmetic. Pure, so every rule is tested as a rule.
 *
 * The load-bearing claims are the two the plan says the design rests on: that a
 * threshold derived from a series' OWN history is not a global constant, and
 * that a "no" always carries a reason. Both are asserted against numbers rather
 * than shapes.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_BASELINE_K,
  OBSERVATIONS_PER_YEAR,
  THRESHOLD_HISTORY_FLOOR,
  UNEVALUATED_CONDITIONS,
  decideCommoditySignal,
  deriveThreshold,
  median,
  moveAgainstBaseline,
  movesOverHistory,
  quantile,
  quantileCeilingRank,
  stepAtLatest,
} from "./commodity-alert";
import { parseFao } from "./parse-fao";

const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__", "fao-food-price-index-2026-09-05.sample.csv"),
  "utf8",
);
/** The recorded fixture's 40 real monthly values, ascending by period. */
const FAO_VALUES = parseFao(FIXTURE, {
  seriesKey: "fao.food_price_index.all",
  fetchedAt: "2026-09-05T12:00:00.000Z",
})
  .observations.sort((a, b) => a.periodStart.localeCompare(b.periodStart))
  .map((o) => o.value);

/** A base the decision needs but is not what any one test is about. */
const OK = {
  redistribution: "unstated",
  fresh: true,
  liveExposures: 1,
  daysSinceLastSaid: null,
};

describe("the pieces", () => {
  it("takes a median, not a mean, so one revision cannot move the baseline", () => {
    expect(median([1, 2, 3, 4, 100])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("interpolates the RISE quantile, because nearest-rank steps past the budget", () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([0, 1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([], 0.5)).toBeNull();
  });

  it("rounds the STEP GUARD up to a move the market really made", () => {
    // The asymmetry is the point: a guard that lands between two real
    // observations refuses one of them as a probable bad parse. Measured on the
    // full 440-row FAO series, interpolation put p99 at 7.49% -- between a
    // 6.98% month and a 7.80% month -- and nearest rank puts it at 7.80%, the
    // figure the plan's own table publishes.
    expect(quantileCeilingRank([0, 10], 0.5)).toBe(0);
    expect(quantileCeilingRank([1, 2, 3, 4], 0.99)).toBe(4);
    expect(quantileCeilingRank([], 0.99)).toBeNull();
    // Never a value the sample does not contain.
    const sample = [0.01, 0.02, 0.9];
    expect(sample).toContain(quantileCeilingRank(sample, 0.99));
  });

  it("counts the baseline in OBSERVATIONS and stops one period short of the move", () => {
    // v_t = 20, v_(t-1) = 10, baseline = median of the K=3 before that.
    const m = moveAgainstBaseline([4, 5, 6, 10, 20], 3);
    expect(m?.baseline).toBe(5);
    expect(m?.latest).toBe(20);
    expect(m?.move).toBe(3);
    // A baseline that included v_(t-1) would be partly made of the move.
  });

  it("returns null below K + 2 observations, which is the plan's condition 1", () => {
    expect(moveAgainstBaseline([1, 2, 3, 4], 3)).toBeNull();
    expect(moveAgainstBaseline([1, 2, 3, 4, 5], 3)).not.toBeNull();
  });

  it("measures the single step as a magnitude, so a crash guards too", () => {
    expect(stepAtLatest([100, 50])).toBeCloseTo(0.5, 10);
    expect(stepAtLatest([50, 100])).toBeCloseTo(1, 10);
    expect(stepAtLatest([100])).toBeNull();
  });
});

describe("the threshold is derived from the series' own history", () => {
  it("gives NO threshold at all below the history floor, and that is an answer", () => {
    const short = FAO_VALUES.slice(-(THRESHOLD_HISTORY_FLOOR - 1));
    expect(
      deriveThreshold(short, { firesPerYear: 2, observationsPerYear: 12 }),
    ).toBeNull();
    // And the rule then refuses BY NAME rather than never firing quietly.
    const d = decideCommoditySignal({ ...OK, values: short, riseThreshold: null, stepGuard: null });
    expect(d.verdict).toBe("no_threshold");
    expect(d.reason).toMatch(/cannot fire for it at all/);
  });

  it("derives one from the 40 real FAO observations in the fixture", () => {
    const t = deriveThreshold(FAO_VALUES, {
      firesPerYear: 2,
      observationsPerYear: OBSERVATIONS_PER_YEAR.month,
    })!;
    expect(t).not.toBeNull();
    expect(t.riseThreshold).toBeGreaterThan(0);
    expect(t.stepGuard).toBeGreaterThan(0);
    expect(t.nObs).toBe(FAO_VALUES.length - (DEFAULT_BASELINE_K + 1));
    expect(t.firesPerYear).toBe(2);
  });

  it("a TIGHTER budget produces a HIGHER threshold, monotonically", () => {
    // This is the whole mechanism: the operator sets a frequency and the code
    // reads the percentage off the data, so the number always means the same
    // thing across series even though its value never does.
    const four = deriveThreshold(FAO_VALUES, { firesPerYear: 4, observationsPerYear: 12 })!;
    const two = deriveThreshold(FAO_VALUES, { firesPerYear: 2, observationsPerYear: 12 })!;
    const one = deriveThreshold(FAO_VALUES, { firesPerYear: 1, observationsPerYear: 12 })!;
    expect(two.riseThreshold).toBeGreaterThan(four.riseThreshold);
    expect(one.riseThreshold).toBeGreaterThan(two.riseThreshold);
  });

  it("produces the budget it was asked for, counted on the series' own history", () => {
    // The claim the sentence on the screen makes ("you asked to hear about this
    // about twice a year") is only honest if it is true of the data it was read
    // off. So: count the fires.
    const moves = movesOverHistory(FAO_VALUES, DEFAULT_BASELINE_K);
    const t = deriveThreshold(FAO_VALUES, { firesPerYear: 4, observationsPerYear: 12 })!;
    const fires = moves.filter((m) => m >= t.riseThreshold).length;
    const impliedPerYear = (fires / moves.length) * 12;
    expect(impliedPerYear).toBeGreaterThan(2);
    expect(impliedPerYear).toBeLessThan(6);
  });

  it("refuses to derive a threshold from a flat series rather than returning zero", () => {
    const flat = new Array(60).fill(100);
    expect(deriveThreshold(flat, { firesPerYear: 2, observationsPerYear: 12 })).toBeNull();
  });
});

describe("every 'no' carries a reason, and the order of the conditions is the plan's", () => {
  const values = FAO_VALUES;
  const armed = { riseThreshold: 0.02, stepGuard: 0.5 };

  it("refuses a history shorter than K + 2 before anything else", () => {
    const d = decideCommoditySignal({ ...OK, ...armed, values: values.slice(-5) });
    expect(d.verdict).toBe("too_short_a_history");
    expect(d.reason).toMatch(/never a number of days/);
  });

  it("refuses an implausible STEP against the series' own p99, not a global ceiling", () => {
    // The measured casualty of a global ceiling: a 35% "probably a bad parse"
    // bound refused 25 of 114 evaluated months on the wholesale egg series,
    // whose real p99 month-on-month move is 82%.
    const spiked = [...values, values.at(-1)! * 2];
    const d = decideCommoditySignal({ ...OK, ...armed, values: spiked });
    expect(d.verdict).toBe("implausible_step");
    expect(d.reason).toMatch(/99th-percentile step/);
    expect(d.reason).toMatch(/Refused and named rather than dropped/);
  });

  it("refuses a move below the floor and states BOTH numbers", () => {
    const d = decideCommoditySignal({
      ...OK,
      values,
      riseThreshold: 0.95,
      stepGuard: 0.5,
    });
    expect(d.verdict).toBe("below_floor");
    expect(d.reason).toMatch(/above its 12-observation median/);
    expect(d.reason).toMatch(/95\.0%/);
  });

  it("refuses to alert on a series nobody may republish, because an alert IS publication", () => {
    const d = decideCommoditySignal({
      ...OK,
      ...armed,
      values,
      redistribution: "prohibited",
    });
    expect(d.verdict).toBe("may_not_be_published");
  });

  it("refuses a stale series and repeats the gate's own words", () => {
    const d = decideCommoditySignal({
      ...OK,
      ...armed,
      values,
      fresh: false,
      staleReason: "the newest posting is 400 days old",
    });
    expect(d.verdict).toBe("stale");
    expect(d.reason).toBe("the newest posting is 400 days old");
  });

  it("refuses when nobody has mapped an item to the series, and infers nothing", () => {
    const d = decideCommoditySignal({ ...OK, ...armed, values, liveExposures: 0 });
    expect(d.verdict).toBe("no_exposure_mapped");
    expect(d.reason).toMatch(/publishes no accuracy figure/);
  });

  it("refuses inside the quiet window", () => {
    const d = decideCommoditySignal({
      ...OK,
      ...armed,
      values,
      daysSinceLastSaid: 3,
    });
    expect(d.verdict).toBe("already_said");
    expect(d.reason).toMatch(/one signal, not thirty/);
  });

  it("says would_notify with its whole working when every condition holds", () => {
    const d = decideCommoditySignal({ ...OK, ...armed, values });
    expect(d.verdict).toBe("would_notify");
    expect(d.move).not.toBeNull();
    expect(d.baseline).not.toBeNull();
    expect(d.latest).toBe(FAO_VALUES.at(-1));
    expect(d.reason).toMatch(/above the 12-observation median of/);
  });
});

describe("the two conditions this tree cannot evaluate are NAMED on every decision", () => {
  it("carries them on a fire and on a refusal alike", () => {
    // A rule that silently skipped an unevaluable condition would be reporting
    // ABSENCE as HEALTH: a condition nobody could check, rendered as one that
    // passed. Measured: zero shelf-life columns across every migration.
    const fired = decideCommoditySignal({
      ...OK,
      values: FAO_VALUES,
      riseThreshold: 0.02,
      stepGuard: 0.5,
    });
    const refused = decideCommoditySignal({
      ...OK,
      values: FAO_VALUES,
      riseThreshold: null,
      stepGuard: null,
    });
    expect(fired.verdict).toBe("would_notify");
    expect(fired.unevaluated).toEqual(UNEVALUATED_CONDITIONS);
    expect(refused.unevaluated).toEqual(UNEVALUATED_CONDITIONS);
    expect(UNEVALUATED_CONDITIONS.join(" ")).toMatch(/shelf life/);
  });
});
