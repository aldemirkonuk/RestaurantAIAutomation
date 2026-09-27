/**
 * Whose failure a cancellation was (ADR 0207, round 4).
 *
 * THE FOUNDER, 2026-09-22, round 6y: *"if. cancelde make sure the all
 * analytcis be configured toward that, canel is enough or not?"* (verbatim).
 * The answer (ADR 0207 §C0): not as built — a cancel erased the vendor's
 * failure and every analytic dropped a cancelled order, so a vendor that
 * never delivered scored exactly like one never asked. This file is the pure
 * rule that fixes it: which category a cancellation may carry, from which
 * states, and whether it counts against the vendor.
 *
 * Pure: no database, no clock read directly (the caller supplies `nowMs`), so
 * the rule is tested on its own and read identically by the gateway's write
 * path and the analytics read.
 */

import { Deadline, isPastDue } from "./delivery-deadline";
import { ProcurementOrderStatus } from "./dto/procurement.dto";

export const CANCEL_REASON_CODES = [
  "never_arrived",
  "vendor_cannot_supply",
  "house_decision",
] as const;

export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

export function isCancelReasonCode(v: unknown): v is CancelReasonCode {
  return (
    typeof v === "string" &&
    (CANCEL_REASON_CODES as readonly string[]).includes(v)
  );
}

/** States a `never_arrived` or `vendor_cannot_supply` cancel may come from. */
const NEVER_ARRIVED_FROM: readonly ProcurementOrderStatus[] = [
  ProcurementOrderStatus.CONFIRMED,
  ProcurementOrderStatus.IN_TRANSIT,
];
const VENDOR_CANNOT_SUPPLY_FROM: readonly ProcurementOrderStatus[] = [
  ProcurementOrderStatus.NEGOTIATING,
  ProcurementOrderStatus.APPROVED,
  ProcurementOrderStatus.CONFIRMED,
  ProcurementOrderStatus.IN_TRANSIT,
];

export type CancelReasonRefusal =
  | { ok: false; reason: "unknown_code" }
  | { ok: false; reason: "never_arrived_wrong_state" }
  | { ok: false; reason: "never_arrived_not_past_due" }
  | { ok: false; reason: "vendor_cannot_supply_wrong_state" };

export type CancelReasonVerdict = { ok: true } | CancelReasonRefusal;

/**
 * Whether THIS cancellation (its category, the order's current state, its
 * deadline if any, and the moment) is allowed. `house_decision` is allowed
 * from any state a cancellation is legal from at all (order-transitions.ts
 * already refuses a cancel of a DELIVERED/COMPLETED/already-CANCELLED order
 * before this rule ever runs, so this function does not re-check that floor).
 */
export function verdictFor(
  code: string,
  fromStatus: ProcurementOrderStatus,
  deadline: Deadline | null,
  nowMs: number,
): CancelReasonVerdict {
  if (!isCancelReasonCode(code)) return { ok: false, reason: "unknown_code" };
  if (code === "house_decision") return { ok: true };
  if (code === "vendor_cannot_supply") {
    return VENDOR_CANNOT_SUPPLY_FROM.includes(fromStatus)
      ? { ok: true }
      : { ok: false, reason: "vendor_cannot_supply_wrong_state" };
  }
  // never_arrived
  if (!NEVER_ARRIVED_FROM.includes(fromStatus))
    return { ok: false, reason: "never_arrived_wrong_state" };
  // With no expected date at all there is no deadline to have passed, so the
  // category cannot be proven — the gateway's caller falls back to asking for
  // a different category rather than guessing one.
  if (!deadline) return { ok: false, reason: "never_arrived_not_past_due" };
  return isPastDue(nowMs, deadline)
    ? { ok: true }
    : { ok: false, reason: "never_arrived_not_past_due" };
}

export const CANCEL_REASON_REFUSAL_WORDS: Record<
  CancelReasonRefusal["reason"],
  string
> = {
  unknown_code:
    "Say why this order is being cancelled: it never arrived, the vendor could not supply it, or it is the house's own decision. Nothing was changed.",
  never_arrived_wrong_state:
    "\"It never arrived\" is for an order placed with the vendor (confirmed or in transit) that has not landed. This order is not in that state, so this category does not fit it. Nothing was changed.",
  never_arrived_not_past_due:
    "This order's expected delivery has not passed yet (or it has no expected date on record), so it cannot be marked \"never arrived\" — that would count against the vendor before it is due. Pick a different category, or wait until it is past due. Nothing was changed.",
  vendor_cannot_supply_wrong_state:
    "\"The vendor could not supply it\" is for an order still being negotiated, approved, confirmed or in transit. This order is not in that state. Nothing was changed.",
};
