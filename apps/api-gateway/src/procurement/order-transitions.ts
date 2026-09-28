/**
 * order-transitions — which state an order may move to from which, and the
 * sentence it is refused with.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * `procurement_orders.status` has twelve members and, until this file, no rule
 * at all about the order they may be written in. Measured 2026-09-05 across
 * every writer of the column (ADR 0125's census):
 *
 *   * `PATCH /procurement/orders/:id` passes `dto.status` straight into the
 *     UPDATE. Any of the twelve, from any of the twelve, for any authenticated
 *     caller.
 *   * `DELETE /procurement/orders/:id` writes CANCELLED from anything —
 *     including DELIVERED and COMPLETED.
 *   * Exactly ONE from-state check existed in the whole service:
 *     `parkOrderAwaitingApproval` moves to APPROVAL_NEEDED only from PENDING.
 *   * Five different hardcoded lists answered "is this order over" with five
 *     different answers (5, 7, 7, 7 and 8 members).
 *
 * The consequence with teeth is not the missing ceremony; it is the money.
 * Cancelling a DELIVERED order reverses nothing — the receipt event stands, the
 * shelf stock stays booked, the ledger movement is not undone — but the row
 * leaves `ORDER_SPEND_STATUSES` and `ORDER_ARRIVED_STATUSES` the instant it
 * reads CANCELLED, so it drops out of every spend total, cashflow figure,
 * bottles-delivered count, lead-time statistic and vendor scorecard in the
 * house. Bottles on the shelf, money out of the books, and nothing anywhere
 * says it happened. That is [[absence-reported-as-health]] reached through the
 * one door that touches money.
 *
 * ===========================================================================
 * WHY A TABLE AND NOT A CHECK AT EACH ROUTE
 * ===========================================================================
 * A check per route is a rule per caller, and this column has eleven writers in
 * three languages. `documents/credit-ledger.ts` already does it the other way
 * for a vendor credit claim — one `TRANSITIONS` record, one `canTransition`,
 * one refusal sentence — and that module is the reason a claim cannot be marked
 * recovered twice. This file is the same shape for the order itself, kept pure
 * (no Nest, no database, no `async`) so every rule below is testable without
 * either.
 *
 * ===========================================================================
 * HOW THE TABLE WAS DERIVED — MEASURED, NOT INVENTED
 * ===========================================================================
 * Every edge below is one an existing writer actually performs, read off the
 * census. The table PERMITS the whole of today's behaviour on purpose: a
 * machine introduced by guessing at the graph does not make a system correct,
 * it makes it broken in a new place. What it FORBIDS is the set the census
 * showed nothing doing and that costs money when it happens anyway:
 *
 *   * out of a closed state (COMPLETED, CANCELLED, REJECTED, FAILED) — nothing
 *     reopens an order today, and a reopened one double-counts;
 *   * to CANCELLED from a state where goods have arrived (DELIVERED,
 *     PARTIALLY_RECEIVED, COMPLETED) — the M14 hole above. Odoo refuses the
 *     same move (`button_cancel` raises when a non-draft vendor bill exists)
 *     and Dynamics 365 states it as the rule: a confirmed PO may be cancelled
 *     "provided that the quantity hasn't been received or invoiced";
 *   * backwards down the delivery chain — a DELIVERED order cannot become
 *     PENDING again.
 *
 * IN_TRANSIT and FAILED are in the table because they are in the enum, and the
 * census found NO writer for either: they are reachable today only through the
 * unguarded PATCH. Their edges are stated rather than left implicit so that a
 * future writer inherits a rule instead of inventing one.
 */
import { ProcurementOrderStatus } from "./dto/procurement.dto";

/**
 * A move to the SAME status is allowed — unless that status is terminal.
 *
 * This is a deliberate departure from `credit-ledger.ts`, which refuses every
 * same-state move with "Already X.". A credit claim is settled once; an order's
 * OPEN states are re-entered legitimately. `verifyReceipt` writes
 * PARTIALLY_RECEIVED again on the second short delivery against the same
 * backorder, and the receiving door writes it on every case counted. Refusing
 * those would break the one path in this house that reconciles a partial
 * delivery, in the name of a rule about state CHANGES.
 *
 * A TERMINAL state is different, and the difference is not decoration: a state
 * you can never leave, you enter once. Cancelling an already-cancelled order
 * changes no status but does overwrite its `rejection_reason` with a second
 * account of why, and files a second `order_cancelled` row naming a second
 * person — so the record of what happened to this order stops being one thing.
 * (Found by this pass's own test, which expected the mint to be refused and
 * watched it succeed.)
 */
export function sameStateIsPermitted(status: ProcurementOrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length > 0;
}

/**
 * The legal moves, keyed by the state being left.
 *
 * Read one row as: "an order in X may be moved to any of these". An empty array
 * is a terminal state.
 */
export const ORDER_TRANSITIONS: Record<
  ProcurementOrderStatus,
  readonly ProcurementOrderStatus[]
> = {
  // Freshly raised. Everything is still open to it.
  [ProcurementOrderStatus.PENDING]: [
    ProcurementOrderStatus.APPROVAL_NEEDED,
    ProcurementOrderStatus.NEGOTIATING,
    ProcurementOrderStatus.APPROVED,
    ProcurementOrderStatus.CANCELLED,
    ProcurementOrderStatus.REJECTED,
    ProcurementOrderStatus.FAILED,
  ],
  // Parked by the approval gate: a rule fired and this actor could not seal it.
  [ProcurementOrderStatus.APPROVAL_NEEDED]: [
    ProcurementOrderStatus.NEGOTIATING,
    ProcurementOrderStatus.APPROVED,
    ProcurementOrderStatus.CANCELLED,
    ProcurementOrderStatus.REJECTED,
    ProcurementOrderStatus.FAILED,
  ],
  // Out with the vendor, no terms agreed.
  [ProcurementOrderStatus.NEGOTIATING]: [
    ProcurementOrderStatus.APPROVAL_NEEDED,
    ProcurementOrderStatus.APPROVED,
    ProcurementOrderStatus.CANCELLED,
    ProcurementOrderStatus.REJECTED,
    ProcurementOrderStatus.FAILED,
  ],
  // Sealed by a person, not yet placed with the vendor. `syncOrderState` moves
  // it to CONFIRMED on a matching vendor receipt; the legacy desk's "Mark as
  // Ordered" does the same by hand; the door can receive against it directly.
  [ProcurementOrderStatus.APPROVED]: [
    ProcurementOrderStatus.NEGOTIATING,
    ProcurementOrderStatus.CONFIRMED,
    ProcurementOrderStatus.IN_TRANSIT,
    ProcurementOrderStatus.DELIVERED,
    ProcurementOrderStatus.PARTIALLY_RECEIVED,
    ProcurementOrderStatus.CANCELLED,
    ProcurementOrderStatus.REJECTED,
    ProcurementOrderStatus.FAILED,
  ],
  // Placed with the vendor. Still cancellable — nothing has arrived.
  [ProcurementOrderStatus.CONFIRMED]: [
    // A vendor may decline an order it has already confirmed — it went short,
    // the vintage is gone, the truck is not coming. That returns the order to
    // NEGOTIATING, never to a terminal state (founder, 2026-09-05, answering
    // ADR 0125 Q3): the house may still buy this wine from this vendor at
    // another price, or from another vendor entirely, and an order marked
    // REJECTED drops out of every open-order list before anyone decides.
    // Dynamics 365 does the same, holding such a PO "In external review".
    ProcurementOrderStatus.NEGOTIATING,
    ProcurementOrderStatus.IN_TRANSIT,
    ProcurementOrderStatus.DELIVERED,
    ProcurementOrderStatus.PARTIALLY_RECEIVED,
    ProcurementOrderStatus.CANCELLED,
    ProcurementOrderStatus.FAILED,
  ],
  [ProcurementOrderStatus.IN_TRANSIT]: [
    ProcurementOrderStatus.DELIVERED,
    ProcurementOrderStatus.PARTIALLY_RECEIVED,
    ProcurementOrderStatus.CANCELLED,
    ProcurementOrderStatus.FAILED,
  ],
  // The truck came. From here the order is a matching problem, not a buying
  // one — and it can no longer be cancelled, because the stock is booked.
  [ProcurementOrderStatus.DELIVERED]: [
    ProcurementOrderStatus.PARTIALLY_RECEIVED,
    ProcurementOrderStatus.COMPLETED,
    ProcurementOrderStatus.FAILED,
  ],
  // Short delivery, remainder open as a backorder. The rest can still arrive.
  [ProcurementOrderStatus.PARTIALLY_RECEIVED]: [
    ProcurementOrderStatus.DELIVERED,
    ProcurementOrderStatus.COMPLETED,
    ProcurementOrderStatus.FAILED,
  ],
  // Closed. Nothing reopens an order in this house today; a reopen is a
  // transition somebody has to decide on, not one a builder may assume.
  [ProcurementOrderStatus.COMPLETED]: [],
  [ProcurementOrderStatus.CANCELLED]: [],
  [ProcurementOrderStatus.REJECTED]: [],
  [ProcurementOrderStatus.FAILED]: [],
};

/** Every status this table treats as final. Derived, never typed twice. */
export const ORDER_TERMINAL_STATUSES: readonly ProcurementOrderStatus[] = (
  Object.keys(ORDER_TRANSITIONS) as ProcurementOrderStatus[]
).filter((s) => ORDER_TRANSITIONS[s].length === 0);

/**
 * The states in which goods have physically arrived, so a cancellation would
 * remove money from the books that the shelf still holds.
 *
 * Not the same question as `ORDER_CLOSED_STATUSES` in `order-status.ts`, which
 * asks whether an order is still actionable. Kept here, beside the rule it
 * justifies, rather than added there as a sixth list nobody can tell apart.
 */
export const ORDER_GOODS_ARRIVED_STATUSES: readonly ProcurementOrderStatus[] = [
  ProcurementOrderStatus.DELIVERED,
  ProcurementOrderStatus.PARTIALLY_RECEIVED,
  ProcurementOrderStatus.COMPLETED,
];

/** Parse a stored value into a member, or `null`. Never guesses. */
export function readOrderStatus(
  value: unknown,
): ProcurementOrderStatus | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (Object.values(ProcurementOrderStatus) as string[]).includes(upper)
    ? (upper as ProcurementOrderStatus)
    : null;
}

export function canTransition(
  from: ProcurementOrderStatus,
  to: ProcurementOrderStatus,
): boolean {
  if (from === to) return sameStateIsPermitted(from);
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * How each status reads to a person. The refusal sentences below are the words
 * an operator sees, so they say "delivered" rather than `DELIVERED`.
 */
export function statusInWords(status: ProcurementOrderStatus): string {
  switch (status) {
    case ProcurementOrderStatus.PENDING:
      return "pending";
    case ProcurementOrderStatus.APPROVAL_NEEDED:
      return "waiting for approval";
    case ProcurementOrderStatus.NEGOTIATING:
      return "in negotiation";
    case ProcurementOrderStatus.APPROVED:
      return "approved";
    case ProcurementOrderStatus.CONFIRMED:
      return "placed with the vendor";
    case ProcurementOrderStatus.IN_TRANSIT:
      return "in transit";
    case ProcurementOrderStatus.DELIVERED:
      return "delivered";
    case ProcurementOrderStatus.PARTIALLY_RECEIVED:
      return "partly received";
    case ProcurementOrderStatus.COMPLETED:
      return "completed";
    case ProcurementOrderStatus.CANCELLED:
      return "cancelled";
    case ProcurementOrderStatus.REJECTED:
      return "rejected";
    case ProcurementOrderStatus.FAILED:
      return "failed";
  }
}

/**
 * The whole sentence a refused transition is refused with.
 *
 * One function, so the 422 body, the audit row and the page all say the same
 * thing about the same event. Each sentence names the state being left, the
 * state asked for, and — this is the part that stops a person mashing the
 * control — WHY the house will not do it and what to do instead. "Invalid
 * transition" is the message that teaches an operator to try again harder.
 */
export function refuseTransition(
  from: ProcurementOrderStatus,
  to: ProcurementOrderStatus,
): string {
  const leaving = statusInWords(from);
  const asked = statusInWords(to);

  // The money case first: it is the one with a consequence a person cannot see.
  if (
    to === ProcurementOrderStatus.CANCELLED &&
    ORDER_GOODS_ARRIVED_STATUSES.includes(from)
  ) {
    return (
      `This order is ${leaving}, so it cannot be cancelled. The wine has been ` +
      `counted into stock and its cost is in the books; cancelling would take ` +
      `the money out of every spend and delivery figure while the bottles stay ` +
      `on the shelf. Nothing was changed. Raise a vendor credit against the ` +
      `delivery instead, or correct the count at the receiving door.`
    );
  }

  if (ORDER_TERMINAL_STATUSES.includes(from)) {
    return (
      `This order is already ${leaving}, and a closed order is not reopened in ` +
      `this house — a second life for the same order would let its money be ` +
      `counted twice. Nothing was changed. Raise a new order if this one has to ` +
      `happen again.`
    );
  }

  return (
    `An order that is ${leaving} cannot be moved to ${asked}. Nothing was ` +
    `changed. If that is genuinely the next step for this order, it is a ` +
    `transition this house has not agreed to yet, and it has to be agreed ` +
    `rather than written.`
  );
}

/** What `assertTransition` reports when the CURRENT status could not be read. */
export function refuseUnreadableStatus(
  to: ProcurementOrderStatus,
  raw: unknown,
): string {
  const shown =
    raw === null || raw === undefined || raw === ""
      ? "nothing at all"
      : `"${String(raw)}"`;
  return (
    `This order's current state reads ${shown}, which is not a state this ` +
    `house recognises, so whether it may become ${statusInWords(to)} cannot be ` +
    `decided. Nothing was changed. An unreadable state is refused rather than ` +
    `treated as permission.`
  );
}

export interface TransitionVerdict {
  allowed: boolean;
  /** Present exactly when `allowed` is false. */
  sentence?: string;
  /** The parsed current state, when it could be read at all. */
  from?: ProcurementOrderStatus;
}

/**
 * Decide one move, from a raw stored value.
 *
 * An unreadable current state is a REFUSAL, never a pass. A guard that cannot
 * see the state it is guarding has not established that the move is safe; it
 * has established nothing, and letting the write through on nothing is the
 * fault this module was written against.
 */
export function decideTransition(
  rawCurrent: unknown,
  to: ProcurementOrderStatus,
): TransitionVerdict {
  const from = readOrderStatus(rawCurrent);
  if (from === null) {
    return { allowed: false, sentence: refuseUnreadableStatus(to, rawCurrent) };
  }
  if (canTransition(from, to)) return { allowed: true, from };
  return { allowed: false, sentence: refuseTransition(from, to), from };
}

/* ── The same table, for the database ─────────────────────────────────────── */

/**
 * THE EDGE LIST, RENDERED. This is the ONE definition; the migration's copy is
 * generated from it and a spec plus `scripts/check_order_transition_sql.py`
 * assert the two are identical (founder, 2026-09-05, answering ADR 0125 Q2:
 * *"Enforce the table as a database trigger"* — with the standing condition
 * that the TypeScript table and the SQL table must be one definition).
 *
 * WHY THE DATABASE NEEDS ITS OWN COPY AT ALL
 * ------------------------------------------
 * `services/agent-orchestrator/agents/procurement_agent.py` writes terminal
 * statuses straight to Supabase, bypassing the gateway entirely. No service
 * check reaches it. A `BEFORE UPDATE OF status` trigger reaches every writer in
 * every language, including a hand at the SQL console.
 *
 * WHAT THE SQL COPY DELIBERATELY DOES **NOT** CARRY
 * -------------------------------------------------
 * The same-state rule. `sameStateIsPermitted` refuses re-entering a TERMINAL
 * state — cancelling an already-cancelled order overwrites its reason and files
 * a second audit row naming a second person. Postgres cannot see that: an
 * `UPDATE ... SET status = 'CANCELLED'` on a row already CANCELLED and an
 * `UPDATE` that never mentions `status` are the same event to a trigger, and
 * refusing it would forbid editing the notes on a cancelled order. So the
 * trigger returns early on a same-state write, and the terminal re-entry rule
 * stays where it can be judged: in the service.
 *
 * The equality the spec and the guard enforce is therefore over the EDGES —
 * `from != to` — which is the part that must never drift.
 */
export function orderTransitionEdges(): string[] {
  const out: string[] = [];
  for (const from of Object.keys(ORDER_TRANSITIONS) as ProcurementOrderStatus[]) {
    for (const to of ORDER_TRANSITIONS[from]) out.push(`${from}>${to}`);
  }
  return out.sort();
}

/** Every member, so the trigger can refuse a state it does not recognise. */
export function orderStatusVocabulary(): string[] {
  return (Object.keys(ORDER_TRANSITIONS) as string[]).slice().sort();
}

/** The two `ARRAY[...]` literals the migration carries, rendered exactly as it carries them. */
export function renderOrderTransitionSqlArrays(): {
  edges: string;
  vocabulary: string;
} {
  const lit = (values: string[], indent: string) =>
    `ARRAY[\n${values.map((v) => `${indent}'${v}'`).join(",\n")}\n${indent.slice(2)}]`;
  return {
    edges: lit(orderTransitionEdges(), "      "),
    vocabulary: lit(orderStatusVocabulary(), "      "),
  };
}
