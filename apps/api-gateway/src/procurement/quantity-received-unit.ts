import { normalizeUom, type Uom } from "./documents/document-types";

/**
 * What unit is `procurement_orders.quantity_received` stated in?
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * `OrderResponseDto` did not carry the column at all, so the question never
 * had to be answered on the wire. The mobile receiving screen wanted it —
 * `apps/mobile/app/(tabs)/cellar/receive/[orderId].tsx` read
 * `order.quantityReceived ?? order.quantity` and therefore pre-filled the
 * physical count from the ORDERED quantity on every partially-received order.
 * Mapping the column without its unit would have replaced a wrong default
 * with a differently wrong one, so the unit travels with it (ADR 0070: a
 * quantity states its own unit).
 *
 * ===========================================================================
 * THE COLUMN HAS FOUR WRITERS AND THEY DO NOT AGREE — MEASURED, NOT ASSUMED
 * ===========================================================================
 * Measured 2026-09-05 by `grep -rn "quantity_received" apps/api-gateway/src`
 * on this tree (4 write sites, 0 of them in a spec):
 *
 *   THE ORDER'S OWN `unit_type`, said by three:
 *     * `markDelivered`  — `quantity_received: resolvedQuantity`, and
 *       `resolvedQuantity = quantityReceived ?? existingOrder.quantity`, so it
 *       is beside `quantity` and therefore in `quantity`'s unit.
 *     * `updateOrder`    — from `UpdateOrderDto.quantityReceivedInOrderUom`.
 *       The field name is itself the claim, and the DTO's own description says
 *       a client may not restate the unit.
 *     * `verifyReceipt`  — `acceptedQty + rejectedQty`, in the COUNTED unit as
 *       submitted, which defaults to the order's when no client sends one.
 *
 *   BOTTLES, said by one:
 *     * `recordDoorReceipt` (`receiving.service.ts:504`) —
 *       `quantity_received = totals.receivedBottles`, a sum over
 *       `procurement_receipt_events.counted_qty_bottles`. Its own comment above
 *       that line says so in capitals: "THIS WRITE IS IN BOTTLES, AND IT IS THE
 *       ONLY ONE THAT IS."
 *
 * Nothing on the row records WHICH of the four wrote it. `status` does not:
 * `updateOrder` writes the column under any status a caller may set, so
 * PARTIALLY_RECEIVED is not a door signature.
 *
 * ===========================================================================
 * SO THE RULE IS THE ONE THE ARITHMETIC ALLOWS, NOT A PREFERENCE
 * ===========================================================================
 * The two readings differ by exactly `toBottles(1, unit, packSize)`
 * (`documents/document-types.ts:227`). That factor is 1 for `bottle`, `each`,
 * `keg` and `liter`, and the pack size for `case`, `pack` and `split_case`.
 *
 *   * A NON-MULTIPLYING unit: both writers produce the same number, so the
 *     value is unambiguously in the order's own unit. Stated.
 *   * A MULTIPLYING unit: the two disagree by the pack, the row does not say
 *     which wrote it, and every answer is a guess. REFUSED — `uom: null` — and
 *     the caller prints the refusal rather than a number under a guessed unit.
 *     ADR 0011's rule, which `order-units.ts` already applies to the write
 *     side: a unit that cannot be resolved is never guessed.
 *
 * An ABSENT `unit_type` is `bottle`, not a refusal: that is the column's own
 * declared default (`baseline:4521`, `'bottles'`, which `normalizeUom` folds)
 * and it is the identity of this arithmetic, so it cannot produce the silent
 * multiplication the rule exists to prevent. An UNRECOGNISED `unit_type` is
 * refused — `"bxs"` could mean anything.
 *
 * THIS IS A READING, NOT A REPAIR. The underlying defect — one integer column
 * with two units — is still open and still filed in `.planning/v3.0-TECH-DEBT.md`.
 * What changes here is that the wire no longer hands a number to a screen
 * without saying what it counts.
 */

/** Units where the door's bottle count and the desk's order-unit count differ. */
const MULTIPLYING: ReadonlySet<Uom> = new Set<Uom>([
  "case",
  "pack",
  "split_case",
]);

export interface QuantityReceivedReading {
  /**
   * The column's value: a number, or `null` when the row was read and the
   * column is empty. Never a 0 standing in for "nothing recorded" — an order
   * that genuinely received zero and an order nobody has booked are different
   * facts and this reading keeps them apart.
   */
  quantity: number | null;
  /**
   * The unit `quantity` is stated in, or `null` when this row cannot state it.
   * `null` is a refusal, never a default: see the header.
   */
  uom: string | null;
  /** Why, in one sentence. Always present, for the log and for the screen. */
  why: string;
}

/**
 * The sentence a screen prints instead of a received count it cannot place.
 *
 * Exported so the phone, the desk and the test assert the same words rather
 * than three paraphrases of them.
 */
export const QUANTITY_RECEIVED_UNIT_UNSTATED =
  "The received count cannot be placed in a unit on this order: the receiving " +
  "door records it in bottles and the desk records it in the order's own unit, " +
  "and nothing on the row says which wrote it. Count from scratch rather than " +
  "from a number that could be off by the pack size.";

/**
 * Read the column and its unit off one `procurement_orders` row. Pure; never
 * throws; never returns a `uom` it cannot justify from the inputs.
 */
export function readQuantityReceived(
  rawQuantity: unknown,
  rawUnitType: string | null | undefined,
): QuantityReceivedReading {
  const n = Number(rawQuantity);
  const quantity =
    rawQuantity === null || rawQuantity === undefined || !Number.isFinite(n)
      ? null
      : n;

  const trimmed = typeof rawUnitType === "string" ? rawUnitType.trim() : rawUnitType;
  const unit: Uom | null =
    trimmed === undefined || trimmed === null || trimmed === ""
      ? "bottle"
      : normalizeUom(trimmed);

  if (!unit) {
    return {
      quantity,
      uom: null,
      why:
        `The order's unit_type is ${JSON.stringify(rawUnitType)}, which is not a unit ` +
        `this platform can read, so the received count is not placed in one. ` +
        QUANTITY_RECEIVED_UNIT_UNSTATED,
    };
  }

  if (MULTIPLYING.has(unit)) {
    return { quantity, uom: null, why: QUANTITY_RECEIVED_UNIT_UNSTATED };
  }

  return {
    quantity,
    uom: unit,
    why:
      `Stated in ${unit}: the order's own unit does not multiply, so the door's ` +
      `bottle count and the desk's order-unit count are the same number.`,
  };
}
