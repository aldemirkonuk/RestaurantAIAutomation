/**
 * The calibration PROPOSES numbers. It never writes them.
 *
 * The founder's answer to phase 0's Q3, 2026-09-05, verbatim: *"a Mudavym admin
 * arms one series at a time ..., with the calibration's derived threshold SHOWN
 * before the act; the act is sealed and logged; the calibration job only
 * PROPOSES numbers and writes nothing to the series; nothing arms itself."*
 *
 * So this file computes and hashes, and has no database import at all. That is
 * the guarantee, expressed the only way a guarantee survives: there is nothing
 * here to write with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PROPOSAL IS HASHED, AND WHY THAT HASH IS THE SEAL
 * ─────────────────────────────────────────────────────────────────────────────
 * `mcp_seal_challenges.actor_user_id` is `UUID NOT NULL REFERENCES
 * public.users(user_id)`, and ADR 0099's `ServiceKeyGuard` says in its own words
 * that it "authenticates a machine; it carries no tenant and no user". Measured,
 * not assumed: **the tenant seal store structurally cannot hold an admin act**,
 * and minting a fake user row to fit one would put a person's name on a
 * decision they did not make.
 *
 * What a seal is actually FOR survives without that store. Its load-bearing
 * property is `args_hash` — *what was on the screen when the hold began* — and
 * the thing that must not change between the showing and the write here is the
 * derived numbers themselves. So the proposal carries a sha256 over exactly
 * those numbers and the window they came from; the arming write must carry the
 * hash back; and the service RECOMPUTES the proposal from the series' own
 * observations at write time and refuses when they differ. A threshold that
 * moved between the showing and the act cannot be armed, which is the same
 * refusal `arguments_changed` gives an order that was edited after approval.
 *
 * It is deliberately NOT one-time. A seal is single-use because approving twice
 * is two approvals; arming the same series twice on the same numbers is one
 * state, and refusing the repeat would teach an admin to retry a thing that
 * already worked.
 */

import { createHash } from "crypto";
import {
  DEFAULT_BASELINE_K,
  OBSERVATIONS_PER_YEAR,
  THRESHOLD_HISTORY_FLOOR,
  deriveThreshold,
} from "./commodity-alert";

/** The budgets an operator may choose, in fires per year. */
export const BUDGETS = [4, 2, 1] as const;
export type Budget = (typeof BUDGETS)[number];

/**
 * THE DEFAULT, and it is the founder's own answer to the plan's §12 Q5.
 *
 * 2026-09-05, batch 59, verbatim: *"Twice a year, and the house types its
 * carrying cost."*
 *
 * It is a default the admin still has to accept — the proposal shows all three
 * budgets and the arm route takes whichever hash comes back — but the screen
 * says which one was chosen for them and why, because a default nobody can see
 * being applied is the thing this whole register exists to refuse.
 */
export const DEFAULT_BUDGET: Budget = 2;

/**
 * Why the other two were rejected, in the words the admin reads beside them.
 *
 * Kept here rather than in a document, because the rejected alternative is the
 * half of a decision that gets lost first. Every figure is from the quant pass
 * recorded in the plan's §9f: 440 recorded FAO months, walk-forward, K = 12,
 * three months of cover.
 */
export const BUDGET_RATIONALE: Record<number, string> = {
  4: "Rejected as the default. Quarterly earns the most only when holding stock is nearly free: at 0.25 % a month it is the best of the three, at 0.75 % it is the only one that loses money, and it falls fastest of the three as the carrying cost rises. It is offered because a house with cheap storage should be able to choose it.",
  2: "The default (the founder, 2026-09-05). Across carrying costs from 0.25 % to 1 % a month it wins or comes within a small margin of winning in every case, and it is never the worst of the three. Measured on 440 months of the FAO index: a fire is followed by a higher index three months later 65.8 % of the time against a 54.4 % benchmark.",
  1: "Rejected as the default, and the right choice for a house with expensive storage. It is the most robust setting — the only one still ahead at 1 % a month — but it leaves value unclaimed wherever the alert genuinely works, and a house that hears from a series once a year will not remember what the series is.",
};

/**
 * The budget that was NOT offered at all, and why it is named rather than
 * simply absent.
 *
 * The founder asked for weekly or fortnightly. Neither is on this list because
 * FAO and ONS publish monthly and a rule cannot speak more often than its
 * series does; at twelve fires on twelve chances the quantile lands on the
 * minimum observed move, which on the FAO history is a fall, so no threshold
 * exists at all. An absent option that was asked for must be explained, or the
 * screen is reporting a limit as a preference.
 */
export const CADENCE_NOT_ON_OFFER =
  "Weekly and fortnightly are not offered: these series publish monthly, and a rule cannot fire more often than its series speaks. At twelve fires a year on a monthly series the threshold collapses to the smallest move the series has ever made, which is not a threshold.";

export interface CalibrationProposal {
  seriesKey: string;
  /** The budget these numbers were derived for. */
  firesPerYear: number;
  riseThreshold: number;
  stepGuard: number;
  windowFrom: string;
  windowTo: string;
  /** How many `m` values the quantile was read off. */
  windowNObs: number;
  /** Observations the series holds, which is not the same number. */
  observations: number;
  /** sha256 over every field above. The thing the arming write carries back. */
  proposalHash: string;
  /**
   * Whether this is the budget the founder chose as the default (twice a year).
   *
   * Deliberately NOT part of `proposalHash`. The hash exists to prove the
   * NUMBERS on the screen are the numbers being armed; which of three budgets
   * carries a recommendation is presentation, and folding it into the hash
   * would make a change of wording refuse an arming.
   */
  isDefaultBudget: boolean;
  /** Why this budget was chosen or rejected as the default, in words. */
  budgetRationale: string;
  /**
   * What the sentence on the screen says, in the operator's own terms. It
   * states the BUDGET they chose and the percentage it produced, over the
   * window it was read off — the only accuracy claim this product may make
   * about a commodity alert (the hit rate needs a denominator that is zero).
   */
  sentence: string;
}

/** Why no proposal could be made. Never an empty proposal with no reason. */
export interface CalibrationRefusal {
  refused: true;
  reason:
    | "too_short_a_history"
    | "flat_series"
    | "unknown_grain"
    | "no_observations";
  detail: string;
}

export type CalibrationOutcome = CalibrationProposal | CalibrationRefusal;

export function isRefusal(o: CalibrationOutcome): o is CalibrationRefusal {
  return (o as CalibrationRefusal).refused === true;
}

/**
 * Hash the proposal's numbers, canonically.
 *
 * An ARRAY of primitives in a fixed order, not an object: `JSON.stringify` over
 * an object depends on key insertion order, so two runs that computed the same
 * numbers could hash differently and the arming route would refuse a proposal
 * it had just issued.
 *
 * Numbers are fixed to the precision the columns actually store —
 * `NUMERIC(6,4)` — so a proposal cannot hash one value and store a rounded
 * different one. Without this the round trip through Postgres would change the
 * number and every second arming would be refused for a reason nobody could see.
 */
export function hashProposal(p: {
  seriesKey: string;
  firesPerYear: number;
  riseThreshold: number;
  stepGuard: number;
  windowFrom: string;
  windowTo: string;
  windowNObs: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        p.seriesKey,
        p.firesPerYear,
        p.riseThreshold.toFixed(4),
        p.stepGuard.toFixed(4),
        p.windowFrom,
        p.windowTo,
        p.windowNObs,
      ]),
    )
    .digest("hex");
}

/** One observation, as the calibration needs it: a period and a value. */
export interface CalibrationPoint {
  periodStart: string;
  value: number;
}

/**
 * Propose thresholds for one series at one budget.
 *
 * `points` must be ascending by period. Returns a refusal — with its reason in
 * words — rather than a proposal with zeroes in it, because a zero threshold
 * fires on every observation that is not a fall.
 */
export function proposeCalibration(
  seriesKey: string,
  periodGrain: string,
  points: CalibrationPoint[],
  firesPerYear: number,
  k: number = DEFAULT_BASELINE_K,
): CalibrationOutcome {
  if (points.length === 0) {
    return {
      refused: true,
      reason: "no_observations",
      detail:
        "This series holds no observation, so there is no history to read a threshold off. That is a register with nothing in it, not a series that never moves.",
    };
  }
  const observationsPerYear = OBSERVATIONS_PER_YEAR[periodGrain];
  if (!observationsPerYear) {
    return {
      refused: true,
      reason: "unknown_grain",
      detail: `This series' period grain is "${periodGrain}", which this calibration has no observations-a-year figure for. A budget is per YEAR and the data is per observation; without the conversion the number would mean nothing.`,
    };
  }
  if (points.length < THRESHOLD_HISTORY_FLOOR) {
    return {
      refused: true,
      reason: "too_short_a_history",
      detail: `This series holds ${points.length} admitted observations and a threshold is read off at least ${THRESHOLD_HISTORY_FLOOR}. Below that, a quantile at the once-or-twice-a-year end is read off its two most extreme points rather than off a distribution. No threshold is proposed and the rule cannot fire for this series.`,
    };
  }

  const values = points.map((p) => p.value);
  const derived = deriveThreshold(values, {
    firesPerYear,
    observationsPerYear,
    k,
  });
  if (!derived) {
    return {
      refused: true,
      reason: "flat_series",
      detail:
        "This series' own history produces no positive rise at the chosen frequency, so there is no threshold to propose. A series that flat would fire on every observation that is not a fall, which is not a threshold.",
    };
  }

  const windowFrom = points[0].periodStart;
  const windowTo = points[points.length - 1].periodStart;
  const core = {
    seriesKey,
    firesPerYear,
    riseThreshold: derived.riseThreshold,
    stepGuard: derived.stepGuard,
    windowFrom,
    windowTo,
    windowNObs: derived.nObs,
  };
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const isDefaultBudget = firesPerYear === DEFAULT_BUDGET;
  return {
    ...core,
    observations: points.length,
    proposalHash: hashProposal(core),
    isDefaultBudget,
    budgetRationale:
      BUDGET_RATIONALE[firesPerYear] ??
      "This budget is not one of the three the register offers, so nothing is recorded about why it was or was not chosen.",
    // The sentence the admin reads BEFORE the act, and the same words that
    // travel into the notification later. It states the budget, the percentage
    // that budget produced, the baseline it is measured against, and the window
    // it was read off. It claims nothing about whether a fire will be right.
    sentence:
      `${isDefaultBudget ? "This is the budget Mudavym proposes: t" : "T"}his house would hear about ${seriesKey} about ${firesPerYear === 1 ? "once" : `${firesPerYear} times`} a year. ` +
      `On this series' own history that is a rise of ${pct(derived.riseThreshold)} above its ${k}-observation median, ` +
      `read off ${derived.nObs} evaluated ${periodGrain}s between ${windowFrom} and ${windowTo}. ` +
      `A single-${periodGrain} move above ${pct(derived.stepGuard)} — this series' own 99th percentile — is refused and named rather than dropped. ` +
      `${BUDGET_RATIONALE[firesPerYear] ?? ""} ` +
      `How often it will be RIGHT for THIS house is not stated, because nothing here can measure that yet.`,
  };
}

/**
 * Every budget's proposal, so the admin sees the choice rather than one number.
 *
 * The default is marked and the rejected ones carry their reason, which is the
 * whole difference between offering a decision and announcing one. A screen
 * that showed only the recommended budget would be making the founder's call
 * look like the only call there was.
 */
export function proposeAllBudgets(
  seriesKey: string,
  periodGrain: string,
  points: CalibrationPoint[],
  k: number = DEFAULT_BASELINE_K,
): Array<{
  firesPerYear: number;
  isDefault: boolean;
  rationale: string;
  outcome: CalibrationOutcome;
}> {
  return BUDGETS.map((firesPerYear) => ({
    firesPerYear,
    isDefault: firesPerYear === DEFAULT_BUDGET,
    rationale: BUDGET_RATIONALE[firesPerYear] ?? "",
    outcome: proposeCalibration(seriesKey, periodGrain, points, firesPerYear, k),
  }));
}
