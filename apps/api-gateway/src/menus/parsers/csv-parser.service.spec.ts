import { BadRequestException } from "@nestjs/common";
import {
  CsvParserService,
  HEADER_MAP,
  normalizeMenuHeader,
  readPriceCell,
} from "./csv-parser.service";

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

/**
 * F-471: the old reader kept only digits and points, so a decimal-comma price
 * came out a thousand times off with no warning ("12,50" -> 1250,
 * "1.250,00 TL" -> 1.25, "45-60" -> 4560). A price is now read in either
 * locale when it has one meaning, and refused by name when it has two.
 */
describe("readPriceCell", () => {
  it.each([
    ["12,50", 12.5],
    ["12.50", 12.5],
    ["12,5", 12.5],
    ["1.250,00 TL", 1250],
    ["1,250.00", 1250],
    ["₺1.250,00", 1250],
    ["1 250,00 €", 1250],
    ["1.250.000", 1250000],
    ["$45", 45],
    ["1250", 1250],
  ])("reads %s as %s", (raw, value) => {
    expect(readPriceCell(raw)).toEqual({ kind: "price", value });
  });

  it.each(["1.250", "₺1.250", "1,250", "45-60", "12.505", "1.25,00", "-5"])(
    "refuses %s rather than guess",
    (raw) => {
      expect(readPriceCell(raw)).toEqual({ kind: "unclear" });
    },
  );

  it("treats a cell with no digits as no price, as before", () => {
    expect(readPriceCell("MP")).toEqual({ kind: "none" });
  });
});

describe("CsvParserService.parse", () => {
  const parser = new CsvParserService();

  it("reads decimal-comma prices at their real size", () => {
    const items = parser.parse(
      'name,glass_price,bottle_price\nKalecik Karası,"12,50","1.250,00 TL"\n',
    );
    expect(items[0]).toMatchObject({ by_glass_price: 12.5, bottle_price: 1250 });
  });

  it("refuses the whole file, naming the row, when a price could be read two ways", () => {
    const run = () =>
      parser.parse("name,bottle_price\nMalbec,₺1.250\nSyrah,900\n");
    expect(run).toThrow(BadRequestException);
    expect(run).toThrow(/nothing was imported/);
    expect(run).toThrow(/row 2 \(Malbec\): “₺1.250”/);
  });
});
