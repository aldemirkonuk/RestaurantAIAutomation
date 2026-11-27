import { Injectable, Logger } from "@nestjs/common";
import { MenuReadWarning, WineExtractItem } from "../wine-extract-item.interface";

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

/** A price cell: its number, `ambiguous` (a comma that may be a thousands mark or a decimal), or null (no number). */
export function readPrice(raw: string): number | "ambiguous" | null {
  let s = raw.replace(/[^0-9.,]/g, "");
  if (s.includes(",") && s.includes(".")) {
    // Both marks: the LAST one is the decimal mark ("1.250,75" and "1,250.75" are both 1250.75).
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const group = dec === "," ? "." : ",";
    s = s.split(group).join("").replace(dec, ".");
  } else if (s.includes(",")) {
    if (/^\d*,\d{1,2}$/.test(s)) s = s.replace(",", "."); // "62,50": a decimal comma
    else if (/^\d{1,3},\d{3}$/.test(s)) return "ambiguous"; // "1,250": 1250 or 1.25, never a guess (ADR 0067)
    else s = s.replace(/,/g, ""); // "1,250,000": thousands marks
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, ""); // "1.250.000": thousands marks
  }
  const num = parseFloat(s);
  return isNaN(num) ? null : num;
}

/** The apostrophe the menu sheet puts before a cell a spreadsheet would open as a formula. */
const FORMULA_ESCAPE = /^'(?=[=+\-@\t\r])/;

@Injectable()
export class CsvParserService {
  private readonly logger = new Logger(CsvParserService.name);

  parse(csvContent: string, warnings?: MenuReadWarning[]): WineExtractItem[] {
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = this.parseLine(lines[0]).map((h) => h.toLowerCase().trim());
    const fieldMap: Array<keyof WineExtractItem | null> = headers.map(
      (h) => HEADER_MAP[h] ?? null,
    );

    const items: WineExtractItem[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseLine(lines[i]);
      const item = this.buildItem(fieldMap, cols, warnings);
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
  async parseExcel(base64: string, warnings?: MenuReadWarning[]): Promise<WineExtractItem[]> {
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
      const item = this.buildItem(fieldMap, cols, warnings);
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
    warnings?: MenuReadWarning[],
  ): WineExtractItem | null {
    const item: Partial<WineExtractItem> = {};
    let ambiguous = false;

    fieldMap.forEach((field, colIdx) => {
      if (!field) return;
      const raw = (cols[colIdx] ?? "").trim();
      if (!raw) return;

      if (PRICE_FIELDS.has(field)) {
        const num = readPrice(raw);
        if (num === "ambiguous") ambiguous = true;
        else if (num !== null) (item as any)[field] = num;
      } else {
        (item as any)[field] = raw.replace(FORMULA_ESCAPE, "").trim();
      }
    });

    // A price that could be read two ways is not guessed: the line is refused, once said per file.
    if (ambiguous) {
      if (warnings && !warnings.some((w) => w.kind === "ambiguous_price")) warnings.push({ kind: "ambiguous_price", pages: null });
      return null;
    }
    if (!item.name) return null;
    return item as WineExtractItem;
  }

  // Respects double-quoted fields that may contain commas
  private parseLine(line: string): string[] {
    const results: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        // "" inside a quoted field is one literal quote (RFC 4180), as the menu sheet writes it.
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
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
