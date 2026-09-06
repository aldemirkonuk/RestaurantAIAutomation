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
  commodityAlertSentence,
  isCadenceRefusal,
  moneyState,
  percentPerMonthToFraction,
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
    expect(full.carryFraction).not.toBeNull();
    expect(half.carryFraction).toBeCloseTo(full.carryFraction as number, 12);
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

  it("refuses the carrying cost BEFORE it looks at the pass-through", () => {
    // The founder's gate, batch 59. Without it there is no cost side at all.
    const v = valueBacktest(r(), { ...NO_HOUSE, carryPerPeriod: null });
    expect(v.withheld).toBe("no_carrying_cost_typed");
    expect(v.carryFraction).toBeNull();
    // Not zero, anywhere. Zero would price holding three months as free.
    expect(v.breakEvenPassThrough).toBeNull();
    expect(v.moneyPerFire).toBeNull();
  });

  it("never prints a saving that is not positive", () => {
    // Everything IS stated here and the honest answer is that buying ahead on
    // this window loses money. The old shape printed "cost about 25.85 USD" as
    // if that were a finding; it is a saving of nothing, and the sentence now
    // says the line is not worth the interruption instead.
    const v = valueBacktest(r(), {
      ...NO_HOUSE,
      passThrough: 1,
      periodSpend: 1000,
      currency: "USD",
      attentionPerFire: 8,
    });
    expect(v.carryFraction).toBeCloseTo(0.03, 12);
    expect(v.netFractionPerFire).toBeCloseTo(-0.0178459, 6);
    expect(v.lossRate).toBeCloseTo(0.75, 12);
    expect(v.withheld).toBe("below_spend_floor");
    expect(v.moneyPerFire).toBeNull();
    expect(v.moneyPerYear).toBeNull();
    // No spend is large enough when the net itself is negative.
    expect(v.minimumPeriodSpend).toBeNull();
    expect(valueClause(v)).not.toMatch(/[0-9]+\.[0-9]{2} USD/);
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

describe("percent per month is converted in exactly one place", () => {
  it("0.75 percent a month is the fraction 0.0075, not 0.75 and not 75", () => {
    // The column stores a PERCENT and this model takes a FRACTION. The two
    // differ by a hundred, and the wrong one understates the carrying cost into
    // invisibility — the direction that makes the alert look profitable.
    expect(percentPerMonthToFraction(0.75)).toBeCloseTo(0.0075, 12);
    expect(percentPerMonthToFraction(25)).toBeCloseTo(0.25, 12);
    expect(percentPerMonthToFraction(0.01)).toBeCloseTo(0.0001, 12);
  });

  it("an untyped carrying cost stays untyped, and never becomes zero", () => {
    expect(percentPerMonthToFraction(null)).toBeNull();
    expect(percentPerMonthToFraction(Number.NaN)).toBeNull();
  });
});

describe("the alert sentence has three money states and only three", () => {
  // Thirteen flat periods then a sustained climb: a series on which buying
  // ahead genuinely paid, so the STATED form has something to state.
  const RISING = [
    100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 105, 112,
    120, 129, 139,
  ];
  const run = () => {
    const out = backtestCadence(RISING, {
      firesPerYear: 12,
      periodGrain: "month",
      horizon: 2,
      historyFloor: 14,
    });
    if (isCadenceRefusal(out)) throw new Error(out.reason);
    return out as CadenceBacktest;
  };
  const HOUSE = {
    // 0.5 % a month, as a person would type it on the settings page.
    carryPerPeriod: percentPerMonthToFraction(0.5),
    passThrough: 1,
    periodSpend: 1000,
    currency: "TRY",
    attentionPerFire: 8,
    shelfLifeDays: 180,
    daysPerPeriod: 30,
  };
  const FACTS = {
    seriesLabel: "Shell eggs, national wholesale",
    issuer: "USDA Agricultural Marketing Service",
    issuedOn: "4 September 2026",
    unit: "cents a dozen",
    tradeLevel: "graded loose, white, Large, FOB",
    latest: "48.0",
    baseline: "35.3",
    move: 0.36,
    itemLabel: "Eggs, large, 15-dozen case",
    shelfLifeDays: 180,
    firesPerYear: 2,
    realisedFiresPerYear: 2.27,
  };

  it("STATED — the house typed a carrying cost and a person typed a shelf life", () => {
    const v = valueBacktest(run(), HOUSE);
    expect(moneyState(v)).toBe("stated");
    expect(v.carryFraction).toBeCloseTo(0.015, 12);
    expect(v.netFractionPerFire).toBeCloseTo(0.2070238, 6);
    expect(v.moneyPerFire).toBeCloseTo(199.0238095, 6);
    expect(v.minimumPeriodSpend).toBeCloseTo(38.6428982, 6);
    const clause = valueClause(v);
    expect(clause).toContain("saved about 199.02 TRY");
    expect(clause).not.toMatch(/UNMEASURED/);
  });

  it("UNMEASURED — no carrying cost typed, and the sentence says which number is missing", () => {
    const v = valueBacktest(run(), { ...HOUSE, carryPerPeriod: null });
    expect(moneyState(v)).toBe("unmeasured");
    expect(v.withheld).toBe("no_carrying_cost_typed");
    const clause = valueClause(v);
    expect(clause).toContain("UNMEASURED");
    expect(clause).toContain("what holding stock costs it");
    // The one thing it must never do: print a number nobody stated.
    expect(clause).not.toMatch(/TRY/);
    expect(clause).not.toMatch(/[0-9]+\.[0-9]{2}/);
  });

  it("UNMEASURED — no shelf life typed is a DIFFERENT sentence from no carrying cost", () => {
    const noShelf = valueBacktest(run(), { ...HOUSE, shelfLifeDays: null });
    const noCarry = valueBacktest(run(), { ...HOUSE, carryPerPeriod: null });
    expect(moneyState(noShelf)).toBe("unmeasured");
    expect(valueClause(noShelf)).toContain("shelf life");
    expect(valueClause(noShelf)).not.toEqual(valueClause(noCarry));
  });

  it("TOO SMALL — everything is known and the answer is the spend floor", () => {
    const v = valueBacktest(run(), { ...HOUSE, periodSpend: 30 });
    expect(moneyState(v)).toBe("too_small");
    expect(v.withheld).toBe("below_spend_floor");
    expect(v.minimumPeriodSpend).toBeCloseTo(38.6428982, 6);
    const clause = valueClause(v);
    // The floor itself is printed as the reason, which is what makes this a
    // finding rather than a silence.
    expect(clause).toContain("above about 39");
    expect(clause).toContain("8 TRY it costs to read");
    expect(v.moneyPerFire).toBeNull();
  });

  it("the whole sentence carries the issuer, the trade level and the realised rate", () => {
    const stated = commodityAlertSentence(FACTS, valueBacktest(run(), HOUSE));
    expect(stated).toContain("USDA Agricultural Marketing Service");
    expect(stated).toContain("graded loose, white, Large, FOB");
    expect(stated).toContain("cents a dozen");
    expect(stated).toContain("36% above its twelve-observation median");
    expect(stated).toContain("hold it 180 days");
    // The budget AND the rate it actually delivered. Out of sample they differ,
    // so printing the budget alone would promise a frequency the data refuses.
    expect(stated).toContain("about 2 times a year");
    expect(stated).toContain("actually fired about 2.3 times a year");
    expect(stated).toContain("saved about 199.02 TRY");
  });

  it("the same sentence withholds the money and keeps every other fact", () => {
    const v = valueBacktest(run(), { ...HOUSE, carryPerPeriod: null });
    const out = commodityAlertSentence(FACTS, v);
    expect(out).toContain("USDA Agricultural Marketing Service");
    expect(out).toContain("Eggs, large, 15-dozen case");
    expect(out).toContain("UNMEASURED");
    expect(out).not.toMatch(/saved about/);
  });
});
