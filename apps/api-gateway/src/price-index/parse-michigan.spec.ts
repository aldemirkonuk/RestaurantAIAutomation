/**
 * The Michigan parser, against REAL rows of the MLCC spirits price book.
 *
 * The fixture is 24 rows lifted verbatim from the 2025-08-03 edition — values
 * untouched, provenance and sha256 in `__fixtures__/MICHIGAN-PROVENANCE.md`.
 *
 * A note on the refusal tests below. The real book measured **zero** defects
 * across all 12,530 of its product rows: no missing size, no missing pack, no
 * missing licensee price, no licensee above base, no shelf below licensee, no
 * duplicate liquor code. So there is no honest fixture row to prove a refusal
 * with, and the refusal cases here are **constructed** — labelled as such —
 * rather than dressed up as findings in the issuer's file.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  LICENSEE_RATIO_MIN,
  MICHIGAN_ISSUER,
  MICHIGAN_PRICE_BASIS,
  MICHIGAN_SOURCE_KEY,
  MichiganShapeError,
  parseMichigan,
  readEditionDate,
} from "./parse-michigan";

const FIXTURE = join(
  __dirname,
  "__fixtures__",
  "michigan-lcc-price-book-2025-08-03.sample.json",
);

interface Fixture {
  fileName: string;
  sheetName: string;
  rows: Array<Array<string | number | null>>;
  sourceRowNumbers: number[];
}

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
const EDITION = "2025-08-03";
/** A day inside the book's 105-day bound, so staleness never masks a case. */
const FRESH_DAY = new Date("2025-09-01T00:00:00Z");

describe("readEditionDate — the issuer's date lives in the file name", () => {
  it("reads the published name", () => {
    expect(readEditionDate("8-3-25-PRICE-BOOK-EXCEL.xlsx", FRESH_DAY)).toBe(
      "2025-08-03",
    );
  });

  it("reads both the one- and two-digit forms the MLCC actually publishes", () => {
    // Both occur in the real series: 12-03-23-… and 1-4-26-…
    expect(readEditionDate("12-03-23-NEW-ITEM-PRICE-LIST-PDF.pdf", FRESH_DAY)).toBe(
      "2023-12-03",
    );
    expect(
      readEditionDate("1-4-26-NEW-ITEM-PRICE-LIST-EXCEL.xlsx", new Date("2026-09-05T00:00:00Z")),
    ).toBe("2026-01-04");
  });

  it("ignores a directory prefix", () => {
    expect(
      readEditionDate("/Users/someone/Downloads/8-3-25-PRICE-BOOK-EXCEL.xlsx", FRESH_DAY),
    ).toBe("2025-08-03");
  });

  it("refuses a name with no date rather than dating it from the clock", () => {
    expect(readEditionDate("price book.xlsx", FRESH_DAY)).toBeNull();
    expect(readEditionDate("PRICE-BOOK-EXCEL.xlsx", FRESH_DAY)).toBeNull();
    expect(readEditionDate("", FRESH_DAY)).toBeNull();
    expect(readEditionDate(null, FRESH_DAY)).toBeNull();
  });

  it("refuses a day the calendar does not have", () => {
    expect(readEditionDate("2-31-25-PRICE-BOOK-EXCEL.xlsx", FRESH_DAY)).toBeNull();
    expect(readEditionDate("13-1-25-PRICE-BOOK-EXCEL.xlsx", FRESH_DAY)).toBeNull();
  });

  it("refuses a future edition — a renamed file must not date the register", () => {
    expect(readEditionDate("8-3-27-PRICE-BOOK-EXCEL.xlsx", FRESH_DAY)).toBeNull();
  });
});

describe("parseMichigan — the real book", () => {
  const run = parseMichigan(fixture.rows, EDITION);

  it("reads every fixture row and accounts for all 24", () => {
    expect(run.rowsRead).toBe(24);
    expect(run.sightings.length + run.refusals.length).toBe(24);
  });

  it("admits the 18 product rows and refuses the 6 structural ones by name", () => {
    expect(run.sightings).toHaveLength(18);
    expect(run.refusals).toHaveLength(6);
    // 3 header lines, 1 blank spacer, 2 category headings — counted, not
    // silently dropped.
    const byReason = run.refusals.reduce<Record<string, number>>((acc, r) => {
      acc[r.reason] = (acc[r.reason] ?? 0) + 1;
      return acc;
    }, {});
    expect(byReason).toEqual({ not_a_product_row: 6 });
  });

  it("takes the LICENSEE price, not the base price and not the shelf price", () => {
    const row = run.sightings.find(
      (s) => s.productName === "AMERICAN BULL & BEAR TN WHISKY" && s.sizeValue === 750,
    );
    // The fixture row is [141, 35388, 'AMERICAN BULL & BEAR TN WHISKY', 80,
    // 750, 12, base 15.16, licensee 14.41, shelf 16.99, 'NEW'].
    expect(row?.price).toBe(14.41);
    expect(row?.raw.basePrice).toBe(15.16);
    expect(row?.raw.minimumShelfPrice).toBe(16.99);
    expect(row?.priceBasis).toBe(MICHIGAN_PRICE_BASIS);
  });

  it("states the unit and the pack from the issuer's own columns", () => {
    const row = run.sightings.find((s) => s.externalIds.liquor_code === "35389");
    expect(row?.sizeValue).toBe(1750);
    expect(row?.sizeUnit).toBe("ml");
    expect(row?.pack).toBe(6);
    expect(row?.priceUnit).toBe("per bottle");
  });

  it("stamps every row with the issuer, the state and the edition date", () => {
    for (const s of run.sightings) {
      expect(s.issuer).toBe(MICHIGAN_ISSUER);
      expect(s.state).toBe("US-MI");
      expect(s.issuedAt).toBe(EDITION);
      expect(s.sourceKey).toBe(MICHIGAN_SOURCE_KEY);
      expect(s.sourceClass).toBe("posted_wholesale_list");
      expect(s.currency).toBe("USD");
    }
  });

  it("records no attribution, because Michigan declares no licence", () => {
    expect(run.sightings.every((s) => s.attribution === null)).toBe(true);
  });

  it("carries the category heading down onto the rows beneath it", () => {
    expect(run.sightings[0].raw.category).toBe("AMERICAN BLEND");
    const continued = run.sightings.find(
      (s) => s.externalIds.liquor_code === "30993",
    );
    expect(continued?.raw.category).toBe("AMERICAN BLEND (CONTINUED)");
  });

  it("flags a licensed Michigan distiller without treating it as a price fact", () => {
    const mi = run.sightings.filter((s) => s.raw.michiganDistiller === true);
    expect(mi.map((s) => s.externalIds.liquor_code).sort()).toEqual([
      "30993",
      "31880",
    ]);
  });

  it("keeps NEW/CHNG raw and never infers a number from it", () => {
    const byCode = new Map(run.sightings.map((s) => [s.externalIds.liquor_code, s]));
    // The three notations the real book actually uses.
    expect(byCode.get("35388")?.raw.newOrChangeRaw).toBe("NEW");
    expect(byCode.get("29246")?.raw.newOrChangeRaw).toBe("-10");
    expect(byCode.get("34907")?.raw.newOrChangeRaw).toBe("(6.00)   NEW");
    // `NEW` anywhere in the cell is the only thing read out of it.
    expect(byCode.get("34907")?.sourceStatus).toBe("NEW");
    expect(byCode.get("29246")?.sourceStatus).toBeNull();
  });

  it("gives each row a source_ref that is stable per edition and item", () => {
    const refs = run.sightings.map((s) => s.sourceRef);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs[0]).toBe("mlcc:price-book:2025-08-03#liquor_code=35388");
  });

  it("admits the two rows at the extremes of the measured licensee/base band", () => {
    // 0.9194 and 0.9773 across all 12,530 rows of the real book. If the band
    // were tightened to the stated x0.95 these would be refused, and they are
    // genuine published rows.
    const codes = run.sightings.map((s) => s.externalIds.liquor_code);
    expect(codes).toContain("29428");
    expect(codes).toContain("32151");
  });
});

describe("parseMichigan — refusals (rows CONSTRUCTED for the test)", () => {
  const header = fixture.rows[0];
  const good = fixture.rows.find(
    (r) => r[2] === 35388,
  ) as Array<string | number | null>;
  const mutate = (
    changes: Record<number, string | number | null>,
  ): Array<string | number | null> => {
    const copy = [...good];
    for (const [i, v] of Object.entries(changes)) copy[Number(i)] = v;
    return copy;
  };
  const reasons = (rows: Array<Array<string | number | null>>) =>
    parseMichigan([header, ...rows], EDITION).refusals.map((r) => r.reason);

  it("refuses a row with no size rather than assuming 750 ml", () => {
    expect(reasons([mutate({ 6: null })])).toContain("no_size");
    expect(reasons([mutate({ 6: 0 })])).toContain("no_size");
  });

  it("refuses a row with no usable pack", () => {
    expect(reasons([mutate({ 7: 0 })])).toContain("bad_pack");
    expect(reasons([mutate({ 7: null })])).toContain("bad_pack");
  });

  it("refuses a row with no licensee price", () => {
    expect(reasons([mutate({ 9: null })])).toContain("no_licensee_price");
  });

  it("refuses a licensee price outside the measured band — a shifted column", () => {
    // base 15.16, licensee 15.16 would be a ratio of 1.0 exactly at the bound;
    // 8.00 (0.53) is far outside and is what a mis-read column looks like.
    expect(reasons([mutate({ 9: 8.0 })])).toContain("licensee_price_out_of_band");
    expect(LICENSEE_RATIO_MIN).toBeLessThan(0.9194);
  });

  it("refuses a shelf price below the licensee price", () => {
    expect(reasons([mutate({ 10: 1.0 })])).toContain("shelf_below_licensee");
  });

  it("refuses a second row carrying a liquor code already seen", () => {
    expect(reasons([good, good])).toContain("duplicate_liquor_code");
  });

  it("refuses a row with no brand name and one with no liquor code", () => {
    expect(reasons([mutate({ 4: null })])).toContain("no_brand");
    expect(reasons([mutate({ 2: null })])).toContain("no_liquor_code");
  });
});

describe("parseMichigan — shape errors", () => {
  it("refuses an undated run rather than inventing a date", () => {
    expect(() => parseMichigan(fixture.rows, "")).toThrow(MichiganShapeError);
    expect(() => parseMichigan(fixture.rows, "August 2025")).toThrow(
      /file name/,
    );
  });

  it("refuses a workbook that is not the price book", () => {
    expect(() =>
      parseMichigan([["a", "b", "c"], [1, 2, 3]], EDITION),
    ).toThrow(/not the MLCC price book/);
  });

  it("refuses an empty workbook", () => {
    expect(() => parseMichigan([], EDITION)).toThrow(MichiganShapeError);
  });
});
