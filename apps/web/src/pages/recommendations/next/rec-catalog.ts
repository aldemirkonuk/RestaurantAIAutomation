/**
 * The catalogue — `/recommendations/catalog` as a VIEW of `/recommendations`,
 * not a separate page (the relayed 2026-09-12 ruling; DIGEST.md fork F1
 * recommendation (a): a sibling component sharing head, styles and the
 * `mudavym_design_recommendations` flag — no new flag, no new route gate).
 *
 * **ACTIONABLE as of ADR 0191 (founder, 2026-09-21) — no longer read-only.**
 * Each type can be turned on or off for the house (owner/manager, audited)
 * and opened to its live recommendations with the feed's own one-tap acts.
 * This closes the standing fork `.planning/06-pages/recommendations.md:
 * 829-831` ("The catalogue's read-only-ness is a standing open fork") left
 * open. `typeRuleKey`/`offTypeKeys`/`isTypeEnabled`/`normalizeLiveInsight`/
 * `liveInsightsForType` below carry the read-side wiring; the writes reuse the
 * SAME `recommendation_actions` store NEW-434 already writes to
 * (`insight:<candidate_key>`, rule scope) — no new table, no migration.
 *
 * Reads `GET /analytics/insight-catalog/types[?restaurantId]`
 * (`analytics.controller.ts:266`) — the SAME endpoint the legacy
 * `InsightCatalog.tsx` (665 lines, kept untouched in the tree) already uses.
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

// ---------------------------------------------------------------------------
// On/off — ADR 0191. The bare `insight:<candidateKey>` key, written at rule
// scope, is what `apps/api-gateway/src/analytics/insights/suppression.ts`'s
// `insightRuleId()` + rule-scope `buildSuppressionKey()` compute server-side;
// this is the SAME string, kept as one literal so the two sides cannot drift.
// ---------------------------------------------------------------------------

/** The `recommendation_actions.rule_key` a whole-type toggle reads/writes. */
export function typeRuleKey(candidateKey: string): string {
  return `insight:${candidateKey}`;
}

export interface DispositionRow {
  ruleKey: string;
  status: string;
}

/**
 * The set of types currently OFF for this house — rows whose `ruleKey` is
 * exactly a bare `insight:<candidateKey>` (no `#subject#grain` suffix, so an
 * individual instance dismissed from the feed or a contextual rail never
 * reads as the whole type being off) and whose status is `dismissed`.
 */
export function offTypeKeys(rows: DispositionRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) {
    if (
      r.status === "dismissed" &&
      typeof r.ruleKey === "string" &&
      r.ruleKey.startsWith("insight:") &&
      !r.ruleKey.includes("#")
    )
      s.add(r.ruleKey);
  }
  return s;
}

/** Whether `candidateKey` is on for this house. `null` = not yet known. */
export function isTypeEnabled(
  candidateKey: string,
  off: Set<string> | null,
): boolean | null {
  if (off === null) return null;
  return !off.has(typeRuleKey(candidateKey));
}

// ---------------------------------------------------------------------------
// Live items — "opened to its live recommendations" (ADR 0191).
// ---------------------------------------------------------------------------

export interface LiveInsight {
  candidateKey: string;
  category: string;
  sentence: string;
  score: number;
  entityKey: string | null;
  entityLabel: string | null;
  /**
   * The exact key an instance-scope act writes — computed server-side by
   * `insight-generator.service.ts`'s `record()` (and, since ADR 0191 round 2,
   * by `readStored()` for a stored row too). A row without one is dropped
   * rather than shown with a dead act.
   */
  suppressionKey: string;
}

/** One `GET /analytics/insights/:id?refresh=true` row, or null if unusable. */
export function normalizeLiveInsight(raw: unknown): LiveInsight | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidateKey = typeof r.candidateKey === "string" ? r.candidateKey : "";
  const sentence = typeof r.sentence === "string" ? r.sentence : "";
  const suppression = r.suppression as { key?: unknown } | undefined;
  const suppressionKey =
    suppression && typeof suppression.key === "string" ? suppression.key : "";
  if (!candidateKey || !sentence || !suppressionKey) return null;
  return {
    candidateKey,
    category: typeof r.category === "string" ? r.category : "",
    sentence,
    score: Number(r.score ?? 0),
    entityKey: typeof r.entityKey === "string" ? r.entityKey : null,
    entityLabel: typeof r.entityLabel === "string" ? r.entityLabel : null,
    suppressionKey,
  };
}

/** Every live row belonging to one catalogue type, highest score first. */
export function liveInsightsForType(
  rows: unknown[],
  candidateKey: string,
): LiveInsight[] {
  return rows
    .map(normalizeLiveInsight)
    .filter((i): i is LiveInsight => i !== null && i.candidateKey === candidateKey)
    .sort((a, b) => b.score - a.score);
}
