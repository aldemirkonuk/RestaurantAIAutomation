import { isReadingId } from "./reading-catalogue";
import {
  ANSWER_KINDS,
  AnswerKind,
  CLASS_LABEL,
  ClassifiedUnbuiltQuestion,
  DATA_CLASSES,
  DataClass,
  FailureDetail,
  unbuiltClassOf,
  withholdFailureDetail,
} from "./reading-data-classes";
import { Finding, ReadingId, ReadingOutcome, ReadingReason, WITHHELD_FOR_YOUR_ROLE } from "./reading.types";

declare const knowledgeText: unique symbol;
export type ModelKnowledgeText = string & { readonly [knowledgeText]: true };

/**
 * Why the MODEL side of an ask produced no answer. These are never a fact about
 * the house's books, so they never share a type with `could_not_read` (a source
 * that did not answer) or `not_in_your_books` (a register with no rows):
 *
 *   model_unavailable   the call failed or timed out; nothing came back
 *   spend_ceiling       the house's daily AI allowance refused the first call;
 *                       nothing was sent and nothing was charged
 *   invalid_model_reply the model answered, and the answer failed validation
 *                       (not JSON, truncated, an unknown class, an argument that
 *                       is not a span of the question, a cell not in the Finding)
 *
 * ADR 0145's mechanism is that different causes are different reply types; the
 * first build folded all three into `could_not_read / query_failed` with zero
 * sources queried (KL audit J5, 2026-09-17).
 */
export type ModelFailureReason =
  | "model_unavailable"
  | "spend_ceiling"
  | "invalid_model_reply"
  | "role_share_used"
  | "allowance_unreadable";
/**
 * `role_share_used`      the asker's ROLE_POLICY row has spent its share of
 *                        today's house allowance; nothing was sent.
 * `allowance_unreadable` a share below the whole allowance could not be
 *                        checked because the ledger did not answer; refused,
 *                        never read as "nothing spent" (2026-09-21).
 */
export const MODEL_FAILURE_REASONS: readonly ModelFailureReason[] = [
  "model_unavailable",
  "spend_ceiling",
  "invalid_model_reply",
  "role_share_used",
  "allowance_unreadable",
];

/**
 * Why a Reading the caller's ROLE refused never reached the books. This is
 * never a fact about the house's data (never `not_in_your_books` /
 * `could_not_read`) and never a model-side failure (never
 * `could_not_answer`) -- it is a fact about who is asking, decided before
 * the runner is ever constructed (founder, batch 4, 2026-09-19: "do not
 * give money or sensitive incentives like sales etc to the staff"). A role
 * refusal never carries a Finding: the books were never queried.
 */
export type RoleRestrictedReason = "class_not_visible" | "answer_kind_not_permitted";
/**
 * [REBUILT 2026-09-21, founder's option "Rules in code, label rows": the one
 * reason `owner_manager_only` became two, because the gate is now a policy
 * table rather than a fixed role pair. `class_not_visible` names the data
 * classes the role's row does not see; `answer_kind_not_permitted` names the
 * answer kind (a Reading, or model knowledge) the row is not given.]
 */
export const ROLE_RESTRICTED_REASONS: readonly RoleRestrictedReason[] = ["class_not_visible", "answer_kind_not_permitted"];

type CellId = Finding["rows"][number]["cells"][number]["id"];
export type BoundReply =
  | { kind: "reading"; finding: Finding; focus: Array<{ cellId: CellId }> }
  | {
      kind: "model_knowledge";
      source: "model_knowledge";
      sourceLabel: "Not from the house's books";
      text: ModelKnowledgeText;
    }
  | { kind: "could_not_answer"; reason: ModelFailureReason; finding?: Finding }
  | { kind: "not_permitted"; reason: "class_not_visible"; readingId: ReadingId; classes: DataClass[]; line: string }
  /** An unbuilt question class whose data class the role does not see (round 6r, "Classify now"). */
  | { kind: "not_permitted"; reason: "class_not_visible"; questionClass: ClassifiedUnbuiltQuestion; classes: DataClass[]; line: string }
  | { kind: "not_permitted"; reason: "answer_kind_not_permitted"; answerKind: AnswerKind; readingId?: ReadingId; line: string }
  /**
   * `line` is present when the reply is shaped for a `source_only` role
   * (round 6r): the one line a person is told when the reason is withheld
   * (`could_not_read`) or when an empty register carries no cells
   * (`not_in_your_books`). A withheld reason never travels without it.
   */
  | { kind: Exclude<ReadingOutcome, "read">; reason: ReadingReason; finding?: Finding; line?: string };

const KNOWLEDGE_LABEL = "Not from the house's books";
const NON_READING_KINDS: ReadonlyArray<Exclude<ReadingOutcome, "read">> = [
  "clarify",
  "not_built",
  "no_reading_matched",
  "requirements_unsatisfied",
  "not_in_your_books",
  "could_not_read",
];
const MAX_FOCUS_CELLS = 8;
const MAX_KNOWLEDGE_CHARS = 6000;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** A composer may SELECT measured cells, never write a house claim. */
export function bindReadingReply(raw: unknown, finding: Finding): BoundReply {
  if (!isPlainObject(raw)) throw new Error("invalid_bound_reply");
  const onlyKnownKeys = Object.keys(raw).every(key => key === "kind" || key === "focus");
  if (
    raw.kind !== "reading" ||
    !onlyKnownKeys ||
    !Array.isArray(raw.focus) ||
    raw.focus.length < 1 ||
    raw.focus.length > MAX_FOCUS_CELLS
  ) {
    throw new Error("invalid_bound_reply");
  }

  // Every selected id must name a cell the runner minted for THIS Finding, once.
  const minted = new Set(finding.rows.flatMap(row => row.cells.map(cell => cell.id)));
  const picked = new Set<string>();
  for (const id of raw.focus) {
    if (typeof id !== "string" || !minted.has(id) || picked.has(id)) {
      throw new Error("invalid_cell_binding");
    }
    picked.add(id);
  }
  return { kind: "reading", finding, focus: [...picked].map(cellId => ({ cellId })) };
}

/** The immutable source marker is minted here, with no house input or cell lane. */
export function bindKnowledgeReply(raw: unknown): BoundReply {
  if (!isPlainObject(raw)) throw new Error("invalid_knowledge_reply");
  const onlyKnownKeys = Object.keys(raw).every(key => key === "kind" || key === "text");
  if (
    raw.kind !== "model_knowledge" ||
    !onlyKnownKeys ||
    typeof raw.text !== "string" ||
    !raw.text.trim() ||
    raw.text.length > MAX_KNOWLEDGE_CHARS
  ) {
    throw new Error("invalid_knowledge_reply");
  }
  return {
    kind: "model_knowledge",
    source: "model_knowledge",
    sourceLabel: KNOWLEDGE_LABEL,
    text: raw.text.trim() as ModelKnowledgeText,
  };
}

/**
 * What each Reading reads, in the words a person is told when it could not be
 * read or holds nothing yet (founder, 2026-09-21, round 6r, his pick verbatim:
 * "J4 wins, hide size (Recommended)"; the orchestrating session's statement of
 * it: an empty order book answers staff "no orders recorded yet", never a zero,
 * and an unreadable one "couldn't read the order book right now", with no
 * reason and no size). Keyed by ReadingId, so a new Reading does not compile
 * without its lines. Owners and managers are given the reason instead.
 */
export const READING_BOOK: Readonly<Record<ReadingId, { book: string; empty: string }>> = {
  "inventory.position": { book: "the stock records", empty: "No stock recorded for this item yet." },
  "inventory.low_stock": { book: "the stock records", empty: "No stock items recorded yet." },
  "inventory.in_transit": { book: "the stock records", empty: "No stock items recorded yet." },
  "inventory.locations": { book: "the stock records", empty: "No stock lots recorded for this item yet." },
  "inventory.movements": { book: "the stock movement record", empty: "No stock movements recorded for this item in this period." },
  "orders.open": { book: "the order book", empty: "No orders recorded yet." },
  "orders.lines": { book: "the order book", empty: "No orders recorded yet." },
  "orders.late_deliveries": { book: "the order book", empty: "No orders recorded yet." },
  "orders.due_today": { book: "the order book", empty: "No orders recorded yet." },
  "receipts.verified_line": { book: "the receipt register", empty: "No verified receipts recorded yet." },
  "sales.check_activity": { book: "the check record", empty: "No closed checks recorded in this period." },
  "sales.consumption": { book: "the consumption record", empty: "No consumption recorded for this item in this period." },
  "calendar.upcoming": { book: "the house calendar", empty: "No calendar entries recorded yet." },
  "vendors.active": { book: "the vendor list", empty: "No vendors recorded yet." },
  "documents.waiting": { book: "the document register", empty: "No documents recorded yet." },
  "goals.targets": { book: "the posted targets", empty: "No goals posted yet." },
};
const UNNAMED_BOOK = "the house's records";
export const couldNotReadLine = (readingId?: ReadingId) =>
  `Couldn't read ${readingId ? READING_BOOK[readingId].book : UNNAMED_BOOK} right now.`;

/**
 * A Finding that did not read renders as its own outcome; it never goes to a
 * composer. For a `source_only` role the Finding is first stripped of what
 * would say why a read failed (`withholdFailureDetail`), and the reply carries
 * the one line that role is told instead of a reason.
 */
export function findingReply(finding: Finding, detail: FailureDetail = "full"): BoundReply {
  if (finding.outcome === "read") throw new Error("reading_requires_binding");
  if (detail === "source_only") {
    const shaped = withholdFailureDetail(finding, detail);
    if (shaped.outcome === "could_not_read")
      return { kind: "could_not_read", reason: WITHHELD_FOR_YOUR_ROLE, finding: shaped, line: couldNotReadLine(shaped.readingId) };
    if (shaped.outcome === "not_in_your_books")
      return { kind: "not_in_your_books", reason: shaped.reason || "empty_register", finding: shaped, line: READING_BOOK[shaped.readingId].empty };
  }
  return { kind: finding.outcome, reason: finding.reason || "query_failed", finding };
}

/**
 * A read that failed outside the runner's own refusals (the runner threw).
 * `full`: `query_failed`, as before. `source_only`: the reason is withheld and
 * the one line is given; an attached Finding is shaped the same way.
 */
export function couldNotReadReply(detail: FailureDetail, readingId?: ReadingId, finding?: Finding): BoundReply {
  if (detail === "full") return { kind: "could_not_read", reason: "query_failed", ...(finding ? { finding } : {}) };
  return { kind: "could_not_read", reason: WITHHELD_FOR_YOUR_ROLE, line: couldNotReadLine(readingId ?? finding?.readingId),
    ...(finding ? { finding: withholdFailureDetail(finding, detail) } : {}) };
}

/** A model-side failure, carrying the Finding when the books were already read. */
export function modelFailureReply(reason: ModelFailureReason, finding?: Finding): BoundReply {
  return { kind: "could_not_answer", reason, ...(finding ? { finding } : {}) };
}

const joinNames = (names: string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * The one line a role refusal carries (founder, 2026-09-21, round 6: money,
 * supplier prices and people data "are refused with a one-line reason"). It
 * names every class the role does not see -- never a bare `not_permitted`.
 */
export function classRefusalLine(classes: readonly DataClass[]): string {
  return `Refused for your role: this answer shows ${joinNames(classes.map(c => CLASS_LABEL[c]))}.`;
}
const ANSWER_KIND_LINE: Readonly<Record<AnswerKind, string>> = {
  reading: "Refused for your role: it is not given answers from the house's books.",
  model_knowledge: "Refused for your role: it is not given general-knowledge answers.",
};
/** A refusal line is one short line of text, whatever it says. */
export const isRefusalLine = (line: unknown): line is string =>
  typeof line === "string" && line.trim() !== "" && line.length <= 300 && !/[\r\n]/.test(line);

/**
 * A reading the caller's role refused. Minted BEFORE the runner is
 * constructed, so this never carries a Finding -- the books were never
 * queried, and the DB and compose-model costs the runner and the composer
 * would otherwise spend are never paid (same zero-cost-refusal shape as the
 * `ASK_LAUNCHED` gate in `BoundAskService.submit`).
 */
export function notPermittedReply(readingId: ReadingId, classes: DataClass[]): BoundReply {
  if (!classes.length) throw new Error("a class refusal names the classes it withholds");
  return { kind: "not_permitted", reason: "class_not_visible", readingId, classes: [...classes], line: classRefusalLine(classes) };
}

/**
 * An unbuilt question class whose data class the role does not see (founder,
 * 2026-09-21, round 6r, "Classify now, forecast=sales (Recommended)"): the same
 * one-line refusal a built Reading of that class gets, never "not built".
 */
export function unbuiltNotPermittedReply(questionClass: ClassifiedUnbuiltQuestion, classes: DataClass[]): BoundReply {
  if (!classes.length) throw new Error("a class refusal names the classes it withholds");
  return { kind: "not_permitted", reason: "class_not_visible", questionClass, classes: [...classes], line: classRefusalLine(classes) };
}

/** An answer kind the caller's ROLE_POLICY row is not given. Minted before any model call for it. */
export function answerKindNotPermittedReply(answerKind: AnswerKind, readingId?: ReadingId): BoundReply {
  return { kind: "not_permitted", reason: "answer_kind_not_permitted", answerKind, ...(readingId ? { readingId } : {}), line: ANSWER_KIND_LINE[answerKind] };
}

/**
 * Persistence is a wire boundary too: an unknown or tampered shape must never
 * look complete. The store refuses to serve a complete folio this rejects.
 */
export function isBoundReply(raw: unknown): raw is BoundReply {
  if (!isPlainObject(raw)) return false;
  const attachedFindingOk = raw.finding === undefined || (isPlainObject(raw.finding) && raw.finding.kind === "finding");

  if (raw.kind === "model_knowledge") {
    return raw.source === "model_knowledge" && raw.sourceLabel === KNOWLEDGE_LABEL && typeof raw.text === "string";
  }
  if (raw.kind === "reading") {
    const finding = raw.finding as Finding | undefined;
    if (!isPlainObject(finding) || finding.kind !== "finding" || !Array.isArray(finding.rows)) return false;
    if (!Array.isArray(raw.focus)) return false;
    try {
      // Re-run the same binding the composer's answer went through.
      const focus = (raw.focus as Array<{ cellId?: unknown }>).map(entry => entry?.cellId);
      bindReadingReply({ kind: "reading", focus }, finding);
      return true;
    } catch {
      return false;
    }
  }
  if (raw.kind === "could_not_answer") {
    return MODEL_FAILURE_REASONS.includes(raw.reason as ModelFailureReason) && attachedFindingOk;
  }
  if (raw.kind === "not_permitted") {
    // Never carries a Finding -- the books were never queried for a refusal
    // decided before the runner exists.
    if (raw.finding !== undefined || !ROLE_RESTRICTED_REASONS.includes(raw.reason as RoleRestrictedReason)) return false;
    // Never a bare refusal: the saved answer carries its one-line reason (round 6).
    if (!isRefusalLine(raw.line)) return false;
    if (raw.reason === "class_not_visible") {
      // Either a built Reading, or an unbuilt question class that has a data
      // class (round 6r) -- exactly one of the two, never both, never neither.
      const names = raw.questionClass === undefined
        ? isReadingId(raw.readingId)
        : raw.readingId === undefined && unbuiltClassOf(raw.questionClass) !== null;
      return (
        names &&
        Array.isArray(raw.classes) &&
        raw.classes.length > 0 &&
        raw.classes.every(c => DATA_CLASSES.includes(c as DataClass))
      );
    }
    return (
      ANSWER_KINDS.includes(raw.answerKind as AnswerKind) &&
      (raw.readingId === undefined || isReadingId(raw.readingId))
    );
  }
  // A withheld reason is only ever a failed read's, and never travels without
  // the one line the person is told instead (round 6r). A line, when present,
  // is one short line.
  if (raw.reason === WITHHELD_FOR_YOUR_ROLE && (raw.kind !== "could_not_read" || !isRefusalLine(raw.line))) return false;
  if (raw.line !== undefined && !isRefusalLine(raw.line)) return false;
  return (
    NON_READING_KINDS.includes(raw.kind as Exclude<ReadingOutcome, "read">) &&
    typeof raw.reason === "string" &&
    attachedFindingOk
  );
}
