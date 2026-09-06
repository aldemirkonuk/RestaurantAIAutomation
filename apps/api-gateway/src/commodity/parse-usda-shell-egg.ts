/**
 * The USDA AMS Daily National Shell Egg Index — REWRITTEN 2026-09-05 against
 * the bytes a person actually brought back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS REPLACES THE PDF-TEXT PARSER. IT DOES NOT SIT BESIDE IT.
 * ─────────────────────────────────────────────────────────────────────────────
 * The first version of this file was written before any bytes existed, against
 * the PDF's face text that `commodity-signals-plan.md` §1 recorded from three
 * one-off research reads: a `Report for: MM/DD/YYYY` line, `Cents Per Dozen`
 * and `FOB` in prose above the table, and one row reading "graded loose, white,
 * Large".
 *
 * The download happened on 2026-09-05, and **the PDF was not what came back**.
 * `www.ams.usda.gov/mnreports/ams_2843.pdf` answers a browser with a
 * file-download dialog the pane cannot complete, so the same report's **HTML
 * data view** on My Market News was read instead — `mymarketnews.ams.usda.gov/
 * public_data?slug_id=2843`, section *Report Detail Weighted*, all 23 rows.
 *
 * That view carries the same facts as **COLUMNS**, not as face text. Keeping
 * the PDF parser beside this one would mean shipping a second code path that
 * has never seen a byte and can never be proved — the exact shape this register
 * refuses everywhere else. So the PDF shape is GONE, and if a PDF is ever
 * brought instead, this file gets a second recorded fixture first and a branch
 * second, in that order.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CONTRACT DID NOT FORESEE, AND THE SECOND ONE WOULD HAVE BEEN A BUG
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. **The facts are columns.** `Report Date` is a column on every row;
 *    `Price Unit` reads `Cents Per Dozen` on every row; `Freight` reads `FOB`
 *    or `Delivered` PER ROW. The old parser looked for all three in the
 *    document's prose and would have refused this file three times over.
 *
 * 2. **There are THREE graded-loose white Large rows**, and the old parser's
 *    `ambiguous_row` refusal would have fired on the real file:
 *
 *        Cage-Free  White  Large  California  Delivered   50.46
 *        Cage-Free  White  Large  National    FOB         28.67
 *        Caged      White  Large  National    FOB         35.28   <- the series
 *
 *    The one the plan recorded (35.28, previous 36.14, year ago 215.53) is the
 *    **Caged, National, FOB** row. Selecting on "white Large" alone would pick
 *    whichever row came first — and a cage-free California delivered price is
 *    a different market, at 50.46 against 35.28, which is a 43 percent error
 *    that looks entirely ordinary on a screen.
 *
 * So the selection is a SIX-PART TUPLE — egg type, environment, colour, class,
 * origin, freight — declared on the series and matched exactly. Anything that
 * matches more than one row is refused as `ambiguous_row`; anything that
 * matches none is refused as `row_not_found`. Neither is resolved by guessing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE ONE THING THAT DID NOT CHANGE
 * ─────────────────────────────────────────────────────────────────────────────
 * No code here ever fetches. `www.ams.usda.gov/robots.txt` returns HTTP 403 and
 * a host whose crawl rules cannot be read may not be crawled. The founder's
 * batch-57 answer permits a ONE-OFF HUMAN READ, logged — a person in a browser,
 * once — and that is what produced this fixture. The series stays
 * `admission: 'upload_only'` for its cadence: a daily series read by hand once
 * is not a daily series, and the register says so rather than implying
 * otherwise.
 */

import {
  asNumber,
  observationHash,
  type SeriesObservation,
  type SeriesParseRun,
  type ObservationRefusal,
} from "./commodity.types";

/**
 * The six columns that identify WHICH market a row is.
 *
 * All six, because the real file needs all six: dropping `Environment` alone
 * makes three rows match, and dropping `Freight` or `Origin` makes two.
 */
export interface EggRowSelector {
  eggType: string;
  environment: string;
  color: string;
  class: string;
  origin: string;
  freight: string;
}

/** The series the plan recorded, and the one this register holds. */
export const NATIONAL_CAGED_LARGE: EggRowSelector = {
  eggType: "Graded Loose",
  environment: "Caged",
  color: "White",
  class: "Large",
  origin: "National",
  freight: "FOB",
};

/** The unit the report states, per row, in its own words. */
export const CENTS_PER_DOZEN = "Cents Per Dozen";

/** `09/04/2026` — the spelling the Report Date column uses. */
const US_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Case- and space-insensitive equality. The view pads some cells. */
function same(a: string | undefined, b: string): boolean {
  return (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
}

export interface UsdaParseOptions {
  seriesKey: string;
  fetchedAt: string;
  /** Which market this series is. Declared, never inferred from the file. */
  select?: EggRowSelector;
}

/**
 * Parse one *Report Detail Weighted* export.
 *
 * Tab-separated, with a header row. Columns are resolved BY NAME: the view is a
 * web table and its column order is not a promise, so a positional parser would
 * read `Wtd Avg Price` out of `Volume` the first time somebody reorders it.
 */
export function parseUsdaShellEgg(
  payload: string,
  opts: UsdaParseOptions,
): SeriesParseRun {
  const refusals: ObservationRefusal[] = [];
  const select = opts.select ?? NATIONAL_CAGED_LARGE;
  const lines = payload
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");

  const nothing = (reason: string, detail: string): SeriesParseRun => ({
    seriesKey: opts.seriesKey,
    // A price has no base period. Stated as null rather than omitted, so the
    // admission gate skips its base check for the right reason.
    basePeriod: null,
    issuerReleaseDate: null,
    newestPeriodStart: null,
    rowsRead: 0,
    observations: [],
    refusals: [...refusals, { reason, detail }],
  });

  if (lines.length < 2) {
    return nothing(
      "unreadable_payload",
      "This export carries a header and no rows, or nothing at all. That is a read that returned nothing, not a day the market was quiet.",
    );
  }

  const header = lines[0].split("\t").map((h) => h.trim());
  const at = (name: string) => header.indexOf(name);
  const REQUIRED = [
    "Report Date",
    "Egg Type",
    "Environment",
    "Color",
    "Class",
    "Origin",
    "Freight",
    "Wtd Avg Price",
    "Price Unit",
  ];
  const missing = REQUIRED.filter((c) => at(c) === -1);
  if (missing.length > 0) {
    return nothing(
      "unknown_columns",
      `This export is missing ${missing.join(", ")}. The column set is not the one this parser was written against, so nothing is read rather than reading the wrong column: this is a web table and its column ORDER is not a promise either, which is why every column here is resolved by name.`,
    );
  }

  const rows = lines.slice(1).map((l) => l.split("\t").map((c) => c.trim()));
  const matches = rows.filter(
    (r) =>
      same(r[at("Egg Type")], select.eggType) &&
      same(r[at("Environment")], select.environment) &&
      same(r[at("Color")], select.color) &&
      same(r[at("Class")], select.class) &&
      same(r[at("Origin")], select.origin) &&
      same(r[at("Freight")], select.freight),
  );

  const named = `${select.eggType} / ${select.environment} / ${select.color} / ${select.class} / ${select.origin} / ${select.freight}`;

  if (matches.length === 0) {
    return nothing(
      "row_not_found",
      `No row in this report is ${named}. That is a report whose shape this parser does not recognise, or a market that did not trade under this description - never "a day the market was quiet". This file's 23 rows include three that are graded loose, white and Large, so a narrower description would find one and a wrong one.`,
    );
  }
  if (matches.length > 1) {
    return nothing(
      "ambiguous_row",
      `${matches.length} rows are ${named}. The six-part description is meant to identify exactly one market and it did not, so nothing is admitted: choosing between them would put one market's price under another's name.`,
    );
  }

  const row = matches[0];

  // The unit, per row, in the issuer's own words. ADR 0117: a sighting names
  // its unit, and a cents figure read as dollars is off by a hundred.
  const unit = row[at("Price Unit")] ?? "";
  if (!same(unit, CENTS_PER_DOZEN)) {
    return nothing(
      "unit_not_stated",
      `This row states its price unit as "${unit || "(nothing)"}" where this series is ${CENTS_PER_DOZEN}. Nothing is admitted: a cents figure read as dollars is off by a hundred, and the register holds one unit per series.`,
    );
  }

  const dated = US_DATE.exec(row[at("Report Date")] ?? "");
  if (!dated) {
    return nothing(
      "no_report_date",
      `This row's Report Date reads "${row[at("Report Date")] ?? ""}", which is not a date this parser can place. A shell-egg index is DAILY with a five-day rolling average behind it, so an undated read is the whole signal missing.`,
    );
  }
  // MM/DD/YYYY, reordered explicitly rather than handed to `new Date`, which
  // reads an ambiguous slash-date by locale.
  const periodStart = `${dated[3]}-${dated[1]}-${dated[2]}`;

  const value = asNumber(row[at("Wtd Avg Price")]);
  if (value === null) {
    // MEASURED, NOT HYPOTHETICAL: EIGHT of this file's 23 rows carry an empty
    // Wtd Avg Price - data rows 1, 2, 3, 11, 18, 19, 20 and 23. An empty cell
    // is a market that did not report, and `Number("")` is 0, which would post
    // a price of zero cents a dozen.
    //
    // The number was "six" here and in three other places until 2026-09-06,
    // when the audit of aa9510a6 counted the column instead of trusting the
    // prose: `awk -F'\t' 'NR>1 && $28==""' <fixture> | wc -l` -> 8. Column 28
    // is "Wtd Avg Price". The count is now pinned by a run, not by a sentence:
    // see "eight, and the number comes from the parser" in the spec.
    return nothing(
      "no_value",
      `The row for ${named} carries no weighted average price. That market did not report on this date - it is not a price of zero.`,
    );
  }
  if (value <= 0) {
    return nothing(
      "implausible_value",
      `The weighted average reads ${value} cents per dozen, which is not a price. This is a parse fault rather than a market.`,
    );
  }

  const base = {
    seriesKey: opts.seriesKey,
    periodStart,
    value,
    vintage: null as null,
  };
  const observation: SeriesObservation = {
    ...base,
    periodGrain: "day",
    // The ISSUER stated this date, in the report's own Report Date column. This
    // is the one series in phase 0 that earns `issuer_stated` off a report
    // rather than out of a JSON field.
    issuedAt: `${periodStart}T00:00:00.000Z`,
    issuedAtBasis: "issuer_stated",
    fetchedAt: opts.fetchedAt,
    vintage: null,
    // The report, the market and the day. Never the fetch instant: including it
    // would make every re-read a new row and the unique index would never dedup.
    sourceRef: `usda_ams:ams_2843:${select.environment}/${select.origin}/${select.freight}:${periodStart}`,
    contentHash: observationHash(base),
  };

  return {
    seriesKey: opts.seriesKey,
    basePeriod: null,
    issuerReleaseDate: periodStart,
    newestPeriodStart: periodStart,
    rowsRead: rows.length,
    observations: [observation],
    refusals,
  };
}

/**
 * The neighbouring figures on the selected row, for a report line.
 *
 * Read but NOT written to the register: `Wtd Avg Price Previous` and
 * `Wtd Avg Price Last Year` are the issuer's own restatements of observations
 * that belong to other dates, and writing them as observations would post the
 * same number twice under two periods. Returned so a caller can quote them, and
 * left out of `observations` deliberately.
 */
export function neighbouringFigures(
  payload: string,
  select: EggRowSelector = NATIONAL_CAGED_LARGE,
): { previous: number | null; lastYear: number | null; volume: number | null } {
  const lines = payload.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { previous: null, lastYear: null, volume: null };
  const header = lines[0].split("\t").map((h) => h.trim());
  const at = (n: string) => header.indexOf(n);
  const row = lines
    .slice(1)
    .map((l) => l.split("\t").map((c) => c.trim()))
    .find(
      (r) =>
        same(r[at("Egg Type")], select.eggType) &&
        same(r[at("Environment")], select.environment) &&
        same(r[at("Color")], select.color) &&
        same(r[at("Class")], select.class) &&
        same(r[at("Origin")], select.origin) &&
        same(r[at("Freight")], select.freight),
    );
  if (!row) return { previous: null, lastYear: null, volume: null };
  return {
    previous: at("Wtd Avg Price Previous") === -1 ? null : asNumber(row[at("Wtd Avg Price Previous")]),
    lastYear: at("Wtd Avg Price Last Year") === -1 ? null : asNumber(row[at("Wtd Avg Price Last Year")]),
    volume: at("Volume") === -1 ? null : asNumber(row[at("Volume")]),
  };
}
