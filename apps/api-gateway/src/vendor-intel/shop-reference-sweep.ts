/**
 * The merchant-shop sweep — the pure half.
 *
 * Everything here decides something and touches nothing: whether the sweep is
 * armed, whether a host's own visit window permits a request right now, and
 * why a shop produced no posting. The I/O shell is
 * `shop-reference-sweep.service.ts`; the rate limiter itself is imported from
 * `vendor-site-sweep.ts` rather than re-implemented, because two crawlers
 * pacing themselves by two different rules against the same estate of hosts is
 * two answers to one question.
 */

/** Only these exact strings arm the shop sweep. A typo means OFF. */
export const SHOP_SWEEP_ARMING_VALUES: readonly string[] = Object.freeze([
  "true",
  "1",
  "yes",
  "on",
]);

export function isShopSweepArmed(raw: string | undefined | null): boolean {
  if (typeof raw !== "string") return false;
  return SHOP_SWEEP_ARMING_VALUES.includes(raw.trim().toLowerCase());
}

/** Why a shop produced no posting. A value, never an absence. */
export type ShopSilenceReason =
  | "disarmed"
  | "not_armed_for_this_shop"
  | "registered_unarmed"
  | "not_yet_swept"
  | "no_urls_given"
  | "outside_visit_window"
  | "robots_forbids"
  | "fetch_failed"
  | "all_refused";

export const SHOP_SILENCE_SENTENCE: Readonly<Record<ShopSilenceReason, string>> =
  Object.freeze({
    disarmed:
      "The merchant-shop sweep is switched off (PRICE_REFERENCE_SHOP_SWEEP_ENABLED is not set), so no shop has been read.",
    not_armed_for_this_shop:
      "The sweep is on, and this shop is not in PRICE_REFERENCE_SHOPS_ARMED. Nothing was fetched from it.",
    registered_unarmed:
      "This shop is registered and deliberately not fetched; the registry records the reason and the day it was measured.",
    not_yet_swept:
      "This shop is armed and its turn has not come round in this process yet. Nothing is claimed about its prices either way.",
    no_urls_given:
      "No page was named for this shop. Catalogue enumeration is deliberately not built, so a run reads the pages it is given and no others.",
    outside_visit_window:
      "The shop's robots.txt states the hours it wants to be read and now is not inside them, so nothing was fetched.",
    robots_forbids:
      "The shop's robots.txt disallows the page for our agent, and that is honoured. Nothing was fetched.",
    fetch_failed:
      "The page could not be fetched. That is a fact about our fetcher, not about the shop's prices.",
    all_refused:
      "Every page read was refused for missing something a class-D posting must name. The reasons are counted beside this line.",
  });

/**
 * A robots.txt `Visit-time` window, in UTC minutes from midnight.
 *
 * NON-STANDARD, AND HONOURED ANYWAY. `Visit-time` is not in the original
 * robots specification and almost nobody publishes it — and `www.bbr.com`
 * does: `Visit-time: 0200-0700`, measured 2026-09-05 alongside
 * `Crawl-delay: 10` and `Request-rate: 1/10`. A publisher who states the hours
 * it wants to be read has told us something specific; ignoring it because the
 * standard does not require us to would be choosing not to listen. The two
 * committed Berry Bros fixtures were fetched at 02:08Z, inside the window, and
 * this session refused to re-fetch that host at 11:14Z, outside it.
 *
 * Returns null for anything unparseable, and null means "no window stated",
 * which permits every hour. A window that fails to parse must not lock the
 * shop out silently — but it must not be invented either, so the caller is
 * told (`parseVisitTime` returns null and the raw line is kept by the caller).
 */
export function parseVisitTime(
  robotsBody: string | null | undefined,
): { startMinute: number; endMinute: number; raw: string } | null {
  if (typeof robotsBody !== "string" || !robotsBody) return null;
  const m = robotsBody.match(/^\s*visit-time\s*:\s*(\d{4})\s*-\s*(\d{4})\s*$/im);
  if (!m) return null;
  const toMinutes = (hhmm: string): number | null => {
    const h = Number(hhmm.slice(0, 2));
    const min = Number(hhmm.slice(2, 4));
    if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const start = toMinutes(m[1]);
  const end = toMinutes(m[2]);
  if (start === null || end === null || start === end) return null;
  return { startMinute: start, endMinute: end, raw: m[0].trim() };
}

/**
 * May we fetch this host now?
 *
 * `null` for the window means no window was stated, which permits every hour.
 * A window that wraps midnight (`2200-0400`) is handled: the test is
 * membership of the interval, not `start <= now <= end`.
 */
export function withinVisitWindow(
  window: { startMinute: number; endMinute: number } | null,
  now: Date,
): boolean {
  if (!window) return true;
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const { startMinute, endMinute } = window;
  if (startMinute < endMinute) return minute >= startMinute && minute < endMinute;
  // Wraps midnight.
  return minute >= startMinute || minute < endMinute;
}

/** The window a registry entry records, parsed from its `HHMM-HHMM` string. */
export function visitWindowOf(
  visitTimeUtc: string | null | undefined,
): { startMinute: number; endMinute: number } | null {
  if (typeof visitTimeUtc !== "string") return null;
  return parseVisitTime(`Visit-time: ${visitTimeUtc}`);
}
