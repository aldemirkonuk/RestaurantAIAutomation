/**
 * Which orders in "Waiting on you" are flagged, and the order the queue is in
 * (ADR 0256, founder 2026-10-01).
 *
 * THE RULINGS, VERBATIM
 *   order:     "oldest first, flag priority ones"
 *   flags:     "focus on this, money issue, order approval, large amount of
 *               order, item running out"
 *   mapping:   "Yes, use the house rules (Recommended)" — no new settings
 *   placement: "Flagged first, then oldest (Recommended)"
 *
 * NO SECOND DEFINITION. Every reason is an answer the house already computes
 * somewhere else, called here rather than restated:
 *
 *   price_jump       `decideApproval` fired the house's `price_jump` rule, over
 *                    the SAME facts the approve gate builds
 *                    (`ProcurementService.orderUnderTest`). "Money issue."
 *   manager_ceiling  `decideApproval` fired the house's `manager_ceiling` rule.
 *                    "Large amount of order."
 *   needs_signature  the row is parked `APPROVAL_NEEDED`, or any house rule
 *                    fired (`decideApproval(...).firedBy` is not empty), so a
 *                    named role must sign. "Order approval."
 *   running_out      the item is out of stock, or below its minimum by
 *                    `isBelowPar` (`common/stock-status.ts`, the predicate the
 *                    /inventory chip and the low-stock alerts share).
 *                    "Item running out."
 *
 * A disabled rule raises nothing, because `decideApproval` tests enabled rules
 * only. A reason is a WORD: no amount, percent or count travels with it, so the
 * flag holds for a viewer who is not shown money.
 *
 * UNKNOWN IS NOT "NOT FLAGGED". A check that could not be made — the rules
 * could not be read, the last price could not be read, the order has no total,
 * the item's stock was not read — goes into `unknown`, never into silence
 * (`absence-reported-as-health`). `flagged` is true only when a reason was
 * FOUND; an order with only unknowns sorts with the unflagged ones and carries
 * its unknowns for the screen to say. The list itself is never failed over a
 * flag it could not compute: the queue is still the queue.
 *
 * Pure on purpose, so the spec can drive every branch without a database.
 */

import {
  decideApproval,
  type OrderUnderTest,
  type ThresholdRow,
} from "../settings/approval-thresholds";
import { isBelowPar } from "../common/stock-status";

/** Why a waiting order is flagged. A word each, in the founder's order. */
export type PendingFlagReason =
  | "price_jump"
  | "needs_signature"
  | "manager_ceiling"
  | "running_out";

export const PENDING_FLAG_REASONS: readonly PendingFlagReason[] = [
  "price_jump",
  "needs_signature",
  "manager_ceiling",
  "running_out",
];

export interface PendingOrderPriority {
  /** True when at least one reason was FOUND. Never true on an unknown alone. */
  flagged: boolean;
  /** The reasons found, in `PENDING_FLAG_REASONS` order. */
  reasons: PendingFlagReason[];
  /** The checks that could not be made, in the same order. */
  unknown: PendingFlagReason[];
}

/** The item's stock as the order read joined it; `null` = not read. */
export interface PendingOrderStock {
  stockLive: number | string | null | undefined;
  parLevel: number | string | null | undefined;
}

export interface PendingOrderFacts {
  /** The row is parked in `APPROVAL_NEEDED` (the gate refused a seal on it). */
  parked: boolean;
  /**
   * The house's rules as `ApprovalThresholdsService.read` returned them.
   * `null` when they could not be read — NOT an empty policy.
   */
  policy: ThresholdRow[] | null;
  /** The approve gate's own facts for this order (`orderUnderTest`). */
  test: OrderUnderTest | null;
  /**
   * The last-price read behind `price_jump` failed. Distinct from "there is no
   * earlier price", which correctly raises nothing.
   */
  priceUnread: boolean;
  stock: PendingOrderStock | null;
}

/** Is this rule switched on for the house? */
function enabled(policy: ThresholdRow[], rule: ThresholdRow["rule"]): boolean {
  return policy.some((p) => p.rule === rule && p.enabled);
}

/** Out of stock, or below its minimum. `null` when the stock was not read. */
export function itemRunningOut(
  stock: PendingOrderStock | null,
): boolean | null {
  if (!stock) return null;
  const { stockLive, parLevel } = stock;
  if (stockLive === null || stockLive === undefined || stockLive === "") {
    return null;
  }
  const live = Number(stockLive);
  if (!Number.isFinite(live)) return null;
  // Out of stock needs no minimum: an empty shelf is running out whether or
  // not the house ever set a par for it.
  if (live <= 0) return true;
  // A house that set no minimum (par missing or 0) has nothing to be below;
  // `isBelowPar` answers false there, which is the true answer, not a guess.
  return isBelowPar(
    live,
    parLevel === "" || parLevel == null ? null : Number(parLevel),
  );
}

export function pendingOrderPriority(
  facts: PendingOrderFacts,
): PendingOrderPriority {
  const reasons = new Set<PendingFlagReason>();
  const unknown = new Set<PendingFlagReason>();

  if (facts.parked) reasons.add("needs_signature");

  if (facts.policy === null || facts.test === null) {
    unknown.add("price_jump");
    unknown.add("needs_signature");
    unknown.add("manager_ceiling");
  } else {
    const decision = decideApproval(facts.policy, facts.test);

    if (decision.firedBy.includes("price_jump")) {
      reasons.add("price_jump");
    } else if (facts.priceUnread && enabled(facts.policy, "price_jump")) {
      unknown.add("price_jump");
    }

    if (decision.firedBy.includes("manager_ceiling")) {
      reasons.add("manager_ceiling");
    } else if (decision.untestable.includes("manager_ceiling")) {
      unknown.add("manager_ceiling");
    }

    if (decision.firedBy.length > 0) {
      reasons.add("needs_signature");
    } else if (decision.untestable.length > 0 || unknown.has("price_jump")) {
      // A rule that could not be tested might have fired.
      unknown.add("needs_signature");
    }
  }

  const running = itemRunningOut(facts.stock);
  if (running === true) reasons.add("running_out");
  else if (running === null) unknown.add("running_out");

  const found = PENDING_FLAG_REASONS.filter((r) => reasons.has(r));
  // A reason already found is not also unknown (a parked row needs a signature
  // whether or not the rules could be read).
  const unchecked = PENDING_FLAG_REASONS.filter(
    (r) => unknown.has(r) && !reasons.has(r),
  );
  return { flagged: found.length > 0, reasons: found, unknown: unchecked };
}

/**
 * Flagged first, then the rest — each group in the order it arrived, which the
 * read makes oldest first (`created_at` ascending). Stable: `Array.prototype.sort`
 * is stable, and the comparator never reorders two rows of the same group.
 */
export function flaggedFirst<T extends { priority?: PendingOrderPriority }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(Boolean(b.priority?.flagged)) -
      Number(Boolean(a.priority?.flagged)),
  );
}
