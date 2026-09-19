import { Finding, ReadingOutcome, ReadingReason } from "./reading.types";

declare const knowledgeText: unique symbol;
export type ModelKnowledgeText = string & { readonly [knowledgeText]: true };
export type BoundReply =
  | { kind: "reading"; finding: Finding; focus: Array<{ cellId: Finding["rows"][number]["cells"][number]["id"] }> }
  | { kind: "model_knowledge"; source: "model_knowledge"; sourceLabel: "Not from the house's books"; text: ModelKnowledgeText }
  | { kind: Exclude<ReadingOutcome, "read">; reason: ReadingReason; finding?: Finding };

/** A composer may select measured slots, never write a house claim. */
export function bindReadingReply(raw: unknown, finding: Finding): BoundReply {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_bound_reply");
  const value = raw as Record<string, unknown>;
  if (value.kind !== "reading" || Object.keys(value).some(k => !["kind", "focus"].includes(k)) ||
    !Array.isArray(value.focus) || value.focus.length < 1 || value.focus.length > 8)
    throw new Error("invalid_bound_reply");
  const ids = new Set(finding.rows.flatMap(r => r.cells.map(c => c.id)));
  const picked = new Set<string>();
  for (const id of value.focus) {
    if (typeof id !== "string" || !ids.has(id) || picked.has(id)) throw new Error("invalid_cell_binding");
    picked.add(id);
  }
  return { kind: "reading", finding, focus: [...picked].map(cellId => ({ cellId })) };
}

/** The immutable source marker is minted here, with no house input or cell lane. */
export function bindKnowledgeReply(raw: unknown): BoundReply {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_knowledge_reply");
  const value = raw as Record<string, unknown>;
  if (value.kind !== "model_knowledge" || typeof value.text !== "string" || !value.text.trim() ||
    value.text.length > 6000 || Object.keys(value).some(k => !["kind", "text"].includes(k)))
    throw new Error("invalid_knowledge_reply");
  return { kind: "model_knowledge", source: "model_knowledge", sourceLabel: "Not from the house's books", text: value.text.trim() as ModelKnowledgeText };
}
export function findingReply(finding: Finding): BoundReply {
  if (finding.outcome === "read") throw new Error("reading_requires_binding");
  return { kind: finding.outcome, reason: finding.reason || "query_failed", finding };
}

/** Persistence is a wire boundary too: unknown shapes must never look complete. */
export function isBoundReply(raw: unknown): raw is BoundReply {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const v = raw as Record<string, any>;
  if (v.kind === "model_knowledge") return v.source === "model_knowledge" && v.sourceLabel === "Not from the house's books" && typeof v.text === "string";
  if (v.kind === "reading") {
    if (v.finding?.kind !== "finding" || !Array.isArray(v.finding.rows)) return false;
    try { bindReadingReply({ kind: "reading", focus: v.focus?.map((f: any) => f.cellId) }, v.finding); return true; }
    catch { return false; }
  }
  return ["clarify", "not_built", "no_reading_matched", "requirements_unsatisfied", "not_in_your_books", "could_not_read"].includes(v.kind) && typeof v.reason === "string";
}
