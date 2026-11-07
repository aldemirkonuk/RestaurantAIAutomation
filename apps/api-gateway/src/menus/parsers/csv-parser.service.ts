import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { WineExtractItem } from "../wine-extract-item.interface";
import { MenuPriceReason, readMenuPrice } from "./menu-price";

// Aliases by field, against `headerKey`: "Şişe Fiyatı (TL)" is `sise_fiyati`.
const ALIASES: Array<[keyof WineExtractItem, string]> = [
  [
    "name",
    "name wine wine_name item ad adi isim urun urun_adi sarap sarap_adi",
  ],
  ["producer", "producer winery vineyard chateau brand uretici"],
  ["vintage", "vintage year yil rekolte"],
  ["region", "region appellation bolge"],
  ["grape_variety", "grape variety grape_variety uzum uzum_cesidi"],
  ["category", "category type kategori tur"],
  [
    "by_glass_price",
    "by_glass glass glass_price by_glass_price kadeh kadeh_fiyati",
  ],
  // No bare "price"/"fiyat": which price it is is not decided.
  ["bottle_price", "bottle bottle_price sise sise_fiyati"],
];
const HEADER_MAP = new Map(
  ALIASES.flatMap(([field, keys]) =>
    keys.split(" ").map((k) => [k, field] as const),
  ),
);

const PRICE_FIELDS = new Set<keyof WineExtractItem>([
  "by_glass_price",
  "bottle_price",
]);

const DELIMITERS = [",", ";", "\t"] as const;

/** A row the read could not take whole. */
export interface CsvRowIssue {
  /** 1-based; the header is row 1. */
  row: number;
  reason: "no_name" | "no_name_column" | Exclude<MenuPriceReason, "empty">;
  field?: keyof WineExtractItem;
  raw?: string;
}

type Cell = string | number;
type Rec = { cells: string[]; raw: string; row: number };

function headerKey(header: string): string {
  return header
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\u0131/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** RFC 4180 records (quoted delimiter, line break, `""`), each with its source text and first row. */
function readRecords(text: string, delimiter: string): Rec[] {
  const records: Rec[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let start = 0;
  let row = 1;
  let startRow = 1;

  const endRecord = (end: number) => {
    cells.push(cell);
    records.push({ cells, raw: text.slice(start, end), row: startRow });
    cells = [];
    cell = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
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
  if (start < text.length || cells.length > 0 || cell !== "")
    endRecord(text.length);
  return records;
}

/** The delimiter the header line uses most outside quotes; else a comma. */
function sniffDelimiter(text: string): string {
  const header = text.split(/\r?\n|\r/)[0].replace(/"[^"]*"/g, "");
  const n = (d: string) => header.split(d).length;
  return DELIMITERS.reduce((best, d) => (n(d) > n(best) ? d : best), ",");
}

/** An old Excel workbook (.xls) is an OLE2 compound file, not a zip. */
const OLE2_MAGIC = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

@Injectable()
export class CsvParserService {
  private readonly logger = new Logger(CsvParserService.name);

  parse(csvContent: string): WineExtractItem[] {
    return this.read(csvContent).items;
  }

  /** `parse`, plus every row it could not take whole and why. */
  read(csvContent: string): {
    items: WineExtractItem[];
    issues: CsvRowIssue[];
  } {
    const text = (csvContent ?? "").replace(/^\uFEFF/, "");
    const records = readRecords(text, sniffDelimiter(text)).filter((r) =>
      r.cells.some((c) => c.trim().length > 0),
    );
    if (records.length < 2) return { items: [], issues: [] };

    const fieldMap = this.fieldMap(records[0].cells);
    const issues: CsvRowIssue[] = [];
    if (!fieldMap.includes("name"))
      return {
        items: [],
        issues: [{ row: records[0].row, reason: "no_name_column" }],
      };

    const items: WineExtractItem[] = [];
    for (const record of records.slice(1)) {
      const item = this.buildItem(fieldMap, record.cells, record.row, issues);
      if (item) {
        item.raw_text = record.raw.trim();
        items.push(item);
      }
    }
    return { items, issues };
  }

  /** An .xlsx workbook, base64. An .xls or a non-workbook is refused in words, not read as empty. */
  async parseExcel(base64: string): Promise<WineExtractItem[]> {
    const ExcelJS = await import("exceljs");
    const buffer = Buffer.from(base64, "base64");
    if (buffer.subarray(0, OLE2_MAGIC.length).equals(OLE2_MAGIC)) {
      throw new BadRequestException(
        "This is an older Excel file (.xls), which cannot be read here. Save it as .xlsx or CSV and upload that.",
      );
    }
    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch (err) {
      this.logger.warn(`Failed to parse Excel workbook: ${err.message}`);
      throw new BadRequestException(
        "This file could not be opened as an Excel workbook. Save it as .xlsx or CSV and upload that.",
      );
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) return [];

    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber - 1] = String(this.cellValue(cell.value));
    });
    const fieldMap = this.fieldMap(headers);
    if (!fieldMap.includes("name")) return [];

    const items: WineExtractItem[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header row
      const cols: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cols[colNumber - 1] = this.cellValue(cell.value);
      });
      const item = this.buildItem(fieldMap, cols, rowNumber, []);
      if (item) {
        item.raw_text = cols.join(",");
        items.push(item);
      }
    });

    return items;
  }

  private fieldMap(headers: string[]): Array<keyof WineExtractItem | null> {
    return Array.from(
      headers,
      (h) => HEADER_MAP.get(headerKey(h ?? "")) ?? null,
    );
  }

  /** A cell's number stays a number: a stored number has one reading. */
  private cellValue(value: unknown): Cell {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return value;
    if (typeof value === "object") {
      // A formula cell carries `result`; rich text and hyperlinks `text`.
      const v = value as Record<string, unknown>;
      if ("result" in v) return this.cellValue(v.result);
      if ("text" in v) return String(v.text ?? "");
    }
    return String(value);
  }

  private buildItem(
    fieldMap: Array<keyof WineExtractItem | null>,
    cols: Cell[],
    row: number,
    issues: CsvRowIssue[],
  ): WineExtractItem | null {
    const item: Partial<WineExtractItem> = {};
    const found: CsvRowIssue[] = [];

    fieldMap.forEach((field, colIdx) => {
      if (!field || item[field] !== undefined) return;
      const value = cols[colIdx];
      if (typeof value === "number") {
        if (PRICE_FIELDS.has(field)) {
          if (Number.isFinite(value) && value >= 0)
            (item as any)[field] = value;
        } else (item as any)[field] = String(value);
        return;
      }
      const raw = (value ?? "").trim();
      if (!raw) return;

      if (PRICE_FIELDS.has(field)) {
        const price = readMenuPrice(raw);
        if (price.amount !== null) (item as any)[field] = price.amount;
        else if (price.reason && price.reason !== "empty")
          found.push({ row, reason: price.reason, field, raw });
      } else {
        (item as any)[field] = raw;
      }
    });

    if (!item.name) {
      issues.push({ row, reason: "no_name" });
      return null;
    }
    issues.push(...found);
    return item as WineExtractItem;
  }
}
