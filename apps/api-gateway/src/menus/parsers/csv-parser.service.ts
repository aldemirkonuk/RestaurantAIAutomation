import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { WineExtractItem } from "../wine-extract-item.interface";
import { MenuPriceReason, priceDoesNotFit, readMenuPrice } from "./menu-price";
import { looksLikeLegendMark, splitMarks } from "./printed-marks";
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
  // r108 menu-g10: the printed description, and an explicitly named marks column
  // read as the line's printed marks (split on , ; | /). A Notes/Not column is
  // NOT a marks column: it holds cost and supplier notes the member view withholds.
  ["description", "description desc aciklama tanim"],
  ["printed_marks", "marks printed_marks dietary allergens allergen isaretler"],
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
    /**
     * Not a row: the file's bytes are the same as a menu the house already
     * keeps (`raw` is that menu's status, `row` is 0). Said by the import.
     */
    | "same_file"
    /** Not a row: whether the file was read before could not be looked up (`row` is 0). */
    | "same_file_unchecked"
    /** The row has more cells than the header (an unquoted decimal comma): its prices are left blank. */
    | "more_cells_than_header"
    /** A quote opened here and never closed: that line stands alone. */
    | "unclosed_quote"
    | Exclude<MenuPriceReason, "empty">;
  field?: keyof WineExtractItem;
  raw?: string;
  /** The worksheet the row is on, said only when the workbook has more than one visible sheet. */
  sheet?: string;
}

type Cell = string | number;
/** An Excel error value (`#N/A`, `#REF!`, …), kept apart so it is noted, never read as text. */
type CellError = { error: string };

const PRICE_WORDS = new Set(["price", "fiyat", "fiyati"]);
/** The first of these in a header says which price it holds. */
const KIND_FIELDS: Record<string, keyof WineExtractItem> = {
  bottle: "bottle_price",
  sise: "bottle_price",
  glass: "by_glass_price",
  kadeh: "by_glass_price",
};
/** Words that may sit beside a kind or price word without changing what the column is: a size, a currency. */
const HEADER_FILLER =
  /^(?:per|tl|try|usd|eur|gbp|cl|ml|l|lt|oz|\d+(?:cl|ml|l|lt|oz)?)$/;
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

/**
 * The field a header names, or that it names a price it cannot place.
 * `Bottle 75cl` and `Şişe Fiyatı` are the bottle price; a bare `Fiyat (Şişe)`
 * takes its kind from the bracket; `Bottle Size`, `Price` and `Fiyat (TL)`
 * name no price field and are `note`d, never dropped silently.
 */
function readHeader(header: string): {
  field: keyof WineExtractItem | null;
  note: boolean;
} {
  const key = headerKey(header);
  const exact = HEADER_MAP.get(key);
  if (exact) return { field: exact, note: false };
  const tokens = key.split("_").filter(Boolean);
  const kindOf = (ts: string[]) => ts.find((t) => t in KIND_FIELDS);
  const kind = kindOf(tokens);
  const hasPrice = tokens.some((t) => PRICE_WORDS.has(t));
  if (kind) {
    const plain = tokens.every(
      (t) => t === kind || PRICE_WORDS.has(t) || HEADER_FILLER.test(t),
    );
    return plain
      ? { field: KIND_FIELDS[kind], note: false }
      : { field: null, note: true };
  }
  if (!hasPrice) return { field: null, note: false };
  const inner = (header.match(/\(([^)]*)\)|\[([^\]]*)\]/g) ?? [])
    .map((g) => kindOf(headerKey(g.slice(1, -1)).split("_")))
    .find(Boolean);
  return inner
    ? { field: KIND_FIELDS[inner], note: false }
    : { field: null, note: true };
}

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
    const read = readAllRecords(text, sniffDelimiter(text));
    const records = read.records.filter((r) =>
      r.cells.some((c) => c.trim().length > 0),
    );
    if (records.length < 2) return { items: [], issues: [] };

    const fieldMap = this.fieldMap(records[0].cells);
    const issues = this.headerIssues(records[0].cells, records[0].row);
    if (read.unclosedRow !== null)
      issues.push({ row: read.unclosedRow, reason: "unclosed_quote" });
    if (!fieldMap.includes("name"))
      return {
        items: [],
        issues: [...issues, { row: records[0].row, reason: "no_name_column" }],
      };

    // Cells past the header's last: an unquoted decimal comma (`12,50`) split
    // one price into two cells and shifted every price after it. Which cell is
    // which price is unknown, so the row's prices stay blank and it is said.
    const width = (cells: string[]) =>
      cells.reduce((w, c, i) => (c.trim() ? i + 1 : w), 0);
    const headerWidth = width(records[0].cells);

    const marks = records[0].cells.map((h) => headerMoneyMark(h));
    const items: WineExtractItem[] = [];
    for (const record of records.slice(1)) {
      const shifted = width(record.cells) > headerWidth;
      const item = this.buildItem(
        fieldMap,
        record.cells,
        record.row,
        issues,
        marks,
        shifted,
      );
      if (item && shifted)
        issues.push({
          row: record.row,
          reason: "more_cells_than_header",
          raw: record.raw.trim(),
        });
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

    // Every sheet the owner can see is read: a workbook with a Wines sheet and
    // a Cocktails sheet is one menu. A workbook of hidden sheets only is still
    // read (the file is what was sent).
    const visible = workbook.worksheets.filter((w) => w.state === "visible");
    const sheets = visible.length > 0 ? visible : workbook.worksheets;
    const items: WineExtractItem[] = [];
    const issues: CsvRowIssue[] = [];
    for (const worksheet of sheets) {
      const read = this.readSheet(worksheet);
      items.push(...read.items);
      // Line numbers restart on each sheet, so a note names its sheet when
      // the workbook has more than one.
      issues.push(
        ...(sheets.length > 1
          ? read.issues.map((i) => ({ ...i, sheet: worksheet.name }))
          : read.issues),
      );
    }
    return { items, issues };
  }

  /** One worksheet as lines: row 1 is the header. */
  private readSheet(worksheet: import("exceljs").Worksheet): {
    items: WineExtractItem[];
    issues: CsvRowIssue[];
  } {
    if (worksheet.rowCount < 2) return { items: [], issues: [] };

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
    // A header that names its kind (`Bottle 75cl`, `Fiyat (Şişe)`) is read by
    // readHeader (r106 #2104); the first bare Price / Fiyat is then the bottle
    // price when no column is (r28 G8). Integration 2026-11-27 joins both.
    const map = Array.from(headers, (h) => readHeader(h ?? "").field);
    const bare = this.barePriceRead(headers, map);
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
  private barePriceRead(
    headers: string[],
    map: Array<keyof WineExtractItem | null> = Array.from(headers, (h) => readHeader(h ?? "").field),
  ): number | null {
    if (map.includes("bottle_price")) return null;
    const at = Array.from(headers).findIndex(
      (h, i) => map[i] === null && PRICE_WORDS.has(headerKey(h ?? "")),
    );
    return at === -1 ? null : at;
  }

  /**
   * Each price header no field was read from, said: the bare one read as the
   * bottle price, and any other (a second bare price, `Bottle Size`,
   * `Fiyat (TL)` beside a bottle column) as not read.
   */
  private headerIssues(headers: string[], row: number): CsvRowIssue[] {
    const map = Array.from(headers, (h) => readHeader(h ?? "").field);
    const read = this.barePriceRead(headers, map);
    const issues: CsvRowIssue[] = [];
    Array.from(headers).forEach((h, i) => {
      if (i !== read && (map[i] !== null || !(PRICE_WORDS.has(headerKey(h ?? "")) || readHeader(h ?? "").note))) return;
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
    skipPrices = false,
  ): WineExtractItem | null {
    const item: Partial<WineExtractItem> = {};
    const found: CsvRowIssue[] = [];

    fieldMap.forEach((field, colIdx) => {
      if (!field) return;
      const value = cols[colIdx];
      const isPrice = PRICE_FIELDS.has(field);
      // A row wider than its header: which cell is which price is unknown (r106 #2104).
      if (skipPrices && isPrice) return;
      if (!isPrice && item[field] !== undefined) return;
      if (!isPrice) {
        // r108 menu-g10: a marks cell keeps only what reads as a printed legend mark.
        if (field === "printed_marks") {
          item.printed_marks = splitMarks(typeof value === "number" ? String(value) : (value ?? "").trim()).filter(looksLikeLegendMark);
          return;
        }
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
        if (Number.isFinite(value) && value >= 0) {
          const doesNot = priceDoesNotFit(value);
          if (doesNot) found.push({ row, reason: doesNot, field, raw: String(value) });
          else amount = value;
        } else if (Number.isFinite(value))
          found.push({ row, reason: "negative", field, raw: String(value) });
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
