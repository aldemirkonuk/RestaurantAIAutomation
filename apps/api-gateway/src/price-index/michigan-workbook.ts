/**
 * The thin adapter that turns an uploaded MLCC workbook into rows.
 *
 * Deliberately separate from `parse-michigan.ts`: the parser stays pure and
 * testable against a recorded fixture, and everything that depends on a binary
 * and a third-party library lives here where it can be exercised on its own.
 *
 * `exceljs` is already a dependency of this gateway — `menus/parsers/
 * csv-parser.service.ts` uses it for menu uploads — and it is imported the same
 * way, dynamically, so the workbook code loads only when someone actually
 * uploads a book. **No new dependency was added for Michigan.**
 */

/** 12 columns, as the MLCC publishes them. See `parse-michigan.ts`. */
const EXPECTED_COLUMNS = 12;

/**
 * A hard ceiling on what will be decoded. The real book is 804 kB of xlsx (the
 * 2025-08-03 edition, measured), so 12 MB leaves room for it to grow by an
 * order of magnitude and still refuses a file that is plainly not one. A cap
 * enforced only after decoding is not a cap, so it is checked against the
 * base64 length first.
 */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export class WorkbookError extends Error {}

/** Approximate decoded size of a base64 payload, without decoding it. */
export function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/**
 * One exceljs cell -> a plain value the parser understands.
 *
 * Numbers stay numbers, because the parser's ratio band depends on it;
 * everything else becomes a string or null. A formula cell gives up its cached
 * result, never its formula text.
 */
export function cellValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.richText)) {
    const text = (obj.richText as Array<{ text?: string }>)
      .map((r) => r.text ?? "")
      .join("");
    return text.trim() === "" ? null : text;
  }
  if ("result" in obj) return cellValue(obj.result);
  if ("text" in obj) return cellValue(obj.text);
  return null;
}

/**
 * Read an uploaded .xlsx into rows of twelve cells.
 *
 * Throws rather than returning an empty list: a workbook that cannot be read is
 * an error the uploader has to see, not an empty register that reads as "the
 * book has nothing in it".
 */
export async function michiganRowsFromWorkbook(
  buffer: Buffer,
): Promise<{ sheetName: string; rows: Array<Array<string | number | null>> }> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (err) {
    throw new WorkbookError(
      `the uploaded file could not be opened as an Excel workbook: ${(err as Error).message}`,
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new WorkbookError("the uploaded workbook has no worksheet");
  }
  const rows: Array<Array<string | number | null>> = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: Array<string | number | null> = [];
    for (let c = 1; c <= EXPECTED_COLUMNS; c += 1) {
      cells.push(cellValue(row.getCell(c).value));
    }
    rows.push(cells);
  });
  if (rows.length === 0) {
    throw new WorkbookError("the uploaded workbook's first sheet has no rows");
  }
  return { sheetName: sheet.name, rows };
}
