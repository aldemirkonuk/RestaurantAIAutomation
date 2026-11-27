/**
 * THE CURRENT MENU AS THE SHEET THE READER ACCEPTS (menu r104 g3).
 *
 * A house that keeps its menu in a sheet could not get its current lines out,
 * edit them and read them back. This writes them with the column words
 * `CsvParserService` already reads (HEADER_MAP, csv-parser.service.ts), so the
 * same sheet read back with no edits is the same menu:
 *
 *   name, producer, vintage, region, grape_variety, category,
 *   by_glass_price, bottle_price
 *
 * `category` is the menu's section. The reader has no `currency` column at
 * this base (the house's money is named by the house, not by the file), so
 * none is written. A price is written with a dot decimal and no thousands
 * mark whatever the house's money: the reader keeps digits and dots only, so
 * a decimal comma would read as a hundredfold price.
 *
 * FORMULA INJECTION: a cell that starts with = + - or @ (or a tab or return)
 * is opened by a spreadsheet as a formula. Such a cell is written with a
 * leading apostrophe, which a spreadsheet shows as plain text.
 */

export const SHEET_COLUMNS = [
  "name",
  "producer",
  "vintage",
  "region",
  "grape_variety",
  "category",
  "by_glass_price",
  "bottle_price",
] as const;

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * `decimal: ","` is the decimal-comma dialect (tr-TR, de-DE, ...): a semicolon
 * between cells and a comma in a price ("62,5"), the way Excel saves a file in
 * such a locale. The default stays comma-between and dot-in-price. The reader
 * sniffs the delimiter and reads either price (menu-price.ts), so each dialect
 * reads back to the same cent. No thousands mark is written in either.
 */
export interface SheetDialect {
  decimal?: "." | ",";
}

const PRICE_COLUMNS = new Set<string>(["by_glass_price", "bottle_price"]);

export function sheetCell(value: unknown, delimiter = ","): string {
  if (value === null || value === undefined) return "";
  let s = String(value).replace(/[\r\n]+/g, " ");
  if (FORMULA_START.test(s)) s = `'${s}`;
  return s.includes('"') || s.includes(delimiter) || s.includes(",")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export function menuSheet(items: Array<Record<string, unknown>>, dialect: SheetDialect = {}): string {
  const comma = dialect.decimal === ",";
  const d = comma ? ";" : ",";
  const cell = (c: string, v: unknown) =>
    comma && PRICE_COLUMNS.has(c) && typeof v === "number" ? String(v).replace(".", ",") : sheetCell(v, d);
  const rows = items.map((it) => SHEET_COLUMNS.map((c) => cell(c, it[c])).join(d));
  return [SHEET_COLUMNS.join(d), ...rows].join("\r\n") + "\r\n";
}

/** The blank sheet: the header and one example line to overwrite. */
export function blankMenuSheet(): string {
  return `${SHEET_COLUMNS.join(",")}\r\nHouse red,,,,,Wine,12,48\r\n`;
}
