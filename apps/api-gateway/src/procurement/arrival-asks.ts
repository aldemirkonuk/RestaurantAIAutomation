/**
 * "Did it arrive?" — the typed act, and who is asked (ADR 0207, round 3).
 *
 * The founder delegated the rule (2026-09-21, "think of a best way to handle
 * this ... You tell me"); the rule itself is `overdue-order.ts`. This file is
 * the shape the receiving surface (and, when it lands, the shell's counter)
 * reads, and the one audience rule.
 *
 * WHO IS ASKED: the people of the house's receiving area; otherwise its owners
 * and managers. Owners and managers may always answer — an area changes who is
 * ASKED first, never what an owner can do (ADR 0218's rule, on its branch). The
 * areas model is NOT on this branch's main (`feat/house-areas`, PR #441, ADR
 * 0218), so the service passes no receiving area today and the act reaches
 * owners and managers only. When areas merges, the service reads the members
 * of the house's `receiving` area and passes them here; nothing else changes.
 *
 * THE THREE CHOICES, each an act that already has its own record:
 *   receive   opens the receiving door for the order — the receipt is the record;
 *   not_yet   `POST /procurement/orders/:id/arrival-answers` — a row in
 *             `procurement_order_arrival_answers`, for this expected date;
 *   cancel    the sealed cancellation — `POST orders/:id/cancel-seal-challenge`,
 *             then `DELETE orders/:id` with the seal, a reason and
 *             `reasonCode=never_arrived` (ADR 0207 round 4).
 */

import type { OverdueStanding } from "./overdue-order";

export type AnswerRole = "owner" | "manager" | string | null;

/**
 * May this person answer "Did it arrive?" for this house? Owners and managers
 * always; anyone else only as a member of the house's receiving area.
 */
export function mayAnswerArrival(
  role: AnswerRole,
  userId: string,
  receivingAreaMembers: readonly string[] | null,
): boolean {
  if (role === "owner" || role === "manager") return true;
  if (!receivingAreaMembers || !userId) return false;
  return receivingAreaMembers.includes(userId);
}

export type ArrivalChoice =
  | { key: "receive"; label: "Yes — receive it"; route: string }
  | {
      key: "not_yet";
      label: "Not yet";
      method: "POST";
      endpoint: string;
    }
  | {
      key: "cancel";
      label: "Cancel";
      sealEndpoint: string;
      method: "DELETE";
      endpoint: string;
      /**
       * ADR 0207 round 4 — the category this cancel carries (`reasonCode`
       * query parameter on `DELETE orders/:id`, beside `reason`). An ask is
       * raised only for a CONFIRMED/IN_TRANSIT order past its deadline, so it
       * is always `never_arrived`; the gateway refuses a cancel without one.
       */
      reasonCode: "never_arrived";
    };

export interface ArrivalAsk {
  kind: "did_it_arrive";
  orderId: string;
  orderNumber: string | null;
  providerId: string | null;
  providerName: string | null;
  /** The expected date as recorded, `YYYY-MM-DD`. */
  expectedDate: string;
  /** Whole days past the deadline. */
  daysPast: number;
  /** `unconfirmed` is the question; `confirmed_late` is a "Not yet" still waiting. */
  standing: "unconfirmed" | "confirmed_late";
  /** When the latest "Not yet" was given, for a confirmed order. */
  answeredAt: string | null;
  choices: ArrivalChoice[];
}

export interface IncompleteOrder {
  orderId: string;
  orderNumber: string | null;
  providerId: string | null;
  providerName: string | null;
  expectedDate: string;
  daysPast: number;
  /** Someone said "Not yet" for this date before it went incomplete. */
  confirmed: boolean;
  choices: ArrivalChoice[];
}

export function choicesFor(orderId: string): ArrivalChoice[] {
  const id = encodeURIComponent(orderId);
  return [
    {
      key: "receive",
      label: "Yes — receive it",
      route: `/receiving/${id}/door`,
    },
    {
      key: "not_yet",
      label: "Not yet",
      method: "POST",
      endpoint: `/procurement/orders/${id}/arrival-answers`,
    },
    {
      key: "cancel",
      label: "Cancel",
      sealEndpoint: `/procurement/orders/${id}/cancel-seal-challenge`,
      method: "DELETE",
      endpoint: `/procurement/orders/${id}`,
      reasonCode: "never_arrived",
    },
  ];
}

export interface AskOrderRow {
  id: string;
  order_number: string | null;
  provider_id: string | null;
  expected_delivery_date: string;
}

/** The ask for one order, or null when its standing raises none. */
export function askFor(
  o: AskOrderRow,
  providerName: string | null,
  standing: OverdueStanding | null,
): ArrivalAsk | null {
  if (!standing) return null;
  if (standing.kind !== "unconfirmed" && standing.kind !== "confirmed_late")
    return null;
  return {
    kind: "did_it_arrive",
    orderId: o.id,
    orderNumber: o.order_number,
    providerId: o.provider_id,
    providerName,
    expectedDate: String(o.expected_delivery_date).slice(0, 10),
    daysPast: standing.days,
    standing: standing.kind,
    answeredAt: standing.kind === "confirmed_late" ? standing.answeredAt : null,
    // A "Not yet" already given for this date is not asked for again; the
    // order waits with the other two acts.
    choices: choicesFor(o.id).filter(
      (c) => standing.kind === "unconfirmed" || c.key !== "not_yet",
    ),
  };
}

/** The Incomplete orders register row, or null when the order is not incomplete. */
export function incompleteFor(
  o: AskOrderRow,
  providerName: string | null,
  standing: OverdueStanding | null,
): IncompleteOrder | null {
  if (!standing || standing.kind !== "incomplete") return null;
  return {
    orderId: o.id,
    orderNumber: o.order_number,
    providerId: o.provider_id,
    providerName,
    expectedDate: String(o.expected_delivery_date).slice(0, 10),
    daysPast: standing.days,
    confirmed: standing.confirmed,
    choices: choicesFor(o.id).filter((c) => c.key !== "not_yet"),
  };
}
