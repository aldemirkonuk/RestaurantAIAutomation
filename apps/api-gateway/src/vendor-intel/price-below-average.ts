import {
  PriceSourceType,
  normalizeUnitPrice,
} from "../analytics/engine/vendor-price-consensus";

/**
 * "X is now selling lower than its 30-day average" — the pure half.
 *
 * The founder asked /notifications for a box that says a product is cheaper
 * now than it has lately been, so the house can buy while it is cheap. The
 * arithmetic is small; the honesty is not, so all of it lives here where it
 * can be tested without a database:
 *
 *  1. THE AVERAGE EXCLUDES THE LATEST SIGHTING. A mean that contains the
 *     value it is being compared against damps its own signal — with three
 *     sightings the latest contributes a third of the bar it must clear. The
 *     comparison is "against what this product had been going for", so the
 *     baseline is the EARLIER sightings only, and the result says so
 *     (`averageExcludesLatest`).
 *  2. A THIN HISTORY IS NOT A SIGNAL. One earlier sighting is an anecdote,
 *     not an average; groups under `minObservations` are counted and reported
 *     as skipped rather than ranked.
 *  3. CURRENCIES ARE NEVER CONVERTED. A group whose window mixes currencies
 *     is dropped with a reason — an invented FX rate is a fabricated saving.
 *  4. AN UNNORMALISABLE ROW LEAVES THE COMPARISON. `normalizeUnitPrice`
 *     returns null when pack size or yield cannot support the conversion;
 *     such a row is dropped, never defaulted to its raw price.
 *  5. OUTLIERS ARE EXCLUDED BY THE CALLER (`is_outlier`), because
 *     outlier-ness is a property of the group computed by the consensus pass,
 *     not something to re-decide here.
 *  6. A SIGHTING IS ONLY EVER COMPARED TO ITS OWN CLASS. Added 2026-09-04.
 *     ADR 0117's decision sentence ends "*and a sighting may only ever be
 *     compared to another sighting of its own class*", and until this pass
 *     nothing here enforced it: a group was keyed on product identity alone,
 *     so a tier-4 public-site list price arriving today became "the latest"
 *     for a product whose earlier sightings were the house's own invoices,
 *     and the box announced a saving between two numbers that are not the
 *     same kind of number. The founder's call of 2026-09-04 — "run the vendor
 *     site sweep, labelled tier 4, **never beside a quote**" — is this rule.
 *     See `comparisonClassOf`.
 *
 * Every row that does not make it into the answer is counted, so the reader is
 * told what was looked at rather than shown a short list that could equally
 * mean "nothing is cheap" or "nothing was read".
 */

/** One vendor price sighting, as the table stores it. */
export interface ObservationRow {
  master_wine_id: string | null;
  signature_hash: string | null;
  product_name_raw: string | null;
  vendor_name_raw: string | null;
  provider_id: string | null;
  source_type: string;
  observed_at: string;
  raw_price: number | string | null;
  currency: string | null;
  pack_size: number | string | null;
  unit_volume_ml: number | string | null;
  yield_factor: number | string | null;
}

/**
 * The comparison classes, and the one rule that separates them.
 *
 * ADR 0117 names five source classes (A own paper, B posted wholesale, C
 * licensed feed, D retail reference, E public index) and says which may be set
 * beside which. Only two of them can be told apart from `source_type` alone,
 * because `source_type`'s CHECK
 * (`supabase/migrations/20260805154027_vendor_price_observations.sql:112-115`)
 * has no value meaning "a government's posted list" — ADR 0117 §"The
 * provenance a sighting must carry" records that gap and calls the migration
 * that closes it a precondition of class B/D/E ever being written. So this
 * function draws the only line the data actually supports today, which is also
 * exactly the line the founder drew:
 *
 *   • `quoted`      — a price a vendor gave, or the house's own paper:
 *                     `invoice`, `quote`, `api_catalog`, `chat`, `social`,
 *                     `manual`. ADR 0117 classes A and C.
 *   • `public_site` — `website_scrape`. A list price on a public page, tier 4,
 *                     signed by nobody.
 *
 * An UNRECOGNISED `source_type` gets a class of its very own
 * (`other:<value>`), never folded into `quoted`. That is deliberate: when the
 * class-B migration lands and a `posted_wholesale` value appears, the failure
 * mode of this function must be "the new rows compare only with each other and
 * someone notices", not "the new rows silently join the quotes". Absence
 * reported as health is the fault this repo keeps meeting; a default branch
 * that swallows an unknown class is that fault in one line.
 */
export type ComparisonClass = "quoted" | "public_site" | `other:${string}`;

const QUOTED_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "invoice",
  "quote",
  "api_catalog",
  "chat",
  "social",
  "manual",
]);

export function comparisonClassOf(sourceType: string | null): ComparisonClass {
  const s = (sourceType ?? "").trim().toLowerCase();
  if (s === "website_scrape") return "public_site";
  if (QUOTED_SOURCE_TYPES.has(s)) return "quoted";
  return `other:${s || "unstated"}`;
}

/** Human label for a class, for the box that has to print it. */
export const COMPARISON_CLASS_LABEL: Readonly<Record<string, string>> =
  Object.freeze({
    quoted: "Quoted to this house",
    public_site: "Public vendor site (tier 4)",
  });

export interface BelowAverageItem {
  /** `wine:<uuid>` or `sig:<hash>` — how the sightings were grouped. */
  productKey: string;
  /**
   * The class every sighting in this comparison shares. A product with both
   * quotes and scraped prices yields up to one item per class, never one item
   * mixing them.
   */
  sourceClass: ComparisonClass;
  productName: string | null;
  currency: string;
  /** The most recent sighting in the window. */
  latest: {
    unitPrice: number;
    observedAt: string;
    vendorName: string | null;
    sourceType: string;
  };
  /** The mean of the EARLIER sightings in the window. */
  average: {
    unitPrice: number;
    /** How many earlier sightings the mean is made of. */
    observations: number;
    from: string;
    to: string;
  };
  /** average − latest, in the group's own currency. Always > 0 here. */
  absoluteBelow: number;
  /** absoluteBelow / average, as a fraction. */
  fractionBelow: number;
}

export interface BelowAverageSkips {
  noProductKey: number;
  unnormalisable: number;
  thinHistory: number;
  mixedCurrency: number;
  notBelow: number;
  /**
   * Comparisons whose `source_type` this file has no class for. Ranked
   * nowhere; counted here so the addition of a new source type is loud.
   */
  unrecognisedClass: number;
}

/**
 * The classes that may appear in `items`. `public_site` is deliberately not
 * one of them: the founder's rule is that a tier-4 page price is shown, and
 * shown apart. It comes back in `publicSiteItems`, its own line.
 */
export const RANKED_CLASSES: readonly ComparisonClass[] = Object.freeze([
  "quoted",
]);

export interface BelowAverageResult {
  /** Comparisons between prices a vendor gave this house. The news. */
  items: BelowAverageItem[];
  /**
   * Comparisons between public vendor-site list prices, tier 4. Its own line,
   * never merged into `items` — the founder's rule of 2026-09-04.
   */
  publicSiteItems: BelowAverageItem[];
  /**
   * What the window actually contained, so an empty answer can be read.
   *
   * `products` counts distinct product identities; `comparisons` counts the
   * (product, class) groups those identities split into. When the two differ,
   * at least one product carried more than one class of sighting and they were
   * NOT averaged together — the difference is the visible evidence that rule 6
   * fired, rather than a silent partition nobody can see.
   */
  scanned: { observations: number; products: number; comparisons: number };
  /** How many sightings arrived in each class. Printed by the box. */
  byClass: Record<string, number>;
  skipped: BelowAverageSkips;
  averageExcludesLatest: true;
  minObservations: number;
  /** Which classes may be ranked into `items`, and which are listed apart. */
  classesRanked: readonly ComparisonClass[];
}

function numeric(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rank the products whose newest sighting sits below the mean of the earlier
 * sightings in the same window.
 *
 * `minObservations` counts the EARLIER sightings, not the total: three means
 * "a latest plus three to compare it against".
 */
export function priceBelowAverage(
  rows: ObservationRow[],
  opts: {
    minObservations?: number;
    limit?: number;
    /** Ignore a drop smaller than this fraction — noise, not news. */
    minFractionBelow?: number;
  } = {},
): BelowAverageResult {
  const minObservations = opts.minObservations ?? 3;
  const limit = opts.limit ?? 5;
  const minFractionBelow = opts.minFractionBelow ?? 0.02;

  const skipped: BelowAverageSkips = {
    noProductKey: 0,
    unnormalisable: 0,
    thinHistory: 0,
    mixedCurrency: 0,
    notBelow: 0,
    unrecognisedClass: 0,
  };

  interface Point {
    unitPrice: number;
    observedAt: string;
    currency: string;
    vendorName: string | null;
    sourceType: string;
    label: string | null;
  }
  /**
   * One entry per (product, class) - rule 6. The identity is kept as fields
   * rather than parsed back out of the map key: a key that has to be split
   * again is a key that can be split wrongly, and it was - the first cut of
   * this change recovered the class with `lastIndexOf(" ")` and classified
   * every group as unrecognised.
   */
  interface Group {
    productKey: string;
    sourceClass: ComparisonClass;
    points: Point[];
  }
  const groups = new Map<string, Group>();
  const productKeys = new Set<string>();
  const byClass: Record<string, number> = {};

  for (const row of rows) {
    const productKey = row.master_wine_id
      ? `wine:${row.master_wine_id}`
      : row.signature_hash
        ? `sig:${row.signature_hash}`
        : null;
    const cls = comparisonClassOf(row.source_type);
    const key = productKey === null ? null : `${productKey} ${cls}`;
    if (!key) {
      // No identity: this sighting cannot be compared with any other, and
      // grouping it by its free-text name would merge two different bottles
      // that happen to share a label.
      skipped.noProductKey += 1;
      continue;
    }

    const price = numeric(row.raw_price);
    if (price === null) {
      skipped.unnormalisable += 1;
      continue;
    }
    const { unitPrice } = normalizeUnitPrice({
      price,
      sourceType: row.source_type as PriceSourceType,
      observedAt: row.observed_at,
      packSize: numeric(row.pack_size) ?? 1,
      unitVolumeMl: numeric(row.unit_volume_ml) ?? undefined,
      yieldFactor: numeric(row.yield_factor) ?? 1,
    });
    if (unitPrice === null) {
      skipped.unnormalisable += 1;
      continue;
    }

    productKeys.add(productKey as string);
    byClass[cls] = (byClass[cls] ?? 0) + 1;

    const bucket = groups.get(key) ?? {
      productKey: productKey as string,
      sourceClass: cls,
      points: [],
    };
    bucket.points.push({
      unitPrice,
      observedAt: row.observed_at,
      currency: (row.currency ?? "USD").toUpperCase(),
      vendorName: row.vendor_name_raw,
      sourceType: row.source_type,
      label: row.product_name_raw,
    });
    groups.set(key, bucket);
  }

  const items: BelowAverageItem[] = [];
  const publicSiteItems: BelowAverageItem[] = [];

  for (const { productKey, sourceClass, points } of groups.values()) {
    const currencies = new Set(points.map((p) => p.currency));
    if (currencies.size > 1) {
      // Converting would require an FX rate nobody recorded; a saving stated
      // in a rate we invented is a fabricated saving.
      skipped.mixedCurrency += 1;
      continue;
    }
    const sorted = [...points].sort((a, b) =>
      a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0,
    );
    const latest = sorted[sorted.length - 1];
    const earlier = sorted.slice(0, -1);
    if (earlier.length < minObservations) {
      skipped.thinHistory += 1;
      continue;
    }

    const average =
      earlier.reduce((sum, p) => sum + p.unitPrice, 0) / earlier.length;
    if (!(average > 0)) {
      skipped.unnormalisable += 1;
      continue;
    }
    const absoluteBelow = average - latest.unitPrice;
    const fractionBelow = absoluteBelow / average;
    if (fractionBelow < minFractionBelow) {
      skipped.notBelow += 1;
      continue;
    }

    const item: BelowAverageItem = {
      productKey,
      sourceClass,
      productName:
        latest.label ?? earlier.map((p) => p.label).find((l) => l) ?? null,
      currency: latest.currency,
      latest: {
        unitPrice: latest.unitPrice,
        observedAt: latest.observedAt,
        vendorName: latest.vendorName,
        sourceType: latest.sourceType,
      },
      average: {
        unitPrice: average,
        observations: earlier.length,
        from: earlier[0].observedAt,
        to: earlier[earlier.length - 1].observedAt,
      },
      absoluteBelow,
      fractionBelow,
    };

    // Rule 6, at the point it matters. A `quoted` comparison is news the house
    // can act on; a `public_site` comparison is a list price moving on a page
    // and gets its own line, never a seat in the same list. An unrecognised
    // class is ranked nowhere at all and counted, so it is visible.
    if (sourceClass === "quoted") items.push(item);
    else if (sourceClass === "public_site") publicSiteItems.push(item);
    else skipped.unrecognisedClass += 1;
  }

  const byFraction = (a: BelowAverageItem, b: BelowAverageItem) =>
    b.fractionBelow - a.fractionBelow;
  items.sort(byFraction);
  publicSiteItems.sort(byFraction);

  return {
    items: items.slice(0, limit),
    publicSiteItems: publicSiteItems.slice(0, limit),
    scanned: {
      observations: rows.length,
      products: productKeys.size,
      comparisons: groups.size,
    },
    byClass,
    skipped,
    averageExcludesLatest: true,
    minObservations,
    classesRanked: RANKED_CLASSES,
  };
}
