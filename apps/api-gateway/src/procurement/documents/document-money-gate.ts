import { HttpException, HttpStatus } from "@nestjs/common";
import { policyFor } from "../../ask-readings/reading-data-classes";

/**
 * WHO MAY WRITE A VENDOR DOCUMENT'S MONEY, and what the door is told back.
 *
 * `DocumentsController` carries `JwtAuthGuard` and nothing else, on purpose:
 * the upload is the delivery door, and a runner photographs paper there (ADR
 * 0126). But the same controller also corrects a document's fields, edits its
 * lines, runs and confirms the match, fills an unread document and verifies the
 * transcription — the record the house pays its vendors from. Those acts
 * checked no role at all, and `SealChallengeService` does not either: its
 * header says the caller checks the role. So any signed-in person at the house,
 * staff included, could rewrite a unit price behind a seal they minted
 * themselves.
 *
 * ONE ANSWER TO "WHO HOLDS THE HOUSE'S MONEY": the `money` row of `ROLE_POLICY`
 * (ADR 0145), the same table Ask and the dashboard read. Owner and manager hold
 * it (`admin` reads the owner row); staff, an unknown role and a session with
 * no role at this house do not. The role is the token's, which `JwtStrategy`
 * re-derives from the access row on every request.
 *
 * Pure: no database, no Nest container. The controller calls it before any
 * seal is minted, redeemed or read, so a refusal spends nothing.
 */
export function holdsHouseMoney(role: string | null | undefined): boolean {
  return policyFor(role).sees.includes("money");
}

/** The document acts that write money, by the name the refusal speaks. */
export type DocumentMoneyAct =
  | "field_correct"
  | "field_verify"
  | "line_edit"
  | "verify"
  | "extraction"
  | "match"
  | "line_link";

const ACT_WORDS: Readonly<Record<DocumentMoneyAct, string>> = {
  field_correct: "Correcting a field on a vendor document",
  field_verify: "Marking a field on a vendor document as checked",
  line_edit: "Correcting a line on a vendor document",
  verify: "Confirming a vendor document's transcription",
  extraction: "Filling a vendor document with a reading",
  match: "Pairing a vendor document's lines with the order",
  line_link: "Confirming or undoing a line pairing on a vendor document",
};

/**
 * Refuse a non-holder in words, or return.
 *
 * A 403 with a whole sentence: what the act is, who the session is at this
 * house, that nothing happened, and who can do it. The door is named because
 * the person refused here is usually standing at it, and what they came to do
 * there still works.
 */
export function assertHoldsHouseMoney(
  user: { role?: string | null } | null | undefined,
  act: DocumentMoneyAct,
): void {
  const role = user?.role ? String(user.role).trim() : "";
  if (holdsHouseMoney(role || null)) return;
  throw new HttpException(
    `${ACT_WORDS[act]} is desk work on the record this house pays its vendors from, so it is an owner's or a manager's act. ` +
      `${role ? `You are signed in as ${role} at this house` : "This session could not be shown to hold any role at this house"}, so nothing was sealed and nothing was changed. ` +
      "The photograph and the door count still go through for you; ask a manager or an owner to do this one.",
    HttpStatus.FORBIDDEN,
  );
}

/**
 * The keys of a parse the delivery door reads, and nothing else.
 *
 * `DoorModel.readPaper` (web) counts boxes and bottles from each line's `qty`,
 * `uom`, `packSize` and `qtyBottles`, names the paper by `docType` and
 * `docNumber`, and counts `lines`. That is the whole of what a non-holder is
 * sent back. AN ALLOWLIST, NOT A DENYLIST: a money field added to
 * `ParsedDocument` later stays withheld without anyone remembering to list it.
 * `warnings` is left out too, because a tie-out warning prints the figures it
 * compared.
 */
export const DOOR_ECHO_DOCUMENT_KEYS = ["docType", "docNumber", "lines"] as const;
export const DOOR_ECHO_LINE_KEYS = [
  "lineNo",
  "qty",
  "uom",
  "packSize",
  "qtyBottles",
] as const;

function pick(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys)
    if (Object.prototype.hasOwnProperty.call(source, k)) out[k] = source[k];
  return out;
}

/**
 * The parse as the door may see it. Keys are OMITTED, never set to null: a
 * null price reads as "the paper printed none", which is a claim about the
 * paper, and this is a claim about the reader. `null` in, `null` out — a
 * duplicate upload has no parse, and the door already says so.
 */
export function doorEchoOf(
  parsed: object | null | undefined,
): Record<string, unknown> | null {
  if (!parsed) return null;
  const doc = pick(parsed as Record<string, unknown>, DOOR_ECHO_DOCUMENT_KEYS);
  if (Array.isArray(doc.lines))
    doc.lines = (doc.lines as unknown[]).map((l) =>
      l && typeof l === "object"
        ? pick(l as Record<string, unknown>, DOOR_ECHO_LINE_KEYS)
        : {},
    );
  return doc;
}
