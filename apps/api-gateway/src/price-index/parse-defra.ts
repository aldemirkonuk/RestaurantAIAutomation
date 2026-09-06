/**
 * Parse Defra's "Wholesale fruit and vegetable prices" into index sightings.
 *
 * WHAT THIS IS, AND WHY IT IS THE UNITED KINGDOM'S ONLY ENTRY WITH A PARSER
 * -------------------------------------------------------------------------
 * Researched per market on 2026-09-05 (ADR 0117, "Non-US markets: Türkiye and
 * the United Kingdom"). The UK has no price-posting regime and no open dataset
 * of alcohol prices — `ckan.publishing.service.gov.uk` returns ONE result for
 * "wine OR spirits OR beer price" and it is HMRC's duty factsheet. This series
 * is the one public UK source measured that carries every fact ADR 0117 asks
 * of a sighting AND is machine-readable:
 *
 *   what     `price`, a money figure
 *   whose    "Department for Environment, Food & Rural Affairs", on the page
 *   when     `date`, on every row, dd/mm/yyyy
 *   what of  `unit` — kg, head, stem, twin, unit
 *   where    "England and Wales", stated on the publication -> ISO GB-EAW
 *   terms    Open Government Licence v3.0, stated on the page
 *
 * IT IS PRODUCE, NOT DRINK, AND THAT IS NOT HIDDEN. Class E, a public index in
 * its own register (ADR 0111): never beside a vendor quote, never averaged with
 * one. Whether a drinks house should be SHOWN a produce line at all is the
 * founder's call — Q11 in the source registry — and nothing here is armed:
 * `PRICE_INDEX_FETCH_ENABLED` is off by default, so this parser writes nothing
 * until that decision is made.
 *
 * MEASURED 2026-09-05, on the file this parser's fixture was cut from:
 *   https://assets.publishing.service.gov.uk/media/6a918dd7f5b35599aec18f5b/
 *     fruitvegprices-260901.csv   HTTP 200, 861,585 bytes,
 *     sha256 ab56ded3a4bc3f65fd49e438fc6b43d7a0a9f22f2595afd1c2049941cc258c3d
 *   17,594 rows; headers exactly `category,item,variety,date,price,unit`;
 *   newest date 31/08/2026 with 55 rows; units kg 14,612 / head 2,108 /
 *   stem 428 / twin 397 / unit 49; categories vegetable 13,386 / fruit 3,731 /
 *   cut_flowers 428 / pot_plants 49; zero blank prices and zero blank units.
 *   Exactly one published price of 0
 *   (`cut_flowers,gladioli,all_varieties,05/07/2024,0,stem`) — kept in the
 *   fixture, because it is the one defect the file actually contains.
 *
 * REFUSALS, counted by reason and never dropped:
 *   no_price               price missing, unparseable or <= 0
 *   no_unit                the unit the price is per is blank
 *   no_date                the date is not a readable dd/mm/yyyy
 *   row_older_than_file    an earlier edition's row in the same download
 *   duplicate_item         the same category/item/variety twice on one date
 *
 * The price check runs BEFORE the date check on purpose: a row publishing a
 * price of 0 is not a price at any date, and refusing it as "old" would file
 * the wrong defect against it.
 */

import {
  ParseRun,
  PostingRefusal,
  PostingSighting,
  asNumber,
} from "./price-index.types";

export const DEFRA_SOURCE_KEY = "defra-wholesale-fruit-veg";
/** The series' own landing page — stable across editions, so `source_ref` is. */
export const DEFRA_SERIES_URL =
  "https://www.gov.uk/government/statistical-data-sets/wholesale-fruit-and-vegetable-prices-weekly-average";
/**
 * The edition actually read on 2026-09-05. The fetcher re-reads the series page
 * to find the current one; this constant records what the fixture came from.
 */
export const DEFRA_CSV_URL =
  "https://assets.publishing.service.gov.uk/media/6a918dd7f5b35599aec18f5b/fruitvegprices-260901.csv";
export const DEFRA_ISSUER = "Department for Environment, Food & Rural Affairs";
/**
 * ISO 3166-2:GB remark part 2. The publication states its own extent:
 * "average wholesale prices of selected home-grown horticultural produce in
 * England and Wales".
 */
export const DEFRA_JURISDICTION = "GB-EAW";
/** OGL v3.0 requires attribution; the standard wording, not one we invented. */
export const DEFRA_ATTRIBUTION =
  "Contains public sector information licensed under the Open Government Licence v3.0. Source: Department for Environment, Food & Rural Affairs.";

export interface DefraRow {
  category?: string | null;
  item?: string | null;
  variety?: string | null;
  date?: string | null;
  price?: string | number | null;
  unit?: string | null;
  [k: string]: unknown;
}

const REQUIRED_KEYS = ["category", "item", "variety", "date", "price", "unit"];

export class DefraShapeError extends Error {}

/**
 * A minimal RFC4180-ish reader. Defra's file has no quoted fields today, but a
 * split on "," would silently corrupt a variety name the day one appears, and
 * a corrupted product name attached to a real price is worse than a refusal.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  // A UTF-8 BOM on the first header would make 'category' unfindable.
  const header = rows[0].map((h, i) =>
    (i === 0 ? h.replace(/^\uFEFF/, "") : h).trim(),
  );
  return rows
    .slice(1)
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => {
      const o: Record<string, string> = {};
      header.forEach((h, i) => {
        o[h] = (r[i] ?? "").trim();
      });
      return o;
    });
}

/**
 * dd/mm/yyyy -> yyyy-mm-dd, or null. Never a guess: an unreadable date is a
 * refusal, because the issuer's date is what the staleness gate reads.
 */
export function defraDate(raw: unknown): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * 'bramleys_seedling' -> 'bramleys seedling'. The verbatim value is kept on
 * `external_ids`, so nothing is lost by making the name readable.
 */
function readable(value: string): string {
  return value.replace(/_/g, " ").trim();
}

export function parseDefra(rows: DefraRow[], fetchedAt: string): ParseRun {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new DefraShapeError(
      "Defra: zero rows read — the edition link on the series page moved.",
    );
  }
  const missing = REQUIRED_KEYS.filter((k) => !(k in rows[0]));
  if (missing.length) {
    throw new DefraShapeError(
      `Defra: the row shape changed — missing ${missing.join(", ")}.`,
    );
  }

  const dates = rows
    .map((r) => defraDate(r.date))
    .filter((d): d is string => d !== null);
  const issuedAt = dates.length ? dates.slice().sort().at(-1)! : null;

  const sightings: PostingSighting[] = [];
  const refusals: PostingRefusal[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const price = asNumber(r.price);
    if (price === null || price <= 0) {
      refusals.push({
        reason: "no_price",
        detail: `price=${String(r.price)} for ${String(r.item)}/${String(r.variety)} on ${String(r.date)}`,
      });
      continue;
    }
    const unit = String(r.unit ?? "").trim();
    if (!unit) {
      refusals.push({
        reason: "no_unit",
        detail: `blank unit for ${String(r.item)}/${String(r.variety)}`,
      });
      continue;
    }
    const day = defraDate(r.date);
    if (day === null) {
      refusals.push({ reason: "no_date", detail: `date=${String(r.date)}` });
      continue;
    }
    if (day !== issuedAt) {
      refusals.push({
        reason: "row_older_than_file",
        detail: `date=${day} but the newest in this file is ${String(issuedAt)}`,
      });
      continue;
    }

    const category = String(r.category ?? "").trim();
    const item = String(r.item ?? "").trim();
    const variety = String(r.variety ?? "").trim();
    const key = `${category}/${item}/${variety}`;
    if (seen.has(key)) {
      refusals.push({
        reason: "duplicate_item",
        detail: `${key} already read for ${day}`,
      });
      continue;
    }
    seen.add(key);

    const name =
      variety && variety !== item
        ? `${readable(item)}, ${readable(variety)}`
        : readable(item);

    sightings.push({
      sourceKey: DEFRA_SOURCE_KEY,
      sourceClass: "public_index",
      state: DEFRA_JURISDICTION,
      // The CSV carries no market column, so the four named markets
      // (Birmingham, Bristol, Manchester, a London market) cannot be told
      // apart on a row. Region stays null rather than naming one of them.
      region: null,
      issuer: DEFRA_ISSUER,
      issuedAt: day,
      priceBasis: "average wholesale market price",
      productName: name || "(unnamed)",
      brand: null,
      producer: null,
      packageDesc: null,
      containerType: null,
      // A per-kg price has no container, so there is no size to state. NULL,
      // never 0 — a 0 would be a volume the issuer never published.
      sizeValue: null,
      sizeUnit: null,
      price,
      currency: "GBP",
      priceUnit: `per ${unit}`,
      pack: null,
      containerCharge: null,
      isPromotion: false,
      sourceStatus: null,
      attribution: DEFRA_ATTRIBUTION,
      sourceUrl: DEFRA_CSV_URL,
      sourceRef: `${DEFRA_SERIES_URL}#${key}`,
      externalIds: { category, item, variety },
      raw: { ...(r as Record<string, unknown>), fetchedAt },
    });
  }

  return {
    sourceKey: DEFRA_SOURCE_KEY,
    issuedAt,
    rowsRead: rows.length,
    sightings,
    refusals,
  };
}
