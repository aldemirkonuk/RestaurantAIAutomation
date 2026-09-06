/**
 * The shape of one index-series observation, and of a parse run's outcome.
 *
 * This is the class-E twin of `price-index/price-index.types.ts`, and it is a
 * separate file for the reason the tables are separate (ADR 0117 class E; the
 * founder's batch-37 call, 2026-09-05: *"a seperate table for index series"*):
 * a `PostingSighting` is required to carry a price, a currency, a price unit,
 * a product name and an ISO-3166-2 state, and an index series has none of the
 * five. Naming the fields after the columns, as that file does, is the same
 * discipline — it is the columns that differ.
 */

import { createHash } from "crypto";

/** ADR 0117's four value kinds. Only `price` may ever be rendered as money. */
export type CommodityValueKind = "price" | "index_number" | "rate" | "forecast";

/** The four states a licence can be in. A boolean would collapse two of them. */
export type Redistribution =
  | "permitted"
  | "attribution_required"
  | "prohibited"
  | "unstated";

/** How an observation may reach the register. See the registry's own comment. */
export type Admission = "fetch" | "upload_only";

/** The observation's own period grain, never our clock's. */
export type PeriodGrain = "day" | "week" | "month" | "quarter" | "year";

/**
 * One admitted observation, ready to become a row.
 *
 * `issuedAtBasis` is ADR 0117 Q27's decided vocabulary, reused rather than
 * re-spelled: `issuer_stated` is a date the publisher printed, `fetch_date` is
 * the day WE read the file because nobody published one. It is not symmetry —
 * FAO's CSV states no date at all and ONS states two, both measured.
 */
export interface SeriesObservation {
  seriesKey: string;
  /** The first day of the period the issuer published this value for. */
  periodStart: string; // YYYY-MM-DD
  periodGrain: PeriodGrain;
  value: number;
  issuedAt: string; // ISO instant
  issuedAtBasis: "issuer_stated" | "fetch_date";
  fetchedAt: string; // ISO instant
  vintage: "preliminary" | "final" | "revised" | null;
  sourceRef: string;
  contentHash: string;
}

/** A row that could not become an observation, with the reason, never dropped. */
export interface ObservationRefusal {
  reason: string;
  detail: string;
}

/**
 * The outcome of parsing one payload.
 *
 * `basePeriod` is read back OUT of the file rather than assumed, because a base
 * change is a NEW SERIES and not a new observation: the same index on two bases
 * differs by roughly fifty percent, which any step guard reads as a crash. The
 * caller compares it against the registry's declared base and refuses the whole
 * run when they differ — which is also what catches a second, older, still-live
 * path serving well-formed HTTP 200s on a different base.
 */
export interface SeriesParseRun {
  seriesKey: string;
  /** The base period the FILE states, verbatim, or null when it states none. */
  basePeriod: string | null;
  /** The issuer's own publication date, or null when the file states none. */
  issuerReleaseDate: string | null;
  /** The newest observation period read, or null when none was readable. */
  newestPeriodStart: string | null;
  rowsRead: number;
  observations: SeriesObservation[];
  refusals: ObservationRefusal[];
}

/**
 * A stable content hash over the value-bearing fields only.
 *
 * Deliberately the SAME idea as `price-index/price-index.types.ts:contentHash`
 * — a re-read of an unchanged observation hashes the same and dedups away
 * against the unique index, and a revised value is new evidence that becomes
 * its own row. It hashes four fields rather than six because an index series
 * has no currency, no pack and no size to hash.
 */
export function observationHash(
  o: Pick<SeriesObservation, "seriesKey" | "periodStart" | "value" | "vintage">,
): string {
  return createHash("sha256")
    .update(JSON.stringify([o.seriesKey, o.periodStart, o.value, o.vintage]))
    .digest("hex");
}

/** Tally refusals by reason, so a short report can name every dropped row. */
export function tallyRefusals(
  refusals: ObservationRefusal[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of refusals) out[r.reason] = (out[r.reason] ?? 0) + 1;
  return out;
}

/**
 * Parse a finite number, or null.
 *
 * `Number("")` is 0 and `Number(" ")` is 0, so an empty cell in a CSV of index
 * numbers would otherwise become a published value of zero — which on a
 * baseline median is not a small error, it is a divide-by-a-lie.
 */
export function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
