/**
 * Vendor price consensus across heterogeneous sources.
 *
 * The problem this solves is not "average some prices". It is that a scraped
 * web page, a rep's WhatsApp message, a vendor API feed and a paid invoice are
 * all claims about the same bottle, made with wildly different reliability, at
 * different times, in different pack sizes — and a naive mean over them is
 * worse than useless because it is confidently wrong.
 *
 * Four decisions carry the design.
 *
 * 1. Median, not mean. This is the single most important choice. Scraped
 *    prices carry parse failures — a decimal lost, a case price read as a
 *    bottle price, a "$1,200" that is really $12.00. One such row moves a mean
 *    enough to recommend the wrong vendor; it moves a median not at all.
 *    weightedMedian() is the default estimator and trimmedMean() exists for
 *    when a caller explicitly wants the smoother statistic.
 *
 * 2. Outliers are detected with MAD, not standard deviation. Standard
 *    deviation is computed FROM the data it is meant to police, so a single
 *    wild value inflates σ enough to make itself look acceptable — the
 *    masking problem. Median absolute deviation has a 50% breakdown point:
 *    half the observations must be corrupt before it fails.
 *
 * 3. Trust and recency multiply into one weight. A tier-1 invoice from
 *    yesterday and a tier-6 social post from last quarter should not have
 *    comparable influence, and neither should be silently discarded. Weight
 *    decays exponentially with age at a half-life that reflects how fast the
 *    source goes stale.
 *
 * 4. Nothing is normalised implicitly. Every price becomes price-per-unit
 *    through an explicit, recorded transformation, or it is excluded. A
 *    comparison that silently mixes case and bottle prices is the failure mode
 *    that makes a somm stop trusting the tool.
 */

// median and medianAbsoluteDeviation already live in ./statistics and are
// imported rather than reimplemented — tsc caught the duplicate export, which
// is exactly the check that should catch it.
import { median, medianAbsoluteDeviation } from "./statistics";

export type PriceSourceType =
  | "invoice"
  | "quote"
  | "api_catalog"
  | "website_scrape"
  | "chat"
  | "social"
  | "manual";

/** Lower is more trustworthy. Mirrors vendor_price_observations.trust_tier. */
export const TRUST_TIER: Record<PriceSourceType, number> = {
  invoice: 1,
  quote: 2,
  api_catalog: 3,
  website_scrape: 4,
  chat: 5,
  social: 6,
  manual: 7,
};

/**
 * How fast each source loses relevance, in days.
 *
 * These differ because the underlying things differ: a signed invoice is
 * evidence of a real transaction and stays meaningful for a long time; a
 * social promotion is often a weekend offer and is close to worthless a month
 * later.
 */
export const SOURCE_HALF_LIFE_DAYS: Record<PriceSourceType, number> = {
  invoice: 180,
  quote: 90,
  api_catalog: 45,
  website_scrape: 30,
  chat: 30,
  social: 14,
  manual: 90,
};

export interface PriceObservation {
  price: number;
  sourceType: PriceSourceType;
  observedAt: Date | string;
  /** Units per pack as sold (12 for a case). */
  packSize?: number;
  /** ml per unit; used to normalise to a 750ml equivalent. */
  unitVolumeMl?: number;
  /** Usable fraction after trim/waste. 1 for wine. */
  yieldFactor?: number;
  /** 0–1 confidence in the parse itself, distinct from source trust. */
  parseConfidence?: number;
  vendorId?: string | null;
  vendorName?: string | null;
  currency?: string;
}

export interface NormalizedObservation extends PriceObservation {
  /** Price per 750ml-equivalent usable unit. */
  unitPrice: number;
  ageDays: number;
  weight: number;
  note: string;
}

/** The reference bottle. Everything is expressed per this volume. */
export const REFERENCE_VOLUME_ML = 750;

/**
 * Reduce a quoted price to price-per-reference-unit.
 *
 * Returns null rather than guessing when the inputs cannot support the
 * conversion — an unconvertible observation must leave the comparison, not
 * enter it with a fabricated number.
 */
export function normalizeUnitPrice(
  obs: PriceObservation,
  referenceVolumeMl = REFERENCE_VOLUME_ML,
): { unitPrice: number | null; note: string } {
  const pack = obs.packSize ?? 1;
  const yieldFactor = obs.yieldFactor ?? 1;

  if (!(obs.price >= 0))
    return { unitPrice: null, note: "Price is not a number." };
  if (!(pack > 0))
    return { unitPrice: null, note: "Pack size must be positive." };
  if (!(yieldFactor > 0) || yieldFactor > 1)
    return { unitPrice: null, note: "Yield factor must be in (0, 1]." };

  const perUnit = obs.price / pack;
  const parts: string[] = [];
  if (pack !== 1) parts.push(`÷ ${pack} per pack`);

  let volumeAdjusted = perUnit;
  if (obs.unitVolumeMl && obs.unitVolumeMl > 0) {
    volumeAdjusted = perUnit * (referenceVolumeMl / obs.unitVolumeMl);
    if (obs.unitVolumeMl !== referenceVolumeMl) {
      parts.push(`scaled ${obs.unitVolumeMl}ml → ${referenceVolumeMl}ml`);
    }
  }

  const usable = volumeAdjusted / yieldFactor;
  if (yieldFactor !== 1) parts.push(`÷ ${yieldFactor} yield`);

  return {
    unitPrice: usable,
    note: parts.length ? parts.join(", ") : "Already per reference unit.",
  };
}

function ageInDays(observedAt: Date | string, now: Date): number {
  const t = new Date(observedAt).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - t) / 86_400_000);
}

/**
 * Weight = trust × recency × parse confidence.
 *
 * Trust is 1/tier so tier 1 counts seven times a tier 7. Recency is
 * exponential decay at the source's half-life. All three multiply because any
 * one of them being near zero should sink the observation — a perfectly
 * trusted source badly parsed is still a bad number.
 */
export function observationWeight(
  obs: PriceObservation,
  now: Date = new Date(),
): { weight: number; ageDays: number } {
  const tier = TRUST_TIER[obs.sourceType] ?? 7;
  const halfLife = SOURCE_HALF_LIFE_DAYS[obs.sourceType] ?? 30;
  const ageDays = ageInDays(obs.observedAt, now);

  if (!Number.isFinite(ageDays)) return { weight: 0, ageDays: Infinity };

  const trustWeight = 1 / tier;
  const recencyWeight = Math.pow(0.5, ageDays / halfLife);
  const parseWeight = obs.parseConfidence ?? 1;

  return { weight: trustWeight * recencyWeight * parseWeight, ageDays };
}

/**
 * Flag observations more than `threshold` robust deviations from the median.
 *
 * When MAD is 0 — which happens whenever more than half the observations are
 * identical, common with repeated scrapes of an unchanged page — deviation is
 * undefined, so anything not equal to the median is the outlier.
 */
export function flagOutliers(values: number[], threshold = 3.5): boolean[] {
  const m = median(values);
  if (m === null) return values.map(() => false);
  const mad = medianAbsoluteDeviation(values);

  if (mad === null || mad === 0) {
    return values.map((v) => v !== m);
  }
  return values.map((v) => Math.abs(v - m) / mad > threshold);
}

/** Weighted median: the value where cumulative weight crosses half the total. */
export function weightedMedian(
  values: number[],
  weights: number[],
): number | null {
  if (!values.length || values.length !== weights.length) return null;
  const pairs = values
    .map((v, i) => ({ v, w: weights[i] }))
    .filter((p) => p.w > 0)
    .sort((a, b) => a.v - b.v);
  if (!pairs.length) return null;

  const total = pairs.reduce((a, p) => a + p.w, 0);
  let cum = 0;
  for (const p of pairs) {
    cum += p.w;
    if (cum >= total / 2) return p.v;
  }
  return pairs[pairs.length - 1].v;
}

/** Mean after discarding the top and bottom `fraction` of values. */
export function trimmedMean(xs: number[], fraction = 0.1): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const drop = Math.floor(s.length * fraction);
  const kept =
    drop > 0 && s.length - 2 * drop > 0 ? s.slice(drop, s.length - drop) : s;
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

export interface VendorQuote {
  vendorId: string | null;
  vendorName: string | null;
  unitPrice: number;
  sourceType: PriceSourceType;
  ageDays: number;
  isOutlier: boolean;
}

export interface ConsensusResult {
  /** Weighted median of admitted observations — the headline number. */
  consensusPrice: number | null;
  /** Cheapest admitted observation. */
  bestPrice: number | null;
  bestVendorId: string | null;
  bestVendorName: string | null;
  observationCount: number;
  admittedCount: number;
  outlierCount: number;
  /** Distinct sources contributing, for the "depicted" source badges. */
  sourceBreakdown: Record<string, number>;
  /** Every admitted quote, ascending — the least-to-most ranking. */
  ladder: VendorQuote[];
  /** 0–1, from weight mass and source diversity. */
  confidence: number;
  notes: string[];
}

/**
 * Build the vendor ladder and a consensus price for one product.
 *
 * Observations that cannot be normalised are excluded and counted, never
 * coerced. Outliers stay in the result (flagged) rather than vanishing,
 * because a rejected $1,200 row is something a human should be able to see and
 * correct at the source.
 */
export function vendorPriceConsensus(
  observations: PriceObservation[],
  opts: { now?: Date; outlierThreshold?: number } = {},
): ConsensusResult {
  const now = opts.now ?? new Date();
  const notes: string[] = [];

  const normalized: NormalizedObservation[] = [];
  let unnormalizable = 0;

  for (const obs of observations) {
    const { unitPrice, note } = normalizeUnitPrice(obs);
    if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      unnormalizable += 1;
      continue;
    }
    const { weight, ageDays } = observationWeight(obs, now);
    normalized.push({ ...obs, unitPrice, ageDays, weight, note });
  }

  if (unnormalizable > 0) {
    notes.push(
      `${unnormalizable} observation(s) excluded: pack size, volume or yield could not support a per-unit price. They are not averaged in with a guessed value.`,
    );
  }

  if (!normalized.length) {
    return {
      consensusPrice: null,
      bestPrice: null,
      bestVendorId: null,
      bestVendorName: null,
      observationCount: observations.length,
      admittedCount: 0,
      outlierCount: 0,
      sourceBreakdown: {},
      ladder: [],
      confidence: 0,
      notes: [...notes, "No usable price observations for this product."],
    };
  }

  const outlierFlags = flagOutliers(
    normalized.map((n) => n.unitPrice),
    opts.outlierThreshold,
  );

  const ladder: VendorQuote[] = normalized
    .map((n, i) => ({
      vendorId: n.vendorId ?? null,
      vendorName: n.vendorName ?? null,
      unitPrice: n.unitPrice,
      sourceType: n.sourceType,
      ageDays: n.ageDays,
      isOutlier: outlierFlags[i],
    }))
    .sort((a, b) => a.unitPrice - b.unitPrice);

  const admitted = normalized.filter((_, i) => !outlierFlags[i]);
  const outlierCount = outlierFlags.filter(Boolean).length;

  if (outlierCount > 0) {
    notes.push(
      `${outlierCount} observation(s) flagged as outliers by median-absolute-deviation and excluded from the consensus. They remain in the ladder so a bad parse is visible and fixable at source.`,
    );
  }

  const consensusPrice = weightedMedian(
    admitted.map((n) => n.unitPrice),
    admitted.map((n) => n.weight),
  );

  const cheapest = ladder.find((q) => !q.isOutlier) ?? null;

  const sourceBreakdown: Record<string, number> = {};
  for (const n of normalized) {
    sourceBreakdown[n.sourceType] = (sourceBreakdown[n.sourceType] ?? 0) + 1;
  }

  // Confidence blends how much weight mass survived with how many distinct
  // source types agree. Five scrapes of one site is weaker evidence than a
  // scrape plus an invoice, even though it is more rows.
  const weightMass = admitted.reduce((a, n) => a + n.weight, 0);
  const distinctSources = new Set(admitted.map((n) => n.sourceType)).size;
  const massTerm = Math.min(1, weightMass / 2);
  const diversityTerm = Math.min(1, distinctSources / 3);
  const confidence = admitted.length
    ? Math.max(0.05, Math.min(0.95, 0.6 * massTerm + 0.4 * diversityTerm))
    : 0;

  if (distinctSources === 1 && admitted.length > 1) {
    notes.push(
      `All ${admitted.length} admitted observations come from a single source type (${[...new Set(admitted.map((n) => n.sourceType))][0]}); agreement between them is not independent corroboration.`,
    );
  }

  return {
    consensusPrice,
    bestPrice: cheapest ? cheapest.unitPrice : null,
    bestVendorId: cheapest ? cheapest.vendorId : null,
    bestVendorName: cheapest ? cheapest.vendorName : null,
    observationCount: observations.length,
    admittedCount: admitted.length,
    outlierCount,
    sourceBreakdown,
    ladder,
    confidence,
    notes,
  };
}

export interface PriceTrend {
  windowDays: number;
  current: number | null;
  previous: number | null;
  absoluteChange: number | null;
  pctChange: number | null;
  note: string;
}

/**
 * Change over a trailing window, comparing the consensus of the most recent
 * `windowDays` against the consensus of the window before it.
 *
 * Compares like with like — both sides are consensus prices computed the same
 * way — rather than comparing today's cheapest against last month's average,
 * which would report vendor churn as price movement.
 */
export function priceTrend(
  observations: PriceObservation[],
  windowDays: number,
  now: Date = new Date(),
): PriceTrend {
  const msPerDay = 86_400_000;
  const windowStart = new Date(now.getTime() - windowDays * msPerDay);
  const priorStart = new Date(now.getTime() - 2 * windowDays * msPerDay);

  const inWindow = (o: PriceObservation, from: Date, to: Date) => {
    const t = new Date(o.observedAt).getTime();
    return Number.isFinite(t) && t >= from.getTime() && t < to.getTime();
  };

  const currentObs = observations.filter((o) => inWindow(o, windowStart, now));
  const priorObs = observations.filter((o) =>
    inWindow(o, priorStart, windowStart),
  );

  const current = vendorPriceConsensus(currentObs, { now }).consensusPrice;
  const previous = vendorPriceConsensus(priorObs, {
    now: windowStart,
  }).consensusPrice;

  if (current === null || previous === null) {
    return {
      windowDays,
      current,
      previous,
      absoluteChange: null,
      pctChange: null,
      note:
        current === null
          ? `No observations in the last ${windowDays} days.`
          : `No comparable observations in the preceding ${windowDays} days, so change cannot be computed.`,
    };
  }

  const absoluteChange = current - previous;
  const pctChange = previous === 0 ? null : absoluteChange / previous;

  return {
    windowDays,
    current,
    previous,
    absoluteChange,
    pctChange,
    note:
      pctChange === null
        ? "Previous consensus was zero; percentage change is undefined."
        : `${pctChange >= 0 ? "Up" : "Down"} ${(Math.abs(pctChange) * 100).toFixed(1)}% over ${windowDays} days.`,
  };
}

/** The 7/30/90-day set the vendor page shows. */
export function standardTrends(
  observations: PriceObservation[],
  now: Date = new Date(),
): PriceTrend[] {
  return [7, 30, 90].map((d) => priceTrend(observations, d, now));
}
