/**
 * document-types — the vocabulary of the procurement document spine.
 *
 * Every list here mirrors a CHECK constraint in
 * supabase/migrations/20260727120000_procurement_document_spine.sql. They are
 * kept in one file, and exported as const so a typo is a compile error rather
 * than a runtime insert failure: a varchar+CHECK column whose allowed values
 * drift from the code fails at write time, in production, silently from the
 * caller's point of view.
 */

/**
 * The documents in a delivery, in the order they exist in the real world.
 *
 *   purchase_order    what we asked for            (EDI 850)
 *   packing_slip      what the distributor shipped (EDI 856 / ASN)
 *   delivery_receipt  what a human signed for at the door
 *   invoice           what we are billed           (EDI 810)
 *   credit_memo       what they agreed to give back(EDI 812)
 *   statement         a period roll-up used to tie out
 */
export const DOC_TYPES = [
  "purchase_order",
  "packing_slip",
  "delivery_receipt",
  "invoice",
  "credit_memo",
  "statement",
  "unknown",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** How a document reached us. Downstream code must never branch on this. */
export const SOURCE_CHANNELS = [
  "email",
  "photo",
  "upload",
  "edi",
  "sftp",
  "manual",
  "api",
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

export const DOC_STATUSES = [
  "received",
  "extracting",
  "needs_review",
  "verified",
  "rejected",
  "superseded",
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const UOMS = [
  "bottle",
  "case",
  "keg",
  "pack",
  "split_case",
  "each",
  "liter",
] as const;
export type Uom = (typeof UOMS)[number];

export const MATCH_METHODS = [
  "vendor_sku",
  "description",
  "qty_price",
  "manual",
  "edi_reference",
] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

export const LINK_METHODS = [
  "manual",
  "doc_reference",
  "po_number",
  "provider_date",
  "line_overlap",
  "edi_reference",
] as const;
export type LinkMethod = (typeof LINK_METHODS)[number];

export const RECEIPT_STAGES = [
  "signed_at_door",
  "case_count",
  "bottle_count",
  "reconciled",
] as const;
export type ReceiptStage = (typeof RECEIPT_STAGES)[number];

/**
 * Coerce a free-text unit into the canonical vocabulary.
 *
 * Originally necessary because the schema was not self-consistent:
 * `procurement_order_items.unit_type` had NO check constraint and defaulted to
 * the PLURAL `'bottles'`, `procurement_orders.unit_type` had none either, and
 * only `procurement_document_lines.uom` was CHECK-constrained to singulars.
 * `20260901150000_order_line_capture_and_units.sql` closed that: all four unit
 * columns now share one CHECK over the same seven singulars, and this function
 * is what every writer funnels through to produce them.
 *
 * It is still necessary, because the inputs are not ours. Extracted and EDI
 * documents add their own spellings (`BT`, `CS`, `EA` are the common X12 codes),
 * and every quantity comparison funnels through here so one stray plural cannot
 * silently become an unrecognised unit and skip bottle normalisation — which
 * would resurface the split-case false alarm the whole mechanism exists to
 * prevent.
 *
 * Unrecognised input returns null rather than guessing `bottle`: a wrong unit
 * produces confident, wrong quantity maths, and silence is worse than a refusal.
 */
export function normalizeUom(raw?: string | null): Uom | null {
  if (!raw) return null;
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  switch (s) {
    case "bottle":
    case "bottles":
    case "btl":
    case "bt":
      return "bottle";
    case "case":
    case "cases":
    case "cs":
    case "ca":
      return "case";
    case "keg":
    case "kegs":
      return "keg";
    case "pack":
    case "packs":
    case "pk":
      return "pack";
    case "splitcase":
    case "splitcases":
    case "split":
      return "split_case";
    case "each":
    case "ea":
    case "unit":
    case "units":
      return "each";
    case "liter":
    case "liters":
    case "litre":
    case "litres":
    case "l":
    case "lt":
      return "liter";
    default:
      return null;
  }
}

/**
 * Bottle-equivalent for a quantity expressed in some other unit.
 *
 * This exists because the single most common beverage receiving discrepancy is
 * not a real discrepancy: order 2 cases, the vendor invoices 24 bottles, the
 * receiver counts 2 cases. Comparing the bare numbers reports an overage of 22
 * and fires a critical alert. Every quantity comparison in the match runs on
 * bottle-equivalents; the original unit is kept alongside so the UI can still
 * say "2 cases" to the person who counted cases.
 *
 * `liter` and `keg` deliberately do NOT convert. A keg is not a number of
 * bottles in any way a receiver would accept, and inventing a conversion factor
 * would produce confident, wrong cost math. They compare only against the same
 * unit.
 */
export function toBottles(qty: number, uom: Uom, packSize = 1): number {
  const n = Number.isFinite(qty) ? qty : 0;
  const pack = packSize >= 1 ? packSize : 1;
  switch (uom) {
    case "case":
    case "pack":
    case "split_case":
      return n * pack;
    case "bottle":
    case "each":
      return n;
    case "keg":
    case "liter":
      return n;
  }
}

/** True when two quantities are in units that can be meaningfully compared. */
export function comparableUnits(a: Uom, b: Uom): boolean {
  const opaque = (u: Uom) => u === "keg" || u === "liter";
  if (opaque(a) || opaque(b)) return a === b;
  return true;
}
