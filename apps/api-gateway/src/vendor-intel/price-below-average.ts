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

export interface BelowAverageItem {
  /** `wine:<uuid>` or `sig:<hash>` — how the sightings were grouped. */
  productKey: string;
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
}

export interface BelowAverageResult {
  items: BelowAverageItem[];
  /** What the window actually contained, so an empty answer can be read. */
  scanned: { observations: number; products: number };
  skipped: BelowAverageSkips;
  averageExcludesLatest: true;
  minObservations: number;
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
  };

  interface Point {
    unitPrice: number;
    observedAt: string;
    currency: string;
    vendorName: string | null;
    sourceType: string;
    label: string | null;
  }
  const groups = new Map<string, Point[]>();

  for (const row of rows) {
    const key = row.master_wine_id
      ? `wine:${row.master_wine_id}`
      : row.signature_hash
        ? `sig:${row.signature_hash}`
        : null;
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

    const bucket = groups.get(key) ?? [];
    bucket.push({
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

  for (const [productKey, points] of groups) {
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

    items.push({
      productKey,
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
    });
  }

  items.sort((a, b) => b.fractionBelow - a.fractionBelow);

  return {
    items: items.slice(0, limit),
    scanned: { observations: rows.length, products: groups.size },
    skipped,
    averageExcludesLatest: true,
    minObservations,
  };
}
