import { isReadingId } from "./reading-catalogue";
import { ANSWER_KINDS, AnswerKind, CLASS_LABEL, DATA_CLASSES, DataClass } from "./reading-data-classes";
import { Finding, ReadingId, ReadingOutcome, ReadingReason } from "./reading.types";

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
  | { kind: "not_permitted"; reason: "answer_kind_not_permitted"; answerKind: AnswerKind; readingId?: ReadingId; line: string }
  | { kind: Exclude<ReadingOutcome, "read">; reason: ReadingReason; finding?: Finding };

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

/** A Finding that did not read renders as its own outcome; it never goes to a composer. */
export function findingReply(finding: Finding): BoundReply {
  if (finding.outcome === "read") throw new Error("reading_requires_binding");
  return { kind: finding.outcome, reason: finding.reason || "query_failed", finding };
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
      return (
        isReadingId(raw.readingId) &&
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
  return (
    NON_READING_KINDS.includes(raw.kind as Exclude<ReadingOutcome, "read">) &&
    typeof raw.reason === "string" &&
    attachedFindingOk
  );
}
