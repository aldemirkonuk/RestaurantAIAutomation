/**
 * The USDA AMS Daily National Shell Egg Index, parsed — written BEFORE the
 * bytes exist, against the format the plan recorded and a fixture contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS UNUSUAL, AND WHY THAT IS STATED AT THE TOP
 * ─────────────────────────────────────────────────────────────────────────────
 * `https://www.ams.usda.gov/robots.txt` returned HTTP 403 on 2026-09-04 and
 * again on 2026-09-05. Under this repository's own rule — recorded in
 * `price-sources.md` for K&L Wine Merchants, Majestic and Tesco — a host whose
 * crawl rules cannot be READ may not be fetched, so no code here will ever go
 * and get this report.
 *
 * The founder's answer to phase 0's Q1, 2026-09-05: *"Permit a one-off human
 * read, logged"* — a person downloads the file once, by hand, in a browser, and
 * it becomes a recorded fixture carrying who, when and the hash. **No bot
 * contacts ams.usda.gov.** Until that download happens this parser has never
 * been run against real bytes, and the registry says
 * `awaitingHumanDownload: true` so that nothing anywhere can report the series
 * as working.
 *
 * So this parser is written against **the format the plan recorded from three
 * one-off research reads** (`commodity-signals-plan.md` §1, §2a) plus
 * `__fixtures__/USDA-SHELL-EGG-CONTRACT.md`, which states exactly what the
 * human download must contain for this code to admit it. **The day the file
 * lands, nothing else changes**: `parserFor` already routes this series here,
 * the upload path already carries provenance, and the registry flag flips.
 *
 * WHAT THE PLAN RECORDED, VERBATIM, AND WHAT THIS PARSER THEREFORE LOOKS FOR
 * -------------------------------------------------------------------------
 *   * a report header dated in prose — *"Fri Sep 4, 2026"*
 *   * a machine-shaped date line — *"Report for: 09/04/2026"*
 *   * the unit and trade level ON THE FACE OF THE TABLE — *"Caged 30-Dozen
 *     Cases / Cents Per Dozen / FOB"*
 *   * per-row: class, colour, size, volume, price range, WEIGHTED AVERAGE,
 *     change, last-reported and year-ago columns
 *   * the row this series is: graded loose, white, Large — weighted average
 *     **35.28** cents per dozen on the 2026-09-04 report
 *
 * THE ONE THING IT WILL NOT DO. It will not guess a date. A shell-egg report is
 * DAILY with a five-day rolling average behind it, so an undated read is worse
 * here than anywhere else in the register: five days of drift is the whole
 * signal. A payload with no readable "Report for:" date is refused, and the
 * staleness gate never sees it.
 */

import {
  asNumber,
  observationHash,
  type SeriesObservation,
  type SeriesParseRun,
  type ObservationRefusal,
} from "./commodity.types";

/** `Report for: 09/04/2026` — the machine-shaped date the report states. */
const REPORT_FOR = /Report\s+for:\s*(\d{2})\/(\d{2})\/(\d{4})/i;

/**
 * The unit and trade level, on the face of the table.
 *
 * Looked for rather than assumed, and its ABSENCE is a refusal: ADR 0117's
 * whole rule is that a sighting names its unit, and a cents-per-dozen number
 * read as dollars-per-dozen is off by a hundred. The plan measured the string
 * as "Caged 30-Dozen Cases / Cents Per Dozen / FOB", so the two load-bearing
 * halves are matched independently — a report that changed its packaging
 * description but kept its unit is still readable.
 */
const CENTS_PER_DOZEN = /cents\s+per\s+dozen/i;
const FOB = /\bFOB\b/i;

/**
 * The row this series is.
 *
 * Graded loose, white, Large. Matched on the three words in one line in any
 * order, because the recorded reports space their columns and a fixed
 * column-offset parser breaks the first time the report is re-laid out — which
 * is exactly the failure `bh_fv020.txt` taught this register about.
 */
function isTargetRow(line: string): boolean {
  const l = line.toLowerCase();
  return (
    l.includes("loose") &&
    l.includes("white") &&
    /\blarge\b/.test(l) &&
    !l.includes("extra large") &&
    !l.includes("x-large")
  );
}

/**
 * The weighted average on a target row, read BY COLUMN ORDER.
 *
 * The plan records the order as: class, colour, size, volume, **price range**,
 * **weighted average**, change, last reported, year ago. So the weighted
 * average is *the numeric token immediately after the range token*, and that is
 * exactly what this reads.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO WRONG ANSWERS THIS AVOIDS, BOTH FOUND BY A TEST
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. **The largest number on the line is the YEAR-AGO figure.** On the
 *    2026-09-04 report that is 215.53 against a weighted average of 35.28 — a
 *    six-fold error that would look entirely plausible on a screen.
 *
 * 2. **"Strip the ranges, take the first decimal" eats the change column.**
 *    A range prints tight (`34.50-36.00`) and the change prints signed
 *    (`35.28     -0.86`), so a range pattern that tolerates whitespace around
 *    the hyphen reads `35.28 -0.86` as a range, throws BOTH away, and returns
 *    the last-reported figure instead. This was a real defect in the first
 *    version of this function and the test that caught it is still there.
 *
 * A range token is therefore recognised TIGHT — no whitespace around the hyphen
 * — which is how this report prints it, and the column position does the rest.
 * A row with no range token is refused by the caller rather than guessed at:
 * the layout the plan recorded has one, and a row without it is a layout this
 * parser does not know.
 */
const RANGE_TOKEN = /^\d+(?:,\d{3})*(?:\.\d+)?-\d+(?:,\d{3})*(?:\.\d+)?$/;
const NUMBER_TOKEN = /^[+-]?\d+(?:,\d{3})*(?:\.\d+)?$/;

export function weightedAverageFrom(line: string): number | null {
  const tokens = line.trim().split(/\s+/);
  const rangeAt = tokens.findIndex((t) => RANGE_TOKEN.test(t));
  if (rangeAt === -1) return null;
  for (let i = rangeAt + 1; i < tokens.length; i += 1) {
    if (NUMBER_TOKEN.test(tokens[i])) {
      return asNumber(tokens[i].replace(/,/g, ""));
    }
  }
  return null;
}

export function parseUsdaShellEgg(
  payload: string,
  opts: { seriesKey: string; fetchedAt: string },
): SeriesParseRun {
  const observations: SeriesObservation[] = [];
  const refusals: ObservationRefusal[] = [];
  const text = payload.replace(/^\ufeff/, "");
  const lines = text.split(/\r?\n/);

  const dated = REPORT_FOR.exec(text);
  if (!dated) {
    refusals.push({
      reason: "no_report_date",
      detail:
        'This report states no "Report for:" date this parser can read. A shell-egg index is DAILY with a five-day rolling average behind it, so an undated read is the whole signal missing. Nothing was admitted.',
    });
  }
  if (!CENTS_PER_DOZEN.test(text)) {
    refusals.push({
      reason: "unit_not_stated",
      detail:
        'The report does not state "Cents Per Dozen" on the face of the table. A sighting names its unit (ADR 0117), and a cents figure read as dollars is off by a hundred. Nothing was admitted.',
    });
  }
  if (!FOB.test(text)) {
    refusals.push({
      reason: "trade_level_not_stated",
      detail:
        "The report does not state FOB on the face of the table. Which trade level a price is at is what stops a wholesale number being compared with a retail one, and on eggs the two differed by 6.3x on the day this was measured.",
    });
  }
  if (!dated || refusals.length > 0) {
    return {
      seriesKey: opts.seriesKey,
      basePeriod: null,
      issuerReleaseDate: null,
      newestPeriodStart: null,
      rowsRead: 0,
      observations: [],
      refusals,
    };
  }

  // MM/DD/YYYY, which is what the issuer prints. Reordered explicitly rather
  // than handed to `new Date`, which reads an ambiguous slash-date by locale.
  const periodStart = `${dated[3]}-${dated[1]}-${dated[2]}`;

  let rowsRead = 0;
  let admitted = false;
  for (const line of lines) {
    if (!isTargetRow(line)) continue;
    rowsRead += 1;
    if (admitted) {
      // A second matching row means the layout changed under this parser. It is
      // named, not silently ignored: picking the first of two rows that both
      // claim to be the series is how a register starts holding the wrong number.
      refusals.push({
        reason: "ambiguous_row",
        detail: `More than one row reads as graded loose, white, Large. The report's layout has changed and this parser will not choose between them: "${line.trim().slice(0, 120)}"`,
      });
      continue;
    }
    const value = weightedAverageFrom(line);
    if (value === null) {
      refusals.push({
        reason: "no_value",
        detail: `The row for graded loose, white, Large carries no readable weighted average: "${line.trim().slice(0, 120)}"`,
      });
      continue;
    }
    if (value <= 0) {
      refusals.push({
        reason: "implausible_value",
        detail: `The weighted average reads ${value} cents per dozen, which is not a price. This is a parse fault rather than a market.`,
      });
      continue;
    }
    const base = {
      seriesKey: opts.seriesKey,
      periodStart,
      value,
      vintage: null as null,
    };
    observations.push({
      ...base,
      periodGrain: "day",
      // The ISSUER stated this date, on the face of the report. This is the one
      // series in phase 0 that earns `issuer_stated` from a report rather than
      // from a JSON field.
      issuedAt: `${periodStart}T00:00:00.000Z`,
      issuedAtBasis: "issuer_stated",
      fetchedAt: opts.fetchedAt,
      vintage: null,
      sourceRef: `usda_ams:ams_2843:${periodStart}`,
      contentHash: observationHash(base),
    });
    admitted = true;
  }

  if (!admitted && refusals.length === 0) {
    refusals.push({
      reason: "row_not_found",
      detail:
        "No row in this report reads as graded loose, white, Large. That is a report whose layout this parser does not recognise, not a day the market was quiet.",
    });
  }

  return {
    seriesKey: opts.seriesKey,
    // A price has no base period. Stated as null rather than omitted, so the
    // admission gate's base check is skipped for the right reason.
    basePeriod: null,
    issuerReleaseDate: periodStart,
    newestPeriodStart: admitted ? periodStart : null,
    rowsRead,
    observations,
    refusals,
  };
}
