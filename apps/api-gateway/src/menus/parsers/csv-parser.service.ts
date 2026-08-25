import { Injectable, Logger } from "@nestjs/common";
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

    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseLine(lines[i]);
      const item = this.buildItem(fieldMap, cols);
      if (item) {
        item.raw_text = lines[i].trim();
        items.push(item);
      }
    }

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
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header row
      const cols: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cols[colNumber - 1] = this.cellToString(cell.value);
      });
      const item = this.buildItem(fieldMap, cols);
      if (item) items.push(item);
    });

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
    cols: string[],
  ): WineExtractItem | null {
    const item: Partial<WineExtractItem> = {};

    fieldMap.forEach((field, colIdx) => {
      if (!field) return;
      const raw = (cols[colIdx] ?? "").trim();
      if (!raw) return;

      if (PRICE_FIELDS.has(field)) {
        const num = parseFloat(raw.replace(/[^0-9.]/g, ""));
        if (!isNaN(num)) (item as any)[field] = num;
      } else {
        (item as any)[field] = raw;
      }
    });

    if (!item.name) return null;
    return item as WineExtractItem;
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
