import { Injectable, Logger } from "@nestjs/common";
import { WineExtractItem } from "../wine-extract-item.interface";
import { readMenuPrice } from "./menu-price";

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

const DELIMITERS = [",", ";", "\t"] as const;

const PRICE_FIELDS = new Set<keyof WineExtractItem>([
  "by_glass_price",
  "bottle_price",
]);

type Rec = { cells: string[]; raw: string; row: number };

/** RFC 4180 records (quoted delimiter, line break, `""`), each with its source text and first row. */
function readRecords(
  text: string,
  delimiter: string,
  opts: { lineBound?: boolean; firstRow?: number } = {},
): { records: Rec[]; unclosed: { at: number; row: number } | null } {
  const records: Rec[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let start = 0;
  let row = opts.firstRow ?? 1;
  let startRow = row;

  const endRecord = (end: number) => {
    cells.push(cell);
    records.push({ cells, raw: text.slice(start, end), row: startRow });
    cells = [];
    cell = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // Line-bound (the re-read after an unclosed quote): a quote never spans lines.
    if (inQuotes && opts.lineBound && (ch === "\n" || ch === "\r"))
      inQuotes = false;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) row++;
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === "") {
      cell = "";
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      endRecord(i);
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row++;
      start = i + 1;
      startRow = row;
    } else {
      cell += ch;
    }
  }
  // A quote that never closes would swallow the rest of the file into one
  // cell. Drop that record and say where it began; the caller re-reads from there.
  if (inQuotes) return { records, unclosed: { at: start, row: startRow } };
  if (start < text.length || cells.length > 0 || cell !== "")
    endRecord(text.length);
  return { records, unclosed: null };
}

/**
 * All records of a file. From an unclosed quote on, each line stands alone
 * (the old line reader's loss: one line, not every line after it).
 * `unclosedRow` is the row where that quote opened.
 */
function readAllRecords(
  text: string,
  delimiter: string,
): { records: Rec[]; unclosedRow: number | null } {
  const first = readRecords(text, delimiter);
  if (!first.unclosed) return { records: first.records, unclosedRow: null };
  const { at, row } = first.unclosed;
  const rest = readRecords(text.slice(at), delimiter, {
    lineBound: true,
    firstRow: row,
  });
  return { records: [...first.records, ...rest.records], unclosedRow: row };
}

/** The delimiter the header line uses most outside quotes; else a comma. */
function sniffDelimiter(text: string): string {
  const header = text.split(/\r?\n|\r/)[0].replace(/"[^"]*"/g, "");
  const n = (d: string) => header.split(d).length;
  return DELIMITERS.reduce((best, d) => (n(d) > n(best) ? d : best), ",");
}

@Injectable()
export class CsvParserService {
  private readonly logger = new Logger(CsvParserService.name);

  parse(csvContent: string): WineExtractItem[] {
    // A string by type, not by trust: the body is user-supplied.
    const text = (
      typeof csvContent === "string" ? csvContent : String(csvContent ?? "")
    ).replace(/^\uFEFF/, "");
    const records = readAllRecords(text, sniffDelimiter(text)).records.filter(
      (r) => r.cells.some((c) => c.trim().length > 0),
    );
    if (records.length < 2) return [];

    const headers = records[0].cells.map((h) => h.toLowerCase().trim());
    const fieldMap: Array<keyof WineExtractItem | null> = headers.map(
      (h) => HEADER_MAP[h] ?? null,
    );

    const items: WineExtractItem[] = [];
    for (const record of records.slice(1)) {
      const item = this.buildItem(fieldMap, record.cells);
      if (item) {
        item.raw_text = record.raw.trim();
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
        // One reading or no amount (ADR 0020): "62,50" is 62.5, "1.250" is blank.
        const { amount } = readMenuPrice(raw);
        if (amount !== null) (item as any)[field] = amount;
      } else {
        (item as any)[field] = raw;
      }
    });

    if (!item.name) return null;
    return item as WineExtractItem;
  }
}
