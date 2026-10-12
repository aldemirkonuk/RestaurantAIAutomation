import { isKnownTimeZone } from "../calendar/reminder-window";

/**
 * At sign-up a new house's timezone is the zone the person's BROWSER
 * reported, validated here, or nothing at all (founder item 62, 2026-09-27,
 * verbatim: "Browser zone, else none (Recommended)"; rejected "Save nothing"
 * — which would have thrown the browser's answer away even when it was
 * good — and rejected "Keep New York default").
 *
 * [Amended 2026-10-12 by ADR 0304 PR-2 (F-1519): the two sign-up routes no
 * longer write this function's answer directly. They write
 * `newHouseZoneColumns` (below), which follows `newHouseZone`: the
 * country's own zone; else, when there is no country or `Intl` lists no
 * zones for it, the browser's; else the browser's when it is one of the
 * country's or its listed territories' clocks (`TERRITORIES`, below);
 * else none. The browser's also stands over the country's own when it is
 * one of those territories' clocks. Each is written with its source. This
 * function still validates the browser's zone inside that.]
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

/**
 * ADR 0304 F1: the one-clock countries whose `Intl` list names more than one
 * zone (Germany lists Europe/Busingen too). The founder's answer, "Name the
 * capital's zone (Recommended)", 2026-10-05.
 */
const ONE_CLOCK_CAPITALS: Readonly<Record<string, string>> = {
  DE: "Europe/Berlin",
  AR: "America/Argentina/Buenos_Aires",
  CY: "Asia/Nicosia",
  KZ: "Asia/Almaty",
  MY: "Asia/Kuala_Lumpur",
  MH: "Pacific/Majuro",
  UZ: "Asia/Tashkent",
};

/**
 * The zone a house's COUNTRY names on its own, or null (ADR 0304 step 1, the
 * address, which comes before the device). A country with exactly one zone
 * in Node's `Intl` names it; a one-clock country of F1 names its capital. A
 * country with several clocks names none here, and the United States names a
 * zone only through its state, which is ADR 0304 PR-2's to build, so it
 * names none here either.
 */
export function zoneOfCountry(code: string | null | undefined): string | null {
  if (!code || code === "US") return null;
  const capital = ONE_CLOCK_CAPITALS[code];
  if (capital) return capital;
  const zones = zonesOf(code);
  return zones.length === 1 ? resolveSignUpTimezone(zones[0]) : null;
}

/** `Intl`'s zones for a country code; empty when the engine will not say. */
function zonesOf(code: string): string[] {
  try {
    const locale = new Intl.Locale(`und-${code}`) as Intl.Locale & {
      timeZones?: string[];
      getTimeZones?: () => string[];
    };
    return locale.timeZones ?? locale.getTimeZones?.() ?? [];
  } catch {
    return [];
  }
}

/**
 * ADR 0304 Reading 1: places addressed under a country's name that keep
 * another clock. A device inside one of them is the more specific answer,
 * so the address does not override it (and "the address always wins" is
 * that ADR's rejected alternative 16).
 */
const TERRITORIES: Readonly<Record<string, readonly string[]>> = {
  FR: ["RE", "MQ", "GP", "GF", "YT", "PM", "BL", "MF", "NC", "PF", "WF", "TF"],
  NL: ["BQ", "CW", "AW", "SX"],
  DK: ["FO", "GL"],
  GB: ["GI", "FK", "BM", "KY", "VG", "MS", "TC", "AI", "SH", "IO", "PN", "GS"],
  TR: ["CY"],
};

/**
 * A new house's zone and where it came from (ADR 0304's order, for the
 * countries this file can read): the country's own zone, unless the device
 * sits in one of that country's territories; else the device's zone when it
 * is one of the country's own clocks; else none. A device in another country
 * is not this house's clock (F-1400): a Madrid house added from an Istanbul
 * laptop reads "time zone not set" rather than Istanbul's.
 */
export function newHouseZone(
  countryCode: string | null | undefined,
  deviceZone: string | null | undefined,
): { zone: string | null; fromAddress: boolean } {
  const device = resolveSignUpTimezone(deviceZone);
  const inPlace = (code: string) =>
    device !== null && zonesOf(code).includes(device);
  const address = zoneOfCountry(countryCode);
  const territories = TERRITORIES[countryCode ?? ""] ?? [];
  if (address) {
    return territories.some(inPlace)
      ? { zone: device, fromAddress: false }
      : { zone: address, fromAddress: true };
  }
  // No country, or one the engine lists no zones for: the device, as before.
  if (!countryCode || zonesOf(countryCode).length === 0) {
    return { zone: device, fromAddress: false };
  }
  return {
    zone: inPlace(countryCode) || territories.some(inPlace) ? device : null,
    fromAddress: false,
  };
}

/** The three `restaurants` columns a new house's zone is written as. */
export type NewHouseZoneColumns = {
  timezone: string | null;
  timezone_source: "address" | "device" | null;
  timezone_source_zone: string | null;
};

/**
 * ADR 0304 PR-2 for the two sign-up routes (F-1519): the zone `newHouseZone`
 * picks, with the source the `restaurants_timezone_source_known` CHECK
 * binds to it. `address` when the country named it, `device` when the
 * device's zone stood, and no source when there is no zone. A source names
 * the zone it vouches for, so `timezone_source_zone` is always the same
 * value as `timezone` or null with it. `countryCode` is an ISO 3166-1
 * alpha-2 code; the caller resolves the form's country text to it.
 */
export function newHouseZoneColumns(
  countryCode: string | null | undefined,
  deviceZone: string | null | undefined,
): NewHouseZoneColumns {
  const { zone, fromAddress } = newHouseZone(countryCode, deviceZone);
  if (zone === null) {
    return {
      timezone: null,
      timezone_source: null,
      timezone_source_zone: null,
    };
  }
  return {
    timezone: zone,
    timezone_source: fromAddress ? "address" : "device",
    timezone_source_zone: zone,
  };
}
