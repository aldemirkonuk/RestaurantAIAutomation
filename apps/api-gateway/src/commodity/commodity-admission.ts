/**
 * Whether a parsed run may enter the register at all.
 *
 * THREE GATES, AND THEY CATCH THREE DIFFERENT FAILURES. Collapsing them into
 * one "is this file OK" boolean is how a live 200 gets read as freshness.
 *
 *   1. THE BASE        the file's stated base against the registry's declared
 *                      base. A base change is a NEW SERIES, not a new
 *                      observation: the same index on two bases differs by
 *                      roughly fifty percent, which a step guard reads as a
 *                      crash. This is the gate that catches a REBASING, and
 *                      staleness cannot.
 *
 *   2. STALENESS       the NEWEST OBSERVATION'S OWN PERIOD against the series'
 *                      cadence bound. Never the HTTP status, never the file's
 *                      presence, and — on ONS above all — never the issuer's
 *                      release date: four ONS series return 200 with a fresh
 *                      releaseDate and a last observation of 2025 JAN. This is
 *                      the gate that catches an ABANDONED series, and the base
 *                      check cannot.
 *
 *   3. THE ADMISSION   whether a scheduled reader may be pointed at that host
 *                      at all. `upload_only` means its robots.txt could not be
 *                      read, and no gate downstream can undo that.
 *
 * The staleness arithmetic is IMPORTED from `price-index/staleness.ts` rather
 * than rewritten. A second copy of "how old is this, in whole UTC days" is a
 * second answer to the same question, and the two would drift on exactly the
 * boundary day that matters. `refuseStale`'s default basis — age the date it is
 * given against `maxAgeDays` — is precisely what a period start needs.
 */

import { refuseStale, priceIndexFetchArmed } from "../price-index/staleness";
import type { SeriesEntry } from "./commodity.registry";
import type { SeriesParseRun } from "./commodity.types";

/** Only `"true"` and `"1"` arm the scheduled fetch. Off is the safe typo. */
export const COMMODITY_FETCH_FLAG = "COMMODITY_INDEX_FETCH_ENABLED";

/**
 * Is the scheduled commodity fetch armed?
 *
 * The allow-list parser is `price-index/staleness.ts`'s, imported. The reason
 * for an allow-list rather than a deny-list is its reason too, and it is worth
 * repeating because it is the whole safety property: a typo leaves the fetch
 * OFF (silence, recoverable) and never ON (a live outbound crawler, not).
 */
export function commodityFetchArmed(raw?: string | null): boolean {
  return priceIndexFetchArmed(raw);
}

export interface AdmissionVerdict {
  admitted: boolean;
  /** A machine reason, for the run row and the tally. */
  reason:
    | "admitted"
    | "upload_only"
    | "base_changed"
    | "no_base_stated"
    | "no_observations"
    | "stale";
  /** Plain words. Every "no" carries one; a silent refusal is not a refusal. */
  detail: string | null;
  /** How old the newest observation's period is, in whole days, when known. */
  ageDays: number | null;
}

/**
 * Decide whether this run enters the register.
 *
 * `today` is passed in rather than read from a clock so the boundary days are
 * testable rather than describable.
 */
export function admitRun(
  entry: SeriesEntry,
  run: SeriesParseRun,
  today: Date,
): AdmissionVerdict {
  if (entry.admission === "upload_only") {
    return {
      admitted: false,
      reason: "upload_only",
      detail:
        entry.withheld?.reason ??
        "This series may not be fetched: its host's crawl rules could not be read. A person brings the file.",
      ageDays: null,
    };
  }

  // THE BASE, BEFORE ANYTHING ELSE. A file on the wrong base is not a stale
  // file and it is not a fresh one; it is a different series wearing this
  // series' name, and every number in it would be admitted as comparable.
  if (entry.basePeriod !== null) {
    if (run.basePeriod === null) {
      return {
        admitted: false,
        reason: "no_base_stated",
        detail: `This series is published on base ${entry.basePeriod} and the file states no base at all. An index number with no base cannot be compared with anything, including its own earlier self.`,
        ageDays: null,
      };
    }
    const stated = run.basePeriod.replace(/\s+/g, "");
    const declared = entry.basePeriod.replace(/\s+/g, "");
    if (stated !== declared) {
      return {
        admitted: false,
        reason: "base_changed",
        detail: `The file states base ${run.basePeriod} and this register holds ${entry.basePeriod}. A base change is a NEW SERIES, not a new observation — the same index on two bases differs by roughly fifty percent, which the step guard would read as a crash. Nothing was written and the series needs a person.`,
        ageDays: null,
      };
    }
  }

  if (run.observations.length === 0 || run.newestPeriodStart === null) {
    return {
      admitted: false,
      reason: "no_observations",
      detail:
        "The file parsed and produced no observation this register can admit. That is a publisher who published nothing, not a read that failed, and the two are never rendered alike.",
      ageDays: null,
    };
  }

  // Aged from the OBSERVATION'S period, which is an issuer-stated date, so the
  // default (non-fetch_date) branch of refuseStale is the right one: it is the
  // edition's age that is being asked about, not how long since we looked.
  const verdict = refuseStale(run.newestPeriodStart, entry.maxAgeDays, today);
  if (verdict.stale) {
    return {
      admitted: false,
      reason: "stale",
      detail:
        verdict.reason ??
        "The newest observation is past this series' cadence bound.",
      ageDays: verdict.ageDays,
    };
  }

  return {
    admitted: true,
    reason: "admitted",
    detail: null,
    ageDays: verdict.ageDays,
  };
}
