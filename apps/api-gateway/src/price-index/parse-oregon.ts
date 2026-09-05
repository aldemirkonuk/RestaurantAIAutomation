/**
 * Parse the Oregon OLCC Monthly Pricing list into index sightings (class D).
 *
 * A control state's posted SHELF price — what an Oregon consumer or off-premise
 * licensee pays a state store, statutory markup baked in. Class D under ADR
 * 0117: a labelled index line in its own register, never beside a vendor quote.
 * No licence is declared by OLCC (only an attribution), so `attribution` is
 * null here — unstated terms are recorded as unstated, never as permissive.
 *
 * Ported field-for-field from `scripts/fetch_price_sightings.py::parse_oregon`
 * against the SAME recorded fixture. Defects counted not dropped:
 *   row_older_than_file       asofdate older than the newest in the pull
 *   bad_pack                  unitspercase missing or <= 0
 *   no_price                  priceperunit missing or <= 0
 *   case_price_inconsistent   priceperunit × pack disagrees with pricepercase
 *   no_item_code / duplicate_item_code
 */

import {
  ParseRun,
  PostingRefusal,
  PostingSighting,
  asNumber,
  asPositiveInt,
  contentHash,
} from "./price-index.types";
import { CASE_CONSISTENCY_TOLERANCE, parseSizeToMl } from "./normalize";

export const OREGON_SOURCE_KEY = "oregon-olcc-monthly-pricing";
export const OREGON_URL = "https://data.oregon.gov/resource/vmf2-f83h.json";
export const OREGON_ISSUER = "Oregon Liquor & Cannabis Commission";
export const OREGON_STATE = "US-OR";

export interface OregonRow {
  asofdate?: string | null;
  itemcode?: string | number | null;
  extendeditemcode?: string | number | null;
  description?: string | null;
  size?: string | null;
  priceperunit?: string | number | null;
  unitspercase?: string | number | null;
  pricepercase?: string | number | null;
  category?: string | null;
  itemstatus?: string | null;
  specialpricing?: string | null;
  pricechange?: string | null;
  countryoforigin?: string | null;
  [k: string]: unknown;
}

const REQUIRED_KEYS = [
  "asofdate",
  "itemcode",
  "description",
  "size",
  "priceperunit",
  "unitspercase",
  "pricepercase",
];

export class OregonShapeError extends Error {}

export function parseOregon(rows: OregonRow[], fetchedAt: string): ParseRun {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new OregonShapeError(
      "Oregon: zero rows read — the dataset id or filter moved.",
    );
  }
  const missing = REQUIRED_KEYS.filter((k) => !(k in rows[0]));
  if (missing.length) {
    throw new OregonShapeError(
      `Oregon: the row shape changed — missing ${missing.join(", ")}.`,
    );
  }

  const issuedSet = rows
    .map((r) => (r.asofdate ? String(r.asofdate).slice(0, 10) : null))
    .filter((d): d is string => !!d);
  const issuedAt = issuedSet.length ? issuedSet.slice().sort().at(-1)! : null;

  const sightings: PostingSighting[] = [];
  const refusals: PostingRefusal[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const stamp = r.asofdate ? String(r.asofdate).slice(0, 10) : "";
    if (stamp !== issuedAt) {
      refusals.push({
        reason: "row_older_than_file",
        detail: `asofdate=${stamp} but the newest in this pull is ${String(issuedAt)}`,
      });
      continue;
    }

    const pack = asPositiveInt(r.unitspercase);
    const bottle = asNumber(r.priceperunit);
    const volume = parseSizeToMl(r.size);

    if (pack === null) {
      refusals.push({
        reason: "bad_pack",
        detail: `unitspercase=${String(r.unitspercase)}`,
      });
      continue;
    }
    if (bottle === null || bottle <= 0) {
      refusals.push({
        reason: "no_price",
        detail: `priceperunit=${String(r.priceperunit)}`,
      });
      continue;
    }

    const caseCost = asNumber(r.pricepercase);
    if (caseCost !== null && caseCost > 0) {
      const implied = bottle * pack;
      if (Math.abs(implied - caseCost) / caseCost > CASE_CONSISTENCY_TOLERANCE) {
        refusals.push({
          reason: "case_price_inconsistent",
          detail: `priceperunit ${bottle} x ${pack} = ${implied.toFixed(2)} but pricepercase = ${caseCost}`,
        });
        continue;
      }
    }

    const code = String(r.itemcode ?? "").trim();
    if (!code) {
      refusals.push({ reason: "no_item_code", detail: "itemcode is blank" });
      continue;
    }
    if (seen.has(code)) {
      refusals.push({
        reason: "duplicate_item_code",
        detail: `itemcode ${code} seen`,
      });
      continue;
    }
    seen.add(code);

    sightings.push({
      sourceKey: OREGON_SOURCE_KEY,
      sourceClass: "retail_reference",
      state: OREGON_STATE,
      region: null,
      issuer: OREGON_ISSUER,
      issuedAt: String(issuedAt),
      priceBasis: "priceperunit (OLCC posted shelf price)",
      productName: (r.description ?? "").toString().trim() || "(unnamed)",
      brand: null,
      producer: null,
      packageDesc: null,
      containerType: null,
      sizeValue: volume,
      sizeUnit: volume === null ? null : "ml",
      price: bottle,
      currency: "USD",
      priceUnit: "per bottle",
      pack,
      containerCharge: null,
      isPromotion: false,
      sourceStatus: (r.itemstatus ?? "").toString().trim() || null,
      // OLCC declares an attribution but NO licence — unstated, not permissive.
      attribution: null,
      sourceUrl: OREGON_URL,
      sourceRef: `${OREGON_URL}#itemcode=${code}`,
      externalIds: {
        itemcode: code,
        extendeditemcode: r.extendeditemcode ? String(r.extendeditemcode) : "",
      },
      raw: r as unknown as Record<string, unknown>,
    });
  }

  return {
    sourceKey: OREGON_SOURCE_KEY,
    issuedAt,
    rowsRead: rows.length,
    sightings,
    refusals,
  };
}
