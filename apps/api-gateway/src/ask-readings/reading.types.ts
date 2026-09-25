import { Role } from "../auth/guards/roles.guard";
import type { DataClass } from "./reading-data-classes";

/** Wire values are proof, not model-authored prose (ADR 0145). */
export type ReadingId =
  | "inventory.position" | "inventory.low_stock" | "inventory.in_transit"
  | "inventory.locations" | "inventory.movements" | "orders.open"
  | "orders.lines" | "orders.late_deliveries" | "receipts.verified_line"
  | "sales.check_activity" | "sales.consumption" | "calendar.upcoming"
  | "vendors.active" | "documents.waiting" | "goals.targets" | "orders.due_today";

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
  | "unsupported_recurrence" | "unimplemented_question" | "no_matching_question"
  | "undeclared_field"
  /**
   * A source did not answer, and WHY is withheld from the asking role (founder,
   * 2026-09-21, round 6r, his pick verbatim: "J4 wins, hide size
   * (Recommended)"). The reasons a read can fail include `source_limit`, which
   * says the relation holds more than 20,000 rows -- a size. So for a role whose
   * failure detail is `source_only` (`FAILURE_DETAIL`, reading-data-classes.ts)
   * every `could_not_read` reason becomes this one, and the reply carries a
   * one-line "couldn't read ... right now" instead.
   */
  | "withheld_for_your_role";
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
/**
 * A trace count the asking role may not read (founder, 2026-09-21, round 6,
 * "Hide by data type"): a table's row count is shown only to a role whose
 * policy row sees that table's class (`relation.*` in FIELD_CLASS). Withheld
 * is said, never written as 0 or as null -- null already means a read failed.
 */
export const WITHHELD_FOR_YOUR_ROLE = "withheld_for_your_role" as const;
export type WithheldCount = typeof WITHHELD_FOR_YOUR_ROLE;
/** A read whose count is withheld. `rows` versus `empty` is a count too, so it goes as well. */
export interface WithheldSourceTrace {
  relation: string;
  operation: "select" | "rpc";
  outcome: "withheld";
  rowsScanned: WithheldCount;
  matchedRows: WithheldCount;
  asOf: string;
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
  /**
   * Withheld with the reason (round 6r): which sources FAILED separates a query
   * that failed (one failed source) from a relation over the row limit (none).
   */
  failedSources: string[] | WithheldCount;
  /** Withheld whenever any trace count is withheld: a total would let the hidden one be subtracted out. */
  rowsScanned: number | null | WithheldCount;
  trace: Array<SourceTrace | WithheldSourceTrace>;
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
  /**
   * Every `relation.column` this Reading can put in a cell (`relation.*` is a
   * row count of that relation), plus -- added by `shownFields` -- the label
   * its subject matches are listed by. Each carries a data class
   * (`reading-data-classes.ts`); the runner refuses to mint a cell from a
   * field that is not declared here (`undeclared_field`), and
   * `scripts/check_ask_field_classes.py` fails CI on a field the runner shows
   * that this list does not name.
   */
  shows: readonly string[];
  /** DERIVED from `shows`: the data classes this Reading's answer carries. */
  classes: readonly DataClass[];
  /**
   * Who may receive this reading's ANSWER (not just see it named in the
   * catalogue). Required, never defaulted -- an omitted field silently
   * meaning "open to everyone" is exactly the kind of unstated assumption
   * this file's other types refuse to allow (Provenance, ReadingOutcome).
   *
   * Founder, batch 4, 2026-09-19, his words: "do not give money or sensitive
   * incentives like sales etc to the staff, maybe we should exclude staff
   * from this equation" -> price, vendor, open-order and sales readings are
   * owner and manager only, enforced server-side per reading (see
   * `isReadingAllowedForRole` in reading-catalogue.ts). Every other reading
   * carries `["owner", "manager", "staff"]`, unchanged from today's
   * behaviour. Whether staff may reach `/ask` AT ALL is a separate, still
   * OPEN question (his leaning is to exclude them; to be confirmed with the
   * `/ask` sketch) -- this field narrows individual readings and does not
   * answer that.
   *
   * [ANSWERED 2026-09-21, founder round 5 -- recorded answer, not a
   * quotation: the posted-targets reading (`goals.targets`) is owner/manager
   * only too, a money measure. Seven readings now carry
   * `OWNER_MANAGER_ONLY`, not six. Recorded in ADR 0145's 2026-09-21
   * goals.targets amendment. The "whether staff reach `/ask` at all" question above is
   * UNCHANGED by this answer and stays open.]
   *
   * [DERIVED since 2026-09-21, founder's option "Rules in code, label rows":
   * never hand-set. It is the ROLE_POLICY rows that see every class in
   * `classes` and may be given a Reading (`reading-catalogue.ts`
   * `READING_CATALOGUE`). The seven/eight split above is what that derivation
   * produces today, and the CI guard fails if it stops producing it.]
   *
   * [ANSWERED 2026-09-21, founder round 6, his pick verbatim: "Yes, own-work
   * only" -- staff reach `/ask`, and see stock, receiving and today's
   * deliveries. The calendar (people) left the staff set and today's
   * deliveries (`orders.due_today`) joined it: eight restricted, eight open.]
   */
  allowedRoles: readonly Role[];
}
