/**
 * The catalogue — `/recommendations/catalog` as a VIEW of `/recommendations`,
 * not a separate page (the relayed 2026-09-12 ruling; DIGEST.md fork F1
 * recommendation (a): a sibling component sharing head, styles and the
 * `mudavym_design_recommendations` flag — no new flag, no new route gate).
 *
 * Reads `GET /analytics/insight-catalog/types[?restaurantId]`
 * (`analytics.controller.ts:266`) — the SAME endpoint the legacy
 * `InsightCatalog.tsx` (665 lines, kept untouched in the tree) already uses.
 * Nothing here writes anything; this is a read-only reference, per the page
 * note's explicit ask.
 *
 * The one relabelling this view makes on purpose: the legacy page and the
 * `p4-scratch/ux/recommendations-catalog.md` dossier both name the per-house
 * figure "computable now". The endpoint-reality lens on that dossier
 * (`recommendations-catalog.endpoint-lens.md` finding 3) proved the number is
 * PRESENCE-based, not sufficiency-based: `getAvailability` switches a source
 * on by `.length` truthiness, so one stray consumption row makes
 * "consumption" available the same as ten thousand rows would. Calling that
 * "computable" claims a certainty the number does not carry. This view says
 * "data present" instead, and states what that means in the head — see
 * `PRESENCE_CAVEAT` below.
 */

export type DataRequirement =
  | 'consumption'
  | 'orders'
  | 'inventory'
  | 'checks'
  | 'tables'
  | 'venue'
  | 'goals';

export const REQUIREMENT_LABEL: Record<DataRequirement, string> = {
  consumption: 'the wine consumption log',
  orders: 'purchase orders',
  inventory: 'inventory counts',
  checks: 'POS checks',
  tables: 'the table register',
  venue: 'the venue profile',
  goals: 'goals',
};

export interface CatalogDimension {
  key: string;
  label: string;
  entityScoped: boolean;
  requires: DataRequirement[];
}

export interface CatalogMeasure {
  key: string;
  label: string;
  unit: 'currency' | 'count' | 'percent' | 'ratio' | 'units';
  requires: DataRequirement[];
}

export interface CatalogComparator {
  key: string;
  label: string;
  template: string;
  requires?: DataRequirement[];
}

export interface CatalogCandidate {
  key: string;
  dimension: string;
  measure: string;
  comparator: string;
  category: string;
  template: string;
  requires: DataRequirement[];
  implemented: boolean;
}

export interface CatalogCoverage {
  catalogued: number;
  implemented: number;
  computable: number | null;
  blockedOnData: number | null;
  notBuilt: number;
}

export interface CatalogPayload {
  total: number;
  byCategory: Record<string, number>;
  dimensions: CatalogDimension[];
  measures: CatalogMeasure[];
  comparators: CatalogComparator[];
  candidates: CatalogCandidate[];
  available: DataRequirement[] | null;
  coverage: CatalogCoverage;
}

export const PRESENCE_CAVEAT =
  '“Data present” means this house has at least one stored row of the required kind — not that today’s reading is deep enough to trust. One row satisfies it the same as a full history; this number is presence, not sufficiency.';

export type Readiness = 'computable' | 'blocked' | 'not_built' | 'unknown';

/**
 * A type's readiness in THIS house. `unknown` only when the server omitted
 * `implemented` or `available` is null (signed out, or the availability probe
 * failed) — never collapsed into `blocked`, which would claim a certainty the
 * payload does not carry (fixes the legacy page's trap 7: an unknown type
 * rendered no chip at all).
 */
export function readinessOf(
  candidate: CatalogCandidate,
  available: DataRequirement[] | null,
): Readiness {
  if (typeof candidate.implemented !== 'boolean') return 'unknown';
  if (!candidate.implemented) return 'not_built';
  if (available === null) return 'unknown';
  const have = new Set(available);
  return candidate.requires.every((r) => have.has(r)) ? 'computable' : 'blocked';
}

export const READINESS_LABEL: Record<Readiness, string> = {
  computable: 'Data present',
  blocked: 'Built, missing data',
  not_built: 'Not built',
  unknown: 'Unknown',
};

/** What this type still needs, in words — empty when nothing is missing. */
export function missingRequirements(
  candidate: CatalogCandidate,
  available: DataRequirement[] | null,
): DataRequirement[] {
  if (available === null) return candidate.requires;
  const have = new Set(available);
  return candidate.requires.filter((r) => !have.has(r));
}

/** How many candidates fall under each dimension — for the rail's counts. */
export function countsByDimension(candidates: CatalogCandidate[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of candidates) m.set(c.dimension, (m.get(c.dimension) ?? 0) + 1);
  return m;
}

/**
 * A plain-text search across a candidate's own words — its key and the
 * dimension/measure/comparator labels that made it, never a hidden score.
 * Case-insensitive substring match, same as the legacy page.
 */
export function matchesQuery(
  candidate: CatalogCandidate,
  dims: Map<string, CatalogDimension>,
  measures: Map<string, CatalogMeasure>,
  comparators: Map<string, CatalogComparator>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    candidate.key,
    candidate.category,
    dims.get(candidate.dimension)?.label ?? '',
    measures.get(candidate.measure)?.label ?? '',
    comparators.get(candidate.comparator)?.label ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

/** The head's five-figure sentence, em-dashed wherever the server said null. */
export function headSentence(c: CatalogCoverage, em: string): string {
  const computable = c.computable === null ? em : String(c.computable);
  const blocked = c.blockedOnData === null ? em : String(c.blockedOnData);
  return `${c.catalogued} catalogued · ${c.implemented} built · ${computable} with data present · ${blocked} built but missing data · ${c.notBuilt} not built yet.`;
}
