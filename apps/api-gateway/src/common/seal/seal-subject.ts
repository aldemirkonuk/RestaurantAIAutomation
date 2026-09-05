/**
 * WHAT a seal is a seal ON, and the words each refusal says.
 *
 * ---------------------------------------------------------------------------
 * THE GENERALISATION (founder, 2026-09-04)
 * ---------------------------------------------------------------------------
 * ADR 0107's addendum bound a challenge to (actor, connection, tool,
 * args_hash), because the only thing behind the seal was an MCP tool write. The
 * founder then extended challenge-and-redeem to ORDER APPROVAL and to PAYMENTS,
 * and a `connection_id` is meaningless for either.
 *
 * So the binding is restated one level up and the MCP case becomes an instance
 * of it rather than the shape of it:
 *
 *     (actor, SUBJECT KIND, SUBJECT ID, action, args_hash)
 *
 *   * ACTOR       — a token issued to one manager cannot be spent by another.
 *   * SUBJECT KIND— an order seal cannot pay for a card change. Two ids from
 *                   two tables can collide as strings; the kind is what stops a
 *                   uuid meaning two things.
 *   * SUBJECT ID  — THIS order, THIS instrument, THIS server. Not "orders".
 *   * ACTION      — which write. `approve` and `cancel` on the same order are
 *                   two different approvals.
 *   * ARGS HASH   — what was on the screen when the hold began. This is the one
 *                   that stops the edit-after-approval: a seal minted over an
 *                   order of 2,000 cannot be spent on the same order after
 *                   somebody made it 20,000.
 *
 * Nothing here talks to a database or to Nest, so every rule above is testable
 * without either.
 */

/**
 * The kinds. A string union rather than an enum so the values in the code and
 * the values in the column's CHECK are literally the same characters.
 *
 * `mcp_tool` is listed because the existing rows ARE that kind and the
 * migration backfills them so — but `mcp-connections` keeps its own redemption
 * path for the CALL in this pass (see `seal-challenge.service.ts`'s header). It
 * is here to be honest about what the column holds, not to claim this service
 * serves it.
 *
 * `mcp_tool_grant` (added 2026-09-04, second pass) IS served here. Granting a
 * tool as a write, and re-consenting to one whose declaration moved, are both
 * acts that turn a refused call back on — so they are sealed by the same
 * mechanism as the call itself, through this service rather than through a
 * third copy of the policy. Its subject is the CONNECTION and its args are the
 * tool name plus the tool-list hash the manager was looking at, so a seal held
 * over one tool list cannot be spent after the server changed it. Note the
 * asymmetry with `mcp_tool`: a grant seal carries NO `connection_id` column
 * (`chk_mcp_seal_challenges_non_tool_has_no_connection` forbids it) and names
 * the connection in `subject_id` instead.
 *
 * `price_index_upload` (added 2026-09-05, ADR 0128) is the seal on ADMITTING a
 * hand-carried price book. Its subject is the review row, and its args are the
 * book's sha256 and the tier it was held under, so a seal minted over a book
 * that was held for one reason cannot be spent after the reason changed. It is
 * here rather than in a settings-style logged assertion because
 * `price_index_postings` has no restaurant_id: admitting a book puts numbers on
 * every house in that jurisdiction's screens, and the person who reads them
 * cannot undo it.
 */
export const SEAL_SUBJECT_KINDS = [
  "mcp_tool",
  "mcp_tool_grant",
  "procurement_order",
  "payment_method",
  "price_index_upload",
] as const;

export type SealSubjectKind = (typeof SEAL_SUBJECT_KINDS)[number];

/** How a refusal names the thing, in the operator's language rather than ours. */
export function subjectNoun(kind: SealSubjectKind): string {
  switch (kind) {
    case "procurement_order":
      return "order";
    case "payment_method":
      return "payment method";
    case "mcp_tool":
      return "tool";
    case "mcp_tool_grant":
      // "grant", not "tool": the refusals below then read "a different grant",
      // which is the true thing. Calling it a tool would make a refused GRANT
      // seal and a refused CALL seal say the same sentence about two different
      // acts.
      return "grant";
    case "price_index_upload":
      // "price book", not "upload": the act being sealed is admitting a BOOK to
      // the market of every house in its jurisdiction, and "a different upload"
      // would name the file transfer rather than the thing that goes on screens.
      return "price book";
  }
}

/**
 * Every way a redemption can fail, and the sentence the person reads.
 *
 * One function, so the 403 body and the filed audit row cannot drift into two
 * accounts of the same event. Each sentence names the thing that did not match:
 * "invalid token" is the message that makes an operator retry the same broken
 * thing, and a seal is exactly where that must not happen.
 */
export type SealRefusal =
  | "absent"
  | "unknown"
  | "spent"
  | "other_actor"
  | "other_subject"
  | "other_action"
  | "arguments_changed"
  | "expired"
  | "raced"
  // `unredeemed` is the ONLY reason here that is not a failure of a token
  // being spent. It belongs to `assertRedeemed`, which asks the opposite
  // question — "was this seal already spent, by this person, for this act?" —
  // when a LATER request has to prove an earlier one was sealed. A seal that
  // exists and was never spent proves nothing about the act now being trusted,
  // and reading it as proof would be the absence-reported-as-health shape
  // arriving through the one door that touches money.
  | "unredeemed";

export function refusalWords(
  reason: SealRefusal,
  kind: SealSubjectKind,
): string {
  const noun = subjectNoun(kind);
  switch (reason) {
    case "absent":
      return `This ${noun} is sealed, and a seal must be proven rather than asserted. Begin the hold on the ${noun}: it issues a one-time seal that the write has to carry back. Nothing was changed.`;
    case "unknown":
      return "That seal is not one this house issued, so nothing was changed. Begin the hold again.";
    case "spent":
      return `That seal has already been spent. A seal is good for exactly one act, so a repeat is a second approval rather than a retry — nothing was changed.`;
    case "other_actor":
      return "That seal was issued to somebody else. A seal is one person's approval and cannot be spent by another, so nothing was changed.";
    case "other_subject":
      return `That seal was issued for a different ${noun}, so nothing was changed.`;
    case "other_action":
      return `That seal was issued for a different act on this ${noun}. A seal approves one act, not a session — nothing was changed.`;
    case "arguments_changed":
      return `This ${noun} changed after the seal was issued, so nothing was changed. What was approved and what was sent have to be the same thing.`;
    case "expired":
      return "That seal has expired. Hold it again — a seal is short-lived on purpose, so one left open cannot be spent later. Nothing was changed.";
    case "raced":
      return "That seal was spent by another request a moment ago, so this one was refused. Exactly one act runs per seal.";
    case "unredeemed":
      return `That seal was issued and never spent, so nothing about this ${noun} was ever approved with it. Begin the hold again. Nothing was changed.`;
  }
}
