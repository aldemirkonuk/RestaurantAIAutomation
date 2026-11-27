/**
 * The insight feed as a role may read it (ADR 0348 decision 3, the same rule
 * as #1435): staff are not handed a sentence about the till, a spend, a margin
 * or a named server ("Monday sales came in 12% lower ... ($450 vs $512)").
 *
 * A sentence's classes come from its catalogue type: the till (`checks`) is
 * sales, the order book (`orders`) is suppliers, a currency measure is money,
 * a server's dimension is people. A key the catalogue does not know fails
 * closed: only a role that sees every class reads it.
 */
import {
  DATA_CLASSES,
  DataClass,
  policyFor,
} from "../../ask-readings/reading-data-classes";
import {
  DataRequirement,
  INSIGHT_CANDIDATES,
  MEASURES,
} from "./insight-catalog";

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

/** The classes the caller's role sees, re-read from the access row per request. */
export function feedSeesFor(user?: {
  role?: string | null;
}): readonly DataClass[] {
  return policyFor(user?.role).sees;
}

/** The rows this role may read, and how many were withheld for its role. */
export function insightsForRole<T>(
  rows: readonly T[],
  sees: readonly DataClass[],
): { kept: T[]; withheldForRole: number } {
  const kept = rows.filter((r) => insightReadable(keyOf(r), sees));
  return { kept, withheldForRole: rows.length - kept.length };
}
