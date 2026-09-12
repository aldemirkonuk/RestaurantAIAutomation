/**
 * The ladder and the book — pure shaping of what the gateway returned.
 *
 * Nothing here ranks or normalises: the engine did that
 * (`analytics/engine/vendor-price-consensus.ts`) and its verdicts are taken as
 * given. This module joins each rung to the register row behind it, cuts the
 * legend to the sources actually present, notices when a ladder mixes
 * currencies (nothing converts), and groups a vendor's book by product.
 */

import { isSourceType, money, num, SOURCE_META, sourceLabel, type SourceType } from './vp-format';
import type { RegisterObservation } from './vp-provenance';

export interface Rung {
  id: string | null;
  vendorId: string | null;
  vendorName: string | null;
  unitPrice: number;
  sourceType: string;
  ageDays: number;
  isOutlier: boolean;
}

export interface Trend {
  windowDays: number;
  current: number | null;
  previous: number | null;
  absoluteChange: number | null;
  pctChange: number | null;
  note: string;
}

export interface CompareResult {
  productName: string | null;
  consensus: {
    consensusPrice: number | null;
    bestPrice: number | null;
    bestVendorId: string | null;
    bestVendorName: string | null;
    observationCount: number;
    admittedCount: number;
    outlierCount: number;
    sourceBreakdown: Record<string, number>;
    ladder: Rung[];
    confidence: number;
    notes: string[];
  };
  trends: Trend[];
  observations: RegisterObservation[];
}

export interface LadderRow {
  rung: Rung;
  /** The register row behind the rung, or null when the gateway named none. */
  observation: RegisterObservation | null;
  /** The currency the rung's figure is in — the row's, or unknown. */
  currency: string | null;
  /** The engine's read-time verdict and the stored write-time one disagree. */
  verdictsDisagree: boolean;
}

/** Join every rung to its row. A rung with no row still draws, unlinked. */
export function ladderRows(result: CompareResult): LadderRow[] {
  const byId = new Map<string, RegisterObservation>();
  for (const o of result.observations) byId.set(o.id, o);
  return result.consensus.ladder.map((rung) => {
    const observation = rung.id ? (byId.get(rung.id) ?? null) : null;
    return {
      rung,
      observation,
      currency: observation?.currency ?? null,
      verdictsDisagree: observation !== null && observation.isOutlier !== rung.isOutlier,
    };
  });
}

/**
 * The currencies the ladder mixes. One means every rung is comparable; more
 * means the ranking across them is not a ranking, and the page says so.
 */
export function currenciesOf(rows: LadderRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) set.add(r.currency ?? 'unknown');
  return [...set].sort();
}

export interface LegendEntry {
  type: SourceType | string;
  label: string;
  tier: number | null;
  count: number;
  sentence: string;
}

/**
 * The legend, cut to the sources that OCCUR in this ladder (page note §13.4).
 * A source with zero rows is not listed: showing six channels where one can
 * appear tells the reader the system is watching six channels.
 */
export function legendFor(sourceBreakdown: Record<string, number>): LegendEntry[] {
  return Object.entries(sourceBreakdown)
    .filter(([, n]) => (num(n) ?? 0) > 0)
    .map(([type, n]) => ({
      type,
      label: sourceLabel(type),
      tier: isSourceType(type) ? SOURCE_META[type].tier : null,
      count: num(n) ?? 0,
      sentence: isSourceType(type)
        ? SOURCE_META[type].sentence
        : 'A source this page has no words for. Listed, not hidden.',
    }))
    .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99));
}

/**
 * "Before you order": the newest admitted sighting against the consensus, in
 * words, with the rule that produced it. Null when either side is missing —
 * never a sentence built on a guessed number.
 */
export function beforeYouOrder(result: CompareResult, rows: LadderRow[]): string | null {
  const consensus = num(result.consensus.consensusPrice);
  if (consensus === null || consensus <= 0) return null;
  const admitted = rows.filter((r) => !r.rung.isOutlier && r.observation);
  if (admitted.length === 0) return null;
  const newest = admitted.reduce((a, b) =>
    new Date(b.observation!.observedAt).getTime() > new Date(a.observation!.observedAt).getTime() ? b : a,
  );
  const currencies = currenciesOf(admitted);
  if (currencies.length !== 1) return null;
  const diff = (newest.rung.unitPrice - consensus) / consensus;
  const pct = `${Math.abs(diff * 100).toFixed(1)}%`;
  const vendor = newest.rung.vendorName ?? 'an unnamed vendor';
  const price = money(newest.rung.unitPrice, newest.currency);
  if (Math.abs(diff) < 0.005) {
    return `The newest admitted sighting, ${price} per 750 ml from ${vendor}, sits at the consensus of ${money(consensus, newest.currency)}.`;
  }
  return diff < 0
    ? `The newest admitted sighting, ${price} per 750 ml from ${vendor}, is ${pct} below the consensus of ${money(consensus, newest.currency)} across ${result.consensus.admittedCount} admitted sightings.`
    : `The newest admitted sighting, ${price} per 750 ml from ${vendor}, is ${pct} above the consensus of ${money(consensus, newest.currency)} across ${result.consensus.admittedCount} admitted sightings.`;
}

/* ── the vendor's book ────────────────────────────────────────────────────── */

export interface BookGroup {
  key: string;
  productName: string;
  masterWineId: string | null;
  /** Newest first, as the gateway ordered them. */
  items: RegisterObservation[];
}

/** Group a vendor's rows by the product they name, keeping the gateway's order. */
export function groupBook(items: RegisterObservation[]): BookGroup[] {
  const groups = new Map<string, BookGroup>();
  for (const o of items) {
    const key = o.masterWineId ?? `name:${(o.productName ?? '').trim().toLowerCase() || o.id}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, productName: o.productName ?? 'Product not named on the row', masterWineId: o.masterWineId, items: [] };
      groups.set(key, g);
    }
    g.items.push(o);
  }
  return [...groups.values()];
}
