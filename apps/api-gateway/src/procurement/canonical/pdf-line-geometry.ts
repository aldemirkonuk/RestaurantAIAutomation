/**
 * Where each read line sits on the paper — for a PDF only, and only as a
 * CITATION (ADR 0104: a box is evidence, never an estimate).
 *
 * After the model has read the document, this takes the PDF's own text layer
 * (pdfjs-dist) and looks for the one text ROW that holds both
 *   1. the line's amount, printed in the paper's own number format, and
 *   2. at least one description token of three or more letters or digits.
 * Exactly one such row on the whole document gives the line `{page, bbox}`,
 * with bbox = [x0, y0, x1, y1] in 0..1 of the page, y measured from the top.
 * Zero rows, several rows, a photo, a scan with no text layer, or a PDF the
 * library cannot open all give null — "no position kept" is the honest answer
 * and the pane already says so.
 *
 * REJECTED (recorded here so it is not rediscovered): model-proposed boxes
 * (approximate, so not a citation), server OCR for photos (a heavy dependency,
 * weak on thermal receipts), and matching on the client (one more signed
 * download per open).
 *
 * pdfjs-dist runs in a child process (see `CHILD` below).
 */

import { spawn } from "node:child_process";


export interface LineGeometry {
  page: number;
  bbox: [number, number, number, number];
}

/** What matching needs from a line. `printed` is the paper's own glyphs. */
export interface GeometryLine {
  lineNo: number;
  description?: string | null;
  lineTotal?: number | null;
  printed?: { lineTotal?: string | null } | null;
}

/** One text row on a page, already in 0..1 page space (y from the top). */
export interface TextRow {
  page: number;
  text: string;
  bbox: [number, number, number, number];
}

interface RawItem {
  str: string;
  /** Viewport-space rectangle, pixels from the top-left of the page. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const CENT = 0.005;

/** Group text items into rows: same baseline band, left to right. */
export function rowsFromItems(
  page: number,
  width: number,
  height: number,
  items: RawItem[],
): TextRow[] {
  const live = items
    .filter((i) => i.str.trim().length > 0 && width > 0 && height > 0)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const groups: RawItem[][] = [];
  for (const it of live) {
    const g = groups.find((grp) => {
      const top = Math.min(...grp.map((i) => i.y0));
      const bottom = Math.max(...grp.map((i) => i.y1));
      const mid = (it.y0 + it.y1) / 2;
      return mid > top && mid < bottom;
    });
    if (g) g.push(it);
    else groups.push([it]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x0 - b.x0);
    const x0 = Math.min(...g.map((i) => i.x0));
    const y0 = Math.min(...g.map((i) => i.y0));
    const x1 = Math.max(...g.map((i) => i.x1));
    const y1 = Math.max(...g.map((i) => i.y1));
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return {
      page,
      text: g.map((i) => i.str.trim()).join(" "),
      bbox: [
        clamp(x0 / width),
        clamp(y0 / height),
        clamp(x1 / width),
        clamp(y1 / height),
      ],
    };
  });
}

const US = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
const EU = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;

/** The values a printed token can mean, in either number format. */
function readings(token: string): number[] {
  const out: number[] = [];
  if (US.test(token)) out.push(Number(token.replace(/,/g, "")));
  if (EU.test(token)) out.push(Number(token.replace(/\./g, "").replace(",", ".")));
  return out.filter((n) => Number.isFinite(n));
}

const stripCurrency = (s: string) =>
  s.replace(/[^\d.,\-]/g, " ").trim().split(/\s+/).filter(Boolean);

/** Does this row print the line's amount? Prefers the paper's own glyphs. */
function rowHasAmount(row: TextRow, line: GeometryLine): boolean {
  const printed = line.printed?.lineTotal?.trim();
  const tokens = row.text.split(/\s+/).flatMap((t) => stripCurrency(t));
  if (printed) {
    const want = stripCurrency(printed)[0];
    if (want && tokens.includes(want)) return true;
  }
  if (line.lineTotal == null || !Number.isFinite(line.lineTotal)) return false;
  const amount = line.lineTotal;
  return tokens.some((t) =>
    readings(t).some((v) => Math.abs(v - amount) < CENT),
  );
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (s: string) =>
  fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

function rowHasDescription(row: TextRow, line: GeometryLine): boolean {
  const want = words(line.description ?? "").filter((w) => w.length >= 3);
  if (!want.length) return false;
  const have = new Set(words(row.text));
  return want.some((w) => have.has(w));
}

/**
 * The pure half: rows in, one result per line out. A line is boxed only when
 * exactly ONE row in the whole document holds both its amount and a description
 * token; two matching rows (even on different pages) leave it null.
 */
export function matchLineGeometry(
  rows: TextRow[],
  lines: GeometryLine[],
): Map<number, LineGeometry | null> {
  const out = new Map<number, LineGeometry | null>();
  for (const line of lines) {
    const hits = rows.filter(
      (r) => rowHasAmount(r, line) && rowHasDescription(r, line),
    );
    out.set(
      line.lineNo,
      hits.length === 1 ? { page: hits[0].page, bbox: hits[0].bbox } : null,
    );
  }
  return out;
}

/**
 * pdfjs runs in a CHILD node process, not in the gateway.
 *
 * Two reasons. A PDF is untrusted input and pdfjs has a CVE history
 * (CVE-2024-4367, GHSA-hq66-cqwq-w95j): parsing it in a process that holds the
 * service-role key is the wrong place, and a child can be killed on a timeout.
 * And pdfjs-dist is ESM only while the gateway compiles to CommonJS on Node 20,
 * where a native `import()` is the only way in; a child sidesteps that for the
 * gateway and for Jest alike.
 *
 * The child reads the PDF from stdin and writes one JSON document to stdout:
 * `[{width, height, items: [{str, x0, y0, x1, y1}]}]`, per page, in
 * top-left pixel space (the page's own view matrix applied).
 */
const CHILD = `
import { pathToFileURL } from "node:url";
// pdfjs 5 touches these browser classes at load for RENDERING, which this
// never does; stubs spare a native canvas dependency in the gateway image.
for (const k of ["DOMMatrix", "ImageData", "Path2D"])
  globalThis[k] ??= class {};
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const pdfjs = await import(pathToFileURL(process.argv[1]).href);
const task = pdfjs.getDocument({
  data: new Uint8Array(Buffer.concat(chunks)),
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  verbosity: 0,
});
const doc = await task.promise;
const pages = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    if (typeof it.str !== "string") continue;
    const [ax, ay] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const [bx, by] = vp.convertToViewportPoint(
      it.transform[4] + it.width,
      it.transform[5] + it.height,
    );
    items.push({
      str: it.str,
      x0: Math.min(ax, bx),
      x1: Math.max(ax, bx),
      y0: Math.min(ay, by),
      y1: Math.max(ay, by),
    });
  }
  pages.push({ width: vp.width, height: vp.height, items });
}
await task.destroy();
process.stdout.write(JSON.stringify(pages));
`;

/** A PDF that takes longer than this to read is treated as unreadable. */
export const PDF_READ_TIMEOUT_MS = 10_000;

/** Every page's text rows, or null when the bytes are not a readable PDF. */
export async function readPdfRows(
  bytes: Uint8Array,
): Promise<TextRow[] | null> {
  let entry: string;
  try {
    entry = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    return null;
  }
  const stdout = await new Promise<string | null>((resolve) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", CHILD, entry],
      { stdio: ["pipe", "pipe", "ignore"], timeout: PDF_READ_TIMEOUT_MS },
    );
    const out: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.on("error", () => resolve(null));
    child.on("close", (code) =>
      resolve(code === 0 ? Buffer.concat(out).toString("utf8") : null),
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(Buffer.from(bytes));
  });
  if (!stdout) return null;
  try {
    const pages = JSON.parse(stdout) as Array<{
      width: number;
      height: number;
      items: RawItem[];
    }>;
    return pages.flatMap((p, i) =>
      rowsFromItems(i + 1, p.width, p.height, p.items),
    );
  } catch {
    return null;
  }
}

/**
 * The whole step. Never throws: a failure is the same as "no position kept",
 * and a document with no geometry reads exactly as it did before this existed.
 */
export async function lineGeometryForPdf(
  bytes: Uint8Array,
  lines: GeometryLine[],
): Promise<Map<number, LineGeometry | null>> {
  const rows = await readPdfRows(bytes);
  if (!rows) return new Map(lines.map((l) => [l.lineNo, null]));
  return matchLineGeometry(rows, lines);
}
