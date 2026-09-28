import type { ProcurementOrder } from "@/api/types";

/** A barcode counts one bottle, even when the purchase order counts cases. */
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
  const received = order?.quantityReceived;
  const receivedUnit = order?.quantityReceivedUom;
  const knownReceived =
    (receivedUnit === "bottle" || receivedUnit === "each") &&
    typeof received === "number" &&
    Number.isSafeInteger(received) &&
    received >= 0;
  return {
    orderedBottles,
    prefillBottles: knownReceived ? received : (orderedBottles ?? 0),
    note: knownReceived
      ? `Pre-filled from ${received} bottles recorded as received. Confirm the physical count.`
      : orderedBottles == null
        ? "This order does not state a convertible bottle quantity. Resolve its unit before receiving it."
        : "Pre-filled from the ordered bottle quantity. Confirm what actually arrived; this is not proof of receipt.",
  };
}
