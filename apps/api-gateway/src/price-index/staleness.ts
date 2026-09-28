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
 * Whose clock `issued_at` came from (ADR 0117 Q27, `issued_at_basis`).
 *
 * `issuer_stated` is the only basis a periodical may carry. `fetch_date` says
 * nobody published a date and the column holds the day WE read the page.
 */
export type IssuedAtBasis = "issuer_stated" | "fetch_date";

/**
 * Decide whether a run is too old to admit.
 *
 *  - No readable issue date  → refused. A sighting without an issuer's date is
 *    not a sighting (ADR 0117), and is never treated as fresh.
 *  - age > maxAgeDays        → refused. The bh_fv020.txt case.
 *  - otherwise               → admitted.
 *
 * `basis` (added 2026-09-05 on the founder's answer to Q27): a `fetch_date`
 * row's `issued_at` is our own read date, so ageing it against `maxAgeDays`
 * would be measuring our clock against itself — it is fresh by construction and
 * the gate would be vacuous for the whole class. Such a row is aged from
 * `readAt` instead: the question stops being "how old is this edition" and
 * becomes "how long since we last looked", which is a real question with a real
 * answer, and it refuses at the same cadence bound. `readAt` defaults to
 * `issuedAt` because for a shop row they are the same day at the moment of
 * writing and diverge only as the row sits in the register.
 *
 * Omitting `basis` keeps the old behaviour exactly, so every existing caller is
 * unchanged: a periodical is aged from the issuer's date, as it must be.
 */
export function refuseStale(
  issuedAt: string | null,
  maxAgeDays: number,
  today: Date = new Date(),
  opts: { basis?: IssuedAtBasis | null; readAt?: string | null } = {},
): StaleVerdict {
  if (opts.basis === "fetch_date") {
    const readAt = opts.readAt ?? issuedAt;
    const sinceRead = stalenessDays(readAt, today);
    if (sinceRead === null) {
      return {
        stale: true,
        ageDays: null,
        reason:
          "the row is dated by our own read and carries no readable read date, so nothing about its age can be stated",
      };
    }
    if (sinceRead > maxAgeDays) {
      return {
        stale: true,
        ageDays: sinceRead,
        reason: `nobody published a date for this price and we last read it ${sinceRead} days ago, past the ${maxAgeDays}-day cadence this source is allowed (a read is not a publication)`,
      };
    }
    return { stale: false, ageDays: sinceRead, reason: null };
  }
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
