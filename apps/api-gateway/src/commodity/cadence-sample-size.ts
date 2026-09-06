/**
 * What EVIDENCE costs: how many recorded observations a cadence question needs
 * before it can be answered, and what a single observation can be asked for.
 *
 * `cadence-value.ts` answers *is this cadence worth firing at*, given a history.
 * This file answers the question that comes first and was never written down:
 * **how much history does that answer need, and what may be claimed before it
 * exists.** It was forced by the shell-egg pass of 2026-09-06, where the whole
 * recorded history of a price series is ONE report — 23 rows of one day — and
 * the honest answer to "backtest it" is that a one-point series admits no
 * walk-forward, no hit rate and no cadence comparison at all.
 *
 * The danger this file exists to remove is the one the register names
 * everywhere else: a backtest run on a series too short to carry it does not
 * fail loudly. It returns a hit rate of 100 % on one fire, a lift with no
 * denominator, and a number a screen will print. So the sample size is computed
 * and stated BEFORE the backtest, and a cadence that cannot be tested on the
 * history available is named rather than approximated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO DATABASE, NO CLOCK, NO FILESYSTEM, NO NETWORK
 * ─────────────────────────────────────────────────────────────────────────────
 * Same guarantee as `cadence-value.ts` and `commodity-calibration.ts`: every
 * input is passed in and every output is arithmetic, so a re-run on the same
 * recorded bytes gives the same numbers a year from now.
 */

import { carryFractionFor } from "./cadence-value";

/**
 * Why an answer is not available. Every one of these is a real answer and none
 * of them is a zero: a refusal that came back as 0 would be read as "free",
 * "immediate" or "never rises", which are three different lies.
 */
export interface SampleSizeRefusal {
  refused: true;
  reason:
    | "not_a_rise"
    | "cadence_not_slower_than_the_series"
    | "unusable_parameter";
  detail: string;
}

export function isSampleSizeRefusal(o: unknown): o is SampleSizeRefusal {
  return (o as SampleSizeRefusal)?.refused === true;
}

const refuse = (
  reason: SampleSizeRefusal["reason"],
  detail: string,
): SampleSizeRefusal => ({ refused: true, reason, detail });

/**
 * The carrying cost per period at which buying `horizon` periods of cover
 * exactly breaks even on a move of `grossFraction`.
 *
 * The mirror of `breakEvenPassThrough` in `cadence-value.ts`, and the figure a
 * house can actually argue with, because a carrying cost is a thing an owner
 * knows about their own building and a pass-through is not.
 *
 * `carryFractionFor(1, horizon)` is the triangular factor `H(H+1)/2` — imported
 * rather than repeated so there is exactly one place in this codebase where the
 * shape of a stock-up's holding cost is written down.
 *
 * A move that is flat or a FALL is refused, never returned as a negative
 * carrying cost. A negative break-even is arithmetically true and is read by
 * every human being as a small one: the honest sentence is *no non-negative
 * carrying cost is low enough — this loses money at a carrying cost of zero.*
 */
export function breakEvenCarryPerPeriod(
  grossFraction: number,
  horizon: number,
): { carryPerPeriod: number } | SampleSizeRefusal {
  if (!Number.isFinite(grossFraction) || !Number.isFinite(horizon) || horizon < 1) {
    return refuse(
      "unusable_parameter",
      `A break-even carrying cost needs a finite move and a horizon of at least one period; it was given ${grossFraction} over ${horizon}.`,
    );
  }
  if (grossFraction <= 0) {
    return refuse(
      "not_a_rise",
      `The move measured is ${(grossFraction * 100).toFixed(4)} percent, which is not a rise. No non-negative carrying cost is low enough: buying ahead on this move loses money at a carrying cost of zero, and it loses more at any real one.`,
    );
  }
  return { carryPerPeriod: grossFraction / carryFractionFor(1, horizon) };
}

/**
 * The move a fire must be followed by JUST TO BREAK EVEN, as a fraction of one
 * period's spend: the reading itself plus the triangular carry.
 *
 *     attentionPerFire / periodSpend  +  carryPerPeriod x H(H+1)/2
 *
 * The first term is the part no percentage in a backtest can see. At 8 of
 * attention on 200 of weekly spend it is 4 percent on its own — larger than
 * almost any move a food price makes in a week.
 */
export function breakEvenMove(opts: {
  attentionPerFire: number;
  periodSpend: number;
  carryPerPeriod: number;
  horizon: number;
}): { move: number } | SampleSizeRefusal {
  const { attentionPerFire, periodSpend, carryPerPeriod, horizon } = opts;
  if (
    !Number.isFinite(attentionPerFire) ||
    !Number.isFinite(periodSpend) ||
    !Number.isFinite(carryPerPeriod) ||
    !Number.isFinite(horizon) ||
    periodSpend <= 0 ||
    attentionPerFire < 0 ||
    carryPerPeriod < 0 ||
    horizon < 1
  ) {
    return refuse(
      "unusable_parameter",
      "A break-even move needs a positive spend, a non-negative attention cost and carrying cost, and a horizon of at least one period. A missing one is not a zero: zero attention prices an interruption as free and zero carry prices storage as free.",
    );
  }
  return {
    move: attentionPerFire / periodSpend + carryFractionFor(carryPerPeriod, horizon),
  };
}

/**
 * The smallest one-period spend at which a fire repays the attention it costs.
 *
 * `netFractionPerFire` is the net AFTER pass-through and carry, in units of one
 * period's spend — the same quantity `cadence-value.ts` calls
 * `netFractionPerFire`. A net that is not positive is refused rather than
 * returned as a huge number: no spend is large enough, and printing 999,999
 * would invite somebody to type it.
 */
export function spendFloorForReading(
  attentionPerFire: number,
  netFractionPerFire: number,
): { periodSpend: number } | SampleSizeRefusal {
  if (!Number.isFinite(attentionPerFire) || attentionPerFire < 0) {
    return refuse(
      "unusable_parameter",
      `An interruption's cost must be a finite non-negative number; it was ${attentionPerFire}.`,
    );
  }
  if (!Number.isFinite(netFractionPerFire) || netFractionPerFire <= 0) {
    return refuse(
      "not_a_rise",
      "The net per fire is not positive, so no spend is large enough to repay the interruption. This is a series-and-parameters answer, not a small-item answer.",
    );
  }
  return { periodSpend: attentionPerFire / netFractionPerFire };
}

/**
 * How many out-of-sample FIRES a hit rate needs to be worth quoting.
 *
 *     n = p(1 - p) / se^2
 *
 * The normal-approximation sample size for a proportion. Stated as a function
 * rather than as a number in a document because the answer swings by an order
 * of magnitude across the standard errors a person might accept, and the
 * cadence tables downstream are entirely driven by it.
 */
export function firesForStandardError(
  hitRate: number,
  standardError: number,
): { fires: number } | SampleSizeRefusal {
  if (
    !Number.isFinite(hitRate) ||
    !Number.isFinite(standardError) ||
    hitRate <= 0 ||
    hitRate >= 1 ||
    standardError <= 0
  ) {
    return refuse(
      "unusable_parameter",
      `A fire count needs a hit rate strictly between 0 and 1 and a positive standard error; it was given ${hitRate} and ${standardError}.`,
    );
  }
  return {
    fires: Math.ceil((hitRate * (1 - hitRate)) / (standardError * standardError)),
  };
}

export interface CadenceSampleRequest {
  /** Out-of-sample fires the answer must rest on. See `firesForStandardError`. */
  firesNeeded: number;
  /** The cadence being tested, in fires a year. */
  firesPerYear: number;
  /** How many observations the series produces a year AS RECORDED. */
  observationsPerYear: number;
  /**
   * Observations before the first decision may be taken: the register's own
   * `THRESHOLD_HISTORY_FLOOR`, which is 36. Passed in rather than imported so
   * that a caller measuring a different standard has to say so.
   */
  historyFloor: number;
  /** Periods of cover bought on a fire; the tail no fire can be scored without. */
  horizon: number;
}

export interface CadenceSampleSize {
  /** Observations that can carry a decision AND be scored afterwards. */
  evaluableNeeded: number;
  /** Recorded observations in total, warm-up and tail included. */
  observationsNeeded: number;
  /** What that is in wall-clock years at this recording rate. */
  years: number;
}

/**
 * How many recorded observations it takes to test one cadence at the standard
 * the FAO pass used: walk-forward, the threshold re-derived at every decision
 * from the observations strictly before it, and the fire scored `horizon`
 * observations later.
 *
 * The arithmetic is deliberately simple, and its simplicity is the point:
 *
 *     evaluable = firesNeeded x observationsPerYear / firesPerYear
 *     total     = historyFloor + evaluable + horizon
 *
 * Two consequences worth reading off it before anybody downloads anything.
 * **Wall-clock time depends on the cadence and NOT on how often you record** —
 * recording five times as often multiplies the downloads by five and leaves the
 * years unchanged, because fires a year is fires a year. And a cadence at or
 * finer than the recording rate is REFUSED, for the reason `backtestCadence`
 * refuses it: at one fire per observation the quantile lands on the smallest
 * move the series ever made, which on a real series is a fall.
 */
export function observationsToTestCadence(
  req: CadenceSampleRequest,
): CadenceSampleSize | SampleSizeRefusal {
  const { firesNeeded, firesPerYear, observationsPerYear, historyFloor, horizon } = req;
  if (
    !Number.isFinite(firesNeeded) ||
    !Number.isFinite(firesPerYear) ||
    !Number.isFinite(observationsPerYear) ||
    !Number.isFinite(historyFloor) ||
    !Number.isFinite(horizon) ||
    firesNeeded < 1 ||
    firesPerYear <= 0 ||
    observationsPerYear <= 0 ||
    historyFloor < 0 ||
    horizon < 1
  ) {
    return refuse(
      "unusable_parameter",
      "A sample size needs at least one fire, a positive cadence, a positive recording rate, a non-negative history floor and a horizon of at least one period.",
    );
  }
  if (firesPerYear >= observationsPerYear) {
    return refuse(
      "cadence_not_slower_than_the_series",
      `This recording produces ${observationsPerYear} observations a year and the cadence asked for is ${firesPerYear} fires a year. At one fire per observation there is no quantile left to read: the threshold lands on the smallest move the series ever made. Record more often, or ask for a slower cadence.`,
    );
  }
  const evaluableNeeded = Math.ceil((firesNeeded * observationsPerYear) / firesPerYear);
  const observationsNeeded = historyFloor + evaluableNeeded + horizon;
  return {
    evaluableNeeded,
    observationsNeeded,
    years: observationsNeeded / observationsPerYear,
  };
}
