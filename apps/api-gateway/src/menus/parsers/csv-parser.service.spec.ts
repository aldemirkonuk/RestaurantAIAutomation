import { BadRequestException } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import {
  CsvParserService,
  fileGroupMark,
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
    expect(
      parser.parse("name,By The Glass\nRioja,11\n")[0].by_glass_price,
    ).toBe(11);
  });

  it("reads a header whatever its case, spacing, hyphens or leading byte-order mark", () => {
    const [line] = parser.parse(
      "﻿Name,Glass-Price,BOTTLE PRICE\nMerlot,12,48\n",
    );
    expect(line).toMatchObject({
      name: "Merlot",
      by_glass_price: 12,
      bottle_price: 48,
    });
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

  it.each(["1.250", "₺1.250", "1,250", "45-60", "12.505", "1.25,00"])(
    "refuses %s rather than guess",
    (raw) => {
      expect(readPriceCell(raw)).toEqual({ kind: "unclear" });
    },
  );

  it.each(["-5", "-45", "₺-1.250,00"])(
    "reads %s as below zero, not as a price (F-684)",
    (raw) => {
      expect(readPriceCell(raw)).toEqual({ kind: "negative" });
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
    expect(items[0]).toMatchObject({
      by_glass_price: 12.5,
      bottle_price: 1250,
    });
  });

  it("refuses the whole file, naming the row, when a price could be read two ways", () => {
    const run = () =>
      parser.parse("name,bottle_price\nMalbec,₺1.250\nSyrah,900\n");
    expect(run).toThrow(BadRequestException);
    expect(run).toThrow(/nothing was imported/);
    expect(run).toThrow(/row 2 \(Malbec\): “₺1.250”/);
  });
});

/**
 * F-947: a Turkish Excel export prices "1.250" (#.##0). Refusing the whole file
 * when the house's mark, or the file's own other prices, settle the reading
 * made the owner retype every price.
 */
describe("CsvParserService.read — a price like 1.250 is read by the file's marks (F-947)", () => {
  const parser = new CsvParserService();

  it("reads 1.250 as 1250 in a house that groups by a point", () => {
    const r = parser.read("name,bottle_price\nMalbec,₺1.250\nSyrah,900\n", ".");
    expect(r.items.map((i) => i.bottle_price)).toEqual([1250, 900]);
  });

  it("reads 1.250 as 1250 when the file's own prices say it groups by a point", () => {
    const r = parser.read(
      'name,glass_price,bottle_price\nMalbec,"85,50",1.250\nSyrah,"60,00","1.250,00"\n',
    );
    expect(r.items.map((i) => i.bottle_price)).toEqual([1250, 1250]);
  });

  it("the file's own prices outrank the house's mark", () => {
    const run = () =>
      parser.read("name,glass_price,bottle_price\nMalbec,12.50,1.250\n", ".");
    expect(run).toThrow(/row 2 \(Malbec\): “1.250”/);
  });

  it("still refuses when the file's prices disagree with each other", () => {
    const run = () =>
      parser.read(
        'name,glass_price,bottle_price\nMalbec,"12,50",1.250\nSyrah,12.50,900\n',
        ".",
      );
    expect(run).toThrow(/nothing was imported/);
  });

  it("still refuses with no mark from the house or the file", () => {
    expect(() => parser.read("name,bottle_price\nMalbec,1.250\n")).toThrow(
      /nothing was imported/,
    );
  });

  it("names the mark each kind of cell settles", () => {
    expect(fileGroupMark(["1.250,00", "900"])).toBe(".");
    expect(fileGroupMark(["12,50"])).toBe(".");
    expect(fileGroupMark(["1,250.00"])).toBe(",");
    expect(fileGroupMark(["1.250.000"])).toBe(".");
    expect(fileGroupMark(["1.250", "900"])).toBeNull();
    expect(fileGroupMark(["12,50", "12.50"])).toBe("conflict");
  });
});

/** F-680: a file that reads as no line says why, in the owner's words. */
describe("CsvParserService.read — why nothing was read", () => {
  const parser = new CsvParserService();

  it("names the columns it saw when none is a name", () => {
    const r = parser.read("Etiket,Bağ\nYakut,Kavaklıdere\n");
    expect(r.items).toEqual([]);
    expect(r.emptyCause).toMatch(
      /^Nothing was read from this file, so nothing was kept\./,
    );
    expect(r.emptyCause).toMatch(/columns we saw were: Etiket, Bağ/);
  });

  it("counts every skipped row when all of them were skipped", () => {
    const r = parser.read("name,bottle\nKIRMIZI ŞARAPLAR,\n,45\n");
    expect(r.emptyCause).toMatch(
      /Every row was skipped: 1 looked like headings with no price, 1 had no name\./,
    );
  });

  it("says an old .xls could not be opened", async () => {
    const r = await parser.readExcel(
      Buffer.from("not a workbook").toString("base64"),
    );
    expect(r.emptyCause).toMatch(/could not open this spreadsheet.*\.xls/);
  });
});

/** F-684: the splitter reads ordinary spreadsheet rows as a spreadsheet does. */
describe("CsvParserService.read — rows and delimiters", () => {
  const parser = new CsvParserService();

  it.each([
    ["semicolon", "name;producer;bottle\nYakut;Kavaklıdere;850\n"],
    ["tab", "name\tproducer\tbottle\nYakut\tKavaklıdere\t850\n"],
    ["comma", "name,producer,bottle\nYakut,Kavaklıdere,850\n"],
  ])("reads a %s-separated file", (_k, csv) => {
    expect(parser.parse(csv)).toEqual([
      expect.objectContaining({
        name: "Yakut",
        producer: "Kavaklıdere",
        bottle_price: 850,
      }),
    ]);
  });

  it("keeps a quoted cell that holds a line break as one line", () => {
    const items = parser.parse(
      'name,producer,bottle\n"Yakut\nReserve",Kavaklıdere,850\nSyrah,X,90\n',
    );
    expect(items.map((i) => [i.name, i.producer, i.bottle_price])).toEqual([
      ["Yakut\nReserve", "Kavaklıdere", 850],
      ["Syrah", "X", 90],
    ]);
  });

  it("reads a doubled quote inside quotes as one quote", () => {
    expect(
      parser.parse('name,bottle\n"Château ""Le"" Petit",40\n')[0].name,
    ).toBe('Château "Le" Petit');
  });

  it("skips and counts headings with no price and rows with no name", () => {
    const r = parser.read(
      "name,producer,bottle\nKIRMIZI ŞARAPLAR,,\nYakut,Kavaklıdere,850\n,Doluca,90\n",
    );
    expect(r.items.map((i) => i.name)).toEqual(["Yakut"]);
    expect(r.notes.dropped).toEqual([
      { row: 2, reason: '"KIRMIZI ŞARAPLAR" looks like a heading (no price)' },
      { row: 4, reason: "no name" },
    ]);
  });

  it("keeps an unpriced line that has more than a name", () => {
    expect(
      parser.parse("name,producer,bottle\nYakut,Kavaklıdere,MP\n"),
    ).toHaveLength(1);
  });

  it("refuses the file when a price is below zero", () => {
    const run = () => parser.parse("name,bottle\nMalbec,-45\n");
    expect(run).toThrow(
      /can't be below zero, so nothing was imported\. Check row 2 \(Malbec\): “-45”/,
    );
  });

  it("finds the header under a title line", () => {
    const r = parser.read("Drinks list 2026\nname,bottle\nYakut,850\n");
    expect(r.items).toEqual([
      expect.objectContaining({ name: "Yakut", bottle_price: 850 }),
    ]);
  });
});

/** F-017: headers in the words houses use, and what is not read is named. */
describe("CsvParserService.read — headers", () => {
  const parser = new CsvParserService();

  it.each([
    ["Wine Name", "wine_name"],
    ["Şişe Fiyatı", "sise_fiyati"],
    ["\uFEFFFİYAT", "fiyat"],
    ["by-glass", "by_glass"],
  ])("folds %s to %s", (raw, key) => {
    expect(normalizeMenuHeader(raw)).toBe(key);
  });

  it("reads Wine Name, and names a bare Price as not read (menu-import-a decision 2)", () => {
    const r = parser.read(
      "Wine Name,Price,Fiyat,Notes\nOpus One,62,62,lovely\n",
    );
    expect(r.items[0]).toMatchObject({ name: "Opus One" });
    expect(r.items[0].bottle_price).toBeUndefined();
    expect(r.items[0].by_glass_price).toBeUndefined();
    expect(r.notes.ignoredColumns).toEqual(["Price", "Fiyat", "Notes"]);
  });

  it("reads Château and other accented headers through the one spelling", () => {
    const [item] = parser.parse(
      "Name,Château,Bölge\nMargaux,Ch. Margaux,Bordeaux\n",
    );
    expect(item).toMatchObject({
      name: "Margaux",
      producer: "Ch. Margaux",
      region: "Bordeaux",
    });
  });

  it("reads Turkish headers: Ad, Üretici, Şişe, Kadeh", () => {
    const [item] = parser.parse(
      "Ad;Üretici;Şişe;Kadeh\nYakut;Kavaklıdere;850;180\n",
    );
    expect(item).toMatchObject({
      name: "Yakut",
      producer: "Kavaklıdere",
      bottle_price: 850,
      by_glass_price: 180,
    });
  });

  it("reads glass as the glass price", () => {
    expect(parser.parse("name,glass\nHouse red,9\n")[0].by_glass_price).toBe(9);
  });

  it("ignores a bare Price when the sheet has its own bottle column, and says so", () => {
    const r = parser.read("Name,Bottle,Price\nYakut,850,999\n");
    expect(r.items[0].bottle_price).toBe(850);
    expect(r.notes.ignoredColumns).toEqual(["Price"]);
  });
});

/** F-683: formula and rich-text cells are read by what Excel shows. */
describe("CsvParserService.readExcel — cells", () => {
  const parser = new CsvParserService();

  async function workbook(rows: unknown[][]): Promise<string> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Menu");
    rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
  }

  it("reads a formula price by its saved result and a rich-text name by its text", async () => {
    const b64 = await workbook([
      ["Name", "Producer", "Bottle", "Glass"],
      [
        {
          richText: [
            { text: "Yakut", font: { bold: true } },
            { text: " 2021" },
          ],
        },
        { richText: [{ text: "Kavaklıdere" }] },
        { formula: "700*1.1", result: 770 },
        { formula: "C2/5", result: 154 },
      ],
    ]);
    const r = await parser.readExcel(b64);
    expect(r.items).toEqual([
      expect.objectContaining({
        name: "Yakut 2021",
        producer: "Kavaklıdere",
        bottle_price: 770,
        by_glass_price: 154,
      }),
    ]);
    expect(r.notes.unreadable).toEqual([]);
  });

  it("names a formula cell that has no saved value", async () => {
    const b64 = await workbook([
      ["Name", "Bottle"],
      ["Yakut", { formula: "700*1.1" }],
    ]);
    const r = await parser.readExcel(b64);
    expect(r.items[0].name).toBe("Yakut");
    expect(r.items[0].bottle_price).toBeUndefined();
    expect(r.notes.unreadable).toEqual([
      "row 2, column B: a formula with no saved value (open the file in Excel and save it again)",
    ]);
  });

  it("passes over a cover sheet to the sheet with the list", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Cover").addRow(["Our drinks"]);
    const ws = wb.addWorksheet("List");
    ws.addRow(["Name", "Bottle"]);
    ws.addRow(["Yakut", 850]);
    const r = await parser.readExcel(
      Buffer.from(await wb.xlsx.writeBuffer()).toString("base64"),
    );
    expect(r.items).toEqual([
      expect.objectContaining({ name: "Yakut", bottle_price: 850 }),
    ]);
  });
});

/**
 * ADR 0340 rule 14 (lane 5b), only with MENUS_SPLIT_BY_KIND: a heading row
 * is a section, not a dropped row; a run of headings is a path; every sheet
 * of a workbook is read, its name the top heading; a sheet with no name
 * column is said (rule 17). Off, a heading row is dropped as before.
 */
describe("CsvParserService — a read with sections (ADR 0340 lane 5b)", () => {
  const parser = new CsvParserService();
  const csv =
    "name,bottle\nWINES,\nRed,\nYakut,850\nWhite,\nÇankaya,700\nMAINS,\nKebap,40\n";

  it("off: a heading row is dropped and no line has a section", () => {
    const r = parser.read(csv);
    expect(r.items.map((i) => i.section)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(r.notes.dropped.map((d) => d.reason)).toContain(
      '"WINES" looks like a heading (no price)',
    );
  });

  it("on: a run of heading rows is the path; the next run replaces it", () => {
    const r = parser.read(csv, null, { sections: true });
    expect(r.items.map((i) => [i.name, i.section?.path])).toEqual([
      ["Yakut", ["WINES", "Red"]],
      ["Çankaya", ["White"]],
      ["Kebap", ["MAINS"]],
    ]);
    expect(r.notes.dropped).toEqual([]);
  });

  it("on: every sheet is read, each sheet's name its top heading; a sheet with no name column is said", async () => {
    const wb = new ExcelJS.Workbook();
    const wines = wb.addWorksheet("Wines");
    [
      ["Name", "Bottle"],
      ["Red", ""],
      ["Yakut", 850],
    ].forEach((r) => wines.addRow(r));
    const food = wb.addWorksheet("Food");
    [
      ["Name", "Bottle"],
      ["Kebap", 40],
    ].forEach((r) => food.addRow(r));
    const notes = wb.addWorksheet("Notes");
    [
      ["Supplier", "Phone"],
      ["Kavaklıdere", "555"],
    ].forEach((r) => notes.addRow(r));
    const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");

    const off = await parser.readExcel(b64);
    expect(off.items.map((i) => i.name)).toEqual(["Yakut"]);
    expect(off.gaps).toBeUndefined();

    const on = await parser.readExcel(b64, null, { sections: true });
    expect(on.items.map((i) => [i.name, i.section?.path])).toEqual([
      ["Yakut", ["Wines", "Red"]],
      ["Kebap", ["Food"]],
    ]);
    expect(on.gaps).toEqual([
      expect.stringMatching(
        /^the sheet "Notes" was not read: We could not find a column for the drink's name/,
      ),
    ]);
  });
});
