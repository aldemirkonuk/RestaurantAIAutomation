/**
 * What one fire is WORTH, and therefore how often a house should be interrupted.
 *
 * The founder's question, 2026-09-05, verbatim: *"what would you suggest —
 * deploy (opus) to be quant agent, and understand how can it be profitable?
 * maybe once in a week, 2 weeks...?"*
 *
 * `commodity-calibration.ts` answers the FREQUENCY half of that: pick a budget
 * in fires per year and the percentage falls out of the series' own history.
 * It deliberately says nothing about whether a fire is worth having, because
 * §9d of the plan is right that the hit rate needs a denominator this product
 * does not have. This file is the other half, and it is careful about exactly
 * the same line:
 *
 *   - it MEASURES, on a series' own recorded history, what a house that had
 *     bought ahead on every fire would have avoided and what it would have
 *     paid to hold the goods;
 *   - it expresses that in units of ONE PERIOD'S SPEND, which is a pure ratio
 *     and needs no currency;
 *   - and it refuses to turn that ratio into money unless a person has stated
 *     the two things that make it money: what this house actually spends on
 *     the item per period, and how much of a move in THIS series reaches THIS
 *     house's invoice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PASS-THROUGH THAT IS `unset` MUST WITHHOLD THE MONEY RATHER THAN ASSUME 1
 * ─────────────────────────────────────────────────────────────────────────────
 * The plan's §5b records USDA ERS's measured pass-throughs: 53 % farm-to-
 * wholesale on beef, 30 % on wheat flour, 19-29 % wholesale-to-retail on beef,
 * 16-21 % on bread. §5e measures the other end: eggs, where the published
 * wholesale series IS the price of the case the house buys, so the figure is
 * near 1. The spread between those two worlds is the whole difference between
 * an alert that pays and one that costs money, and NOTHING in a series tells
 * you which world a given house lives in — only that house's own invoices do.
 *
 * The asymmetry that makes this dangerous, and it is the reason this file
 * exists at all: **pass-through attenuates the BENEFIT and not the COST.** A
 * house that buys ahead holds real goods it paid real money for, and pays the
 * full carrying cost on them, whatever fraction of the index move ever reaches
 * its invoice. So an alert priced at an assumed pass-through of 1 and realised
 * at 0.2 does not earn a fifth as much; it can easily earn less than nothing.
 * `breakEvenPassThrough` is the number that states this out loud.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO DATABASE, NO CLOCK, NO FILESYSTEM
 * ─────────────────────────────────────────────────────────────────────────────
 * Same guarantee, same reason, as `commodity-calibration.ts`: there is nothing
 * here to write with and nothing here to read a "now" from. Every horizon is
 * counted in the series' own periods and every input is passed in, so a re-run
 * on the same recorded bytes produces the same numbers a year from now.
 */

import {
  DEFAULT_BASELINE_K,
  OBSERVATIONS_PER_YEAR,
  THRESHOLD_HISTORY_FLOOR,
  deriveThreshold,
  median,
  moveAgainstBaseline,
  stepAtLatest,
} from "./commodity-alert";

/**
 * The cadences the founder named, plus the three the calibration already
 * offers. In fires per YEAR, which is the unit a person chooses in.
 *
 * `weekly` and `fortnightly` are in this list because they were asked for, and
 * they are the two that a monthly series structurally cannot deliver — see
 * `finer_than_the_series_publishes`. Leaving them out would have hidden the
 * answer rather than given it.
 */
export const CADENCE_LADDER = [
  { label: "weekly", firesPerYear: 52 },
  { label: "fortnightly", firesPerYear: 26 },
  { label: "monthly", firesPerYear: 12 },
  { label: "quarterly", firesPerYear: 4 },
  { label: "twice a year", firesPerYear: 2 },
  { label: "once a year", firesPerYear: 1 },
] as const;

export type CadenceLabel = (typeof CADENCE_LADDER)[number]["label"];

/** Why no backtest could be run. Never an empty result with no reason. */
export interface CadenceRefusal {
  refused: true;
  reason:
    | "unknown_grain"
    | "finer_than_the_series_publishes"
    | "too_short_a_history"
    | "no_threshold"
    | "no_evaluable_period";
  detail: string;
}

export function isCadenceRefusal(o: unknown): o is CadenceRefusal {
  return (o as CadenceRefusal)?.refused === true;
}

/** One fire, and what the series did after it. */
export interface FireOutcome {
  /** Position in `values` of the observation that fired. */
  index: number;
  /** `v_t`. */
  latest: number;
  /** The median of the K observations ending one period before t. */
  baseline: number;
  /** `m` — the move against the baseline that cleared the threshold. */
  move: number;
  /** The threshold in force at that moment. Differs per fire in walk-forward. */
  thresholdInForce: number;
  /** `v_(t+w)/v_t - 1` for w = 1 … H. */
  forwardMoves: number[];
  /**
   * The sum of `forwardMoves`. In units of ONE PERIOD'S VOLUME AT `v_t`: it is
   * what a house that bought H periods ahead at `v_t` avoided, before any
   * carrying cost and before any pass-through, as a fraction of one period's
   * spend.
   */
  grossFraction: number;
  /** Was the series simply higher H periods later? The plainest hit test. */
  higherAtHorizon: boolean;
}

export interface CadenceBacktest {
  firesPerYear: number;
  horizon: number;
  mode: "in_sample" | "walk_forward";
  /**
   * The threshold used. In walk-forward it moves with every observation, so
   * this is the LAST one derived, and `thresholdInForce` on each fire is the
   * one that actually decided it.
   */
  riseThreshold: number;
  stepGuard: number;
  /**
   * Periods where a decision was actually POSSIBLE: `m` was computable, a
   * threshold could be derived from the history available at that moment, and
   * `t + H` exists so the outcome is measurable. It is the denominator of the
   * realised firing rate and of the benchmark, and in walk-forward it differs
   * between cadences — a stricter budget is derivable earlier on some series
   * than a looser one. That is a fact about the histories and it is reported
   * rather than smoothed into one number.
   */
  evaluated: number;
  fires: number;
  /** Fires per year the rule actually delivered on this history. */
  firesPerYearRealised: number;
  hits: number;
  /** hits / fires, or null when nothing fired. */
  hitRate: number | null;
  meanGrossFraction: number | null;
  medianGrossFraction: number | null;
  worstGrossFraction: number | null;
  bestGrossFraction: number | null;
  /**
   * The same average over EVERY evaluable period, fire or not — a house that
   * bought ahead at a moment chosen by a coin. This is the benchmark that
   * decides whether the alert carries information or merely carries a
   * direction, and it is reported whether or not it flatters the rule.
   */
  benchmarkMeanGrossFraction: number | null;
  benchmarkHitRate: number | null;
  /** `meanGrossFraction - benchmarkMeanGrossFraction`. The alert's own value. */
  lift: number | null;
  /** Every fire, so a caller can show the distribution rather than a mean. */
  outcomes: FireOutcome[];
}

export type CadenceOutcome = CadenceBacktest | CadenceRefusal;

/**
 * What a house would have to state before any of this becomes money.
 *
 * Every field here is a PARAMETER the caller supplies, never a fact this file
 * knows. They are named for what they are so no screen can print one as though
 * it were measured.
 */
export interface CarryingCostParams {
  /**
   * Fraction of the goods' own value given up per period held: cost of the
   * cash, the space, and the shrink that is not outright spoilage.
   *
   * `null` means NOBODY HAS TYPED ONE, and that is the state of every house
   * today. Nullable rather than defaulted because the founder's answer to the
   * plan's §12 Q5 was *"Twice a year, and the house types its carrying cost"*
   * (2026-09-05, batch 59), and because the measurement behind that answer is
   * exactly why a default would be dangerous: between 0.5 % and 1 % a month
   * the recommendation flips from "worth having on six series" to "worth
   * having on one". A number invented here would decide that for a house that
   * never chose.
   *
   * The house's own figure is `restaurants.carrying_cost_percent_per_month`,
   * which is a PERCENT. `percentPerMonthToFraction` is the only conversion.
   */
  carryPerPeriod: number | null;
  /**
   * The fraction of a move in THIS series that reaches THIS house's invoice.
   * `null` means nobody has measured it, which is the honest common case and
   * is why `moneyPerFire` comes back null with a reason.
   */
  passThrough: number | null;
  /**
   * One period's spend on this item, in the house's own currency. `null` means
   * this house has no measured spend for it, and no money may be printed.
   */
  periodSpend: number | null;
  /** The house's currency code. A bare number is never printed without one. */
  currency: string | null;
  /**
   * What one interruption costs, in the same currency: the manager's attention,
   * whether or not they act. Subtracted from EVERY fire, including the ones
   * that were right, because a fire that is ignored still cost the reading.
   */
  attentionPerFire: number | null;
  /** The person-typed shelf life of the mapped item, in days. Never inferred. */
  shelfLifeDays: number | null;
  /** Days in one period of this series. 30 for a monthly index, 1 for a daily. */
  daysPerPeriod: number;
}

export interface CadenceValuation {
  horizon: number;
  /**
   * Carrying cost of buying H periods ahead, as a fraction of one period's
   * spend: `carryPerPeriod × H(H+1)/2`. The unit bought for period t+w sits for
   * w periods, so the holding is triangular and not `carry × H`.
   *
   * `null` when the house has typed no carrying cost. NOT zero: zero would
   * price holding three months of stock as free, which is the single
   * assumption that makes every fire look like a win.
   */
  carryFraction: number | null;
  /** Mean net, in units of one period's spend, before attention. Pass-through applied. */
  netFractionPerFire: number | null;
  /** Share of fires whose net was negative. The false-alarm RATE, priced. */
  lossRate: number | null;
  /** Mean net across the losing fires only. The false-alarm COST. */
  meanLossFraction: number | null;
  /**
   * The pass-through at which this cadence exactly breaks even on this history:
   * `carryFraction / meanGrossFraction`. Above 1 it means no pass-through
   * whatever would make it pay. This is the number to put in front of a founder
   * when the series is an index and the money is unknowable.
   */
  breakEvenPassThrough: number | null;
  moneyPerFire: number | null;
  moneyPerYear: number | null;
  currency: string | null;
  /**
   * The smallest one-period spend at which a fire repays the attention it
   * costs: `attentionPerFire / netFractionPerFire`. Null when the net is not
   * positive — no spend is large enough then — or when an input is missing.
   */
  minimumPeriodSpend: number | null;
  /** Why money is null, in words, when it is. Never a silent zero. */
  withheld:
    | "no_carrying_cost_typed"
    | "below_spend_floor"
    | "pass_through_unset"
    | "no_house_spend"
    | "no_currency"
    | "no_attention_cost"
    | "no_shelf_life_typed"
    | "does_not_keep_long_enough"
    | "nothing_fired"
    | null;
  withheldDetail: string | null;
}

/**
 * Does the item keep long enough to be bought H periods ahead?
 *
 * Same direction as `exposureKeepsLongEnough` in the alert: a typed shelf life
 * can only ever REMOVE a house from the firing set, and an absent one is never
 * read as "it keeps".
 */
export function horizonFitsShelfLife(
  shelfLifeDays: number | null,
  horizon: number,
  daysPerPeriod: number,
): boolean {
  if (shelfLifeDays === null || shelfLifeDays <= 0) return false;
  if (!(horizon > 0) || !(daysPerPeriod > 0)) return false;
  return shelfLifeDays >= horizon * daysPerPeriod;
}

/**
 * The carrying cost of holding H periods of cover, as a fraction of one
 * period's spend.
 *
 * Triangular, not linear: the units bought for the period immediately after the
 * fire sit for one period, the ones for the period after that sit for two, and
 * so on. `carry × H` would understate a three-period stock-up by a factor of
 * three, which is exactly the direction that would make the alert look good.
 */
export function carryFractionFor(
  carryPerPeriod: number,
  horizon: number,
): number {
  return carryPerPeriod * ((horizon * (horizon + 1)) / 2);
}

/**
 * `0.75` percent a month becomes the fraction `0.0075`.
 *
 * The ONE conversion between the column and this model, in one place, because
 * the two spellings differ by a hundred and the wrong one understates every
 * carrying cost into invisibility — the direction that makes the alert look
 * profitable. The migration's own CHECK refuses both mistakes
 * (`>= 0.01 AND <= 25.000` percent), so a value that reaches here is already
 * known to be a percent and not a fraction.
 */
export function percentPerMonthToFraction(percent: number | null): number | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  return percent / 100;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * The forward sum at `t`: what buying H periods ahead at `v_t` avoided, as a
 * fraction of one period's spend, before pass-through and before carry.
 *
 * Returns null when the series does not reach `t + H`, which is a real answer
 * and not a zero: a fire in the last months of a recorded window has no
 * measurable outcome and must be excluded from the denominator, not counted as
 * a miss.
 */
export function forwardSum(
  values: number[],
  t: number,
  horizon: number,
): { moves: number[]; sum: number } | null {
  if (t < 0 || horizon < 1) return null;
  if (t + horizon > values.length - 1) return null;
  const base = values[t];
  if (!(base > 0)) return null;
  const moves: number[] = [];
  for (let w = 1; w <= horizon; w += 1) moves.push(values[t + w] / base - 1);
  return { moves, sum: moves.reduce((a, b) => a + b, 0) };
}

export interface BacktestOptions {
  firesPerYear: number;
  periodGrain: string;
  /** How many periods of cover the house buys on a fire. */
  horizon: number;
  k?: number;
  historyFloor?: number;
  /**
   * `in_sample` derives one threshold from the WHOLE history and then tests it
   * on that same history — which is a look-ahead and is labelled as one.
   * `walk_forward` derives the threshold at each observation from the
   * observations strictly before it, which is the only honest number.
   */
  mode?: "in_sample" | "walk_forward";
}

/**
 * Run one cadence over one recorded series.
 *
 * `values` must be ascending by period and must be the series' OWN admitted
 * observations. Nothing is normalised, nothing is converted, and no value from
 * another series enters — the same rule §9a sets for the alert itself.
 */
export function backtestCadence(
  values: number[],
  opts: BacktestOptions,
): CadenceOutcome {
  const k = opts.k ?? DEFAULT_BASELINE_K;
  const floor = opts.historyFloor ?? THRESHOLD_HISTORY_FLOOR;
  const mode = opts.mode ?? "in_sample";
  const H = opts.horizon;
  const observationsPerYear = OBSERVATIONS_PER_YEAR[opts.periodGrain];

  if (!observationsPerYear) {
    return {
      refused: true,
      reason: "unknown_grain",
      detail: `This series' period grain is "${opts.periodGrain}", which has no observations-a-year figure. A cadence is per YEAR and the data is per observation; without the conversion the number would mean nothing.`,
    };
  }

  // The finding the founder's own words provoke. "Once a week" is not a
  // threshold this rule can be given on a monthly series: there are twelve
  // chances a year to fire and asking for fifty-two collapses the quantile to
  // the minimum observed move, so it fires on every observation that is not a
  // fall. `deriveThreshold` clamps that rate to 1 silently; a clamp a person
  // cannot see is the absence-reported-as-health shape, so it is named here.
  if (opts.firesPerYear > observationsPerYear) {
    return {
      refused: true,
      reason: "finer_than_the_series_publishes",
      detail: `This series publishes ${observationsPerYear} times a year and the cadence asked for is ${opts.firesPerYear} fires a year. A rule cannot fire more often than its series speaks. The fastest honest cadence for this series is ${observationsPerYear} a year, and at that rate it fires on every observation that is not a fall.`,
    };
  }

  if (values.length < floor + H) {
    return {
      refused: true,
      reason: "too_short_a_history",
      detail: `This series holds ${values.length} observations. A threshold is read off at least ${floor}, and a fire needs ${H} further observations after it before anyone can say whether it was right. Below ${floor + H} the backtest would be measuring its own window.`,
    };
  }

  const outcomes: FireOutcome[] = [];
  const benchmarkSums: number[] = [];
  let benchmarkHits = 0;
  let evaluated = 0;

  // The one threshold, when in-sample. In walk-forward it is recomputed inside
  // the loop and this pair is only what the LAST decision saw.
  let lastRise: number | null = null;
  let lastGuard: number | null = null;

  if (mode === "in_sample") {
    const derived = deriveThreshold(values, {
      firesPerYear: opts.firesPerYear,
      observationsPerYear,
      k,
      historyFloor: floor,
    });
    if (!derived) {
      return {
        refused: true,
        reason: "no_threshold",
        detail:
          "This series' own history produces no positive rise at this cadence, so there is no threshold to test. A series that flat would fire on every observation that is not a fall.",
      };
    }
    lastRise = derived.riseThreshold;
    lastGuard = derived.stepGuard;
  }

  // t is the index of the observation that would fire. It needs K + 2
  // observations behind it (condition 1) and H observations ahead of it before
  // its outcome is measurable at all.
  const first = mode === "walk_forward" ? Math.max(k + 1, floor) : k + 1;
  for (let t = first; t <= values.length - 1 - H; t += 1) {
    const history = values.slice(0, t + 1);
    const m = moveAgainstBaseline(history, k);
    if (!m) continue;
    const fwd = forwardSum(values, t, H);
    if (!fwd) continue;

    let rise = lastRise;
    let guard = lastGuard;
    if (mode === "walk_forward") {
      // Strictly before t: the decision at t may not see v_t's own future and
      // may not see v_t itself in the distribution it is judged against.
      const derived = deriveThreshold(values.slice(0, t), {
        firesPerYear: opts.firesPerYear,
        observationsPerYear,
        k,
        historyFloor: floor,
      });
      if (!derived) continue;
      rise = derived.riseThreshold;
      guard = derived.stepGuard;
      lastRise = rise;
      lastGuard = guard;
    }
    if (rise === null || guard === null) continue;

    evaluated += 1;
    benchmarkSums.push(fwd.sum);
    if (values[t + H] > values[t]) benchmarkHits += 1;

    // Condition 2 then condition 3, in the plan's order. A step above the guard
    // is refused and named there; here it simply does not become a fire.
    const step = stepAtLatest(history);
    if (step !== null && step > guard) continue;
    if (!(m.move >= rise)) continue;

    outcomes.push({
      index: t,
      latest: m.latest,
      baseline: m.baseline,
      move: m.move,
      thresholdInForce: rise,
      forwardMoves: fwd.moves,
      grossFraction: fwd.sum,
      higherAtHorizon: values[t + H] > values[t],
    });
  }

  if (evaluated === 0) {
    return {
      refused: true,
      reason: "no_evaluable_period",
      detail: `No observation in this series has both ${k + 2} observations behind it and ${H} ahead of it. There is nothing to measure, which is not the same as a cadence that never fires.`,
    };
  }

  const gross = outcomes.map((o) => o.grossFraction);
  const hits = outcomes.filter((o) => o.higherAtHorizon).length;
  const benchMean = mean(benchmarkSums);
  const outMean = mean(gross);

  return {
    firesPerYear: opts.firesPerYear,
    horizon: H,
    mode,
    riseThreshold: lastRise ?? 0,
    stepGuard: lastGuard ?? 0,
    evaluated,
    fires: outcomes.length,
    firesPerYearRealised: (outcomes.length / evaluated) * observationsPerYear,
    hits,
    hitRate: outcomes.length === 0 ? null : hits / outcomes.length,
    meanGrossFraction: outMean,
    medianGrossFraction: gross.length === 0 ? null : median(gross),
    worstGrossFraction: gross.length === 0 ? null : Math.min(...gross),
    bestGrossFraction: gross.length === 0 ? null : Math.max(...gross),
    benchmarkMeanGrossFraction: benchMean,
    benchmarkHitRate: benchmarkSums.length === 0 ? null : benchmarkHits / benchmarkSums.length,
    lift: outMean === null || benchMean === null ? null : outMean - benchMean,
    outcomes,
  };
}

/**
 * Price a backtest.
 *
 * The order of the refusals is deliberate. Shelf life is checked FIRST, because
 * an item that does not keep long enough is not a house that should be told a
 * smaller number — it is a house the alert must not fire for at all. Then the
 * two facts that make money possible; and `breakEvenPassThrough` is computed
 * and returned even when every one of them is missing, because it is the only
 * figure an index-number series can honestly produce.
 */
export function valueBacktest(
  backtest: CadenceBacktest,
  params: CarryingCostParams,
): CadenceValuation {
  const H = backtest.horizon;
  // A house that has typed nothing has a carrying cost of NOTHING, not of zero:
  // zero would price holding stock as free and make every fire look like a win.
  const carryFraction =
    params.carryPerPeriod === null
      ? null
      : carryFractionFor(params.carryPerPeriod, H);
  const gross = backtest.meanGrossFraction;

  // Break-even pass-through: the φ at which φ·gross = carry. Undefined when the
  // series did not rise on average after a fire, and that is reported as null
  // rather than as an infinity or a zero — a house cannot break even on a
  // signal whose average outcome is a fall, at any pass-through. Undefined too
  // when no carrying cost is typed, because the break-even IS a statement about
  // the carrying cost.
  const breakEvenPassThrough =
    gross === null || gross <= 0 || carryFraction === null
      ? null
      : carryFraction / gross;

  const base: CadenceValuation = {
    horizon: H,
    carryFraction,
    netFractionPerFire: null,
    lossRate: null,
    meanLossFraction: null,
    breakEvenPassThrough,
    moneyPerFire: null,
    moneyPerYear: null,
    minimumPeriodSpend: null,
    currency: params.currency,
    withheld: null,
    withheldDetail: null,
  };

  if (backtest.fires === 0) {
    return {
      ...base,
      withheld: "nothing_fired",
      withheldDetail:
        "This cadence produced no fire on this history, so there is nothing to price. That is a threshold nobody would ever hear from, not a cadence that never costs anything.",
    };
  }

  if (params.shelfLifeDays === null || params.shelfLifeDays <= 0) {
    return {
      ...base,
      withheld: "no_shelf_life_typed",
      withheldDetail:
        "Nobody has typed a shelf life for this item, so nobody can say whether it keeps long enough to be bought ahead. Buying ahead is the whole action; without it there is no gain to price.",
    };
  }
  if (!horizonFitsShelfLife(params.shelfLifeDays, H, params.daysPerPeriod)) {
    return {
      ...base,
      withheld: "does_not_keep_long_enough",
      withheldDetail: `Buying ${H} period${H === 1 ? "" : "s"} ahead means holding this item for up to ${H * params.daysPerPeriod} days and a person typed a shelf life of ${params.shelfLifeDays}. The gain is real and the goods would not survive to collect it.`,
    };
  }

  // THE FOUNDER'S OWN GATE. Batch 59: *"Twice a year, and the house types its
  // carrying cost."* Checked after the shelf life and before everything else,
  // because without it there is no cost side at all and the alert would price
  // holding three months of stock as free.
  if (carryFraction === null) {
    return {
      ...base,
      withheld: "no_carrying_cost_typed",
      withheldDetail:
        "Nobody at this house has typed what holding stock costs it, so the saving is unmeasured. Buying ahead ties up cash, space and shelf life, and a figure that left those out would be an invented profit. It is one number, on the settings page, and it is a percent a month.",
    };
  }

  // Pass-through applies to the benefit only. The house holds real goods it
  // paid for and carries them in full, whatever fraction of the move ever
  // reaches its invoice. This asymmetry is the point of the whole file.
  const phi = params.passThrough;
  const nets =
    phi === null
      ? null
      : backtest.outcomes.map((o) => phi * o.grossFraction - carryFraction);
  const losses = nets === null ? null : nets.filter((n) => n < 0);

  const withPhi: CadenceValuation = {
    ...base,
    netFractionPerFire: nets === null ? null : mean(nets),
    lossRate: nets === null ? null : (losses as number[]).length / nets.length,
    meanLossFraction: losses === null || losses.length === 0 ? null : mean(losses),
  };

  if (phi === null) {
    return {
      ...withPhi,
      withheld: "pass_through_unset",
      withheldDetail:
        "This house has never measured how much of a move in this series reaches its own invoice, so no figure for the saving is given. The break-even pass-through is stated instead: below it, buying ahead on this signal loses money on this history.",
    };
  }
  if (params.periodSpend === null || !(params.periodSpend > 0)) {
    return {
      ...withPhi,
      withheld: "no_house_spend",
      withheldDetail:
        "This house has no measured spend on this item per period, so the ratio cannot become an amount. `price_history` is where that number would come from.",
    };
  }
  if (!params.currency) {
    return {
      ...withPhi,
      withheld: "no_currency",
      withheldDetail:
        "No currency is stated for this house, and a bare number of money is not a number anybody can act on.",
    };
  }
  if (params.attentionPerFire === null) {
    return {
      ...withPhi,
      withheld: "no_attention_cost",
      withheldDetail:
        "What one interruption costs this house has not been stated. Leaving it out would price every alert as though reading it were free, which is the assumption that makes any cadence look affordable.",
    };
  }

  const net = withPhi.netFractionPerFire as number;
  // THE SPEND FLOOR. Measured in the quant pass (plan §9f): at 8 units of
  // attention a fire, an item the house spends 168 to 450 a month on is the
  // smallest that can repay being interrupted about, and on weaker parameters
  // the floor runs into the thousands. A rule that fires about a herb is not
  // wrong, it is merely never worth reading — and no condition in the plan's
  // nine could see that, because every one of them asks about the SERIES.
  const minimumPeriodSpend = net > 0 ? params.attentionPerFire / net : null;
  const moneyPerFire = net * params.periodSpend - params.attentionPerFire;

  if (moneyPerFire <= 0) {
    return {
      ...withPhi,
      minimumPeriodSpend,
      withheld: "below_spend_floor",
      withheldDetail:
        minimumPeriodSpend === null
          ? `Buying ahead on this signal loses money at this house's own carrying cost whatever it spends on the item, so no size of line would repay the interruption. Nothing is claimed as a saving.`
          : `This house spends about ${params.periodSpend.toFixed(0)} ${params.currency} a period on this item, and a fire only repays the ${params.attentionPerFire.toFixed(0)} ${params.currency} it costs to read above about ${minimumPeriodSpend.toFixed(0)}. The saving is real and smaller than the reading.`,
    };
  }

  return {
    ...withPhi,
    moneyPerFire,
    moneyPerYear: moneyPerFire * backtest.firesPerYearRealised,
    minimumPeriodSpend,
    withheld: null,
    withheldDetail: null,
  };
}

/**
 * Which of the three things the alert may say about money.
 *
 * The founder's answer to the plan's §12 Q5, 2026-09-05 batch 59, is the whole
 * reason there are three and not two: *"Twice a year, and the house types its
 * carrying cost."* A saving may be printed only when the house typed a carrying
 * cost AND a person typed a shelf life for the item; anything else is
 * `unmeasured`, and the sentence names which input is missing rather than
 * falling silent about the money. `too_small` is its own state because it is
 * not an absence — everything is known, and the answer is that the item is not
 * worth an interruption.
 */
export type MoneyState = "stated" | "unmeasured" | "too_small";

export function moneyState(v: CadenceValuation): MoneyState {
  if (v.withheld === null && v.moneyPerFire !== null && v.currency) return "stated";
  if (v.withheld === "below_spend_floor") return "too_small";
  return "unmeasured";
}

/**
 * The clause the alert sentence carries about money — in its three forms.
 *
 * §9e set the shape as two: with `pass_through_basis` unset, *"the money clause
 * is simply absent"*. It is not absent here, and there are three rather than
 * two. What replaces a figure is the statement of what is not known plus the
 * break-even where one exists — strictly more useful than silence and strictly
 * less of a claim than a number. And a line too small to be worth reading about
 * gets its own sentence, because telling a manager "unmeasured" when the truth
 * is "measured, and not worth your time" is a different lie.
 *
 * The word `unmeasured` appears verbatim in the second form on purpose: it is
 * the word the founder's own instruction uses, and it is what a manager should
 * be able to search the screen for.
 */
export function valueClause(v: CadenceValuation): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const cover = `${v.horizon} period${v.horizon === 1 ? "" : "s"} of cover`;

  if (moneyState(v) === "stated") {
    const money = v.moneyPerFire as number;
    return (
      `On this series' own recorded history, buying ${cover} on a fire like this one would have ` +
      `saved about ${money.toFixed(2)} ${v.currency} on average, after what holding the goods costs this house and what reading this costs. ` +
      `It went the wrong way on ${v.lossRate === null ? "an unmeasured share" : pct(v.lossRate)} of past fires.`
    );
  }

  if (moneyState(v) === "too_small") {
    return `The saving here is unmeasured for a reason that is measured: ${v.withheldDetail ?? "this line is too small to repay the interruption."}`;
  }

  if (v.withheld === "no_carrying_cost_typed") {
    return (
      `The saving is UNMEASURED: nobody at this house has typed what holding stock costs it, and buying ${cover} ties up cash, space and shelf life. ` +
      `It is one number on the settings page — a percent a month — and until it is there no figure for the saving will be shown, because the figure would be invented.`
    );
  }
  if (
    v.withheld === "no_shelf_life_typed" ||
    v.withheld === "does_not_keep_long_enough"
  ) {
    return `The saving is UNMEASURED: ${v.withheldDetail ?? "this item's shelf life is not known."}`;
  }
  if (v.withheld === "pass_through_unset" && v.breakEvenPassThrough !== null) {
    return (
      `The saving is UNMEASURED: this house has never measured how much of a move in this series reaches its own invoice. ` +
      `What can be said is the break-even — buying ${cover} pays only if more than ${pct(v.breakEvenPassThrough)} of this series' move reaches your price. Below that it loses money.`
    );
  }
  return `The saving is UNMEASURED: ${v.withheldDetail ?? "no figure for it can be given."}`;
}

/** The facts §9e requires on the face of every fire, none of them optional. */
export interface AlertSentenceFacts {
  /** The series in the words its publisher uses. */
  seriesLabel: string;
  /** Who published it, and when they say they published it. */
  issuer: string;
  issuedOn: string;
  /** How the issuer states the number, and at which trade level. */
  unit: string;
  tradeLevel: string;
  /** The current value and the baseline it is measured against, in that unit. */
  latest: string;
  baseline: string;
  /** `m`, as a fraction. Printed as a percentage. */
  move: number;
  /** The house's own item this series is mapped to, in the house's words. */
  itemLabel: string;
  /** The person-typed shelf life of that item, in days. Null when untyped. */
  shelfLifeDays: number | null;
  /** The budget the house chose, and the rate the rule actually delivered. */
  firesPerYear: number;
  realisedFiresPerYear: number | null;
}

/**
 * The whole sentence a fire carries, money clause included.
 *
 * Every element §9e requires is a REQUIRED field above rather than an optional
 * one, so a caller cannot produce a sentence missing its issuer or its trade
 * level — the two things that stop a wholesale number being read as a retail
 * one, which on eggs differed by 6.3x on the same day.
 *
 * The realised rate is printed beside the chosen budget because the quant pass
 * measured that they differ: out of sample a once-a-year budget fired 1.62
 * times a year and a twice-a-year budget 2.27. Printing the budget alone would
 * be promising a frequency the data refuses.
 */
export function commodityAlertSentence(
  facts: AlertSentenceFacts,
  v: CadenceValuation,
): string {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const shelf =
    facts.shelfLifeDays === null
      ? "Nobody has typed how long this house can hold it, so nothing here says to buy ahead."
      : `A person typed that this house can hold it ${facts.shelfLifeDays} days.`;
  const rate =
    facts.realisedFiresPerYear === null
      ? `You asked to hear about this series about ${facts.firesPerYear === 1 ? "once" : `${facts.firesPerYear} times`} a year.`
      : `You asked to hear about this series about ${facts.firesPerYear === 1 ? "once" : `${facts.firesPerYear} times`} a year; on its own history that setting has actually fired about ${facts.realisedFiresPerYear.toFixed(1)} times a year.`;
  return (
    `${facts.seriesLabel} is ${pct(facts.move)} above its twelve-observation median: ${facts.latest} against a median of ${facts.baseline}. ` +
    `${facts.issuer}, issued ${facts.issuedOn}, ${facts.unit}, ${facts.tradeLevel}. ` +
    `You mapped this series to ${facts.itemLabel}. ${shelf} ` +
    `${valueClause(v)} ${rate}`
  );
}
