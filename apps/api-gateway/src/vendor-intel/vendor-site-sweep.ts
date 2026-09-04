/**
 * The scheduled vendor-site sweep — the pure half.
 *
 * The service alongside this file does the I/O: the cron trigger, the provider
 * query, the fetch, the write. Everything that DECIDES something lives here so
 * it can be tested without a network, a clock or a database — the same split
 * as `vendor-page-extraction.ts` / `vendor-page-extractor.service.ts`, and for
 * the same reason.
 *
 * Three decisions live here.
 *
 * 1. WHETHER THE SWEEP IS ARMED, and why not when it is not.
 * 2. HOW LONG TO WAIT before the next request to a host.
 * 3. WHY A VENDOR IS SILENT — the four reasons a vendor produces no sighting,
 *    as a value rather than as an absence. A vendor that was never fetched and
 *    a vendor that was fetched and yielded nothing are different facts, and
 *    the status endpoint must never let them render the same.
 */

/** The one environment variable that arms the sweep. */
export const SWEEP_ENABLED_FLAG = "VENDOR_SITE_SWEEP_ENABLED";

/**
 * Seconds between two page fetches to the SAME host, as a floor.
 *
 * WHY 10, AND WHY IT IS A FLOOR AND NOT A TARGET.
 *
 * The old `sweepCatalogue` used 2 seconds (`vendor-page-extractor.service.ts`,
 * pre-2026-09-04), chosen as "politeness" with no source. 10 is chosen from
 * the two numbers this repo has actually measured against real publishers, in
 * `.planning/07-reference/price-sources.md`: `data.oregon.gov` publishes
 * `Crawl-delay: 1`, and Socrata answers 429 to unauthenticated requests
 * sharing a per-IP pool. A wine merchant's shop is a far smaller machine than
 * a state open-data portal, and it has no published limit at all — so the
 * absence of a stated limit is treated as a reason for MORE caution, not less.
 * 10 seconds is 6 requests a minute to one host: slower than a person
 * browsing, and far below the rate that gets an IP blocked.
 *
 * It is a floor in two directions. A host's own `Crawl-delay` REPLACES it when
 * larger (ADR 0117: "the crawl delay in it is the floor") — a publisher who
 * states a limit has told us their number and ours is a guess. And it is never
 * lowered below `MIN_HOST_INTERVAL_SECONDS` by configuration, because a
 * misconfigured environment variable must not be able to turn this into a
 * hammer.
 *
 * One honest caveat, stated because it would otherwise be invisible: the
 * interval paces PAGE fetches. Each page fetch is preceded by a robots.txt
 * probe inside the same slot (`vendor-page-extractor.service.ts`), so the true
 * worst case against one host is two requests per interval, not one.
 */
export const DEFAULT_HOST_INTERVAL_SECONDS = 10;

/** Configuration may raise the interval; it may never take it below this. */
export const MIN_HOST_INTERVAL_SECONDS = 2;

/** Why a vendor produced no sighting. A value, never an absence. */
export type VendorSilenceReason =
  | "disarmed"
  | "not_yet_swept"
  | "no_website"
  | "robots_forbids"
  | "fetch_failed"
  | "nothing_priced"
  | "all_refused";

export const SILENCE_SENTENCE: Readonly<Record<VendorSilenceReason, string>> =
  Object.freeze({
    disarmed: `The sweep is switched off (${SWEEP_ENABLED_FLAG} is not set), so this vendor's site has never been read.`,
    not_yet_swept:
      "The sweep is on, and this vendor's turn has not come round in this process yet. Nothing is claimed about its prices either way.",
    no_website:
      "No website is recorded for this vendor, so there is nothing to read.",
    robots_forbids:
      "This vendor's robots.txt disallows the page, and that is honoured. Nothing was fetched.",
    fetch_failed:
      "The page could not be fetched. That is a fact about our fetcher, not about the vendor's prices.",
    nothing_priced:
      "The page was read and no priced wine could be found on it — most often a JavaScript shop this fetcher cannot see.",
    all_refused:
      "Prices were read, and every one of them was refused for missing something a sighting must name. The reasons are counted beside this line.",
  });

/**
 * Is the sweep armed?
 *
 * DEFAULT OFF, and the reason belongs in the code rather than only in a doc.
 * This job makes outbound requests to third parties in the house's name, spends
 * model tokens on every page, and writes rows into the register that four
 * readers act on. ADR 0117 left running it explicitly undecided until the
 * founder answered it; a job with those three properties that switches itself on
 * the moment it is deployed would have pre-empted that decision, and would do so
 * again on any environment that inherits this code — a staging clone, a fork, a
 * developer's laptop pointed at production. So the default is off everywhere and
 * the flag is per-environment.
 *
 * Only the exact strings below arm it. A typo, an empty value or an unset
 * variable all mean OFF, and the status endpoint says so in words: "the sweep
 * is switched off" must never be reachable from a value someone believed was on.
 */
export function isSweepArmed(rawFlag: string | undefined | null): boolean {
  if (typeof rawFlag !== "string") return false;
  const v = rawFlag.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * The interval to honour for one host, in milliseconds.
 *
 * `configuredSeconds` is clamped up to `MIN_HOST_INTERVAL_SECONDS` and a
 * host's stated `Crawl-delay` wins whenever it is larger. Nothing here can
 * produce a delay shorter than `MIN_HOST_INTERVAL_SECONDS`.
 */
export function hostIntervalMs(opts: {
  configuredSeconds?: number | null;
  crawlDelaySeconds?: number | null;
}): number {
  const configured =
    typeof opts.configuredSeconds === "number" &&
    Number.isFinite(opts.configuredSeconds)
      ? opts.configuredSeconds
      : DEFAULT_HOST_INTERVAL_SECONDS;
  const ours = Math.max(MIN_HOST_INTERVAL_SECONDS, configured);
  const theirs =
    typeof opts.crawlDelaySeconds === "number" &&
    Number.isFinite(opts.crawlDelaySeconds) &&
    opts.crawlDelaySeconds > 0
      ? opts.crawlDelaySeconds
      : 0;
  return Math.round(Math.max(ours, theirs) * 1000);
}

/**
 * How long to wait before the next request to `host`, given when we last
 * touched it.
 *
 * Returns 0 when the interval has already elapsed. Pure so the rate limit can
 * be proven with fake timers instead of by waiting.
 */
export function waitMsFor(opts: {
  lastRequestAtMs: number | null | undefined;
  nowMs: number;
  intervalMs: number;
}): number {
  const { lastRequestAtMs, nowMs, intervalMs } = opts;
  if (lastRequestAtMs === null || lastRequestAtMs === undefined) return 0;
  if (!Number.isFinite(lastRequestAtMs)) return 0;
  const elapsed = nowMs - lastRequestAtMs;
  if (elapsed >= intervalMs) return 0;
  return Math.max(0, intervalMs - elapsed);
}

/** The host a URL belongs to, lowercased, or null when the URL is unusable. */
export function hostOf(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    return new URL(url.trim()).host.toLowerCase();
  } catch {
    return null;
  }
}
