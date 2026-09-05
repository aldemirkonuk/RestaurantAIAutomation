/**
 * The cadence model is asserted the way `commodity-calibration.spec.ts` asserts
 * the calibration: against the RECORDED fixture, on values, not shapes.
 *
 * Two properties matter more than any single number here and each has its own
 * test below, because getting either wrong would make the alert look profitable
 * when it is not:
 *
 *   the carrying cost is TRIANGULAR in the horizon, not linear;
 *   the pass-through attenuates the BENEFIT and never the COST.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  CADENCE_LADDER,
  backtestCadence,
  carryFractionFor,
  forwardSum,
  horizonFitsShelfLife,
  isCadenceRefusal,
  valueBacktest,
  valueClause,
  type CadenceBacktest,
} from "./cadence-value";
import { parseFao } from "./parse-fao";

/** The recorded FAO fixture: 40 monthly observations, 2023-05 … 2026-08. */
const VALUES = parseFao(
  readFileSync(
    join(__dirname, "__fixtures__", "fao-food-price-index-2026-09-05.sample.csv"),
    "utf8",
  ),
  { seriesKey: "fao.food_price_index.all", fetchedAt: "2026-09-05T12:00:00.000Z" },
)
  .observations.sort((a, b) => a.periodStart.localeCompare(b.periodStart))
  .map((o) => o.value);

function run(firesPerYear: number, horizon = 3, mode?: "in_sample" | "walk_forward") {
  const out = backtestCadence(VALUES, {
    firesPerYear,
    periodGrain: "month",
    horizon,
    mode,
  });
  if (isCadenceRefusal(out)) throw new Error(`refused: ${out.reason}`);
  return out as CadenceBacktest;
}

const NO_HOUSE = {
  carryPerPeriod: 0.005,
  passThrough: null,
  periodSpend: null,
  currency: null,
  attentionPerFire: null,
  shelfLifeDays: 180,
  daysPerPeriod: 30,
};

describe("the model cannot write, and cannot read a clock", () => {
  it("imports no database, no Nest, no clock and no filesystem", () => {
    const src = readFileSync(join(__dirname, "cadence-value.ts"), "utf8");
    const imports = src
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l))
      .join("\n");
    expect(imports).not.toMatch(/DatabaseService|@nestjs|supabase|from "fs"/);
    expect(src).not.toMatch(/\.from\(/);
    // A horizon counted from `Date.now()` would make the same recorded bytes
    // produce a different answer next month, which is the one thing a backtest
    // may never do.
    expect(src).not.toMatch(/Date\.now|new Date\(/);
  });
});

describe("a cadence finer than the series is refused BY NAME, not clamped", () => {
  it("refuses weekly and fortnightly on a monthly series", () => {
    for (const label of ["weekly", "fortnightly"] as const) {
      const c = CADENCE_LADDER.find((x) => x.label === label)!;
      const out = backtestCadence(VALUES, {
        firesPerYear: c.firesPerYear,
        periodGrain: "month",
        horizon: 3,
      });
      expect(isCadenceRefusal(out)).toBe(true);
      if (!isCadenceRefusal(out)) return;
      expect(out.reason).toBe("finer_than_the_series_publishes");
      // The sentence has to carry both numbers, or the person reading it
      // cannot tell why the thing they asked for is not on offer.
      expect(out.detail).toContain("12 times a year");
      expect(out.detail).toContain(`${c.firesPerYear} fires a year`);
    }
  });

  it("refuses the monthly cadence on this series for a DIFFERENT reason", () => {
    // At twelve fires a year on a monthly series the quantile collapses to the
    // minimum observed move, which on this history is a fall. There is no
    // threshold, and that is not the same refusal as asking for weekly.
    const out = backtestCadence(VALUES, {
      firesPerYear: 12,
      periodGrain: "month",
      horizon: 3,
    });
    expect(isCadenceRefusal(out)).toBe(true);
    if (!isCadenceRefusal(out)) return;
    expect(out.reason).toBe("no_threshold");
  });

  it("names an unknown grain rather than assuming twelve", () => {
    const out = backtestCadence(VALUES, {
      firesPerYear: 2,
      periodGrain: "fortnight",
      horizon: 3,
    });
    expect(isCadenceRefusal(out)).toBe(true);
    if (!isCadenceRefusal(out)) return;
    expect(out.reason).toBe("unknown_grain");
  });

  it("refuses a history too short to hold a threshold AND a horizon", () => {
    const out = backtestCadence(VALUES.slice(-37), {
      firesPerYear: 2,
      periodGrain: "month",
      horizon: 3,
    });
    expect(isCadenceRefusal(out)).toBe(true);
    if (!isCadenceRefusal(out)) return;
    expect(out.reason).toBe("too_short_a_history");
  });
});

describe("the recorded 40-observation window, measured", () => {
  it("reads the fixture it says it reads", () => {
    expect(VALUES).toHaveLength(40);
    expect(VALUES[0]).toBe(124.5);
    expect(VALUES[39]).toBe(133.3);
  });

  it("quarterly: 8 fires in 24 evaluable months, threshold 3.10 %", () => {
    const r = run(4);
    expect(r.evaluated).toBe(24);
    expect(r.fires).toBe(8);
    expect(r.riseThreshold).toBeCloseTo(0.0309566, 6);
    expect(r.stepGuard).toBeCloseTo(0.0254980, 6);
    expect(r.hits).toBe(5);
    expect(r.hitRate).toBeCloseTo(0.625, 6);
    expect(r.meanGrossFraction).toBeCloseTo(0.0121541, 6);
    expect(r.firesPerYearRealised).toBeCloseTo(4, 6);
  });

  it("REPORTS A NEGATIVE LIFT rather than hiding one", () => {
    // On this short window the rule is WORSE than buying ahead at a random
    // month, at every cadence. A backtest that only surfaced the flattering
    // comparison would be the absence-reported-as-health shape with a number
    // attached, so the benchmark is computed whether or not it wins.
    for (const f of [4, 2, 1]) {
      const r = run(f);
      expect(r.benchmarkMeanGrossFraction).toBeCloseTo(0.0200919, 6);
      expect(r.lift).not.toBeNull();
      expect(r.lift as number).toBeLessThan(0);
    }
    expect(run(1).hitRate).toBe(0);
    expect(run(1).meanGrossFraction).toBeCloseTo(-0.0240614, 6);
  });

  it("a walk-forward on 40 observations has almost nothing to measure", () => {
    // The floor is 36 and the horizon is 3, so exactly one month in this window
    // both has a threshold derivable from its own past and an outcome. The
    // module produces that 1 rather than a number that looks like evidence.
    const r = run(4, 3, "walk_forward");
    expect(r.evaluated).toBe(1);
    expect(r.fires).toBe(0);
  });

  it("a fire's threshold in force is the one that decided it", () => {
    const r = run(2);
    for (const o of r.outcomes) {
      expect(o.thresholdInForce).toBeCloseTo(r.riseThreshold, 12);
      expect(o.move).toBeGreaterThanOrEqual(o.thresholdInForce);
      expect(o.forwardMoves).toHaveLength(3);
      expect(o.grossFraction).toBeCloseTo(
        o.forwardMoves.reduce((a, b) => a + b, 0),
        12,
      );
    }
  });
});

describe("the carrying cost is triangular in the horizon", () => {
  it("three periods of cover at 2 % a period costs 12 %, not 6 %", () => {
    // The unit bought for the first period ahead sits one period, the second
    // two, the third three: six unit-periods, not three. `carry x H` would
    // understate a three-period stock-up threefold, in the direction that
    // makes the alert look profitable.
    expect(carryFractionFor(0.02, 3)).toBeCloseTo(0.12, 12);
    expect(carryFractionFor(0.02, 1)).toBeCloseTo(0.02, 12);
    expect(carryFractionFor(0.02, 6)).toBeCloseTo(0.42, 12);
  });

  it("grows faster than the horizon does", () => {
    const one = carryFractionFor(0.01, 1);
    expect(carryFractionFor(0.01, 2)).toBeGreaterThan(2 * one);
    expect(carryFractionFor(0.01, 4)).toBeGreaterThan(4 * one);
  });
});

describe("pass-through attenuates the benefit and never the cost", () => {
  // Thirteen flat periods then a sustained climb, so that a fire has a positive
  // forward move to attenuate. A synthetic array and not a fixture, because
  // this test asserts an ALGEBRAIC property of the pricing and not a claim
  // about any series.
  const RISING = [
    100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 105, 112,
    120, 129, 139,
  ];

  it("halving the pass-through more than halves the net", () => {
    const r = backtestCadence(RISING, {
      firesPerYear: 12,
      periodGrain: "month",
      horizon: 2,
      historyFloor: 14,
    });
    expect(isCadenceRefusal(r)).toBe(false);
    if (isCadenceRefusal(r)) return;
    const full = valueBacktest(r, { ...NO_HOUSE, passThrough: 1 });
    const half = valueBacktest(r, { ...NO_HOUSE, passThrough: 0.5 });
    expect(full.netFractionPerFire).not.toBeNull();
    expect(half.netFractionPerFire).not.toBeNull();
    const f = full.netFractionPerFire as number;
    const h = half.netFractionPerFire as number;
    expect(f).toBeGreaterThan(0);
    // If the cost scaled with the pass-through too, this would be exactly f/2.
    expect(h).toBeLessThan(f / 2);
    // And the cost is identical in both.
    expect(half.carryFraction).toBeCloseTo(full.carryFraction, 12);
  });

  it("states the break-even pass-through even when everything else is withheld", () => {
    const r = run(4);
    const v = valueBacktest(r, NO_HOUSE);
    expect(v.withheld).toBe("pass_through_unset");
    expect(v.moneyPerFire).toBeNull();
    expect(v.breakEvenPassThrough).toBeCloseTo(2.4683124, 6);
    // Above 1: on this window no pass-through whatever makes buying ahead pay,
    // and the sentence says so instead of printing a saving.
    expect(v.breakEvenPassThrough as number).toBeGreaterThan(1);
    expect(valueClause(v)).toContain("246.8%");
    expect(valueClause(v)).not.toMatch(/\bsave\b/);
  });

  it("has no break-even at all when the average outcome was a fall", () => {
    const r = run(1);
    expect(valueBacktest(r, NO_HOUSE).breakEvenPassThrough).toBeNull();
  });
});

describe("money is withheld by name, never defaulted", () => {
  const r = () => run(4);

  it("refuses on shelf life BEFORE it looks at money", () => {
    const v = valueBacktest(r(), { ...NO_HOUSE, shelfLifeDays: null });
    expect(v.withheld).toBe("no_shelf_life_typed");
    expect(v.moneyPerFire).toBeNull();
  });

  it("refuses a horizon the item cannot survive", () => {
    // Three monthly periods is up to 90 days of holding; 21 days does not
    // reach it, and no amount of gain rescues goods that spoiled.
    const v = valueBacktest(r(), { ...NO_HOUSE, shelfLifeDays: 21 });
    expect(v.withheld).toBe("does_not_keep_long_enough");
    expect(v.withheldDetail).toContain("90 days");
  });

  it("walks the remaining refusals in order", () => {
    const withPhi = { ...NO_HOUSE, passThrough: 1 };
    expect(valueBacktest(r(), withPhi).withheld).toBe("no_house_spend");
    expect(
      valueBacktest(r(), { ...withPhi, periodSpend: 1000 }).withheld,
    ).toBe("no_currency");
    expect(
      valueBacktest(r(), { ...withPhi, periodSpend: 1000, currency: "USD" })
        .withheld,
    ).toBe("no_attention_cost");
  });

  it("prices a fire once every parameter is stated", () => {
    const v = valueBacktest(r(), {
      ...NO_HOUSE,
      passThrough: 1,
      periodSpend: 1000,
      currency: "USD",
      attentionPerFire: 8,
    });
    expect(v.withheld).toBeNull();
    expect(v.carryFraction).toBeCloseTo(0.03, 12);
    expect(v.netFractionPerFire).toBeCloseTo(-0.0178459, 6);
    expect(v.lossRate).toBeCloseTo(0.75, 12);
    expect(v.moneyPerFire).toBeCloseTo(-25.8459469, 6);
    expect(v.moneyPerYear).toBeCloseTo(-103.3837878, 6);
    expect(valueClause(v)).toContain("cost about 25.85 USD");
  });

  it("says nothing fired rather than pricing an empty set", () => {
    const r0 = run(4, 3, "walk_forward");
    const v = valueBacktest(r0, {
      ...NO_HOUSE,
      passThrough: 1,
      periodSpend: 1000,
      currency: "USD",
      attentionPerFire: 8,
    });
    expect(v.withheld).toBe("nothing_fired");
    expect(v.moneyPerYear).toBeNull();
  });
});

describe("the two guards a horizon needs", () => {
  it("an absent shelf life is never read as 'it keeps'", () => {
    expect(horizonFitsShelfLife(null, 1, 30)).toBe(false);
    expect(horizonFitsShelfLife(0, 1, 30)).toBe(false);
    expect(horizonFitsShelfLife(-5, 1, 30)).toBe(false);
  });

  it("compares days with days, at the boundary", () => {
    expect(horizonFitsShelfLife(90, 3, 30)).toBe(true);
    expect(horizonFitsShelfLife(89, 3, 30)).toBe(false);
    expect(horizonFitsShelfLife(30, 1, 30)).toBe(true);
  });

  it("a fire with no measurable outcome is null, not zero", () => {
    // The last three months of a recorded window have no t+3. Counting them as
    // a zero gain would silently drag every mean toward nothing.
    expect(forwardSum(VALUES, 39, 3)).toBeNull();
    expect(forwardSum(VALUES, 37, 3)).toBeNull();
    expect(forwardSum(VALUES, 36, 3)).not.toBeNull();
    const f = forwardSum([100, 110, 121], 0, 2);
    expect(f?.moves[0]).toBeCloseTo(0.1, 12);
    expect(f?.moves[1]).toBeCloseTo(0.21, 12);
    expect(f?.sum).toBeCloseTo(0.31, 12);
  });
});
