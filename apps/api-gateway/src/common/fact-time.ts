/**
 * Whose clock dates a fact — ADR 0286.
 *
 * THE RULING
 * ----------
 * The founder, 2026-10-04 (~00:15Z, AskUserQuestion), verbatim pick: "72 h;
 * older needs a manager (Recommended)". In full: a sent time within 72 hours
 * is kept as the fact's time. An older one is kept only from an owner or a
 * manager and is marked back-dated. Applies to door receipts, counts and
 * orders.
 *
 * WHY THIS IS ONE PURE FUNCTION
 * -----------------------------
 * A phone that takes a delivery offline sends the moment of the tap when it
 * syncs. Storing the moment it SYNCED instead dated every late receipt on the
 * day it was entered: in the owner-quarter sim, the 100 newest of 549 door
 * deliveries read 2 October, 31-44 days after the tap times their phones
 * sent, and the vendor scorecard read 0 of 548 on time. The ruling covers
 * three kinds of fact, so the rule
 * lives here once rather than in each write path, where three copies of a
 * 72-hour rule would drift apart.
 *
 * THE FOUR TIMES, AND WHICH ONE THIS PICKS
 * ----------------------------------------
 *   sentAt      what the client says happened (kept as evidence even when
 *               refused — the caller stores it untouched);
 *   receivedAt  when this server received the request; the ruling's "receipt
 *               by the server", and what the 72 hours are measured from;
 *   at          the fact's time, which this function returns;
 *   entry       when the row was written (the database's own `created_at`),
 *               which the caller keeps beside `at`.
 *
 * A sent time AHEAD of the server is a wrong clock, not a fact from the
 * future. Up to five minutes ahead is ordinary drift and is clamped to the
 * receipt; more than that is not trusted at all.
 */

/** A sent time this old or newer is the fact's time (inclusive). */
export const FACT_TIME_TRUST_HOURS = 72;
export const FACT_TIME_TRUST_MS = FACT_TIME_TRUST_HOURS * 3_600_000;

/** How far ahead of the server a sent time may be and still count as drift. */
export const FACT_TIME_AHEAD_TOLERANCE_MS = 300_000;

/**
 * The roles, in the house the token names (ADR 0162/0164), whose word keeps a
 * sent time older than 72 hours. Null or any other role never back-dates.
 */
export const BACK_DATING_ROLES: readonly string[] = ["owner", "manager"];

/** Which clock dated the fact. Stored as `occurred_at_basis`. */
export type FactTimeBasis = "sent" | "back_dated" | "server";
export const FACT_TIME_BASES: readonly FactTimeBasis[] = [
  "sent",
  "back_dated",
  "server",
];

export type FactTimeReason =
  /** Sent, and no more than 72 hours before the server received it. */
  | "within_window"
  /** Sent up to five minutes ahead of the server: dated at the receipt. */
  | "clamped_ahead"
  /** Older than 72 hours, kept on an owner's or a manager's word. */
  | "back_dated"
  /** No time was sent. */
  | "not_sent"
  /** Something was sent that is not a readable instant. */
  | "unreadable"
  /** Sent more than five minutes ahead of the server: a wrong clock. */
  | "ahead"
  /** Older than 72 hours, from someone who may not back-date. */
  | "too_old";

export interface FactTime {
  /** The fact's time. */
  at: Date;
  basis: FactTimeBasis;
  /** The sent time as read, or null when none was sent or it was unreadable. */
  sentAt: Date | null;
  reason: FactTimeReason;
}

export function resolveFactTime(input: {
  sentAt?: string | null;
  receivedAt: Date;
  role?: string | null;
}): FactTime {
  const { receivedAt } = input;
  if (
    input.sentAt === undefined ||
    input.sentAt === null ||
    input.sentAt === ""
  ) {
    return {
      at: receivedAt,
      basis: "server",
      sentAt: null,
      reason: "not_sent",
    };
  }
  const sentMs = Date.parse(input.sentAt);
  if (!Number.isFinite(sentMs)) {
    return {
      at: receivedAt,
      basis: "server",
      sentAt: null,
      reason: "unreadable",
    };
  }
  const sentAt = new Date(sentMs);
  const ageMs = receivedAt.getTime() - sentMs;

  if (ageMs < 0) {
    if (-ageMs > FACT_TIME_AHEAD_TOLERANCE_MS) {
      return { at: receivedAt, basis: "server", sentAt, reason: "ahead" };
    }
    // No fact is in the future: a small drift is dated at the receipt.
    return { at: receivedAt, basis: "sent", sentAt, reason: "clamped_ahead" };
  }
  if (ageMs <= FACT_TIME_TRUST_MS) {
    return { at: sentAt, basis: "sent", sentAt, reason: "within_window" };
  }
  if (input.role && BACK_DATING_ROLES.includes(input.role)) {
    return { at: sentAt, basis: "back_dated", sentAt, reason: "back_dated" };
  }
  return { at: receivedAt, basis: "server", sentAt, reason: "too_old" };
}

/**
 * Why a STORED fact carries the time it does, read back from its row.
 *
 * The reason is not a column, because it follows from what is: the basis, the
 * sent time kept as evidence, and the time the row was dated. A retry reads it
 * back this way instead of deciding again (a retry that crosses the 72-hour
 * line must not re-date a receipt), and the bell says it in words.
 *
 * Null when the row predates the rule (no basis), or when the basis is not one
 * this rule writes.
 */
export function explainStoredFactTime(row: {
  basis: string | null | undefined;
  sentAt: string | null | undefined;
  at: string | null | undefined;
}): FactTimeReason | null {
  const sentMs = row.sentAt ? Date.parse(row.sentAt) : NaN;
  const atMs = row.at ? Date.parse(row.at) : NaN;
  switch (row.basis) {
    case "sent":
      return Number.isFinite(sentMs) && Number.isFinite(atMs) && sentMs > atMs
        ? "clamped_ahead"
        : "within_window";
    case "back_dated":
      return "back_dated";
    case "server":
      if (!Number.isFinite(sentMs))
        return row.sentAt ? "unreadable" : "not_sent";
      // A refused sent time was refused for one of two reasons, and the
      // stored times say which without re-running the 72-hour comparison.
      return Number.isFinite(atMs) && sentMs > atMs ? "ahead" : "too_old";
    default:
      return null;
  }
}
