import { Finding, ReadingOutcome, ReadingReason } from "./reading.types";

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
export type ModelFailureReason = "model_unavailable" | "spend_ceiling" | "invalid_model_reply";
export const MODEL_FAILURE_REASONS: readonly ModelFailureReason[] = [
  "model_unavailable",
  "spend_ceiling",
  "invalid_model_reply",
];

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
  return (
    NON_READING_KINDS.includes(raw.kind as Exclude<ReadingOutcome, "read">) &&
    typeof raw.reason === "string" &&
    attachedFindingOk
  );
}
