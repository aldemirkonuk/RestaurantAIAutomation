/**
 * What a caller's house role may read from the analytics lenses (ADR 0348
 * decision 3, the follow-up's second slice; ADR 0145's ROLE_POLICY is the one
 * table of who sees which class).
 *
 * Staff keep every route. A lens whose figures are of a class the caller does
 * not see answers `withheldForRole` with those classes, and its service is
 * never asked. The insight feed keeps the sentences the caller may read and
 * counts the rest, so a waiter is never shown a colleague's ranking, the
 * house's takings, its spend or a margin.
 *
 * Bottle volumes (the consumption log) are not withheld here: ADR 0348 item 3
 * names cost, margin, vendor spend, the till total and the waiter ranking,
 * and the seasonality and forecast lenses that read volumes stay open to
 * staff. Withholding volumes is a later ruling, not this slice.
 */
import {
  DATA_CLASSES,
  DataClass,
  policyFor,
} from "../ask-readings/reading-data-classes";
import {
  DataRequirement,
  INSIGHT_CANDIDATES,
  MEASURES,
} from "./insights/insight-catalog";

/** The classes a caller's role sees, re-read from the access row per request. */
export function seesFor(user?: { role?: string | null }): readonly DataClass[] {
  return policyFor(user?.role).sees;
}

/**
 * The classes each money lens is made of. A lens is answered only to a role
 * that sees every one of them.
 *
 * - menu engineering: margin (unit price less cost) times sales velocity.
 * - cashflow: what the house paid its vendors, and what it has on order.
 * - vendor scorecard: each vendor's spend, share and unit-price trend.
 * - wine 360: one good's margin and rank beside its demand.
 */
export const LENS_CLASSES = {
  menuEngineering: ["money", "sales"],
  cashflow: ["money", "suppliers"],
  vendorScorecard: ["money", "suppliers"],
  wine360: ["money", "sales"],
} as const satisfies Record<string, readonly DataClass[]>;
export type MoneyLens = keyof typeof LENS_CLASSES;

/** The classes of this lens the caller does not see; empty means answer it. */
export function lensHidden(
  lens: MoneyLens,
  sees: readonly DataClass[],
): DataClass[] {
  return LENS_CLASSES[lens].filter((c) => !sees.includes(c));
}

/** A lens as a caller who may not read it gets it: no figure, and why. */
export function withheldLens(restaurantId: string, hidden: DataClass[]) {
  return { restaurantId, withheldForRole: hidden };
}

/**
 * What an insight's data needs say about its class. `consumption`, `tables`,
 * `venue` and `goals` add none here: volumes stay open (see the header), a
 * table layout is not a figure, and a goal's own class comes from its
 * measure. The till (`checks`) is sales (ADR 0298 decision 9); the order
 * book (`orders`) is suppliers.
 */
const REQUIREMENT_CLASS: Record<DataRequirement, DataClass | null> = {
  checks: "sales",
  orders: "suppliers",
  inventory: "stock",
  consumption: null,
  tables: null,
  venue: null,
  goals: null,
};

const UNIT_OF = new Map(MEASURES.map((m) => [m.key, m.unit]));
const CANDIDATE_BY_KEY = new Map(INSIGHT_CANDIDATES.map((c) => [c.key, c]));

/**
 * The classes one insight type reads, or `null` when the key is not in the
 * catalogue (a reader then fails closed: no role short of the full row sees
 * it). A currency measure is money; a sentence about a named server is
 * people.
 */
export function insightClasses(candidateKey: string): DataClass[] | null {
  const c = CANDIDATE_BY_KEY.get(candidateKey);
  if (!c) return null;
  const out = new Set<DataClass>();
  for (const r of c.requires) {
    const cls = REQUIREMENT_CLASS[r];
    if (cls) out.add(cls);
  }
  if (UNIT_OF.get(c.measure) === "currency") out.add("money");
  if (c.dimension === "waiter") out.add("people");
  return [...out];
}

/** May a role that sees `sees` read an insight of this type? */
export function insightReadable(
  candidateKey: string,
  sees: readonly DataClass[],
): boolean {
  const classes = insightClasses(candidateKey) ?? DATA_CLASSES;
  return classes.every((c) => sees.includes(c));
}

function keyOf(row: unknown): string {
  const r = row as { candidateKey?: unknown; candidate_key?: unknown } | null;
  const k = r?.candidateKey ?? r?.candidate_key;
  return typeof k === "string" ? k : "";
}

/**
 * The feed as this role may read it: the rows it may read, and how many were
 * withheld for its role. A stored row names its type as `candidate_key`, a
 * live one as `candidateKey`; both are read.
 */
export function insightsForRole<T>(
  rows: readonly T[],
  sees: readonly DataClass[],
): { kept: T[]; withheldForRole: number } {
  const kept = rows.filter((r) => insightReadable(keyOf(r), sees));
  return { kept, withheldForRole: rows.length - kept.length };
}
