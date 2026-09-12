import { readFileSync } from "fs";
import { join } from "path";

import { readBottleSize, readPageSizeEvidence } from "./bottle-size";
import { decideScrapeSighting } from "./vendor-site-sighting";

/**
 * Six real merchant pages, fetched on 2026-09-04 with robots.txt read first,
 * our own user-agent, and a 10-second floor per host. Each fixture is a
 * mechanically reduced copy — see `__fixtures__/PROVENANCE.md` for the rule,
 * the full-page byte counts and the sha256 of each original, so any of them
 * can be re-fetched and checked. Nothing in a fixture was hand-picked and no
 * number, unit, name or price was altered.
 *
 * These are the pages the register would actually have to read. They were not
 * chosen to be easy: two of them refuse a size read at HEAD's precedence and
 * one carries structured data about an entirely different product.
 */
const DIR = join(__dirname, "__fixtures__");

interface Case {
  file: string;
  vendor: string;
  /** The row we are pricing, as a page reader would name it. */
  productName: string;
  price: number | null;
  expect:
    | { read: true; ml: number; source: string; statementContains: string }
    | { read: false; reason: string };
}

const CASES: Case[] = [
  {
    file: "bbr-cremant-de-limoux-2026-09-04.fixture.html",
    vendor: "Berry Bros. & Rudd (GB)",
    productName:
      "Berry Bros. & Rudd Crémant de Limoux by Antech, Brut, Languedoc",
    price: 15.5,
    expect: {
      read: true,
      ml: 750,
      source: "structured_offer",
      statementContains: "75 cl",
    },
  },
  {
    file: "bbr-dom-perignon-2026-09-04.fixture.html",
    vendor: "Berry Bros. & Rudd (GB)",
    productName: "2018 Champagne Dom Pérignon, Brut",
    price: null,
    expect: { read: false, reason: "no_bottle_volume" },
  },
  {
    file: "slurp-pellehaut-rose-2026-09-04.fixture.html",
    vendor: "Slurp (GB, Shopify)",
    productName: "2025 Domaine de Pellehaut Harmonie de Gascogne Rose",
    price: 11.99,
    expect: {
      read: true,
      ml: 750,
      source: "variant_option",
      statementContains: "1x75cl",
    },
  },
  {
    file: "tanners-andre-clouet-2026-09-04.fixture.html",
    vendor: "Tanners (GB, Shopify)",
    productName:
      "André Clouet Silver, Brut Nature Champagne, Grand Cru à Bouzy",
    price: 35,
    expect: {
      read: true,
      ml: 750,
      source: "spec_field",
      statementContains: "Bottle size cl: 75",
    },
  },
  {
    file: "hedonism-ruinart-2026-09-04.fixture.html",
    vendor: "Hedonism (GB, Shopify)",
    productName: "Ruinart Blanc de Blancs",
    price: 97,
    expect: {
      read: true,
      ml: 750,
      source: "spec_field",
      statementContains: "75 cl",
    },
  },
  {
    file: "winechateau-caymus-1l-2026-09-04.fixture.html",
    vendor: "Wine Chateau (US, Shopify)",
    productName: "Caymus Napa Valley Cabernet Sauvignon (1 Liter Bottle) 2023",
    price: 84.99,
    expect: {
      read: true,
      ml: 1000,
      source: "variant_option",
      statementContains: "1L",
    },
  },
];

function read(c: Case) {
  const html = readFileSync(join(DIR, c.file), "utf-8");
  return readBottleSize(readPageSizeEvidence(html), {
    productName: c.productName,
    price: c.price,
  });
}

describe("the size read, against six real merchant pages", () => {
  for (const c of CASES) {
    it(`${c.vendor} — ${c.file}`, () => {
      const r = read(c);
      if (c.expect.read) {
        expect(r.read).toBe(true);
        if (!r.read) return;
        expect(r.ml).toBe(c.expect.ml);
        expect(r.source).toBe(c.expect.source);
        expect(r.statement).toContain(c.expect.statementContains);
        // Provenance is not optional: a reading always names where it looked.
        expect(r.locator.length).toBeGreaterThan(0);
      } else {
        expect(r.read).toBe(false);
        if (r.read) return;
        expect(r.reason).toBe(c.expect.reason);
      }
    });
  }

  it("refuses the page whose structured data describes another product", () => {
    // https://www.bbr.com/products-20188000200-2018-champagne-dom-perignon-brut
    // returned HTTP 200 on 2026-09-04 with og:title "2018 Champagne Dom
    // Pérignon, Brut" and exactly one JSON-LD block, describing Caol Ila
    // 25-Year-Old whisky at £225 with SKU 1000-01-00700-00-8086983. Trusting
    // structured data because it is structured would have filed a 700ml
    // whisky's size under a champagne.
    const r = read(CASES[1]);
    expect(r.read).toBe(false);
    if (r.read) return;
    expect(r.notes.join(" ")).toContain("Caol Ila");
    expect(r.notes.join(" ")).toContain("names another product");
  });

  it("does not read Tanners' neighbouring 70cl badge or its duty tables", () => {
    const r = read(CASES[3]);
    expect(r.read).toBe(true);
    if (!r.read) return;
    expect(r.candidates.every((x) => x.ml === 750)).toBe(true);
  });

  it("reads a bottle that is NOT 750ml, from the option the price belongs to", () => {
    // The whole point of refusing rather than defaulting: this one is a litre.
    const r = read(CASES[5]);
    expect(r.read).toBe(true);
    if (!r.read) return;
    expect(r.ml).toBe(1000);
    expect(r.locator).toContain('"Size"');
  });

  it("turns each reading into a sighting that carries where the unit came from", () => {
    const c = CASES[0];
    const r = read(c);
    expect(r.read).toBe(true);
    if (!r.read) return;
    const decided = decideScrapeSighting({
      restaurantId: "11111111-1111-1111-1111-111111111111",
      url: "https://www.bbr.com/products-10008006303-berry-bros-and-rudd-cremant-de-limoux-by-antech-brut-languedoc",
      providerId: null,
      vendorName: "Berry Bros. & Rudd",
      productName: c.productName,
      signatureHash: "sig",
      price: c.price,
      currency: "GBP",
      packSize: 1,
      unitVolumeMl: r.ml,
      volume: {
        source: r.source,
        statement: r.statement,
        locator: r.locator,
        candidates: r.candidates.map((x) => ({
          source: x.source,
          ml: x.ml,
          statement: x.statement,
          locator: x.locator,
        })),
        nonStandardFormat: r.nonStandardFormat,
        notes: r.notes,
      },
      pageStatedDate: null,
      fetchedAt: "2026-09-04T22:00:00.000Z",
      contentHash: "hash",
      httpStatus: 200,
      parseConfidence: 0.9,
    });
    expect(decided.write).toBe(true);
    if (!decided.write) return;
    expect(decided.row.unit_volume_ml).toBe(750);
    expect((decided.row.raw as any).volume).toEqual(
      expect.objectContaining({
        source: "structured_offer",
        statement: "75 cl",
      }),
    );
  });

  it("refuses a sighting on a conflict, and counts it as a conflict", () => {
    const decided = decideScrapeSighting({
      restaurantId: "11111111-1111-1111-1111-111111111111",
      url: "https://merchant.example/wine",
      providerId: null,
      vendorName: "Merchant",
      productName: "A wine",
      signatureHash: "sig",
      price: 20,
      currency: "GBP",
      packSize: 1,
      unitVolumeMl: 750,
      volumeConflict: {
        message: "the page states two different bottle sizes for it",
        candidates: [],
      },
      pageStatedDate: null,
      fetchedAt: "2026-09-04T22:00:00.000Z",
      contentHash: "hash",
      httpStatus: 200,
      parseConfidence: 0.9,
    });
    expect(decided.write).toBe(false);
    if (decided.write) return;
    // NOT `no_bottle_volume`: a contradiction is not an absence.
    expect(decided.reason).toBe("volume_conflict");
  });

  it("COVERAGE, after: the six fixtures, by outcome and by source", () => {
    const bySource: Record<string, number> = {};
    const byRefusal: Record<string, number> = {};
    const lines: string[] = [];
    for (const c of CASES) {
      const r = read(c);
      if (r.read) {
        bySource[r.source] = (bySource[r.source] ?? 0) + 1;
        lines.push(
          `  ${c.file.padEnd(46)} READ    ${String(r.ml).padStart(5)}ml  ${r.source.padEnd(17)} ${JSON.stringify(r.statement)} @ ${r.locator}`,
        );
      } else {
        byRefusal[r.reason] = (byRefusal[r.reason] ?? 0) + 1;
        lines.push(
          `  ${c.file.padEnd(46)} REFUSED        ${r.reason}`,
        );
      }
    }
    const admitted = Object.values(bySource).reduce((a, b) => a + b, 0);
    const refused = Object.values(byRefusal).reduce((a, b) => a + b, 0);
    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "AFTER — bottle-size.ts reading the markup:",
        ...lines,
        `  admitted ${admitted}/${CASES.length}   refused ${refused}/${CASES.length}`,
        `  by source:  ${JSON.stringify(bySource)}`,
        `  by refusal: ${JSON.stringify(byRefusal)}`,
      ].join("\n"),
    );
    expect(admitted).toBe(5);
    expect(refused).toBe(1);
    expect(byRefusal).toEqual({ no_bottle_volume: 1 });
  });
});
