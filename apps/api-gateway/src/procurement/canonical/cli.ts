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
import { parsedFromDocumentRows } from "./from-document-rows";
import { runInvariants, summarise } from "./canonical-invariants";
import { CanonicalDocument, Source } from "./canonical-types";

type Row = Record<string, unknown>;

const s = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/**
 * ONE MAPPING, SHARED WITH THE ROUTE.
 *
 * This used to be a second `toParsed` that never opened `extracted`, so the
 * runner could not see `vendorName`, `deliveredDate`, `taxBreakdown` or any
 * line's `lineKind` — and named `vat_breakdown_present` as FAILING on the very
 * documents whose page rendered the VAT row, and read a classified deposit line
 * as goods. `parsedFromDocumentRows` is what `CanonicalDocumentService` calls,
 * so the report now grades the code the product runs. That is this file's own
 * stated reason for existing, and it was not true until 2026-09-05.
 */
const toParsed = parsedFromDocumentRows;

export interface CorpusEntry {
  document: Row;
  lines: Row[];
}

export interface CorpusResult {
  documents_read: number;
  per_invariant: Record<
    string,
    { holds: number; fails: number; untestable: number }
  >;
  named_failures: {
    document_id: string;
    doc_type: string;
    invariant: string;
    rule: string | null;
    path: string | null;
    expected: unknown;
    found: unknown;
    explanation: string;
  }[];
  documents: unknown[];
}

/**
 * ONE document's canonical object, exactly as this CLI builds it.
 *
 * EXPORTED so `mapping-parity.spec.ts` can compare it with what
 * `CanonicalDocumentService` builds from the SAME rows. A parity test that
 * called the shared mapper directly would prove the mapper agrees with itself
 * and say nothing about whether this file still uses it.
 */
export function canonicalForRow(
  document: Row,
  lines: Row[],
): CanonicalDocument {
  const parsed = toParsed(document, lines ?? []);
  const channel = s(document.source_channel);
  const source: Source =
    channel === "edi" || channel === "sftp" ? "edi" : "extracted";

  return canonicalFromParsedDocument(parsed, {
    documentId: s(document.id) ?? "unknown",
    restaurantId: s(document.restaurant_id) ?? "unknown",
    source,
    jurisdiction:
      document.jurisdiction === "TR" ||
      document.jurisdiction === "US-CA" ||
      document.jurisdiction === "unknown"
        ? (document.jurisdiction as "TR" | "US-CA" | "unknown")
        : null,
    direction:
      document.direction === "issued_by_us"
        ? "issued_by_us"
        : "issued_by_vendor",
    providerId: s(document.provider_id),
  });
}

/**
 * The whole of what this CLI does, as a function.
 *
 * EXPORTED SO A TEST CAN CALL IT. The runner's mapping and the route's mapping
 * drifting apart is the defect this file's own doc comment warns about, and a
 * test that could only reach this code by spawning `npx ts-node` is a test
 * nobody runs.
 */
export function runCorpus(corpus: CorpusEntry[]): CorpusResult {
  const perInvariant: CorpusResult["per_invariant"] = {};
  const documents: unknown[] = [];
  const namedFailures: CorpusResult["named_failures"] = [];

  for (const entry of corpus) {
    const canonical = canonicalForRow(entry.document, entry.lines ?? []);

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

  return {
    documents_read: corpus.length,
    per_invariant: perInvariant,
    named_failures: namedFailures,
    documents,
  };
}

function main(input: string): void {
  const corpus = JSON.parse(input) as CorpusEntry[];
  process.stdout.write(JSON.stringify(runCorpus(corpus), null, 2));
}

/**
 * The stdin wrapper runs only when this file IS the entry point. Guarded so
 * that importing `runCorpus` from a test does not attach a stdin listener that
 * never ends and hangs the jest worker.
 */
const isEntryPoint = require.main === module;

let buffer = "";
if (isEntryPoint) {
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
}
