/**
 * `GET /house/counter` — what waits on the person who is signed in, one read,
 * each register answering for itself (sketch 119 direction D, the founder's
 * pick of 2026-09-21).
 *
 * THE ONE RULE THIS SHAPE EXISTS TO KEEP
 * --------------------------------------
 * A register that could not be read is never a zero. Each register carries its
 * own outcome — answered (with a count and the first rows), refused for this
 * role (in words), or unreadable (a failure, named) — so a client can print
 * "5 of 7 registers · 2 not read" and never sum across a failure. There is no
 * top-level total on purpose: a sum of acts over registers that did not all
 * answer is exactly the absence-reported-as-health shape the counter refuses.
 *
 * WHY ONE REGISTER PER READ, NOT ONE PER VERB
 * -------------------------------------------
 * The sketch grouped Verify's two reads (door counts, promised credits) and
 * Decide's two (identities, invitations) under one heading each. A heading over
 * two reads cannot answer for itself when one read fails and the other lands,
 * so the outcome lives on the READ and the verb is only the grouping the page
 * draws. Seven reads, seven outcomes, for every role — a role changes an
 * outcome (refused), never the denominator.
 *
 * WHAT IS NOT HERE
 * ----------------
 * The market / Judge register. The founder's pick (2026-09-21): it appears only
 * once its register exists — no 501 placeholder row and no placeholder route.
 */

export type CounterVerb = "seal" | "verify" | "reply" | "decide" | "proposed";

export type CounterRegisterKey =
  | "orders"
  | "deliveries"
  | "credits"
  | "threads"
  | "identities"
  | "invitations"
  | "proposals";

/** The order the counter draws, and the order the response carries. */
export const COUNTER_REGISTERS: ReadonlyArray<{
  key: CounterRegisterKey;
  verb: CounterVerb;
}> = [
  { key: "orders", verb: "seal" },
  { key: "deliveries", verb: "verify" },
  { key: "credits", verb: "verify" },
  { key: "threads", verb: "reply" },
  { key: "identities", verb: "decide" },
  { key: "invitations", verb: "decide" },
  { key: "proposals", verb: "proposed" },
];

/**
 * Whose act it is, for a register that answered.
 *
 *   yours      — this role may take the act the rows ask for.
 *   not_yours  — this role may READ the register (the gateway hands it to
 *                them) but the act belongs to an owner or a manager. The rows
 *                are the house's count, not this person's to-do.
 */
export type CounterAct = "yours" | "not_yours";

export interface CounterOrderRow {
  id: string;
  orderNumber: string | null;
  vendor: string | null;
  wine: string | null;
  quantity: number | null;
  unitType: string | null;
  /** The order's own total. Never a unit price standing in for it. */
  total: number | null;
  status: string;
  requestedAt: string | null;
}

export interface CounterDeliveryRow {
  orderId: string;
  orderNumber: string | null;
  countedQtyBottles: number;
  countedAt: string;
  ageHours: number;
  severity: "fresh" | "stale" | "overdue";
}

export interface CounterCreditRow {
  id: string;
  vendor: string | null;
  reason: string;
  summary: string | null;
  /** Claimed, and promised by the vendor — NOT recovered money. */
  promisedAmount: number;
  currency: string | null;
  promisedAt: string | null;
}

export interface CounterThreadRow {
  id: string;
  vendor: string | null;
  orderNumber: string | null;
  channel: string | null;
  intent: string | null;
  aiGenerated: boolean;
  createdAt: string | null;
}

export interface CounterIdentityRow {
  id: string;
  subject: string | null;
  method: string | null;
  confidence: number | null;
  createdAt: string | null;
}

export interface CounterInvitationRow {
  id: string;
  role: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

export interface CounterProposalRow {
  id: string;
  summary: string | null;
  family: string | null;
  actionType: string | null;
  utterance: string | null;
  createdAt: string | null;
}

export type CounterRow =
  | CounterOrderRow
  | CounterDeliveryRow
  | CounterCreditRow
  | CounterThreadRow
  | CounterIdentityRow
  | CounterInvitationRow
  | CounterProposalRow;

interface RegisterBase {
  key: CounterRegisterKey;
  verb: CounterVerb;
  /** When THIS register's read finished (or was refused). */
  readAt: string;
  /** How long this register's read took. 0 for a refusal decided from the role. */
  ms: number;
}

export interface CounterRegisterAnswered extends RegisterBase {
  state: "answered";
  /** How many rows the register holds, as read. */
  count: number;
  /**
   * False when the read stopped at its own page size, so `count` is a FLOOR
   * ("at least 50"), never a total.
   */
  complete: boolean;
  /** The first rows, newest or most urgent first as the source orders them. */
  rows: CounterRow[];
  act: CounterAct;
}

export interface CounterRegisterRefused extends RegisterBase {
  state: "refused";
  /** The refusal, in the words a person reads. */
  sentence: string;
}

export interface CounterRegisterUnreadable extends RegisterBase {
  state: "unreadable";
  /** The HTTP status the source answered with, or null for a timeout. */
  status: number | null;
  /**
   * What failed, in words. Never the database's own error text, which is
   * logged on the server and not handed to the client.
   */
  sentence: string;
}

export type CounterRegister =
  | CounterRegisterAnswered
  | CounterRegisterRefused
  | CounterRegisterUnreadable;

export interface HouseCounterResponse {
  /** When the aggregate finished. Each register also carries its own. */
  readAt: string;
  house: {
    id: string;
    /**
     * The house's own currency, for the one register (orders) whose rows do
     * not name one. `unreadable` is not `not_recorded`: one is a fact about
     * the house, the other is a fact about this read.
     */
    currency: {
      state: "recorded" | "not_recorded" | "unreadable";
      code: string | null;
    };
  };
  /** The role IN THIS HOUSE the token carries (ADR 0162), as read. */
  role: string | null;
  registers: CounterRegister[];
}
