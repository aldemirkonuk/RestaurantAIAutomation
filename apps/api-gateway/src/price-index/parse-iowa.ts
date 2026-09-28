/**
 * Parse the Iowa Liquor Products list into index sightings (ADR 0117, class D).
 *
 * WHY CLASS D AND NOT B — it lost as a vendor quote on six measured counts
 * (ADR 0117): all spirits, `state_bottle_retail` is Iowa's cost × 1.50, the
 * party named is the producer not a distributor, zero tenants sit in Iowa. It
 * survives as a control-state shelf price — a labelled index line, in its own
 * register, never beside a vendor quote. This module admits it as exactly that.
 *
 * Ported field-for-field from `scripts/fetch_price_sightings.py::parse_iowa`,
 * against the SAME recorded fixture, so the pipeline and the proof cannot drift.
 * The source's own defects, counted not dropped:
 *   row_older_than_file       report_as_of older than the file's newest
 *   bad_pack                  pack missing or <= 0
 *   no_price                  state_bottle_retail missing or <= 0
 *   case_price_inconsistent   bottle_cost × pack disagrees with case_cost (>2%)
 *   duplicate_item_no         same item published under two categories
 */

import {
  ParseRun,
  PostingRefusal,
  PostingSighting,
  asNumber,
  asPositiveInt,
} from "./price-index.types";
import { CASE_CONSISTENCY_TOLERANCE } from "./normalize";

export const IOWA_SOURCE_KEY = "iowa-liquor-products";
export const IOWA_URL = "https://idh-be.iowa.gov/api/v1/datasets/1029/rows.json";
export const IOWA_ISSUER = "Iowa Alcoholic Beverages Division";
export const IOWA_STATE = "US-IA";
export const IOWA_ATTRIBUTION =
  "Iowa Alcoholic Beverages Division / Alcohol Operations Bureau, 'Iowa Liquor Products', CC BY 4.0";

export interface IowaRow {
  item_no?: string | number;
  im_desc?: string | null;
  vendor_name?: string | null;
  vendor_no?: string | number | null;
  bottle_volume_ml?: string | number | null;
  pack?: string | number | null;
  state_bottle_cost?: string | number | null;
  state_case_cost?: string | number | null;
  state_bottle_retail?: string | number | null;
  report_as_of?: string | null;
  category_name?: string | null;
  proof?: string | number | null;
  upc?: string | null;
  scc?: string | null;
  list_on?: string | null;
  [k: string]: unknown;
}

const REQUIRED_KEYS = [
  "item_no",
  "im_desc",
  "vendor_name",
  "bottle_volume_ml",
  "pack",
  "state_bottle_cost",
  "state_case_cost",
  "state_bottle_retail",
  "report_as_of",
];

export class IowaShapeError extends Error {}

export function parseIowa(rows: IowaRow[], fetchedAt: string): ParseRun {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new IowaShapeError(
      "Iowa: zero rows read — the export path or dataset id moved.",
    );
  }
  const missing = REQUIRED_KEYS.filter((k) => !(k in rows[0]));
  if (missing.length) {
    throw new IowaShapeError(
      `Iowa: the row shape changed — missing ${missing.join(", ")}. Re-read the column list before trusting any parse.`,
    );
  }

  const issuedDates = rows
    .map((r) => r.report_as_of)
    .filter((d): d is string => typeof d === "string" && d.length > 0);
  const issuedAt = issuedDates.length ? issuedDates.slice().sort().at(-1)! : null;

  const sightings: PostingSighting[] = [];
  const refusals: PostingRefusal[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    if (r.report_as_of !== issuedAt) {
      refusals.push({
        reason: "row_older_than_file",
        detail: `report_as_of=${String(r.report_as_of)} but the file says ${String(issuedAt)}`,
      });
      continue;
    }

    const pack = asPositiveInt(r.pack);
    const bottle = asNumber(r.state_bottle_retail);
    const caseCost = asNumber(r.state_case_cost);
    let volume = asNumber(r.bottle_volume_ml);

    if (pack === null) {
      refusals.push({ reason: "bad_pack", detail: `pack=${String(r.pack)}` });
      continue;
    }
    if (bottle === null || bottle <= 0) {
      refusals.push({
        reason: "no_price",
        detail: `state_bottle_retail=${String(r.state_bottle_retail)}`,
      });
      continue;
    }
    // Zero is not a volume. Eleven rows in the 2026-09-01 file say 0.
    if (volume !== null && volume <= 0) volume = null;

    // The file disagrees with itself sometimes. Whichever number is wrong, the
    // row cannot be believed, and believing it writes a $1,250 bottle.
    const cost = asNumber(r.state_bottle_cost);
    if (cost !== null && caseCost !== null && caseCost > 0 && cost > 0) {
      const implied = cost * pack;
      if (Math.abs(implied - caseCost) / caseCost > CASE_CONSISTENCY_TOLERANCE) {
        refusals.push({
          reason: "case_price_inconsistent",
          detail: `state_bottle_cost ${cost} x pack ${pack} = ${implied.toFixed(2)}, but state_case_cost = ${caseCost}`,
        });
        continue;
      }
    }

    const itemNo = String(r.item_no);
    if (seen.has(itemNo)) {
      refusals.push({
        reason: "duplicate_item_no",
        detail: `item_no ${itemNo} already seen`,
      });
      continue;
    }
    seen.add(itemNo);

    sightings.push({
      sourceKey: IOWA_SOURCE_KEY,
      sourceClass: "retail_reference",
      state: IOWA_STATE,
      region: null,
      issuer: IOWA_ISSUER,
      issuedAt: String(issuedAt),
      // NAMED, not assumed: state_bottle_retail is what an Iowa Class E licensee
      // pays the state — cost × 1.50 at the median, Iowa's markup and nobody
      // else's.
      priceBasis: "state_bottle_retail",
      productName: (r.im_desc ?? "").toString().trim() || "(unnamed)",
      brand: null,
      // The supplier who sells to the STATE — not a distributor this house can
      // buy from.
      producer: (r.vendor_name ?? "").toString().trim() || null,
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
      sourceStatus: null,
      attribution: IOWA_ATTRIBUTION,
      sourceUrl: IOWA_URL,
      sourceRef: `${IOWA_URL}#item=${itemNo}`,
      externalIds: {
        itemNo,
        upc: r.upc ? String(r.upc) : "",
        vendorNo: r.vendor_no ? String(r.vendor_no) : "",
      },
      raw: r as unknown as Record<string, unknown>,
    });
  }

  return {
    sourceKey: IOWA_SOURCE_KEY,
    issuedAt,
    rowsRead: rows.length,
    sightings,
    refusals,
  };
}
