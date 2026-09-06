import { DocType, normalizeUom, Uom } from "../documents/document-types";
import {
  applyTieOut,
  LINE_KINDS,
  LineKind,
  ParsedDocument,
  ParsedLine,
  ParsedTaxBreakdownRow,
} from "../documents/parsed-document";

/**
 * from-document-rows — the ONE way stored rows become a `ParsedDocument`.
 *
 * WHY THIS FILE EXISTS. There used to be two of them, and they disagreed.
 * `CanonicalDocumentService.toParsedDocument` read `vendorName`,
 * `deliveredDate`, `taxBreakdown` and every line's `lineKind` back out of the
 * `extracted` snapshot; `canonical/cli.ts` — the mapping
 * `scripts/canonical_corpus_run.py` runs — did not read `extracted` at all.
 * Measured 2026-09-05: the SAME document rendered a BG-23 VAT breakdown row on
 * the page and was named by the corpus runner as `vat_breakdown_present`
 * FAILING, and its deposit line was `deposit` on the page and `goods` in the
 * runner ("Line 4 reads as a deposit but is billed as a goods line"). A
 * document that passes on the page and fails in the report grades a second
 * implementation, which is the one thing the CLI's own doc comment says it
 * exists to prevent.
 *
 * So both callers now go through here. It is PURE: no database client, no file
 * access, no clock. It takes rows exactly as PostgREST returns them (numerics
 * as strings, jsonb as objects) and returns the parsed document, tie-out
 * applied.
 *
 * WHAT IT READS FROM `extracted`, AND WHY ONLY THAT.
 * `procurement_documents` has no vendor-name, delivered-date, VAT-breakdown or
 * line-kind column, so the intake snapshot is the ONLY place those four exist.
 * Everything else is read from the COLUMNS, because `editLine` corrects the
 * columns and does not rewrite the snapshot — reading a corrected field from
 * the snapshot would silently show the pre-correction value.
 */

/** A row as PostgREST hands it back. */
export type DocumentRowLike = Record<string, unknown>;
export type LineRowLike = Record<string, unknown>;

/** Postgres numerics arrive as strings through PostgREST. */
export const rowNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return null;
  const parsed = typeof v === "number" ? v : Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};

/** A non-empty string, or null. */
export const rowStr = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/** A trimmed string, or null. `"null"` is a model's word, not a value. */
function snapshotStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length && s.toLowerCase() !== "null" ? s : null;
}

function snapshotNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The document-level fields that live only in the `extracted` snapshot. */
export interface SnapshotOnlyFields {
  vendorName: string | null;
  deliveredDate: string | null;
  taxBreakdown: ParsedTaxBreakdownRow[] | undefined;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * The three document-level fields that live ONLY in the intake snapshot.
 *
 * Read defensively: the column is jsonb written by whatever parser ran, and a
 * row inserted before these fields existed simply has none of them. Every miss
 * is NULL, which is "the paper did not say" — the same answer a fresh
 * extraction gives, so the two are indistinguishable downstream, which is
 * correct. What must never happen is a THROW here taking down a document that
 * is otherwise perfectly readable.
 */
export function readSnapshot(extracted: unknown): SnapshotOnlyFields {
  const snap = asObject(extracted);
  if (!snap)
    return { vendorName: null, deliveredDate: null, taxBreakdown: undefined };

  const rawRows = snap.taxBreakdown;
  const taxBreakdown = Array.isArray(rawRows)
    ? rawRows
        .map((r): ParsedTaxBreakdownRow | null => {
          const row = asObject(r);
          if (!row) return null;
          const rate = snapshotNum(row.rate);
          if (rate === null) return null;
          const category = snapshotStr(row.category);
          return {
            rate,
            taxableBase: snapshotNum(row.taxableBase),
            amount: snapshotNum(row.amount),
            ...(category ? { category } : {}),
          };
        })
        .filter((r): r is ParsedTaxBreakdownRow => r !== null)
    : undefined;

  return {
    vendorName: snapshotStr(snap.vendorName),
    deliveredDate: snapshotStr(snap.deliveredDate),
    taxBreakdown,
  };
}

/**
 * `line_no` -> what that line IS, from the intake snapshot.
 *
 * Keyed on the line NUMBER, never on array position: the stored lines are read
 * back ordered by `line_no` and the snapshot's array is in the order the model
 * returned them, and those two can differ. An unrecognised label is dropped
 * rather than coerced, so the mapper's own `?? "goods"` fallback applies and
 * the classification is never invented here.
 */
export function snapshotLineKinds(extracted: unknown): Map<number, LineKind> {
  const out = new Map<number, LineKind>();
  const rows = asObject(extracted)?.lines;
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const row = asObject(r);
    if (!row) continue;
    const lineNo = snapshotNum(row.lineNo);
    const kind = snapshotStr(row.lineKind)?.toLowerCase() ?? null;
    if (
      lineNo === null ||
      kind === null ||
      !(LINE_KINDS as readonly string[]).includes(kind)
    )
      continue;
    out.set(lineNo, kind as LineKind);
  }
  return out;
}

/**
 * One stored document plus its line rows, as the parser would have produced it.
 *
 * `applyTieOut` recomputes computedLinesTotal / tieOutDelta / tiesOut from the
 * rows as they stand NOW, so a human's `editLine` correction is reflected
 * rather than the stored tie-out columns being trusted blind.
 */
export function parsedFromDocumentRows(
  document: DocumentRowLike,
  lineRows: LineRowLike[],
): ParsedDocument {
  const snapshot = readSnapshot(document.extracted);
  const kinds = snapshotLineKinds(document.extracted);

  const lines: ParsedLine[] = lineRows.map((l) => ({
    lineNo: rowNum(l.line_no) ?? 0,
    vendorSku: rowStr(l.vendor_sku),
    description: rowStr(l.description),
    vintage: rowNum(l.vintage),
    formatMl: rowNum(l.format_ml),
    qty: rowNum(l.qty) ?? 0,
    uom: (normalizeUom(rowStr(l.uom)) ?? "bottle") as Uom,
    packSize: rowNum(l.pack_size) ?? 1,
    qtyBottles: rowNum(l.qty_bottles) ?? 0,
    freeGoodsQty: rowNum(l.free_goods_qty) ?? 0,
    unitPrice: rowNum(l.unit_price),
    // BT-149 / BT-150, persisted since migration 20260904120000. NULL is still
    // the common answer and still means "the paper printed no basis" —
    // `lineNetFromPrice` reads that as "the price is per invoiced unit", which
    // is the only reading that does not invent a factor of twelve. A row from a
    // database that predates the migration simply has neither key, which reads
    // here as null too; the corpus report says which of the two it was looking
    // at.
    priceBaseQty: rowNum(l.price_base_qty),
    // Re-normalised rather than trusted: the column's CHECK allows the seven
    // singulars, but a row written before that constraint existed could hold
    // anything, and a unit we cannot read must be null, never guessed.
    priceBaseUom: normalizeUom(rowStr(l.price_base_uom)),
    lineTotal: rowNum(l.line_total),
    allowance: rowNum(l.allowance),
    deposit: rowNum(l.deposit),
    /**
     * `procurement_document_lines` has no `line_kind` column, so the
     * classification comes back from the intake snapshot, KEYED ON `line_no`
     * rather than on array position: a line added or reordered after intake
     * then simply has no snapshot entry and stays `goods`, which is "nobody
     * classified it" — never a confident claim that a CRV row is wine.
     */
    lineKind: kinds.get(rowNum(l.line_no) ?? 0) ?? null,
    // ABSENT means we never kept the literals. It never means the paper was
    // blank — which is why this is a conditional spread and not `?? {}`.
    ...(l.printed ? { printed: l.printed as Record<string, string> } : {}),
  }));

  return applyTieOut({
    docType: (rowStr(document.doc_type) ?? "unknown") as DocType,
    docNumber: rowStr(document.doc_number),
    docDate: rowStr(document.doc_date),
    // BT-72 and BG-4's name have no columns; they exist only in the intake
    // snapshot, which is why they reached the screen as "—" and "The seller is
    // not named on this document" on every document read 2026-09-04.
    deliveredDate: snapshot.deliveredDate,
    referencesDocNumber: rowStr(document.references_doc_number),
    poNumber: null,
    vendorName: snapshot.vendorName,
    vendorAccount: null,
    /*
     * WHAT THE ROW SAYS, or nothing — never `USD`.
     *
     * This read `?? "USD"` until 2026-09-06, and the founder's currency
     * decision that day turned it from a latent defect into a live one: rules 1
     * and 2 (`documents/invoice-currency.ts`) now write `currency = NULL` on
     * every document whose money was REFUSED (neither the paper nor the house
     * states a currency) or HELD (the model saw a different one). Read back
     * through a `?? "USD"`, every one of those would reappear on the canonical
     * face denominated in dollars — the exact claim the withholding exists to
     * refuse, reconstructed one layer down.
     *
     * The empty string is what `canonical-invariants`' `str()` already reads as
     * absent, so BR-5 reports "not testable: this document states no money at
     * all" rather than asserting a currency nobody stated.
     */
    currency: rowStr(document.currency) ?? "",
    subtotal: rowNum(document.subtotal),
    freight: rowNum(document.freight),
    fuelSurcharge: rowNum(document.fuel_surcharge),
    splitCaseFee: rowNum(document.split_case_fee),
    deliveryFee: rowNum(document.delivery_fee),
    depositTotal: rowNum(document.deposit_total),
    tax: rowNum(document.tax),
    otherCharges: rowNum(document.other_charges),
    discountTotal: rowNum(document.discount_total),
    total: rowNum(document.total),
    // BG-23. ABSENT (undefined) means no breakdown was ever read; an EMPTY
    // array means the extraction looked and the page printed no rate. The
    // mapper renders both as no rows, but only the second is a finding about
    // the document rather than about our reading of it.
    ...(snapshot.taxBreakdown ? { taxBreakdown: snapshot.taxBreakdown } : {}),
    lines,
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    confidence: rowNum(document.extraction_confidence) ?? 0,
    warnings: [],
    extractionModel: rowStr(document.extraction_model),
    ...(document.printed
      ? { printed: document.printed as Record<string, string> }
      : {}),
  });
}
