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

/**
 * The unit vocabulary every intake surface shares.
 *
 * The first seven are the original beverage set. `g`, `kg` and `ml` were added
 * 2026-09-02 (ADR 0071) because the set had NO MASS UNIT AT ALL: a 25 kg sack of
 * flour had no expressible unit anywhere in the system, so the receiving door
 * could not record a delivery of it — not awkwardly, but at all.
 *
 * Ordered by dimension rather than alphabetically, because the dimension is the
 * property that matters: `UOM_DIMENSION` below is the reason a mass may not be
 * compared with a count, and this list is the reason that map is total.
 */
export const UOMS = [
  // count — a number of discrete things
  "bottle",
  "case",
  "keg",
  "pack",
  "split_case",
  "each",
  // volume
  "ml",
  "liter",
  // mass
  "g",
  "kg",
] as const;
export type Uom = (typeof UOMS)[number];

/**
 * What kind of physical quantity a unit measures.
 *
 * `FOOD-REASONING-GRAPH`:73-83 called unit ontology "the class of failure that
 * kills food software", and ADR 0070 found it "designed nowhere" — OD-113 had
 * collapsed dimension into magnitude without checking it. This map is the axis
 * that was missing. Every comparison and every conversion below routes through
 * it, so a gram can never be silently weighed against a bottle.
 *
 * `keg` is a COUNT, not a volume. A keg is a container you count; its contents
 * are not a number this system knows. That is the same judgement `toBottles`
 * already made by refusing to convert it, now stated once instead of twice.
 */
export const UOM_DIMENSION: Readonly<Record<Uom, "count" | "mass" | "volume">> =
  {
    bottle: "count",
    case: "count",
    keg: "count",
    pack: "count",
    split_case: "count",
    each: "count",
    ml: "volume",
    liter: "volume",
    g: "mass",
    kg: "mass",
  };

/**
 * How many of the dimension's BASE unit one of this unit is.
 *
 * The base is milligrams for mass and millilitres for volume — the units ADR
 * 0070 requires the ledger to count in ("milligrams, not grams, for the
 * ingredient class that needs it: saffron at 0.1-0.5 g doses, truffle at 2-5 g").
 * Count units have no scale: one bottle is one bottle, and a case's multiplier
 * is a per-line pack size, not a property of the word "case".
 *
 * THIS TABLE IS THE INTAKE -> LEDGER SEAM. If the ledger's base unit ever
 * changes, this is the single line that moves.
 */
export const UOM_BASE_SCALE: Readonly<Partial<Record<Uom, number>>> = {
  ml: 1,
  liter: 1000,
  g: 1000,
  kg: 1_000_000,
};

/** Intake columns are `numeric(12,3)`: three decimal places, and no more. */
export const INTAKE_DECIMAL_PLACES = 3;

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
    // Mass and volume, added with the vocabulary itself (ADR 0071).
    //
    // The spellings are deliberately NOT case-folded the way the others are:
    // `normalizeUom` lowercases its input before this switch, so "MG" and "Mg"
    // both arrive as "mg". That is safe for these because no unit in this
    // vocabulary differs from another only by case. It would NOT be safe to add
    // a unit where case carries meaning (`mm` vs `Mm`), and this comment is here
    // so the next person adding one notices before it becomes a silent alias.
    case "ml":
    case "mls":
    case "millilitre":
    case "millilitres":
    case "milliliter":
    case "milliliters":
      return "ml";
    case "g":
    case "gr":
    case "gram":
    case "grams":
    case "gramme":
    case "grammes":
      return "g";
    case "kg":
    case "kgs":
    case "kilo":
    case "kilos":
    case "kilogram":
    case "kilograms":
    case "kilogramme":
    case "kilogrammes":
      return "kg";
    default:
      return null;
  }
}

/**
 * True when a quantity in this unit may legitimately be fractional.
 *
 * The distinction is physical, not stylistic. Half a gram of saffron is a thing;
 * half a bottle is not a purchase quantity, and half a case is a receiving
 * mistake that the pack-size arithmetic exists to catch. Admitting fractions
 * everywhere would throw away a real constraint on the count units to buy
 * nothing for them.
 */
export function isFractionalUnit(uom: Uom): boolean {
  return UOM_DIMENSION[uom] !== "count";
}

/**
 * Whether a quantity survives the trip into `numeric(12,3)` UNCHANGED.
 *
 * Postgres does not refuse a value with too many decimal places — it ROUNDS,
 * silently. 0.5 g of saffron stated in kg is 0.0005, which lands as 0.001: a
 * 100% overstatement, stored as fact, with no error anywhere. That is this
 * repo's cardinal fault (`memory/absence-reported-as-health`) in miniature, so
 * the value is checked before it is sent rather than after it is wrong.
 *
 * The fix for a refusal is always to state the quantity in a finer unit — 0.5 g
 * rather than 0.0005 kg — which is why the refusal says so.
 */
export function fitsIntakePrecision(qty: number): boolean {
  if (!Number.isFinite(qty)) return false;
  // Compare decimal strings rather than multiplying: 0.029 * 1000 is
  // 28.999999999999996 in IEEE 754, and a float test would refuse a quantity
  // that `numeric(12,3)` stores exactly.
  const decimals = String(qty).split(".")[1] ?? "";
  if (decimals.includes("e") || decimals.includes("E")) {
    // Exponential notation (1e-7). Fall back to an explicit round-trip.
    return Number(qty.toFixed(INTAKE_DECIMAL_PLACES)) === qty;
  }
  return decimals.length <= INTAKE_DECIMAL_PLACES;
}

/** A quantity converted into its dimension's base unit, or the reason it was not. */
export type BaseUnitConversion =
  | { ok: true; value: number; baseUom: "mg" | "ml" }
  | { ok: false; reason: string };

/**
 * Convert an intake quantity into the integer base unit the LEDGER counts in.
 *
 * THE BOUNDARY THIS FUNCTION IS, AND WHY IT CANNOT ROUND
 *
 * Intake and the ledger deliberately store quantities differently, and this is
 * the only place the two representations meet:
 *
 *   - Intake stores `numeric(12,3)` IN THE UNIT THE PAPER STATED. A
 *     `procurement_document_line` is a record of what a vendor's document said,
 *     and vendors write "25.5 kg". Storing 25500000 would make the row stop
 *     matching the document it exists to reproduce.
 *   - The ledger stores `integer` in the item's canonical base unit (ADR 0070,
 *     locked). Integer arithmetic is what makes `before + change = after` exact,
 *     and it is what keeps a rounding residue out of `inventory_lot_rollup`'s
 *     weighted-average-cost divisor.
 *
 * A conversion between a decimal and an integer is exactly where a rounding
 * error would be introduced. Here it cannot be, and the reason is arithmetic
 * rather than care: intake carries at most THREE decimal places, and every
 * non-base unit's scale is at least 1000, so `qty * scale` is ALWAYS a whole
 * number. 4.5 kg is 4500000 mg. 0.001 kg is 1000 mg. There is no remainder to
 * round because the product of a 3-decimal number and 1000 is an integer.
 *
 * The single case where it would not be is a quantity stated in the base unit
 * itself with a fraction — 0.5 ml. That is refused here rather than rounded,
 * and it is refused at the DTO before it ever reaches a column. So rounding at
 * this boundary is not "avoided carefully"; it is UNREACHABLE.
 *
 * Count units return `ok: false`: a bottle has no mass and no volume this system
 * knows, and inventing one is the confident-wrong-number failure that
 * `toBottles` already refuses for kegs.
 */
export function toBaseUnits(qty: number, uom: Uom): BaseUnitConversion {
  const dimension = UOM_DIMENSION[uom];
  if (dimension === "count") {
    return {
      ok: false,
      reason:
        `"${uom}" counts things; it has no mass or volume. ` +
        `A count crosses into the ledger as a count, not through a base unit.`,
    };
  }

  if (!Number.isFinite(qty)) {
    return {
      ok: false,
      reason: `Quantity ${JSON.stringify(qty)} is not a number.`,
    };
  }

  if (!fitsIntakePrecision(qty)) {
    return {
      ok: false,
      reason:
        `${qty} ${uom} has more than ${INTAKE_DECIMAL_PLACES} decimal places, which intake stores by ROUNDING. ` +
        `State it in a finer unit instead.`,
    };
  }

  const scale = UOM_BASE_SCALE[uom];
  /* istanbul ignore next -- UOM_BASE_SCALE is total over non-count units; this
     guards a future unit added to UOMS without a scale, which must refuse
     rather than produce NaN. */
  if (scale === undefined) {
    return {
      ok: false,
      reason: `"${uom}" has no base-unit scale. Add one to UOM_BASE_SCALE before using it.`,
    };
  }

  // Round the PRODUCT, not the input: 4.5 * 1_000_000 is exactly 4500000 in
  // IEEE 754, but 0.029 * 1000 is 28.999999999999996. Both are whole numbers in
  // decimal, and `fitsIntakePrecision` above has already proven it, so the
  // rounding here only discards float representation error — never real value.
  const product = Math.round(qty * scale);
  return {
    ok: true,
    value: product,
    baseUom: dimension === "mass" ? "mg" : "ml",
  };
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
 *
 * The mass and volume units added by ADR 0071 extend that refusal rather than
 * complicating it: 25 kg of flour is not a number of bottles either. They pass
 * through at 1:1 and are opaque, exactly as `keg` always has been.
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
    // Not bottle-convertible. Passed through so the number is not lost, and
    // flagged opaque by `bottleOpaque` so no caller prices it per bottle.
    case "keg":
    case "liter":
    case "ml":
    case "g":
    case "kg":
      return n;
  }
}

/**
 * True when `toBottles` returned a number that is NOT a bottle count.
 *
 * Kept as a function over the dimension map rather than a second hand-written
 * list, because the two lists drifting apart is precisely how a mass would end
 * up priced per bottle.
 */
export function bottleOpaque(uom: Uom): boolean {
  return uom === "keg" || UOM_DIMENSION[uom] !== "count";
}

/**
 * True when two quantities are in units that can be meaningfully compared.
 *
 * Behaviour for the original seven units is unchanged, and deliberately so —
 * this function decides whether a receiving discrepancy is real, and a
 * loosening here would turn a false alarm back on. What is NEW is that two units
 * of the SAME dimension now compare: grams against kilograms is a real
 * comparison (they convert exactly), where kegs against litres never was.
 */
export function comparableUnits(a: Uom, b: Uom): boolean {
  if (UOM_DIMENSION[a] !== UOM_DIMENSION[b]) return false;
  // Within `count`, `keg` remains opaque: it is a container whose contents this
  // system does not know, so it compares only against itself.
  if (a === "keg" || b === "keg") return a === b;
  // Within mass or volume, any pair converts exactly through UOM_BASE_SCALE.
  return true;
}
