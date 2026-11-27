/**
 * What a caller's house role may read from the analytics lenses (ADR 0348
 * decision 3, the follow-up's second slice; ADR 0145's ROLE_POLICY is the one
 * table of who sees which class).
 *
 * Staff keep every route. A lens whose figures are of a class the caller does
 * not see answers `withheldForRole` with those classes, and its service is
 * never asked, so a waiter is never shown a margin or the house's spend.
 *
 * Bottle volumes (seasonality, forecast) are not withheld: ADR 0348 item 3
 * names cost, margin, vendor spend, the till total and the waiter ranking.
 */
import { DataClass, policyFor } from "../ask-readings/reading-data-classes";

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
