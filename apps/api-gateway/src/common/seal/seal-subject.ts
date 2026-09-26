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
/**
 * `house_mail_export` (added 2026-09-05, ADR 0118 D16) is the seal on the
 * house's own copy of its mail: choosing where it is kept, and running the
 * export that writes it there. Its subject is the RESTAURANT, because the act is
 * on the whole book rather than on one reply, and its args carry the mode and
 * the connection — so a seal minted to send this house's mail to one Drive
 * cannot be spent to send it to another. It is sealed rather than role-gated
 * because both directions are irreversible by the next request: exporting
 * copies every vendor reply the house holds into storage Mudavym does not
 * control, and un-choosing an armed archive puts the deletion back on a window
 * with nothing kept.
 */
/**
 * `commodity_exposure` (added 2026-09-05, the founder's answer to the commodity
 * plan's Q5) is the seal on a person asserting that one of this house's items
 * is exposed to a published index series. Its subject is the ITEM — one item
 * may be exposed to several series — and its args carry the series, the
 * pass-through and the lag, so an exposure held open at "we do not know how
 * much of a move reaches us" cannot be spent at ninety percent. It is sealed
 * because the mapping is what turns a world index into a claim about this
 * kitchen, and because it is retired rather than deleted: a mistake stays in
 * the record.
 *
 * The ARMING of a series is deliberately NOT a kind here. That act is a Mudavym
 * admin's, authenticated by ADR 0099's service key, and this table's
 * `actor_user_id` is `UUID NOT NULL REFERENCES public.users(user_id)` — a
 * machine caller has no such row, and minting a fake one would put a person's
 * name on a decision they did not make. It carries a recomputed proposal hash
 * instead, and `commodity-calibration.ts` says so where somebody looking for
 * the seal would go.
 */
/**
 * `procurement_document` (added 2026-09-06, batch 64; widened 2026-09-11, batch
 * 69) is the seal on the FIVE write acts of the receiving corridor, across both
 * faces of the same paper.
 *
 * On the /receipts face: confirming a transcription (`verify`), correcting one
 * extracted line (`line_edit`) and restating or confirming what currency an
 * invoice's money is in (`currency_restate`). On ADR 0104's canonical face:
 * correcting one layer-1 field (`field_correct`) and ticking one field as
 * checked by a human (`field_verify`).
 *
 * The founder's answer to "should procurement's write routes be sealed" was
 * *"Decide as a module: seal all three"*, and then, asked about the twins on the
 * other face, *"Seal corrections and fields/verify too — the decision then holds
 * on both faces of the document"*. This is those two decisions as ONE kind with
 * five acts rather than five mechanisms. Its subject is the DOCUMENT for all
 * five — the line edit names its line, and the two field acts name their path,
 * in the arguments instead, because a refusal reading "a different line" would
 * name a row rather than the paper, and because putting a second table's uuids
 * under one kind is the collision `subject_kind` exists to stop.
 *
 * The ACT is not enumerated in SQL. `tool_name` carries it under a
 * `btrim(tool_name) <> ''` CHECK and nothing narrower (20260904170000), so the
 * two acts added in batch 69 needed no migration; the SUBJECT KIND is the
 * enumerated column, and 20260906200000 already admits this one.
 *
 * It is sealed rather than role-gated because a verification is the record a
 * vendor dispute leans on and there is deliberately no un-verify; because a line
 * edit changes what the paper is claimed to say, with no `updated_at` on
 * `procurement_document_lines` to precondition on; because a restatement
 * re-files a whole invoice's money; and because layer 1 is append-only, so a
 * correction or a tick written against a superseded revision cannot be taken
 * back once it has landed. See `procurement/documents/document-seal.ts` for what
 * each act's arguments cover and why.
 */
/**
 * `configuration_batch` (added 2026-09-19, ADR 0113/0144, codex-audit/C2-adopt.md
 * #2) is the seal on APPLYING an Arrival configuration batch — "the assistant
 * proposes, the seal applies". Its subject is the BATCH, and its args carry
 * the batch id and revision, so a hold begun over one draft cannot be spent
 * after the draft changed underneath it. The seven-day UNDO that follows a
 * sealed batch is a separate, unsealed control (ADR 0113 rule 4a); nothing in
 * that record or the C2 audit asks for a second ceremony there. See
 * `arrival/arrival-seal.ts` for the act and the arguments.
 */
export const SEAL_SUBJECT_KINDS = [
  "mcp_tool",
  "mcp_tool_grant",
  "procurement_order",
  "payment_method",
  "price_index_upload",
  "house_mail_export",
  "text_credit_purchase",
  "commodity_exposure",
  "procurement_document",
  // ADR 0175 D9 (sealed 2026-09-21; admitted by 20260921113500): the AI
  // negotiation's pause-for-approval, keyed on the conversation row, and the
  // house composer's letter, keyed on the vendor it is written to.
  "procurement_conversation",
  "house_letter",
  // ADR 0175 amendment, founder answer (4), 2026-09-21 (admitted by
  // 20260921114800): issuing, revoking, re-approving and deleting a send
  // grant are sealed on the server. Keyed on the grant; an issue, which has
  // no grant row yet, is keyed on the house (the `payment_method` create
  // shape).
  "authority_grant",
  "configuration_batch",
  "integration_grant",
  // An assistant proposal (`ai_proposed_actions`), applied from the house
  // counter — "applied only by the seal" (the founder's pick of 2026-09-21,
  // sketch 119 D). One act, `apply`, bound to the proposal's stored arguments.
  // Admitted in SQL by 20260921114400.
  "ai_proposed_action",
] as const;

export type SealSubjectKind = (typeof SEAL_SUBJECT_KINDS)[number];

/** How a refusal names the thing, in the operator's language rather than ours. */
export function subjectNoun(kind: SealSubjectKind): string {
  switch (kind) {
    case "integration_grant":
      return "integration grant";
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
    case "house_mail_export":
      // "mail archive", not "export": the refusals then read "a different mail
      // archive", which is the true thing. Calling it an export would make a
      // refused CHOICE and a refused RUN say the same sentence about two
      // different acts.
      return "mail archive";
    case "text_credit_purchase":
      // "credit purchase", not "credits": the act being sealed is SPENDING
      // money on message credits, and a refusal that said "a different credits"
      // would name the balance rather than the purchase. Its subject is the
      // RESTAURANT — there is no purchase row until the seal is redeemed, the
      // same shape `payment_method`'s `create` seal has for the same reason.
      return "credit purchase";
    case "commodity_exposure":
      // "exposure", not "series" and not "item": the act being sealed is the
      // JOIN between them. A refusal that said "a different series" would name
      // the publisher's number, and one that said "a different item" would name
      // the shelf; neither is the thing that was approved.
      return "exposure";
    case "procurement_document":
      // "document", not "invoice" and not "line": the subject of all three acts
      // is the paper. "A different invoice" would be wrong for a credit memo or
      // a delivery note, which this kind also covers, and "a different line"
      // would name the row a correction touches rather than the record somebody
      // is standing behind.
      return "document";
    case "procurement_conversation":
      // "conversation": the subject of POST /conversations/:id/approve is the
      // negotiation's pending message, and "a different order" would name the
      // wrong thing — a conversation need not have one.
      return "conversation";
    case "house_letter":
      // "letter": the composer's subject id is the VENDOR it writes to, but the
      // thing sealed is the letter, and "a different vendor" would read as a
      // statement about the book rather than about what was held.
      return "letter";
    case "authority_grant":
      // "send grant", not "grant": `mcp_tool_grant` already reads "grant", and
      // a refusal must not say the same words about an assistant's tool grant
      // and a person's right to send to vendors.
      return "send grant";
    case "configuration_batch":
      // "batch", not "proposal" or "receipt": the act being sealed is APPLYING
      // it, and the book's own UI already calls it "this batch" throughout —
      // a refusal that said "a different proposal" would name the assistant's
      // side of it, not the thing the seal is over.
      return "batch";
    case "ai_proposed_action":
      // "proposal", not "action": until it is applied it is only a proposal,
      // and a refusal reading "a different action" would name the act the seal
      // exists to gate as if it had already happened.
      return "proposal";
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
