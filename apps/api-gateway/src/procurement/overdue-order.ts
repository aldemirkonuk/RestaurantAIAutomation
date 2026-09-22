/**
 * An order past its expected date that has not arrived: first ASKED, then
 * counted (ADR 0207, the founder's delegation of 2026-09-21 — "think of a best
 * way to handle this ... You tell me").
 *
 * THE RULE, IN ONE PLACE
 * ----------------------
 * The founder's earlier ruling (question 8, "count it as late") counted every
 * order still out with the vendor past its deadline as late the moment the
 * deadline passed. That read a delivery nobody had booked in yet — the truck
 * came, the paper is on the counter, the door has not been worked — as the
 * vendor's failure. So the house is asked first:
 *
 *   not_due         the deadline has not passed. Nothing to ask.
 *   unconfirmed     past its deadline, not received, and nobody here has said
 *                   whether it arrived. The "Did it arrive?" act is raised
 *                   (Yes — receive it / Not yet / Cancel). NOT counted: it is
 *                   listed as "unconfirmed, not counted".
 *   confirmed_late  someone here answered "Not yet" for this expected date.
 *                   Counted late, in the window its deadline fell in, and
 *                   still open until it lands.
 *   incomplete      30 days past its deadline and still not arrived. It moves
 *                   to the Incomplete orders register (Documents & Reports) and
 *                   OUT of the current figures, answered or not, until it is
 *                   received (then it is an arrival, late by its true dates),
 *                   cancelled, or closed with a credit.
 *
 * A landing after the deadline is the other confirmation: it is late, and it
 * is dated at its deadline too (`vendor-scorecard.ts` `onTimeEntries`).
 *
 * A "Not yet" answers ONE expected date. If the vendor gives a new date and
 * the order is moved, an old answer does not confirm the new deadline: the
 * answer records the expected date it was given for, and only a match counts.
 * An answer recorded before the deadline could have passed anywhere (before
 * its earliest instant) says nothing about lateness and is ignored.
 *
 * Pure: no database and no clock of its own. Read by the vendor scorecard, the
 * analytics vendor scorecard and the overdue-orders read, so the three cannot
 * disagree about which orders are late.
 */

import { DAY_MS, Deadline, daysPast, isPastDue } from "./delivery-deadline";
import { ORDER_OPEN_WITH_VENDOR_STATUSES, hasStatus } from "./order-status";

/** Days past the deadline after which an order not arrived is Incomplete. */
export const INCOMPLETE_AFTER_DAYS = 30;

/**
 * The one answer the house RECORDS. The other two choices of the act are acts
 * that already exist and already leave their own record: "Yes — receive it"
 * opens the receiving door (the receipt is the record), and "Cancel" is the
 * sealed cancellation (the CANCELLED status and its reason are the record).
 */
export const NOT_YET = "not_yet" as const;

export interface ArrivalAnswerRow {
  order_id: string;
  answer: string;
  /** The order's expected date (YYYY-MM-DD) the answer was given for. */
  expected_date: string;
  answered_at: string;
}

export type OverdueStanding =
  | { kind: "not_due" }
  | { kind: "unconfirmed"; days: number }
  | { kind: "confirmed_late"; days: number; answeredAt: string }
  | { kind: "incomplete"; days: number; confirmed: boolean };

export interface OverdueInput {
  status: string | null;
  expectedDate: string | null;
  deadline: Deadline | null;
  nowMs: number;
  /** This order's recorded answers, any order. */
  answers: readonly ArrivalAnswerRow[];
  /** A credit on this order was settled credited: the order is closed. */
  closedWithCredit: boolean;
}

function dateOnly(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = String(s).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * The "Not yet" that confirms THIS deadline, or null: an answer of `not_yet`
 * for the order's current expected date, given no earlier than the deadline's
 * earliest instant. The latest such answer is returned.
 */
export function confirmingAnswer(
  expectedDate: string | null,
  deadline: Deadline,
  answers: readonly ArrivalAnswerRow[],
): ArrivalAnswerRow | null {
  const want = dateOnly(expectedDate);
  if (!want) return null;
  let best: ArrivalAnswerRow | null = null;
  let bestAt = -Infinity;
  for (const a of answers) {
    if (a.answer !== NOT_YET) continue;
    if (dateOnly(a.expected_date) !== want) continue;
    const at = Date.parse(a.answered_at);
    if (!Number.isFinite(at) || at < deadline.earliest) continue;
    if (at > bestAt) {
      best = a;
      bestAt = at;
    }
  }
  return best;
}

/**
 * Where an order still out with the vendor stands against its deadline. Null
 * when it is not a candidate at all: not placed with the vendor (a draft, an
 * approval, an arrival, a cancellation), no expected date, or closed with a
 * credit.
 */
export function overdueStanding(input: OverdueInput): OverdueStanding | null {
  if (!hasStatus(input.status, ORDER_OPEN_WITH_VENDOR_STATUSES)) return null;
  if (input.closedWithCredit) return null;
  const d = input.deadline;
  if (!d) return null;
  if (!isPastDue(input.nowMs, d)) return { kind: "not_due" };
  const days = daysPast(input.nowMs, d);
  const answer = confirmingAnswer(input.expectedDate, d, input.answers);
  if (input.nowMs >= d.latest + INCOMPLETE_AFTER_DAYS * DAY_MS)
    return { kind: "incomplete", days, confirmed: answer !== null };
  if (answer)
    return { kind: "confirmed_late", days, answeredAt: answer.answered_at };
  return { kind: "unconfirmed", days };
}
