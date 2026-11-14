import { HttpException, HttpStatus } from "@nestjs/common";
import { holdsHouseMoney } from "./documents/document-money-gate";

/**
 * WHO MAY SETTLE WHAT THE HOUSE PAID FOR A DELIVERY (r28 invoices audit, G3).
 *
 * `DeliveriesController` carried `JwtAuthGuard` and nothing else, so any
 * signed-in person at the house could put a price on the record, answer the
 * vendor's, accept a difference as billed, agree the delivery and verify it.
 * Verify is where the agreed price becomes the cost of the lots the delivery
 * booked, so a staff token could settle the house's cost of goods. The
 * documents controller already refuses staff every money act on the paper
 * (`document-money-gate.ts`); the delivery's money acts now take the same rule.
 *
 * ONE ANSWER TO "WHO HOLDS THE HOUSE'S MONEY": `holdsHouseMoney`, the `money`
 * row of `ROLE_POLICY` (ADR 0145). Owner and manager hold it (`admin` reads
 * the owner row); staff, an unknown role and no role do not.
 *
 * What stays open to everyone: reading the delivery and its list, creating
 * one, and attaching a paper to it, because those are door work. The door
 * count itself is booked through the documents controller and is not touched.
 *
 * Pure: no database, no Nest container. The controller calls it first, so a
 * refusal reads nothing and writes nothing.
 */

/** The delivery acts that settle money, by the name the refusal speaks. */
export type DeliveryMoneyAct =
  | "propose"
  | "counter"
  | "accept"
  | "accept_as_billed"
  | "agree"
  | "verify"
  | "return_stock";

const ACT_WORDS: Readonly<Record<DeliveryMoneyAct, string>> = {
  propose: "Putting a position on a delivery's record",
  counter: "Answering the vendor's position on a delivery",
  accept: "Accepting a position on a delivery",
  accept_as_billed: "Accepting a difference on a delivery as billed",
  agree: "Agreeing a delivery",
  verify: "Verifying a delivery, which settles what its goods cost,",
  return_stock: "Giving back a closed delivery's stock",
};

/** Refuse a session that does not hold the house's money, in words, or return. */
export function assertSettlesDeliveryMoney(
  user: { role?: string | null } | null | undefined,
  act: DeliveryMoneyAct,
): void {
  const role = user?.role ? String(user.role).trim() : "";
  if (holdsHouseMoney(role || null)) return;
  throw new HttpException(
    `${ACT_WORDS[act]} is an owner's or a manager's act, because it decides what the house pays. ` +
      `${role ? `You are signed in as ${role} at this house` : "This session could not be shown to hold any role at this house"}, so nothing was recorded. ` +
      (role
        ? "Counting the goods at the door still goes through for you; ask a manager or an owner to do this one."
        : "Ask a manager or an owner of this house to do this one."),
    HttpStatus.FORBIDDEN,
  );
}

/** The proposal fields that carry money. */
export const PROPOSAL_MONEY_KEYS = ["unit_price_proposed", "money_at_risk"] as const;

/**
 * The proposal thread as a role may read it.
 *
 * A holder reads it whole. Anyone else reads every position, quantity and
 * reason, with the money fields set to null, and `moneyWithheld: true` says so,
 * so a null is never read as "no price was proposed". The keys are kept.
 */
export function proposalsForRole(
  role: string | null | undefined,
  proposals: Record<string, unknown>[],
): { proposals: Record<string, unknown>[]; moneyWithheld: boolean } {
  const r = role ? String(role).trim() : "";
  if (holdsHouseMoney(r || null)) return { proposals, moneyWithheld: false };
  return {
    proposals: proposals.map((p) => {
      const out = { ...p };
      for (const k of PROPOSAL_MONEY_KEYS) if (k in out) out[k] = null;
      return out;
    }),
    moneyWithheld: true,
  };
}
