/**
 * What a team write must check about its own input before it is saved
 * (QA round 4 B6, B7, B8). Pure, so each rule is tested on its own.
 */
import { BadRequestException } from "@nestjs/common";
import { listsRole } from "./pay-rules";

/** "HH:MM", or "HH:MM:SS" as Postgres prints a `time` back. */
export const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** The longest time-off request one write may file. */
export const TIME_OFF_MAX_DAYS = 365;

/** A real calendar day written as YYYY-MM-DD; "2026-02-30" is not one. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * The Monday of the week a `weekStart` query names. A missing or impossible
 * date is a 400 (it was a RangeError, a 500); any other real day reads the
 * week it falls in, not a Wednesday-to-Tuesday span no schedule row matches.
 */
export function weekStartFromQuery(value: unknown): string {
  if (!isCalendarDate(value)) {
    throw new BadRequestException(
      `weekStart must be a date like 2026-09-07; got "${String(value ?? "")}".`,
    );
  }
  const d = new Date(value + "T00:00:00Z");
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

/** Minutes since midnight of a clock time already checked by `CLOCK_TIME`. */
function clockMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * A shift's span in minutes from 1970-01-01, ending the next day when it ends
 * at or before its start (a closing shift, 18:00 to 02:00).
 */
export function shiftSpan(
  date: string,
  start: string,
  end: string,
): [number, number] {
  const day = Math.round(new Date(date + "T00:00:00Z").getTime() / 60_000);
  const from = day + clockMinutes(start);
  let to = day + clockMinutes(end);
  if (to <= from) to += 24 * 60;
  return [from, to];
}

/** Two spans share a minute. Touching ends (17:00 and 17:00) do not. */
export function spansOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/**
 * A shift's times, refused in words when they are not clock times or when
 * the shift would last no time at all. `toMinutes("banana")` used to give 0
 * and "25:99" 1599, and both were saved.
 */
export function shiftTimesRefusal(start: string, end: string): string | null {
  if (!CLOCK_TIME.test(start) || !CLOCK_TIME.test(end)) {
    return `Shift times must be clock times like 09:00; got "${start}" to "${end}". Nothing was saved.`;
  }
  if (clockMinutes(start) === clockMinutes(end)) {
    return `A shift cannot start and end at ${start.slice(0, 5)}. Nothing was saved.`;
  }
  return null;
}

/** Time-off days, refused when they run backwards or past a year (no table CHECK). */
export function timeOffRefusal(startDate: string, endDate: string): string | null {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
    return "Time off needs real dates like 2026-09-07. Nothing was saved.";
  }
  if (endDate < startDate) {
    return `Time off cannot end (${endDate}) before it starts (${startDate}). Nothing was saved.`;
  }
  const days =
    (new Date(endDate + "T00:00:00Z").getTime() -
      new Date(startDate + "T00:00:00Z").getTime()) /
      86_400_000 +
    1;
  if (days > TIME_OFF_MAX_DAYS) {
    return `One request can cover at most ${TIME_OFF_MAX_DAYS} days; this one covers ${days}. Nothing was saved.`;
  }
  return null;
}

/** A certificate as the claim check reads it. */
export interface ClaimCertificate {
  cert_type: string;
  expires_at?: string | null;
}

/**
 * Why a staff member may not take an open shift for themselves, or `null`
 * when they may (QA round 4 B5, last clause). Two rules, from what the house
 * records:
 *
 *   role        - the shift names a role their position and skills do not
 *                 list (the hand-over's role rule, `listsRole`).
 *   certificate - a certificate on their file runs out before the shift's
 *                 day (`expires_at` earlier than `shift_date`; a certificate
 *                 is good through its expiry day). The stored `status` is not
 *                 read: it is worked out when the row is written and goes
 *                 stale.
 *
 * A shift records no certificate it needs (no column), so "the certificate
 * this shift needs" cannot be asked; a lapsed one on file is what the house
 * can see. A manager can still give the shift to the person by hand; the
 * sentence says so.
 */
export function claimRefusal(
  shift: { shift_date: string; role?: string | null },
  member: { position?: string | null; skills?: readonly string[] | null },
  certificates: readonly ClaimCertificate[],
): string | null {
  const askManager = "A manager can still give it to you. Nothing was changed.";
  if (!listsRole(member, shift.role)) {
    return (
      `This shift is for ${String(shift.role).trim()}, and your position and ` +
      `skills on the team do not list it. ${askManager}`
    );
  }
  const day = String(shift.shift_date ?? "").slice(0, 10);
  const lapsed = (certificates ?? [])
    .filter((c) => isCalendarDate(String(c?.expires_at ?? "").slice(0, 10)))
    .filter((c) => String(c.expires_at).slice(0, 10) < day)
    .sort((a, b) => String(a.expires_at).localeCompare(String(b.expires_at)));
  if (lapsed.length > 0) {
    const c = lapsed[0];
    const name = String(c.cert_type ?? "").replace(/_/g, " ").trim();
    return (
      (name ? `Your ${name} certificate` : "A certificate of yours") +
      ` on file runs out on ` +
      `${String(c.expires_at).slice(0, 10)}, before this shift on ${day}. ` +
      askManager
    );
  }
  return null;
}
