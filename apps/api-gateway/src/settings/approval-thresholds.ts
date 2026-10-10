/**
 * Who must approve an order above what amount — the policy, as pure arithmetic.
 *
 * Pure on purpose, and exported, so the ONE place that will eventually enforce
 * it (`procurement.service.ts:1438 approveOrder`) can import the same function
 * the settings register renders. Two implementations of "does this order need an
 * owner" is how a policy page and a policy diverge.
 *
 * ---------------------------------------------------------------------------
 * WHAT EXISTS TODAY, MEASURED BEFORE THIS FILE WAS WRITTEN
 * ---------------------------------------------------------------------------
 * There is no approval policy of any kind in this product. Measured:
 *
 *   * `POST /procurement/orders/:id/approve`
 *     (`procurement.controller.ts:283-301`) is guarded by `JwtAuthGuard` alone
 *     — the class-level guard at `:108`. No role decorator, no role check.
 *   * `ProcurementService.approveOrder` (`procurement.service.ts:1438-1460`)
 *     takes `(restaurantId, orderId, userId)`, writes
 *     `status/approved_at/approved_by`, and never reads a role, an amount, or
 *     a policy row. `procurement_orders.approved_by` records WHO, and nothing
 *     has ever constrained who that could be.
 *   * The web ceremony — `HoldToApprove` on `/orders`
 *     (`apps/web/src/pages/orders/next/LedgerRow.tsx:227-234`) — renders for
 *     every pending row and calls that mutation directly.
 *
 * So the house already has the ceremony and has never had the policy behind it.
 * The founder's phrase for the register was exactly that: *"The hold-to-approve
 * ceremony exists and has no policy behind it — this is the policy."*
 *
 * ---------------------------------------------------------------------------
 * THE FIELD, AND WHAT WAS TAKEN FROM IT
 * ---------------------------------------------------------------------------
 * Restaurant365 models the amount rule as a "Workflow threshold": transactions
 * below the lowest threshold may be approved by anyone with the plain permission
 * and anything above it "must be approved by an approval hierarchy", assigned
 * either to an individual or to a "Workflow Group" whose members may approve
 * "below or equal to the assigned level"
 * (https://docs.restaurant365.com/docs/approvals-in-workflows). Ottimate lists
 * five dimensions — "the number of people needed, certain amount thresholds,
 * vendor-based approvals, role-based approvals, and account-based approvals"
 * (https://ottimate.com/feature/workflows-and-approvals/).
 *
 * This build takes the AMOUNT and the ROLE, and leaves the other three unbuilt
 * rather than half-built:
 *
 *   * **number of approvers** — a chain of two would need a queue, a "current
 *     approver" and a notification per step. `procurement_orders` has one
 *     `approved_by` column.
 *   * **per-vendor** — needs a row per (restaurant, vendor, rule); the register
 *     says so and does not draw a dead control for it.
 *   * **per-account (GL)** — this product has no chart of accounts.
 *
 * And it adds two the field mostly does not, because they matter to a kitchen
 * more than a GL code does: the FIRST order to a vendor (no price history to
 * judge it against) and a PRICE JUMP against what the house last paid.
 */

import {
  agreedPricePerBottleForDoor,
  type StatedPriceUnit,
} from "../procurement/agreed-price";

export type ApprovalRule = "manager_ceiling" | "new_vendor" | "price_jump";

export const APPROVAL_RULES: ApprovalRule[] = [
  "manager_ceiling",
  "new_vendor",
  "price_jump",
];

export type ApproverRole = "owner" | "manager";

export interface ThresholdRow {
  rule: ApprovalRule;
  enabled: boolean;
  /** `manager_ceiling` — money above which the named role must sign. */
  amountLimit: number | null;
  /** `price_jump` — percent above the last price paid. */
  percentLimit: number | null;
  requiredRole: ApproverRole;
  setBy: { userId: string | null; name: string | null } | null;
  updatedAt: string | null;
}

/** What is known about one order at the moment somebody tries to seal it. */
export interface OrderUnderTest {
  /** `procurement_orders.total_cost`. */
  total: number | null;
  /**
   * Whether this house has ever ordered from this vendor before. `null` means
   * the caller could not find out — which must NOT be read as "no", because a
   * rule that fires on an unknown is a rule that fires on a database outage.
   */
  isFirstOrderToVendor: boolean | null;
  /**
   * How far above the last unit price paid for this item, in percent. `null`
   * when there is no prior price — a first purchase has no premium, it has no
   * comparison at all, and the `new_vendor` rule is the one that covers it.
   */
  pricePremiumPct: number | null;
  /**
   * The order's own currency and the currency the house's ceiling is in
   * (`restaurants.currency`; `amount_limit` carries none of its own). When both
   * are stated and differ, the ceiling cannot be tested — there is no exchange
   * rate in this house to convert with — so the rule FIRES rather than passing
   * a GBP 2,400 order under a US$2,500 ceiling unflagged (F-648). Either one
   * unknown keeps the old reading: a legacy order states no currency.
   */
  currency?: string | null;
  ceilingCurrency?: string | null;
  /**
   * Why this order's price could not be set beside the last one, when it could
   * not (another currency, or a keg price against a bottle price). `price_jump`
   * is then UNTESTABLE, never a premium worked out across two units (F-648).
   */
  priceUncomparable?: string | null;
}

/**
 * "The first order to a vendor", in ONE place (F-731). The approve gate, the
 * /orders walk and the /settings retrospective all ask it here, so the hold,
 * the line marked as held and the count beside the rule cannot disagree.
 *
 * An order is first when no order to the same vendor came BEFORE it — earlier
 * `requested_at`, then earlier `created_at`, then the smaller id, so two lines
 * of one cart never both claim to be first. A cancelled or turned-down order
 * never happened as far as the vendor is concerned and does not count. A
 * missing time sorts last, as Postgres sorts ascending.
 *
 * Only the earliest line of a first cart is held: whether every line of a
 * first cart should wait until one is sealed is not decided.
 */
export interface VendorOrderStamp {
  id: string;
  status: string | null;
  requested_at?: string | null;
  created_at?: string | null;
}

const NEVER_PLACED_STATUSES = new Set(["CANCELLED", "REJECTED"]);

function compareTime(a: string | null | undefined, b: string | null | undefined): number {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}

/** Negative when `a` was requested before `b`. */
export function compareVendorOrders(a: VendorOrderStamp, b: VendorOrderStamp): number {
  return (
    compareTime(a.requested_at, b.requested_at) ||
    compareTime(a.created_at, b.created_at) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Whether this order counts as one the house placed with the vendor. */
export function countsAsPlacedWithVendor(status: string | null | undefined): boolean {
  return !NEVER_PLACED_STATUSES.has((status ?? "").toUpperCase());
}

/**
 * Whether `self` is the first order to its vendor among `sameVendor` (any
 * order, self included or not). `complete: false` says `sameVendor` may be
 * cut short: then an answer that rests on what was NOT seen is `null`.
 */
export function isFirstOrderToVendorAmong(
  self: VendorOrderStamp,
  sameVendor: VendorOrderStamp[],
  complete = true,
): boolean | null {
  let sawSelf = false;
  for (const o of sameVendor) {
    if (o.id === self.id) {
      sawSelf = true;
      continue;
    }
    if (countsAsPlacedWithVendor(o.status) && compareVendorOrders(o, self) < 0) {
      return false;
    }
  }
  return complete || sawSelf ? true : null;
}

/**
 * The same answer for every order in a ledger at once, by id. `null` for an
 * order with no vendor.
 */
export function firstOrderToVendorById(
  rows: Array<VendorOrderStamp & { provider_id: string | null }>,
): Map<string, boolean | null> {
  const out = new Map<string, boolean | null>();
  const seen = new Set<string>();
  for (const r of [...rows].sort(compareVendorOrders)) {
    const vendor = r.provider_id;
    out.set(r.id, vendor ? !seen.has(vendor) : null);
    if (vendor && countsAsPlacedWithVendor(r.status)) seen.add(vendor);
  }
  return out;
}

/** One order's agreed price, as far as the `price_jump` rule needs it. */
export interface PricedOrder {
  /** `procurement_orders.final_price`, in the unit `priceUnit` names. */
  price: number | null;
  currency: string | null;
  /** The order line's stated price unit (`foldOrderPriceUnit`), or null. */
  priceUnit: StatedPriceUnit | null;
}

/**
 * How far this order's price sits above the last one, PER BOTTLE and in ONE
 * currency — or why the two cannot be compared.
 *
 * Since ADR 0119 `final_price` is stated in the line's own price unit, so the
 * raw division read "$420 per case of 12" last month against "$38 per bottle"
 * today as -91%, and the reverse pair as +1,000% (F-648). Both prices go
 * through the one per-bottle conversion the receiving door already uses; an
 * order with no stated unit keeps the historical per-bottle reading.
 */
export function pricePremium(
  current: PricedOrder,
  prior: PricedOrder | null,
): { pct: number | null; uncomparable: string | null } {
  const none = { pct: null, uncomparable: null };
  if (!prior || current.price === null || current.price <= 0) return none;
  if (prior.price === null || prior.price <= 0) return none;
  if (current.currency && prior.currency && current.currency !== prior.currency) {
    return {
      pct: null,
      uncomparable: `the last price was in ${prior.currency} and this one is in ${current.currency}`,
    };
  }
  const now = agreedPricePerBottleForDoor({
    price: current.price,
    stated: current.priceUnit,
  });
  const before = agreedPricePerBottleForDoor({
    price: prior.price,
    stated: prior.priceUnit,
  });
  if (!now.ok) return { pct: null, uncomparable: now.reason };
  if (!before.ok) return { pct: null, uncomparable: before.reason };
  if (before.perBottle <= 0) return none;
  return {
    pct: ((now.perBottle - before.perBottle) / before.perBottle) * 100,
    uncomparable: null,
  };
}

export interface ApprovalDecision {
  /**
   * The role that must sign. `null` means no rule fired, which is NOT the same
   * as "anyone may seal it": with no policy set at all, `policySet` is false and
   * the caller has to decide what to do about that rather than read a null as
   * permission.
   */
  requiredRole: ApproverRole | null;
  /** Which rules fired, in the order they were tested. */
  firedBy: ApprovalRule[];
  /** One sentence per fired rule, for the person who is now waiting. */
  reasons: string[];
  /** False when this house has recorded no policy whatsoever. */
  policySet: boolean;
  /**
   * Rules that could not be tested because the fact they need was unknown.
   * Surfaced rather than silently skipped: "we could not tell whether this was
   * a first order" is a different outcome from "it was not".
   */
  untestable: ApprovalRule[];
}

/** `owner` outranks `manager`; anything else is not an approver role. */
function strongest(a: ApproverRole | null, b: ApproverRole | null): ApproverRole | null {
  if (a === "owner" || b === "owner") return "owner";
  if (a === "manager" || b === "manager") return "manager";
  return null;
}

/**
 * Decide what one order needs.
 *
 * Every enabled rule is tested and the STRONGEST required role wins — not the
 * first match. A first order to a new vendor that is also over the ceiling must
 * not get the weaker of the two answers because of the order the rules happen
 * to sit in.
 */
export function decideApproval(
  policy: ThresholdRow[],
  order: OrderUnderTest,
): ApprovalDecision {
  const enabled = policy.filter((p) => p.enabled);
  const decision: ApprovalDecision = {
    requiredRole: null,
    firedBy: [],
    reasons: [],
    policySet: policy.length > 0,
    untestable: [],
  };

  for (const rule of APPROVAL_RULES) {
    const row = enabled.find((p) => p.rule === rule);
    if (!row) continue;

    if (rule === "manager_ceiling") {
      if (row.amountLimit === null) continue;
      if (order.total === null) {
        decision.untestable.push(rule);
        continue;
      }
      if (
        order.currency &&
        order.ceilingCurrency &&
        order.currency !== order.ceilingCurrency
      ) {
        decision.requiredRole = strongest(decision.requiredRole, row.requiredRole);
        decision.firedBy.push(rule);
        decision.reasons.push(
          `in ${order.currency}, while the ${row.amountLimit} ceiling this house set for a manager is in ${order.ceilingCurrency}, and no exchange rate is kept here to compare the two`,
        );
        continue;
      }
      if (order.total > row.amountLimit) {
        decision.requiredRole = strongest(decision.requiredRole, row.requiredRole);
        decision.firedBy.push(rule);
        decision.reasons.push(
          `over the ${row.amountLimit} ceiling this house set for a manager`,
        );
      }
      continue;
    }

    if (rule === "new_vendor") {
      if (order.isFirstOrderToVendor === null) {
        decision.untestable.push(rule);
        continue;
      }
      if (order.isFirstOrderToVendor) {
        decision.requiredRole = strongest(decision.requiredRole, row.requiredRole);
        decision.firedBy.push(rule);
        decision.reasons.push(
          "the first order this house has placed with this vendor, so there is no price history to judge it against",
        );
      }
      continue;
    }

    // price_jump
    if (row.percentLimit === null) continue;
    if (order.priceUncomparable) {
      decision.untestable.push(rule);
      continue;
    }
    if (order.pricePremiumPct === null) {
      // No prior price is not an untestable rule — it is a rule that correctly
      // does not apply. `new_vendor` is the one that covers a first purchase.
      continue;
    }
    if (order.pricePremiumPct > row.percentLimit) {
      decision.requiredRole = strongest(decision.requiredRole, row.requiredRole);
      decision.firedBy.push(rule);
      decision.reasons.push(
        `${order.pricePremiumPct.toFixed(1)}% above the last price this house paid, over the ${row.percentLimit}% the house allows`,
      );
    }
  }

  return decision;
}

/**
 * How often each rule WOULD have fired over orders already in the books.
 *
 * The register renders this beside every threshold, and it is the difference
 * between a policy somebody guessed at and a policy somebody chose: "23 of the
 * last 118 orders would have waited for an owner" is a fact about this house,
 * and the same threshold means something completely different in a house that
 * places four orders a month.
 *
 * The counts are honest about their own window — a "first order" is only first
 * among the orders this window could see — and the caller states that beside
 * the number.
 */
export interface RetrospectiveCount {
  rule: ApprovalRule;
  /** Orders that could be tested against this rule at all. */
  tested: number;
  /** Of those, the ones that would have needed the named role. */
  wouldHaveFired: number;
}

export function retrospective(
  policy: ThresholdRow[],
  orders: OrderUnderTest[],
): RetrospectiveCount[] {
  return APPROVAL_RULES.map((rule) => {
    const row = policy.find((p) => p.rule === rule);
    if (!row) return { rule, tested: 0, wouldHaveFired: 0 };
    let tested = 0;
    let fired = 0;
    for (const o of orders) {
      const one = decideApproval([{ ...row, enabled: true }], o);
      if (one.untestable.includes(rule)) continue;
      if (rule === "price_jump" && o.pricePremiumPct === null) continue;
      if (rule === "manager_ceiling" && row.amountLimit === null) continue;
      tested += 1;
      if (one.firedBy.includes(rule)) fired += 1;
    }
    return { rule, tested, wouldHaveFired: fired };
  });
}
