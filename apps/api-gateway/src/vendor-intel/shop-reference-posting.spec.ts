/**
 * The class-D shop reader, proven against synthetic pages for each rule and
 * against the six recorded merchant pages for the measurement.
 *
 * Every fixture here is a real page fetched on 2026-09-04 and reduced by the
 * mechanical rule in `__fixtures__/PROVENANCE.md`. No number, name, currency,
 * option or price in them was altered, so a refusal below is a refusal of what
 * a real merchant actually published.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readPageSizeEvidence } from "./bottle-size";
import { SHOPS, armedShopKeys } from "./price-reference-shops";
import {
  decideShopPosting,
  emptyShopRefusalCounts,
  readShopOffers,
} from "./shop-reference-posting";

const FIXTURES = join(__dirname, "__fixtures__");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const GB = SHOPS["tanners-gb"];

function page(opts: {
  title?: string;
  ld?: unknown;
  extra?: string;
}): string {
  return [
    `<html><head><title>${opts.title ?? "A wine"}</title>`,
    `<meta property="og:title" content="${opts.title ?? "A wine"}">`,
    opts.ld
      ? `<script type="application/ld+json">${JSON.stringify(opts.ld)}</script>`
      : "",
    opts.extra ?? "",
    `</head><body><p>Bottle size: 75cl</p></body></html>`,
  ].join("\n");
}

function decide(html: string, shop = GB, url = "https://example.test/products/x") {
  return decideShopPosting({
    shop,
    url,
    html,
    sizeEvidence: readPageSizeEvidence(html),
    fetchedAt: "2026-09-05T11:00:00.000Z",
  });
}

const offerLd = (over: Record<string, unknown> = {}) => ({
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Andre Clouet Silver Brut Nature Champagne",
  sku: "FC018",
  offers: {
    "@type": "Offer",
    price: 35,
    priceCurrency: "GBP",
    validFrom: "2026-09-05",
    availability: "http://schema.org/InStock",
    ...over,
  },
});

describe("readShopOffers", () => {
  it("reads a schema.org offer with its currency and its date", () => {
    const ev = readShopOffers(
      page({ title: "Andre Clouet Silver Brut Nature Champagne", ld: offerLd() }),
    );
    expect(ev.offers).toHaveLength(1);
    expect(ev.offers[0]).toMatchObject({
      source: "json_ld_offer",
      price: 35,
      currency: "GBP",
      validFrom: "2026-09-05",
    });
    expect(ev.structuredProductNames).toEqual([
      "Andre Clouet Silver Brut Nature Champagne",
    ]);
  });

  it("reads microdata when the page publishes no Product node", () => {
    const ev = readShopOffers(
      page({
        title: "Pommery Brut Royal",
        ld: { "@context": "https://schema.org", "@type": "BreadcrumbList" },
        extra:
          '<span itemprop="price" content="54.99"></span><span itemprop="priceCurrency" content="USD"></span>',
      }),
    );
    expect(ev.offers.map((o) => o.source)).toEqual(["microdata"]);
    expect(ev.offers[0].price).toBe(54.99);
    expect(ev.offers[0].currency).toBe("USD");
  });

  it("reads Open Graph last, and keeps the struck-through was-price", () => {
    const ev = readShopOffers(
      page({
        title: "Pommery Brut Royal",
        extra:
          '<meta property="product:price:amount" content="54.99" />' +
          '<meta property="product:price:currency" content="USD" />' +
          '<meta property="og:price:standard_amount" content="59.95" />',
      }),
    );
    expect(ev.offers).toHaveLength(1);
    expect(ev.offers[0].source).toBe("og_meta");
    expect(ev.offers[0].wasPrice).toBe(59.95);
  });

  it("does not throw on a malformed ld+json block, and says it skipped one", () => {
    const html =
      '<html><head><title>x</title><script type="application/ld+json">{ not json </script></head></html>';
    const ev = readShopOffers(html);
    expect(ev.offers).toHaveLength(0);
    expect(ev.notes.join(" ")).toContain("did not parse");
  });
});

describe("decideShopPosting", () => {
  it("files a class-D posting into the index register, never the market box", () => {
    const d = decide(
      page({ title: "Andre Clouet Silver Brut Nature Champagne", ld: offerLd() }),
    );
    expect(d.write).toBe(true);
    if (!d.write) return;
    expect(d.sighting.sourceClass).toBe("retail_reference");
    expect(d.sighting.state).toBe("GB-ENG");
    expect(d.sighting.issuer).toBe("Tanners Wines");
    expect(d.sighting.issuedAt).toBe("2026-09-05");
    expect(d.sighting.price).toBe(35);
    expect(d.sighting.currency).toBe("GBP");
    expect(d.sighting.sizeValue).toBe(750);
    expect(d.sighting.sizeUnit).toBe("ml");
    expect(d.sighting.priceUnit).toBe("per bottle");
    // The row carries no restaurant of any kind: the register is public and
    // keyed by jurisdiction, which is what keeps it out of a house's ladder.
    expect(Object.keys(d.sighting)).not.toContain("restaurantId");
  });

  it("refuses a page whose structured data is about another product", () => {
    const html = page({
      title: "2018 Champagne Dom Perignon, Brut",
      ld: {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Caol Ila, 25-Year-Old, Islay, Single Malt Scotch Whisky",
        sku: "1000-01-00700-00-8086983",
        offers: { "@type": "Offer", price: 225, priceCurrency: "GBP", validFrom: "2026-09-01" },
      },
    });
    const d = decide(html);
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toBe("identity_conflict");
    expect(d.message).toContain("Caol Ila");
  });

  it("refuses a price served in a currency that is not the shop's jurisdiction", () => {
    const d = decide(
      page({
        title: "Andre Clouet Silver Brut Nature Champagne",
        ld: offerLd({ priceCurrency: "USD" }),
      }),
    );
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toBe("currency_not_jurisdiction");
    expect(d.message).toContain("USD");
    expect(d.message).toContain("GBP");
  });

  it("refuses a page that states no date the price applies from", () => {
    const d = decide(
      page({
        title: "Andre Clouet Silver Brut Nature Champagne",
        ld: offerLd({ validFrom: undefined, priceValidUntil: "2026-12-04" }),
      }),
    );
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toBe("no_issue_date");
    expect(d.message).toContain("2026-12-04");
  });

  it("refuses two different prices for one product rather than picking one", () => {
    const d = decide(
      page({
        title: "Andre Clouet Silver Brut Nature Champagne",
        ld: {
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Andre Clouet Silver Brut Nature Champagne",
          offers: [
            { "@type": "Offer", price: 33.95, priceCurrency: "GBP", validFrom: "2026-09-05" },
            { "@type": "Offer", price: 39.95, priceCurrency: "GBP", validFrom: "2026-09-05" },
          ],
        },
      }),
    );
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toBe("price_conflict");
    expect(d.message).toContain("33.95");
    expect(d.message).toContain("39.95");
  });

  it("marks a promotion when the shop publishes a was-price above the price", () => {
    const html = page({
      title: "Andre Clouet Silver Brut Nature Champagne",
      ld: offerLd(),
      extra:
        '<meta property="product:price:amount" content="35.00" />' +
        '<meta property="product:price:currency" content="GBP" />' +
        '<meta property="og:price:standard_amount" content="42.00" />',
    });
    const d = decide(html);
    expect(d.write).toBe(true);
    if (!d.write) return;
    expect(d.sighting.isPromotion).toBe(true);
    expect(d.sighting.priceBasis).toBe("retail shelf price (promotion)");
  });

  it("refuses a page with no machine-readable price at all", () => {
    const d = decide(page({ title: "A wine with no price" }));
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toBe("no_offer");
  });

  it("refuses when the page prints no bottle size", () => {
    const html =
      `<html><head><title>Andre Clouet Silver Brut Nature Champagne</title>` +
      `<meta property="og:title" content="Andre Clouet Silver Brut Nature Champagne">` +
      `<script type="application/ld+json">${JSON.stringify(offerLd())}</script>` +
      `</head><body><p>A champagne.</p></body></html>`;
    const d = decide(html);
    expect(d.write).toBe(false);
    if (d.write) return;
    expect(d.reason).toBe("no_bottle_volume");
  });
});

/**
 * The measurement. Every recorded merchant page, read by this module as the
 * shop it came from, with the verdict printed so the numbers in ADR 0117 can
 * be reproduced by running this one test.
 */
describe("the six recorded merchant pages", () => {
  const CASES: Array<{ fixture: string; shopKey: string; url: string }> = [
    {
      fixture: "bbr-cremant-de-limoux-2026-09-04.fixture.html",
      shopKey: "bbr-gb",
      url: "https://www.bbr.com/products-10008006303-berry-bros-and-rudd-cremant-de-limoux-by-antech-brut-languedoc",
    },
    {
      fixture: "bbr-dom-perignon-2026-09-04.fixture.html",
      shopKey: "bbr-gb",
      url: "https://www.bbr.com/products-20188000200-2018-champagne-dom-perignon-brut",
    },
    {
      fixture: "slurp-pellehaut-rose-2026-09-04.fixture.html",
      shopKey: "slurp-gb",
      url: "https://www.slurp.co.uk/products/2025-domaine-de-pellehaut-harmonie-de-gascogne-rose-10618604",
    },
    {
      fixture: "tanners-andre-clouet-2026-09-04.fixture.html",
      shopKey: "tanners-gb",
      url: "https://www.tanners-wines.co.uk/products/andre-clouet-silver-brut-nature-champagne-grand-cru-a-bouzy",
    },
    {
      fixture: "hedonism-ruinart-2026-09-04.fixture.html",
      shopKey: "hedonism-gb",
      url: "https://hedonism.co.uk/products/ruinart-blanc-de-blancs-nv",
    },
    {
      fixture: "winechateau-caymus-1l-2026-09-04.fixture.html",
      shopKey: "winechateau-us-nj",
      url: "https://www.winechateau.com/products/caymus-vineyards-cabernet-sauvignon-napa-valley-2023",
    },
  ];

  it("admits one and refuses five, each for a named and different reason", () => {
    const counts = emptyShopRefusalCounts();
    const lines: string[] = [];
    let admitted = 0;
    for (const c of CASES) {
      const html = read(c.fixture);
      const d = decideShopPosting({
        shop: SHOPS[c.shopKey],
        url: c.url,
        html,
        sizeEvidence: readPageSizeEvidence(html),
        fetchedAt: "2026-09-05T11:00:00.000Z",
      });
      if (d.write) {
        admitted += 1;
        lines.push(
          `${c.fixture.padEnd(46)} ADMITTED ${d.sighting.price} ${d.sighting.currency} ` +
            `${d.sighting.sizeValue}ml via ${d.offerSource}, issued ${d.sighting.issuedAt}`,
        );
      } else {
        counts[d.reason] += 1;
        lines.push(`${c.fixture.padEnd(46)} REFUSED  ${d.reason}`);
      }
    }
    // Printed so the ADR's table is reproducible from one command.
    // eslint-disable-next-line no-console
    console.log(`\n${lines.join("\n")}\n  admitted ${admitted}/${CASES.length}`);

    expect(admitted).toBe(1);
    expect(counts.no_issue_date).toBe(3);
    expect(counts.identity_conflict).toBe(1);
    expect(counts.currency_not_jurisdiction).toBe(1);
  });
});

describe("the arming allow-list", () => {
  it("is off when unset, and drops an unarmed shop with its reason", () => {
    expect(armedShopKeys(undefined).armed).toEqual([]);
    const got = armedShopKeys("tanners-gb, binnys-us-il, not-a-shop");
    expect(got.armed).toEqual(["tanners-gb"]);
    expect(got.unknown).toEqual(["not-a-shop"]);
    expect(got.refused.map((r) => r.key)).toEqual(["binnys-us-il"]);
    expect(got.refused[0].reason).toBe("fetch_refused");
  });
});
