import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { WineExtractItem } from "../wine-extract-item.interface";
import { XlsxRefusedError, assertXlsxWithinLimits } from "./xlsx-size-guard";

// Maps CSV/Excel header aliases → WineExtractItem field names. A header is
// read through normalizeMenuHeader first, so "Glass Price", "glass-price",
// "GLASS_PRICE" and an accented "Şişe Fiyatı" (→ sise_fiyati) each match one
// alias. A header not named here is NOT read: the read names it as ignored,
// and the web preview names it as skipped before anything is imported
// (F-017). The web keeps its own copy of these keys
// (apps/web/src/lib/menuColumns.ts), which a web test holds equal to this map.
//
// "price" alone (and the Turkish "fiyat") is deliberately absent: it does not
// say whether it is the glass or the bottle, and guessing would put a price on
// the wrong serve (sim-run reconcile, menu-import-a decision 2).
export const HEADER_MAP: Record<string, keyof WineExtractItem> = {
  name: "name",
  wine_name: "name",
  wine: "name",
  drink: "name",
  item: "name",
  ad: "name",
  adi: "name",
  isim: "name",
  urun: "name",
  urun_adi: "name",
  sarap: "name",
  sarap_adi: "name",
  producer: "producer",
  winery: "producer",
  vineyard: "producer",
  chateau: "producer",
  brand: "producer",
  uretici: "producer",
  marka: "producer",
  vintage: "vintage",
  year: "vintage",
  yil: "vintage",
  rekolte: "vintage",
  region: "region",
  appellation: "region",
  bolge: "region",
  grape: "grape_variety",
  variety: "grape_variety",
  grape_variety: "grape_variety",
  uzum: "grape_variety",
  category: "category",
  type: "category",
  kategori: "category",
  tur: "category",
  by_glass: "by_glass_price",
  by_the_glass: "by_glass_price",
  glass: "by_glass_price",
  pour: "by_glass_price",
  glass_price: "by_glass_price",
  by_glass_price: "by_glass_price",
  kadeh: "by_glass_price",
  kadeh_fiyati: "by_glass_price",
  bottle: "bottle_price",
  bottle_price: "bottle_price",
  sise: "bottle_price",
  sise_fiyati: "bottle_price",
};

/**
 * A header in HEADER_MAP's spelling: no byte-order mark (Excel's "CSV UTF-8"
 * export writes one, or the first column would never match), accents folded
 * ("Château" → chateau, "Şişe" → sise, dotless ı → i), lowercase, trimmed,
 * with runs of spaces or hyphens read as one underscore.
 */
export function normalizeMenuHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .trim()
    .replace(/[\s-]+/g, "_");
}

/** What a read kept back, so the proof can say it (F-017, F-683, F-684). */
export interface MenuReadNotes {
  /** Header text of every column that was not read. */
  ignoredColumns: string[];
  /** Rows that were skipped, and why. */
  dropped: Array<{ row: number; reason: string }>;
  /** Cells that could not be read ("row 4, column C: ..."). */
  unreadable: string[];
}

export interface MenuRead {
  items: WineExtractItem[];
  notes: MenuReadNotes;
  /** When no line was read: why, in the owner's words. Null when lines were read. */
  emptyCause: string | null;
}

type Cell = string | number;

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
 * digits at all ("MP", "—") is no price, as before. A price below zero
 * ("-45") is its own refusal (F-684): the old reader dropped the sign.
 *
 * F-947: `group` is the mark the file groups thousands with, when that is
 * known (see `fileGroupMark`). With it, "1.250" in a file that groups by "."
 * is 1250, and "1,250" in one that groups by "," is 1250; the other mark
 * followed by three digits is still refused.
 */
export type PriceReading =
  | { kind: "none" }
  | { kind: "price"; value: number }
  | { kind: "negative" }
  | { kind: "unclear" };

export type GroupMark = "." | ",";

/** Currency words and signs, and spaces (incl. no-break and thin) or apostrophes used to group thousands, carry no number. */
const bareNumber = (raw: string) =>
  raw.replace(/[\s\u00a0\u202f'’]/g, "").replace(/^[^0-9.,-]+|[^0-9.,]+$/g, "");

export function readPriceCell(
  raw: string,
  group: GroupMark | null = null,
): PriceReading {
  if (!/[0-9]/.test(raw)) return { kind: "none" };
  const s = bareNumber(raw);
  if (
    /^-[0-9.,]*[0-9]$/.test(s) &&
    readPriceCell(s.slice(1), group).kind === "price"
  ) {
    return { kind: "negative" };
  }
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
    if (!/^[0-9]{1,2}$/.test(frac) || !grouped(intPart, thou))
      return { kind: "unclear" };
    return value(`${intPart.split(thou).join("")}.${frac}`);
  }

  const mark = lastDot !== -1 ? "." : ",";
  const parts = s.split(mark);
  if (parts.length === 2 && /^[0-9]{1,2}$/.test(parts[1]) && parts[0] !== "") {
    return value(`${parts[0]}.${parts[1]}`);
  }
  if (parts.length > 2 && grouped(s, mark)) return value(parts.join(""));
  if (mark === group && grouped(s, mark)) return value(parts.join(""));
  return { kind: "unclear" };
}

/**
 * The mark a file's own price cells say it groups thousands with (F-947):
 * "1.250,00" and "12,50" say "."; "1,250.00" and "12.50" say ","; "1.250.000"
 * says ".". A cell that reads only one way is the evidence; "1.250" is none.
 * "conflict" when two cells disagree, null when no cell says.
 */
export function fileGroupMark(cells: string[]): GroupMark | "conflict" | null {
  const said = new Set<GroupMark>();
  for (const raw of cells) {
    if (readPriceCell(raw).kind !== "price") continue;
    const s = bareNumber(raw);
    const dot = s.lastIndexOf(".");
    const comma = s.lastIndexOf(",");
    if (dot === -1 && comma === -1) continue;
    if (dot !== -1 && comma !== -1) said.add(dot > comma ? "," : ".");
    else {
      const mark: GroupMark = dot !== -1 ? "." : ",";
      said.add(s.split(mark).length > 2 ? mark : mark === "." ? "," : ".");
    }
  }
  if (said.size > 1) return "conflict";
  return said.size === 1 ? [...said][0] : null;
}

@Injectable()
export class CsvParserService {
  private readonly logger = new Logger(CsvParserService.name);

  parse(csvContent: string): WineExtractItem[] {
    return this.read(csvContent).items;
  }

  async parseExcel(base64: string): Promise<WineExtractItem[]> {
    return (await this.readExcel(base64)).items;
  }

  /**
   * A CSV/TSV read, with what it kept back. The delimiter is the one the
   * header row uses most (`,`, `;` as Turkish Excel saves, or a tab), and a
   * quoted cell may hold the delimiter or a line break (F-684).
   */
  read(csvContent: string, houseGroup: GroupMark | null = null): MenuRead {
    const delimiter = sniffDelimiter(csvContent);
    const records = splitRecords(csvContent, delimiter).filter((r) =>
      r.cells.some((c) => c.trim() !== ""),
    );
    if (records.length < 2) {
      return this.nothing("The file has no rows under its column names.");
    }
    return this.readRows(
      records.map((r) => ({
        number: r.line,
        cells: r.cells,
        raw: r.raw.trim(),
      })),
      [],
      houseGroup,
    );
  }

  /**
   * Parses a real .xlsx workbook (binary, base64-encoded over the wire). The
   * first sheet that has a name column is read, so a cover sheet in front of
   * the list is passed over. A formula cell is read by its saved result and a
   * rich-text cell by its text (F-683); a cell with no readable value is named.
   */
  async readExcel(
    base64: string,
    houseGroup: GroupMark | null = null,
  ): Promise<MenuRead> {
    const ExcelJS = await import("exceljs");
    const buffer = Buffer.from(base64, "base64");
    const workbook = new ExcelJS.Workbook();
    const cannotOpen = () =>
      this.nothing(
        "We could not open this spreadsheet. If it is an older .xls file, save it as .xlsx or CSV and send it again.",
      );

    // F-475: size the archive before ExcelJS inflates it. A sub-1 MB zip bomb
    // used to take the gateway down for every house; now it is refused here.
    try {
      assertXlsxWithinLimits(buffer);
    } catch (err) {
      if (!(err instanceof XlsxRefusedError)) throw err;
      this.logger.warn(`Refused Excel workbook: ${err.detail}`);
      if (err.tooLarge) {
        throw new BadRequestException(
          "This spreadsheet is too big to read. Save the wine list on its own in a smaller file, or as a CSV, and try again. Nothing was imported.",
        );
      }
      return cannotOpen(); // not a workbook ExcelJS could open either
    }

    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch (err) {
      this.logger.warn(`Failed to parse Excel workbook: ${err.message}`);
      return cannotOpen();
    }

    let first: MenuRead | null = null;
    for (const worksheet of workbook.worksheets) {
      const rows: Row[] = [];
      const unreadable: string[] = [];
      worksheet.eachRow((row, rowNumber) => {
        const cells: Cell[] = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const read = readExcelValue(cell.value);
          if ("unreadable" in read) {
            unreadable.push(
              `row ${rowNumber}, column ${columnLetter(colNumber)}: ${read.unreadable}`,
            );
            cells[colNumber - 1] = "";
          } else {
            cells[colNumber - 1] = read.value;
          }
        });
        rows.push({ number: rowNumber, cells });
      });
      if (rows.length < 2) continue;
      const result = this.readRows(rows, unreadable, houseGroup);
      if (result.items.length > 0) return result;
      first ??= result;
    }
    return (
      first ??
      this.nothing("The spreadsheet has no rows under its column names.")
    );
  }

  /**
   * Reads rows whose header is within the first ten (a title above it is passed over).
   *
   * F-947: a price like "1.250" is read by the file's own marks when its other
   * prices settle them, else by the house's (`houseGroup`, from its country).
   * When the file's prices disagree with each other, neither is guessed.
   */
  private readRows(
    rows: Row[],
    unreadable: string[] = [],
    houseGroup: GroupMark | null = null,
  ): MenuRead {
    let headerAt = rows.findIndex(
      (r, i) => i < 10 && this.fieldMapFor(r.cells).includes("name"),
    );
    const found = headerAt !== -1;
    if (!found) headerAt = 0;
    const headerCells = rows[headerAt].cells.map((c) => String(c ?? "").trim());
    const fieldMap = this.fieldMapFor(headerCells);
    const notes: MenuReadNotes = {
      ignoredColumns: headerCells.filter((h, i) => h !== "" && !fieldMap[i]),
      dropped: [],
      unreadable: unreadable.filter((u) => rowOf(u) > rows[headerAt].number),
    };
    const unreadableRows = new Set(notes.unreadable.map(rowOf));
    if (!found) {
      const seen = headerCells.filter((h) => h !== "");
      return this.nothing(
        `We could not find a column for the drink's name. ` +
          (seen.length ? `The columns we saw were: ${seen.join(", ")}. ` : "") +
          `Call that column "Name" (and the prices "Bottle" and "Glass") and send it again.`,
        notes,
      );
    }

    const hasPriceColumn = fieldMap.some((f) => f && PRICE_FIELDS.has(f));
    const said = fileGroupMark(
      rows
        .slice(headerAt + 1)
        .flatMap((r) =>
          fieldMap.flatMap((f, i) =>
            f && PRICE_FIELDS.has(f) && typeof r.cells[i] === "string"
              ? [String(r.cells[i]).trim()]
              : [],
          ),
        ),
    );
    const group = said === "conflict" ? null : (said ?? houseGroup);
    const items: WineExtractItem[] = [];
    const unclear: string[] = [];
    const negative: string[] = [];
    for (const row of rows.slice(headerAt + 1)) {
      if (row.cells.every((c) => String(c ?? "").trim() === "")) continue;
      const item = this.buildItem(
        fieldMap,
        row.cells,
        row.number,
        unclear,
        negative,
        group,
      );
      if (!item) {
        notes.dropped.push({ row: row.number, reason: "no name" });
        continue;
      }
      // "KIRMIZI ŞARAPLAR,,," is a section heading, not a drink: a name and
      // nothing else, in a sheet that has prices (a row with a cell we could
      // not read is not one: it is kept, and the cell is named).
      const onlyName = Object.keys(item).every((k) => k === "name");
      if (hasPriceColumn && onlyName && !unreadableRows.has(row.number)) {
        notes.dropped.push({
          row: row.number,
          reason: `"${item.name}" looks like a heading (no price)`,
        });
        continue;
      }
      if (row.raw !== undefined) item.raw_text = row.raw;
      items.push(item);
    }

    this.refuseUnclear(unclear, negative);
    if (items.length === 0) {
      const counts = new Map<string, number>();
      for (const d of notes.dropped) {
        const why =
          d.reason === "no name"
            ? "had no name"
            : "looked like headings with no price";
        counts.set(why, (counts.get(why) ?? 0) + 1);
      }
      const said = [...counts].map(([why, n]) => `${n} ${why}`).join(", ");
      return this.nothing(
        said
          ? `Every row was skipped: ${said}.`
          : "The file has no rows under its column names.",
        notes,
      );
    }
    return { items, notes, emptyCause: null };
  }

  private fieldMapFor(cells: Cell[]): Array<keyof WineExtractItem | null> {
    return cells.map(
      (c) => HEADER_MAP[normalizeMenuHeader(String(c ?? ""))] ?? null,
    );
  }

  private nothing(
    cause: string,
    notes: MenuReadNotes = { ignoredColumns: [], dropped: [], unreadable: [] },
  ): MenuRead {
    return {
      items: [],
      notes,
      emptyCause: `Nothing was read from this file, so nothing was kept. ${cause}`,
    };
  }

  private buildItem(
    fieldMap: Array<keyof WineExtractItem | null>,
    cols: Cell[],
    rowNumber: number,
    unclear: string[],
    negative: string[],
    group: GroupMark | null = null,
  ): WineExtractItem | null {
    const item: Partial<WineExtractItem> = {};
    const unclearHere: string[] = [];
    const negativeHere: string[] = [];

    fieldMap.forEach((field, colIdx) => {
      if (!field) return;
      const cell = cols[colIdx];
      if (PRICE_FIELDS.has(field) && typeof cell === "number") {
        if (cell < 0) negativeHere.push(`“${cell}”`);
        else if (Number.isFinite(cell)) (item as any)[field] = cell;
        return;
      }
      const raw = String(cell ?? "").trim();
      if (!raw) return;

      if (PRICE_FIELDS.has(field)) {
        const read = readPriceCell(raw, group);
        if (read.kind === "price") (item as any)[field] = read.value;
        else if (read.kind === "negative") negativeHere.push(`“${raw}”`);
        else if (read.kind === "unclear") unclearHere.push(`“${raw}”`);
      } else {
        (item as any)[field] = raw;
      }
    });

    if (!item.name) return null;
    if (unclearHere.length > 0) {
      unclear.push(
        `row ${rowNumber} (${item.name}): ${unclearHere.join(", ")}`,
      );
    }
    if (negativeHere.length > 0) {
      negative.push(
        `row ${rowNumber} (${item.name}): ${negativeHere.join(", ")}`,
      );
    }
    return item as WineExtractItem;
  }

  /**
   * A price that could be off by a thousand, or is below zero, is not guessed.
   * The whole file is refused before anything is kept, with every cell named,
   * so the owner can fix the sheet and send it again.
   */
  private refuseUnclear(unclear: string[], negative: string[] = []): void {
    const name = (list: string[]) =>
      list.slice(0, 5).join("; ") +
      (list.length > 5 ? `; and ${list.length - 5} more` : "");
    if (negative.length > 0) {
      throw new BadRequestException(
        `A price can't be below zero, so nothing was imported. Check ${name(negative)}.`,
      );
    }
    if (unclear.length === 0) return;
    throw new BadRequestException(
      `Some prices in this file can be read more than one way, so nothing was imported. ` +
        `Check ${name(unclear)}. ` +
        `Write each price with no thousands mark, and a comma or a point only before the cents, like 1250 or 12,50.`,
    );
  }
}

interface Row {
  /** The row's number as the owner sees it in the sheet. */
  number: number;
  cells: Cell[];
  raw?: string;
}

/** The delimiter the header row uses most, outside quotes: `,`, `;` or a tab. */
export function sniffDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (counts[","] + counts[";"] + counts["\t"] > 0) break;
    } else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ",";
}

/**
 * Splits CSV text into records. A quoted cell may hold the delimiter or a
 * line break, and `""` inside quotes is one quote. `line` is the record's
 * first line in the file, the row number a spreadsheet shows.
 */
export function splitRecords(
  text: string,
  delimiter: string,
): Array<{ line: number; cells: string[]; raw: string }> {
  const out: Array<{ line: number; cells: string[]; raw: string }> = [];
  let cells: string[] = [];
  let current = "";
  let inQuotes = false;
  let line = 1;
  let startLine = 1;
  let startAt = 0;
  const end = (at: number) => {
    cells.push(current);
    out.push({ line: startLine, cells, raw: text.slice(startAt, at) });
    cells = [];
    current = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else {
        if (ch === "\n") line++;
        current += ch;
      }
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      cells.push(current);
      current = "";
    } else if (ch === "\n" || ch === "\r") {
      end(i);
      if (ch === "\r" && text[i + 1] === "\n") i++;
      line++;
      startLine = line;
      startAt = i + 1;
    } else current += ch;
  }
  if (current !== "" || cells.length > 0) end(text.length);
  return out;
}

/** An ExcelJS cell value as text or a number, or why it has none (F-683). */
function readExcelValue(
  value: unknown,
): { value: Cell } | { unreadable: string } {
  if (value === null || value === undefined) return { value: "" };
  if (typeof value === "number" || typeof value === "string") return { value };
  if (typeof value === "boolean") return { value: String(value) };
  if (value instanceof Date) return { value: value.toISOString().slice(0, 10) };
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.richText)) {
    return {
      value: (v.richText as Array<{ text?: string }>)
        .map((r) => r.text ?? "")
        .join(""),
    };
  }
  if ("formula" in v || "sharedFormula" in v) {
    if (v.result === undefined || v.result === null) {
      return {
        unreadable:
          "a formula with no saved value (open the file in Excel and save it again)",
      };
    }
    return readExcelValue(v.result);
  }
  if ("error" in v) return { unreadable: `the cell shows ${String(v.error)}` };
  if ("text" in v) return readExcelValue(v.text); // hyperlink: its text may be rich text
  return { unreadable: "a value we could not read" };
}

const rowOf = (note: string) => Number(/^row (\d+)/.exec(note)?.[1]);

function columnLetter(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
