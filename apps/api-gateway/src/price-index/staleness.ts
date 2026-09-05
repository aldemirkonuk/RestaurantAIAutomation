/**
 * The staleness gate — the one thing standing between the register and a live
 * 200 that serves a year-old file.
 *
 * THE FAULT THIS EXISTS FOR (measured 2026-09-04)
 * -----------------------------------------------
 * `https://www.ams.usda.gov/mnreports/bh_fv020.txt` returned HTTP 200 carrying
 * a report headed "BOSTON Terminal Prices as of 03-JAN-2024" — 975 days stale —
 * announcing its migration only in prose in the body. A fetcher that read the
 * status code as freshness would have written January-2024 prices as today's.
 *
 * So: a run is dated by the ISSUER's own date, never by the fetch. `refuseStale`
 * compares the newest issuer date against today and refuses the whole run when
 * it exceeds the source's cadence bound. A stale source produces an explicit
 * refusal, never a quiet parse. This is the TypeScript twin of the same gate in
 * `scripts/fetch_price_sightings.py`.
 */

/** Only `"true"` and `"1"` (trimmed, lower-cased) arm the scheduled fetch. */
export const PRICE_INDEX_FETCH_FLAG = "PRICE_INDEX_FETCH_ENABLED";

/**
 * Allow-list, deliberately: a typo leaves the fetch OFF (silence, recoverable),
 * never ON (a live outbound crawler, not). Mirrors `calendarRemindersArmed`.
 */
export function priceIndexFetchArmed(raw?: string | null): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1";
}

/** Whole days between an ISO date and a reference day, or null if unparseable. */
export function stalenessDays(issuedAt: string | null, today: Date): number | null {
  if (!issuedAt) return null;
  const d = new Date(`${issuedAt.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const ref = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  return Math.floor((ref.getTime() - d.getTime()) / 86_400_000);
}

export interface StaleVerdict {
  stale: boolean;
  ageDays: number | null;
  reason: string | null;
}

/**
 * Decide whether a run is too old to admit.
 *
 *  - No readable issue date  → refused. A sighting without an issuer's date is
 *    not a sighting (ADR 0117), and is never treated as fresh.
 *  - age > maxAgeDays        → refused. The bh_fv020.txt case.
 *  - otherwise               → admitted.
 */
export function refuseStale(
  issuedAt: string | null,
  maxAgeDays: number,
  today: Date = new Date(),
): StaleVerdict {
  const ageDays = stalenessDays(issuedAt, today);
  if (ageDays === null) {
    return {
      stale: true,
      ageDays: null,
      reason:
        "the run carries no issue date this parser could read; an undated posting is not a sighting",
    };
  }
  if (ageDays > maxAgeDays) {
    return {
      stale: true,
      ageDays,
      reason: `the newest posting is ${ageDays} days old, past the ${maxAgeDays}-day cadence this source is allowed (a 200 OK is not freshness)`,
    };
  }
  return { stale: false, ageDays, reason: null };
}
