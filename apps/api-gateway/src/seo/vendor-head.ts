import type {
  PublicVendorListing,
  PublicVendorPage,
} from "../vendor-portal/vendor-portal.service";

/**
 * What a published vendor catalogue says about itself to machines.
 *
 * The page at https://mudavym.com/v/:slug is served by the web project's
 * middleware (apps/web/middleware.ts), which asks this builder for the head,
 * the structured data and the plain facts of the body in one call. It lives
 * here, beside the data, so there is one statement of the catalogue.
 *
 * Emit no claim rather than a weak one. Concretely, every rule below exists
 * because the earlier builder (VendorPortalService.buildJsonLd) broke it:
 *
 * - Stock is stated only when the vendor stated it. `in_stock` null means
 *   "not said", and it used to be published as InStock.
 * - Country of origin comes only from `country`. A region is not a country,
 *   and it used to be published as one.
 * - A case price is a case price. `price` is for the whole pack (the page
 *   divides by pack_size for its per-750ml column), so a pack of more than one
 *   says so with `includesObject`, never as a per-bottle Offer.
 *   `eligibleQuantity` is the order-quantity interval, so it carries the
 *   minimum order and nothing else.
 * - The canonical URL is computed here. The old `/jsonld?url=` let any caller
 *   write any URL into the markup.
 * - A vintage is a vintage (PropertyValue), not `productionDate`.
 *
 * The publisher is the vendor. Mudavym appears only as the site the page is
 * part of (`isPartOf`), never as seller or author: the vendor board carries
 * publisher attribution and no Mudavym seal (ADR 0149).
 */

export const CANONICAL_ORIGIN = "https://mudavym.com";
export const WEBSITE_ID = `${CANONICAL_ORIGIN}/#website`;
const DESCRIPTION_MAX = 160;

export interface VendorListingFacts {
  productName: string;
  producer: string | null;
  vintage: number | null;
  origin: string | null;
  format: string | null;
  price: string | null;
  inStock: boolean | null;
}

/** Mirrors apps/web/src/lib/seo/vendor.ts VendorHeadPayload. */
export interface VendorHeadPayload {
  slug: string;
  canonical: string;
  title: string;
  description: string;
  image: { url: string; alt: string } | null;
  jsonLd: Record<string, unknown>;
  page: {
    displayName: string;
    tagline: string | null;
    about: string | null;
    websiteUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    listings: VendorListingFacts[];
  };
}

export function vendorCanonical(slug: string): string {
  return `${CANONICAL_ORIGIN}/v/${slug}`;
}

/** Collapse whitespace and cut at a word boundary. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](\s|$)/);
  return end >= 0 ? flat.slice(0, end + 1) : flat;
}

/** Only an absolute https URL is published as a link or an image. */
function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function formatOf(l: PublicVendorListing): string | null {
  const parts: string[] = [];
  if (l.packSize > 1) parts.push(`${l.packSize}-pack`);
  if (l.volumeMl) {
    parts.push(
      l.volumeMl >= 1000 ? `${l.volumeMl / 1000}L` : `${l.volumeMl}ml`,
    );
  }
  if (l.unitLabel) parts.push(l.unitLabel);
  return parts.length ? parts.join(" · ") : null;
}

export function priceOf(l: PublicVendorListing): string | null {
  if (l.price === null) return null;
  let amount: string;
  try {
    amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: l.currency,
    }).format(l.price);
  } catch {
    // An unknown currency code is printed as the vendor typed it.
    amount = `${l.currency} ${l.price.toFixed(2)}`;
  }
  return l.packSize > 1 ? `${amount} per pack` : amount;
}

function originOf(l: PublicVendorListing): string | null {
  const parts = [l.region, l.country].filter((p): p is string => !!p);
  return parts.length ? parts.join(", ") : null;
}

function productOf(
  l: PublicVendorListing,
  seller: string,
): Record<string, unknown> {
  const properties: Record<string, unknown>[] = [];
  if (l.vintage !== null) {
    properties.push({ "@type": "PropertyValue", name: "Vintage", value: l.vintage });
  }
  if (l.region) {
    properties.push({ "@type": "PropertyValue", name: "Region", value: l.region });
  }
  if (l.grapeVarieties) {
    properties.push({
      "@type": "PropertyValue",
      name: "Grape varieties",
      value: l.grapeVarieties,
    });
  }

  const product: Record<string, unknown> = {
    "@type": "Product",
    name: l.productName,
    ...(l.producer ? { brand: { "@type": "Brand", name: l.producer } } : {}),
    ...(l.country
      ? { countryOfOrigin: { "@type": "Country", name: l.country } }
      : {}),
    ...(l.volumeMl
      ? { size: { "@type": "QuantitativeValue", value: l.volumeMl, unitText: "ml" } }
      : {}),
    ...(properties.length ? { additionalProperty: properties } : {}),
  };

  if (l.price !== null) {
    product.offers = {
      "@type": "Offer",
      price: l.price,
      priceCurrency: l.currency,
      ...(l.inStock === null
        ? {}
        : {
            availability: l.inStock
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
          }),
      ...(l.packSize > 1
        ? {
            includesObject: {
              "@type": "TypeAndQuantityNode",
              amountOfThisGood: l.packSize,
              typeOfGood: { "@type": "Product", name: l.productName },
              ...(l.unitLabel ? { unitText: l.unitLabel } : {}),
            },
          }
        : {}),
      ...(l.minOrderQuantity
        ? {
            eligibleQuantity: {
              "@type": "QuantitativeValue",
              minValue: l.minOrderQuantity,
            },
          }
        : {}),
      seller: { "@type": "Organization", name: seller },
    };
  }
  return product;
}

export function buildVendorHead(page: PublicVendorPage): VendorHeadPayload {
  const canonical = vendorCanonical(page.slug);
  const title = `${page.displayName} catalogue`;
  const n = page.listings.length;
  const description = clip(
    page.tagline?.trim() ||
      (page.about?.trim() ? firstSentence(page.about) : "") ||
      `${n} ${n === 1 ? "listing" : "listings"} published by ${page.displayName}.`,
    DESCRIPTION_MAX,
  );
  const logo = httpsUrl(page.logoUrl);
  const website = httpsUrl(page.websiteUrl);

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": canonical,
    url: canonical,
    name: title,
    description,
    isPartOf: { "@id": WEBSITE_ID },
    publisher: {
      "@type": "Organization",
      name: page.displayName,
      ...(website ? { url: website } : {}),
      ...(logo ? { logo } : {}),
    },
    mainEntity: {
      "@type": "ItemList",
      name: title,
      numberOfItems: n,
      itemListElement: page.listings.map((l, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: productOf(l, page.displayName),
      })),
    },
  };

  return {
    slug: page.slug,
    canonical,
    title,
    description,
    image: logo ? { url: logo, alt: `${page.displayName} logo` } : null,
    jsonLd,
    page: {
      displayName: page.displayName,
      tagline: page.tagline,
      about: page.about,
      websiteUrl: website,
      contactEmail: page.contactEmail,
      contactPhone: page.contactPhone,
      listings: page.listings.map((l) => ({
        productName: l.productName,
        producer: l.producer,
        vintage: l.vintage,
        origin: originOf(l),
        format: formatOf(l),
        price: priceOf(l),
        inStock: l.inStock,
      })),
    },
  };
}
