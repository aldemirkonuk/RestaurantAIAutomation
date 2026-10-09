import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { WineExtractItem } from "../wine-extract-item.interface";

// Maps lowercased CSV/Excel header aliases → WineExtractItem field names
const HEADER_MAP: Record<string, keyof WineExtractItem> = {
  name: "name",
  wine_name: "name",
  item: "name",
  producer: "producer",
  winery: "producer",
  vineyard: "producer",
  chateau: "producer",
  château: "producer",
  brand: "producer",
  vintage: "vintage",
  year: "vintage",
  region: "region",
  appellation: "region",
  grape: "grape_variety",
  variety: "grape_variety",
  grape_variety: "grape_variety",
  category: "category",
  type: "category",
  by_glass: "by_glass_price",
  glass_price: "by_glass_price",
  by_glass_price: "by_glass_price",
  bottle: "bottle_price",
  bottle_price: "bottle_price",
};

const PRICE_FIELDS = new Set<keyof WineExtractItem>([
  "by_glass_price",
  "bottle_price",
]);

/**
 * One price cell, read in either locale (F-471). The old reader stripped every
 * character but digits and points, so "12,50" became 1250 and "1.250,00 TL"
 * became 1.25: a thousand times off either way, with no word to anyone.
 *
 * A cell is read only when it has one meaning:
 *   - both marks ("1.250,00", "1,250.00"): the last one is the decimal mark,
 *     and the other must group thousands by three;
 *   - one mark followed by one or two digits ("12,50", "12.5"): decimals;
 *   - one kind of mark repeated over groups of three ("1.250.000"): thousands.
 * A single mark followed by exactly three digits ("1.250", "1,250") is 1250 in
 * one country and 1.25 in another, so it is refused, as are ranges ("45-60")
 * and anything else with digits that fits none of the above. A cell with no
 * digits at all ("MP", "—") is no price, as before.
 */
export type PriceReading =
  | { kind: "none" }
  | { kind: "price"; value: number }
  | { kind: "unclear" };

export function readPriceCell(raw: string): PriceReading {
  if (!/[0-9]/.test(raw)) return { kind: "none" };
  // Currency words and signs, and spaces (incl. no-break and thin) or
  // apostrophes used to group thousands, carry no number.
  const s = raw
    .replace(/[\s\u00a0\u202f'’]/g, "")
    .replace(/^[^0-9.,-]+|[^0-9.,]+$/g, "");
  if (!/^[0-9][0-9.,]*$/.test(s)) return { kind: "unclear" };

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  const grouped = (intPart: string, mark: string) =>
    new RegExp(`^[0-9]{1,3}(\\${mark}[0-9]{3})+$`).test(intPart);
  const value = (n: string) => ({ kind: "price" as const, value: Number(n) });

  if (lastDot === -1 && lastComma === -1) return value(s);

  if (lastDot !== -1 && lastComma !== -1) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    const at = s.lastIndexOf(dec);
    const intPart = s.slice(0, at);
    const frac = s.slice(at + 1);
    if (!/^[0-9]{1,2}$/.test(frac) || !grouped(intPart, thou)) return { kind: "unclear" };
    return value(`${intPart.split(thou).join("")}.${frac}`);
  }

  const mark = lastDot !== -1 ? "." : ",";
  const parts = s.split(mark);
  if (parts.length === 2 && /^[0-9]{1,2}$/.test(parts[1]) && parts[0] !== "") {
    return value(`${parts[0]}.${parts[1]}`);
  }
  if (parts.length > 2 && grouped(s, mark)) return value(parts.join(""));
  return { kind: "unclear" };
}

@Injectable()
export class CsvParserService {
  private readonly logger = new Logger(CsvParserService.name);

  parse(csvContent: string): WineExtractItem[] {
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = this.parseLine(lines[0]).map((h) => h.toLowerCase().trim());
    const fieldMap: Array<keyof WineExtractItem | null> = headers.map(
      (h) => HEADER_MAP[h] ?? null,
    );

    const items: WineExtractItem[] = [];

    const unclear: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseLine(lines[i]);
      const item = this.buildItem(fieldMap, cols, i + 1, unclear);
      if (item) {
        item.raw_text = lines[i].trim();
        items.push(item);
      }
    }

    this.refuseUnclear(unclear);
    return items;
  }

  /**
   * Parses a real .xlsx/.xls workbook (binary, base64-encoded over the wire).
   * The previous implementation had no Excel support at all — the upload UI
   * advertised .xlsx/.xls but read the binary file with readAsText and fed
   * the resulting garbage into the CSV line-splitter, silently producing
   * zero or nonsense items.
   */
  async parseExcel(base64: string): Promise<WineExtractItem[]> {
    const ExcelJS = await import("exceljs");
    const buffer = Buffer.from(base64, "base64");
    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch (err) {
      this.logger.warn(`Failed to parse Excel workbook: ${err.message}`);
      return [];
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) return [];

    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber - 1] = this.cellToString(cell.value)
        .toLowerCase()
        .trim();
    });
    const fieldMap: Array<keyof WineExtractItem | null> = headers.map(
      (h) => HEADER_MAP[h] ?? null,
    );

    const items: WineExtractItem[] = [];
    const unclear: string[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header row
      const cols: Array<string | number> = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        // A number cell is already a number; only typed text needs reading.
        cols[colNumber - 1] =
          typeof cell.value === "number" ? cell.value : this.cellToString(cell.value);
      });
      const item = this.buildItem(fieldMap, cols, rowNumber, unclear);
      if (item) items.push(item);
    });

    this.refuseUnclear(unclear);
    return items;
  }

  private cellToString(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "object" && "text" in (value as any)) {
      // Rich text / hyperlink cell shapes
      return String((value as any).text ?? "");
    }
    return String(value);
  }

  private buildItem(
    fieldMap: Array<keyof WineExtractItem | null>,
    cols: Array<string | number>,
    rowNumber: number,
    unclear: string[],
  ): WineExtractItem | null {
    const item: Partial<WineExtractItem> = {};
    const unclearHere: string[] = [];

    fieldMap.forEach((field, colIdx) => {
      if (!field) return;
      const cell = cols[colIdx];
      if (PRICE_FIELDS.has(field) && typeof cell === "number") {
        if (Number.isFinite(cell)) (item as any)[field] = cell;
        return;
      }
      const raw = String(cell ?? "").trim();
      if (!raw) return;

      if (PRICE_FIELDS.has(field)) {
        const read = readPriceCell(raw);
        if (read.kind === "price") (item as any)[field] = read.value;
        else if (read.kind === "unclear") unclearHere.push(`“${raw}”`);
      } else {
        (item as any)[field] = raw;
      }
    });

    if (!item.name) return null;
    if (unclearHere.length > 0) {
      unclear.push(`row ${rowNumber} (${item.name}): ${unclearHere.join(", ")}`);
    }
    return item as WineExtractItem;
  }

  /**
   * A price that could be off by a thousand is not guessed. The whole file is
   * refused before anything is kept, with every cell named, so the owner can
   * fix the sheet and send it again.
   */
  private refuseUnclear(unclear: string[]): void {
    if (unclear.length === 0) return;
    const shown = unclear.slice(0, 5).join("; ");
    const more = unclear.length > 5 ? `; and ${unclear.length - 5} more` : "";
    throw new BadRequestException(
      `Some prices in this file can be read more than one way, so nothing was imported. ` +
        `Check ${shown}${more}. ` +
        `Write each price with no thousands mark, and a comma or a point only before the cents, like 1250 or 12,50.`,
    );
  }

  // Respects double-quoted fields that may contain commas
  private parseLine(line: string): string[] {
    const results: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        results.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    results.push(current);
    return results;
  }
}
