import type { ShelfReceived } from "@/api/types";

/**
 * Read the gateway's `received` block (ADR 0192) structurally, or `null`.
 *
 * "Received" is what the stock ledger booked for the order's item, in the
 * item's stock unit, never rounded. Every field is type-checked before it is
 * believed: a block that says `readable: true` without a whole, non-negative
 * count is not a reading, and a `readable: false` block is a failed read —
 * never a zero.
 */
export function readShelfReceived(raw: unknown): ShelfReceived | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const int = (v: unknown): number | null =>
    typeof v === "number" && Number.isSafeInteger(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v ? v : null;
  if (b.readable === false) {
    return {
      readable: false,
      why: str(b.why) ?? "What this order received could not be read.",
      quantityInStockUom: null,
      stockUom: null,
      packUnit: null,
      packSize: null,
      packs: null,
      looseInStockUom: null,
      words: null,
      rejectedAtDoorBottles: null,
      countedNotBookedBottles: null,
    };
  }
  const quantity = int(b.quantityInStockUom);
  const stockUom = str(b.stockUom);
  const words = str(b.words);
  if (b.readable !== true || quantity === null || quantity < 0 || !stockUom || !words)
    return null;
  return {
    readable: true,
    why: null,
    quantityInStockUom: quantity,
    stockUom,
    packUnit: str(b.packUnit),
    packSize: int(b.packSize),
    packs: int(b.packs),
    looseInStockUom: int(b.looseInStockUom),
    words,
    rejectedAtDoorBottles: int(b.rejectedAtDoorBottles),
    countedNotBookedBottles: int(b.countedNotBookedBottles),
  };
}
