import type {
  BookingReceipt,
  CostReceipt,
  StockResult,
} from "../canonical/delivery-stock.service";
import { holdsHouseMoney } from "./document-money-gate";

/**
 * A DOOR COUNT ONTO A DELIVERY ALREADY VERIFIED (r28 invoices audit, G9).
 *
 * `bookAtTheDoor` books onto a VERIFIED delivery (it refuses only CANCELLED,
 * REJECTED and LAPSED), and what it books lands PROVISIONAL: the cost was
 * settled at the verify, which ran before these goods were counted. Only a
 * second verify ("Check the cost again") posts them, and nothing told the
 * person so. The gates still read "verified", so those goods kept no cost.
 *
 * THE SESSION'S CALL (2026-11-07 /goal):
 *  - A person who holds the house's money gets the new goods costed at once,
 *    through the same `finishProvisional` a re-verify runs. The price was
 *    already agreed and verified for this delivery, so no new judgment is made:
 *    the agreed paper prices the goods it already priced.
 *  - Anyone else (staff count at the door) books the goods, and the answer says
 *    their cost waits for an owner or a manager to check the cost again.
 *    Posting cost is a money act (#1361's rule), and a staff count must not
 *    become one by the back door.
 *  Rejected: refusing a count onto a VERIFIED delivery (the goods are on the
 *  shelf whatever the screen says, so stock would go wrong to keep the cost
 *  tidy); costing for every role (makes the door a money act); a new
 *  delivery for the late count (it would carry no paper, so no cost at all).
 *
 * Returns null when there is nothing to say: the delivery is not VERIFIED, the
 * booking failed (its own failure is already in the receipt), or nothing went
 * onto the shelf (a recount down books no new lot).
 */
export interface CostAfterVerify {
  /** Items this count added whose cost was posted now. */
  costed: number;
  /** Items still provisional, with why. */
  waiting: { inventoryId: string; reason: string }[];
  /** True when the poster is not allowed to post, so nothing was tried. */
  waitsForAManager: boolean;
  sentence: string;
}

export async function costAfterVerify(args: {
  deliveryState: string | null | undefined;
  booking: StockResult<BookingReceipt>;
  role: string | null | undefined;
  finish: () => Promise<StockResult<CostReceipt>>;
}): Promise<CostAfterVerify | null> {
  if (args.deliveryState !== "VERIFIED") return null;
  if (!args.booking.ok) return null;
  if (!args.booking.value.booked.some((b) => b.delta > 0)) return null;

  if (!holdsHouseMoney(args.role ? String(args.role).trim() : null))
    return {
      costed: 0,
      waiting: [],
      waitsForAManager: true,
      sentence:
        "This delivery was already verified. What this count added is on the shelf, and its cost waits until an owner or a manager checks the cost again on the delivery.",
    };

  const done = await args.finish();
  if (!done.ok)
    return {
      costed: 0,
      waiting: [],
      waitsForAManager: false,
      sentence: `This delivery was already verified. What this count added is on the shelf, but its cost could not be posted now: ${done.error}. Check the cost again on the delivery.`,
    };
  const n = done.value.finalised.length;
  const waiting = done.value.stillProvisional;
  const posted =
    n > 0
      ? `This delivery was already verified, so what this count added was costed at the agreed price now: ${n} ${n === 1 ? "item" : "items"}.`
      : "This delivery was already verified, but nothing this count added could be costed at the agreed price.";
  const held = waiting.length
    ? ` ${waiting.length} ${waiting.length === 1 ? "item stays" : "items stay"} provisional: ${[
        ...new Set(waiting.map((w) => w.reason)),
      ].join(" ")}`
    : "";
  return { costed: n, waiting, waitsForAManager: false, sentence: posted + held };
}
