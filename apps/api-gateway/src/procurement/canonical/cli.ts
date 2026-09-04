/**
 * cli — run the canonical invariants over documents handed in on stdin.
 *
 *   cat corpus.json | npx ts-node -T src/procurement/canonical/cli.ts
 *
 * Input: a JSON array of `{ document, lines }`, where `document` is a
 * `procurement_documents` row and `lines` its `procurement_document_lines` rows,
 * exactly as they come back from PostgREST (numerics as strings).
 *
 * Output: one JSON object on stdout — `{ documents: [...], invariantSummary: {} }`.
 *
 * WHY A CLI AND NOT A PYTHON REIMPLEMENTATION. The TypeScript invariants are the
 * product; the corpus report must be produced by the SAME code the application
 * will run, or the report grades a second implementation and says nothing about
 * the first. `scripts/canonical_corpus_run.py` does the database reads (it holds
 * the service key) and pipes the rows through here.
 *
 * IT WRITES NOTHING. No database call, no file. Read-only by construction:
 * there is no supabase client in this file.
 */

import { canonicalFromParsedDocument } from "./from-parsed-document";
import { runInvariants, summarise } from "./canonical-invariants";
import { CanonicalDocument, Source } from "./canonical-types";
import { DocType, normalizeUom, Uom } from "../documents/document-types";
import { applyTieOut, ParsedDocument } from "../documents/parsed-document";

type Row = Record<string, unknown>;

const n = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const parsed = typeof v === "number" ? v : Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};
const s = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

function toParsed(document: Row, lines: Row[]): ParsedDocument {
  return applyTieOut({
    docType: (s(document.doc_type) ?? "unknown") as DocType,
    docNumber: s(document.doc_number),
    docDate: s(document.doc_date),
    referencesDocNumber: s(document.references_doc_number),
    poNumber: null,
    vendorName: null,
    vendorAccount: null,
    currency: s(document.currency) ?? "USD",
    subtotal: n(document.subtotal),
    freight: n(document.freight),
    fuelSurcharge: n(document.fuel_surcharge),
    splitCaseFee: n(document.split_case_fee),
    deliveryFee: n(document.delivery_fee),
    depositTotal: n(document.deposit_total),
    tax: n(document.tax),
    otherCharges: n(document.other_charges),
    discountTotal: n(document.discount_total),
    total: n(document.total),
    lines: lines.map((l) => ({
      lineNo: n(l.line_no) ?? 0,
      vendorSku: s(l.vendor_sku),
      description: s(l.description),
      vintage: n(l.vintage),
      formatMl: n(l.format_ml),
      qty: n(l.qty) ?? 0,
      uom: (normalizeUom(s(l.uom)) ?? "bottle") as Uom,
      packSize: n(l.pack_size) ?? 1,
      qtyBottles: n(l.qty_bottles) ?? 0,
      freeGoodsQty: n(l.free_goods_qty) ?? 0,
      unitPrice: n(l.unit_price),
      // BT-149/BT-150, persisted since migration 20260904120000. A row from a
      // database that predates it simply has neither key, which reads here as
      // null — the same answer as a document that printed no basis, and the
      // runner's own report says which of the two it was looking at.
      priceBaseQty: n(l.price_base_qty),
      priceBaseUom: normalizeUom(s(l.price_base_uom)),
      lineTotal: n(l.line_total),
      allowance: n(l.allowance),
      deposit: n(l.deposit),
      ...(l.printed ? { printed: l.printed as Record<string, string> } : {}),
    })),
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    confidence: n(document.extraction_confidence) ?? 0,
    warnings: [],
    extractionModel: s(document.extraction_model),
    ...(document.printed
      ? { printed: document.printed as Record<string, string> }
      : {}),
  });
}

function main(input: string): void {
  const corpus = JSON.parse(input) as { document: Row; lines: Row[] }[];

  const perInvariant: Record<
    string,
    { holds: number; fails: number; untestable: number }
  > = {};
  const documents: unknown[] = [];
  const namedFailures: unknown[] = [];

  for (const entry of corpus) {
    const doc = entry.document;
    const lines = entry.lines ?? [];
    const parsed = toParsed(doc, lines);
    const channel = s(doc.source_channel);
    const source: Source =
      channel === "edi" || channel === "sftp" ? "edi" : "extracted";

    const canonical: CanonicalDocument = canonicalFromParsedDocument(parsed, {
      documentId: s(doc.id) ?? "unknown",
      restaurantId: s(doc.restaurant_id) ?? "unknown",
      source,
      jurisdiction:
        doc.jurisdiction === "TR" ||
        doc.jurisdiction === "US-CA" ||
        doc.jurisdiction === "unknown"
          ? (doc.jurisdiction as "TR" | "US-CA" | "unknown")
          : null,
      direction:
        doc.direction === "issued_by_us" ? "issued_by_us" : "issued_by_vendor",
      providerId: s(doc.provider_id),
    });

    const results = runInvariants(canonical);
    for (const r of results) {
      const bucket = (perInvariant[r.id] ??= {
        holds: 0,
        fails: 0,
        untestable: 0,
      });
      if (r.holds === true) bucket.holds += 1;
      else if (r.holds === false) bucket.fails += 1;
      else bucket.untestable += 1;

      if (r.holds === false) {
        namedFailures.push({
          document_id: canonical.documentId,
          doc_type: canonical.docType,
          invariant: r.id,
          rule: r.rule,
          path: r.path,
          expected: r.expected,
          found: r.found,
          explanation: r.explanation,
        });
      }
    }

    documents.push({
      document_id: canonical.documentId,
      doc_type: canonical.docType,
      jurisdiction: canonical.jurisdiction,
      line_count: canonical.layer1.lines.length,
      summary: summarise(results),
    });
  }

  process.stdout.write(
    JSON.stringify(
      {
        documents_read: corpus.length,
        per_invariant: perInvariant,
        named_failures: namedFailures,
        documents,
      },
      null,
      2,
    ),
  );
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (buffer += chunk));
process.stdin.on("end", () => {
  try {
    main(buffer.trim() || "[]");
  } catch (err) {
    // A crash must not read as an empty corpus. Exit non-zero and say why.
    process.stderr.write(
      `canonical cli failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
});
