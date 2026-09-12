/**
 * Parse a California ABC beer price posting into index sightings.
 *
 * WHAT THIS IS, AND HOW IT IS FETCHED (measured 2026-09-04)
 * --------------------------------------------------------
 * California requires beer manufacturers and wholesalers to file price postings
 * with the Department of Alcoholic Beverage Control, public since 2023-10-15
 * (ADR 0117, class B). The public search at `priceposting.abc.ca.gov` is a
 * single-page app; its data comes from an AWS AppSync endpoint
 * (`.../prod/public/graphql`) whose "public" queries are authorised by a JWT
 * the app SIGNS IN THE BROWSER with a secret shipped in its own bundle. So the
 * anonymous path a member of the public uses is: mint that JWT, POST the
 * `PricePostings` query. That is exactly what `fetchCalifornia` does — nothing
 * is scraped, and no login the house lacks is used. `priceposting.abc.ca.gov`
 * serves no robots.txt (its SPA catch-all answers 404 for it); the request
 * carries an identifying User-Agent and is made once per county per day.
 *
 * WHY BEER IS NOT NORMALISED TO A 750ml BOTTLE
 * --------------------------------------------
 * The market box's consensus normalises wine to a 750ml equivalent. Beer posts
 * in millilitres, ounces, litres and GALLONS (kegs), and a keg reduced to a
 * "750ml bottle price" is a meaningless number. This is an INDEX register, not
 * a consensus input: it stores the price AS POSTED, with its own unit and
 * package, and the endpoint shows it labelled. Nothing here divides a keg.
 *
 * THE SOURCE'S OWN DEFECTS, COUNTED NOT DROPPED (ADR 0117)
 * -------------------------------------------------------
 *  superseded         status is 'Old' or 'Inactive' — a prior posting, not the
 *                     current price. The source's own freshness signal.
 *  no_price           price missing or <= 0.
 *  no_issue_date      no effectiveDate — cannot be dated by its issuer.
 *  duplicate_posting  the same (source_ref, content_hash) twice in one pull.
 *
 * A row with no stated size is ADMITTED with sizeValue null (a can may post its
 * size in the package text, not the size field) — null is a fact; it is never
 * defaulted to a number. `pack` is null for California on purpose: the package
 * is descriptive ('4 x 6 Pack', '1 Keg', '24 Loose') and no honest integer pack
 * exists, so `package_desc` is kept verbatim and `pack` stays unknown.
 */

import {
  ParseRun,
  PostingRefusal,
  PostingSighting,
  asNumber,
  contentHash,
} from "./price-index.types";

export const CALIFORNIA_SOURCE_KEY = "california-abc-beer-price-posting";
export const CALIFORNIA_URL =
  "https://priceposting.abc.ca.gov/publicPricePosts";
export const CALIFORNIA_ISSUER =
  "California Department of Alcoholic Beverage Control";
export const CALIFORNIA_STATE = "US-CA";

/** The AppSync result shape, as recovered from the app's own bundle. */
export interface CaliforniaPosting {
  id?: string | number;
  manufacturer?: { name?: string | null } | null;
  product?: { name?: string | null; tradeName?: string | null } | null;
  status?: string | null;
  package?: { package?: string | null } | null;
  productSize?: {
    size?: number | null;
    unit?: { unit?: string | null } | null;
    containerType?: { type?: string | null } | null;
  } | null;
  county?: string | null;
  pricesTo?: { name?: string | null } | null;
  receivingMethod?: string | null;
  price?: number | null;
  pricePromotion?: boolean | null;
  containerCharge?: number | null;
  effectiveDate?: number | null; // epoch ms
  createdAt?: number | null;
  createdByLicensee?: { id?: string | number | null; name?: string | null } | null;
}

/** The keys a California posting must carry for the parser to trust the shape. */
const REQUIRED_KEYS: Array<keyof CaliforniaPosting> = [
  "id",
  "status",
  "price",
  "effectiveDate",
  "productSize",
  "pricesTo",
];

export class CaliforniaShapeError extends Error {}

function epochMsToIsoDate(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseCalifornia(
  rows: CaliforniaPosting[],
  fetchedAt: string,
  county: string | null = null,
): ParseRun {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new CaliforniaShapeError(
      "California: zero rows — the AppSync query or the JWT auth path moved.",
    );
  }
  const first = rows[0];
  const missing = REQUIRED_KEYS.filter((k) => !(k in first));
  if (missing.length) {
    throw new CaliforniaShapeError(
      `California: the posting shape changed — missing ${missing.join(", ")}. Re-read the PricePostings query in the app bundle before trusting any parse.`,
    );
  }

  const sightings: PostingSighting[] = [];
  const refusals: PostingRefusal[] = [];
  const seen = new Set<string>();
  let newestIssued: string | null = null;

  for (const r of rows) {
    const status = (r.status ?? "").trim();
    // The source's own freshness signal: only an Active posting is current.
    if (status !== "Active") {
      refusals.push({
        reason: "superseded",
        detail: `status=${status || "(blank)"} — a prior posting, not the current price`,
      });
      continue;
    }

    const issuedAt = epochMsToIsoDate(r.effectiveDate);
    if (!issuedAt) {
      refusals.push({
        reason: "no_issue_date",
        detail: `effectiveDate=${String(r.effectiveDate)}`,
      });
      continue;
    }

    const price = asNumber(r.price);
    if (price === null || price <= 0) {
      refusals.push({ reason: "no_price", detail: `price=${String(r.price)}` });
      continue;
    }

    const size = asNumber(r.productSize?.size);
    const sizeValue = size !== null && size > 0 ? size : null;
    const priceBasis = (r.pricesTo?.name ?? "").trim() || "Unspecified";

    const sighting: PostingSighting = {
      sourceKey: CALIFORNIA_SOURCE_KEY,
      sourceClass: "posted_wholesale_list",
      state: CALIFORNIA_STATE,
      region: (r.county ?? county ?? null)?.toString().trim() || null,
      issuer: CALIFORNIA_ISSUER,
      issuedAt,
      priceBasis,
      productName: (r.product?.name ?? "").toString().trim() || "(unnamed)",
      brand: (r.product?.tradeName ?? "").toString().trim() || null,
      producer: (r.manufacturer?.name ?? "").toString().trim() || null,
      packageDesc: (r.package?.package ?? "").toString().trim() || null,
      containerType:
        (r.productSize?.containerType?.type ?? "").toString().trim() || null,
      sizeValue,
      sizeUnit: (r.productSize?.unit?.unit ?? "").toString().trim() || null,
      price,
      currency: "USD",
      // California posts the price for the whole package it describes.
      priceUnit: "per package",
      pack: null,
      containerCharge: asNumber(r.containerCharge),
      isPromotion: r.pricePromotion === true,
      sourceStatus: status,
      // No licence is declared by ABC for this data; unstated, never permissive.
      attribution: null,
      sourceUrl: CALIFORNIA_URL,
      sourceRef: `${CALIFORNIA_URL}#id=${String(r.id)}`,
      externalIds: {
        postingId: String(r.id ?? ""),
        licenseeId: String(r.createdByLicensee?.id ?? ""),
      },
      raw: r as unknown as Record<string, unknown>,
    };

    const hash = contentHash(sighting);
    const dedupKey = `${sighting.sourceRef}::${hash}`;
    if (seen.has(dedupKey)) {
      refusals.push({
        reason: "duplicate_posting",
        detail: `posting ${String(r.id)} at the same price already seen in this pull`,
      });
      continue;
    }
    seen.add(dedupKey);

    if (!newestIssued || issuedAt > newestIssued) newestIssued = issuedAt;
    sightings.push(sighting);
  }

  return {
    sourceKey: CALIFORNIA_SOURCE_KEY,
    issuedAt: newestIssued,
    rowsRead: rows.length,
    sightings,
    refusals,
  };
}
