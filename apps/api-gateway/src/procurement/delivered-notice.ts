/**
 * What the "Verify delivery" notice says about the shelf — only what is true.
 *
 * Before the founder's answer of 2026-09-21 (ADR 0192's amendment),
 * `markDelivered` told the manager "N bottles stocked in" on every path: also
 * when the item had no wine-library row and nothing was booked, when the order
 * named no item, and when the quantity was zero. The words are now decided
 * from what the booking actually did, here, as a pure function the spec pins.
 */
import type { EnqueueOutcome } from "../inventory/house-item-research";
import { NAME_THIS_WINE_FLAG } from "../inventory/house-item-research";

export type DeliveryBooking =
  /** This call moved `bottles` onto the shelf through the ledger. */
  | { kind: "booked"; bottles: number }
  /** The receiving door already booked this order (ADR 0103 A5); nothing booked twice. */
  | { kind: "booked_by_door" }
  /** An earlier delivery of this order already booked it; nothing booked twice. */
  | { kind: "booked_before" }
  /** Nothing could be booked, and why (no item on the order, a zero quantity). */
  | { kind: "nothing"; why: string };

export function deliveredStockWords(b: DeliveryBooking): string {
  switch (b.kind) {
    case "booked":
      return `${b.bottles} bottles stocked in.`;
    case "booked_by_door":
      return "The receiving door already booked this order's stock; nothing was booked twice.";
    case "booked_before":
      return "This order's stock was already booked when it was first delivered; nothing was booked twice.";
    case "nothing":
      return `No stock was booked: ${b.why}.`;
  }
}

/**
 * The sentence about an item the wine library does not have. Null when the
 * item has a library row (nothing to say). A failed queue write is said, never
 * dropped.
 */
export function researchWords(r: EnqueueOutcome | null): string | null {
  if (r === null) return null;
  if (!r.ok) {
    return `This wine is not in the wine library, and it could not be queued for research: ${r.error}.`;
  }
  switch (r.status) {
    case "queued":
      return "This wine is not in the wine library yet, so it is queued for research.";
    case "not_findable":
      return `Its name does not say which wine it is, so it was not sent for research. ${NAME_THIS_WINE_FLAG}: name it on Inventory.`;
    case "matched":
      return null;
  }
}

export function verifyNoticeMessage(b: DeliveryBooking, r: EnqueueOutcome | null): string {
  const research = researchWords(r);
  return [
    deliveredStockWords(b),
    research,
    "Confirm the physical count against the vendor invoice.",
  ]
    .filter(Boolean)
    .join(" ");
}
