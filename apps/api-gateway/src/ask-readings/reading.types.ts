/** Wire values are proof, not model-authored prose (ADR 0145). */
export type ReadingId =
  | "inventory.position" | "inventory.low_stock" | "inventory.in_transit"
  | "inventory.locations" | "inventory.movements" | "orders.open"
  | "orders.lines" | "orders.late_deliveries" | "receipts.verified_line"
  | "sales.check_activity" | "sales.consumption" | "calendar.upcoming"
  | "vendors.active" | "documents.waiting" | "goals.targets";

export type QuestionClass = ReadingId | "forecast" | "landed_cost" | "sales_revenue"
  | "lot_expiry" | "general_knowledge" | "unrecognized";
export type AskDisposition = { kind: "reading"; id: ReadingId } | { kind: "not_built" }
  | { kind: "model_knowledge" } | { kind: "no_reading_matched" };
export type ReadingOutcome = "read" | "not_in_your_books" | "requirements_unsatisfied"
  | "could_not_read" | "not_built" | "no_reading_matched" | "clarify";
export type ReadingReason = "empty_register" | "missing_subject" | "ambiguous_subject"
  | "subject_not_found" | "missing_window" | "invalid_window" | "missing_unit"
  | "missing_verified_link" | "missing_currency_provenance" | "missing_pack"
  | "query_failed" | "invalid_source_result" | "scope_mismatch" | "source_changed"
  | "source_limit" | "unrecorded_figure" | "unknown_reading_version"
  | "unsupported_recurrence" | "unimplemented_question" | "no_matching_question";
export type Provenance = "stated" | "defaulted" | "derived" | "not_recorded";
export interface ReadingArgs {
  subjectId?: string;
  subjectText?: string;
  from?: string;
  to?: string;
}
export interface SourceTrace {
  relation: string;
  operation: "select" | "rpc";
  outcome: "rows" | "empty" | "failed";
  rowsScanned: number | null;
  matchedRows: number | null;
  asOf: string;
  failureCode?: string;
}
export interface BoundCell {
  id: string;
  key: string;
  label: string;
  value: string | number | boolean | null;
  unit: string | null;
  source: "house";
  provenance: Provenance;
  sourceRelations: string[];
}
export interface FindingRow { key: string; cells: BoundCell[] }
export interface Finding {
  kind: "finding";
  readingId: ReadingId;
  readingVersion: number;
  args: ReadingArgs;
  outcome: ReadingOutcome;
  reason: ReadingReason | null;
  asOf: string;
  sourcesQueried: string[];
  failedSources: string[];
  rowsScanned: number | null;
  trace: SourceTrace[];
  rows: FindingRow[];
  choices?: Array<{ id: string; label: string }>;
  /** Stable across reads when the measured cells and their provenance agree. */
  fingerprint: string;
}
export interface ReadingDescriptor {
  id: ReadingId;
  version: 1;
  title: string;
  question: string;
  subject: "item" | "order" | "none";
  window: boolean;
  shelves: string[];
  meaning: string;
}
