/**
 * The FAO Food Price Index CSV, parsed.
 *
 * THE FILE, AS MEASURED (2026-09-05, HTTP 200, 48,006 bytes, sha256
 * `746104cf…c62f`; the reduced fixture and its provenance are in
 * `__fixtures__/`):
 *
 *     line 1   FAO Food Price Index,,,,,…          the title
 *     line 2   2014-2016=100,,,,,…                 THE BASE PERIOD
 *     line 3   Date,Food Price Index,Meat,Dairy,Cereals,Oils,Sugar,,,…
 *     line 4   ,,,,,…                              blank
 *     line 5+  1990-01,64.4,74.3,53.5,64.1,44.59,87.9,,,…
 *
 * Every line carries a long tail of empty columns; they are the file's, not a
 * parse artefact, and they are ignored rather than trimmed out of the fixture.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO THINGS THIS PARSER DOES THAT A CSV READER WOULD NOT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. IT READS THE BASE PERIOD BACK OUT OF THE FILE AND HANDS IT TO THE CALLER.
 *
 *    FAO serves a SECOND live CSV path — `/fileadmin/templates/worldfood/
 *    Reports_and_docs/Food_price_indices_data.csv` — which returns HTTP 200, is
 *    well-formed, is 14,225 bytes, is on base **2002-2004=100**, and whose last
 *    row is **Mar-18**. Neither path is disallowed by robots. A fetcher pointed
 *    at the second would get clean 200s forever and serve data eight and a half
 *    years old on a different base.
 *
 *    Two independent gates catch that, and they catch DIFFERENT failures:
 *    the staleness gate catches the age, and the base comparison catches the
 *    REBASING — the same index on two bases differs by roughly fifty percent,
 *    which a step guard would read as a market crash rather than as an
 *    arithmetic change. **A base change is a new series, not a new
 *    observation.** So the base is returned, the caller compares it against the
 *    registry's declared base, and a mismatch refuses the whole run.
 *
 * 2. IT REPORTS THAT THE FILE STATES NO DATE, RATHER THAN SUPPLYING ONE.
 *
 *    There is no release date, no revision date and no "generated on" line
 *    anywhere in these bytes. So `issuerReleaseDate` is null and every
 *    observation carries `issuedAtBasis: "fetch_date"` — ADR 0117 Q27's
 *    vocabulary — which makes the screen print "read on" instead of "issued".
 *    The alternative, stamping our own read date and calling it the issuer's,
 *    is the one move that would manufacture provenance in the exact place a
 *    reader looks for it.
 */

import {
  asNumber,
  observationHash,
  type SeriesObservation,
  type SeriesParseRun,
  type ObservationRefusal,
} from "./commodity.types";

/** `2026-08` — the only period spelling this file uses. */
const PERIOD = /^(\d{4})-(\d{2})$/;

/** Strip the file's trailing empty columns without touching a real value. */
function cells(line: string): string[] {
  const out = line.split(",").map((c) => c.trim());
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/**
 * Parse the whole CSV.
 *
 * `fetchedAt` is passed in rather than read from a clock, so a test asserts a
 * value instead of a shape and a re-parse of the same bytes is reproducible.
 */
export function parseFao(
  csv: string,
  opts: { seriesKey: string; fetchedAt: string },
): SeriesParseRun {
  const observations: SeriesObservation[] = [];
  const refusals: ObservationRefusal[] = [];
  // A UTF-8 BOM survives `readFileSync(..., 'utf8')` and would make the title
  // line unmatchable. Measured on the fetched bytes: this file has one.
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);

  // The base period is line 2 of the file. It is looked for in the first four
  // lines rather than at a fixed index, because a header line appearing or
  // disappearing is exactly the kind of change that should degrade to "no base
  // stated" — which the caller refuses — rather than to "the base is `Date`".
  let basePeriod: string | null = null;
  for (const line of lines.slice(0, 4)) {
    const first = cells(line)[0] ?? "";
    if (/^\d{4}(-\d{4})?\s*=\s*100$/.test(first.replace(/\s+/g, ""))) {
      basePeriod = first;
      break;
    }
  }
  if (!basePeriod) {
    refusals.push({
      reason: "no_base_stated",
      detail:
        "None of the first four lines states a base period. An index number with no base cannot be compared with anything, including its own earlier self.",
    });
  }

  let newestPeriodStart: string | null = null;
  let rowsRead = 0;

  for (const line of lines) {
    const c = cells(line);
    if (c.length === 0) continue;
    const m = PERIOD.exec(c[0]);
    if (!m) continue; // a header or the blank line, not a refusal
    rowsRead += 1;

    const value = asNumber(c[1]);
    if (value === null) {
      refusals.push({
        reason: "no_value",
        detail: `${c[0]} carries no readable index value in the Food Price Index column. An empty cell is not a zero.`,
      });
      continue;
    }
    if (value <= 0) {
      refusals.push({
        reason: "implausible_value",
        detail: `${c[0]} reads ${value}. An index on a 100 base is never zero or negative, so this is a parse fault rather than a market.`,
      });
      continue;
    }

    const periodStart = `${m[1]}-${m[2]}-01`;
    if (!newestPeriodStart || periodStart > newestPeriodStart) {
      newestPeriodStart = periodStart;
    }
    const base = {
      seriesKey: opts.seriesKey,
      periodStart,
      value,
      vintage: null as null,
    };
    observations.push({
      ...base,
      periodGrain: "month",
      // The file states no date, so ours is the only one there is — and the
      // basis says so, out loud, on every row.
      issuedAt: opts.fetchedAt,
      issuedAtBasis: "fetch_date",
      fetchedAt: opts.fetchedAt,
      // The source ref keys the dedup index. It names the FILE and the PERIOD,
      // never the fetch instant: including the instant would make every re-read
      // a new row and the unique index would never dedup anything.
      sourceRef: `fao:food_price_indices_data.csv:${c[0]}`,
      contentHash: observationHash(base),
    });
  }

  return {
    seriesKey: opts.seriesKey,
    basePeriod,
    // Stated plainly rather than left to be inferred from a null: this file
    // carries no publication date of any kind.
    issuerReleaseDate: null,
    newestPeriodStart,
    rowsRead,
    observations,
    refusals,
  };
}
