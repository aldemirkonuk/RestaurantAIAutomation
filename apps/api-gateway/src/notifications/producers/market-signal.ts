/**
 * Which of the market box's price drops are worth a permanent row in the book.
 *
 * Pure: no Nest, no database, no clock, so every rule below is testable as a
 * rule.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS DOES NOT COMPUTE THE DROP. THAT WOULD BE A SECOND ANSWER.
 * ─────────────────────────────────────────────────────────────────────────────
 * `GET /vendor-intel/below-average` was built in this same pass for the
 * `/notifications` market box — the arithmetic in
 * `vendor-intel/price-below-average.ts`, the read in
 * `VendorComparisonService.belowTrailingAverage` (vendor-comparison.service.ts:
 * 325-359), the consumer in `apps/web/src/pages/notifications/next/
 * useMarketPrice.ts`. Its own header says the producer that turns a drop into a
 * line in the book "belongs to a different pair of hands"; this is that pair.
 *
 * So the producer reads THAT function. A second normalisation, a second mean and
 * a second exclusion list would let the box and the notification disagree about
 * the same bottle on the same day, which is worse than either being slightly
 * wrong. What lives here is only what the read does not decide: whether a drop
 * is big enough to be worth saying, whether it is so big it is probably a bad
 * parse, and how long the house should then be left alone about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CEILING, AND THE DEFECT IT COMPENSATES FOR
 * ─────────────────────────────────────────────────────────────────────────────
 * `belowTrailingAverage` excludes outliers with `.eq("is_outlier", false)`
 * (vendor-comparison.service.ts:340), and `price-below-average.ts:28-31` says
 * outlier-ness is "a property of the group computed by the consensus pass, not
 * something to re-decide here". Correct in principle. Measured on 2026-09-03,
 * across `apps/`, `services/`, `scripts/` and `supabase/migrations/`: **nothing
 * in this repository ever writes `is_outlier`.** The column is
 * `DEFAULT false NOT NULL` (20260805154027_vendor_price_observations.sql:99)
 * and no consensus pass persists a verdict, so the filter matches every row and
 * excludes nothing.
 *
 * That matters more here than it does on the page. The engine's own header lists
 * what scraped prices carry — "a decimal lost, a case price read as a bottle
 * price, a '$1,200' that is really $12.00" (vendor-price-consensus.ts:11-19) —
 * and every one of those errors produces a price FAR BELOW the rest. The
 * observations most likely to look like a bargain are exactly the ones the
 * engine would call bad data. On a page a reader can see an absurd number and
 * ignore it; a notification row is permanent and a push wakes a phone.
 *
 * So a drop above `IMPLAUSIBLE_DROP_CEILING` is REFUSED, counted, and named in
 * the run's `withheld_reason` so the source can be corrected. This is weaker
 * than the median-absolute-deviation screen the engine already implements
 * (`flagOutliers`, vendor-price-consensus.ts:180-192) — it is a bound, not a
 * dispersion test — and that is a compromise, not a design: the real fix is for
 * something to run the consensus pass and write `is_outlier`, and it is filed in
 * the page note §13 against `vendor-intel/`, not smuggled in here as a second
 * copy of the group arithmetic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THRESHOLD, AND ITS PROVENANCE — STATED PLAINLY
 * ─────────────────────────────────────────────────────────────────────────────
 * 10%, and it is a CHOSEN DEFAULT, not a derived constant. There is no
 * price-movement threshold in this repo to inherit: grepped 2026-09-03, the only
 * price-change language in the gateway is `pricing-agility.ts:347` and
 * `finance.ts:397`, neither of which sets one, and the read route's own floor is
 * `minFractionBelow = 0.02` (price-below-average.ts:120) — deliberately low,
 * because a BOX may show a small movement while a NOTIFICATION should not
 * interrupt anyone over one.
 *
 * The argument for the number: below about a tenth the movement sits inside the
 * ordinary disagreement between the seven source tiers this table mixes, which
 * the schema's own header says "disagree, constantly"
 * (20260805154027:16-21). That is a reason, not a measurement, and the page note
 * records it as the founder's to move.
 *
 * Two things follow Stripe's shape for exactly this problem
 * (https://docs.stripe.com/billing/subscriptions/usage-based/alerts):
 * `usage_threshold[gte]` is an explicit field an operator sets rather than a
 * constant hidden in code — so this one is overridable through
 * `MARKET_SIGNAL_DROP_PCT` and TRAVELS IN THE NOTIFICATION'S METADATA, where a
 * reader can check the sentence against the number that produced it; and
 * `recurrence: one_time` — an alert "triggers when a customer exceeds the
 * specified usage level for the first time, and only triggers one time" — is why
 * the suppression below is a whole week rather than a tick.
 */

/** The trailing window the average is taken over. The founder's "30 day avg". */
export const MARKET_WINDOW_DAYS = 30;

/** Earlier sightings required behind the average, passed to the read. */
export const MIN_BASELINE_OBSERVATIONS = 3;

/** Products the read is asked to rank. */
export const MARKET_READ_LIMIT = 25;

/** How far below the average the latest quote must sit. See the header. */
export const DEFAULT_DROP_THRESHOLD = 0.1;

/** Env var that overrides it, as a fraction (`0.15`) or a percent (`15`). */
export const DROP_THRESHOLD_ENV = "MARKET_SIGNAL_DROP_PCT";

/**
 * Above this, a "drop" is more likely a parse error than a bargain.
 *
 * 60%: a bottle genuinely offered at less than two-fifths of its own thirty-day
 * mean is rarer than a lost decimal or a case price read as a bottle price, and
 * the row it would write cannot be taken back. Refused loudly rather than sent.
 */
export const IMPLAUSIBLE_DROP_CEILING = 0.6;

/**
 * How long one product's signal stays said. Seven days: long enough that a price
 * sitting below its average all week is one notification rather than seven,
 * short enough that a genuinely new drop next week is heard.
 */
export const SIGNAL_WINDOW_DAYS = 7;

/** The verdict for one product the read has already ranked. */
export type SignalVerdict = "notify" | "below_floor" | "implausible";

export interface SignalDecision {
  verdict: SignalVerdict;
  /** Plain words, for the run row and the log. Never a bare count. */
  reason: string;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `0.15` and `15` both mean fifteen percent; anything else keeps the default. */
export function parseThreshold(raw: unknown): number {
  return readThreshold(raw).value;
}

/**
 * The threshold AND whether the deployment actually set it.
 *
 * The pair matters because the notification states its own threshold: reporting
 * `thresholdSource: "env"` over a value the parser refused would credit the
 * deployment with a number it did not choose, which is a small lie of exactly
 * the kind this page exists to stop telling.
 */
export function readThreshold(raw: unknown): {
  value: number;
  source: "default" | "env";
} {
  if (typeof raw === "string" && raw.trim() === "") {
    return { value: DEFAULT_DROP_THRESHOLD, source: "default" };
  }
  const n = num(raw);
  if (n === null || n <= 0) {
    return { value: DEFAULT_DROP_THRESHOLD, source: "default" };
  }
  const fraction = n > 1 ? n / 100 : n;
  // A threshold at or above 1 would mean "free or better" and can never fire; a
  // threshold below 1% fires on rounding. Both are refused in favour of the
  // default rather than silently producing a producer that never speaks.
  if (fraction < 0.01 || fraction >= 1) {
    return { value: DEFAULT_DROP_THRESHOLD, source: "default" };
  }
  return { value: fraction, source: "env" };
}

/**
 * Is this ranked drop worth a permanent row?
 *
 * Every "no" carries a reason, because a producer that emitted nothing and said
 * nothing is indistinguishable from one that never ran.
 */
export function decideSignal(
  fractionBelow: number | null | undefined,
  thresholdPct: number,
  ceiling: number = IMPLAUSIBLE_DROP_CEILING,
): SignalDecision {
  const fraction = num(fractionBelow);
  if (fraction === null || fraction <= 0) {
    return {
      verdict: "below_floor",
      reason: "The latest sighting is at or above the trailing average.",
    };
  }
  if (fraction > ceiling) {
    return {
      verdict: "implausible",
      reason: `The latest sighting is ${(fraction * 100).toFixed(0)}% below the trailing average, past the ${(ceiling * 100).toFixed(0)}% this house treats as a probable bad parse — a lost decimal, or a case price read as a bottle. Nothing was written; the sighting is still visible in the market box so the source can be corrected.`,
    };
  }
  if (fraction < thresholdPct) {
    return {
      verdict: "below_floor",
      reason: `The latest sighting is ${(fraction * 100).toFixed(1)}% below the trailing average, short of the ${(thresholdPct * 100).toFixed(0)}% this house asks for before it interrupts anyone.`,
    };
  }
  return {
    verdict: "notify",
    reason: `The latest sighting is ${(fraction * 100).toFixed(1)}% below the trailing average.`,
  };
}
