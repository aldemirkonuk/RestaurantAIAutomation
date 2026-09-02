import {
  bottleOpaque,
  fitsIntakePrecision,
  INTAKE_DECIMAL_PLACES,
  isFractionalUnit,
  normalizeUom,
  UOMS,
  Uom,
} from "./documents/document-types";

/**
 * Order-line arithmetic: how many bottles a quantity in some unit actually is.
 *
 * WHY THIS IS A MODULE AND NOT THREE LINES IN createOrder
 *
 * The same arithmetic is decided in at least three places — order creation, the
 * recurring-order materialiser, and the receiving door — and until now each one
 * decided it differently:
 *
 *   - `createOrder` set `bottles_total = dto.quantity` with no reference to
 *     `unit_type` at all. Five CASES booked five bottles.
 *   - `recordDoorReceipt` did `normalizeUom(input.countedUom) ?? "case"`, so an
 *     absent or misspelt unit fell through to the one unit that MULTIPLIES.
 *     24 counted against a 12-pack booked 288 bottles.
 *
 * Those are the same wound seen from two sides, and they interact: the door
 * back-derives pack size from `bottles_total / quantity`, so an order that books
 * 5 bottles for 5 cases teaches the door that a case holds one bottle. Fixing
 * either alone changes the other's answer. So the arithmetic lives in one pure
 * function that both ends call, and it is tested as arithmetic rather than
 * through two service mocks.
 *
 * THE RULE, WHICH IS ADR 0011's RULE
 *
 * ADR 0011 (`0011-pos-sale-volume-contract.md`, locked) decided this exact class
 * of error for POS depletion: a unit that cannot be resolved is never guessed,
 * because "a wrong number that nobody can see is worse than a missing number
 * that everybody can". The same asymmetry applies here, with one refinement that
 * matters:
 *
 *   - An **unrecognised** unit is refused. `"bxs"` could mean anything and every
 *     answer is a fabrication.
 *   - A **multiplying** unit (case / pack / split_case) with no pack size is
 *     refused. Guessing 12 multiplies a delivery twelvefold; guessing 1
 *     understates it twelvefold. Neither is knowledge.
 *   - An **absent** unit resolves to `bottle`. This is not a guess in the sense
 *     the ADR forbids: `bottle` is the identity of this arithmetic — it cannot
 *     multiply, it is the column's own declared default, and it is what every
 *     caller that omits the field already means. The failure the ADR exists to
 *     prevent is specifically the SILENT MULTIPLICATION; defaulting to the
 *     identity cannot produce one.
 *
 * `keg` and `liter` are deliberately opaque, matching `toBottles`: a keg is not
 * a number of bottles in any way a receiver would accept, and inventing a
 * conversion factor produces confident, wrong cost maths. They pass through at
 * 1:1 and are flagged, so a caller can tell "3 bottles" from "3 kegs counted as
 * 3 units".
 */

/**
 * The unit vocabulary `procurement_orders.unit_type` and
 * `procurement_order_items.unit_type` are constrained to, mirroring
 * `procurement_document_lines.uom` (`baseline:4401`) and
 * `procurement_receipt_events.counted_uom` (`baseline:4593`).
 *
 * This USED to be a literal list, duplicated from `UOMS` on the reasoning that a
 * change to the document vocabulary should not silently widen what an order may
 * store. That reasoning inverted in practice: the two lists were identical, the
 * duplication was invisible, and when ADR 0071 had to add a mass unit the
 * literal list was a second place to forget. A vocabulary that differs between
 * the order and the document it is matched against is not a safety property —
 * it is the unit mismatch this whole module exists to prevent.
 *
 * So it is now DERIVED, and the four database CHECK constraints are held to it
 * by `scripts/check_intake_units.py` rather than by a copied list. The guard
 * fails the build when they disagree, which is the protection the copy was
 * pretending to give.
 */
export const ORDER_UNIT_TYPES = UOMS;

/** Units where quantity x pack size is the bottle count. */
const MULTIPLYING: ReadonlySet<Uom> = new Set<Uom>([
  "case",
  "pack",
  "split_case",
]);

export interface ResolvedOrderUnits {
  ok: true;
  /** Canonical unit, safe to store under the CHECK constraint. */
  unitType: Uom;
  /** Always >= 1. Exactly 1 for every non-multiplying unit. */
  bottlesPerUnit: number;
  /** quantity x bottlesPerUnit, or quantity for an opaque unit. */
  bottlesTotal: number;
  /**
   * True when `bottlesTotal` counts kegs or litres rather than bottles. Callers
   * that price per bottle must not treat it as a bottle count.
   */
  opaque: boolean;
}

export interface UnresolvedOrderUnits {
  ok: false;
  reason:
    | "bad_quantity"
    | "unknown_unit"
    | "pack_size_required"
    | "pack_size_conflict";
  /** Operator-facing sentence. Safe to put in a 400 body. */
  message: string;
}

export type OrderUnitResolution = ResolvedOrderUnits | UnresolvedOrderUnits;

export interface OrderUnitInput {
  quantity: number;
  /** Whatever the caller said. Absent means bottles; unrecognised is refused. */
  unitType?: string | null;
  /** Bottles in one purchase unit. Required for case/pack/split_case. */
  bottlesPerUnit?: number | null;
}

/**
 * Resolve an ordered quantity into bottles, or refuse.
 *
 * Pure. Never throws, never guesses a multiplier, and never returns a
 * `bottlesTotal` it cannot justify from the inputs.
 */
export function resolveOrderUnits(input: OrderUnitInput): OrderUnitResolution {
  const qty = Number(input.quantity);

  // The unit is resolved BEFORE the quantity is judged, because whether a
  // fraction is legal depends entirely on the unit. This used to be the other
  // way round, and that ordering was the defect: `!Number.isInteger(qty)`
  // refused 4.5 without ever looking at what 4.5 was 4.5 OF.
  const raw =
    typeof input.unitType === "string" ? input.unitType.trim() : input.unitType;

  // Absent -> the identity. Present-but-unrecognised -> refused. The difference
  // is the whole point: "nothing was said" and "something was said that we
  // cannot read" are different facts and only one of them is safe to fill in.
  const unitType: Uom | null =
    raw === undefined || raw === null || raw === ""
      ? "bottle"
      : normalizeUom(raw);

  if (!unitType) {
    return {
      ok: false,
      reason: "unknown_unit",
      message:
        `Unit "${String(input.unitType)}" is not one we can convert to bottles. ` +
        `Use one of: ${ORDER_UNIT_TYPES.join(", ")}. ` +
        `Refusing rather than guessing — a guessed unit books a wrong quantity that nothing later can detect.`,
    };
  }

  // NOW the quantity, judged against the unit it is stated in.
  //
  // A count unit still demands a whole number: half a bottle is not a purchase
  // quantity and half a case is a receiving mistake, so the old constraint is
  // kept exactly where it was earning something.
  //
  // A mass or volume unit admits fractions, because 4.5 kg of flour is an
  // ordinary delivery and refusing it is the defect this repairs. What it does
  // NOT admit is more precision than the column can hold: `numeric(12,3)` does
  // not reject a fourth decimal place, it ROUNDS it, so 0.0005 kg of saffron
  // would be stored as 0.001 kg — double the real quantity, recorded as fact.
  // The refusal names the finer unit, because that is always the fix.
  if (!Number.isFinite(qty) || qty <= 0) {
    return {
      ok: false,
      reason: "bad_quantity",
      message: `Order quantity must be a positive number (got ${JSON.stringify(input.quantity)}).`,
    };
  }

  if (!isFractionalUnit(unitType)) {
    if (!Number.isInteger(qty) || qty < 1) {
      return {
        ok: false,
        reason: "bad_quantity",
        message:
          `An order in ${unitType.replace("_", " ")}s must be a whole number of at least 1 ` +
          `(got ${JSON.stringify(input.quantity)}). ` +
          `Fractions are only meaningful for a unit that measures rather than counts — order in g, kg or ml for those.`,
      };
    }
  } else if (!fitsIntakePrecision(qty)) {
    return {
      ok: false,
      reason: "bad_quantity",
      message:
        `${qty} ${unitType} has more than ${INTAKE_DECIMAL_PLACES} decimal places, and the quantity column ` +
        `stores three by ROUNDING — so this would be recorded as a different quantity than the one entered. ` +
        `State it in a finer unit instead (0.5 g, not 0.0005 kg).`,
    };
  }

  const provided =
    input.bottlesPerUnit === undefined || input.bottlesPerUnit === null
      ? null
      : Number(input.bottlesPerUnit);

  if (
    provided !== null &&
    (!Number.isFinite(provided) || !Number.isInteger(provided) || provided < 1)
  ) {
    return {
      ok: false,
      reason: "pack_size_required",
      message: `Bottles per unit must be a whole number of at least 1 (got ${JSON.stringify(input.bottlesPerUnit)}).`,
    };
  }

  if (MULTIPLYING.has(unitType)) {
    if (provided === null) {
      return {
        ok: false,
        reason: "pack_size_required",
        message:
          `An order in ${unitType.replace("_", " ")}s needs bottlesPerUnit — how many bottles are in one. ` +
          `Guessing 12 books twelve times the delivery; guessing 1 books a twelfth of it. ` +
          `Neither is knowledge, so the order is refused until the pack size is stated.`,
      };
    }
    return {
      ok: true,
      unitType,
      bottlesPerUnit: provided,
      bottlesTotal: qty * provided,
      opaque: false,
    };
  }

  // Non-multiplying: a pack size other than 1 contradicts the unit. Silently
  // ignoring it would let "24 bottles, 12 per unit" mean two different things to
  // the writer and the reader.
  if (provided !== null && provided !== 1) {
    return {
      ok: false,
      reason: "pack_size_conflict",
      message:
        `bottlesPerUnit=${provided} contradicts a unit of "${unitType}", which holds exactly one. ` +
        `Order in cases if you meant packs.`,
    };
  }

  return {
    ok: true,
    unitType,
    bottlesPerUnit: 1,
    bottlesTotal: qty,
    opaque: bottleOpaque(unitType),
  };
}

/**
 * Where a procurement order came from. Byte-identical rows for a manual order,
 * an Ask-AI order and a recurring materialisation made it impossible to answer
 * "did the AI place this?" — which is the first question anyone asks of an
 * autonomous ordering system, and the one a customer asks in a dispute.
 */
export const ORDER_SOURCES = [
  "manual",
  "ask_ai",
  "recurring",
  "retroactive",
  "agent",
] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/**
 * What kind of observation a `price_history` row records.
 *
 * Two, deliberately, and they are not interchangeable. `order_confirmed` is what
 * a vendor AGREED to charge; `receipt_verified` is what they actually DID charge
 * once the invoice was checked against the delivery. A price series that mixed
 * them without a discriminator would make a vendor who quotes low and bills high
 * look identical to one who does neither.
 */
export const PRICE_HISTORY_SOURCES = [
  "order_confirmed",
  "receipt_verified",
] as const;
export type PriceHistorySource = (typeof PRICE_HISTORY_SOURCES)[number];
