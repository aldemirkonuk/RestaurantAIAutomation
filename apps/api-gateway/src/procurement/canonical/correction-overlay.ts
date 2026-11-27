import { CORRECTABLE_PATHS, replayOnParsed, splitPath } from "./correctable-paths";
import { parsedFromDocumentRows } from "./from-document-rows";
import { ParsedDocument, ParsedLine } from "../documents/parsed-document";

/**
 * A correction is what the paper MEANS (ADR 0104 D5), so costing reads the
 * corrected paper, not the stored rows (r109, DD-r108-20).
 *
 * A correction writes `document_corrections` and `document_revisions`; costing
 * reads `procurement_document_lines` and `procurement_documents`. Before this
 * file the cost of a lot could not see a correction at all. This is the ONE
 * place a correction is turned back into the columns costing reads. Each field
 * is replayed through the same `toParsed` the canonical read uses (so a
 * corrected quantity or unit moves the bottle count exactly as the sheet
 * shows it), then copied onto its own columns and no others.
 */

type Copy = (doc: ParsedDocument, line: ParsedLine | null) => Record<string, unknown>;

/** Each field that moves a cost, and the columns it is copied onto. */
const COST_COLUMNS: Record<string, Copy> = {
  "lines[].quantity": (_d, l) => ({ qty: l?.qty, qty_bottles: l?.qtyBottles }),
  "lines[].unit": (_d, l) => ({ uom: l?.uom, qty_bottles: l?.qtyBottles }),
  "lines[].netPrice": (_d, l) => ({ unit_price: l?.unitPrice }),
  "lines[].priceBaseQuantity": (_d, l) => ({ price_base_qty: l?.priceBaseQty }),
  "lines[].priceBaseUnit": (_d, l) => ({ price_base_uom: l?.priceBaseUom }),
  "lines[].netAmount": (_d, l) => ({ line_total: l?.lineTotal }),
  "lines[].freeGoodsQty": (_d, l) => ({ free_goods_qty: l?.freeGoodsQty }),
  "lines[].formatMl": (_d, l) => ({ format_ml: l?.formatMl }),
  currency: (d) => ({ currency: d.currency || null }),
  "totals.linesNetTotal": (d) => ({ subtotal: d.subtotal }),
  "totals.taxAmount": (d) => ({ tax: d.tax }),
  "totals.taxInclusiveAmount": (d) => ({ total: d.total }),
};

/** True when a correction at `path` can move what a lot costs. */
export function movesCost(path: string): boolean {
  const p = splitPath(path);
  return !!p && p.template in COST_COLUMNS && !!CORRECTABLE_PATHS[p.template];
}

/** One `document_corrections` row, as costing reads it. */
export interface CorrectionRowLite {
  revision: number;
  kind: string | null;
  field_path: string;
  after: unknown;
}

/**
 * The paper's header and lines with its corrections laid over them.
 *
 * `lines` are THIS paper's rows; `lines[n]` is the n-th by `line_no`, as the
 * canonical read numbers them. Only a field a correction touched is replaced:
 * an untouched line or column comes back exactly as stored. `touched` says
 * whether anything was laid over at all.
 */
export function overlayCorrections<H extends Record<string, unknown>, L extends Record<string, unknown>>(
  header: H,
  lines: L[],
  corrections: CorrectionRowLite[],
): { header: H; lines: L[]; touched: boolean } {
  const cost = [...corrections]
    .filter((c) => c.kind == null || c.kind === "correction")
    .sort((a, b) => a.revision - b.revision)
    .map((c) => ({ c, p: splitPath(c.field_path) }))
    .filter((x) => x.p && x.p.template in COST_COLUMNS);
  if (!cost.length) return { header, lines, touched: false };

  const ordered = lines
    .map((row, i) => ({ row, i }))
    .sort((a, b) => Number(a.row.line_no ?? 0) - Number(b.row.line_no ?? 0) || a.i - b.i);
  let parsed = parsedFromDocumentRows(header, ordered.map((o) => o.row));
  const lineTouch = new Map<number, Set<string>>();
  const headTouch = new Set<string>();
  for (const { c, p } of cost) {
    const value = (c.after as { value?: unknown } | null)?.value ?? null;
    parsed = replayOnParsed(parsed, p!.template, p!.line, value);
    if (p!.line == null) headTouch.add(p!.template);
    else lineTouch.set(p!.line, (lineTouch.get(p!.line) ?? new Set<string>()).add(p!.template));
  }

  const outLines = [...lines];
  for (const [n, templates] of lineTouch) {
    const at = ordered[n];
    const line = parsed.lines[n];
    if (!at || !line) continue;
    let row: Record<string, unknown> = { ...at.row };
    for (const t of templates) row = { ...row, ...COST_COLUMNS[t](parsed, line) };
    outLines[at.i] = row as L;
  }
  let outHeader: Record<string, unknown> = { ...header };
  for (const t of headTouch) outHeader = { ...outHeader, ...COST_COLUMNS[t](parsed, null) };
  return { header: outHeader as H, lines: outLines, touched: true };
}
