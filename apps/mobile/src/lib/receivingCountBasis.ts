import type { ProcurementOrder } from "@/api/types";
import { readShelfReceived } from "./shelfReceived";

/**
 * The two facts the founder asked to travel BESIDE the count (ADR 0192): what
 * the door rejected, and what it counted that is not on the shelf yet. Never
 * folded into the pre-fill — a truck the door counted whose booking failed is
 * not on the shelf, and the receiver has to be told so before confirming.
 */
function besideTheShelf(rejected: number | null, pending: number | null): string {
  const bottles = (n: number) => `${n} ${n === 1 ? "bottle was" : "bottles were"}`;
  let out = "";
  if (rejected !== null && rejected > 0) out += ` ${bottles(rejected)} rejected at the door.`;
  if (pending !== null && pending > 0)
    out += ` ${bottles(pending)} counted at the door and ${pending === 1 ? "is" : "are"} not on the shelf yet.`;
  return out;
}

/**
 * A barcode counts one bottle, even when the purchase order counts cases.
 *
 * The count starts from what the stock LEDGER booked for the order (ADR 0192,
 * founder 2026-09-21): the `received` block, in the item's stock unit, which
 * for wine is bottles — so it pre-fills the phone's bottle count directly,
 * "5 cases + 5 bottles" as 65. A failed read, or a route that sent none,
 * starts from the ordered bottles and SAYS so; it is never read as zero.
 */
export function receivingCountBasis(order?: ProcurementOrder) {
  const unit = (order?.unitType || "bottle").toLowerCase();
  const ordered =
    unit === "bottle" || unit === "each"
      ? order?.quantity
      : ["case", "pack", "split_case"].includes(unit)
        ? order?.bottlesTotal
        : null;
  const orderedBottles =
    typeof ordered === "number" && Number.isSafeInteger(ordered) && ordered >= 0
      ? ordered
      : null;
  const shelf = readShelfReceived(order?.received);
  const bottleShelf =
    shelf?.readable === true &&
    (shelf.stockUom === "bottle" || shelf.stockUom === "each") &&
    shelf.quantityInStockUom !== null;
  const fallback =
    orderedBottles == null
      ? "This order does not state a convertible bottle quantity. Resolve its unit before receiving it."
      : "Pre-filled from the ordered bottle quantity. Confirm what actually arrived; this is not proof of receipt.";
  return {
    orderedBottles,
    prefillBottles: bottleShelf
      ? (shelf.quantityInStockUom as number)
      : (orderedBottles ?? 0),
    note: bottleShelf
      ? `Pre-filled from ${shelf.words} on the shelf for this order (${shelf.quantityInStockUom} ` +
        `${shelf.quantityInStockUom === 1 ? "bottle" : "bottles"}).` +
        besideTheShelf(shelf.rejectedAtDoorBottles, shelf.countedNotBookedBottles) +
        " Confirm the physical count."
      : shelf?.readable === false
        ? `What the stock ledger booked for this order could not be read (${shelf.why}). ${fallback}`
        : fallback,
  };
}
