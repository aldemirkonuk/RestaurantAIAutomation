import { NfVerdict } from "../../common/model-client/nf-verdict.service";
import { ParsedDocument, tieOutToleranceCents } from "./parsed-document";

/**
 * The basis string written into every row this grader produces (OD-59).
 *
 * `_v1` is load-bearing. This grader proves ARITHMETIC CONSISTENCY, not
 * correctness: an extraction can tie out to the cent and still carry the wrong
 * vendor, the wrong date, or the wrong SKU. Naming the basis in the row is what
 * keeps a narrow verdict from silently becoming the definition of "done" — a
 * later, stricter grader (scenario truth, per OD-59's ownership line) takes a
 * NEW basis and lands beside this one rather than overwriting it.
 */
export const RECONCILIATION_BASIS = "reconciliation_v1";

/**
 * Grade one extracted document.
 *
 * Returns `null` when this grader has nothing to say, which is NOT the same as
 * a failing verdict — no row is written, and the event counts as ungraded in
 * `nf_a.doneability_verdict_coverage`. That distinction is the honest one: a
 * grader that judged only what it understands, and a coverage number that
 * admits how much that was.
 *
 * Scope is `docType === "invoice"` alone (founder decision, OD-59). Credit
 * memos and packing slips run the same tie-out arithmetic, but they are
 * different jobs, and one metric blending three jobs answers none of them.
 */
export function reconciliationVerdict(doc: ParsedDocument): NfVerdict | null {
  if (doc.docType !== "invoice") return null;

  const evidence: Record<string, unknown> = {
    doc_type: doc.docType,
    line_count: doc.lines.length,
    stated_total: doc.total,
    computed_lines_total: doc.computedLinesTotal,
    tie_out_delta: doc.tieOutDelta,
    tolerance_cents: tieOutToleranceCents(doc.lines.length),
  };

  // No stated total: the grader ran and the case is untestable. `outcome: null`
  // says exactly that, and it is deliberately distinct from writing no row —
  // "we looked and could not tell" is evidence; "we never looked" is a gap.
  if (doc.tiesOut === null) {
    return { outcome: null, evidence: { ...evidence, untestable: "no_total" } };
  }

  // An invoice that balances is the strongest machine-checkable evidence
  // available that the numbers were read correctly; one that does not is the
  // strongest available that at least one was misread.
  return { outcome: doc.tiesOut ? "success" : "failure", evidence };
}
