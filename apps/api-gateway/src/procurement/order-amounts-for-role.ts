import { holdsHouseMoney } from "./documents/document-money-gate";
import { OrderListResponseDto, OrderResponseDto } from "./dto/procurement.dto";

/**
 * WHAT AN ORDER READ CARRIES TO A ROLE THAT DOES NOT HOLD THE HOUSE'S MONEY.
 *
 * The founder's rule (DASH-W22, ADR 0145, ADR 0253 as the money-policy audit
 * of 2026-10-07 reads it): staff see counts, names, states and dates, never
 * amounts, and the gateway stops sending them, because a page that only hides
 * them keeps nothing private. `/dashboard` hid the order totals for staff
 * while `GET /procurement/orders/pending` and `/orders/history` still carried
 * them in the payload (F-433).
 *
 * AN ALLOWLIST, NOT A STRIP LIST. A non-holder gets only the keys named
 * below; a key added to `OrderResponseDto` later stays on the server for
 * staff until someone decides it is not money. The figure keys are OMITTED,
 * never null or zero, and the reply says `amountsWithheld: true` (the audit's
 * marker, as `POST /procurement/documents` already sends it), so a page can
 * tell "withheld for your role" from "the order names no total".
 *
 * Left out with the figures: `priceUom` and `pricePackSize` (what the price is
 * stated in says nothing without the price) and the agreement's `allowance`,
 * `deposit` and `freight`. `currency` stays: it names no amount.
 */
const ORDER_KEYS_FOR_EVERY_ROLE = [
  "id",
  "orderNumber",
  "restaurantId",
  "inventoryId",
  "providerId",
  "quantity",
  "unitType",
  "bottlesTotal",
  "status",
  "requestedAt",
  "approvedAt",
  "deliveredAt",
  "completedAt",
  "isEmergency",
  "priorityLevel",
  "wineName",
  "providerName",
  "received",
  "priority",
  "currency",
  "recurrenceFrequency",
  "recurrenceAnchorDay",
  "recurrenceNextDueOn",
  "recurrenceStatus",
  "recurrenceParentOrderId",
  "recurrenceOccurrenceOn",
] as const satisfies ReadonlyArray<keyof OrderResponseDto>;

export type OrderForRole = OrderResponseDto & { amountsWithheld?: true };

/** One order as this role may read it. */
export function orderForRole(
  order: OrderResponseDto,
  role: string | null | undefined,
): OrderForRole {
  if (holdsHouseMoney(role)) return order;
  const kept: Partial<OrderResponseDto> = {};
  for (const key of ORDER_KEYS_FOR_EVERY_ROLE) {
    if (key in order) (kept as any)[key] = order[key];
  }
  return { ...(kept as OrderResponseDto), amountsWithheld: true };
}

/** A page of history as this role may read it: the marker sits at the root. */
export function orderListForRole(
  list: OrderListResponseDto,
  role: string | null | undefined,
): OrderListResponseDto & { amountsWithheld?: true } {
  if (holdsHouseMoney(role)) return list;
  return {
    ...list,
    orders: list.orders.map((o) => {
      const { amountsWithheld: _marker, ...rest } = orderForRole(o, role);
      return rest as OrderResponseDto;
    }),
    amountsWithheld: true,
  };
}

/**
 * An order's letters as this role may read them (F-957, the phone's order
 * screen). Each letter carries the order's quoted price beside the thread;
 * a non-holder gets the letter without it, marked `amountsWithheld`, as the
 * order read itself does.
 *
 * The letters' own words name prices too (F-982, coordinator call S144): the
 * vendor's text or the house's draft (`draftContent`), the engine's summary of
 * the thread (`rollingSummary`) and the conditions it flagged
 * (`specialConditions`). A non-holder who may send to vendors (ADR 0175 D10:
 * a grantee, `readsLetters`) keeps them, because a letter they approve is a
 * letter they must read; anyone else gets the letter without them, marked
 * `wordsWithheld`, so a page can tell "withheld for your role" from "this
 * letter has no words". The exception follows the grant, not the role.
 *
 * The same cut runs over the approval queue (`GET /conversations/active`) and
 * the sent-letter ledger (`GET /conversations/history`), which read the same
 * rows one route over. The queue adds the vendor's latest figure
 * (`negotiatedPrice`) and the subject line, which may quote the vendor; the
 * reply engine's review flags (`constraintFlags`) carry the house's target
 * and the vendor's best price beside its reasons. A grantee keeps the flags
 * without those two figures (the reasons say why a letter was held); anyone
 * else gets no flags, as the words they explain.
 */
const LETTER_MONEY_KEYS = ["quotedPrice", "negotiatedPrice"] as const;

export const LETTER_PROSE_KEYS = [
  "draftContent",
  "rollingSummary",
  "specialConditions",
  "subject",
  "constraintFlags",
] as const;

const FLAG_FIGURE_KEYS = ["target_price", "best_vendor_price"] as const;

/** The reply engine's review flags without the two figures they carry. */
export function flagsWithoutFigures(flags: unknown): unknown {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return flags;
  const cut: Record<string, unknown> = { ...(flags as object) };
  for (const key of FLAG_FIGURE_KEYS) delete cut[key];
  return cut;
}

export function conversationsForRole<T extends Record<string, unknown>>(
  rows: T[],
  role: string | null | undefined,
  opts: { readsLetters?: boolean } = {},
): Array<Partial<T> & { amountsWithheld?: true; wordsWithheld?: true }> {
  if (holdsHouseMoney(role)) return rows;
  return rows.map((row) => {
    const kept: Record<string, unknown> = { ...row };
    for (const key of LETTER_MONEY_KEYS) delete kept[key];
    if (opts.readsLetters) {
      if ("constraintFlags" in kept)
        kept.constraintFlags = flagsWithoutFigures(kept.constraintFlags);
      return { ...(kept as Partial<T>), amountsWithheld: true as const };
    }
    for (const key of LETTER_PROSE_KEYS) delete kept[key];
    return {
      ...(kept as Partial<T>),
      amountsWithheld: true as const,
      wordsWithheld: true as const,
    };
  });
}

/**
 * The open deal proposal on an order as this role may read it (F-981). The
 * proposal is the vendor's offer: the proposed and final price, the agreement
 * terms, the quoted sentence and the summary all name the house's money. A
 * non-holder gets only the keys below (an allowlist, as `orderForRole`), and
 * the reply says `amountsWithheld: true`. The delivery estimate stays: the
 * /orders sheet reads it, and a date says nothing about the price.
 */
const DEAL_KEYS_FOR_EVERY_ROLE = [
  "orderId",
  "conversationId",
  "providerName",
  "wineName",
  "quantity",
  "deliveryEstimate",
  "dealKind",
  "urgency",
  "confidence",
  "timestamp",
  "trust",
] as const;

export function dealProposalForRole(
  proposal: Record<string, any> | null,
  role: string | null | undefined,
): (Record<string, any> & { amountsWithheld?: true }) | null {
  if (proposal === null || holdsHouseMoney(role)) return proposal;
  const kept: Record<string, any> = {};
  for (const key of DEAL_KEYS_FOR_EVERY_ROLE) {
    if (key in proposal) kept[key] = proposal[key];
  }
  return { ...kept, amountsWithheld: true };
}
