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
 * WHY THE FIGURES ARE COMPUTED FROM THE ENTRIES, AND NEVER BESIDE THEM
 * -------------------------------------------------------------------
 * "Every figure opens to its rows" is only true if the figure IS its rows. So
 * this module first turns each register's rows into dated docket entries —
 * one per delivery, door verdict, invoiced line, message wait, claim — and
 * then counts the entries. The card, the Roll Call cell and the Docket are all
 * read from one `buildVendorScorecard` call, so the tally at the top of the
 * Docket cannot disagree with the list beneath it: the spec proves
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
 * built in this change (ADR 0207 "Follow-ups").
 *
 * Pure: no database, no Nest, no clock of its own — `now` is an input.
 */

import { median } from "../../analytics/engine/statistics";
import {
  ORDER_ARRIVED_STATUSES,
  ORDER_OPEN_WITH_VENDOR_STATUSES,
  hasStatus,
} from "../../procurement/order-status";
import {
  agreedPricePerBottleForDoor,
  readStatedPriceUnit,
} from "../../procurement/agreed-price";

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
 * 5 and 5 are the numbers sketch 117 drew (README "the minimum sample is per
 * measure — 5 deliveries in the window for the delivery-borne lines, 5 replies
 * for the reply line") — placeholders the founder has not ruled on, recorded
 * as such in ADR 0207. Credits is a SUM of money, not a sampled rate: every
 * claim is on its row, so one claim is enough to print what was allowed of
 * what was asked. That choice is also the founder's to overrule.
 */
export const MINIMUM: Record<MeasureKey, { count: number; noun: string }> = {
  onTime: { count: 5, noun: "deliveries with an expected date" },
  linesAsOrdered: { count: 5, noun: "lines with a door verdict" },
  priceAsAgreed: {
    count: 5,
    noun: "invoiced lines compared with an agreed price",
  },
  replyTime: { count: 5, noun: "answered messages" },
  credits: { count: 1, noun: "claims" },
};

export const MEASURE_LABEL: Record<MeasureKey, string> = {
  onTime: "On time",
  linesAsOrdered: "Lines as ordered",
  priceAsAgreed: "Price as agreed",
  replyTime: "Reply time",
  credits: "Credits",
};

/** Which register each measure is counted from — named in every refusal. */
export const MEASURE_REGISTER: Record<MeasureKey, string> = {
  onTime: "the orders book",
  linesAsOrdered: "the receiving door's records",
  priceAsAgreed: "the verified invoices",
  replyTime: "the vendor mail register",
  credits: "the credits register",
};

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
  detected_sentiment: string | null;
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
  /** Orders that arrived (delivered_at) since the prior window began. */
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
  /** When it happened: landed, verdict given, verified, sent, opened. */
  at: string;
  window: EntryWindow;
  /** In the figure's denominator. False = listed and not counted, with why. */
  counted: boolean;
  /** In the numerator: on time / as ordered / at the agreed price / credited. Null when not a rate entry or not counted. */
  hit: boolean | null;
  /** Still waiting — a message with no reply, a claim not yet settled. */
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
  /** Credits only: money allowed and asked, one entry per currency. */
  money: { allowed: number; asked: number; currency: string | null }[] | null;
}

export interface MeasureResult extends WindowTally {
  key: MeasureKey;
  label: string;
  minimum: number;
  minimumNoun: string;
  /** Entries listed and not counted, grouped by the reason. */
  excluded: { because: string; count: number }[];
  /** Entries still waiting (unanswered messages, unsettled claims). */
  open: number;
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
}

export interface ToneReading {
  outcome: "answered" | "could_not_read";
  /** Vendor messages in the window carrying a model's tone label. */
  read: number;
  /** Vendor messages in the window. */
  messages: number;
  /** Labelled by a person. There is no such record yet, so always 0. */
  labelledByPerson: 0;
  sentence: string;
}

export interface VendorScorecard {
  providerId: string;
  providerName: string;
  window: { days: WindowDays; from: string; to: string; priorFrom: string };
  measures: MeasureResult[];
  tone: ToneReading;
  /** Nothing at all in the window and every register answered. */
  quiet: boolean;
  /** The card's one behavioural fact (MAKEOVER-VERDICTS `/providers` MERGE). */
  fact: { text: string; outcome: MeasureOutcome };
  /** No alert is built; said on every read so no reader assumes one. */
  alerting: { built: false; sentence: string };
}

export const ALERTING_SENTENCE =
  "No alert is sent from these figures. A labelled set and a shadow run come first, and neither is built yet.";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function dayLabel(dateOnly: string): string {
  // `YYYY-MM-DD` read as a calendar date, never shifted through a time zone.
  const [y, m, d] = dateOnly.slice(0, 10).split("-").map(Number);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  if (!y || !m || !d) return dateOnly;
  return `${d} ${months[m - 1]} ${y}`;
}

export function fmtHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (whole >= 48) return `${Math.round(h / 24)} d`;
  return mins === 0
    ? `${whole} h`
    : `${whole} h ${String(mins).padStart(2, "0")}`;
}

/** A money figure in its currency; a bare amount when none is recorded. */
export function fmtMoney(amount: number, currency: string | null): string {
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

// ---------------------------------------------------------------------------
// Rows -> entries, one register at a time
// ---------------------------------------------------------------------------

type Bounds = ReturnType<typeof windowBounds>;

export function onTimeEntries(
  rows: OrderArrivalRow[],
  b: Bounds,
): DocketEntry[] {
  const out: DocketEntry[] = [];
  for (const o of rows) {
    // The built rule's universe: an arrival — PARTIALLY_RECEIVED included on
    // purpose (order-status.ts: a short delivery still came through the door).
    // An order still out with the vendor past its date is listed as OPEN and
    // not counted, so a non-delivery is on the page instead of silently absent.
    if (!hasStatus(o.status, ORDER_ARRIVED_STATUSES)) {
      const past = outstandingEntry(o, b);
      if (past) out.push(past);
      continue;
    }
    const landed = ms(o.delivered_at);
    const w = whichWindow(landed, b);
    if (!w || landed === null) continue;
    const title = o.order_number || `Order ${o.id.slice(0, 8)}`;
    const base = {
      id: `onTime:${o.id}`,
      measure: "onTime" as const,
      at: o.delivered_at as string,
      window: w,
      open: false,
      title,
      source: { table: "procurement_orders", id: o.id, orderId: o.id },
    };
    if (!o.expected_delivery_date) {
      out.push({
        ...base,
        counted: false,
        hit: null,
        excludedBecause: "no expected date",
        detail:
          "Landed with no expected date on the order, so it cannot be early or late.",
        daysLate: null,
      });
      continue;
    }
    // THE BUILT RULE, verbatim (advanced-analytics.service.ts getVendorScorecard):
    // landed at or before 23:59:59 UTC on the stated expected date.
    const expected = o.expected_delivery_date.slice(0, 10);
    const deadline = new Date(`${expected}T23:59:59Z`).getTime();
    const onTime = landed <= deadline;
    const daysLate = onTime ? 0 : Math.ceil((landed - deadline) / DAY_MS);
    out.push({
      ...base,
      counted: true,
      hit: onTime,
      excludedBecause: null,
      detail: onTime
        ? `Landed by the expected date (${dayLabel(expected)}).`
        : `Landed ${plural(daysLate, "day", "days")} after the expected date (${dayLabel(expected)}).`,
      daysLate,
    });
  }
  return out;
}

/**
 * An order placed with the vendor (CONFIRMED / IN_TRANSIT) whose expected date
 * has passed and which has not landed. Dated at its deadline, listed OPEN, not
 * counted: the built rule scores arrivals, and whether a non-delivery counts as
 * late is the founder's question (ADR 0207). Before the date it is not late,
 * so it is not listed.
 */
function outstandingEntry(o: OrderArrivalRow, b: Bounds): DocketEntry | null {
  if (!hasStatus(o.status, ORDER_OPEN_WITH_VENDOR_STATUSES)) return null;
  if (!o.expected_delivery_date) return null;
  const expected = o.expected_delivery_date.slice(0, 10);
  const deadline = new Date(`${expected}T23:59:59Z`).getTime();
  if (!Number.isFinite(deadline) || deadline >= b.to) return null;
  const w = whichWindow(deadline, b);
  if (!w) return null;
  const daysPast = Math.ceil((b.to - deadline) / DAY_MS);
  return {
    id: `onTime:${o.id}`,
    measure: "onTime",
    at: new Date(deadline).toISOString(),
    window: w,
    counted: false,
    hit: null,
    open: true,
    excludedBecause:
      "past its expected date and not landed — open, not counted",
    title: o.order_number || `Order ${o.id.slice(0, 8)}`,
    detail: `Expected by ${dayLabel(expected)}; ${plural(daysPast, "day", "days")} past it and not landed.`,
    source: { table: "procurement_orders", id: o.id, orderId: o.id },
    daysLate: daysPast,
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
    const title = chosen.order_number || `Order ${orderId.slice(0, 8)}`;
    const base = {
      id: `linesAsOrdered:${orderId}`,
      measure: "linesAsOrdered" as const,
      at: chosen.occurred_at,
      window: w,
      open: false,
      title,
      source: { table: "procurement_receipt_events", id: chosen.id, orderId },
    };
    if (!verdict) {
      out.push({
        ...base,
        counted: false,
        hit: null,
        excludedBecause: "counted at the door with no verdict recorded",
        detail:
          "A count was taken at the door, but no accepted, short or refused verdict was recorded with it.",
      });
      continue;
    }
    const rejected = toNum(verdict.rejected_qty) ?? 0;
    const photographed = Boolean(verdict.damage_photo_path);
    const outcome = String(verdict.outcome).toLowerCase();
    const asOrdered = outcome === "accepted" && rejected <= 0 && !photographed;
    let detail: string;
    if (outcome === "refused") {
      const why = verdict.refusal_reason
        ? ` (${String(verdict.refusal_reason).replace(/_/g, " ")})`
        : "";
      detail = `Refused at the door${why}.`;
    } else if (outcome === "short") {
      detail = "Short at the door.";
    } else if (rejected > 0) {
      detail = `Accepted, with ${rejected} refused at the door.`;
    } else if (photographed) {
      detail = "Accepted, with damage photographed at the door.";
    } else {
      detail = "Accepted at the door as ordered.";
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
): DocketEntry[] {
  const out: DocketEntry[] = [];
  for (const o of rows) {
    const at = ms(o.match_verified_at);
    const w = whichWindow(at, b);
    if (!w) continue;
    const title = o.order_number || `Order ${o.id.slice(0, 8)}`;
    const line = agreed.get(o.id) ?? null;
    const base = {
      id: `priceAsAgreed:${o.id}`,
      measure: "priceAsAgreed" as const,
      at: o.match_verified_at as string,
      window: w,
      open: false,
      title,
      source: { table: "procurement_orders", id: o.id, orderId: o.id },
      currency: line?.currency ?? null,
    };
    const invoiced = toNum(o.invoice_unit_price);
    if (invoiced === null) {
      out.push({
        ...base,
        counted: false,
        hit: null,
        excludedBecause: "no invoiced price recorded",
        detail:
          "Verified with no invoiced unit price, so there was nothing to compare.",
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
        excludedBecause: "not checked against the agreed price",
        detail: "The verification recorded no price check for this line.",
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
        excludedBecause: "no agreed price it can be compared with",
        detail: `Not compared: ${door.reason}.`,
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
        ? "Invoiced at the agreed price."
        : diff === null
          ? "Invoiced away from the agreed price."
          : `Invoiced ${diff > 0 ? "above" : "below"} the agreed price by ${Math.abs(diff * 100).toFixed(1)}%.`,
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
): DocketEntry[] {
  const out: DocketEntry[] = [];
  const threads = new Map<
    string,
    { at: number; row: ConversationRow; dir: "out" | "in" }[]
  >();
  for (const r of rows) {
    const dir = String(r.direction ?? "").toLowerCase();
    if (dir === "outbound") {
      const status = String(r.status ?? "").toUpperCase();
      const sent = ms(r.sent_at);
      if (UNSENT_STATUSES.has(status) || sent === null) continue; // not our message yet
      const w = whichWindow(sent, b);
      if (!SENT_STATUSES.has(status)) {
        if (w)
          out.push({
            id: `replyTime:${r.id}`,
            measure: "replyTime",
            at: r.sent_at as string,
            window: w,
            counted: false,
            hit: null,
            open: false,
            excludedBecause: "the send was never confirmed",
            title: "Our message",
            detail: `Recorded as ${status ? status.toLowerCase().replace(/_/g, " ") : "no status"}, so it may never have reached them.`,
            source: {
              table: "procurement_conversations",
              id: r.id,
              orderId: null,
            },
            hours: null,
          });
        continue;
      }
      const t = threadOf(r);
      if (!t) {
        if (w)
          out.push({
            id: `replyTime:${r.id}`,
            measure: "replyTime",
            at: r.sent_at as string,
            window: w,
            counted: false,
            hit: null,
            open: false,
            excludedBecause:
              "no thread on record, so no reply can be matched to it",
            title: "Our message",
            detail:
              "Sent with no thread on the record, so no reply can be matched to it.",
            source: {
              table: "procurement_conversations",
              id: r.id,
              orderId: null,
            },
            hours: null,
          });
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
        excludedBecause: reply ? null : "no reply yet — open, not counted",
        title: "Our message",
        detail: reply
          ? `Answered in ${fmtHours(hours as number)} in the same thread.`
          : "No reply in this thread yet.",
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
    let detail: string;
    switch (c.state) {
      case "credited":
        detail = `Credited ${fmtMoney(allowed as number, currency)} of ${fmtMoney(asked, currency)} asked.`;
        break;
      case "promised": {
        const since = ms(c.promised_at) ?? (at as number);
        const days = Math.max(0, Math.floor((now.getTime() - since) / DAY_MS));
        detail = `Promised, ${plural(days, "day", "days")} ago, not recovered — promised is not recovered.`;
        break;
      }
      case "requested":
        detail = `${fmtMoney(asked, currency)} asked of the vendor; no answer recorded.`;
        break;
      case "open":
        detail = `${fmtMoney(asked, currency)} owed back; not yet asked of the vendor.`;
        break;
      case "rejected":
        detail = `The vendor refused ${fmtMoney(asked, currency)}.`;
        break;
      case "written_off":
        detail = `${fmtMoney(asked, currency)} written off by the house.`;
        break;
      default:
        detail = `State ${c.state}.`;
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
      title: `Claim ${c.id.slice(0, 8)}${c.reason ? ` · ${c.reason.replace(/_/g, " ")}` : ""}`,
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
): WindowTally {
  const counted = entries.filter((e) => e.counted);
  const sample = counted.length;
  const empty = { sample, hits: null, value: null, money: null };
  if (blocked) return { outcome: blocked, ...empty };
  if (key === "replyTime") {
    const hours = counted.map((e) => e.hours as number);
    if (sample < MINIMUM[key].count) return { outcome: "too_few", ...empty };
    return {
      outcome: "answered",
      sample,
      hits: null,
      value: median(hours),
      money: null,
    };
  }
  const hits = counted.filter((e) => e.hit === true).length;
  if (key === "credits") {
    if (sample < MINIMUM[key].count)
      return { outcome: "too_few", sample, hits, value: null, money: null };
    // One total per currency. Two monies are never added together, so a
    // vendor with claims in two currencies gets two totals and no share.
    const byCurrency = new Map<
      string | null,
      { allowed: number; asked: number }
    >();
    for (const e of counted) {
      const c = e.currency ?? null;
      const m = byCurrency.get(c) ?? { allowed: 0, asked: 0 };
      m.asked += e.amountAsked ?? 0;
      m.allowed += e.amountAllowed ?? 0;
      byCurrency.set(c, m);
    }
    const money = [...byCurrency.entries()]
      .sort(([a], [c]) => String(a ?? "").localeCompare(String(c ?? "")))
      .map(([currency, m]) => ({
        currency,
        allowed: round2(m.allowed),
        asked: round2(m.asked),
      }));
    const single = money.length === 1 ? money[0] : null;
    return {
      outcome: "answered",
      sample,
      hits,
      value: single && single.asked > 0 ? single.allowed / single.asked : null,
      money,
    };
  }
  if (sample < MINIMUM[key].count)
    return { outcome: "too_few", sample, hits, value: null, money: null };
  return {
    outcome: "answered",
    sample,
    hits,
    value: hits / sample,
    money: null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const NOT_COLLECTED: Record<MeasureKey, string> = {
  onTime:
    "No order in this house carries an expected delivery date, so no delivery can be on time or late. Not late — unknown.",
  linesAsOrdered:
    "No delivery in this house has been received through the door yet, so there is no verdict to count. Not clean — unknown.",
  priceAsAgreed:
    "No invoice in this house has been verified against its order yet, so no price has been compared. Not at the agreed price — unknown.",
  replyTime:
    "No vendor mail is recorded for this house, so reply times cannot be measured. Not slow — unknown.",
  credits:
    "No credit claim has ever been recorded for this house, so nothing has been asked back or recovered.",
};

function measureSentence(
  key: MeasureKey,
  t: WindowTally,
  cur: DocketEntry[],
  days: WindowDays,
  reason: string | null,
): string {
  if (t.outcome === "could_not_read")
    return `${capital(MEASURE_REGISTER[key])} did not answer (${reason ?? "no reason given"}). This line is unknown, not zero.`;
  if (t.outcome === "not_collected") return NOT_COLLECTED[key];

  const excluded = cur.filter((e) => !e.counted && !e.open);
  const open = cur.filter((e) => e.open);
  const min = MINIMUM[key];

  if (t.outcome === "too_few") {
    if (t.sample === 0) {
      const none: Record<MeasureKey, string> = {
        onTime: `No delivery with an expected date landed in the last ${days} days — nothing to score.`,
        linesAsOrdered: `No door verdict in the last ${days} days — nothing to score.`,
        priceAsAgreed: `No invoiced line was compared with an agreed price in the last ${days} days — nothing to score.`,
        replyTime: `No answered message in the last ${days} days — nothing to score.`,
        credits: `No claim opened in the last ${days} days — nothing asked, nothing to score.`,
      };
      return [none[key], tailSentence(key, excluded, open)]
        .filter(Boolean)
        .join(" ");
    }
    return [
      `${plural(t.sample, singular(min.noun), min.noun)} in ${days} days — too few to score; ${min.count} are needed.`,
      tailSentence(key, excluded, open),
    ]
      .filter(Boolean)
      .join(" ");
  }

  const counted = cur.filter((e) => e.counted);
  let head: string;
  switch (key) {
    case "onTime": {
      const late = counted
        .filter((e) => e.hit === false)
        .map((e) => e.daysLate as number);
      head =
        `${t.hits} of ${t.sample} landed by the expected date.` +
        (late.length
          ? ` ${plural(late.length, "landed late", "landed late")}, by ${late.sort((a, c) => a - c).join(", ")} ${late.length === 1 && late[0] === 1 ? "day" : "days"}.`
          : "");
      break;
    }
    case "linesAsOrdered": {
      const misses = counted.filter((e) => e.hit === false);
      head = `${t.hits} of ${t.sample} lines had no short, refused or damaged verdict at the door.${misses.length ? ` ${plural(misses.length, "line was not", "lines were not")}.` : ""}`;
      break;
    }
    case "priceAsAgreed": {
      const above = counted.filter(
        (e) => e.hit === false && (e.invoiced ?? 0) > (e.agreed ?? 0),
      ).length;
      const below = counted.filter(
        (e) => e.hit === false && (e.invoiced ?? 0) < (e.agreed ?? 0),
      ).length;
      head = `${t.hits} of ${t.sample} invoiced lines were at the agreed price.${above ? ` ${above} above it.` : ""}${below ? ` ${below} below it.` : ""}`;
      break;
    }
    case "replyTime": {
      const slowest = Math.max(...counted.map((e) => e.hours as number));
      head = `Median ${fmtHours(t.value as number)} from our message to their next reply in the same thread, over ${plural(t.sample, "reply", "replies")}. Slowest ${fmtHours(slowest)}.`;
      break;
    }
    case "credits": {
      const money = t.money ?? [];
      head =
        `${money.map((m) => `${fmtMoney(m.allowed, m.currency)} recovered by credit memo of ${fmtMoney(m.asked, m.currency)} asked`).join("; ")}, on ${plural(t.sample, "claim", "claims")}; ${t.hits} credited.` +
        (money.length > 1
          ? " Money in two currencies is not added together, so each is its own total."
          : "") +
        (money.some((m) => m.currency === null)
          ? " The currency is not recorded on the order behind a claim, so its amount is printed with none."
          : "");
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
  const groups = groupExcluded(excluded);
  for (const g of groups)
    parts.push(
      `${g.count} ${g.count === 1 ? "is" : "are"} listed and not counted: ${g.because}.`,
    );
  if (open.length) {
    if (key === "onTime")
      parts.push(
        `${plural(open.length, "order is", "orders are")} past the expected date and not landed — not counted, not forgotten.`,
      );
    else if (key === "replyTime")
      parts.push(
        `${plural(open.length, "message has", "messages have")} no reply yet — not counted, not forgotten.`,
      );
    else if (key === "credits")
      parts.push(
        `${plural(open.length, "claim is", "claims are")} still open or promised — in what was asked, not in what was recovered.`,
      );
  }
  return parts.join(" ");
}

function groupExcluded(
  entries: DocketEntry[],
): { because: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) {
    const k = e.excludedBecause ?? "not counted";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([because, count]) => ({ because, count }));
}

function singular(noun: string): string {
  const map: Record<string, string> = {
    "deliveries with an expected date": "delivery with an expected date",
    "lines with a door verdict": "line with a door verdict",
    "invoiced lines compared with an agreed price":
      "invoiced line compared with an agreed price",
    "answered messages": "answered message",
    claims: "claim",
  };
  return map[noun] ?? noun;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function tallyText(key: MeasureKey, t: WindowTally): string {
  if (key === "replyTime")
    return `${fmtHours(t.value as number)} median · ${plural(t.sample, "reply", "replies")}`;
  if (key === "credits" && t.money)
    return t.money
      .map(
        (m) =>
          `${fmtMoney(m.allowed, m.currency)} of ${fmtMoney(m.asked, m.currency)}`,
      )
      .join(" · ");
  return `${t.hits} of ${t.sample}`;
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
): string {
  const label = `prior ${days} d`;
  if (prior.outcome === "could_not_read") return `${label} · could not be read`;
  if (prior.outcome === "not_collected") return `${label} · not collected`;
  if (prior.outcome === "too_few")
    return prior.sample === 0
      ? `${label} · nothing to compare with`
      : `${label} · ${prior.sample} — too few to compare`;
  return `${label} · ${tallyText(key, prior)}`;
}

// ---------------------------------------------------------------------------
// The whole card
// ---------------------------------------------------------------------------

export interface BuildInput {
  providerId: string;
  providerName: string;
  days: WindowDays;
  now: Date;
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

export function buildVendorScorecard(input: BuildInput): BuiltScorecard {
  const { providerId, providerName, days, now, registers: R } = input;
  const b = windowBounds(now, days);

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
      onTimeEntries(forVendor(rows, providerId), b),
    ),
    linesAsOrdered: fromRegister(R.door, (rows) =>
      doorEntries(forVendor(rows, providerId), b),
    ),
    priceAsAgreed: !R.agreedLines.ok
      ? {
          entries: [],
          blocked: "could_not_read",
          reason: `the agreed lines did not answer: ${R.agreedLines.reason}`,
        }
      : fromRegister(R.verified, (rows) =>
          priceEntries(forVendor(rows, providerId), agreedMap, b),
        ),
    replyTime: fromRegister(R.mail, (rows) =>
      replyEntries(forVendor(rows, providerId), b),
    ),
    credits: fromRegister(R.credits, (rows) =>
      creditEntries(forVendor(rows, providerId), b, now),
    ),
  };

  const measures: MeasureResult[] = MEASURE_KEYS.map((key) => {
    const { entries, blocked, reason } = perMeasure[key];
    const cur = entries.filter((e) => e.window === "current");
    const pri = entries.filter((e) => e.window === "prior");
    const t = tally(key, cur, blocked);
    const p = tally(key, pri, blocked);
    const result: MeasureResult = {
      key,
      label: MEASURE_LABEL[key],
      ...t,
      minimum: MINIMUM[key].count,
      minimumNoun: MINIMUM[key].noun,
      excluded: groupExcluded(cur.filter((e) => !e.counted && !e.open)),
      open: cur.filter((e) => e.open).length,
      rows: cur.length,
      reason,
      sentence: measureSentence(key, t, cur, days, reason),
      prior: p,
      priorSentence: priorSentence(key, p, days),
    };
    if (key === "replyTime" && t.outcome === "answered")
      result.slowestHours = Math.max(
        ...cur.filter((e) => e.counted).map((e) => e.hours as number),
      );
    return result;
  });

  const tone = toneReading(R.mail, providerId, b);
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
    (a, c) => (ms(c.at) ?? 0) - (ms(a.at) ?? 0),
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
      measures,
      tone,
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

function toneReading(
  mail: RegisterRead<ConversationRow>,
  providerId: string,
  b: Bounds,
): ToneReading {
  if (!mail.ok)
    return {
      outcome: "could_not_read",
      read: 0,
      messages: 0,
      labelledByPerson: 0,
      sentence: `The vendor mail register did not answer (${mail.reason}).`,
    };
  const inbound = mail.rows.filter(
    (r) =>
      r.provider_id === providerId &&
      String(r.direction ?? "").toLowerCase() === "inbound" &&
      whichWindow(ms(r.received_at), b) === "current",
  );
  const LABELS = new Set(["positive", "neutral", "negative"]);
  const read = inbound.filter((r) =>
    LABELS.has(String(r.detected_sentiment ?? "").toLowerCase()),
  ).length;
  return {
    outcome: "answered",
    read,
    messages: inbound.length,
    labelledByPerson: 0,
    sentence:
      inbound.length === 0
        ? "No vendor message in this window, so nothing was read for tone. Tone is in no figure above."
        : `A model read the tone of ${read} of ${plural(inbound.length, "vendor message", "vendor messages")}; no person has labelled one. Tone is in no figure above.`,
  };
}

function cardFact(
  onTime: MeasureResult,
  quiet: boolean,
  days: WindowDays,
): { text: string; outcome: MeasureOutcome } {
  // Orders past their date and not landed ride on the fact, so "5 of 5 on
  // time" can never stand beside a vendor holding orders it has not brought.
  const overdue = onTime.open > 0 ? ` · ${onTime.open} overdue` : "";
  switch (onTime.outcome) {
    case "answered":
      return {
        text: `${onTime.hits} of ${onTime.sample} on time${overdue}`,
        outcome: "answered",
      };
    case "could_not_read":
      return {
        text: "the orders book did not answer",
        outcome: "could_not_read",
      };
    case "not_collected":
      return { text: "no expected dates recorded", outcome: "not_collected" };
    default:
      if (quiet)
        return {
          text: `nothing in ${days} d — nothing to score`,
          outcome: "too_few",
        };
      if (onTime.sample === 0)
        return {
          text: `no dated deliveries in ${days} d${overdue}`,
          outcome: "too_few",
        };
      return {
        text: `${plural(onTime.sample, "delivery", "deliveries")} — too few to score${overdue}`,
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
