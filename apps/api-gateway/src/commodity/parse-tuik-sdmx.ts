/**
 * TÜİK's SDMX-CSV, parsed — and the two things in it that would quietly produce
 * a wrong number.
 *
 * THE PAYLOAD, as measured on 2026-09-05 (HTTP 200, 891 bytes, sha256
 * `5760a5fa…72a2d9`; the whole response is
 * `__fixtures__/tuik-tt01-cpi-food-2026-09-05.sample.csv`):
 *
 *     DATAFLOW,REF_AREA,FREQ,SINIFLAMA_DUZEYI,DEGISIM,OZEL_KAPSAM_TUFE,
 *     BASE_PER,YAYIM_DONEMI,COICOP_1999,COICOP_2018,INDICATOR,TIME_PERIOD,
 *     OBS_VALUE,UNIT_MEASURE,CONF_STATUS,TIME_FORMAT,UNIT_MULT,OBS_STATUS,DECIMALS
 *     TR:DF_TUFE_SDMX_TT01(1.0),TR,M,2,1,_Z,2025,2026_01,_Z,01,F_TFE,2026-08,134.31,,,,,,
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DANGER ONE: `UNIT_MEASURE` IS EMPTY ON EVERY ROW, AND `DEGISIM` IS THE UNIT
 * ─────────────────────────────────────────────────────────────────────────────
 * `DEGISIM` decides what the number MEANS, and the payload never says so:
 *
 *     1  the index level          134.31
 *     2  monthly % change           0.22
 *     3  % change on December        22.09
 *     4  annual % change             33.79
 *     5  % change, 12-month average  33.68
 *
 * Measured, not assumed: TÜİK's own table for 2026-08 food reads
 * 134,31 / 0,22 / 22,09 / 33,79 / 33,68 and the five series under
 * `COICOP_2018=01` return exactly those, in that order. **A parser that trusted
 * the file would put a 0.22 beside a 134.31 and both would look like data.**
 *
 * So the expected `DEGISIM` is declared on the series and this parser REFUSES
 * every row that carries a different one, by name. It does not filter them out
 * quietly: a file that arrived with the wrong axis is a file whose key was
 * built wrong, and that is worth stopping for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DANGER TWO: `BASE_PER` MOVED WITHIN THE LAST YEAR AND BOTH BASES ARE LIVE
 * ─────────────────────────────────────────────────────────────────────────────
 * TÜİK rebased this series from `2003=100` to `2025=100` and still publishes
 * both. So the base is read back OUT of the file and handed to the admission
 * gate, which compares it against the register's declared base and refuses the
 * whole run on a mismatch — the same gate that catches FAO's second, older,
 * still-live CSV path. A base change is a new series, not a new observation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE KEY ORDER IS READ OFF REAL BYTES, NOT OFF THE SERVICE'S `/structure`
 * ─────────────────────────────────────────────────────────────────────────────
 * The Data Explorer's `/structure` call advertises **six** dimensions. The
 * payload has **ten** — the extra four are `OZEL_KAPSAM_TUFE`, `YAYIM_DONEMI`,
 * `COICOP_1999` and a `DEGISIM` the structure omits. Building a key from
 * `/structure` produces a wrong key that still looks right, so `KEY_DIMENSIONS`
 * below is the payload's own order and a test pins it against the recorded file.
 */

import {
  asNumber,
  observationHash,
  type SeriesObservation,
  type SeriesParseRun,
  type ObservationRefusal,
} from "./commodity.types";

/**
 * The ten dimensions, in the order the SDMX key uses them.
 *
 * Read off the recorded bytes. `parse-tuik-sdmx.spec.ts` asserts this array
 * equals the recorded header's own columns 1..10, so the constant cannot drift
 * from the file without a test saying so.
 */
export const KEY_DIMENSIONS = [
  "REF_AREA",
  "FREQ",
  "SINIFLAMA_DUZEYI",
  "DEGISIM",
  "OZEL_KAPSAM_TUFE",
  "BASE_PER",
  "YAYIM_DONEMI",
  "COICOP_1999",
  "COICOP_2018",
  "INDICATOR",
] as const;

/** What each `DEGISIM` value means. The unit the payload does not carry. */
export const DEGISIM_MEANING: Record<string, string> = {
  "1": "index level",
  "2": "monthly percentage change",
  "3": "percentage change on December of the previous year",
  "4": "annual percentage change",
  "5": "percentage change in twelve-month moving averages",
};

/** Build the SDMX key from a dimension map, in the payload's own order. */
export function buildKey(values: Record<string, string>): string {
  return KEY_DIMENSIONS.map((d) => values[d] ?? "").join(".");
}

export interface TuikParseOptions {
  seriesKey: string;
  fetchedAt: string;
  /** The ONLY `DEGISIM` this series admits. Anything else is refused by name. */
  expectDegisim: string;
  /** The COICOP-2018 code(s) this series is. Others are refused, not dropped. */
  expectCoicop: string[];
}

/** `2026-08` — the only period spelling this payload uses. */
const PERIOD = /^(\d{4})-(\d{2})$/;

/**
 * Parse one SDMX-CSV response.
 *
 * Column positions are resolved from the HEADER by name rather than by index:
 * SDMX-CSV is allowed to reorder its attribute columns, and a fixed-index
 * parser reads `OBS_VALUE` out of `UNIT_MULT` the first time it does.
 */
export function parseTuikSdmx(
  csv: string,
  opts: TuikParseOptions,
): SeriesParseRun {
  const observations: SeriesObservation[] = [];
  const refusals: ObservationRefusal[] = [];
  const lines = csv.replace(/^\ufeff/, "").split(/\r?\n/).filter((l) => l.trim() !== "");

  if (lines.length === 0) {
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
          detail:
            "The response was empty. That is a read that returned nothing, not a series that published nothing.",
        },
      ],
    };
  }

  const header = lines[0].split(",").map((h) => h.trim());
  const at = (name: string) => header.indexOf(name);
  const missing = [...KEY_DIMENSIONS, "TIME_PERIOD", "OBS_VALUE"].filter(
    (c) => at(c) === -1,
  );
  if (missing.length > 0) {
    return {
      seriesKey: opts.seriesKey,
      basePeriod: null,
      issuerReleaseDate: null,
      newestPeriodStart: null,
      rowsRead: 0,
      observations: [],
      refusals: [
        {
          reason: "unknown_columns",
          detail: `This response is missing ${missing.join(", ")}. The payload's shape is not the one this parser was written against, so nothing is read rather than reading the wrong column: SDMX-CSV may reorder its columns and a positional parser would take OBS_VALUE out of whichever column happened to be there.`,
        },
      ],
    };
  }

  let basePeriod: string | null = null;
  let newestPeriodStart: string | null = null;
  let rowsRead = 0;

  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    rowsRead += 1;

    const degisim = cells[at("DEGISIM")] ?? "";
    if (degisim !== opts.expectDegisim) {
      // REFUSED AND NAMED, never filtered out quietly. The payload carries no
      // unit at all, so a row on the wrong axis is a percentage that would be
      // written into a register of index levels and read as one.
      refusals.push({
        reason: "wrong_degisim",
        detail: `A row carries DEGISIM=${degisim} (${DEGISIM_MEANING[degisim] ?? "a meaning this register does not know"}) where this series is DEGISIM=${opts.expectDegisim} (${DEGISIM_MEANING[opts.expectDegisim] ?? "unknown"}). UNIT_MEASURE is empty on every row of this payload, so nothing in the file would have said the two are different kinds of number.`,
      });
      continue;
    }

    const coicop = cells[at("COICOP_2018")] ?? "";
    if (!opts.expectCoicop.includes(coicop)) {
      refusals.push({
        reason: "unexpected_coicop",
        detail: `A row carries COICOP_2018=${coicop}, which this series did not ask for. TÜİK's keyless route has been measured silently ignoring a filter and returning fourteen codes for one, so an unasked-for code is refused rather than admitted under this series' name.`,
      });
      continue;
    }

    // The base, read back OUT of the file. TÜİK rebased this series within the
    // last year and publishes both bases.
    const seenBase = cells[at("BASE_PER")] ?? "";
    if (seenBase) {
      const stated = `${seenBase}=100`;
      if (basePeriod === null) basePeriod = stated;
      else if (basePeriod !== stated) {
        refusals.push({
          reason: "mixed_base",
          detail: `This response mixes base ${basePeriod} and base ${stated} in one file. Those are two different series and no observation from either is admitted.`,
        });
        continue;
      }
    }

    const period = cells[at("TIME_PERIOD")] ?? "";
    const m = PERIOD.exec(period);
    if (!m) {
      refusals.push({
        reason: "unreadable_period",
        detail: `"${period}" is not a month this parser can place. No observation is written for a period nobody can name.`,
      });
      continue;
    }

    const value = asNumber(cells[at("OBS_VALUE")]);
    if (value === null) {
      refusals.push({
        reason: "no_value",
        detail: `${period} carries no readable OBS_VALUE. An empty cell is not a zero.`,
      });
      continue;
    }
    if (value <= 0) {
      refusals.push({
        reason: "implausible_value",
        detail: `${period} reads ${value}. An index on a 100 base is never zero or negative, so this is a parse fault rather than a market.`,
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
      // TÜİK's SDMX-CSV states no publication date. `YAYIM_DONEMI` is the
      // RELEASE ROUND the figures belong to (2026_01), not the day they were
      // published, and reading it as one would invent a date the issuer never
      // gave. So this series is `fetch_date` and prints "read on", exactly as
      // FAO's does and for the same measured reason.
      issuedAt: opts.fetchedAt,
      issuedAtBasis: "fetch_date",
      fetchedAt: opts.fetchedAt,
      vintage: null,
      // The file and the period, never the fetch instant: including the instant
      // would make every re-read a new row and the unique index would never
      // dedup anything.
      sourceRef: `tuik:${opts.seriesKey}:${coicop}:${period}`,
      contentHash: observationHash(base),
    });
  }

  if (observations.length === 0 && refusals.length === 0) {
    refusals.push({
      reason: "no_observations",
      detail:
        "The response parsed and carried no rows at all. That is a publisher that published nothing for this key, not a read that failed.",
    });
  }

  return {
    seriesKey: opts.seriesKey,
    basePeriod,
    issuerReleaseDate: null,
    newestPeriodStart,
    rowsRead,
    observations,
    refusals,
  };
}
