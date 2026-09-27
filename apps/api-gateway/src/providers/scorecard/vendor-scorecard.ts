/**
 * The operational vendor scorecard — what a vendor DID, counted from this
 * house's own records (ADR 0207, sketch 117 direction A with B's Roll Call and
 * C's Docket).
 *
 * THE FOUNDER'S BRIEF (2026-09-17, recorded as ADR 0149 row 31): vendor
 * sentiment becomes an "operational vendor scorecard" — on time, short or
 * refused lines, price agreement, reply latency, credits recovered; tone a
 * minor input at most; every figure opens to its rows; a labelled evaluation
 * and a shadow run before any alert ships; windowed trends with a minimum
 * sample.
 *
 * HIS RULINGS OF 2026-09-21 (ADR 0207 review trail, verbatim there):
 *   - an order past its expected date that has not landed is LATE in the
 *     on-time figure, and stays on the open list beneath it (question 8) —
 *     since his delegation of the same evening, only once CONFIRMED: someone
 *     here answered "Not yet", or it landed after the date; unanswered it is
 *     "unconfirmed, not counted", and 30 days on it leaves the figures for
 *     the Incomplete orders register (`procurement/overdue-order.ts`);
 *   - the deadline is the house's local midnight (question 6) —
 *     `procurement/delivery-deadline.ts`, shared with the analytics read;
 *   - five records everywhere before a percent shows, credits included
 *     (question 2); below it, the claims themselves are the answer;
 *   - every figure is a percent with its count, "86% on time · 12 of 14"
 *     (question 3);
 *   - English words, the house's own formats (question 7) — every word this
 *     read sends is in `vendor-scorecard.copy.ts`.
 *
 * WHY THE FIGURES ARE COMPUTED FROM THE ENTRIES, AND NEVER BESIDE THEM
 * -------------------------------------------------------------------
 * "Every figure opens to its rows" is only true if the figure IS its rows. So
 * this module first turns each register's rows into dated docket entries —
 * one per order, door verdict, invoiced line, message wait, claim — and then
 * counts the entries. The card, the Roll Call cell and the Docket are all read
 * from one `buildVendorScorecard` call, so the tally at the top of the Docket
 * cannot disagree with the list beneath it: the spec proves
 * `hits === entries.filter(hit).length` for every measure, both windows.
 *
 * THE FOUR ANSWERS A MEASURE CAN GIVE, AND NO FIFTH
 * -------------------------------------------------
 *   answered       — the window holds at least the measure's minimum sample;
 *   too_few        — it does not; the count is printed, never a zero figure;
 *   not_collected  — this house's register has never held such a record, so
 *                    the vendor is not slow or late — it is unknown;
 *   could_not_read — the register did not answer; the line says so, with the
 *                    reason, and is never read as a clean one.
 *
 * WINDOWS, NOT ENDPOINTS
 * ----------------------
 * The comparison is the window against the window of the same length just
 * before it, both counts printed, and only when BOTH windows reach the
 * minimum. Never the first point against the last
 * (`provider-intelligence.service.ts:399-404` read a flat series as
 * "declining"), and never a regression slope over the whole series presented
 * as movement (`statistics.ts` `trendPerPeriodPct`).
 *
 * NO ALERTS. Nothing here fires, sends or ranks. The shadow run and the
 * labelled set the founder asked for come before any alert, and neither is
 * built in this change (ADR 0207 "Not built").
 *
 * Pure: no database, no Nest, no clock of its own — `now` is an input.
 */

import { median } from "../../analytics/engine/statistics";
import type { HouseFrame } from "../../common/house-frame";
import {
  DAY_MS,
  daysPast,
  deadlineOf,
  landedVerdict,
} from "../../procurement/delivery-deadline";
import { zoneOffsetMs } from "../../calendar/zoned-time";
import {
  ORDER_ARRIVED_STATUSES,
  ORDER_OPEN_WITH_VENDOR_STATUSES,
  hasStatus,
} from "../../procurement/order-status";
import {
  ArrivalAnswerRow,
  overdueStanding,
} from "../../procurement/overdue-order";
import {
  agreedPricePerBottleForDoor,
  readStatedPriceUnit,
} from "../../procurement/agreed-price";
import { ProcurementOrderStatus } from "../../procurement/dto/procurement.dto";
import { COPY, Fmt, makeFmt } from "./vendor-scorecard.copy";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const MEASURE_KEYS = [
  "onTime",
  "linesAsOrdered",
  "priceAsAgreed",
  "replyTime",
  "credits",
] as const;
export type MeasureKey = (typeof MEASURE_KEYS)[number];

export type MeasureOutcome =
  | "answered"
  | "too_few"
  | "not_collected"
  | "could_not_read";

/** The three windows the ledger card offers. Anything else is refused. */
export const WINDOW_DAYS = [30, 90, 365] as const;
export type WindowDays = (typeof WINDOW_DAYS)[number];
export const DEFAULT_WINDOW: WindowDays = 90;

/**
 * The minimum sample, PER MEASURE, for both the figure and the comparison.
 *
 * The founder, 2026-09-21 (question 2): "5 everywhere". Sketch 117 drew 5
 * deliveries and 5 replies; the builder had allowed credits a single claim (a
 * sum of money, every claim on its row). The ruling puts credits at 5 claims
 * too: below it no percent is shown and the claims are listed as rows.
 */
export const MINIMUM: Record<MeasureKey, { count: number; noun: string }> = {
  onTime: { count: 5, noun: COPY.noun.onTime[1] },
  linesAsOrdered: { count: 5, noun: COPY.noun.linesAsOrdered[1] },
  priceAsAgreed: { count: 5, noun: COPY.noun.priceAsAgreed[1] },
  replyTime: { count: 5, noun: COPY.noun.replyTime[1] },
  credits: { count: 5, noun: COPY.noun.credits[1] },
};

export const MEASURE_LABEL: Record<MeasureKey, string> = COPY.label;

/** Which register each measure is counted from — named in every refusal. */
export const MEASURE_REGISTER: Record<MeasureKey, string> = COPY.register;

// ---------------------------------------------------------------------------
// Register rows, as read. Every field optional-ish: the reader is honest about
// what the database handed it, and this module decides what it can count.
// ---------------------------------------------------------------------------

export interface OrderArrivalRow {
  id: string;
  order_number?: string | null;
  provider_id: string | null;
  status: string | null;
  expected_delivery_date: string | null;
  delivered_at: string | null;
  /**
   * This order's recorded "Not yet" answers to the "Did it arrive?" act, read
   * house-scoped by the service for orders still out with the vendor. Absent
   * means none was read, which is also none given.
   */
  arrival_answers?: ArrivalAnswerRow[] | null;
  /** A credit on this order was settled `credited`: closed with a credit. */
  closed_with_credit?: boolean | null;
  /**
   * Whose failure a cancellation was (ADR 0207 round 4, `cancel-reason.ts`):
   * `never_arrived` | `vendor_cannot_supply` | `house_decision`, or null on a
   * non-cancelled row and on a CANCELLED row written before this column
   * existed.
   */
  cancel_reason_code?: string | null;
  /** The status this order held the instant its cancellation was written. */
  cancelled_from_status?: string | null;
  cancelled_at?: string | null;
}

export interface ReceiptEventRow {
  id: string;
  order_id: string | null;
  stage?: string | null;
  outcome: string | null;
  refusal_reason: string | null;
  rejected_qty: number | string | null;
  damage_photo_path: string | null;
  occurred_at: string;
}

export interface VerifiedLineRow {
  id: string;
  order_number?: string | null;
  provider_id: string | null;
  match_verified_at: string | null;
  match_status: string | null;
  price_verified: boolean | null;
  invoice_unit_price: number | string | null;
  final_price: number | string | null;
  negotiated_price: number | string | null;
  quoted_price: number | string | null;
}

export interface AgreedLineRow {
  order_id: string;
  price_uom: string | null;
  price_pack_size: number | null;
  final_unit_price: number | string | null;
  currency: string | null;
}

export interface ConversationRow {
  id: string;
  provider_id: string | null;
  direction: string | null;
  status: string | null;
  sent_at: string | null;
  received_at: string | null;
  thread_key: string | null;
  gmail_thread_id: string | null;
  thread_id: string | null;
}

/**
 * A claim as the service hands it over: ATTRIBUTED and CURRENCIED by the read,
 * not by the claim row. `openCreditClaim` (procurement.service.ts), the only
 * writer, sets neither `provider_id` nor `currency`, and the column defaults to
 * 'USD' — so the service takes the vendor from the claim's order when the claim
 * names none, and the money from the order's stated currency, null when the
 * order states none ("currency not recorded", never a defaulted dollar).
 */
export interface CreditRow {
  id: string;
  provider_id: string | null;
  order_id: string | null;
  reason: string | null;
  currency: string | null;
  claimed_amount: number | string;
  credited_amount: number | string | null;
  state: string;
  opened_at: string;
  promised_at: string | null;
}

/** One register's answer: its rows, or why it gave none. */
export type RegisterRead<T> =
  | { ok: true; rows: T[]; collected: boolean }
  | { ok: false; reason: string };

export interface HouseRegisters {
  /** Orders that arrived since the prior window began, and orders out with the vendor due in it. */
  arrivals: RegisterRead<OrderArrivalRow>;
  /** Door receipt events since the prior window began, with their order's vendor. */
  door: RegisterRead<
    ReceiptEventRow & {
      provider_id: string | null;
      order_number: string | null;
    }
  >;
  /** Orders verified against an invoice since the prior window began. */
  verified: RegisterRead<VerifiedLineRow>;
  /** The agreed line of each verified order (procurement_order_items). */
  agreedLines: RegisterRead<AgreedLineRow>;
  /** Vendor mail: our sends and their replies since the prior window began. */
  mail: RegisterRead<ConversationRow>;
  /** Claims opened since the prior window began. */
  credits: RegisterRead<CreditRow>;
}

// ---------------------------------------------------------------------------
// The docket entry — one row behind one figure.
// ---------------------------------------------------------------------------

export type EntryWindow = "current" | "prior";

export interface DocketEntry {
  /** `${measure}:${source id}` — stable across reads. */
  id: string;
  measure: MeasureKey;
  /** When it happened: landed, fell due, verdict given, verified, sent, opened. */
  at: string;
  window: EntryWindow;
  /** In the figure's denominator. False = listed and not counted, with why. */
  counted: boolean;
  /** In the numerator: on time / as ordered / at the agreed price / credited. Null when not a rate entry or not counted. */
  hit: boolean | null;
  /** Still waiting — an order not landed, a message with no reply, a claim not yet settled. */
  open: boolean;
  /** Why it is listed but not counted. Null when counted. */
  excludedBecause: string | null;
  /** Short name of the record: an order number, a claim, a message. */
  title: string;
  /** What this entry says, in words. */
  detail: string;
  source: { table: string; id: string; orderId: string | null };
  /** Reply time only: hours from our message to their reply. */
  hours?: number | null;
  /** On time only: whole days after the expected date; 0 when on time. */
  daysLate?: number | null;
  /**
   * On time only, an order past its date and not landed: `unconfirmed`
   * (nobody has said whether it arrived — not counted), `confirmed` (someone
   * here said "Not yet" — counted late) or `incomplete` (30 days on — in the
   * Incomplete orders register, out of the figures).
   */
  overdue?: "unconfirmed" | "confirmed" | "incomplete" | null;
  /** Price only: the agreed per-bottle price and the invoiced one. */
  agreed?: number | null;
  invoiced?: number | null;
  /** Credits only. */
  amountAsked?: number | null;
  amountAllowed?: number | null;
  currency?: string | null;
}

// ---------------------------------------------------------------------------
// The measure — what the card, the cell and the tally print.
// ---------------------------------------------------------------------------

export interface MoneyTotal {
  allowed: number;
  asked: number;
  currency: string | null;
  /** allowed / asked; null when nothing was asked or this currency holds fewer than five claims. */
  share: number | null;
  /** The share as the house formats a percent; null when there is no share. */
  percent: string | null;
}

export interface WindowTally {
  outcome: MeasureOutcome;
  /** Entries counted toward the minimum (the denominator). */
  sample: number;
  /** Numerator for the rate measures; null for reply time. */
  hits: number | null;
  /**
   * Rate in [0,1], median hours, or recovered share. Null unless answered —
   * and null for credits held in more than one currency, which have no single
   * share (two monies are never added together).
   */
  value: number | null;
  /**
   * The rate as the house formats a percent ("86%", "%86"). Null unless the
   * measure is answered and is a share — never a percent over too few records.
   */
  percent: string | null;
  /** Credits only: money allowed and asked, one entry per currency. */
  money: MoneyTotal[] | null;
}

export interface MeasureResult extends WindowTally {
  key: MeasureKey;
  label: string;
  minimum: number;
  minimumNoun: string;
  /** Entries listed and not counted, grouped by the reason. */
  excluded: { because: string; count: number }[];
  /** Entries still waiting (orders not landed, unanswered messages, unsettled claims). */
  open: number;
  /**
   * On time only (null elsewhere): the orders past their date and not landed,
   * by where they stand — counted late once confirmed, unconfirmed and not
   * counted, or incomplete and out of the figures.
   */
  overdue: {
    confirmed: number;
    unconfirmed: number;
    incomplete: number;
  } | null;
  /** Every entry behind this line in the current window — the Docket filter's length. */
  rows: number;
  /** Why the register could not be read, or is not collected. */
  reason: string | null;
  /** The line in words, including what was left out and why. */
  sentence: string;
  prior: WindowTally;
  /** The prior window in words — both counts, or why it compares nothing. */
  priorSentence: string;
  /** Reply time only: the slowest counted reply, in hours. */
  slowestHours?: number | null;
  /**
   * Credits only, and only under the minimum: the claims themselves, newest
   * first — "below that the claims are listed as rows" (question 2).
   */
  listed: DocketEntry[] | null;
}

/** The house's clock and formats as this read used them. */
export interface HouseClock {
  zone: string | null;
  zoneSource: HouseFrame["zoneSource"];
  locale: string | null;
  localeSource: HouseFrame["localeSource"];
  /** How the on-time deadline was read, in words. */
  deadline: string;
}

export interface VendorScorecard {
  providerId: string;
  providerName: string;
  window: { days: WindowDays; from: string; to: string; priorFrom: string };
  house: HouseClock;
  measures: MeasureResult[];
  /*
   * No tone here. The vendor's mail tone is read by owners and managers only
   * (the founder, 2026-09-21: "Vendor sheet only", staff never see it), so it
   * is its own route — `GET /vendor-scorecard/:id/mail`, `vendor-mail-tone.ts`
   * — and this card, which every member of the house reads, carries none.
   */
  /** Nothing at all in the window and every register answered. */
  quiet: boolean;
  /** The card's one behavioural fact (MAKEOVER-VERDICTS `/providers` MERGE). */
  fact: { text: string; outcome: MeasureOutcome };
  /** No alert is built; said on every read so no reader assumes one. */
  alerting: { built: false; sentence: string };
}

export const ALERTING_SENTENCE = COPY.alerting;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function windowBounds(now: Date, days: WindowDays) {
  const to = now.getTime();
  const from = to - days * DAY_MS;
  const priorFrom = to - 2 * days * DAY_MS;
  return { to, from, priorFrom };
}

function whichWindow(
  at: number | null,
  b: { to: number; from: number; priorFrom: number },
): EntryWindow | null {
  if (at === null) return null;
  if (at >= b.from && at <= b.to) return "current";
  if (at >= b.priorFrom && at < b.from) return "prior";
  return null;
}

export function houseClock(h: HouseFrame): HouseClock {
  return {
    zone: h.zone,
    zoneSource: h.zoneSource,
    locale: h.locale,
    localeSource: h.localeSource,
    deadline: COPY.deadline(h),
  };
}

// ---------------------------------------------------------------------------
// Rows -> entries, one register at a time
// ---------------------------------------------------------------------------

type Bounds = ReturnType<typeof windowBounds>;

/**
 * On time. The universe is every order of the vendor that LANDED in the
 * window (PARTIALLY_RECEIVED included on purpose — order-status.ts: a short
 * delivery still came through the door) and every order still out with it
 * whose deadline passed in the window (`overdueEntry`). Before its deadline an
 * order is not late, so it is not listed.
 *
 * A LATE landing is dated at its DEADLINE, not at its landing: it counts in
 * the window its deadline fell in (the founder's delegation, 2026-09-21), so
 * an order that was overdue and then arrived counts in the same window an
 * order still overdue would, with its true landing date and days late in its
 * detail. An on-time landing (and one that cannot be called) keeps its
 * landing date.
 */
/**
 * The calendar day an instant falls on at the house (`YYYY-MM-DD`), for the
 * words of an entry — a landing at 01:30 in Istanbul is the next day there,
 * whatever UTC says. With no zone known, the UTC day, which the deadline
 * sentence already says is not the house's.
 */
function localDay(at: number, zone: string | null): string {
  const offset = zone ? zoneOffsetMs(new Date(at), zone) : 0;
  return new Date(at + (Number.isFinite(offset) ? offset : 0))
    .toISOString()
    .slice(0, 10);
}

export function onTimeEntries(
  rows: OrderArrivalRow[],
  b: Bounds,
  zone: string | null,
  fmt: Fmt,
): DocketEntry[] {
  const out: DocketEntry[] = [];
  for (const o of rows) {
    if (o.status === ProcurementOrderStatus.CANCELLED) {
      const c = cancelledEntry(o, b, zone, fmt);
      if (c) out.push(c);
      continue;
    }
    if (!hasStatus(o.status, ORDER_ARRIVED_STATUSES)) {
      const due = overdueEntry(o, b, zone, fmt);
      if (due) out.push(due);
      continue;
    }
    const landed = ms(o.delivered_at);
    if (landed === null) continue;
    const deadline = deadlineOf(o.expected_delivery_date, zone);
    const verdict = deadline ? landedVerdict(landed, deadline) : null;
    const late = verdict === "late";
    const at = late && deadline ? deadline.latest : landed;
    const w = whichWindow(at, b);
    if (!w) continue;
    const base = {
      id: `onTime:${o.id}`,
      measure: "onTime" as const,
      at: late ? new Date(at).toISOString() : (o.delivered_at as string),
      window: w,
      open: false,
      title: o.order_number || COPY.entry.order(o.id),
      source: { table: "procurement_orders", id: o.id, orderId: o.id },
    };
    if (!deadline) {
      out.push({
        ...base,
        counted: false,
        hit: null,
        excludedBecause: COPY.entry.noExpectedDate,
        detail: COPY.entry.noExpectedDateDetail,
        daysLate: null,
      });
      continue;
    }
    const date = fmt.date(deadline.date);
    if (verdict === "undecided") {
      out.push({
        ...base,
        counted: false,
        hit: null,
        excludedBecause: COPY.entry.undecided,
        detail: COPY.entry.undecidedDetail(date),
        daysLate: null,
      });
      continue;
    }
    const onTime = verdict === "on_time";
    const daysLate = onTime ? 0 : daysPast(landed, deadline);
    out.push({
      ...base,
      counted: true,
      hit: onTime,
      excludedBecause: null,
      detail: onTime
        ? COPY.entry.onTime(date)
        : COPY.entry.late(daysLate, date, fmt.date(localDay(landed, zone))),
      daysLate,
    });
  }
  return out;
}

/**
 * An order placed with the vendor (CONFIRMED / IN_TRANSIT) whose deadline has
 * passed and which has not landed, dated at its deadline and always OPEN.
 * Whether it counts is `procurement/overdue-order.ts`'s one rule:
 *
 *   confirmed_late  someone here answered "Not yet" — counted, a miss;
 *   unconfirmed     nobody has said whether it arrived — listed, NOT counted
 *                   ("unconfirmed, not counted"), and the "Did it arrive?"
 *                   act is raised by the overdue-orders read;
 *   incomplete      30 days past the date and not arrived — listed, NOT
 *                   counted, in the Incomplete orders register.
 *
 * Once it lands it is an arrival instead (late, dated at its deadline).
 */
function overdueEntry(
  o: OrderArrivalRow,
  b: Bounds,
  zone: string | null,
  fmt: Fmt,
): DocketEntry | null {
  if (!hasStatus(o.status, ORDER_OPEN_WITH_VENDOR_STATUSES)) return null;
  const deadline = deadlineOf(o.expected_delivery_date, zone);
  if (!deadline) return null;
  const standing = overdueStanding({
    status: o.status,
    expectedDate: o.expected_delivery_date,
    deadline,
    nowMs: b.to,
    answers: o.arrival_answers ?? [],
    closedWithCredit: o.closed_with_credit === true,
  });
  if (!standing || standing.kind === "not_due") return null;
  const w = whichWindow(deadline.latest, b);
  if (!w) return null;
  const date = fmt.date(deadline.date);
  const base = {
    id: `onTime:${o.id}`,
    measure: "onTime" as const,
    at: new Date(deadline.latest).toISOString(),
    window: w,
    open: true,
    title: o.order_number || COPY.entry.order(o.id),
    source: { table: "procurement_orders", id: o.id, orderId: o.id },
    daysLate: standing.days,
  };
  if (standing.kind === "confirmed_late")
    return {
      ...base,
      counted: true,
      hit: false,
      excludedBecause: null,
      overdue: "confirmed",
      detail: COPY.entry.overdueDetail(
        date,
        standing.days,
        fmt.date(localDay(Date.parse(standing.answeredAt), zone)),
      ),
    };
  if (standing.kind === "incomplete")
    return {
      ...base,
      counted: false,
      hit: null,
      excludedBecause: COPY.entry.incomplete,
      overdue: "incomplete",
      detail: COPY.entry.incompleteDetail(date, standing.days),
    };
  return {
    ...base,
    counted: false,
    hit: null,
    excludedBecause: COPY.entry.unconfirmed,
    overdue: "unconfirmed",
    detail: COPY.entry.unconfirmedDetail(date, standing.days),
  };
}

/**
 * A CANCELLED order that had been placed with a vendor (ADR 0207 round 4,
 * `procurement/cancel-reason.ts`). Cancelling must not erase the vendor's
 * failure:
 *
 *   never_arrived          counted, a MISS, dated at its deadline like a
 *                           confirmed-overdue order — the same reasoning
 *                           question 8's ruling already applied to an order
 *                           nobody cancelled.
 *   vendor_cannot_supply    listed, never counted — the vendor said so, which
 *                           is not lateness.
 *   house_decision          listed, never counted — never the vendor's fault.
 *   no code (a legacy row)  listed, never counted, and says so plainly.
 *
 * A cancel out of a PRE-PLACEMENT state (PENDING, APPROVAL_NEEDED — an order
 * the vendor never saw) is not a vendor event at all and is not listed.
 */
function cancelledEntry(
  o: OrderArrivalRow,
  b: Bounds,
  zone: string | null,
  fmt: Fmt,
): DocketEntry | null {
  const from = o.cancelled_from_status;
  if (
    from === ProcurementOrderStatus.PENDING ||
    from === ProcurementOrderStatus.APPROVAL_NEEDED
  ) {
    return null;
  }
  const code = o.cancel_reason_code ?? null;
  const cancelledAtMs = ms(o.cancelled_at);
  const deadline = deadlineOf(o.expected_delivery_date, zone);
  const base = {
    title: o.order_number || COPY.entry.order(o.id),
    source: { table: "procurement_orders", id: o.id, orderId: o.id },
  };

  if (code === "never_arrived") {
    // The write path (cancel-reason.ts `verdictFor`) refuses this category
    // without a deadline already past, so the no-deadline arm here is a
    // never-should-happen guard, not a live path — but a read must never
    // guess a date for a miss it is about to count.
    if (!deadline) {
      const at = cancelledAtMs ?? b.to;
      const w = whichWindow(at, b);
      if (!w) return null;
      return {
        ...base,
        id: `onTime:${o.id}`,
        measure: "onTime",
        at: new Date(at).toISOString(),
        window: w,
        open: false,
        counted: false,
        hit: null,
        excludedBecause: COPY.entry.noExpectedDate,
        detail: COPY.entry.cancelledNeverArrivedNoDate,
        daysLate: null,
      };
    }
    const w = whichWindow(deadline.latest, b);
    if (!w) return null;
    const date = fmt.date(deadline.date);
    const days = Math.max(daysPast(cancelledAtMs ?? deadline.latest, deadline), 0);
    return {
      ...base,
      id: `onTime:${o.id}`,
      measure: "onTime",
      at: new Date(deadline.latest).toISOString(),
      window: w,
      open: false,
      counted: true,
      hit: false,
      excludedBecause: null,
      detail: COPY.entry.cancelledNeverArrived(date, days),
      daysLate: days,
    };
  }

  // vendor_cannot_supply, house_decision, or no code (legacy): listed, never
  // counted. Dated at the cancellation when it is known, else the order's own
  // deadline; an order with neither cannot be placed in a window and is left
  // off the list rather than dated by a guess.
  const at = cancelledAtMs ?? deadline?.latest ?? null;
  if (at === null) return null;
  const w = whichWindow(at, b);
  if (!w) return null;
  const detail =
    code === "vendor_cannot_supply"
      ? COPY.entry.cancelledVendorCannotSupply
      : code === "house_decision"
        ? COPY.entry.cancelledHouseDecision
        : COPY.entry.cancelledNoReason;
  return {
    ...base,
    id: `onTime:${o.id}`,
    measure: "onTime",
    at: new Date(at).toISOString(),
    window: w,
    open: false,
    counted: false,
    hit: null,
    excludedBecause: detail,
    detail,
    daysLate: null,
  };
}

export function doorEntries(
  rows: (ReceiptEventRow & {
    provider_id: string | null;
    order_number: string | null;
  })[],
  b: Bounds,
): DocketEntry[] {
  // One verdict per order line: the latest door event that carries an outcome.
  const byOrder = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.order_id) continue; // no order, no vendor — not attributable
    const list = byOrder.get(r.order_id) ?? [];
    list.push(r);
    byOrder.set(r.order_id, list);
  }
  const out: DocketEntry[] = [];
  for (const [orderId, events] of byOrder) {
    const sorted = [...events].sort(
      (a, c) => (ms(c.occurred_at) ?? 0) - (ms(a.occurred_at) ?? 0),
    );
    const verdict = sorted.find((e) => e.outcome);
    const chosen = verdict ?? sorted[0];
    const at = ms(chosen.occurred_at);
    const w = whichWindow(at, b);
    if (!w) continue;
    const base = {
      id: `linesAsOrdered:${orderId}`,
      measure: "linesAsOrdered" as const,
      at: chosen.occurred_at,
      window: w,
      open: false,
      title: chosen.order_number || COPY.entry.order(orderId),
      source: { table: "procurement_receipt_events", id: chosen.id, orderId },
    };
    if (!verdict) {
      out.push({
        ...base,
        counted: false,
        hit: null,
        excludedBecause: COPY.entry.noVerdict,
        detail: COPY.entry.noVerdictDetail,
      });
      continue;
    }
    const rejected = toNum(verdict.rejected_qty) ?? 0;
    const photographed = Boolean(verdict.damage_photo_path);
    const outcome = String(verdict.outcome).toLowerCase();
    const asOrdered = outcome === "accepted" && rejected <= 0 && !photographed;
    let detail: string;
    if (outcome === "refused") {
      detail = COPY.entry.refused(
        verdict.refusal_reason ? String(verdict.refusal_reason) : null,
      );
    } else if (outcome === "short") {
      detail = COPY.entry.short;
    } else if (rejected > 0) {
      detail = COPY.entry.partRefused(rejected);
    } else if (photographed) {
      detail = COPY.entry.photographed;
    } else {
      detail = COPY.entry.asOrdered;
    }
    out.push({
      ...base,
      counted: true,
      hit: asOrdered,
      excludedBecause: null,
      detail,
    });
  }
  return out;
}

export function priceEntries(
  rows: VerifiedLineRow[],
  agreed: Map<string, AgreedLineRow>,
  b: Bounds,
  fmt: Fmt,
): DocketEntry[] {
  const out: DocketEntry[] = [];
  for (const o of rows) {
    const at = ms(o.match_verified_at);
    const w = whichWindow(at, b);
    if (!w) continue;
    const line = agreed.get(o.id) ?? null;
    const base = {
      id: `priceAsAgreed:${o.id}`,
      measure: "priceAsAgreed" as const,
      at: o.match_verified_at as string,
      window: w,
      open: false,
      title: o.order_number || COPY.entry.order(o.id),
      source: { table: "procurement_orders", id: o.id, orderId: o.id },
      currency: line?.currency ?? null,
    };
    const invoiced = toNum(o.invoice_unit_price);
    if (invoiced === null) {
      out.push({
        ...base,
        counted: false,
        hit: null,
        excludedBecause: COPY.entry.noInvoicedPrice,
        detail: COPY.entry.noInvoicedPriceDetail,
        agreed: null,
        invoiced: null,
      });
      continue;
    }
    if (o.price_verified === null || o.price_verified === undefined) {
      out.push({
        ...base,
        counted: false,
        hit: null,
        excludedBecause: COPY.entry.notChecked,
        detail: COPY.entry.notCheckedDetail,
        agreed: null,
        invoiced,
      });
      continue;
    }
    // The agreed price the door compared, resolved by the SAME function the
    // verification ran (procurement.service.ts verifyReceipt -> doorPrice).
    const header =
      toNum(o.final_price) ??
      toNum(o.negotiated_price) ??
      toNum(o.quoted_price);
    const stated = line ? readStatedPriceUnit(line) : null;
    const door = agreedPricePerBottleForDoor({
      price: stated ? (toNum(line?.final_unit_price) ?? header) : header,
      stated,
    });
    if (!door.ok) {
      out.push({
        ...base,
        counted: false,
        hit: null,
        excludedBecause: COPY.entry.noAgreedPrice,
        detail: COPY.entry.noAgreedPriceDetail(door.reason),
        agreed: null,
        invoiced,
      });
      continue;
    }
    // The verdict is the one RECORDED at verification, not re-derived: the
    // house's record says whether the line was at the agreed price.
    const atAgreed = o.price_verified === true;
    const diff =
      door.perBottle > 0 ? (invoiced - door.perBottle) / door.perBottle : null;
    out.push({
      ...base,
      counted: true,
      hit: atAgreed,
      excludedBecause: null,
      detail: atAgreed
        ? COPY.entry.atAgreed
        : diff === null
          ? COPY.entry.awayFromAgreed
          : COPY.entry.offAgreed(diff > 0, fmt.pct1(Math.abs(diff))),
      agreed: door.perBottle,
      invoiced,
    });
  }
  return out;
}

// AUTO_SENT is a send: the auto-send sweep (procurement.service.ts) writes it
// with `sent_at` once the message has gone, and reverts to a draft on failure.
const SENT_STATUSES = new Set(["SENT", "AUTO_SENT", "DELIVERED"]);
const UNSENT_STATUSES = new Set([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SCHEDULED",
  "SENDING",
  "REJECTED",
  "FAILED",
  "CANCELLED",
]);

/**
 * The thread a message belongs to — the Gmail thread FIRST when the row carries
 * one. `set_conversation_thread_key()` fills `thread_key` only while it is
 * empty, and an agent's draft is inserted before it is sent, with no Gmail
 * thread, so it is keyed `msg:<id>` and KEEPS that key after the send writes
 * `gmail_thread_id`; the vendor's reply arrives keyed `gm:<thread>`. Reading
 * `thread_key` first would list every answered first message as "no reply
 * yet". `gm:` + the trimmed id is the key the same SQL function gives a row
 * that carried its Gmail thread when it was inserted.
 */
function threadOf(r: ConversationRow): string | null {
  const gmail = r.gmail_thread_id ? r.gmail_thread_id.trim() : "";
  if (gmail) return `gm:${gmail}`;
  return r.thread_key || r.thread_id || null;
}

/**
 * Reply waits. A wait opens at OUR sent message when none is open in that
 * thread, and closes at THEIR next received message in the same thread. A
 * second chase before they answer does not open a second wait — one reply is
 * one reply, never counted twice. A wait still open is listed as open and not
 * counted: "not counted, not forgotten".
 */
export function replyEntries(
  rows: ConversationRow[],
  b: Bounds,
  fmt: Fmt,
): DocketEntry[] {
  const out: DocketEntry[] = [];
  const threads = new Map<
    string,
    { at: number; row: ConversationRow; dir: "out" | "in" }[]
  >();
  const aside = (
    r: ConversationRow,
    w: EntryWindow,
    because: string,
    detail: string,
  ) =>
    out.push({
      id: `replyTime:${r.id}`,
      measure: "replyTime",
      at: r.sent_at as string,
      window: w,
      counted: false,
      hit: null,
      open: false,
      excludedBecause: because,
      title: COPY.entry.ourMessage,
      detail,
      source: { table: "procurement_conversations", id: r.id, orderId: null },
      hours: null,
    });
  for (const r of rows) {
    const dir = String(r.direction ?? "").toLowerCase();
    if (dir === "outbound") {
      const status = String(r.status ?? "").toUpperCase();
      const sent = ms(r.sent_at);
      if (UNSENT_STATUSES.has(status) || sent === null) continue; // not our message yet
      const w = whichWindow(sent, b);
      if (!SENT_STATUSES.has(status)) {
        if (w)
          aside(
            r,
            w,
            COPY.entry.neverConfirmed,
            COPY.entry.neverConfirmedDetail(status),
          );
        continue;
      }
      const t = threadOf(r);
      if (!t) {
        if (w) aside(r, w, COPY.entry.noThread, COPY.entry.noThreadDetail);
        continue;
      }
      const list = threads.get(t) ?? [];
      list.push({ at: sent, row: r, dir: "out" });
      threads.set(t, list);
    } else if (dir === "inbound") {
      const got = ms(r.received_at);
      const t = threadOf(r);
      if (got === null || !t) continue;
      const list = threads.get(t) ?? [];
      list.push({ at: got, row: r, dir: "in" });
      threads.set(t, list);
    }
  }
  for (const [, msgs] of threads) {
    msgs.sort((a, c) => a.at - c.at || (a.dir === "out" ? -1 : 1));
    let waiting: { at: number; row: ConversationRow } | null = null;
    const push = (
      start: { at: number; row: ConversationRow },
      reply: { at: number } | null,
    ) => {
      const w = whichWindow(start.at, b);
      if (!w) return;
      const hours = reply ? (reply.at - start.at) / 3_600_000 : null;
      out.push({
        id: `replyTime:${start.row.id}`,
        measure: "replyTime",
        at: start.row.sent_at as string,
        window: w,
        counted: reply !== null,
        hit: null,
        open: reply === null,
        excludedBecause: reply ? null : COPY.entry.noReplyYet,
        title: COPY.entry.ourMessage,
        detail: reply
          ? COPY.entry.answered(fmt.hours(hours as number))
          : COPY.entry.unanswered,
        source: {
          table: "procurement_conversations",
          id: start.row.id,
          orderId: null,
        },
        hours,
      });
    };
    for (const m of msgs) {
      if (m.dir === "out") {
        if (!waiting) waiting = { at: m.at, row: m.row };
      } else if (waiting) {
        push(waiting, { at: m.at });
        waiting = null;
      }
    }
    if (waiting) push(waiting, null);
  }
  return out;
}

export function creditEntries(
  rows: CreditRow[],
  b: Bounds,
  now: Date,
  fmt: Fmt,
): DocketEntry[] {
  const out: DocketEntry[] = [];
  for (const c of rows) {
    const at = ms(c.opened_at);
    const w = whichWindow(at, b);
    if (!w) continue;
    const asked = toNum(c.claimed_amount) ?? 0;
    const allowed =
      c.state === "credited" ? (toNum(c.credited_amount) ?? 0) : null;
    const currency = c.currency ? c.currency.toUpperCase() : null;
    const open =
      c.state === "open" || c.state === "requested" || c.state === "promised";
    const askedText = fmt.money(asked, currency);
    let detail: string;
    switch (c.state) {
      case "credited":
        detail = COPY.entry.credited(
          fmt.money(allowed as number, currency),
          askedText,
        );
        break;
      case "promised": {
        const since = ms(c.promised_at) ?? (at as number);
        const days = Math.max(0, Math.floor((now.getTime() - since) / DAY_MS));
        detail = COPY.entry.promised(days);
        break;
      }
      case "requested":
        detail = COPY.entry.requested(askedText);
        break;
      case "open":
        detail = COPY.entry.openClaim(askedText);
        break;
      case "rejected":
        detail = COPY.entry.rejected(askedText);
        break;
      case "written_off":
        detail = COPY.entry.writtenOff(askedText);
        break;
      default:
        detail = COPY.entry.otherState(c.state);
    }
    out.push({
      id: `credits:${c.id}`,
      measure: "credits",
      at: c.opened_at,
      window: w,
      counted: true,
      hit: c.state === "credited",
      open,
      excludedBecause: null,
      title: COPY.entry.claim(c.id, c.reason),
      detail,
      source: { table: "procurement_credits", id: c.id, orderId: c.order_id },
      amountAsked: asked,
      amountAllowed: allowed,
      currency,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entries -> the measure
// ---------------------------------------------------------------------------

function tally(
  key: MeasureKey,
  entries: DocketEntry[],
  blocked: MeasureOutcome | null,
  fmt: Fmt,
): WindowTally {
  const counted = entries.filter((e) => e.counted);
  const sample = counted.length;
  const empty = { sample, hits: null, value: null, percent: null, money: null };
  if (blocked) return { outcome: blocked, ...empty };
  if (key === "replyTime") {
    const hours = counted.map((e) => e.hours as number);
    if (sample < MINIMUM[key].count) return { outcome: "too_few", ...empty };
    return {
      outcome: "answered",
      sample,
      hits: null,
      value: median(hours),
      percent: null,
      money: null,
    };
  }
  const hits = counted.filter((e) => e.hit === true).length;
  if (sample < MINIMUM[key].count)
    return {
      outcome: "too_few",
      sample,
      hits,
      value: null,
      percent: null,
      money: null,
    };
  if (key === "credits") {
    // One total per currency. Two monies are never added together, so a
    // vendor with claims in two currencies gets two totals and no one share.
    // "5 everywhere" (question 2) holds per currency too: a currency's share
    // rests on its own claims only, so under five of them it prints its money
    // and no percent — five claims across two currencies are not five of either.
    const byCurrency = new Map<
      string | null,
      { allowed: number; asked: number; claims: number }
    >();
    for (const e of counted) {
      const c = e.currency ?? null;
      const m = byCurrency.get(c) ?? { allowed: 0, asked: 0, claims: 0 };
      m.asked += e.amountAsked ?? 0;
      m.allowed += e.amountAllowed ?? 0;
      m.claims += 1;
      byCurrency.set(c, m);
    }
    const money: MoneyTotal[] = [...byCurrency.entries()]
      .sort(([a], [c]) => String(a ?? "").localeCompare(String(c ?? "")))
      .map(([currency, m]) => {
        const allowed = round2(m.allowed);
        const asked = round2(m.asked);
        const scores = asked > 0 && m.claims >= MINIMUM[key].count;
        return {
          currency,
          allowed,
          asked,
          share: scores ? allowed / asked : null,
          percent: scores ? fmt.pct(allowed, asked) : null,
        };
      });
    const single = money.length === 1 ? money[0] : null;
    return {
      outcome: "answered",
      sample,
      hits,
      value: single ? single.share : null,
      percent: single ? single.percent : null,
      money,
    };
  }
  return {
    outcome: "answered",
    sample,
    hits,
    value: hits / sample,
    percent: fmt.pct(hits, sample),
    money: null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function measureSentence(
  key: MeasureKey,
  t: WindowTally,
  cur: DocketEntry[],
  days: WindowDays,
  reason: string | null,
  fmt: Fmt,
): string {
  if (t.outcome === "could_not_read") return COPY.couldNotRead(key, reason);
  if (t.outcome === "not_collected") return COPY.notCollected[key];

  const excluded = cur.filter((e) => !e.counted);
  const open = cur.filter((e) => e.open);

  if (t.outcome === "too_few") {
    const head =
      t.sample === 0
        ? COPY.nothingInWindow(key, days)
        : COPY.tooFew(key, t.sample, days, MINIMUM[key].count);
    return [head, tailSentence(key, excluded, open)].filter(Boolean).join(" ");
  }

  const counted = cur.filter((e) => e.counted);
  const pct = t.percent ?? "";
  let head = "";
  switch (key) {
    case "onTime": {
      // Days late of the orders that LANDED late; the ones not landed are in
      // the tail, named as open.
      const landedLate = counted
        .filter((e) => e.hit === false && !e.open)
        .map((e) => e.daysLate as number)
        .sort((a, c) => a - c);
      head = COPY.head.onTime(pct, t.hits as number, t.sample, landedLate);
      break;
    }
    case "linesAsOrdered":
      head = COPY.head.linesAsOrdered(
        pct,
        t.hits as number,
        t.sample,
        counted.filter((e) => e.hit === false).length,
      );
      break;
    case "priceAsAgreed":
      head = COPY.head.priceAsAgreed(
        pct,
        t.hits as number,
        t.sample,
        counted.filter(
          (e) => e.hit === false && (e.invoiced ?? 0) > (e.agreed ?? 0),
        ).length,
        counted.filter(
          (e) => e.hit === false && (e.invoiced ?? 0) < (e.agreed ?? 0),
        ).length,
      );
      break;
    case "replyTime":
      head = COPY.head.replyTime(
        fmt.hours(t.value as number),
        t.sample,
        fmt.hours(Math.max(...counted.map((e) => e.hours as number))),
      );
      break;
    case "credits": {
      const money = t.money ?? [];
      head = COPY.head.credits(
        money.map((m) => ({
          allowed: fmt.money(m.allowed, m.currency),
          asked: fmt.money(m.asked, m.currency),
          pct: m.percent,
        })),
        t.sample,
        t.hits as number,
        money.length > 1,
        money.some((m) => m.currency === null),
        // Asked and still no percent: that currency holds under five claims.
        money.some((m) => m.asked > 0 && m.percent === null)
          ? MINIMUM[key].count
          : null,
      );
      break;
    }
  }
  return [head, tailSentence(key, excluded, open)].filter(Boolean).join(" ");
}

function tailSentence(
  key: MeasureKey,
  excluded: DocketEntry[],
  open: DocketEntry[],
): string {
  const parts: string[] = [];
  for (const g of groupExcluded(excluded.filter((e) => !e.open)))
    parts.push(COPY.listedNotCounted(g.count, g.because));
  if (open.length) {
    if (key === "onTime") {
      const by = overdueCounts(open);
      if (by.confirmed) parts.push(COPY.open.onTime(by.confirmed));
      if (by.unconfirmed)
        parts.push(COPY.open.onTimeUnconfirmed(by.unconfirmed));
      if (by.incomplete) parts.push(COPY.open.onTimeIncomplete(by.incomplete));
    } else if (key === "replyTime")
      parts.push(COPY.open.replyTime(open.length));
    else if (key === "credits") parts.push(COPY.open.credits(open.length));
  }
  return parts.join(" ");
}

/** The on-time line's open orders, by where each stands (`overdue-order.ts`). */
function overdueCounts(entries: DocketEntry[]): {
  confirmed: number;
  unconfirmed: number;
  incomplete: number;
} {
  const by = { confirmed: 0, unconfirmed: 0, incomplete: 0 };
  for (const e of entries) if (e.open && e.overdue) by[e.overdue] += 1;
  return by;
}

function groupExcluded(
  entries: DocketEntry[],
): { because: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) {
    const k = e.excludedBecause ?? "";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([because, count]) => ({ because, count }));
}

function tallyText(key: MeasureKey, t: WindowTally, fmt: Fmt): string {
  if (key === "replyTime")
    return COPY.tally.reply(fmt.hours(t.value as number), t.sample);
  if (key === "credits" && t.money)
    return t.money
      .map((m) =>
        COPY.tally.money(
          m.percent,
          fmt.money(m.allowed, m.currency),
          fmt.money(m.asked, m.currency),
        ),
      )
      .join(" · ");
  return COPY.tally.rate(t.percent, t.hits as number, t.sample);
}

/**
 * The prior window, as a window: its own count, printed beside this one. It is
 * a comparison only when both windows reached the minimum; otherwise it says
 * why it compares nothing. No arrow, no "improving" — two counts, side by side.
 */
function priorSentence(
  key: MeasureKey,
  prior: WindowTally,
  days: WindowDays,
  fmt: Fmt,
): string {
  const label = COPY.prior.label(days);
  if (prior.outcome === "could_not_read")
    return `${label} · ${COPY.prior.couldNotRead}`;
  if (prior.outcome === "not_collected")
    return `${label} · ${COPY.prior.notCollected}`;
  if (prior.outcome === "too_few")
    return prior.sample === 0
      ? `${label} · ${COPY.prior.nothing}`
      : `${label} · ${COPY.prior.tooFew(prior.sample)}`;
  return `${label} · ${tallyText(key, prior, fmt)}`;
}

// ---------------------------------------------------------------------------
// The whole card
// ---------------------------------------------------------------------------

export interface BuildInput {
  providerId: string;
  providerName: string;
  days: WindowDays;
  now: Date;
  /** The house's clock and formats (`common/house-frame.ts`). */
  house: HouseFrame;
  registers: HouseRegisters;
}

export interface BuiltScorecard {
  card: VendorScorecard;
  /** Every entry in BOTH windows; the Docket shows the current window's. */
  entries: DocketEntry[];
}

function forVendor<T extends { provider_id: string | null }>(
  rows: T[],
  id: string,
): T[] {
  return rows.filter((r) => r.provider_id === id);
}

function newestFirst(a: DocketEntry, c: DocketEntry): number {
  return (ms(c.at) ?? 0) - (ms(a.at) ?? 0);
}

export function buildVendorScorecard(input: BuildInput): BuiltScorecard {
  const { providerId, providerName, days, now, house, registers: R } = input;
  const b = windowBounds(now, days);
  const fmt = makeFmt(house.locale);

  const agreedMap = new Map<string, AgreedLineRow>();
  if (R.agreedLines.ok)
    for (const l of R.agreedLines.rows) agreedMap.set(l.order_id, l);

  // Each register -> entries, or the reason it gave none.
  const perMeasure: Record<
    MeasureKey,
    {
      entries: DocketEntry[];
      blocked: MeasureOutcome | null;
      reason: string | null;
    }
  > = {
    onTime: fromRegister(R.arrivals, (rows) =>
      onTimeEntries(forVendor(rows, providerId), b, house.zone, fmt),
    ),
    linesAsOrdered: fromRegister(R.door, (rows) =>
      doorEntries(forVendor(rows, providerId), b),
    ),
    priceAsAgreed: !R.agreedLines.ok
      ? {
          entries: [],
          blocked: "could_not_read",
          reason: COPY.reason.agreedLines(R.agreedLines.reason),
        }
      : fromRegister(R.verified, (rows) =>
          priceEntries(forVendor(rows, providerId), agreedMap, b, fmt),
        ),
    replyTime: fromRegister(R.mail, (rows) =>
      replyEntries(forVendor(rows, providerId), b, fmt),
    ),
    credits: fromRegister(R.credits, (rows) =>
      creditEntries(forVendor(rows, providerId), b, now, fmt),
    ),
  };

  const measures: MeasureResult[] = MEASURE_KEYS.map((key) => {
    const { entries, blocked, reason } = perMeasure[key];
    const cur = entries.filter((e) => e.window === "current");
    const pri = entries.filter((e) => e.window === "prior");
    const t = tally(key, cur, blocked, fmt);
    const p = tally(key, pri, blocked, fmt);
    const result: MeasureResult = {
      key,
      label: MEASURE_LABEL[key],
      ...t,
      minimum: MINIMUM[key].count,
      minimumNoun: MINIMUM[key].noun,
      excluded: groupExcluded(cur.filter((e) => !e.counted && !e.open)),
      open: cur.filter((e) => e.open).length,
      overdue: key === "onTime" ? overdueCounts(cur) : null,
      rows: cur.length,
      reason,
      sentence: measureSentence(key, t, cur, days, reason, fmt),
      prior: p,
      priorSentence: priorSentence(key, p, days, fmt),
      listed:
        key === "credits" && t.outcome === "too_few" && cur.length > 0
          ? [...cur].sort(newestFirst)
          : null,
    };
    if (key === "replyTime" && t.outcome === "answered")
      result.slowestHours = Math.max(
        ...cur.filter((e) => e.counted).map((e) => e.hours as number),
      );
    return result;
  });

  const everyRegisterAnswered = measures.every(
    (m) => m.outcome !== "could_not_read",
  );
  const quiet =
    everyRegisterAnswered &&
    MEASURE_KEYS.every(
      (k) =>
        perMeasure[k].entries.filter((e) => e.window === "current").length ===
        0,
    );

  const entries = MEASURE_KEYS.flatMap((k) => perMeasure[k].entries).sort(
    newestFirst,
  );

  return {
    card: {
      providerId,
      providerName,
      window: {
        days,
        from: new Date(b.from).toISOString(),
        to: new Date(b.to).toISOString(),
        priorFrom: new Date(b.priorFrom).toISOString(),
      },
      house: houseClock(house),
      measures,
      quiet,
      fact: cardFact(measures[0], quiet, days),
      alerting: { built: false, sentence: ALERTING_SENTENCE },
    },
    entries,
  };
}

function fromRegister<T>(
  read: RegisterRead<T>,
  build: (rows: T[]) => DocketEntry[],
): {
  entries: DocketEntry[];
  blocked: MeasureOutcome | null;
  reason: string | null;
} {
  if (!read.ok)
    return { entries: [], blocked: "could_not_read", reason: read.reason };
  if (!read.collected)
    return { entries: [], blocked: "not_collected", reason: null };
  return { entries: build(read.rows), blocked: null, reason: null };
}

/**
 * The card's one fact — "Percent with count" (question 3): "86% on time · 12
 * of 14". An order still out past its date is IN that count as late once
 * someone here has said "Not yet"; the suffix says how many of the late ones
 * have still not landed, so a late landing and a missing order do not read
 * alike, and how many past their date nobody has answered for — those are
 * "unconfirmed, not counted".
 */
function cardFact(
  onTime: MeasureResult,
  quiet: boolean,
  days: WindowDays,
): { text: string; outcome: MeasureOutcome } {
  const o = onTime.overdue ?? { confirmed: 0, unconfirmed: 0, incomplete: 0 };
  const suffix =
    (o.confirmed > 0 ? COPY.fact.overdue(o.confirmed) : "") +
    (o.unconfirmed > 0 ? COPY.fact.unconfirmed(o.unconfirmed) : "");
  switch (onTime.outcome) {
    case "answered":
      return {
        text:
          COPY.fact.answered(
            onTime.percent as string,
            onTime.hits as number,
            onTime.sample,
          ) + suffix,
        outcome: "answered",
      };
    case "could_not_read":
      return { text: COPY.fact.couldNotRead, outcome: "could_not_read" };
    case "not_collected":
      return { text: COPY.fact.notCollected, outcome: "not_collected" };
    default:
      if (quiet) return { text: COPY.fact.quiet(days), outcome: "too_few" };
      if (onTime.sample === 0)
        return { text: COPY.fact.none(days) + suffix, outcome: "too_few" };
      return {
        text: COPY.fact.tooFew(onTime.sample) + suffix,
        outcome: "too_few",
      };
  }
}

/** The Docket's filter: this measure's entries in the current window, newest first. */
export function docketFor(
  built: BuiltScorecard,
  measure: MeasureKey | null,
): DocketEntry[] {
  return built.entries.filter(
    (e) =>
      e.window === "current" && (measure === null || e.measure === measure),
  );
}

export function isWindowDays(n: number): n is WindowDays {
  return (WINDOW_DAYS as readonly number[]).includes(n);
}

export function isMeasureKey(s: string): s is MeasureKey {
  return (MEASURE_KEYS as readonly string[]).includes(s);
}
