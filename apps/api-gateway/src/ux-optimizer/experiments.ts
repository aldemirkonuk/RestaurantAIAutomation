import { createHash } from "node:crypto";

/**
 * Experiments — a house sees ONE arm of a question, consistently, and every
 * exposure and outcome is recorded before anybody reads a verdict.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS AT ALL — what was measured first
 * ===========================================================================
 * The founder asked for the dashboard's written-note control to be tried BOTH
 * ways rather than decided (2026-09-05, verbatim):
 *
 *     "lets try both, 80 percent simple 20 percent signature"
 *
 * Before writing anything, the two mechanisms this repository already has were
 * measured against that sentence. Neither can carry it:
 *
 *   1. `restaurant_feature_flags` (settings/feature-flag-registry.ts) is a
 *      per-house BOOLEAN a person sets by hand. It has no ratio, no second arm
 *      and no notion of assignment — flipping twenty per cent of houses onto a
 *      variant would mean somebody choosing which twenty per cent, which is a
 *      decision dressed as a sample.
 *   2. `ux_overrides.rollout_pct` + `UxOptimizerService.rolloutBucket(userId)`
 *      is closer and still wrong on three counts. It buckets on the USER, not
 *      the house (the founder's unit is the house); it compares a variant to
 *      the product-as-built rather than two named arms; it records the
 *      assignment NOWHERE, so a later change to the percentage silently
 *      re-labels every outcome already collected; and the whole path is inert
 *      unless `UX_OPTIMIZER_ENABLED=true`, which defaults to false.
 *
 * So the ux-optimizer has an override gate and no assignment store. This file
 * and `ux_experiment_assignments` are that store. See ADR 0127.
 *
 * ===========================================================================
 * THE THREE RULES
 * ===========================================================================
 * 1. DETERMINISTIC, PER HOUSE. The arm is `sha256("<key>:<restaurantId>")`'s
 *    first four bytes modulo 100, compared against the arms' cumulative
 *    percentages in declared order. Same house, same key, same arm, on every
 *    request, in every process, forever — no coin flip, no session, no cookie.
 *
 *    SHA-256 rather than the `h * 31 + charCode` polynomial `rolloutBucket`
 *    uses: restaurant ids are UUIDs, which share a fixed layout and a version
 *    nibble, and defending a homebrew hash's uniformity over structured input
 *    is work nobody should have to do to trust a ratio. A cryptographic digest
 *    needs no defence.
 *
 * 2. THE RECORDED ASSIGNMENT WINS OVER THE RECOMPUTED ONE. The hash is how an
 *    arm is CHOSEN the first time; the row in `ux_experiment_assignments` is
 *    what the house is ON. That distinction is the whole point: if the ratio
 *    constant below is ever edited, a recompute would move houses between arms
 *    and every exposure already in the ledger would be attributed to an arm
 *    that house was never shown. The stored row, carrying the ratio it was made
 *    under, is the only thing that keeps the denominator honest.
 *
 * 3. NOTHING HERE APPLIES ANYTHING. This module assigns and the ledger records.
 *    Which arm completes more is a COUNT a person reads, never a verdict this
 *    code acts on. The ux-optimizer's standing guardrail — the agent proposes,
 *    a human approves — is not weakened by adding a measurement to it.
 */

/**
 * The bucket handed to a caller that is not in any arm. Outside every arm, by
 * construction: `armForBucket` returns null for anything outside 0..99.
 *
 * Two callers get it, and both mean the same thing — "this house is not
 * enrolled": a request with no restaurant, and a house that first appears after
 * the experiment's window has closed, which is never assigned at all.
 */
export const UNASSIGNABLE_BUCKET = -1;

export interface ExperimentSpec {
  key: string;
  /**
   * Arms in the order their percentages are laid end to end from bucket 0.
   * The FIRST arm is the fallback: it is what an unreadable experiment renders,
   * and it must therefore be the arm that is true of the product as built.
   */
  arms: readonly string[];
  /** Percentage points per arm. Must name every arm and sum to exactly 100. */
  ratio: Readonly<Record<string, number>>;
  /** When the founder set the ratio. */
  decidedOn: string;
  /** The founder's own words, so the constant is never read without them. */
  founderWords: string;
  /** One line on what the two arms actually differ in. */
  question: string;
}

/**
 * `note_close_control` — the closing control on a hand-written one-tap note.
 *
 * `plain` is the product as built on 2026-09-05 (commit be80f8b5): a written
 * note is a RECORD, so it closes with a plain button, and the wax is rationed
 * to the one act on that desk that moves the house's stock. `die` puts the
 * hold-to-approve gesture back on the note.
 *
 * The `die` arm's gesture is NOT A SEAL and the card says so in words: nothing
 * is minted, nothing is redeemed, no `onChallenge` is passed. ADR 0116's
 * addendum made an order approval a REDEEMED seal; a die on a note that only
 * writes a row would be an asserted one, and the two must not look alike. See
 * that ADR's 2026-09-05 status line.
 */
export const NOTE_CLOSE_CONTROL: ExperimentSpec = {
  key: "note_close_control",
  arms: ["plain", "die"] as const,
  ratio: { plain: 80, die: 20 },
  decidedOn: "2026-09-05",
  founderWords: "lets try both, 80 percent simple 20 percent signature",
  question:
    "Does the hold gesture on a written note help a person close it, or does it make them hesitate?",
};

export const EXPERIMENTS: Readonly<Record<string, ExperimentSpec>> = {
  [NOTE_CLOSE_CONTROL.key]: NOTE_CLOSE_CONTROL,
};

/**
 * How long an experiment runs: ONE QUARTER after its first exposure.
 *
 * The founder, 2026-09-05, answering ADR 0127's second open question — the
 * experiment ends one quarter after its first exposure, and after that every
 * house gets the arm the founder names.
 *
 * THE ARITHMETIC. 91 days is 13 whole weeks (13 * 7 = 91). A calendar quarter
 * is 90, 91 or 92 days depending which one it is, and the mean Gregorian
 * quarter is 365.2425 / 4 = 91.31 days — so 91 is within a day of every
 * reading of "a quarter". Thirteen WHOLE WEEKS was chosen over 90 or 92 for a
 * reason about restaurants rather than calendars: covers are strongly
 * weekly-periodic, so a window that is not a whole number of weeks gives one
 * weekday an extra turn and weights the counts by whichever day that happens
 * to be. A part-week window would make Friday, or Monday, a term in the answer.
 *
 * A CALENDAR-MONTH arithmetic (`+ 3 months`) was rejected for the same reason
 * and one more: it is 89 to 92 days depending on the start date, so two
 * experiments started a fortnight apart would run for measurably different
 * lengths and nothing on either report would say so.
 *
 * THE CONSTANT DOES NOT DECIDE A RUNNING WINDOW. It is used ONCE, to derive
 * `ux_experiment_state.ends_at` at the moment the first exposure is known, and
 * the stored row wins from then on — the same rule the ratio already lives
 * under. Editing this number must not move the finish line under an experiment
 * that is already running; the database trigger refuses it outright.
 */
export const EXPERIMENT_QUARTER_DAYS = 91;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The instant an experiment closes: first exposure + a quarter.
 *
 * Throws on an unparseable start rather than returning a date derived from
 * `NaN`, which would silently become `Invalid Date` and compare false against
 * every `now` — an experiment that never ends, reported as one that is running.
 */
export function experimentEndsAt(
  firstExposureIso: string,
  quarterDays: number = EXPERIMENT_QUARTER_DAYS,
): string {
  const start = new Date(firstExposureIso).getTime();
  if (!Number.isFinite(start))
    throw new Error(
      `experiment window: "${firstExposureIso}" is not a readable first-exposure time`,
    );
  if (!Number.isInteger(quarterDays) || quarterDays < 1)
    throw new Error(
      `experiment window: ${quarterDays} is not a whole number of days`,
    );
  return new Date(start + quarterDays * MS_PER_DAY).toISOString();
}

/**
 * Whether `arm` is one of the arms this spec declares.
 *
 * Used where a person names a winner. An arm that is not declared is refused
 * rather than stored: `ux_experiment_state.winner_arm` only bounds the length,
 * so a typo would otherwise be written, frozen by the trigger, and then served
 * to every house as the product.
 */
export function isDeclaredArm(spec: ExperimentSpec, arm: string): boolean {
  return spec.arms.includes(arm);
}

/**
 * The three things recorded per exposure. Both arms record all three — an event
 * one arm can produce and the other cannot is not a measurement, it is a
 * property of the control masquerading as one.
 *
 * `exposed`     the card was rendered with its closing control resolved
 * `completed`   the note was closed
 * `abandoned`   the card was exposed and then left, still not closed
 *
 * Time-to-complete is NOT a fourth event: it rides on `completed` as the
 * ledger's own `duration_ms` column, measured from EXPOSURE to completion.
 * Measuring instead from the press would compare 0ms against `pour.ms`'s 620 —
 * a reading of a constant this repository chose, not of an operator.
 */
export const EXPERIMENT_EVENTS = ["exposed", "completed", "abandoned"] as const;
export type ExperimentEvent = (typeof EXPERIMENT_EVENTS)[number];

export function experimentByKey(key: string): ExperimentSpec | null {
  return Object.prototype.hasOwnProperty.call(EXPERIMENTS, key)
    ? EXPERIMENTS[key]
    : null;
}

/**
 * 0..99 for a real house; -1 for a caller with no restaurant.
 *
 * -1 rather than a random bucket, and rather than 0: an unidentifiable caller
 * must fall outside every arm instead of landing in the biggest one, so the
 * failure mode is "no assignment" and not "silently counted as plain".
 */
export function experimentBucket(
  experimentKey: string,
  restaurantId: string | null | undefined,
): number {
  if (!restaurantId) return UNASSIGNABLE_BUCKET;
  const digest = createHash("sha256")
    .update(`${experimentKey}:${restaurantId}`)
    .digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * The arm a bucket falls in, laying each arm's percentage end to end from 0 in
 * the order `arms` declares. Returns null for a bucket outside 0..99, which is
 * how an unidentifiable caller stays unassigned rather than being counted.
 */
export function armForBucket(
  spec: ExperimentSpec,
  bucket: number,
): string | null {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket > 99) return null;
  let floor = 0;
  for (const arm of spec.arms) {
    floor += spec.ratio[arm] ?? 0;
    if (bucket < floor) return arm;
  }
  // Unreachable while assertRatioIsWhole holds, and not silently forgiven if it
  // ever does not: a ratio that leaves a gap must not quietly assign the last
  // arm to the remainder.
  return null;
}

export function assignArm(
  spec: ExperimentSpec,
  restaurantId: string | null | undefined,
): { bucket: number; arm: string | null } {
  const bucket = experimentBucket(spec.key, restaurantId);
  return { bucket, arm: armForBucket(spec, bucket) };
}

/**
 * A ratio that does not sum to 100, or names an arm that does not exist, is a
 * silent mis-split — some slice of houses would fall through `armForBucket`
 * into null and simply never be measured. Called once per spec at module load
 * below, so a bad edit fails the process rather than the experiment.
 */
export function assertRatioIsWhole(spec: ExperimentSpec): void {
  const named = Object.keys(spec.ratio);
  for (const arm of named) {
    if (!spec.arms.includes(arm))
      throw new Error(
        `experiment ${spec.key}: ratio names arm "${arm}", which is not declared`,
      );
  }
  for (const arm of spec.arms) {
    if (typeof spec.ratio[arm] !== "number")
      throw new Error(`experiment ${spec.key}: arm "${arm}" has no percentage`);
  }
  const total = spec.arms.reduce((sum, arm) => sum + spec.ratio[arm], 0);
  if (total !== 100)
    throw new Error(
      `experiment ${spec.key}: arm percentages sum to ${total}, not 100`,
    );
}

for (const spec of Object.values(EXPERIMENTS)) assertRatioIsWhole(spec);
