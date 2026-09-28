/**
 * The nightly re-judge of `is_outlier` — the pure half.
 *
 * WHY THIS EXISTS
 * ---------------
 * ADR 0117 §"The `is_outlier` writer" specified the flag as a pass over the
 * GROUP after a batch lands. On 2026-09-04 the founder instructed the two
 * sighting writers to flag AT WRITE TIME instead, and both do
 * (`procurement/own-paper-sighting.ts` through `procurement.service.ts`; the
 * site sweep through `vendor-intel/vendor-page-extractor.service.ts`). ADR 0117
 * Q7 then asked whether the batch pass should still be built. The founder's
 * answer is BOTH, and the two are not redundant:
 *
 *   * The write-time flag is the only judge that exists in the hours between
 *     a bad parse landing and any batch running. Without it the ladder is
 *     wrong all day.
 *   * The write-time flag can never be revisited. It is decided against the
 *     priors that happened to exist at that instant, and a row flagged against
 *     four neighbours stays flagged forever even after forty more arrive that
 *     prove it ordinary. Only a pass over the group can clear it.
 *
 * So: write time protects, the re-judge corrects. This module is the second.
 *
 * WHAT WINDOW IT JUDGES OVER, AND WHY THAT ONE
 * --------------------------------------------
 * The verdict must be true for the reader that consumes it. The reader is
 * `VendorComparisonService.belowTrailingAverage`, whose window is
 * `windowDays ?? 30` trailing from now and whose filter is
 * `.eq("is_outlier", false)` — so a flag decided over any other set of rows is
 * a verdict about a comparison nobody performs. This pass therefore judges
 * exactly the reader's window: sightings with `observed_at >=
 * now - REJUDGE_WINDOW_DAYS`, and nothing older.
 *
 * A row that has fallen out of that window is left EXACTLY as it is. It is
 * outside every ladder the readers build, so re-judging it would be a write
 * nobody can observe, and clearing it would quietly rewrite history.
 *
 * WHAT IT GROUPS BY, AND THE ONE PLACE IT IS NARROWER THAN THE READER
 * -------------------------------------------------------------------
 * Groups are `(tenant scope, product identity, comparison class)`:
 *
 *   * COMPARISON CLASS from `comparisonClassOf` (`price-below-average.ts`), so
 *     ADR 0117's closing rule — "a sighting may only ever be compared to
 *     another sighting of its own class" — holds for the flag as well as for
 *     the ladder. A tier-4 public-site price must not be able to flag a
 *     tier-1 invoice as deviant.
 *   * TENANT SCOPE is `restaurant_id`, with market rows (`restaurant_id IS
 *     NULL`) forming their own group. This is DELIBERATELY NARROWER than the
 *     reader, which reads `restaurant_id.is.null OR restaurant_id.eq.<tenant>`
 *     — i.e. each house sees market rows UNIONED with its own. A market row
 *     therefore sits in as many reader-groups as there are houses, and
 *     `is_outlier` is ONE boolean on ONE row: it physically cannot carry a
 *     different verdict per house. Judging a market row against its own class
 *     of market rows is the only verdict that is true for every reader of it;
 *     judging it inside one tenant's union would let one house's invoices
 *     decide what every other house is allowed to see. Recorded as a founder-
 *     visible consequence in ADR 0117 rather than hidden here.
 *
 * WHAT IT NEVER DOES
 * ------------------
 *   * It never touches a group with fewer than `MIN_OUTLIER_SAMPLE` usable
 *     values. That floor is the same one the write-time judge uses and it
 *     exists for the same reason: below it, `flagOutliers`' MAD-is-zero branch
 *     flags a majority of the group (`own-paper-sighting.ts`).
 *   * It never bounds, clamps, rounds or deletes a price. The only columns it
 *     writes are the verdict and its explanation.
 *   * It never lets one product's failure stop another's. Grouping is pure
 *     here; the service applies each group's updates independently.
 */

import { flagOutliers } from "../analytics/engine/vendor-price-consensus";
import { normalizeUnitPrice } from "../analytics/engine/vendor-price-consensus";
import type { PriceSourceType } from "../analytics/engine/vendor-price-consensus";
import { ComparisonClass, comparisonClassOf } from "./price-below-average";
// The floor and the test are imported, never re-implemented: a second copy of
// a dispersion rule is a second answer to the same question.
import { MIN_OUTLIER_SAMPLE } from "./vendor-site-sighting";
import { isSweepArmed } from "./vendor-site-sweep";

/** Environment flag. Unset everywhere: this job is OFF until someone arms it. */
export const REJUDGE_ENABLED_FLAG = "PRICE_OUTLIER_REJUDGE_ENABLED";

/**
 * Nightly, 03:40 server time.
 *
 * Off the hour and off the half hour on purpose — the site sweep and the other
 * scheduled work in this gateway cluster on :00 and :30, and a re-judge that
 * runs while a sweep is still inserting judges half a batch.
 */
export const REJUDGE_CRON = "0 40 3 * * *";
export const REJUDGE_JOB_NAME = "price-outlier-rejudge";

/**
 * The trailing window, in days. 30 because that is
 * `belowTrailingAverage`'s `windowDays ?? 30` — see the header. If that default
 * ever changes, this must change with it or the verdict stops describing the
 * comparison the reader performs.
 */
export const REJUDGE_WINDOW_DAYS = 30;

export { MIN_OUTLIER_SAMPLE };

/** Is the nightly re-judge switched on? Same parser as the site sweep's flag. */
export function isRejudgeArmed(raw: string | undefined | null): boolean {
  return isSweepArmed(raw);
}

/** A register row, as the re-judge needs to read it. */
export interface RejudgeRow {
  id: string;
  restaurant_id: string | null;
  master_wine_id: string | null;
  signature_hash: string | null;
  source_type: string;
  observed_at: string;
  raw_price: number | string | null;
  currency: string | null;
  pack_size: number | string | null;
  unit_volume_ml: number | string | null;
  yield_factor: number | string | null;
  is_outlier: boolean;
  outlier_basis: string | null;
}

/** One row's new verdict. */
export interface RejudgeUpdate {
  id: string;
  isOutlier: boolean;
  /** True when this differs from what the row already said. */
  flipped: boolean;
  reason: string;
  basis: "rejudge";
  judgedAt: string;
}

export type GroupSilenceReason =
  | "thin_window"
  | "mixed_currency"
  | "unrecognised_class";

export const GROUP_SILENCE_SENTENCE: Readonly<
  Record<GroupSilenceReason, string>
> = Object.freeze({
  thin_window: `Fewer than ${MIN_OUTLIER_SAMPLE} comparable sightings in the window, which is below the floor at which a deviation test means anything. Every row in this group was left exactly as it was — none of them is claimed to be clean.`,
  mixed_currency:
    "The sightings in this window are in more than one currency, and no exchange rate was recorded with any of them. Comparing the numbers directly would invent one, so nothing here was judged.",
  unrecognised_class:
    "These sightings carry a source type this build has no comparison class for, so it is not known what they may honestly be set beside. Left unjudged and counted, deliberately loudly.",
});

/** What happened to one (tenant, product, class) group. */
export interface RejudgeGroup {
  key: string;
  restaurantScope: string;
  productKey: string;
  sourceClass: ComparisonClass;
  /** Rows whose price could be normalised — the ones the test ran over. */
  comparable: number;
  /** Rows dropped before the test because their price would not normalise. */
  unnormalisable: number;
  judged: boolean;
  silence: { reason: GroupSilenceReason; sentence: string } | null;
  updates: RejudgeUpdate[];
}

export interface RejudgePlan {
  groups: RejudgeGroup[];
  /** Rows carrying no product identity at all; comparable with nothing. */
  noProductKey: number;
  windowDays: number;
  windowFrom: string;
  judgedAt: string;
}

function numeric(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Decide every row's verdict. Pure: no clock beyond `now`, no database.
 *
 * `now` is the judged-at stamp for every row this run touches, so one run
 * leaves one timestamp and "which pass decided this" is answerable.
 */
export function planRejudge(
  rows: readonly RejudgeRow[],
  now: Date = new Date(),
  opts: { windowDays?: number } = {},
): RejudgePlan {
  const windowDays = opts.windowDays ?? REJUDGE_WINDOW_DAYS;
  const judgedAt = now.toISOString();
  const windowFrom = new Date(
    now.getTime() - windowDays * 86_400_000,
  ).toISOString();

  interface Bucket {
    restaurantScope: string;
    productKey: string;
    sourceClass: ComparisonClass;
    rows: Array<{ row: RejudgeRow; unitPrice: number | null; currency: string }>;
  }
  const buckets = new Map<string, Bucket>();
  let noProductKey = 0;

  for (const row of rows) {
    const productKey = row.master_wine_id
      ? `wine:${row.master_wine_id}`
      : row.signature_hash
        ? `sig:${row.signature_hash}`
        : null;
    if (!productKey) {
      // Grouping by free text would merge two different bottles that share a
      // label — the same refusal `price-below-average.ts` makes.
      noProductKey += 1;
      continue;
    }

    const cls = comparisonClassOf(row.source_type);
    const scope = row.restaurant_id ?? "market";
    const key = `${scope}|${productKey}|${cls}`;

    const price = numeric(row.raw_price);
    let unitPrice: number | null = null;
    if (price !== null) {
      const norm = normalizeUnitPrice({
        price,
        sourceType: row.source_type as PriceSourceType,
        observedAt: row.observed_at,
        packSize: numeric(row.pack_size) ?? 1,
        unitVolumeMl: numeric(row.unit_volume_ml) ?? undefined,
        yieldFactor: numeric(row.yield_factor) ?? 1,
      });
      unitPrice = norm.unitPrice;
    }

    const bucket = buckets.get(key) ?? {
      restaurantScope: scope,
      productKey,
      sourceClass: cls,
      rows: [],
    };
    bucket.rows.push({
      row,
      unitPrice,
      currency: (row.currency ?? "USD").toUpperCase(),
    });
    buckets.set(key, bucket);
  }

  const groups: RejudgeGroup[] = [];

  for (const [key, bucket] of buckets) {
    const usable = bucket.rows.filter(
      (r) => r.unitPrice !== null && Number.isFinite(r.unitPrice),
    );
    const unnormalisable = bucket.rows.length - usable.length;

    const silent = (reason: GroupSilenceReason): RejudgeGroup => ({
      key,
      restaurantScope: bucket.restaurantScope,
      productKey: bucket.productKey,
      sourceClass: bucket.sourceClass,
      comparable: usable.length,
      unnormalisable,
      judged: false,
      silence: { reason, sentence: GROUP_SILENCE_SENTENCE[reason] },
      updates: [],
    });

    if (bucket.sourceClass.startsWith("other:")) {
      groups.push(silent("unrecognised_class"));
      continue;
    }
    if (new Set(usable.map((r) => r.currency)).size > 1) {
      groups.push(silent("mixed_currency"));
      continue;
    }
    if (usable.length < MIN_OUTLIER_SAMPLE) {
      groups.push(silent("thin_window"));
      continue;
    }

    const values = usable.map((r) => r.unitPrice as number);
    const flags = flagOutliers(values);
    const updates: RejudgeUpdate[] = usable.map((r, i) => {
      const isOutlier = flags[i] === true;
      const flipped = isOutlier !== r.row.is_outlier;
      const priced = (r.unitPrice as number).toFixed(2);
      const reason = isOutlier
        ? `Flagged by the nightly re-judge of ${judgedAt}: at ${priced} ${r.currency} per comparable unit this sighting sits more than 3.5 robust deviations from the median of the ${values.length} ${bucket.sourceClass === "public_site" ? "public-site" : "quoted"} sightings of this product in the last ${windowDays} days. It is still stored and still visible; it is kept out of the "cheaper than usual" ladder until the number is corrected at source.`
        : `Judged clean by the nightly re-judge of ${judgedAt}: at ${priced} ${r.currency} per comparable unit this sighting sits within 3.5 robust deviations of the median of the ${values.length} sightings of this product in the last ${windowDays} days.`;
      return { id: r.row.id, isOutlier, flipped, reason, basis: "rejudge", judgedAt };
    });

    groups.push({
      key,
      restaurantScope: bucket.restaurantScope,
      productKey: bucket.productKey,
      sourceClass: bucket.sourceClass,
      comparable: usable.length,
      unnormalisable,
      judged: true,
      silence: null,
      updates,
    });
  }

  return { groups, noProductKey, windowDays, windowFrom, judgedAt };
}

/** A run's outcome, as the status route prints it. */
export interface RejudgeRunSummary {
  startedAt: string;
  finishedAt: string;
  windowDays: number;
  windowFrom: string;
  rowsRead: number;
  groupsSeen: number;
  groupsJudged: number;
  rowsJudged: number;
  flippedToOutlier: number;
  flippedToClean: number;
  /** Groups left alone, by the reason they were left alone. */
  groupsSilent: Record<GroupSilenceReason, number>;
  /** Rows with no product identity at all. */
  noProductKey: number;
  /** Groups whose write failed. One product's failure stops nothing else. */
  groupsFailed: number;
  failures: Array<{ key: string; message: string }>;
  dryRun: boolean;
}

export function emptySilenceCounts(): Record<GroupSilenceReason, number> {
  return { thin_window: 0, mixed_currency: 0, unrecognised_class: 0 };
}
