/**
 * When a recommendations digest falls due, what it may carry, and the token
 * that stops it. Pure: no Nest, no database, no clock of its own — so every
 * rule here is tested with a fixed instant (the shape `reminder-window.ts`
 * takes for calendar reminders, whose zone arithmetic this reuses).
 *
 * THE WALL CLOCK IS THE HOUSE'S
 * -----------------------------
 * `recommendation_digest_prefs.digest_hour` is an hour with no zone. It is read
 * on `restaurants.timezone` (carried on `ScheduledTenant.timezone`), never on
 * the server's clock: a 07:00 digest means 07:00 in Istanbul for a house in
 * Istanbul. A house with no zone set is read in UTC, and the mail says so in
 * words rather than letting "07:00" pass as the house's own morning.
 */

import { createHash, randomBytes } from "crypto";
import { zonedWallTimeToInstant } from "../../calendar/reminder-window";

/* ── arming ───────────────────────────────────────────────────────────────── */

/**
 * The single env var that arms the digest sender. OFF by default, and not wired
 * to any design flag: this job puts mail into real people's inboxes, and a flag
 * that decides what a page looks like must never decide that.
 *
 * Allow-list, copied from `CALENDAR_REMINDERS_ENABLED` / `RECURRING_ORDER_
 * REMINDERS_ENABLED`: only `true` / `1` (trimmed, lower-cased) arm it. A typo is
 * silence, and silence is the recoverable failure.
 */
export const DIGEST_SEND_FLAG = "DIGEST_SEND_ENABLED";

export function digestSendArmed(raw?: string | null): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1";
}

/* ── the category (removed) ──────────────────────────────────────────────── */

// `DIGEST_CATEGORY = "ai"` used to gate the digest a second time on
// `notification_preferences.categories.ai`, on top of the person's own
// `recommendation_digest_subscriptions` row. Removed 2026-09-19 (founder, memory
// `founder-sketch-decisions-106-115.md`, "Digest builder's choices", PR #391
// audit B2(b)): the subscription is the consent and the gate on its own; the
// `categories.ai` key stays reserved for ADR 0149 row 15 / OD-121's six
// `*_channels` categories, which this digest is not one of.

/* ── urgency ──────────────────────────────────────────────────────────────── */

export type DigestUrgency = "now" | "this_week" | "this_month";

const URGENCY_RANK: Record<DigestUrgency, number> = {
  now: 0,
  this_week: 1,
  this_month: 2,
};

export const URGENCY_WORDS: Record<DigestUrgency, string> = {
  now: "Now",
  this_week: "This week",
  this_month: "This month",
};

export function isDigestUrgency(value: unknown): value is DigestUrgency {
  return typeof value === "string" && value in URGENCY_RANK;
}

/**
 * Does an entry of `urgency` belong in a digest whose floor is `floor`?
 * `this_week` takes now + this week; `this_month` takes everything. An entry
 * whose own urgency is unrecognised is left out rather than guessed into a band.
 */
export function meetsUrgencyFloor(
  urgency: unknown,
  floor: DigestUrgency,
): boolean {
  if (!isDigestUrgency(urgency)) return false;
  return URGENCY_RANK[urgency] <= URGENCY_RANK[floor];
}

/* ── when it is due ───────────────────────────────────────────────────────── */

export type DigestFrequency = "daily" | "weekly";

export interface DigestCadence {
  frequency: DigestFrequency;
  /** ISO weekday, 1 = Monday … 7 = Sunday. Required for weekly, ignored for daily. */
  weekday: number | null;
  /** `digest_hour`, 0–23, on the house's wall clock. */
  hour: number;
}

export interface DigestDue {
  /** The instant it fell (or falls) due. */
  dueAt: Date;
  /** The house-local date it is due on — the idempotency key's period. */
  periodKey: string;
}

/** How late a digest may still go out. Past this it is recorded `expired`. */
export const DIGEST_LATE_LIMIT_MS = 12 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of `instant` on the wall clock of `timeZone`. */
export function localDateKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDate(
  key: string,
  days: number,
): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map((s) => parseInt(s, 10));
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };
}

function keyOf(p: { y: number; m: number; d: number }): string {
  return `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** ISO weekday (1 = Monday) of a calendar date. Zone-free: a date is a date. */
function isoWeekdayOf(p: { y: number; m: number; d: number }): number {
  const js = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return js === 0 ? 7 : js;
}

function dueOn(
  p: { y: number; m: number; d: number },
  hour: number,
  timeZone: string,
): DigestDue {
  return {
    dueAt: zonedWallTimeToInstant(p.y, p.m, p.d, hour, 0, timeZone),
    periodKey: keyOf(p),
  };
}

function assertCadence(c: DigestCadence): void {
  if (!Number.isInteger(c.hour) || c.hour < 0 || c.hour > 23) {
    throw new Error(
      `digest hour ${JSON.stringify(c.hour)} is not an hour of the day (0–23)`,
    );
  }
  if (c.frequency === "weekly") {
    if (
      !Number.isInteger(c.weekday) ||
      (c.weekday as number) < 1 ||
      (c.weekday as number) > 7
    ) {
      throw new Error(
        `a weekly digest needs an ISO weekday 1–7, got ${JSON.stringify(c.weekday)}`,
      );
    }
  } else if (c.frequency !== "daily") {
    throw new Error(`unknown digest frequency ${JSON.stringify(c.frequency)}`);
  }
}

/**
 * The most recent due instant at or before `now`, on the house's wall clock.
 *
 * Only the most recent one is ever considered: a sweep that has been down for
 * three days owes the person the digest that is due, not three old ones.
 */
export function mostRecentDue(
  now: Date,
  timeZone: string,
  cadence: DigestCadence,
): DigestDue {
  assertCadence(cadence);
  const today = localDateKey(now, timeZone);
  if (cadence.frequency === "daily") {
    const todays = dueOn(shiftDate(today, 0), cadence.hour, timeZone);
    return todays.dueAt.getTime() <= now.getTime()
      ? todays
      : dueOn(shiftDate(today, -1), cadence.hour, timeZone);
  }
  const wd = isoWeekdayOf(shiftDate(today, 0));
  const back = (wd - (cadence.weekday as number) + 7) % 7;
  const candidate = dueOn(shiftDate(today, -back), cadence.hour, timeZone);
  return candidate.dueAt.getTime() <= now.getTime()
    ? candidate
    : dueOn(shiftDate(today, -back - 7), cadence.hour, timeZone);
}

/** The first due instant strictly after `now`. For the status read only. */
export function nextDue(
  now: Date,
  timeZone: string,
  cadence: DigestCadence,
): DigestDue {
  const step = cadence.frequency === "daily" ? 1 : 7;
  const recent = mostRecentDue(now, timeZone, cadence);
  const base = shiftDate(recent.periodKey, step);
  // One step past the most recent due is the next one — except across a DST
  // shift that moves the wall hour, which a second step settles.
  let next = dueOn(base, cadence.hour, timeZone);
  if (next.dueAt.getTime() <= now.getTime()) {
    next = dueOn(shiftDate(keyOf(base), step), cadence.hour, timeZone);
  }
  return next;
}

/** `HH:00` for a digest hour. */
export function hourWords(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export const ISO_WEEKDAY_WORDS = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/* ── what the engine could not read ─────────────────────────────────────── */

/**
 * One sentence naming the engine sources that did not answer, or null.
 * Shared by the log row and the letter so the two cannot word it differently.
 */
export function sourcesUnreadWords(sources: string[]): string | null {
  if (sources.length === 0) return null;
  const list =
    sources.length === 1
      ? sources[0]
      : `${sources.slice(0, -1).join(", ")} and ${sources[sources.length - 1]}`;
  return `The engine could not read ${sources.length === 1 ? "one of its sources" : `${sources.length} of its sources`} (${list}), so entries that depend on ${sources.length === 1 ? "it" : "them"} could not fire.`;
}

/* ── the unsubscribe token ────────────────────────────────────────────────── */

/**
 * A fresh unsubscribe token: 32 bytes of CSPRNG, hex. Minted per mail, carried
 * only in that mail's link, stored only as its SHA-256.
 *
 * It is single-purpose by construction rather than by signature: the only thing
 * the gateway does with it is find ONE send row and stop THAT person's digest
 * from THAT house. It cannot sign anybody in, read anything but the house's name,
 * or stop any other mail. A stored hash rather than an HMAC means there is no
 * signing key to provision, rotate or leak — and a link keeps working exactly as
 * long as its send row exists.
 */
export function newUnsubscribeToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashUnsubscribeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Exactly the shape `newUnsubscribeToken` produces, and nothing else. */
export function isWellFormedUnsubscribeToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
