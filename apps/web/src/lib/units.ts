/**
 * The intake unit vocabulary, client side.
 *
 * WHY THIS IS A COPY, AND WHY THE COPY IS SAFE
 *
 * `apps/web` cannot import from `apps/api-gateway` — separate builds, separate
 * tsconfigs, no shared package for this yet. The gateway's list lives in
 * `apps/api-gateway/src/procurement/documents/document-types.ts` (`UOMS`) and
 * that one is authoritative: it is the half the database CHECK constraint is
 * written against.
 *
 * A hand-kept copy is exactly how two vocabularies drift apart, which is the
 * defect ADR 0071 exists to repair — so this copy is not kept by hand. It is
 * checked by `scripts/check_intake_units.py`, which parses both files plus the
 * migration and FAILS THE BUILD when the three disagree. Adding a unit in one
 * place and not the others is a red CI run, not a silent divergence discovered
 * by a receiver holding a sack of flour.
 *
 * If you are here to add a unit: add it to `document-types.ts`, to the CHECK in
 * a new migration, and here. The guard will tell you if you missed one.
 */

/** Units that COUNT discrete things. A fraction of one is a data-entry error. */
export const COUNT_UOMS = [
  'bottle',
  'case',
  'keg',
  'pack',
  'split_case',
  'each',
] as const

/** Units that MEASURE. A fraction of one is an ordinary quantity. */
export const MEASURED_UOMS = ['ml', 'liter', 'g', 'kg'] as const

export const UOMS = [...COUNT_UOMS, ...MEASURED_UOMS] as const
export type Uom = (typeof UOMS)[number]

/**
 * Decimal places an intake quantity may carry, matching `numeric(12,3)`.
 *
 * Used as the `step` on quantity inputs. It is not cosmetic: without a `step`
 * the browser defaults to 1 and reports a stepMismatch on 2.5, so the value
 * never leaves the page — a refusal that happens below every validator and
 * shows the operator a generic browser tooltip instead of a reason.
 */
export const INTAKE_STEP = 0.001

/**
 * True when a fractional quantity is legitimate in this unit.
 *
 * Unknown or absent input answers `false`, which is the conservative direction:
 * it keeps the stricter whole-number rule until a unit is actually chosen,
 * rather than opening the field up on a typo. The server refuses an
 * unrecognised unit outright, so this is only about what the form allows before
 * the request is made.
 */
export function isMeasuredUnit(uom: string | null | undefined): boolean {
  if (!uom) return false
  return (MEASURED_UOMS as readonly string[]).includes(uom.trim().toLowerCase())
}
