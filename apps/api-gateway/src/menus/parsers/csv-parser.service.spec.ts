import { CsvParserService, HEADER_MAP, normalizeMenuHeader } from "./csv-parser.service";

/**
 * F-017 (sim ledger, menu import): a column headed `glass` was not read, so a
 * 133-line drinks file came in with no glass price on any line and 57 lines
 * with no price at all, and nothing said so. These pin the aliases and the
 * header spelling the importer now reads.
 */
describe("CsvParserService — the columns a menu file is read by", () => {
  const parser = new CsvParserService();

  it("reads a column headed `glass` as the glass price", () => {
    const [line] = parser.parse("name,glass,bottle\nEfes Pilsen,6,\n");
    expect(line).toMatchObject({ name: "Efes Pilsen", by_glass_price: 6 });
    expect(line.bottle_price).toBeUndefined();
  });

  it("reads `pour` and `by the glass` as the glass price", () => {
    expect(parser.parse("name,pour\nNegroni,14\n")[0].by_glass_price).toBe(14);
    expect(parser.parse("name,By The Glass\nRioja,11\n")[0].by_glass_price).toBe(11);
  });

  it("reads a header whatever its case, spacing, hyphens or leading byte-order mark", () => {
    const [line] = parser.parse("﻿Name,Glass-Price,BOTTLE PRICE\nMerlot,12,48\n");
    expect(line).toMatchObject({ name: "Merlot", by_glass_price: 12, bottle_price: 48 });
  });

  it("does not guess which serve a bare `price` column is", () => {
    const [line] = parser.parse("name,price\nAyran,4\n");
    expect(line.name).toBe("Ayran");
    expect(line.by_glass_price).toBeUndefined();
    expect(line.bottle_price).toBeUndefined();
    expect(HEADER_MAP.price).toBeUndefined();
  });

  it("every alias is already in the spelling a header is read through", () => {
    for (const key of Object.keys(HEADER_MAP)) {
      expect(normalizeMenuHeader(key)).toBe(key);
    }
  });
});
