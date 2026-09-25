/**
 * `GET /house/day` — sketch 119 direction E's day line, built as a PAGE
 * element (the founder's pick of 2026-09-21: D is the shell, E's day line
 * rides on the dashboard and the receiving page as their own first line, not
 * chrome). One read, each register answering for itself — the exact shape
 * discipline `house-counter.types.ts` established: a register that could not
 * be read is never a zero, and there is no top-level total.
 *
 * REDUCED SCOPE, THIS SESSION — stated, not hidden (CLAUDE.md §0.5)
 * -------------------------------------------------------------------------
 * The sketch names SIX registers (delivery-expected, delivery-arrived,
 * calendar, shifts, reminders, market). This ships THREE:
 *
 *   - `deliveryArrived` — real data, real time-of-day (`countedAt` on
 *     `procurement_receipt_events`, already read by the counter).
 *   - `calendar` and `reminders` — real data, real time-of-day
 *     (`calendar_events.event_time`), one shared read.
 *
 * NOT built, and why (none of these is "forgot" — each is its own decision):
 *
 *   - `deliveryExpected` — the sketch's own README says this outright:
 *     "capturing the vendor's promised window is new work this sketch has
 *     not costed" — `procurement_orders.expected_delivery_date` is a DATE,
 *     never a time, and no endpoint lists orders in transit. Building a new
 *     capture surface for a vendor's promised window is a decision of its
 *     own, not a corollary of "build the day line."
 *   - `shifts` — real schema (`shifts.start_time`/`end_time`), but a
 *     correct read needs the restaurant's LOCAL "today" to pick the right
 *     ISO week (`getWeek`/`getMyWeek` take a Monday `weekStart`) and a
 *     role-based choice between them (`getWeek` is manager-gated,
 *     `getMyWeek` is what staff would fall back to and only returns their
 *     OWN shifts + open ones) — a bounded, well-scoped follow-up, not a
 *     one-line addition to this file's three loaders.
 *   - `market` — the standing rule repeated for this lane: the Judge/market
 *     row appears ONLY once its register exists. No `not_built` placeholder
 *     entry either, matching the counter's OWN precedent (it has no eighth
 *     register for the thing it does not read) rather than the sketch's
 *     drawn `"N of 6 · 1 not built"` frame, which is the idealised design,
 *     not the founder's standing instruction.
 *
 * So the response below counts registers OUT OF THREE, not six — the same
 * honesty shape as the counter (7 real registers, never framed against a
 * bigger number for something unbuilt).
 */

export type DayRegisterKey = "deliveryArrived" | "calendar" | "reminders";

export const DAY_REGISTERS: readonly DayRegisterKey[] = [
  "deliveryArrived",
  "calendar",
  "reminders",
];

/** A tick: one fixed point on the line, open to its record. */
export interface DayTick {
  id: string;
  /** The instant this tick sits at — a UTC ISO string. */
  at: string;
  label: string;
  /** Where the tick opens to (a web route). `null` when it has none. */
  href: string | null;
}

interface DayRegisterBase {
  key: DayRegisterKey;
  /** When THIS register's read finished (or was refused/timed out). */
  readAt: string;
  ms: number;
}

export interface DayRegisterAnswered extends DayRegisterBase {
  state: "answered";
  /** How many ticks today, as read (before any UI cap). */
  count: number;
  complete: boolean;
  ticks: DayTick[];
}

export interface DayRegisterRefused extends DayRegisterBase {
  state: "refused";
  sentence: string;
}

export interface DayRegisterUnreadable extends DayRegisterBase {
  state: "unreadable";
  status: number | null;
  sentence: string;
}

export type DayRegister =
  | DayRegisterAnswered
  | DayRegisterRefused
  | DayRegisterUnreadable;

/**
 * The service window(s) for today, from `restaurants.operating_hours` +
 * `timezone` (`common/operating-hours/operating-hours.ts`, ADR 0093 D1).
 *
 * `not_recorded` covers BOTH "hours are null" and "timezone is null" — the
 * day line degrades to ticks-only either way (the sketch's frame 05) and a
 * v1 does not need to distinguish which fact is missing; `sentence` says
 * which one it was, for a caller that wants to draw the right "Set …" link.
 */
export interface DayHours {
  state: "recorded" | "not_recorded" | "unreadable";
  /**
   * Windows intersecting TODAY in the house's own timezone, clipped to
   * [start of today, start of tomorrow) — never a window from yesterday
   * printed whole, and a window that runs past midnight keeps its tail
   * (the sketch's TR-house test).
   */
  windows: Array<{ startAt: string; endAt: string }>;
  sentence?: string;
}

export interface HouseDayResponse {
  readAt: string;
  house: {
    id: string;
    /** The house's own IANA zone, or null when it has none. Never defaulted. */
    timezone: string | null;
  };
  hours: DayHours;
  registers: DayRegister[];
}
