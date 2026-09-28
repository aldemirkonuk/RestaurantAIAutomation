/**
 * The ONS time-series JSON, parsed. Today that is `d7bu` — CPI INDEX 01: FOOD
 * AND NON-ALCOHOLIC BEVERAGES, 2015=100.
 *
 * THE PAYLOAD, AS MEASURED (2026-09-05, HTTP 200, 125,504 bytes, sha256
 * `e8fba154…f1b`; the reduced fixture and its provenance are in
 * `__fixtures__/`):
 *
 *     description.title       "CPI INDEX 01 : FOOD AND NON-ALCOHOLIC
 *                              BEVERAGES 2015=100"   ← the base is IN the title
 *     description.cdid        "D7BU"
 *     description.unit        "Index, base year = 100"      ← 26 characters
 *     description.releaseDate "2026-08-18T23:00:00.000Z"
 *     description.nextRelease "16 September 2026"
 *     months[]                463 entries, each { date: "2026 JUL",
 *                              value: "144.0", updateDate: "…" }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS PARSER DISTRUSTS `releaseDate`, ON THIS HOST ABOVE ALL
 * ─────────────────────────────────────────────────────────────────────────────
 * Four ONS RPI average-price series return HTTP 200 with `releaseDate`
 * 2026-08-18 and `nextRelease` 16 September 2026 while **every last observation
 * is 2025 JAN** — measured 2026-09-05 and recorded in `price-sources.md` as
 * `silent: discontinued`. A publisher can go on publishing a release date for a
 * series it has stopped publishing values for.
 *
 * So `releaseDate` is READ AND RETURNED, because it is a genuine issuer-stated
 * date and the register should hold it, and the STALENESS DECISION is made on
 * `newestPeriodStart` instead — the newest observation's own period. The two are
 * different questions and only the second one can catch a discontinued series.
 *
 * Each observation's own `updateDate` is what `issuedAt` carries, which is why
 * this series is `issuer_stated` and FAO's is `fetch_date`. That difference was
 * measured, not designed for symmetry.
 */

import {
  asNumber,
  observationHash,
  type SeriesObservation,
  type SeriesParseRun,
  type ObservationRefusal,
} from "./commodity.types";

/** `2026 JUL` — ONS's own month spelling, upper-cased and three letters. */
const MONTHS: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

/** `"2026 JUL"` -> `"2026-07-01"`, or null when it is not a month at all. */
export function onsMonthToPeriodStart(date: unknown): string | null {
  if (typeof date !== "string") return null;
  const m = /^(\d{4})\s+([A-Z]{3})$/.exec(date.trim().toUpperCase());
  if (!m) return null;
  const mm = MONTHS[m[2]];
  return mm ? `${m[1]}-${mm}-01` : null;
}

/**
 * The base period, taken from the issuer's own title.
 *
 * ONS states the base nowhere else in the payload: `unit` is the generic
 * `"Index, base year = 100"` — the same string on every index series they
 * publish, which names no year at all. The title is `"… BEVERAGES 2015=100"`.
 * So a rebasing shows up in the TITLE, and the title is where it is read from.
 */
export function onsBaseFromTitle(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const m = /(\d{4}(?:-\d{4})?\s*=\s*100)/.exec(title);
  return m ? m[1].replace(/\s+/g, "") : null;
}

export function parseOns(
  payload: string,
  opts: { seriesKey: string; fetchedAt: string },
): SeriesParseRun {
  const observations: SeriesObservation[] = [];
  const refusals: ObservationRefusal[] = [];

  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(payload) as Record<string, unknown>;
  } catch (err) {
    return {
      seriesKey: opts.seriesKey,
      basePeriod: null,
      issuerReleaseDate: null,
      newestPeriodStart: null,
      rowsRead: 0,
      observations: [],
      refusals: [
        {
          reason: "unreadable_payload",
          // Never "the series is empty": a body that will not parse is a body
          // nobody has read, and the two must not render alike.
          detail: `The response did not parse as JSON: ${(err as Error).message}`,
        },
      ],
    };
  }

  const description = (doc.description ?? {}) as Record<string, unknown>;
  const basePeriod = onsBaseFromTitle(description.title);
  if (!basePeriod) {
    refusals.push({
      reason: "no_base_stated",
      detail:
        "The series title states no base period. ONS's `unit` field says only \"Index, base year = 100\" and names no year, so the title is the only place a rebasing would show.",
    });
  }
  const issuerReleaseDate =
    typeof description.releaseDate === "string" ? description.releaseDate : null;

  const months = Array.isArray(doc.months)
    ? (doc.months as Array<Record<string, unknown>>)
    : [];
  if (months.length === 0) {
    refusals.push({
      reason: "no_observations",
      detail:
        "The payload parsed and carries no monthly observations. That is a series that published nothing, not a read that failed — the distinction the caller needs to tell the two silences apart.",
    });
  }

  let newestPeriodStart: string | null = null;

  for (const row of months) {
    const periodStart = onsMonthToPeriodStart(row.date ?? row.label);
    if (!periodStart) {
      refusals.push({
        reason: "unreadable_period",
        detail: `"${String(row.date ?? row.label ?? "")}" is not a month this parser can place. No observation is written for a period nobody can name.`,
      });
      continue;
    }
    const value = asNumber(row.value);
    if (value === null || value <= 0) {
      refusals.push({
        reason: "no_value",
        detail: `${periodStart} carries no readable index value ("${String(row.value ?? "")}"). An empty cell is not a zero.`,
      });
      continue;
    }
    if (!newestPeriodStart || periodStart > newestPeriodStart) {
      newestPeriodStart = periodStart;
    }
    const base = {
      seriesKey: opts.seriesKey,
      periodStart,
      value,
      vintage: null as null,
    };
    // The issuer stamped a date on THIS observation. That is the whole reason
    // this series may print "issued" and FAO's may not.
    const updateDate =
      typeof row.updateDate === "string" && row.updateDate.trim() !== ""
        ? row.updateDate
        : null;
    observations.push({
      ...base,
      periodGrain: "month",
      issuedAt: updateDate ?? issuerReleaseDate ?? opts.fetchedAt,
      // A row with neither its own updateDate nor a series releaseDate is
      // undated by the issuer, and says so, rather than borrowing the word
      // "issued" from the rows beside it.
      issuedAtBasis: updateDate || issuerReleaseDate ? "issuer_stated" : "fetch_date",
      fetchedAt: opts.fetchedAt,
      vintage: null,
      sourceRef: `ons:d7bu/mm23:${periodStart.slice(0, 7)}`,
      contentHash: observationHash(base),
    });
  }

  return {
    seriesKey: opts.seriesKey,
    basePeriod,
    issuerReleaseDate,
    newestPeriodStart,
    rowsRead: months.length,
    observations,
    refusals,
  };
}
