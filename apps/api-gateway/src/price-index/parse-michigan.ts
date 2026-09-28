/**
 * Parse the Michigan Liquor Control Commission spirits price book (class B).
 *
 * WHAT THIS IS, AND WHY IT IS CLASS B
 * -----------------------------------
 * Michigan is a control state for spirits: the MLCC buys every bottle and
 * publishes what a licensee pays for it. The book's `LICENSEE PRICE` column is
 * therefore a genuine POSTED WHOLESALE price for the three Michigan houses —
 * not a shelf price and not a retail reference. The issuer's own page defines
 * every column (read 2026-09-05 from an Internet Archive capture of
 * `michigan.gov`, because the live host refuses this fetcher):
 *
 *   BASE PRICE     — "what the State of Michigan paid for the liquor (including
 *                     the Federal Excise Tax), plus a 65% markup".
 *   LICENSEE PRICE — "the price paid by licensees. It includes the 17% licensee
 *                     discount and the specific taxes of 4% + 4% + 4%, computed
 *                     on the base price."
 *   MINIMUM SHELF  — the minimum an SDD may show on its shelf. Retail.
 *
 * So `LICENSEE PRICE` is the number a Michigan restaurant is charged, and it is
 * what this parser emits, with `priceBasis` carrying the issuer's own words so
 * it can never be silently compared with the base or the shelf price. Both of
 * those are kept on `raw` — recorded, never emitted as the price.
 *
 * WHY THERE IS NO FETCHER FOR IT
 * ------------------------------
 * There is no machine endpoint and no reachable host. Measured 2026-09-05:
 * `www.michigan.gov` answers **403** (`server: AkamaiGHost`; the CNAME chain
 * ends `e4514.ksd.akamaiedge.net` — Akamai Kona Site Defender) to a polite,
 * identifying, anonymous client on the price-book page, on a direct PDF and on
 * `robots.txt` itself; `www.legislature.mi.gov` answers 403 from its own WAF;
 * and `data.michigan.gov` — the state's Socrata open-data portal, which DOES
 * serve this fetcher — publishes `Disallow: /` for `User-agent: *`, forbidding
 * us to read it whether or not a liquor dataset is ever added. There is no S3,
 * CDN, FTP, legislature or distributor mirror of the book.
 *
 * The only honest live path is therefore a PERSON: a manager downloads the
 * Excel from michigan.gov in a browser, which works, and uploads it
 * (`price-index-upload.service.ts`). This parser is the half of that path that
 * turns a workbook into sightings, and it is written against real MLCC rows
 * (`__fixtures__/MICHIGAN-PROVENANCE.md`), never against an invented one.
 *
 * THE DATE IS IN THE FILE NAME AND NOWHERE ELSE
 * ---------------------------------------------
 * Measured on the real workbook: no cell in the sheet carries an effective
 * date, and `docProps` carries only the day it was authored. The edition date
 * lives in the file name (`8-3-25-PRICE-BOOK-EXCEL.xlsx`) alone. So `issuedAt`
 * is a REQUIRED argument here and a file whose name does not state a date is
 * refused upstream — never dated by the upload clock, which would silently
 * present a years-old book as this quarter's. That is the exact fault ADR
 * 0117's staleness gate exists for.
 */

import {
  ParseRun,
  PostingRefusal,
  PostingSighting,
  asNumber,
  asPositiveInt,
} from "./price-index.types";

export const MICHIGAN_SOURCE_KEY = "michigan-lcc-spirits-price-book";
/** Where a person goes to get the file. Never fetched by this process. */
export const MICHIGAN_URL =
  "https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info";
export const MICHIGAN_ISSUER = "Michigan Liquor Control Commission";
export const MICHIGAN_STATE = "US-MI";

/**
 * The issuer's own definition of the number we take, carried on every row so a
 * reader can never mistake it for the base price or the shelf price.
 */
export const MICHIGAN_PRICE_BASIS =
  "LICENSEE PRICE (MLCC base price less the 17% licensee discount, plus 4%+4%+4% specific taxes)";

/**
 * The measured band for `LICENSEE PRICE / BASE PRICE` across all 12,530 product
 * rows of the 2025-08-03 edition: median 0.949944, min 0.9194, max 0.9773. The
 * issuer states the arithmetic as x0.95 but rounds each step, so a couple of
 * thousand rows miss the single-factor result by a cent. A band is therefore
 * the only honest cross-check, and these bounds sit OUTSIDE the measured
 * extremes so a real row is never refused for the Commission's own rounding —
 * while a column mix-up (the base price read as the licensee price, or a
 * shifted row) still fails it.
 */
export const LICENSEE_RATIO_MIN = 0.85;
export const LICENSEE_RATIO_MAX = 1.0;

/** The twelve columns of the book, in order, as the issuer publishes them. */
export const MICHIGAN_COLUMNS = [
  "MI", // (1) 'MI' marks a licensed Michigan distiller; blank otherwise
  "ADA #", // (2) which Authorized Distribution Agent warehouses it
  "LIQUOR CODE", // (3) the Commission's item number
  "", // (4) an always-empty spacer column in the published workbook
  "BRAND NAME", // (5)
  "PROOF", // (6)
  "SIZE IN ML", // (7)
  "PACK SIZE", // (8) bottles per case
  "BASE PRICE", // (9)
  "LICENSEE PRICE", // (10) <- the number this parser emits
  "MINIMUM SHELF PRICE", // (11)
  "NEW/CHNG", // (12)
] as const;

/** One workbook row: twelve cells, in the published column order. */
export type MichiganRow = unknown[];

export class MichiganShapeError extends Error {}

/**
 * `8-3-25-PRICE-BOOK-EXCEL.xlsx` -> `2025-08-03`.
 *
 * The MLCC names every edition `<M>-<D>-<YY>-<KIND>.<ext>`, with one or two
 * digits for the month and the day (`12-03-23-…` and `1-4-26-…` both occur in
 * the published series). Returns null — never a guess and never the clock —
 * when the name states no date, when the date is not a real calendar day, or
 * when it lies in the future.
 */
export function readEditionDate(
  fileName: string | null | undefined,
  today: Date = new Date(),
): string | null {
  if (!fileName) return null;
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const m = /^(\d{1,2})-(\d{1,2})-(\d{2})\b/.exec(base.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = 2000 + Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject a day the calendar does not have (2-31, 4-31, ...).
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  // A book cannot have been issued after today. A future name is a renamed file
  // or a typo, and dating the register from it would be worse than refusing it.
  const ref = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  if (d.getTime() > ref) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The book's column header is THREE stacked lines, not one — measured on the
 * real file:
 *
 *   1: MI | ADA | LIQUOR |  | BRAND NAME | PROOF | SIZE | PACK | BASE | LICENSEE | MINIMUM | NEW/
 *   2:    | #   | CODE   |  |            |       | IN ML| SIZE | PRICE| PRICE    | SHELF   | CHNG
 *   3:    |     |        |  |            |       |      |      |      |          | PRICE   |
 *
 * Only the first line carries LIQUOR + BRAND NAME + LICENSEE. Lines 2 and 3 are
 * continuations, and a parser that only knew line 1 refused them as "no brand"
 * and "no liquor code" — a true refusal of a row that is not a product, filed
 * under a reason that says the book is malformed. So header-ness is decided by
 * VOCABULARY: a row is a header line when every non-empty cell it has is one of
 * the words the header is made of.
 */
const HEADER_WORDS = new Set([
  "MI",
  "ADA",
  "#",
  "LIQUOR",
  "CODE",
  "BRAND NAME",
  "PROOF",
  "SIZE",
  "IN ML",
  "PACK",
  "BASE",
  "PRICE",
  "LICENSEE",
  "MINIMUM",
  "SHELF",
  "NEW/",
  "CHNG",
]);

function isHeaderRow(cells: MichiganRow): boolean {
  const words = cells
    .map((c) => (typeof c === "string" ? c.trim().toUpperCase() : ""))
    .filter((w) => w !== "");
  if (words.length === 0) return false;
  // A numeric cell anywhere means this is data, never a header line.
  if (cells.some((c) => typeof c === "number")) return false;
  return words.every((w) => HEADER_WORDS.has(w));
}

/**
 * The full first header line — LIQUOR, BRAND NAME and LICENSEE together. Used
 * once, as the "is this actually the MLCC price book" gate, so a workbook whose
 * header vocabulary happens to overlap cannot pass as one.
 */
function hasPriceBookHeader(cells: MichiganRow): boolean {
  const joined = cells
    .map((c) => (typeof c === "string" ? c.trim().toUpperCase() : ""))
    .join("|");
  return (
    joined.includes("LIQUOR") &&
    joined.includes("BRAND NAME") &&
    joined.includes("LICENSEE")
  );
}

/**
 * A category heading — one string in column A and every other cell empty
 * ('AMERICAN BLEND', 'AMERICAN BLEND (CONTINUED)'). It is carried down onto the
 * rows beneath it as `raw.category`; it is not a product.
 */
function categoryOf(cells: MichiganRow): string | null {
  const first = typeof cells[0] === "string" ? cells[0].trim() : "";
  if (!first) return null;
  const restEmpty = cells
    .slice(1)
    .every((c) => c === null || c === undefined || String(c).trim() === "");
  return restEmpty ? first : null;
}

function isBlank(cells: MichiganRow): boolean {
  return cells.every(
    (c) => c === null || c === undefined || String(c).trim() === "",
  );
}

/**
 * Parse a workbook's rows into class-B sightings.
 *
 * Every row that cannot become a sighting is counted with a reason and never
 * dropped — including the structural ones (header, category heading, blank
 * spacer), which are the majority of a real book's non-product rows and would
 * otherwise vanish from the arithmetic.
 *
 * @param rows      one array of twelve cells per workbook row, in order
 * @param issuedAt  the edition date from `readEditionDate` — REQUIRED, because
 *                  the workbook itself carries none
 * @param sourceUrl where a person got the file; defaults to the MLCC page
 */
export function parseMichigan(
  rows: MichiganRow[],
  issuedAt: string,
  sourceUrl: string = MICHIGAN_URL,
): ParseRun {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new MichiganShapeError(
      "Michigan: zero rows read — the workbook is empty or its sheet moved.",
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedAt ?? "")) {
    throw new MichiganShapeError(
      "Michigan: no edition date. The price book states its date only in its file name, so an undated upload is refused rather than stamped with the upload clock.",
    );
  }
  if (!rows.some((r) => Array.isArray(r) && hasPriceBookHeader(r))) {
    throw new MichiganShapeError(
      "Michigan: the workbook carries no LIQUOR / BRAND NAME / LICENSEE header — this is not the MLCC price book, or its layout changed.",
    );
  }

  const sightings: PostingSighting[] = [];
  const refusals: PostingRefusal[] = [];
  const seen = new Set<string>();
  let category: string | null = null;

  for (const raw of rows) {
    const cells: MichiganRow = Array.isArray(raw) ? raw : [];

    if (isBlank(cells)) {
      refusals.push({ reason: "not_a_product_row", detail: "blank spacer row" });
      continue;
    }
    if (isHeaderRow(cells)) {
      refusals.push({ reason: "not_a_product_row", detail: "column header" });
      continue;
    }
    const cat = categoryOf(cells);
    if (cat) {
      category = cat;
      refusals.push({
        reason: "not_a_product_row",
        detail: `category heading '${cat}'`,
      });
      continue;
    }

    const michiganDistiller =
      typeof cells[0] === "string" && cells[0].trim().toUpperCase() === "MI";
    const ada =
      cells[1] === null || cells[1] === undefined ? null : String(cells[1]).trim();
    const code =
      cells[2] === null || cells[2] === undefined ? "" : String(cells[2]).trim();
    const brand = typeof cells[4] === "string" ? cells[4].trim() : "";
    const proof = asNumber(cells[5]);
    const sizeMl = asNumber(cells[6]);
    const pack = asPositiveInt(cells[7]);
    const basePrice = asNumber(cells[8]);
    const licensee = asNumber(cells[9]);
    const shelf = asNumber(cells[10]);
    const change =
      cells[11] === null || cells[11] === undefined ? "" : String(cells[11]).trim();

    if (!code) {
      refusals.push({
        reason: "no_liquor_code",
        detail: `brand '${brand}' carries no liquor code`,
      });
      continue;
    }
    if (!brand) {
      refusals.push({
        reason: "no_brand",
        detail: `liquor code ${code} carries no brand name`,
      });
      continue;
    }
    if (sizeMl === null || sizeMl <= 0) {
      // A zero or absent size is a division the register cannot defend, and it
      // is never assumed to be 750 ml.
      refusals.push({
        reason: "no_size",
        detail: `liquor code ${code}: SIZE IN ML = ${String(cells[6])}`,
      });
      continue;
    }
    if (pack === null) {
      refusals.push({
        reason: "bad_pack",
        detail: `liquor code ${code}: PACK SIZE = ${String(cells[7])}`,
      });
      continue;
    }
    if (licensee === null || licensee <= 0) {
      refusals.push({
        reason: "no_licensee_price",
        detail: `liquor code ${code}: LICENSEE PRICE = ${String(cells[9])}`,
      });
      continue;
    }
    if (basePrice !== null && basePrice > 0) {
      const ratio = licensee / basePrice;
      if (ratio < LICENSEE_RATIO_MIN || ratio > LICENSEE_RATIO_MAX) {
        refusals.push({
          reason: "licensee_price_out_of_band",
          detail: `liquor code ${code}: LICENSEE ${licensee} / BASE ${basePrice} = ${ratio.toFixed(4)}, outside the measured ${LICENSEE_RATIO_MIN}-${LICENSEE_RATIO_MAX} band`,
        });
        continue;
      }
    }
    if (shelf !== null && shelf > 0 && shelf < licensee) {
      // The shelf price is the licensee price plus the retailer's margin, and
      // the published file never violates that. If it does here, a column moved.
      refusals.push({
        reason: "shelf_below_licensee",
        detail: `liquor code ${code}: SHELF ${shelf} < LICENSEE ${licensee}`,
      });
      continue;
    }
    if (seen.has(code)) {
      refusals.push({
        reason: "duplicate_liquor_code",
        detail: `liquor code ${code} already seen in this book`,
      });
      continue;
    }
    seen.add(code);

    sightings.push({
      sourceKey: MICHIGAN_SOURCE_KEY,
      sourceClass: "posted_wholesale_list",
      state: MICHIGAN_STATE,
      region: null, // the book is state-wide
      issuer: MICHIGAN_ISSUER,
      issuedAt,
      priceBasis: MICHIGAN_PRICE_BASIS,
      productName: brand,
      brand: null, // the book publishes one name, not a brand/product split
      producer: null,
      packageDesc: null,
      containerType: null,
      sizeValue: sizeMl,
      sizeUnit: "ml",
      price: licensee,
      currency: "USD",
      // Proved by the file's own arithmetic: a 750 ml whiskey with a pack of 12
      // and a $16.99 shelf price is a bottle price, not a case price.
      priceUnit: "per bottle",
      pack,
      containerCharge: null,
      isPromotion: false,
      // The book publishes no status column; `NEW` is the nearest thing it has.
      sourceStatus: /\bNEW\b/i.test(change) ? "NEW" : null,
      // Michigan declares no licence for the book and michigan.gov's own footer
      // asserts "Copyright State of Michigan". Unstated terms are recorded as
      // unstated, never as permissive — the Oregon precedent in ADR 0117.
      attribution: null,
      sourceUrl,
      sourceRef: `mlcc:price-book:${issuedAt}#liquor_code=${code}`,
      externalIds: { liquor_code: code, ada: ada ?? "" },
      raw: {
        category,
        michiganDistiller,
        adaNumber: ada,
        proof,
        basePrice,
        minimumShelfPrice: shelf,
        // NEW/CHNG mixes a flag with a signed change written two ways ('-10'
        // and '(6.00)   NEW'); the issuer documents neither, so the raw string
        // is kept and nothing numeric is inferred from it.
        newOrChangeRaw: change || null,
      },
    });
  }

  return {
    sourceKey: MICHIGAN_SOURCE_KEY,
    issuedAt,
    rowsRead: rows.length,
    sightings,
    refusals,
  };
}
