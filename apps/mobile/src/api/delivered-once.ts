/**
 * A delivery this house has already taken in, read off a 409.
 *
 * Founder, 2026-09-05 (batch 46), rejecting 400 for this refusal: *"the request
 * is well-formed, the order's state conflicts with it, and the door and the
 * one-tap rail must be able to tell 'already done' from 'you sent nonsense' and
 * show the earlier delivery instead of an error."*
 *
 * WHY MOBILE NEEDS ITS OWN COPY OF THIS PARSER
 * --------------------------------------------
 * `apps/web/src/services/api/orders.ts` has the same three functions. They are
 * not shared because the two apps share no runtime package for API shapes, and
 * inventing one for a single error body would be a bigger change than the fix.
 * What keeps them honest is that both are asserted against the same literal
 * body in their own tests, and the body is built in exactly one place on the
 * gateway (`procurement/delivered-once.ts` `earlierDeliveryOf`).
 *
 * WHAT MATTERS ON THIS APP SPECIFICALLY
 * -------------------------------------
 * Deliveries are marked from the truck door through the OFFLINE OUTBOX
 * (`app/(tabs)/supply/[id].tsx` enqueues `POST /procurement/orders/:id/deliver`).
 * The outbox already refuses to retry a 4xx — it would only walk into the same
 * wall — but it showed `lastError`, so a receiver standing in a cellar with no
 * signal read *"Marked delivered didn't go through"* under an order that HAD
 * gone through, booked by a colleague upstairs. The one thing they needed was
 * the sentence this parser produces.
 */
import { ApiError } from "./client";

export interface EarlierDelivery {
  deliveredAt: string | null;
  receivedBy: string | null;
  receivedByName: string | null;
  /** Why there is no name, when one was wanted — a failed lookup and an
   *  unsigned delivery are different facts and must not both read as blank. */
  receivedByNameReason: string | null;
  quantityReceived: number | null;
  /**
   * The unit the count is stated in, or `null` — a REFUSAL, not a default. The
   * column has four writers: three use the order's own unit, the receiving door
   * uses bottles, and nothing on the row says which. For a multiplying unit the
   * gateway states none and `summary` omits the count rather than printing one
   * that could be off by the pack size.
   */
  unitType: string | null;
  /** Why the unit is, or is not, stated. Always present. */
  quantityUnitWhy: string;
  bottlesTotal: number | null;
  summary: string;
}

export interface AlreadyDeliveredRefusal {
  orderId: string;
  orderNumber: string | null;
  status: string | null;
  message: string;
  earlierDelivery: EarlierDelivery | null;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Read the refusal, or `null` when this error is not one.
 *
 * Checked structurally, not by status alone: a captive-portal or proxy 409 with
 * an HTML body must not produce a screen that says a delivery happened. Every
 * field is verified before it is believed.
 */
export function alreadyDeliveredRefusal(
  error: unknown,
): AlreadyDeliveredRefusal | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body as Record<string, unknown> | null | undefined;
  if (!body || typeof body !== "object") return null;
  if (body.reason !== "order_already_delivered") return null;

  const raw = body.earlierDelivery as Record<string, unknown> | null | undefined;
  const summary = raw ? str(raw.summary) : null;

  return {
    orderId: str(body.orderId) ?? "",
    orderNumber: str(body.orderNumber),
    status: str(body.status),
    message: str(body.message) ?? "That order has already been delivered.",
    earlierDelivery:
      raw && summary
        ? {
            deliveredAt: str(raw.deliveredAt),
            receivedBy: str(raw.receivedBy),
            receivedByName: str(raw.receivedByName),
            receivedByNameReason: str(raw.receivedByNameReason),
            quantityReceived: num(raw.quantityReceived),
            unitType: str(raw.unitType),
            quantityUnitWhy: str(raw.quantityUnitWhy) ?? "",
            bottlesTotal: num(raw.bottlesTotal),
            summary,
          }
        : null,
  };
}

/** What the screen shows in place of an error: what already happened, then why. */
export function alreadyDeliveredWords(
  refusal: AlreadyDeliveredRefusal,
): string {
  return refusal.earlierDelivery
    ? `${refusal.earlierDelivery.summary} ${refusal.message}`
    : refusal.message;
}
