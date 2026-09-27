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
 * already run against a STORED zone before using it), and what is stored is
 * `Intl`'s own resolved name for it, not the caller's spelling:
 * `"america/new_york"` is stored as `"America/New_York"`, `"US/Eastern"` as
 * `"America/New_York"`, `"EST"` as `"America/Panama"` (Node 22.22.2, measured
 * 2026-09-27). A bare UTC offset (`"+05:00"`, `"-03:30"`, `"+0530"`) is not an
 * IANA tz-database name; Node 22's `Intl` nevertheless accepts it and resolves
 * it to itself, so it is refused here explicitly — a leading `+`/`-` on the
 * resolved name — rather than stored as a house's clock that Python's
 * `zoneinfo` cannot read. Absent, empty, unrecognised, or an offset all
 * resolve the same way: no zone is recorded (`null`).
 *
 * What a `null` zone means downstream is NOT uniform yet, and this function
 * does not change it: at `origin/main` 29ba4e820 the low-stock digest still
 * runs every house on a hard-coded New York clock
 * (`notifications/low-stock-alerts.service.ts:146,172`) whatever the column
 * holds, so a `null` written here changes nothing about the digest today. The
 * digest's move to the house's own zone with a UTC fallback is PR #488
 * (item 61, OPEN when this was written); the on-page "UTC — this house has no
 * time zone set yet" line is a further follow-up that #488's own page note
 * (`.planning/06-pages/notifications.md`) assigns to #486's lane. Other
 * readers already handle `null` themselves (`scheduled-tenants.service.ts`
 * TIMEZONE_NOT_SET; `calendar-reminders.service.ts` via `isKnownTimeZone`).
 */
export function resolveSignUpTimezone(
  timezone: string | null | undefined,
): string | null {
  if (!timezone || !isKnownTimeZone(timezone)) return null;
  const resolved = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
  }).resolvedOptions().timeZone;
  if (!resolved || /^[+-]/.test(resolved)) return null;
  return resolved;
}
