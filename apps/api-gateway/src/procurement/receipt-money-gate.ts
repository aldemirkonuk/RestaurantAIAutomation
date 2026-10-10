import { ForbiddenException } from "@nestjs/common";
import { holdsHouseMoney } from "./documents/document-money-gate";

/**
 * WHO MAY PUT MONEY ON A RECEIPT VERIFICATION (F-466).
 *
 * `POST procurement/orders/:id/verify-receipt` is where the phone and the desk
 * record a delivery's bottle count, and staff count bottles. The same payload
 * also carries the invoice's price and quantity, a reason for accepting a
 * price difference and the charges spread over the line; those become the
 * order's invoice price, the lot's landed cost, price history and, through the
 * match, a vendor credit claim. On the document side those are owner/manager
 * acts (`document-money-gate.ts`), the door keeps prices off floor staff
 * (`receiving.controller.ts`), and ADR 0167 refuses staff the credit ledger.
 *
 * So the count stays open to everyone and the money does not: the same
 * `money` row of `ROLE_POLICY` the documents read decides it, and a refusal
 * happens before anything is read or written.
 */

/** What a receipt payload says about money, in the words the refusal speaks. */
export function receiptMoneyFields(body: Record<string, unknown>): string[] {
  const has = (k: string) => body[k] != null;
  const out: string[] = [];
  if (has("invoiceUnitPrice")) out.push("the invoice price");
  if (has("invoiceQuantityInInvoiceUom") || has("invoiceQuantity"))
    out.push("the invoice quantity");
  if (has("priceOverrideReason"))
    out.push("a reason for accepting a different price");
  if (has("allocatedCharges")) out.push("delivery charges");
  return out;
}

function words(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Refuse a session that does not hold the house's money, or return. */
export function assertMayRecordReceiptMoney(
  role: string | null | undefined,
  what: string[],
): void {
  if (what.length === 0) return;
  const r = role ? String(role).trim() : "";
  if (holdsHouseMoney(r || null)) return;
  throw new ForbiddenException(
    `Recording ${words(what)} is an owner's or a manager's job, so nothing was saved. ` +
      (r
        ? `You are signed in as ${r} at this house. The bottle count on its own still goes through for you; ask a manager or an owner to add the rest.`
        : "This session could not be shown to hold a role at this house; ask a manager or an owner of this house to do this one."),
  );
}
