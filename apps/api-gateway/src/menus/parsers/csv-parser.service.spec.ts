import { BadRequestException } from "@nestjs/common";
import { CsvParserService } from "./csv-parser.service";

const parser = () => new CsvParserService();

describe("CsvParserService.parse: Turkish and EU spreadsheets", () => {
  it("reads an Excel-TR semicolon file with Turkish headers and decimal-comma prices", () => {
    const csv =
      "\uFEFFŞarap Adı;Üretici;Yıl;Bölge;Üzüm;Kadeh Fiyatı (TL);Şişe Fiyatı\r\n" +
      "Kalecik Karası;Kavaklıdere;2021;Ankara;Kalecik Karası;145,50;1.250,00\r\n" +
      "Öküzgözü;Turasan;2020;Elazığ;Öküzgözü;;890\r\n";
    const items = parser().parse(csv);
    expect(items).toEqual([
      {
        name: "Kalecik Karası",
        producer: "Kavaklıdere",
        vintage: "2021",
        region: "Ankara",
        grape_variety: "Kalecik Karası",
        by_glass_price: 145.5,
        bottle_price: 1250,
        // The glass header names TL; the unmarked bottle cell is in the line's money (r40 N1).
        currency: "TL",
        raw_text:
          "Kalecik Karası;Kavaklıdere;2021;Ankara;Kalecik Karası;145,50;1.250,00",
      },
      expect.objectContaining({ name: "Öküzgözü", bottle_price: 890 }),
    ]);
  });

  it("reads a tab file with 'Bottle Price' and 'By Glass'", () => {
    const tab = parser().parse(
      "Name\tBottle Price\tBy Glass\nRioja\t120\t18.50\n",
    );
    expect(tab).toEqual([
      {
        name: "Rioja",
        bottle_price: 120,
        by_glass_price: 18.5,
        raw_text: "Rioja\t120\t18.50",
      },
    ]);
  });

  it("keeps RFC 4180 quoting: a delimiter, a doubled quote and a line break inside a cell", () => {
    const csv =
      "Name;Producer;Bottle\r\n" +
      '"Château ""Le Pin""; Pomerol";"Ets. Thienpont\r\nBordeaux";"2.400,00"\r\n' +
      "Sancerre;Vacheron;65\r\n";
    const items = parser().parse(csv);
    expect(items[0].name).toBe('Château "Le Pin"; Pomerol');
    expect(items[0].producer).toBe("Ets. Thienpont\r\nBordeaux");
    expect(items[0].bottle_price).toBe(2400);
    expect(items[1]).toMatchObject({
      name: "Sancerre",
      producer: "Vacheron",
      bottle_price: 65,
    });
    expect(items).toHaveLength(2);
  });

  it("gives a price with two readings NO amount, keeps the row, and says which cell", () => {
    const report = parser().read(
      "Name;Şişe Fiyatı;Kadeh\nBoğazkere;1.250;1,250\n",
    );
    expect(report.items).toEqual([
      { name: "Boğazkere", raw_text: "Boğazkere;1.250;1,250" },
    ]);
    expect(report.issues).toEqual([
      { row: 2, reason: "two_readings", field: "bottle_price", raw: "1.250" },
      { row: 2, reason: "two_readings", field: "by_glass_price", raw: "1,250" },
    ]);
  });

  it("reads `₺450` as 450 and keeps the symbol in the raw row", () => {
    const [item] = parser().parse("Name,Bottle\nRakı,₺450\n");
    expect(item.bottle_price).toBe(450);
    expect(item.raw_text).toBe("Rakı,₺450");
  });

  it("returns row-level issues, counting rows across a quoted line break", () => {
    // A bare Fiyat (price) column is read as the bottle price, and that is said (r28 G8).
    expect(parser().read('Name;Fiyat\n"Two\nlines";10\n;45\n')).toEqual({
      items: [{ name: "Two\nlines", bottle_price: 10, raw_text: '"Two\nlines";10' }],
      issues: [
        { row: 1, reason: "price_column_read_as_bottle", raw: "Fiyat" },
        { row: 4, reason: "no_name" },
      ],
    });
    expect(parser().read("Cost;Supplier\n12;Metro\n")).toEqual({
      items: [],
      issues: [{ row: 1, reason: "no_name_column" }],
    });
  });
});

describe("CsvParserService.read: notes", () => {
  // r28 G8: a menu sheet with one price column read every line unpriced.
  it("reads a bare Price / Fiyat column as each line's one price (the bottle price), and says so once", () => {
    const { items, issues } = parser().read("Ad;Fiyat (TL)\nNarince;450\nMercimek Çorbası;85,50\n");
    expect(items).toEqual([
      { name: "Narince", bottle_price: 450, currency: "TL", raw_text: "Narince;450" },
      { name: "Mercimek Çorbası", bottle_price: 85.5, currency: "TL", raw_text: "Mercimek Çorbası;85,50" },
    ]);
    expect(issues).toEqual([
      { row: 1, reason: "price_column_read_as_bottle", raw: "Fiyat (TL)" },
    ]);
    expect(parser().read("Name,Price\nEfes,90\n").items).toEqual([{ name: "Efes", bottle_price: 90, raw_text: "Efes,90" }]);
  });

  it("keeps a glass column as the glass price beside a bare price column", () => {
    const { items } = parser().read("Name;Glass;Price\nChianti;12;48\n");
    expect(items).toEqual([{ name: "Chianti", by_glass_price: 12, bottle_price: 48, raw_text: "Chianti;12;48" }]);
  });

  it("never reads a bare price over a named bottle column, and says the bare one was not read", () => {
    const { items, issues } = parser().read("Name;Price;Bottle\nChianti;12;48\nSoave;9;\n");
    expect(items).toEqual([
      { name: "Chianti", bottle_price: 48, raw_text: "Chianti;12;48" },
      { name: "Soave", raw_text: "Soave;9;" },
    ]);
    expect(issues).toEqual([{ row: 1, reason: "price_column_not_read", raw: "Price" }]);
  });

  it("reads only the first of two bare price columns", () => {
    const { items, issues } = parser().read("Name;Price;Fiyat\nRakı;;450\nEfes;90;80\n");
    expect(items).toEqual([
      { name: "Rakı", raw_text: "Rakı;;450" },
      { name: "Efes", bottle_price: 90, raw_text: "Efes;90;80" },
    ]);
    expect(issues).toEqual([
      { row: 1, reason: "price_column_read_as_bottle", raw: "Price" },
      { row: 1, reason: "price_column_not_read", raw: "Fiyat" },
    ]);
  });

  it("a bare price with two readings is left blank and said, like any price", () => {
    const { items, issues } = parser().read("Name;Price\nRakı;1.250\n");
    expect(items).toEqual([{ name: "Rakı", raw_text: "Rakı;1.250" }]);
    expect(issues).toEqual([
      { row: 1, reason: "price_column_read_as_bottle", raw: "Price" },
      { row: 2, reason: "two_readings", field: "bottle_price", raw: "1.250" },
    ]);
  });
});

describe("CsvParserService.parseExcel", () => {
  const xlsx = async (rows: unknown[][]): Promise<string> => {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Menu");
    rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
  };

  it("reads a workbook's bare Fiyat column as the bottle price, a stored number as it is (r28 G8)", async () => {
    const { items, issues } = await parser().readExcel(await xlsx([["Ürün", "Fiyat"], ["Künefe", 140], ["Ayran", "35,50"]]));
    expect(items.map((i) => [i.name, i.bottle_price])).toEqual([
      ["Künefe", 140],
      ["Ayran", 35.5],
    ]);
    expect(issues).toEqual([{ row: 1, reason: "price_column_read_as_bottle", raw: "Fiyat" }]);
  });

  it("refuses an old .xls workbook in words, not with an empty read", async () => {
    const ole2 = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(504),
    ]).toString("base64");
    const read = parser().parseExcel(ole2);
    await expect(read).rejects.toBeInstanceOf(BadRequestException);
    await expect(read).rejects.toThrow(/older Excel file \(\.xls\)/);
  });

  it("reads rich text as its plain text, a formula as its cached result, and an error cell as empty with a note", async () => {
    const { items, issues } = await parser().readExcel(
      await xlsx([
        [{ richText: [{ text: "Şarap " }, { text: "Adı", font: { bold: true } }] }, "Şişe Fiyatı", "Kadeh Fiyatı"],
        [
          { richText: [{ text: "Kalecik ", font: { bold: true } }, { text: "Karası" }] },
          { formula: "60+60", result: 120 },
          { formula: "VLOOKUP(A2,X:Y,2,0)", result: { error: "#N/A" } },
        ],
        ["Emir", { error: "#REF!" }, 90],
      ]),
    );
    expect(items).toEqual([
      { name: "Kalecik Karası", bottle_price: 120, raw_text: "Kalecik Karası,120," },
      { name: "Emir", by_glass_price: 90, raw_text: "Emir,,90" },
    ]);
    expect(JSON.stringify(items)).not.toContain("[object Object]");
    expect(issues).toEqual([
      { row: 2, reason: "cell_error", field: "by_glass_price", raw: "#N/A" },
      { row: 3, reason: "cell_error", field: "bottle_price", raw: "#REF!" },
    ]);
  });

  it("leaves a date cell past the calendar blank with a note, and still reads the file", async () => {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Menu");
    ws.addRow(["name", "vintage"]);
    ws.addRow(["A", 1e12]);
    ws.getCell("B2").numFmt = "dd/mm/yyyy";
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");

    const { items, issues } = await parser().readExcel(file);
    expect(items).toEqual([{ name: "A", raw_text: "A," }]);
    expect(issues).toEqual([
      { row: 2, reason: "cell_error", field: "vintage", raw: "Invalid Date" },
    ]);
  });

  it("maps Turkish headers, takes a stored number as is, reads a text price, and sets the raw row", async () => {
    const items = await parser().parseExcel(
      await xlsx([
        ["Şarap", "Üretici", "Şişe Fiyatı", "Kadeh Fiyatı"],
        ["Narince", "Kayra", 1.125, "145,50"],
        ["Emir", "Kocabağ", "1.250", 90],
      ]),
    );
    expect(items).toEqual([
      {
        name: "Narince",
        producer: "Kayra",
        bottle_price: 1.125,
        by_glass_price: 145.5,
        raw_text: "Narince,Kayra,1.125,145,50",
      },
      {
        name: "Emir",
        producer: "Kocabağ",
        by_glass_price: 90,
        raw_text: "Emir,Kocabağ,1.250,90",
      },
    ]);
  });
});

describe("CsvParserService: the money a file prices a line in (r40, r36 N1)", () => {
  it("names a cell's own money on the line, and reads the number as before", () => {
    const [chianti, soave] = parser().parse("Name,Bottle,Glass\nChianti,€48,€12\nSoave,40,\n");
    expect(chianti).toEqual({ name: "Chianti", bottle_price: 48, by_glass_price: 12, currency: "€", raw_text: "Chianti,€48,€12" });
    // A line that names no money carries no currency: it is the house's, as before.
    expect(soave).toEqual({ name: "Soave", bottle_price: 40, raw_text: "Soave,40," });
  });

  it("names a header's money for every unmarked cell under it; a cell's own mark comes first", () => {
    const items = parser().parse("Ad;Şişe Fiyatı (EUR)\nBarolo;64\nRakı;₺450\n");
    expect(items.map((i) => [i.name, i.bottle_price, i.currency])).toEqual([
      ["Barolo", 64, "EUR"],
      ["Rakı", 450, "₺"],
    ]);
  });

  it("keeps a price in another money in also_priced, never in the line's own prices", () => {
    // Two bottle columns: before, the second was passed over without a word.
    const [line] = parser().parse("Ad;Şişe (TL);Bottle (EUR)\nBrunello;3.250,00;95\n");
    expect(line).toEqual({
      name: "Brunello",
      bottle_price: 3250,
      currency: "TL",
      also_priced: [{ currency: "EUR", bottle_price: 95 }],
      raw_text: "Brunello;3.250,00;95",
    });
    // A glass in euros beside a bottle in lira: each keeps its own money.
    const [mixed] = parser().parse("Ad;Kadeh (EUR);Şişe (TL)\nSoave;9;1.200,00\n");
    expect(mixed).toEqual(
      expect.objectContaining({ by_glass_price: 9, currency: "EUR", also_priced: [{ currency: "TL", bottle_price: 1200 }] }),
    );
    expect(mixed.bottle_price).toBeUndefined();
    // Two columns in the same money: the second is passed over, as before.
    const [same] = parser().parse("Ad;Şişe (TL);Şişe (₺)\nSoave;1.200,00;1.300,00\n");
    expect(same).toEqual({ name: "Soave", bottle_price: 1200, currency: "TL", raw_text: "Soave;1.200,00;1.300,00" });
  });

  it("never splits a family mark from a code it may name", () => {
    const [line] = parser().parse("Name,Bottle ($),Glass (USD)\nMerlot,40,9\n");
    expect(line).toEqual({ name: "Merlot", bottle_price: 40, by_glass_price: 9, currency: "$", raw_text: "Merlot,40,9" });
  });

  it("says a second-money cell it cannot read, like any price", () => {
    const { items, issues } = parser().read("Ad;Şişe (TL);Bottle (EUR)\nBrunello;3.250,00;12 / 15\n");
    expect(items[0].also_priced).toBeUndefined();
    expect(issues).toEqual([{ row: 2, reason: "two_readings", field: "bottle_price", raw: "12 / 15" }]);
  });

  it("reads an Excel cell's money from its number format, before the header's", async () => {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Menu");
    ws.addRow(["Ürün", "Fiyat (TL)", "Kadeh"]);
    ws.addRow(["Chianti", 48, 12]);
    ws.addRow(["Narince", 1250, null]);
    ws.getCell("B2").numFmt = "[$€-x-euro2] #,##0.00";
    ws.getCell("C2").numFmt = "[$€-x-euro2] #,##0.00";
    const { items } = await parser().readExcel(Buffer.from(await wb.xlsx.writeBuffer()).toString("base64"));
    expect(items.map((i) => [i.name, i.bottle_price, i.by_glass_price, i.currency])).toEqual([
      ["Chianti", 48, 12, "€"],
      ["Narince", 1250, undefined, "TL"],
    ]);
  });
});
