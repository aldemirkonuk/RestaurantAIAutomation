import { HttpException, HttpStatus } from "@nestjs/common";
import { holdsHouseMoney } from "../documents/document-money-gate";

/**
 * WHO MAY WORK A DELIVERY'S DESK (ADR 0312).
 *
 * `DeliveriesController` carries `JwtAuthGuard` and nothing else. Six of its
 * writes are the desk work on what the house pays for a delivery:
 *
 *   propose, counter   put a position on the record, and a proposal row can
 *                      carry a price (`unit_price_proposed`) and the money at
 *                      risk (`money_at_risk`);
 *   accept             an accepted proposal's price, where it names one, is
 *                      the price verify posts for that item, ahead of the
 *                      invoice line's;
 *   accept_as_billed   answers a recorded difference by accepting what was
 *                      billed;
 *   agree              moves the delivery to AGREED, the only state verify
 *                      runs from;
 *   verify             calls `finalise_delivery_cost` for each item the door
 *                      count booked that an agreed price reaches; with no
 *                      door count it posts nothing, and it still closes the
 *                      delivery as VERIFIED.
 *
 * So they are acts for the house's money holders: owner and manager, by the
 * `money` row of ADR 0145's `ROLE_POLICY`, through the SAME predicate the
 * vendor-document gate uses (`holdsHouseMoney`, `document-money-gate.ts`). One
 * predicate for both controllers; a per-person money right later widens that
 * one function, not these call sites.
 *
 * The door count, the photograph, reading a delivery and attaching a document
 * stay open to every member; this gate is not called on them.
 *
 * Pure: no database, no Nest container. Each of the six handlers calls it as
 * its first statement, so a refusal reaches no service and writes nothing.
 */

/** The desk acts, by the name the refusal speaks. */
export type DeliveryDeskAct =
  | "propose"
  | "counter"
  | "accept"
  | "accept_as_billed"
  | "agree"
  | "verify";

const ACT_WORDS: Readonly<Record<DeliveryDeskAct, string>> = {
  propose: "Putting a position on a delivery's record",
  counter: "Answering a position on a delivery",
  accept: "Accepting a position on a delivery",
  accept_as_billed: "Accepting a delivery's difference as billed",
  agree: "Agreeing a delivery",
  verify: "Verifying a delivery",
};

/**
 * Refuse a non-holder in words, or return. The same shape as
 * `assertHoldsHouseMoney`: an `HttpException` with `FORBIDDEN`, the role
 * trimmed, and a sentence that says what the act is, who the session is at
 * this house, that nothing changed, and who can do it.
 */
export function assertDeliveryDesk(
  user: { role?: string | null } | null | undefined,
  act: DeliveryDeskAct,
): void {
  const role = user?.role ? String(user.role).trim() : "";
  if (holdsHouseMoney(role || null)) return;
  throw new HttpException(
    `${ACT_WORDS[act]} is desk work on what this house pays its vendor, so it is an owner's or a manager's act. ` +
      `${role ? `You are signed in as ${role} at this house` : "This session could not be shown to hold any role at this house"}, so nothing was changed. ` +
      (role
        ? "The door count and the photograph still go through for you; ask a manager or an owner to do this one."
        : "Ask a manager or an owner of this house to do this one."),
    HttpStatus.FORBIDDEN,
  );
}
