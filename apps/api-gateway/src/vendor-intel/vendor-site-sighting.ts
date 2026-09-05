/**
 * A vendor's own public website, turned into a price sighting.
 *
 * WHY THIS EXISTS
 * ---------------
 * ADR 0117 left one thing explicitly undecided: whether to run the existing
 * `sweepCatalogue` against the vendors that have a website ("§Explicitly NOT
 * decided here", founder question Q1). The founder answered on 2026-09-04:
 * **"Run it, labelled tier 4, never beside a quote."**
 *
 * That answer has two halves and this file is the first one. A public-site
 * price is the weakest class of sighting the register admits — it is a list
 * price on a page nobody signed, it carries no issuer beyond the domain, and
 * it is read by a model out of markup that can change under us. So the row it
 * produces has to say all of that on the row itself: `source_type
 * 'website_scrape'`, `trust_tier 4`, the page URL as `source_ref`, the
 * content hash, `observed_at` as OUR fetch clock, the page's own claimed date
 * in `effective_date` when it makes one, and — the thing the old writer never
 * recorded — an `undated` flag when it makes none.
 *
 * The second half is the comparison gate, and it lives in
 * `price-below-average.ts` (`comparisonClassOf`): a tier-4 row is never
 * averaged against, or compared to, a quote.
 *
 * WHAT THIS FILE DOES NOT DO
 * --------------------------
 * It does not fork the own-paper judgement. `isOutlierAgainstPriors` and
 * `MIN_OUTLIER_SAMPLE` are imported from
 * `../procurement/own-paper-sighting.ts` and re-exported here so both writers
 * are provably the same test with the same sample floor — a second MAD
 * implementation with a different floor would let the two writers disagree
 * about the same row, and nothing would report the disagreement.
 *
 * THE REFUSALS
 * ------------
 * The same five ADR 0117 legs, refused the same way and for the same reasons
 * as `decideOwnPaperSighting`. In particular a missing bottle volume is a
 * REFUSAL and never a 750: `normalizeUnitPrice`
 * (`analytics/engine/vendor-price-consensus.ts:132`) silently skips the volume
 * scaling when `unitVolumeMl` is absent, so a 375ml half-bottle scraped
 * without its size enters the ladder at half its true per-750ml price and
 * becomes the best deal on the page. On a scrape this is the common case, not
 * the corner case — which is exactly why the refusals are counted by reason
 * and reported per vendor rather than swallowed.
 */

import { createHash } from "node:crypto";

import { normalizeUnitPrice } from "../analytics/engine/vendor-price-consensus";
import {
  MIN_OUTLIER_SAMPLE,
  isOutlierAgainstPriors,
} from "../procurement/own-paper-sighting";

// Re-exported, not re-implemented. The scrape writer and the own-paper writer
// must be the same test at the same floor; see the docblock above.
export { MIN_OUTLIER_SAMPLE, isOutlierAgainstPriors };

/**
 * Class and tier for a public-site price.
 *
 * `website_scrape` is already admitted by `vpo_source_type_check`
 * (`supabase/migrations/20260805154027_vendor_price_observations.sql:112-115`,
 * which lists `invoice · quote · api_catalog · website_scrape · chat · social
 * · manual`), so this needs **no migration** — measured by reading the CHECK,
 * not assumed. Tier 4 sits inside `vpo_trust_tier_check` (BETWEEN 1 AND 7).
 */
export const SCRAPE_SOURCE_TYPE = "website_scrape" as const;
export const SCRAPE_TRUST_TIER = 4 as const;

/**
 * Why a scraped row did not become a sighting.
 *
 * A value, not a sentence, because the status endpoint counts these per vendor
 * and a grader that string-matches English prose breaks the first time someone
 * improves the wording — the same reason `ExtractionOutcome` exists in
 * `vendor-page-extraction.ts`.
 */
export type ScrapeRefusalReason =
  | "no_restaurant"
  | "no_url"
  | "no_product_name"
  | "bad_price"
  | "bad_pack"
  | "no_bottle_volume"
  /**
   * Added 2026-09-04 with `bottle-size.ts`. A page that states TWO different
   * bottle sizes for one row and a page that states NONE are different facts,
   * and the standing fault in this codebase is letting a system report absence
   * as health. A conflict counted as `no_bottle_volume` would read as "that
   * merchant does not print sizes", which is the opposite of what happened.
   */
  | "volume_conflict"
  | "unnormalisable";

export interface ScrapeSightingInput {
  /**
   * NEVER null. A public-site price read on one house's behalf is still filed
   * to that house: `belowTrailingAverage` reads `restaurant_id.is.null OR
   * restaurant_id.eq.<tenant>` (`vendor-comparison.service.ts:341`), so a
   * tenant-less row would appear in every other house's market box. ADR 0117
   * counted that as reason 5 for demoting Iowa; it applies here identically.
   */
  restaurantId: string | null | undefined;
  /** The page this was read from. Becomes `source_url` and half of `source_ref`. */
  url: string | null | undefined;
  providerId: string | null;
  vendorCatalogueId?: string | null;
  vendorName: string | null;
  productName: string | null;
  signatureHash: string | null;
  /** The printed price, in the page's own unit. Nothing here converts. */
  price: number | null | undefined;
  currency: string | null | undefined;
  packSize: number | null | undefined;
  /** The bottle's volume as PRINTED. No default: absent is a refusal. */
  unitVolumeMl: number | null | undefined;
  /**
   * How the volume above was read, and the page's own words for it.
   *
   * Filled by `readBottleSize` (`bottle-size.ts`). Every one of these lands in
   * `raw.volume` on the row, so a person looking at a sighting six months from
   * now can see not only that it says 750ml but WHERE on the vendor's page
   * that 750 came from and what the page actually wrote. ADR 0117's rule is
   * that a sighting names its unit; naming the unit without naming where the
   * unit was read is half a provenance.
   */
  volume?: {
    source: string;
    statement: string;
    locator: string;
    /** Every place the page stated a size for this row, agreeing or not. */
    candidates?: Array<{ source: string; ml: number; statement: string; locator: string }>;
    /** True when the volume is not a format the EU Annex or trade knows. */
    nonStandardFormat?: boolean;
    /** Notes from the read — e.g. that the structured data named another product. */
    notes?: string[];
  } | null;
  /**
   * Set when the page stated two different sizes for this row. Refused before
   * the missing-volume check, so a contradiction never renders as an absence.
   */
  volumeConflict?: { message: string; candidates: unknown[] } | null;
  /** The page's own stated date, ISO, or null when the page states none. */
  pageStatedDate: string | null;
  /** When we fetched. Always known; never stands in silently for the above. */
  fetchedAt: string;
  contentHash: string;
  httpStatus: number | null;
  parseConfidence: number | null;
  raw?: Record<string, unknown>;
}

export interface ScrapeSightingRow {
  restaurant_id: string;
  provider_id: string | null;
  vendor_catalogue_id: string | null;
  vendor_name_raw: string | null;
  product_name_raw: string;
  signature_hash: string | null;
  source_type: typeof SCRAPE_SOURCE_TYPE;
  trust_tier: typeof SCRAPE_TRUST_TIER;
  source_ref: string;
  source_url: string;
  observed_at: string;
  effective_date: string | null;
  raw_price: number;
  currency: string;
  pack_size: number;
  unit_volume_ml: number;
  normalized_unit_price: number;
  normalization_note: string;
  parse_confidence: number | null;
  content_hash: string;
  http_status: number | null;
  is_outlier: boolean;
  raw: Record<string, unknown>;
}

export type ScrapeSightingDecision =
  | { write: false; reason: ScrapeRefusalReason; message: string }
  | {
      write: true;
      sourceRef: string;
      normalizedUnitPrice: number;
      row: ScrapeSightingRow;
    };

function positiveInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * The date a vendor page states about itself, if it states one.
 *
 * WHY THIS IS NOT `now()`. ADR 0117's staleness gate exists because of a
 * measured case: `https://www.ams.usda.gov/mnreports/bh_fv020.txt` returned
 * HTTP 200 on 2026-09-04 carrying a price list headed "as of 03-JAN-2024" —
 * 975 days stale — and a fetcher that read the status code as freshness would
 * have written January-2024 prices as today's. A vendor's price page has the
 * same failure mode and no status code that reveals it.
 *
 * WHY IT LOOKS ONLY FOR AN EXPLICIT LABEL. The patterns below require a word
 * that CLAIMS the date is the page's own ("prices effective", "price list as
 * of", "updated", "last updated", "revised"). A bare date anywhere in the text
 * is ignored: a wine page is full of vintages, delivery windows and copyright
 * years, and picking one of those up would stamp a sighting with a date the
 * vendor never asserted — which is worse than having no date, because it
 * looks like provenance.
 *
 * Returns null when nothing qualifies. Null is the flag: the row's
 * `effective_date` stays NULL and `raw.undated` is true. It never affects
 * `observed_at`, which is our fetch clock either way.
 */
export function readPageStatedDate(
  text: string,
  now: Date = new Date(),
): string | null {
  if (typeof text !== "string" || !text) return null;
  const head = text.slice(0, 20_000);

  const LABEL =
    "(?:price[s]?\\s+(?:list\\s+)?(?:effective|valid|current)|effective(?:\\s+date)?|last\\s+updated|updated|revised|as\\s+of|price\\s+list)";
  const MONTHS = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
  const patterns = [
    // "Prices effective 12 March 2026" / "Updated March 12, 2026"
    new RegExp(
      `${LABEL}[^\\n]{0,24}?\\b(\\d{1,2}\\s+${MONTHS}\\.?,?\\s+\\d{4})`,
      "i",
    ),
    new RegExp(
      `${LABEL}[^\\n]{0,24}?\\b(${MONTHS}\\.?\\s+\\d{1,2},?\\s+\\d{4})`,
      "i",
    ),
    // "Price list as of 2026-03-12"
    new RegExp(`${LABEL}[^\\n]{0,24}?\\b(\\d{4}-\\d{2}-\\d{2})\\b`, "i"),
    // "Updated 03/12/2026" — read as US month/day, the convention of the
    // English-language vendor pages this fetcher reads. Ambiguous by nature,
    // which is why it is last and why the row keeps the matched text verbatim.
    new RegExp(`${LABEL}[^\\n]{0,24}?\\b(\\d{1,2}/\\d{1,2}/\\d{4})\\b`, "i"),
  ];

  for (const re of patterns) {
    const m = head.match(re);
    if (!m) continue;
    const parsed = new Date(m[1].replace(/(\d)(st|nd|rd|th)\b/gi, "$1"));
    if (Number.isNaN(parsed.getTime())) continue;
    // A page dated in the future is stating something we cannot verify and is
    // more likely a parse of the wrong string than a genuine forward date.
    if (parsed.getTime() > now.getTime() + 86_400_000) continue;
    // Nor is a date before the web-shop era a plausible price-list date; a
    // "1998" here is a vintage or a copyright line that slipped the label.
    if (parsed.getUTCFullYear() < 2000) continue;
    return parsed.toISOString();
  }
  return null;
}

/**
 * Build the sighting, or say which of ADR 0117's five legs is missing.
 *
 * `isOutlier` is passed in rather than computed here for the same reason it is
 * in `decideOwnPaperSighting`: outlier-ness is a property of the GROUP, and
 * only the caller has read the group.
 */
export function decideScrapeSighting(
  input: ScrapeSightingInput,
  opts: { isOutlier?: boolean } = {},
): ScrapeSightingDecision {
  const restaurantId =
    typeof input.restaurantId === "string" && input.restaurantId.trim()
      ? input.restaurantId.trim()
      : null;
  if (!restaurantId) {
    return {
      write: false,
      reason: "no_restaurant",
      message:
        "No sighting written: the sweep did not name a restaurant. A row " +
        "with a null restaurant_id is read by every other house's market box.",
    };
  }

  const url =
    typeof input.url === "string" && input.url.trim() ? input.url.trim() : null;
  if (!url) {
    return {
      write: false,
      reason: "no_url",
      message:
        "No sighting written: no page URL, so nothing could trace the number " +
        "back to the page it was read from.",
    };
  }

  const productName =
    typeof input.productName === "string" && input.productName.trim()
      ? input.productName.trim()
      : null;
  if (!productName) {
    return {
      write: false,
      reason: "no_product_name",
      message: `No sighting written for a row on ${url}: it names no product.`,
    };
  }

  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) {
    return {
      write: false,
      reason: "bad_price",
      message:
        `No sighting written for ${JSON.stringify(productName)} on ${url}: ` +
        `the price is ${JSON.stringify(input.price)}. A zero or absent price ` +
        `is not an observation, and writing one would drag every average ` +
        `through it.`,
    };
  }

  const packSize = positiveInt(input.packSize);
  if (packSize === null) {
    return {
      write: false,
      reason: "bad_pack",
      message:
        `No sighting written for ${JSON.stringify(productName)} on ${url}: ` +
        `the pack size is ${JSON.stringify(input.packSize)}. Without it the ` +
        `register cannot tell a case price from a bottle price, and ranking ` +
        `them together recommends the wrong vendor by a factor of the pack.`,
    };
  }

  // A CONTRADICTION IS NOT AN ABSENCE. Checked before the missing-volume leg
  // so the two never collapse into one count: `no_bottle_volume` means the
  // page printed no size, `volume_conflict` means it printed two that disagree.
  if (input.volumeConflict) {
    return {
      write: false,
      reason: "volume_conflict",
      message: input.volumeConflict.message,
    };
  }

  const unitVolumeMl = positiveInt(input.unitVolumeMl);
  if (unitVolumeMl === null) {
    return {
      write: false,
      reason: "no_bottle_volume",
      message:
        `No sighting written for ${JSON.stringify(productName)} on ${url}: ` +
        `the page does not print a bottle size, so the number has no unit. ` +
        `Refusing rather than assuming 750ml: a 375ml bottle written as 750 ` +
        `halves its unit price and becomes the best deal on the ladder.`,
    };
  }

  // THE TWO DATES, AND WHICH COLUMN EACH GOES IN.
  //
  // CORRECTED 2026-09-04, on the founder's second call, against this file's
  // first cut. `observed_at` is **when WE saw it** — our fetch clock, always,
  // whether or not the page dated itself. The page's own claim goes to
  // `effective_date`, the date the price APPLIES from.
  //
  // This restores the column's own comment (`…vendor_price_observations.sql:75-78`:
  // "When we saw it vs when the price applies") and ADR 0117's provenance
  // table, which maps `fetched_at -> observed_at` and `issued_at ->
  // effective_date`. The first cut put the page's claimed date into
  // `observed_at`, and it was wrong in a way that matters: the comparison
  // windows on `observed_at`, so a page claiming "prices effective 1 July"
  // would have dropped a sighting we read TODAY out of a 30-day window — and a
  // forward claim would have held a stale price inside one. The window must be
  // a fact about our reading, which we control and can audit, never about a
  // claim printed on a page we do not control.
  //
  // Both dates are on the row regardless, and `undated` still says which pages
  // made no claim at all.
  const fetchedAt = new Date(input.fetchedAt);
  const fetchedAtIso = Number.isNaN(fetchedAt.getTime())
    ? new Date().toISOString()
    : fetchedAt.toISOString();
  const stated = input.pageStatedDate ? new Date(input.pageStatedDate) : null;
  const statedOk = stated && !Number.isNaN(stated.getTime()) ? stated : null;
  const observedAt = fetchedAtIso;
  const dateBasis: "page_stated" | "fetch_time_undated" = statedOk
    ? "page_stated"
    : "fetch_time_undated";

  const currency = (input.currency ?? "USD").toUpperCase().slice(0, 3);

  const { unitPrice: normalized, note } = normalizeUnitPrice({
    price,
    sourceType: SCRAPE_SOURCE_TYPE,
    observedAt,
    packSize,
    unitVolumeMl,
    yieldFactor: 1,
  });
  if (normalized === null || !(normalized > 0)) {
    return {
      write: false,
      reason: "unnormalisable",
      message:
        `No sighting written for ${JSON.stringify(productName)} on ${url}: ` +
        `the price could not be reduced to a per-750ml figure (${note}).`,
    };
  }

  // Per-item source_ref, matching the writer this replaces
  // (`vendor-page-extractor.service.ts:312`): the page is one document but each
  // wine on it is a distinct observation, and the UNIQUE (source_ref,
  // content_hash) index is only meaningful if the pair is per-row.
  const sourceRef = `${url}#${productName}`;

  return {
    write: true,
    sourceRef,
    normalizedUnitPrice: normalized,
    row: {
      restaurant_id: restaurantId,
      provider_id: input.providerId ?? null,
      vendor_catalogue_id: input.vendorCatalogueId ?? null,
      vendor_name_raw: input.vendorName ?? null,
      product_name_raw: productName,
      signature_hash: input.signatureHash ?? null,
      source_type: SCRAPE_SOURCE_TYPE,
      trust_tier: SCRAPE_TRUST_TIER,
      source_ref: sourceRef,
      source_url: url,
      // When WE saw it. The comparison window reads this column, so it is our
      // clock and nothing else.
      observed_at: observedAt,
      // When the price APPLIES, per the page's own claim. Only the vendor can
      // fill it; our fetch time is not their effective date and writing it here
      // would manufacture provenance. NULL is the honest value for an undated
      // page, and `raw.undated` says so in the same breath.
      effective_date: statedOk ? statedOk.toISOString().slice(0, 10) : null,
      raw_price: Math.round(price * 100) / 100,
      currency,
      pack_size: packSize,
      unit_volume_ml: unitVolumeMl,
      normalized_unit_price: normalized,
      normalization_note: note,
      parse_confidence: input.parseConfidence ?? null,
      content_hash: input.contentHash,
      http_status: input.httpStatus,
      is_outlier: opts.isOutlier === true,
      raw: {
        ...(input.raw ?? {}),
        origin: "vendor_site_sweep",
        sourceClass: "public_site",
        trustTier: SCRAPE_TRUST_TIER,
        // The two dates, both named, always. `observed_at` is ALWAYS this
        // `fetchedAt`; `undated` true means the vendor printed no date of its
        // own, so `effective_date` is NULL and nothing is claimed about when
        // the price began to apply.
        fetchedAt: fetchedAtIso,
        pageStatedDate: statedOk ? statedOk.toISOString() : null,
        dateBasis,
        undated: dateBasis === "fetch_time_undated",
        // WHERE the unit came from, in the page's own words. Absent only when
        // the caller did not read the markup at all (the manual `POST
        // /vendor-intel/scrape` path can still hand a volume straight in), and
        // absent is stated rather than implied.
        volume: input.volume ?? null,
      },
    },
  };
}

/**
 * Compute a hash for the run so a re-read of an unchanged page is discarded.
 *
 * Exported for the sweep's own bookkeeping; the row's `content_hash` is the
 * page-text hash the extractor already computes
 * (`vendor-page-extractor.service.ts:201`), deliberately over the extracted
 * TEXT and not the markup.
 */
export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
