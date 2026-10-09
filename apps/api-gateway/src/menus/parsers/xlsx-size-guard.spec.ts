import { BadRequestException } from "@nestjs/common";
import { crc32, deflateRawSync } from "node:zlib";
import { CsvParserService } from "./csv-parser.service";
import { XlsxRefusedError, assertXlsxWithinLimits } from "./xlsx-size-guard";

/**
 * F-475 — a sub-1 MB .xlsx inflated to hundreds of MB inside ExcelJS and took
 * the gateway's heap down for every house. These build small, high-ratio zips
 * by hand and check they are refused before ExcelJS is called.
 */

type Part = { name: string; data: Buffer; declaredSize?: number };

/** A minimal deflate zip. `declaredSize` lets a test lie in the headers. */
function zip(parts: Part[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data, declaredSize } of parts) {
    const packed = deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(name);
    const size = declaredSize ?? data.length;
    const crc = crc32(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(packed.length, 18);
    lfh.writeUInt32LE(size, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(packed.length, 20);
    cdh.writeUInt32LE(size, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    locals.push(lfh, nameBuf, packed);
    centrals.push(cdh, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const MB = 1024 * 1024;
const bomb = () => Buffer.alloc(40 * MB, 0x20); // 40 MB of spaces

describe("assertXlsxWithinLimits", () => {
  it("refuses a small archive that declares 40 MB unpacked", () => {
    const file = zip([{ name: "xl/worksheets/sheet1.xml", data: bomb() }]);
    expect(file.length).toBeLessThan(100 * 1024); // the attack is small on the wire
    expect(() => assertXlsxWithinLimits(file)).toThrow(/declares over/);
  });

  it("refuses an archive that LIES about its size, by inflating with a cap", () => {
    const file = zip([
      { name: "xl/worksheets/sheet1.xml", data: bomb(), declaredSize: 1000 },
    ]);
    let caught: unknown;
    try {
      assertXlsxWithinLimits(file);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(XlsxRefusedError);
    expect((caught as XlsxRefusedError).tooLarge).toBe(true);
    expect((caught as XlsxRefusedError).detail).toMatch(/unpacks to over/);
  });

  it("refuses too many entries", () => {
    const parts = Array.from({ length: 5 }, (_, i) => ({
      name: `p${i}`,
      data: Buffer.from("x"),
    }));
    expect(() => assertXlsxWithinLimits(zip(parts), 1000, 4)).toThrow(
      /entries, over 4/,
    );
  });

  it("says a non-zip is not a zip, not that it is too large", () => {
    try {
      assertXlsxWithinLimits(Buffer.from("name,price\nRioja,40\n"));
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(XlsxRefusedError);
      expect((err as XlsxRefusedError).tooLarge).toBe(false);
    }
  });

  it("passes a real workbook written by ExcelJS", async () => {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Wines");
    ws.addRow(["name", "bottle_price"]);
    ws.addRow(["Rioja Reserva", 48]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(() => assertXlsxWithinLimits(buf)).not.toThrow();
  });
});

describe("CsvParserService.parseExcel with a zip bomb", () => {
  it("refuses in plain words and never hands the file to ExcelJS", async () => {
    // The class behind `workbook.xlsx` (exceljs/lib/xlsx/xlsx.js in 4.4.0).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require("exceljs/lib/xlsx/xlsx");
    const load = jest.spyOn(XLSX.prototype, "load");
    const file = zip([{ name: "xl/worksheets/sheet1.xml", data: bomb() }]);
    const parser = new CsvParserService();
    const result = parser.parseExcel(file.toString("base64"));
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toThrow(/too big to read/);
    expect(load).not.toHaveBeenCalled();
    load.mockRestore();
  });

  it("still reads a real workbook", async () => {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Wines");
    ws.addRow(["name", "bottle_price"]);
    ws.addRow(["Rioja Reserva", 48]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const items = await new CsvParserService().parseExcel(
      buf.toString("base64"),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "Rioja Reserva", bottle_price: 48 });
  });
});
