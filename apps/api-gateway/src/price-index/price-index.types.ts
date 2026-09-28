/**
 * The shape of one price-index sighting, and of a parse run's outcome.
 *
 * These are the ADR 0117 provenance fields — source, issuer, jurisdiction,
 * issued_at, basis, unit — mapped 1:1 onto the columns of
 * `price_index_postings`. Unlike `scripts/fetch_price_sightings.py`, which
 * names the fields after the abstract requirement precisely BECAUSE the old
 * table had nowhere to put three of them, this module names them after the
 * columns, because the new table has a home for every one.
 */

import { createHash } from "crypto";

/** The three index classes that live in `price_index_postings` (ADR 0117). */
export type PriceIndexClass =
  | "posted_wholesale_list" // B — a price a state requires published
  | "retail_reference" //     D — a control state's shelf price
  | "public_index"; //        E — USDA/BLS, a market index

/** One admitted posting, ready to become a row. */
export interface PostingSighting {
  sourceKey: string;
  sourceClass: PriceIndexClass;
  state: string; // ISO-3166-2, e.g. 'US-CA'
  region: string | null; // county / sub-state area, or null when state-wide
  issuer: string;
  issuedAt: string; // YYYY-MM-DD — the ISSUER's date, never the fetch date
  priceBasis: string; // WHICH published number this is
  productName: string;
  brand: string | null;
  producer: string | null;
  packageDesc: string | null;
  containerType: string | null;
  sizeValue: number | null; // never 0 — a zero size is unstated
  sizeUnit: string | null;
  price: number;
  currency: string;
  priceUnit: string; // what the price covers: 'per package', 'per bottle'
  pack: number | null; // integer pack, or null when the package is descriptive
  containerCharge: number | null;
  isPromotion: boolean;
  sourceStatus: string | null;
  attribution: string | null;
  sourceUrl: string;
  sourceRef: string; // stable per-item key, for the dedup index
  externalIds: Record<string, string>;
  raw: Record<string, unknown>;
}

/** A row that could not become a sighting, with the reason, never dropped. */
export interface PostingRefusal {
  reason: string;
  detail: string;
}

/** The outcome of parsing one fetched payload. */
export interface ParseRun {
  sourceKey: string;
  issuedAt: string | null; // newest issuer date seen, or null if none readable
  rowsRead: number;
  sightings: PostingSighting[];
  refusals: PostingRefusal[];
}

/**
 * A stable content hash over the price-bearing fields only. A re-read of an
 * unchanged posting hashes the same and dedups away against the
 * (source_ref, content_hash) unique index; a price change is new evidence.
 *
 * Kept identical in spirit to `Sighting.content_hash` in
 * `scripts/fetch_price_sightings.py`: the SAME six fields, so the Python proof
 * and this pipeline cannot silently disagree about what "the same posting"
 * means.
 */
export function contentHash(s: PostingSighting): string {
  const payload = JSON.stringify([
    s.price,
    s.currency,
    s.pack,
    s.sizeValue,
    s.issuedAt,
    s.priceBasis,
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

/** Tally refusals by reason, so a short report can name every dropped row. */
export function tally(refusals: PostingRefusal[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of refusals) out[r.reason] = (out[r.reason] ?? 0) + 1;
  return out;
}

/** Parse a finite number, or null. Rejects NaN and non-numeric input. */
export function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Parse a positive integer, or null. */
export function asPositiveInt(value: unknown): number | null {
  const n = asNumber(value);
  if (n === null) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}
