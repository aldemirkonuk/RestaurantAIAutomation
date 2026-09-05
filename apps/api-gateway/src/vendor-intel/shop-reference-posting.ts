/**
 * A merchant shop's page, turned into a class-D retail reference posting.
 *
 * WHAT THIS IS
 * ------------
 * ADR 0117 Q9: the vendor sweep reads `providers`, and none of the vendors
 * there publishes a price. The founder's call of 2026-09-05 — *"point it at
 * merchant shops, as their own class"* — sends the sweep at retail shops
 * instead. A shop's shelf price is class D. Class D never enters the market
 * box, so this module produces a `PostingSighting` for
 * `price_index_postings`, NOT a `vendor_price_observations` row. That is the
 * whole separation: `belowTrailingAverage` reads the other table, so a retail
 * reference cannot reach the ladder even by mistake.
 *
 * WHY THIS READS THE MARKUP AND NOT A MODEL
 * -----------------------------------------
 * The vendor sweep sends page text to a model because a wholesaler's page is
 * prose. A merchant shop is a commerce platform, and every shop measured
 * publishes its price as machine-readable data — schema.org, microdata or Open
 * Graph. Reading the markup is deterministic, costs no tokens, is testable
 * against a recorded file, and cannot hallucinate a number. It is also the only
 * way to see the price at all on a shop whose price never reaches the text
 * layer: `htmlToText` drops `<script>`, which is where the offer lives.
 *
 * THE PRECEDENCE, AND WHY IN THIS ORDER (measured 2026-09-05)
 * ----------------------------------------------------------
 * 1. **schema.org `Offer`** inside a `Product` node. The merchant's own
 *    machine statement, the only one that carries `priceCurrency` and the only
 *    one that ever carries a DATE (`validFrom`). Present on 6 of 6 recorded
 *    fixture pages.
 * 2. **Microdata `itemprop="price"`.** The same statement inline. It is the
 *    ONLY machine-readable price on Hi-Time Wine Cellars, whose single JSON-LD
 *    block is a BreadcrumbList — which is why this step exists rather than
 *    stopping at schema.org.
 * 3. **Open Graph `product:price:amount` / `og:price:amount`.** Last, because
 *    a share tag is written for a scraper's benefit and drifts: the Wine
 *    Chateau page carries two different `og:title` values, and Hedonism's
 *    `og:price:currency` is USD on a London shop.
 *
 * IDENTITY IS CHECKED BEFORE THE PRICE IS BELIEVED
 * ------------------------------------------------
 * `bbr-dom-perignon-2026-09-04.fixture.html` is a Dom Perignon page whose only
 * JSON-LD block describes **Caol Ila 25-Year-Old whisky at GBP 225**. A reader
 * that trusted structured data because it is structured would file GBP 225 as
 * the price of the champagne. So an offer is only read from a product node
 * whose identity matches the page's own title (`sameProduct`, imported from
 * `bottle-size.ts` rather than re-implemented), and a page whose structured
 * data names only OTHER products is refused as `identity_conflict` — never
 * quietly downgraded to the Open Graph price, which on that page would have
 * been the champagne's price attached to the whisky's structured data.
 *
 * THE FIVE LEGS, AND THE TWO THIS CLASS FAILS MOST
 * ------------------------------------------------
 * ADR 0117 admits a row only if it names the number, the publisher, the date,
 * the unit and where it is a price. A shop names the publisher (itself), the
 * unit (via `readBottleSize`) and the place (the registry's jurisdiction). It
 * fails on the DATE far more often than anything else: of the six recorded
 * pages, exactly ONE states `Offer.validFrom`. Those five are refused
 * `no_issue_date` rather than filed with our fetch clock, because
 * `price_index_postings.issued_at` is documented as "the ISSUER's own
 * effective/publication date, never the fetch date" and `refuseStale` treats
 * that column as the freshness signal — a row dated by our own fetch is fresh
 * by construction and would make the staleness gate vacuous for the whole
 * class. Whether a shop price may instead be filed with a read-date basis is a
 * decision for the founder, not a default taken here (ADR 0117 Q13).
 */

import {
  BottleSizeReading,
  PageSizeEvidence,
  readBottleSize,
  sameProduct,
} from "./bottle-size";
import { PostingSighting } from "../price-index/price-index.types";
import { ShopEntry } from "./price-reference-shops";

/** Where a price was read. The precedence order is the array order. */
export type OfferSource = "json_ld_offer" | "microdata" | "og_meta";

export const OFFER_SOURCE_ORDER: readonly OfferSource[] = Object.freeze([
  "json_ld_offer",
  "microdata",
  "og_meta",
]);

/** Why a shop page produced no posting. A value, never an absence. */
export type ShopRefusalReason =
  | "no_offer"
  | "identity_conflict"
  | "price_conflict"
  | "currency_unstated"
  | "currency_not_jurisdiction"
  | "no_issue_date"
  | "bad_price"
  | "no_bottle_volume"
  | "volume_conflict";

export const SHOP_REFUSAL_SENTENCE: Readonly<Record<ShopRefusalReason, string>> =
  Object.freeze({
    no_offer:
      "The page publishes no machine-readable price — not in schema.org, not in microdata, not in Open Graph.",
    identity_conflict:
      "The page's structured data describes a different product from the page itself, so its price is not this product's price.",
    price_conflict:
      "The page states two or more different prices for this product and nothing on it says which one a reference line should carry.",
    currency_unstated:
      "A price was found and no currency was stated with it. A number without its currency is not a price.",
    currency_not_jurisdiction:
      "The shop served the price in a currency that is not its jurisdiction's, so the figure is not that market's shelf price.",
    no_issue_date:
      "The shop states no date its price applies from, and this register's date column is the issuer's date, never our fetch clock.",
    bad_price: "The price read is zero, negative or unparseable.",
    no_bottle_volume:
      "The page prints no bottle size, so the number has no unit to be compared in.",
    volume_conflict:
      "The page prints two different bottle sizes for this product and they disagree.",
  });

export interface ShopOfferCandidate {
  source: OfferSource;
  price: number;
  currency: string | null;
  /** The issuer's own date this price applies from, when it states one. */
  validFrom: string | null;
  priceValidUntil: string | null;
  availability: string | null;
  sku: string | null;
  /** The product node this offer hangs off, when the source has one. */
  productName: string | null;
  /** A struck-through was-price, when the shop publishes one. */
  wasPrice: number | null;
  locator: string;
  statement: string;
}

export interface ShopPageEvidence {
  offers: ShopOfferCandidate[];
  /** Every product node the structured data names, matched or not. */
  structuredProductNames: string[];
  /**
   * Every claim the page makes about what it is — each `og:title`, then the
   * `<title>`. A set, because shops publish more than one and they disagree.
   */
  pageTitles: string[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Reading the markup
// ---------------------------------------------------------------------------

function metaContent(html: string, key: string): string | null {
  // Attribute order and whitespace vary between platforms (Shopify writes the
  // property and content on separate lines), so both orders are tried and
  // newlines are allowed inside the tag.
  const patterns = [
    new RegExp(
      `<meta[^>]*?(?:property|name)\\s*=\\s*["']${key}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`,
      "is",
    ),
    new RegExp(
      `<meta[^>]*?content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${key}["']`,
      "is",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] != null && m[1].trim()) return m[1].trim();
  }
  return null;
}

/**
 * EVERY value a page gives for one meta property, in document order.
 *
 * Not the first, and not the last. The Wine Chateau page carries THREE
 * `og:title` tags and the first is the shop's own slogan
 * ("Buy Wine Online - WineChateau(R) for Fine Wines"), with the product's name
 * second and third. Reading the first made the identity gate refuse a page
 * that was perfectly well formed about its product; reading the last would be
 * just as arbitrary. So the page's claim about what it is is the SET of titles
 * it publishes, and a product node matches if it matches any of them.
 */
function metaContents(html: string, key: string): string[] {
  const re = new RegExp(
    `<meta[^>]*?(?:property|name)\\s*=\\s*["']${key}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`,
    "gis",
  );
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    const v = (m[1] ?? "").trim();
    if (v) out.push(v);
  }
  return out;
}

function asPrice(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function asIsoDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  // The issuer's own string, accepted only when it is a real calendar date.
  // Slurp publishes `priceValidUntil: "2027-09-5"` — a single-digit day — so a
  // shape test is not enough and the value is parsed.
  const d = new Date(v.trim().length <= 10 ? `${v.trim()}T00:00:00Z` : v.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function typesOf(node: any): string[] {
  const t = node?.["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x) => typeof x === "string");
  return [];
}

function offersOf(node: any): any[] {
  const o = node?.offers;
  if (!o) return [];
  return Array.isArray(o) ? o : [o];
}

/**
 * Every price this page states, with where it was read.
 *
 * Never throws: a shop's JSON-LD is third-party text and a single malformed
 * block must not cost the whole page. An unparseable block is a note, not an
 * exception — the same rule `normalizeExtraction` applies to the model's JSON.
 */
export function readShopOffers(html: string): ShopPageEvidence {
  const offers: ShopOfferCandidate[] = [];
  const structuredProductNames: string[] = [];
  const notes: string[] = [];

  const blocks =
    html.match(
      /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ) ?? [];
  let blockIndex = 0;
  for (const raw of blocks) {
    blockIndex += 1;
    const body = raw.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      notes.push(`ld+json block ${blockIndex} did not parse and was skipped.`);
      continue;
    }
    const stack: any[] = [parsed];
    let guard = 0;
    while (stack.length && guard < 5000) {
      guard += 1;
      const node = stack.pop();
      if (Array.isArray(node)) {
        for (const v of node) stack.push(v);
        continue;
      }
      if (!node || typeof node !== "object") continue;
      for (const v of Object.values(node)) {
        if (v && typeof v === "object") stack.push(v);
      }
      const types = typesOf(node);
      if (!types.some((t) => t === "Product" || t === "ProductGroup")) continue;
      const name = typeof node.name === "string" ? node.name : null;
      if (name) structuredProductNames.push(name);
      const sku =
        typeof node.sku === "string"
          ? node.sku
          : typeof node.mpn === "string"
            ? node.mpn
            : null;
      for (const offer of offersOf(node)) {
        const otypes = typesOf(offer);
        const isAggregate = otypes.includes("AggregateOffer");
        const low = asPrice(offer?.lowPrice);
        const high = asPrice(offer?.highPrice);
        // An AggregateOffer whose bounds differ is a RANGE, not a price. It is
        // recorded as two candidates so the conflict is visible rather than
        // collapsed to whichever end a reader happens to take.
        const prices = isAggregate
          ? [low, high].filter((p): p is number => p !== null)
          : [asPrice(offer?.price)].filter((p): p is number => p !== null);
        for (const price of prices) {
          offers.push({
            source: "json_ld_offer",
            price,
            currency:
              typeof offer?.priceCurrency === "string"
                ? offer.priceCurrency.trim().toUpperCase().slice(0, 3)
                : null,
            validFrom: asIsoDate(offer?.validFrom),
            priceValidUntil: asIsoDate(offer?.priceValidUntil),
            availability:
              typeof offer?.availability === "string" ? offer.availability : null,
            sku:
              typeof offer?.sku === "string"
                ? offer.sku
                : typeof offer?.gtin13 === "string"
                  ? offer.gtin13
                  : sku,
            productName: name,
            wasPrice: null,
            locator: `ld+json block ${blockIndex}, ${isAggregate ? "AggregateOffer" : "Offer"} on ${JSON.stringify(name ?? "unnamed product")}`,
            statement: `${price}${offer?.priceCurrency ? ` ${offer.priceCurrency}` : ""}`,
          });
        }
      }
    }
  }

  // Microdata. The price and its currency are separate attributes; both are
  // read, and a price without a currency is kept so the refusal can say
  // "currency_unstated" rather than "no_offer" — those are different faults.
  const microPrice = html.match(
    /itemprop\s*=\s*["']price["'][^>]*content\s*=\s*["']([^"']+)["']/i,
  );
  if (microPrice) {
    const price = asPrice(microPrice[1]);
    const microCurrency = html.match(
      /itemprop\s*=\s*["']priceCurrency["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    );
    if (price !== null) {
      offers.push({
        source: "microdata",
        price,
        currency: microCurrency ? microCurrency[1].trim().toUpperCase().slice(0, 3) : null,
        validFrom: null,
        priceValidUntil: null,
        availability: null,
        sku: null,
        productName: null,
        wasPrice: null,
        locator: 'microdata itemprop="price"',
        statement: microPrice[0].slice(0, 120),
      });
    }
  }

  // Open Graph, last in the precedence.
  const ogAmount =
    metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount");
  const ogCurrency =
    metaContent(html, "product:price:currency") ?? metaContent(html, "og:price:currency");
  const ogWas = metaContent(html, "og:price:standard_amount");
  if (ogAmount) {
    const price = asPrice(ogAmount);
    if (price !== null) {
      offers.push({
        source: "og_meta",
        price,
        currency: ogCurrency ? ogCurrency.trim().toUpperCase().slice(0, 3) : null,
        validFrom: null,
        priceValidUntil: null,
        availability: null,
        sku: null,
        productName: null,
        wasPrice: asPrice(ogWas),
        locator: "og/product price meta",
        statement: `${ogAmount}${ogCurrency ? ` ${ogCurrency}` : ""}`,
      });
    }
  }

  const titles = metaContents(html, "og:title");
  const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  if (titleTag) titles.push(titleTag);
  const pageTitles = Array.from(new Set(titles.filter(Boolean)));
  if (pageTitles.length > 1) {
    notes.push(
      `The page publishes ${pageTitles.length} different titles for itself; a product node matching any of them is accepted.`,
    );
  }

  return { offers, structuredProductNames, pageTitles, notes };
}

// ---------------------------------------------------------------------------
// The judgement
// ---------------------------------------------------------------------------

export interface ShopPostingInput {
  shop: ShopEntry;
  url: string;
  html: string;
  /** Parsed once per page by the caller — the same evidence the size reader uses. */
  sizeEvidence: PageSizeEvidence;
  /** When WE fetched. Recorded on the row; never used as the issuer's date. */
  fetchedAt: string;
}

export type ShopPostingDecision =
  | { write: false; reason: ShopRefusalReason; message: string }
  | {
      write: true;
      sighting: PostingSighting;
      /** Kept so the caller can count where sizes and prices were read. */
      offerSource: OfferSource;
      volume: BottleSizeReading;
    };

/**
 * Build one class-D posting from a shop page, or say which leg is missing.
 *
 * Pure: no clock of its own, no network, no database. The fetch time is passed
 * in so a test can pin it, and the decision is the same for the same bytes.
 */
export function decideShopPosting(input: ShopPostingInput): ShopPostingDecision {
  const { shop, url, html, sizeEvidence, fetchedAt } = input;
  const evidence = readShopOffers(html);
  const refuse = (reason: ShopRefusalReason, extra: string): ShopPostingDecision => ({
    write: false,
    reason,
    message: `${SHOP_REFUSAL_SENTENCE[reason]} ${extra} (${shop.shopName}, ${url})`,
  });

  if (evidence.offers.length === 0) {
    return refuse(
      "no_offer",
      evidence.structuredProductNames.length > 0
        ? `Structured data is present and names ${evidence.structuredProductNames.length} product(s) but carries no offer.`
        : "No structured data, microdata or price meta tag was found.",
    );
  }

  // IDENTITY FIRST. A structured offer is only this product's price if the node
  // it hangs off is this product. Measured on the Dom Perignon page whose only
  // JSON-LD block is a whisky at GBP 225.
  const pageTitles = evidence.pageTitles;
  const structured = evidence.offers.filter((o) => o.source === "json_ld_offer");
  const matchesPage = (name: string | null, sku: string | null): boolean =>
    pageTitles.some((t) =>
      sameProduct({ name, sku, mpn: null }, { productName: t }),
    );
  const matching = structured.filter((o) => matchesPage(o.productName, o.sku));
  // The product name to file under is the node's, when a node matched, and
  // otherwise the LONGEST title the page publishes — a shop's slogan is short
  // and generic, a product's name is not.
  const pageName =
    [...pageTitles].sort((a, b) => b.length - a.length)[0] ?? null;
  if (structured.length > 0 && matching.length === 0) {
    return refuse(
      "identity_conflict",
      `Its structured data names ${JSON.stringify(
        evidence.structuredProductNames.slice(0, 2).join(" / ") || "an unnamed product",
      )} while the page calls itself ${JSON.stringify(pageTitles.join(" / "))}; ` +
        `the Open Graph price was NOT used instead, because a page whose machine data ` +
        `is about another product cannot be trusted to have got the rest right.`,
    );
  }

  // The candidates in precedence order, best first.
  const ordered = [...evidence.offers].sort(
    (a, b) =>
      OFFER_SOURCE_ORDER.indexOf(a.source) - OFFER_SOURCE_ORDER.indexOf(b.source),
  );
  const usable = matching.length > 0 ? matching : ordered;
  const best = usable[0];

  // ONE PRODUCT, ONE PRICE. Distinct prices from the same page are a range or a
  // variant list; either way nothing on the page says which one a single
  // reference line should carry, and picking is a guess.
  const distinct = Array.from(new Set(usable.map((o) => o.price)));
  // A was-price is published on the Open Graph tag while the live price is in
  // the JSON-LD offer, so it is collected across every candidate rather than
  // read off the winning one — measured on Hi-Time, whose
  // `og:price:standard_amount` is 59.95 against a `product:price:amount` of
  // 54.99.
  const wasPrices = new Set(
    evidence.offers.map((o) => o.wasPrice).filter((p): p is number => p !== null),
  );
  const conflicting = distinct.filter((p) => !wasPrices.has(p) || p === best.price);
  if (conflicting.length > 1) {
    return refuse(
      "price_conflict",
      `It states ${conflicting
        .slice(0, 4)
        .map((p) => p.toFixed(2))
        .join(" and ")} for the same product.`,
    );
  }

  if (!(best.price > 0)) {
    return refuse("bad_price", `The figure read was ${JSON.stringify(best.price)}.`);
  }

  if (!best.currency) {
    return refuse("currency_unstated", `Read from ${best.locator}.`);
  }
  if (best.currency !== shop.currency) {
    return refuse(
      "currency_not_jurisdiction",
      `It served ${best.currency} where ${shop.jurisdiction} prices in ${shop.currency}; ` +
        `read from ${best.locator}.`,
    );
  }

  // THE DATE. The register's `issued_at` is the issuer's own date by column
  // contract, and `refuseStale` reads it as the freshness signal. A shop that
  // states none is refused rather than stamped with our clock.
  const issuedAt = usable.map((o) => o.validFrom).find((d): d is string => !!d) ?? null;
  if (!issuedAt) {
    const until = usable.map((o) => o.priceValidUntil).find((d): d is string => !!d);
    return refuse(
      "no_issue_date",
      until
        ? `It states only priceValidUntil ${until}, which bounds the price forward and says nothing about when it began.`
        : "Neither validFrom nor any dated statement appears on the page.",
    );
  }

  // THE UNIT. Delegated to the size reader, never re-implemented: a second
  // answer to "how big is this bottle" is a second answer.
  const volume = readBottleSize(sizeEvidence, {
    productName: pageName,
    sku: best.sku,
    price: best.price,
  });
  if (!volume.read) {
    return refuse(volume.reason, volume.message);
  }

  const pack = volume.packFromStatement ?? 1;
  const wasPrice = Math.max(0, ...Array.from(wasPrices));
  const isPromotion = wasPrice > best.price;
  const productName = (matching[0]?.productName ?? pageName ?? "").trim();
  if (!productName) {
    return refuse("no_offer", "The page names no product this price could belong to.");
  }

  const sighting: PostingSighting = {
    sourceKey: shop.key,
    sourceClass: "retail_reference",
    state: shop.jurisdiction,
    region: null,
    issuer: shop.shopName,
    issuedAt,
    priceBasis: isPromotion ? "retail shelf price (promotion)" : "retail shelf price",
    productName: productName.slice(0, 300),
    brand: null,
    producer: null,
    packageDesc: pack > 1 ? `${pack} x ${volume.ml}ml` : null,
    containerType: null,
    sizeValue: volume.ml,
    sizeUnit: "ml",
    price: best.price,
    currency: best.currency,
    priceUnit: pack > 1 ? "per package" : "per bottle",
    pack,
    containerCharge: null,
    isPromotion,
    sourceStatus: best.availability
      ? best.availability.split("/").pop() ?? best.availability
      : null,
    // NULL, not a permissive default: no shop in the registry declares a
    // licence over its prices, and unstated terms are recorded as unstated.
    attribution: null,
    sourceUrl: url,
    // Per item, matching the vendor sweep's own key shape: the page is one
    // document but the row is one product, and the (source_ref, content_hash)
    // uniqueness is only meaningful per row.
    sourceRef: `${url}#${productName}`.slice(0, 400),
    externalIds: best.sku ? { sku: best.sku } : {},
    raw: {
      origin: "price_reference_shop_sweep",
      shopKey: shop.key,
      fetchedAt,
      offerSource: best.source,
      offerLocator: best.locator,
      offerStatement: best.statement,
      wasPrice: wasPrice > 0 ? wasPrice : null,
      priceValidUntil: best.priceValidUntil,
      pageTitles,
      structuredProductNames: evidence.structuredProductNames.slice(0, 5),
      volume: {
        source: volume.source,
        statement: volume.statement,
        locator: volume.locator,
        nonStandardFormat: volume.nonStandardFormat,
        notes: volume.notes.slice(0, 6),
      },
      readerNotes: evidence.notes,
    },
  };

  return { write: true, sighting, offerSource: best.source, volume };
}

/** Zeroed tallies, never absent keys — an absent key and a zero read alike. */
export function emptyShopRefusalCounts(): Record<ShopRefusalReason, number> {
  return {
    no_offer: 0,
    identity_conflict: 0,
    price_conflict: 0,
    currency_unstated: 0,
    currency_not_jurisdiction: 0,
    no_issue_date: 0,
    bad_price: 0,
    no_bottle_volume: 0,
    volume_conflict: 0,
  };
}
