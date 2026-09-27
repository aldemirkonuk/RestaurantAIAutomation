import { isKnownTimeZone } from "../calendar/reminder-window";

/**
 * At sign-up a new house's timezone is the zone the person's BROWSER
 * reported, validated here, or nothing at all (founder item 62, 2026-09-27,
 * verbatim: "Browser zone, else none (Recommended)"; rejected "Save nothing"
 * — which would have thrown the browser's answer away even when it was
 * good — and rejected "Keep New York default").
 *
 * `registerRestaurant` (auth.service.ts) wrote `dto.timezone || "America/New
 * York"` until this change: an application-level re-invention of the exact
 * fault `20260903170000_a_default_is_not_an_answer.sql` (ADR 0116) had
 * already dropped from the COLUMN — `restaurants.timezone` has carried no
 * default and stayed nullable since 2026-09-03, so nothing here needed a
 * migration. The fallback in the application code kept the fabricated answer
 * alive one layer up: every house that signed up without a resolvable
 * browser zone still asserted "America/New_York" as if a human had said so.
 *
 * A caller-sent string is trusted no further than `Intl` will vouch for it
 * (`isKnownTimeZone`, `calendar/reminder-window.ts` — the same check
 * `calendar-reminders.service.ts` and `notification-producers.service.ts`
 * already run against a STORED zone before using it). Absent, empty, or not a
 * real IANA identifier all resolve the same way: no zone is recorded, and the
 * low-stock digest's existing UTC fallback and its "no time zone set yet" line
 * (item 61, PR #488) apply exactly as they do for any other house that has
 * never stated one — this function creates no new null-handling burden
 * downstream.
 */
export function resolveSignUpTimezone(
  timezone: string | null | undefined,
): string | null {
  if (!timezone) return null;
  return isKnownTimeZone(timezone) ? timezone : null;
}
