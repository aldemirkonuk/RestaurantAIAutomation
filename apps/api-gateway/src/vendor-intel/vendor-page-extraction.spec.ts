import {
  htmlToText,
  isPathAllowed,
  normalizeExtraction,
  parseVintage,
  parseVolumeMl,
  validateItem,
} from "./vendor-page-extraction";

/**
 * A generic LLM extractor will be wrong regularly — that is the accepted cost
 * of covering every vendor on day one instead of none. What makes it usable is
 * that its wrongness is bounded and visible: implausible rows are rejected
 * with reasons, partial rows carry reduced confidence, and a page that mostly
 * fails announces itself instead of quietly contributing three prices from a
 * hundred-wine list.
 *
 * So these tests are about the boundary, not the happy path.
 */

const NOW = new Date("2026-08-05T12:00:00Z");

describe("parseVintage", () => {
  it("accepts a real year", () => {
    expect(parseVintage(2019, NOW).vintage).toBe(2019);
  });

  it("allows next year, for wines released on futures", () => {
    expect(parseVintage(2027, NOW).vintage).toBe(2027);
  });

  it("rejects a volume mistaken for a vintage", () => {
    // 750 appears on every wine page; a model reporting it as the vintage is
    // the single most likely field confusion.
    const r = parseVintage(750, NOW);
    expect(r.vintage).toBeNull();
    expect(r.warning).toMatch(/outside 1800/);
  });

  it("rejects a far-future year", () => {
    expect(parseVintage(2099, NOW).vintage).toBeNull();
  });

  it("treats absent as absent, not as an error", () => {
    expect(parseVintage(undefined, NOW)).toEqual({
      vintage: null,
      warning: null,
    });
  });
});

describe("parseVolumeMl", () => {
  it("accepts standard formats silently", () => {
    expect(parseVolumeMl(750)).toEqual({ volumeMl: 750, warning: null });
    expect(parseVolumeMl(1500).volumeMl).toBe(1500);
  });

  it("keeps an unusual format but flags it", () => {
    // Dropping it would make a 640ml bottle rank as if it were 750ml.
    const r = parseVolumeMl(640);
    expect(r.volumeMl).toBe(640);
    expect(r.warning).toMatch(/not a standard format/i);
  });

  it("rejects an impossible volume", () => {
    expect(parseVolumeMl(999_999).volumeMl).toBeNull();
    expect(parseVolumeMl(-750).volumeMl).toBeNull();
  });
});

describe("validateItem", () => {
  const base = { name: "Barolo Riserva", price: 45, confidence: 0.9 };

  it("accepts a well-formed row at high confidence", () => {
    const { item } = validateItem(
      { ...base, producer: "Giacomo Conterno", vintage: 2018, volumeMl: 750 },
      NOW,
    );
    expect(item).not.toBeNull();
    expect(item!.parseConfidence).toBeGreaterThan(0.8);
    expect(item!.warnings).toHaveLength(0);
  });

  it("rejects a row with no name", () => {
    const { item, reason } = validateItem({ price: 45 }, NOW);
    expect(item).toBeNull();
    expect(reason).toMatch(/no product name/i);
  });

  it("rejects a row with no usable price", () => {
    const { item, reason } = validateItem({ name: "Barolo" }, NOW);
    expect(item).toBeNull();
    expect(reason).toMatch(/no usable price/i);
  });

  it("parses a currency-formatted price string without losing the decimal", () => {
    const { item } = validateItem({ ...base, price: "$1,234.56" }, NOW);
    expect(item!.price).toBeCloseTo(1234.56, 2);
  });

  it("judges plausibility per unit, so a real case price survives", () => {
    // $2,400 for 12 bottles is $200/bottle — ordinary. Checking the listed
    // price instead would reject it.
    const { item } = validateItem({ ...base, price: 2400, packSize: 12 }, NOW);
    expect(item).not.toBeNull();
    expect(item!.packSize).toBe(12);
  });

  it("rejects a per-unit price that can only be a parse error", () => {
    const { item, reason } = validateItem({ ...base, price: 5_000_000 }, NOW);
    expect(item).toBeNull();
    expect(reason).toMatch(/outside the plausible band/i);
  });

  it("lowers confidence when producer and vintage are missing", () => {
    const full = validateItem(
      { ...base, producer: "Conterno", vintage: 2018, volumeMl: 750 },
      NOW,
    ).item!;
    const sparse = validateItem({ ...base, volumeMl: 750 }, NOW).item!;
    expect(sparse.parseConfidence).toBeLessThan(full.parseConfidence);
  });

  it("does not invent a vintage it could not read", () => {
    const { item } = validateItem({ ...base, vintage: "N/A" }, NOW);
    expect(item!.vintage).toBeNull();
  });

  it("falls back to a single unit when pack size is nonsense", () => {
    const { item } = validateItem({ ...base, packSize: 2.5 }, NOW);
    expect(item!.packSize).toBe(1);
    expect(item!.warnings.join(" ")).toMatch(/assumed single unit/i);
  });

  it("defaults currency to USD and normalises case", () => {
    expect(validateItem({ ...base, currency: "eur" }, NOW).item!.currency).toBe(
      "EUR",
    );
    expect(validateItem(base, NOW).item!.currency).toBe("USD");
  });
});

describe("normalizeExtraction", () => {
  it("reads a bare array", () => {
    const r = normalizeExtraction(
      JSON.stringify([{ name: "Chablis", price: 32, confidence: 0.9 }]),
      NOW,
    );
    expect(r.items).toHaveLength(1);
  });

  it("reads a wrapped array under any of the usual keys", () => {
    for (const key of ["items", "wines", "products", "results"]) {
      const r = normalizeExtraction(
        JSON.stringify({ [key]: [{ name: "Chablis", price: 32 }] }),
        NOW,
      );
      expect(r.items).toHaveLength(1);
    }
  });

  it("survives markdown fencing", () => {
    const r = normalizeExtraction(
      '```json\n[{"name":"Chablis","price":32}]\n```',
      NOW,
    );
    expect(r.items).toHaveLength(1);
  });

  it("records no observations when the response is not JSON", () => {
    const r = normalizeExtraction(
      "I could not find any wines on this page.",
      NOW,
    );
    expect(r.items).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/not valid json/i);
  });

  it("announces a mostly-failing page instead of returning a small catalogue", () => {
    // The dangerous quiet failure: a parser regression yields two good rows
    // from a hundred-wine list and the vendor silently looks tiny.
    const rows = [
      { name: "Good One", price: 30 },
      ...Array.from({ length: 9 }, () => ({ name: "Broken" })),
    ];
    const r = normalizeExtraction(JSON.stringify(rows), NOW);
    expect(r.items).toHaveLength(1);
    expect(r.rejected).toHaveLength(9);
    expect(r.warnings.join(" ")).toMatch(/treat this page's parser as broken/i);
  });

  it("keeps a reason for every rejection", () => {
    const r = normalizeExtraction(
      JSON.stringify([{ name: "No Price" }, { price: 20 }]),
      NOW,
    );
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected.every((x) => x.reason.length > 0)).toBe(true);
  });
});

describe("htmlToText", () => {
  it("drops script and style content entirely", () => {
    // Inline analytics and JSON-LD carry numbers that read like prices; feeding
    // them to the model invites extraction of a tracking value.
    const html = `
      <html><head><style>.p{price:9999}</style>
      <script>var trackingPrice = 8888;</script></head>
      <body><h1>Our Wines</h1><p>Chablis 2020 — $32.00</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Chablis 2020");
    expect(text).not.toContain("8888");
    expect(text).not.toContain("9999");
  });

  it("decodes entities and preserves block boundaries", () => {
    const text = htmlToText("<p>Ch&acirc;teau</p><p>Margaux &amp; Co</p>");
    expect(text).toContain("Margaux & Co");
    expect(text.split("\n").length).toBeGreaterThan(1);
  });

  it("truncates very long documents", () => {
    const text = htmlToText("<p>" + "wine ".repeat(50_000) + "</p>", 1000);
    expect(text.length).toBeLessThanOrEqual(1000);
  });
});

describe("isPathAllowed", () => {
  it("allows everything when robots.txt has no groups", () => {
    expect(isPathAllowed("", "/wines")).toBe(true);
  });

  it("honours a wildcard disallow", () => {
    const robots = "User-agent: *\nDisallow: /private";
    expect(isPathAllowed(robots, "/private/list")).toBe(false);
    expect(isPathAllowed(robots, "/wines")).toBe(true);
  });

  it("lets a longer Allow override a broader Disallow", () => {
    const robots = "User-agent: *\nDisallow: /\nAllow: /catalog";
    expect(isPathAllowed(robots, "/catalog/wines")).toBe(true);
    expect(isPathAllowed(robots, "/admin")).toBe(false);
  });

  it("treats an empty Disallow as permission", () => {
    expect(isPathAllowed("User-agent: *\nDisallow:", "/anything")).toBe(true);
  });

  it("ignores rules aimed at a different agent", () => {
    const robots =
      "User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /tmp";
    expect(isPathAllowed(robots, "/wines")).toBe(true);
    expect(isPathAllowed(robots, "/tmp/x")).toBe(false);
  });

  it("ignores comments", () => {
    expect(
      isPathAllowed("# nothing here\nUser-agent: *\nDisallow: /x", "/y"),
    ).toBe(true);
  });
});
