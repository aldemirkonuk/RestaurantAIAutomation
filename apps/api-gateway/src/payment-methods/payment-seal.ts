/**
 * What a seal on a PAYMENT-METHOD write is a seal over.
 *
 * ---------------------------------------------------------------------------
 * WHY PAYMENTS ARE SEALED AT ALL, GIVEN THERE IS NO CHARGE PATH
 * ---------------------------------------------------------------------------
 * ADR 0110 is explicit: nothing in this product charges anybody. So the seal
 * here is not protecting a payment — it is protecting the SETUP for one. The
 * three writes that exist decide which instrument the house's provider is told
 * to charge first, and which instruments remain attached at all. An attacker
 * holding a manager's session and no seal could quietly attach their own
 * instrument as the default and wait for the charge path to arrive. Sealing it
 * now, before there is money moving, is the only order in which that is cheap.
 *
 * ---------------------------------------------------------------------------
 * THE SUBJECT OF "ADD AN INSTRUMENT"
 * ---------------------------------------------------------------------------
 * `set_default` and `remove` seal the instrument they name — obvious. `create`
 * has no instrument yet, so its subject is the HOUSE's register: the id sealed
 * is the restaurant's. That is stated here rather than left to be inferred,
 * because a subject chosen silently is a subject nobody can check. A seal
 * minted for `create` therefore cannot be spent on `remove`, because the ACT is
 * part of the binding even when the subject id is not the instrument's.
 *
 * ---------------------------------------------------------------------------
 * THE ARGUMENTS ARE WHAT THE MANAGER SAW
 * ---------------------------------------------------------------------------
 * The register shows brand and last four. Those are hashed into the seal, so a
 * token minted while looking at "Visa ····4242" cannot be spent after the row
 * behind that id became a different card — the same edit-after-approval hole
 * `order-seal.ts` closes for money.
 */

export const PAYMENT_SEAL_ACTS = ["create", "set_default", "remove"] as const;
export type PaymentSealAct = (typeof PAYMENT_SEAL_ACTS)[number];

export function isPaymentSealAct(value: unknown): value is PaymentSealAct {
  return (
    typeof value === "string" &&
    (PAYMENT_SEAL_ACTS as readonly string[]).includes(value)
  );
}

/**
 * The canonical arguments. `null` is preserved rather than coerced to "": a
 * card with no recorded brand and a card whose brand is the empty string are
 * different rows, and deciding they are the same is the kind of helpfulness
 * that ends with the wrong instrument detached.
 */
export function paymentSealArgs(facts: {
  act: PaymentSealAct;
  methodId: string | null;
  brand: string | null;
  last4: string | null;
}): Record<string, unknown> {
  return {
    act: facts.act,
    methodId: facts.methodId,
    brand: facts.brand,
    last4: facts.last4,
  };
}
