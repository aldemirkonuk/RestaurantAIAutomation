import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { WineExtractItem } from "../wine-extract-item.interface";
import { MenuPriceReason, readMenuPrice } from "./menu-price";
import { cellMoneyMark, differentMoney, excelFormatMark, headerMoneyMark, oneMoneyOf } from "./price-mark";

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
  // A bare "price"/"fiyat" is not an alias: it is read as the bottle price
  // only where no bottle column is named (fieldMap, r28 G8).
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
  reason:
    | "no_name"
    | "no_name_column"
    /**
     * A bare `Price` / `Fiyat` header that is NOT read: the file names a bottle
     * column too, or an earlier bare price column was read.
     */
    | "price_column_not_read"
    /**
     * A bare `Price` / `Fiyat` header read as each line's one price, in
     * `bottle_price`: the price a dish line keeps (#1261) and a single-price
     * drink is sold at. Said once, on the header, so a glass price can be
     * renamed and read again (r28 G8).
     */
    | "price_column_read_as_bottle"
    /** A spreadsheet error value (`#N/A`, `#REF!`) where a value was expected. */
    | "cell_error"
    | Exclude<MenuPriceReason, "empty">;
  field?: keyof WineExtractItem;
  raw?: string;
}

type Cell = string | number;
/** An Excel error value (`#N/A`, `#REF!`, …), kept apart so it is noted, never read as text. */
type CellError = { error: string };

const BARE_PRICE_HEADERS = new Set(["price", "fiyat", "fiyati"]);
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
    // A string by type, not by trust: the body is user-supplied, and an
    // object with a forged `.length` must never drive the record loop.
    const text = (
      typeof csvContent === "string" ? csvContent : String(csvContent ?? "")
    ).replace(/^\uFEFF/, "");
    const records = readRecords(text, sniffDelimiter(text)).filter((r) =>
      r.cells.some((c) => c.trim().length > 0),
    );
    if (records.length < 2) return { items: [], issues: [] };

    const fieldMap = this.fieldMap(records[0].cells);
    const issues = this.headerIssues(records[0].cells, records[0].row);
    if (!fieldMap.includes("name"))
      return {
        items: [],
        issues: [...issues, { row: records[0].row, reason: "no_name_column" }],
      };

    const marks = records[0].cells.map((h) => headerMoneyMark(h));
    const items: WineExtractItem[] = [];
    for (const record of records.slice(1)) {
      const item = this.buildItem(fieldMap, record.cells, record.row, issues, marks);
      if (item) {
        item.raw_text = record.raw.trim();
        items.push(item);
      }
    }
    return { items, issues };
  }

  /** An .xlsx workbook, base64. An .xls or a non-workbook is refused in words, not read as empty. */
  async parseExcel(base64: string): Promise<WineExtractItem[]> {
    return (await this.readExcel(base64)).items;
  }

  /** `parseExcel`, plus every row it could not take whole and why. */
  async readExcel(
    base64: string,
  ): Promise<{ items: WineExtractItem[]; issues: CsvRowIssue[] }> {
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
    if (!worksheet || worksheet.rowCount < 2) return { items: [], issues: [] };

    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const v = this.cellValue(cell.value);
      headers[colNumber - 1] = typeof v === "object" ? "" : String(v);
    });
    const fieldMap = this.fieldMap(headers);
    const issues = this.headerIssues(headers, 1);
    if (!fieldMap.includes("name"))
      return {
        items: [],
        issues: [...issues, { row: 1, reason: "no_name_column" }],
      };

    const headerMarks = headers.map((h) => headerMoneyMark(h));
    const items: WineExtractItem[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header row
      const cols: Cell[] = [];
      // A stored number has no mark of its own: its cell's number format is
      // what the owner sees ("₺1.250,00"), else the header's money (r40 N1).
      const marks: Array<string | null> = [...headerMarks];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const shown = excelFormatMark(cell.numFmt);
        if (shown) marks[colNumber - 1] = shown;
        const v = this.cellValue(cell.value);
        if (typeof v !== "object") return void (cols[colNumber - 1] = v);
        // An error is left empty and said, for a column that is read.
        cols[colNumber - 1] = "";
        const field = fieldMap[colNumber - 1];
        if (field)
          issues.push({
            row: rowNumber,
            reason: "cell_error",
            field,
            raw: v.error,
          });
      });
      const item = this.buildItem(fieldMap, cols, rowNumber, issues, marks);
      if (item) {
        item.raw_text = cols.join(",");
        items.push(item);
      }
    });

    return { items, issues };
  }

  private fieldMap(headers: string[]): Array<keyof WineExtractItem | null> {
    const map = Array.from(
      headers,
      (h) => HEADER_MAP.get(headerKey(h ?? "")) ?? null,
    );
    const bare = this.barePriceRead(headers);
    if (bare !== null) map[bare] = "bottle_price";
    return map;
  }

  /**
   * The column a bare Price / Fiyat header is read from, or null. A file with
   * a single price column (the common menu sheet: name, price) was read with
   * every line unpriced (r28 G8). The FIRST bare price column is read as the
   * bottle price, and only when no column is already the bottle price; a glass
   * column beside it stays the glass price.
   */
  private barePriceRead(headers: string[]): number | null {
    const keys = Array.from(headers, (h) => headerKey(h ?? ""));
    if (keys.some((k) => HEADER_MAP.get(k) === "bottle_price")) return null;
    const at = keys.findIndex((k) => BARE_PRICE_HEADERS.has(k));
    return at === -1 ? null : at;
  }

  /** Each bare price header, said: the one read as the bottle price, and any other, not read. */
  private headerIssues(headers: string[], row: number): CsvRowIssue[] {
    const read = this.barePriceRead(headers);
    const issues: CsvRowIssue[] = [];
    Array.from(headers).forEach((h, i) => {
      if (!BARE_PRICE_HEADERS.has(headerKey(h ?? ""))) return;
      issues.push({
        row,
        reason: i === read ? "price_column_read_as_bottle" : "price_column_not_read",
        raw: (h ?? "").trim(),
      });
    });
    return issues;
  }

  /**
   * One ExcelJS cell value as read. A stored number stays a number (one
   * reading); a valid Date is its day, an invalid one comes back as
   * `{ error: "Invalid Date" }`; rich text is its joined plain text; a formula is its cached
   * result (none cached: empty); an error value comes back as `{ error }`
   * for the caller to note. No object is ever stringified ("[object Object]").
   */
  private cellValue(value: unknown): Cell | CellError {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return value;
    if (value instanceof Date)
      // A date-formatted serial past the calendar is an Invalid Date, and
      // toISOString throws on it: noted like an error cell, never a 500.
      return Number.isNaN(value.getTime())
        ? { error: "Invalid Date" }
        : value.toISOString().slice(0, 10);
    if (typeof value !== "object") return String(value);
    const v = value as Record<string, unknown>;
    if (typeof v.error === "string") return { error: v.error };
    if (Array.isArray(v.richText))
      return v.richText
        .map((r: { text?: unknown }) => String(r?.text ?? ""))
        .join("");
    if ("formula" in v || "sharedFormula" in v || "result" in v)
      return this.cellValue(v.result);
    if ("text" in v) return this.cellValue(v.text); // hyperlink
    return "";
  }

  /**
   * One row as a line. `marks` is each column's money as the file shows it
   * without the cell's own text (the header's, or an Excel cell's format);
   * a price cell's own mark ("€12") comes first (r40, r36 N1).
   *
   * The line's prices and the money they are in go together: the first money
   * a read price names is the line's `currency`, and a price cell with no mark
   * joins it. A price whose money is certainly another one (a "(EUR)" column
   * beside a "(TL)" one, or a second bottle column in another money, which was
   * never read before) is kept in `also_priced` under its own money. Nothing
   * converts here or anywhere: `menu-money.ts` takes the column in the house's
   * money, and holds a line printed only in another.
   */
  private buildItem(
    fieldMap: Array<keyof WineExtractItem | null>,
    cols: Cell[],
    row: number,
    issues: CsvRowIssue[],
    marks: ReadonlyArray<string | null> = [],
  ): WineExtractItem | null {
    const item: Partial<WineExtractItem> = {};
    const found: CsvRowIssue[] = [];

    fieldMap.forEach((field, colIdx) => {
      if (!field) return;
      const value = cols[colIdx];
      const isPrice = PRICE_FIELDS.has(field);
      if (!isPrice && item[field] !== undefined) return;
      if (!isPrice) {
        if (typeof value === "number") (item as any)[field] = String(value);
        else if ((value ?? "").trim()) (item as any)[field] = (value ?? "").trim();
        return;
      }
      const raw = typeof value === "number" ? "" : (value ?? "").trim();
      const mark = (raw ? cellMoneyMark(raw) : null) ?? marks[colIdx] ?? null;
      // A second column of a price the line already has is read only when it
      // is certainly in another money; any other is passed over, as before.
      const taken = item[field] !== undefined;
      const elsewhere = differentMoney(mark, item.currency);
      if (taken && !elsewhere) return;

      let amount: number | null = null;
      if (typeof value === "number") {
        if (Number.isFinite(value) && value >= 0) amount = value;
      } else if (raw) {
        const price = readMenuPrice(raw);
        if (price.amount !== null) amount = price.amount;
        else if (price.reason && price.reason !== "empty")
          found.push({ row, reason: price.reason, field, raw });
      }
      if (amount === null) return;

      if (!elsewhere) {
        (item as any)[field] = amount;
        if (mark && !item.currency) item.currency = mark;
        return;
      }
      const also = (item.also_priced ??= []);
      // `mark` names one money here (differentMoney said so): the column in that money, or a new one.
      let column = also.find((c) => oneMoneyOf(c.currency) === oneMoneyOf(mark));
      if (!column) also.push((column = { currency: mark! }));
      if (column[field as "bottle_price" | "by_glass_price"] === undefined)
        column[field as "bottle_price" | "by_glass_price"] = amount;
    });

    if (!item.name) {
      issues.push({ row, reason: "no_name" });
      return null;
    }
    issues.push(...found);
    return item as WineExtractItem;
  }
}
