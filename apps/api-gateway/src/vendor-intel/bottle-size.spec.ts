import {
  NOMINAL_VOLUMES_ML,
  deriveFromUnitPrice,
  parseVolume,
  parseVolumes,
  readBottleSize,
  readPageSizeEvidence,
  sameProduct,
  snapToNominal,
} from "./bottle-size";

const ITEM = { productName: "Chablis 1er Cru Montée de Tonnerre 2021" };

describe("parseVolume — the vocabulary a wine page actually uses", () => {
  it.each([
    ["750ml", 750],
    ["750 ml", 750],
    ["75cl", 750],
    ["75 cl", 750],
    ["0.75 l", 750],
    ["0,75 L", 750],
    ["1.5L", 1500],
    ["1L", 1000],
    ["1 Liter", 1000],
    ["1 litre", 1000],
    ["187ml", 187],
    ["620 ml", 620],
    ["3 litres", 3000],
    ["25.4 fl oz", 751],
  ])("reads %s as %ims", (text, ml) => {
    expect(parseVolume(text)?.ml).toBe(ml);
  });

  it("reads a pack and a volume out of one statement", () => {
    expect(parseVolume("6 x 75cl")).toEqual({
      ml: 750,
      statement: "6 x 75cl",
      pack: 6,
    });
    expect(parseVolume("1x75cl")?.pack).toBe(1);
    expect(parseVolume("12 × 75 cl")?.pack).toBe(12);
  });

  it("refuses a bare number, and refuses bare ounces", () => {
    // 750 with no unit is the single most common way to be wrong here.
    expect(parseVolume("750")).toBeNull();
    expect(parseVolume("Bottle 750")).toBeNull();
    // "oz" is also how weight is written. `fl oz` is not ambiguous; `oz` is.
    expect(parseVolume("25.4 oz")).toBeNull();
    expect(parseVolume("25.4 fl oz")?.ml).toBe(751);
  });

  it("reads a comma as thousands only when three digits follow it", () => {
    expect(parseVolume("1,500 ml")?.ml).toBe(1500);
    expect(parseVolume("1,5 l")?.ml).toBe(1500);
    expect(parseVolume("0,375 l")?.ml).toBe(375);
  });

  it("returns nothing when one statement names two different sizes", () => {
    // A size picker rendered into one string is not a size.
    expect(parseVolume("Available in 375ml and 750ml")).toBeNull();
    expect(parseVolumes("Available in 375ml and 750ml")).toHaveLength(2);
  });

  it("refuses volumes outside the band a bottle can be", () => {
    expect(parseVolume("5 ml")).toBeNull();
    expect(parseVolume("40 l")).toBeNull();
  });
});

describe("the nominal-quantity list", () => {
  it("holds every quantity Directive 2007/45/EC prescribes for wine", () => {
    for (const ml of [100, 187, 250, 375, 500, 750, 1000, 1500])
      expect(NOMINAL_VOLUMES_ML).toContain(ml);
    // Yellow wine (the Jura clavelin) and sparkling's own two sizes.
    expect(NOMINAL_VOLUMES_ML).toContain(620);
    expect(NOMINAL_VOLUMES_ML).toContain(125);
    // Spirits.
    for (const ml of [350, 700, 1750, 2000]) expect(NOMINAL_VOLUMES_ML).toContain(ml);
  });

  it("snaps a near miss and refuses a far one", () => {
    expect(snapToNominal(749.6)).toBe(750);
    expect(snapToNominal(187.08)).toBe(187);
    // The closest pair on the list is 700 and 720, 2.86% apart. 730 belongs to
    // neither, and a 1% window cannot reach either of them.
    expect(snapToNominal(730)).toBeNull();
    expect(snapToNominal(25_348)).toBeNull();
  });
});

describe("deriveFromUnitPrice — the legally required per-litre figure", () => {
  it("recovers a half-bottle from a per-75cl label", () => {
    // Price Marking Order 2004 sch. 1: wine's unit quantity in the UK is 75cl.
    // A 375ml bottle at £9.00 is labelled £18.00 per 75cl.
    const got = deriveFromUnitPrice(
      { amount: 18, referenceMl: 750, statement: "£18.00 per 75cl", offset: 0 },
      9,
    );
    expect(got?.ml).toBe(375);
  });

  it("recovers a magnum from a per-litre label, rounding and all", () => {
    // 1.5L at £45.00 → £30.00 per litre. 1000 × 45/30 = 1500.
    expect(
      deriveFromUnitPrice(
        { amount: 30, referenceMl: 1000, statement: "£30.00 / litre", offset: 0 },
        45,
      )?.ml,
    ).toBe(1500);
  });

  it("refuses a derivation that lands on no permitted quantity", () => {
    // Hedonism's duty table: "£2.87 per 75cl bottle" against a £97 champagne
    // derives a 25-litre bottle. The snap refuses it even if proximity did not.
    expect(
      deriveFromUnitPrice(
        { amount: 2.87, referenceMl: 750, statement: "£2.87 per 75cl bottle", offset: 0 },
        97,
      ),
    ).toBeNull();
  });
});

describe("sameProduct — the identity gate on structured data", () => {
  it("matches on an equal SKU even when the names differ", () => {
    expect(
      sameProduct(
        { name: "Ch. Something", sku: "ABC-1", mpn: null },
        { productName: "Château Something 2019", sku: "abc-1" },
      ),
    ).toBe(true);
  });

  it("refuses a node that names a different wine", () => {
    expect(
      sameProduct(
        { name: "Caol Ila, 25-Year-Old, Islay, Single Malt Scotch Whisky (43%)", sku: null, mpn: null },
        { productName: "2018 Champagne Dom Pérignon, Brut" },
      ),
    ).toBe(false);
  });

  it("matches through accents and punctuation", () => {
    expect(
      sameProduct(
        { name: "Crémant de Limoux, Brut", sku: null, mpn: null },
        { productName: "Cremant de Limoux Brut" },
      ),
    ).toBe(true);
  });
});

describe("readBottleSize — precedence, refusal and provenance", () => {
  const page = (body: string) => readPageSizeEvidence(body);

  it("takes the volume from the same schema.org node as the price", () => {
    const html = `<html><body>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Chablis 1er Cru Montée de Tonnerre 2021",
        additionalProperty: [{ "@type": "PropertyValue", name: "Bottle Volume", value: "75 cl" }],
        offers: { "@type": "Offer", price: 42, priceCurrency: "GBP" },
      })}</script>
      <span title="Bottle size cl: 75">75cl</span>
    </body></html>`;
    const r = readBottleSize(page(html), ITEM);
    expect(r.read).toBe(true);
    if (!r.read) return;
    expect(r.ml).toBe(750);
    expect(r.source).toBe("structured_offer");
    expect(r.statement).toBe("75 cl");
    expect(r.locator).toContain("additionalProperty[Bottle Volume]");
  });

  it("never reads `weight`, whatever it says", () => {
    // Measured 2026-09-04: Tanners publishes weight 75000 on a 75cl champagne,
    // Slurp 2000 on a 75cl rosé, Wine Chateau 2722 on a 1L cabernet.
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Chablis 1er Cru Montée de Tonnerre 2021",
      weight: { "@type": "QuantitativeValue", value: 2000, unitCode: "GRM" },
    })}</script>`;
    expect(readBottleSize(page(html), ITEM).read).toBe(false);
  });

  it("refuses structured data that names another product, and says so", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Caol Ila, 25-Year-Old, Islay, Single Malt Scotch Whisky (43%)",
      additionalProperty: [{ name: "Bottle Volume", value: "70 cl" }],
    })}</script>`;
    const r = readBottleSize(page(html), { productName: "2018 Champagne Dom Pérignon, Brut" });
    expect(r.read).toBe(false);
    if (r.read) return;
    expect(r.reason).toBe("no_bottle_volume");
    expect(r.notes.join(" ")).toContain("names another product");
  });

  it("falls to the variant option, and reads the pack out of the same words", () => {
    const html = `<script type="application/json">${JSON.stringify({
      title: "Chablis 1er Cru Montée de Tonnerre 2021",
      options: ["Format"],
      variants: [{ id: 1, title: "6 x 75cl", options: ["6 x 75cl"], price: 24000 }],
    })}</script>`;
    const r = readBottleSize(page(html), ITEM);
    expect(r.read).toBe(true);
    if (!r.read) return;
    expect(r.source).toBe("variant_option");
    expect(r.ml).toBe(750);
    expect(r.packFromStatement).toBe(6);
  });

  it("reads Shopify's own declared unit-price measurement as structured data", () => {
    const html = `<script type="application/json">${JSON.stringify({
      title: "Chablis 1er Cru Montée de Tonnerre 2021",
      variants: [
        {
          id: 1,
          title: "Default Title",
          price: 4200,
          unit_price_measurement: {
            measured_type: "volume",
            quantity_value: 750,
            quantity_unit: "ml",
            reference_value: 1,
            reference_unit: "l",
          },
        },
      ],
    })}</script>`;
    const r = readBottleSize(page(html), ITEM);
    expect(r.read).toBe(true);
    if (!r.read) return;
    expect(r.source).toBe("structured_offer");
    expect(r.locator).toBe("variants[].unit_price_measurement");
  });

  it("reads a unit-price label only when it stands beside this row's price", () => {
    const beside = `<p>Chablis 1er Cru Montée de Tonnerre 2021 &mdash; £9.00 (£18.00 per 75cl)</p>`;
    const r1 = readBottleSize(page(beside), { ...ITEM, price: 9 });
    expect(r1.read).toBe(true);
    if (r1.read) {
      expect(r1.source).toBe("unit_price_label");
      expect(r1.ml).toBe(375);
    }

    const faraway = `<p>£9.00</p>${"<p>filler</p>".repeat(200)}<p>Duty: £18.00 per 75cl bottle</p>`;
    expect(readBottleSize(page(faraway), { ...ITEM, price: 9 }).read).toBe(false);
  });

  it("takes the product's own name last, and only its own", () => {
    const html = `<p>nothing here</p>`;
    const r = readBottleSize(page(html), {
      productName: "Chablis 1er Cru Montée de Tonnerre 2021, 375ml",
    });
    expect(r.read).toBe(true);
    if (!r.read) return;
    expect(r.source).toBe("title");
    expect(r.ml).toBe(375);
  });

  it("refuses `volume_conflict` when two places disagree, naming both", () => {
    const html = `
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        name: "Chablis 1er Cru Montée de Tonnerre 2021",
        additionalProperty: [{ name: "Bottle Volume", value: "75 cl" }],
      })}</script>
      <span title="Bottle size cl: 150">1.5L</span>`;
    const r = readBottleSize(page(html), ITEM);
    expect(r.read).toBe(false);
    if (r.read) return;
    expect(r.reason).toBe("volume_conflict");
    expect(r.message).toContain("750ml");
    expect(r.message).toContain("1500ml");
    expect(r.message).toContain("structured_offer");
    expect(r.message).toContain("spec_field");
  });

  it("refuses `no_bottle_volume` and lists what it looked at", () => {
    const r = readBottleSize(page("<p>A lovely wine.</p>"), ITEM);
    expect(r.read).toBe(false);
    if (r.read) return;
    expect(r.reason).toBe("no_bottle_volume");
    expect(r.message).toContain("structured_offer → variant_option");
  });

  it("does not read a size out of a neighbouring product's badge", () => {
    // Tanners' real markup: a 70cl badge on an adjacent product card whose
    // class contains the substring "size".
    const html = `<span class="badge badge--0 non-standard-size top left">70cl</span>
      <div class="product__unit-size"><p>75 cl</p></div>`;
    const r = readBottleSize(page(html), ITEM);
    expect(r.read).toBe(true);
    if (!r.read) return;
    expect(r.ml).toBe(750);
  });

  it("keeps every candidate on the reading, agreeing or not", () => {
    const html = `<div class="product__unit-size"><p>75 cl</p></div>`;
    const r = readBottleSize(page(html), {
      productName: "Chablis 1er Cru Montée de Tonnerre 2021 75cl",
    });
    expect(r.read).toBe(true);
    if (!r.read) return;
    expect(r.candidates.map((c) => c.source)).toEqual(["spec_field", "title"]);
  });

  it("flags a format no list knows, and still reads it", () => {
    const r = readBottleSize(page("<p>x</p>"), {
      productName: "Odd Bottling 800ml",
    });
    expect(r.read).toBe(true);
    if (!r.read) return;
    expect(r.ml).toBe(800);
    expect(r.nonStandardFormat).toBe(true);
  });
});
