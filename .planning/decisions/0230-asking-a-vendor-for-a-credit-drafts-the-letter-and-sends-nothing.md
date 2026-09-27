# 0230 — Asking a vendor for a credit drafts the letter, and sends nothing

- **Status:** Locked 2026-09-25 (founder, round 5 — item 31)
- **Date:** 2026-09-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** credits, procurement_credits, requested, house letter, draft, HOUSE_DRAFT, communications, approval, never auto-send
- **Links:** [[0118-the-house-writes-its-own-mail]] (the letter path this rides), [[0083-a-page-may-not-claim-a-write-it-never-makes]] (drafted is not sent), ADR 0167 (credits are owner/manager only; its record is on PR #395), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] row 22 (the credits lane), PR #476

## Context

PR #476 built the credit ledger as a lane of `/receipts`. Moving a claim to
`requested` only stamped `requested_at` / `requested_by`
(`apps/api-gateway/src/procurement/documents/credits.controller.ts`, the
`requested` branch), and the lane said "Mudavym sends nothing to the vendor".
The receipts note (§13 item 1) listed "send the claim to the vendor" as the
highest-value missing piece, and #476's body left it as an open fork rather
than defaulting it.

The house already has one letter path: `POST /communications/letters`
(ADR 0118) queues a `procurement_conversations` row as `HOUSE_QUEUED` after
four refusals — recipient in the book, guardrails, a sending identity, the
house still using its grant — and a dispatcher sends it after an undo window.
It had no "drafted, nobody has decided" state.

## Options considered

The question's exact option text was not kept in the record; the founder's
answer is quoted as recorded in the session's founder-answers memory (item 31).
The options below are the forks the build faced.

1. **Keep `requested` a record only** (#476 as built) — the person asks the
   vendor themselves and records it. Honest, but the house writes the same
   claim letter by hand every time, and the claim's facts (amount, invoice,
   order, count) are retyped. Rejected by the founder's answer.
2. **Send the claim to the vendor on `requested`** — the move queues or sends a
   letter. Rejected: a letter to a vendor about money must never leave without
   a person's act (ADR 0118: "every step is a human's"; the AI reply path's
   never-auto-send rule), and the founder's answer says so in words.
3. **Draft the letter on `requested`; a person sends it from
   `/communications`** — chosen.

## Decision

**[founder, 2026-09-25, round 5]** "Credits #476: 'requested' creates a
DRAFTED letter to the vendor in /communications; nothing sends without
approval." Rejected: record-only `requested` (#476 as built); sending on the
move.

What was built, on `feat/receipts-credits-tab`:

- **A new letter state, `HOUSE_DRAFT`** (`LETTER_STATUS.DRAFT`,
  `house-letters.service.ts`). No cron selects it — the dispatcher reads
  `HOUSE_QUEUED` alone — so a draft cannot leave on its own. The row is a
  `HOUSE_LETTER` in `procurement_conversations`, `ai_generated: false`, with
  `email_headers.credit_id` naming its claim and `drafted_by` naming who asked.
  No migration: `status` has no CHECK, and the link lives in the row's own
  headers.
- **The letter carries the claim's facts and invents none**
  (`communications/letters/credit-letter.ts`): the amount in the claim's own
  currency, the reason in a vendor's words, the invoice and order numbers and
  bottle count when the claim has them, the matcher's summary. A fact the claim
  lacks is left out, never filled. A test pins that it trips none of
  `composerGuardrails` (no commitment language, no merge token).
- **`→ requested` drafts it** (`credits.controller.ts`). The move still
  succeeds when drafting fails; the response carries `letter: { state, id, to,
  says }` with one of five honest states — `drafted`, `drafted_no_address`
  (the vendor has no address in the book, or the book could not be read),
  `no_vendor` (the claim names none; no row is written), `existing` (asking
  twice returns the same unsent draft), `failed` (the sentence why).
  `POST /procurement/credits/:id/request-letter` drafts again for a claim
  already asked for.
- **The credit links to its draft.** `GET /procurement/credits` returns each
  claim's `letters` (newest first) or `null` + `lettersError` when they could
  not be read — unknown, never none. The lane's claim sheet shows the letter in
  the letter book's words and links `/communications?draft=<id>`.
- **Sending is the approval.** `/communications` lists "Drafted, not sent"
  (`GET /communications/letters/drafts`); opening one puts it in the composer.
  Send posts `POST /communications/letters` with `draftId`, and the draft row
  itself becomes the queued letter under every ADR 0118 refusal and the undo
  window — conditional on still being a draft, so one draft never leaves twice.
  `POST /communications/letters/:id/discard` keeps it as `HOUSE_CANCELLED`.
- The conversation book labels a `HOUSE_DRAFT` row "Drafted · not sent"
  (`cm-format.ts`), never sent and never "AI draft".

## Consequences

- A claim asked for is one tap from a written letter; nothing reaches a vendor
  without a person pressing Send in the composer.
- `requested` now means "asked for, letter drafted or sent" rather than "I
  asked by phone". A person who asked by phone discards the draft.
- `/receiving`'s `RcCreditDrafts.tsx` makes the same `open → requested` move and
  now also drafts a letter; its own copy ("it is with the vendor now") is the
  receiving lane's to correct.
- **Not done:** the `/communications` glance figure "drafts waiting" still counts
  only the AI approval queue (`/procurement/conversations/active`), not house
  drafts; the drafts list beside the composer is where they show.
- **Revisit** if a house wants credit letters grouped per vendor (one letter for
  several claims), or when a vendor channel other than email carries claims.

## Reconciliation with ADR 0167 (2026-09-26, PR #476 audit round 1)

This decision built a new surface — `GET /communications/letters/drafts` and
`POST /communications/letters/:id/discard` — that reads and destroys exactly
the figures [[0167-the-receiving-queue-and-credit-ledger-refuse-staff]] locked
as owner-or-manager-only: `drafts()`'s response carries each draft's full
letter body, which for a credit-claim draft is the claimed dollar amount, the
reason in a vendor's words, and the invoice/order numbers. Both routes had
carried `JwtAuthGuard` alone, so a staff member could read a claim's dollars
by this door even though `GET /procurement/credits` refuses them the same
figures, and could discard a manager's own draft. This was not a fresh choice
put to the founder — it is ADR 0167's existing rule ("owner or manager on all
[figures the staff view omits]") applied to a route this decision's own build
opened without noticing it carried the same figures. No option was rejected
here; `@Roles("owner", "manager")` was added to `drafts` and `discard` alone
(`house-letters.controller.ts`), matching `CreditsController` exactly. Every
other route on `HouseLettersController` — writing and sending a letter by
hand — stays open, as ADR 0167 never named it. Proof:
`house-letters-drafts-roles.spec.ts` (real HTTP through the real `RolesGuard`;
staff, no-role and admin get 403 on both routes and reads nothing; owner and
manager pass; every other handler is asserted ungated) and
`route-access.expected.json` (this controller's full route census).

## Reconciliation with ADR 0167, round 2 (2026-09-26, PR #476 audit round 2, R1b/R2b)

Round 1 closed the two routes this decision's build had opened by name. It
missed three more, all pre-existing and none of them touched by this PR's
diff, that the same new `HOUSE_DRAFT`/`HOUSE_CANCELLED` rows now also flow
through:

1. **`GET /conversations`, `/conversations/by-order/:id`,
   `/conversations/by-provider/:id` and `/conversations/:id`
   (`conversations.controller.ts`) carried no status exclusion at all** — a
   general house/vendor conversation log, open to every role, that this PR
   made a HOUSE_DRAFT's home. A staff caller could list or read a manager's
   credit-claim letter by this door: its `message_text`, claimed amount and
   invoice/order numbers.
2. **`POST /communications/letters` (`queue`) and
   `POST /communications/letters/:id/cancel` were, and remain, deliberately
   ungated** — round 1's reconciliation said writing and sending a letter by
   hand was never part of ADR 0167, which is still true for an ordinary
   letter. It is not true when `queue`'s `draftId` resolves to a row carrying
   `email_headers.credit_id`: sending THAT letter is the completion of the
   same owner/manager-only act ADR 0167 already gates on
   `POST /procurement/credits/:id/transition`, not "writing one by hand".
   Chained with (1), a staff member could read a manager's draft id through
   the ungated conversation read, then `queue()` it under their own
   subject/body — hijacking and sending a credit letter as the house, which
   is exactly what "nothing sends without approval" (item 31, the founder's
   own words) exists to stop. `cancel()` on a credit-linked queued letter is
   the same act in reverse (pulling back a manager's ask) and is refused the
   same way.
3. **`inbound-responder.service.ts`'s `buildTranscript` and
   `procurement.service.ts`'s `getConversationHistory`** treated an unsent or
   discarded credit letter as though it had gone: the first labelled it
   `"Us:"` in the transcript handed to the negotiation LLM, risking a reply
   that acts as if the vendor had already been asked; the second is a third,
   role-blind read path (`JwtAuthGuard` alone) that returned the same claimed
   figures to any caller.

None of this is a fresh choice put to the founder — each is ADR 0167's
existing rule, or the same "nothing sends without approval" sentence,
reaching a place this decision's own build put a `HOUSE_DRAFT`/`HOUSE_CANCELLED`
row without following it there. Fixed without a decorator-level `@Roles` on
routes ADR 0167 never named (round 1's reconciliation is unchanged on that
point):

- `conversations.service.ts`'s `listConversations` and `getConversation` now
  take the caller's role and withhold `HOUSE_DRAFT`/`HOUSE_CANCELLED` rows
  from anyone who is not owner or manager — two null-safe `.or()` filters
  (`status.is.null,status.neq.<X>`, the same idiom
  `procurement.service.ts:getConversationHistory` already used), never a
  blanket new gate: every other status, and a row with no status at all,
  reads exactly as before for every role.
- `house-letters.service.ts`'s `queue()` and `cancel()` now take the caller's
  role and refuse (`ForbiddenException`) only when the letter in question
  answers a credit claim (`draft.creditId` / `email_headers.credit_id`); a
  letter with no claim behind it is unaffected.
- `buildTranscript` drops `HOUSE_DRAFT`/`HOUSE_CANCELLED` rows from the
  transcript entirely, rather than relabelling them — the model should reason
  from what was actually said, and an undecided draft was never said to
  anyone.
- `getConversationHistory` withholds both statuses outright (no role split,
  since the route itself has none), the same "live elsewhere" reasoning it
  already applies to `PENDING_APPROVAL` and an unsent outbound `DRAFT`.

Proof: `credit-letter.spec.ts` and `house-letters.spec.ts` (a staff or no-role
caller is refused sending or cancelling a credit-linked letter; a non-credit
letter is unaffected either way), `conversation-routes-belong-to-the-callers-house.spec.ts`
and `conversation-lists-belong-to-the-callers-house.spec.ts` (a staff caller
reads 404 / an empty slot on every read route for a HOUSE_DRAFT/HOUSE_CANCELLED
row; owner and manager still see it; an ordinary message is untouched)
**[corrected 2026-09-27, PR #476 audit at 9d04c0fb6: "every read route" was
broader than the code and the tests. Both specs covered `GET /conversations`,
`by-order`, `by-provider`, `pending/list` and `/:id` only; `GET /threads`,
`GET /thread/:threadId` and `POST /:id/summarize` took no role and still
showed the letter. See round 3 below.]**,
`inbound-responder.service.spec.ts` (`buildTranscript` drops both statuses,
keeps a real inbound reply alongside), and `conversation-ledger.spec.ts`
(`getConversationHistory` withholds both, keeps a real `HOUSE_QUEUED`/`SENT`
letter). Mutation-checked 2026-09-26: removing each of the five guards in
turn (the two `.or()` calls in `listConversations`, the same in
`getConversation`, the credit check in `queue()`, the same in `cancel()`, the
status filter in `buildTranscript`, the two `.or()` calls in
`getConversationHistory`) turns exactly the tests named for it red, and
nothing else.

## Reconciliation with ADR 0167, round 3 (2026-09-27, PR #476 audit at 9d04c0fb6)

Round 2 fixed four `conversations.controller.ts` routes by name and said
"every read route". Three more on the same controller were missed:
`GET /conversations/threads` and `GET /conversations/thread/:threadId`
(both used by the Communications page:
`apps/web/src/hooks/queries/useConversationQueries.ts:202,217`) and
`POST /conversations/:id/summarize`. None of the three took a role. The
thread list goes through the `list_conversation_threads` RPC, and its
`p_status` filters `delivery_status`, not `status` (baseline
`20260805000000`, lines 695-742), so no caller could leave a letter out.
Filtering the fetched messages alone would not have been enough either. The
RPC's `p_search` matched a draft's `message_text`, so a staff search for an
amount would still have found the thread. `total_threads` would also have
counted threads that hold only a letter.

This is the same ADR 0167 rule again, not a new choice for the founder:

- **Migration `20260929200000`** **[renamed to `20260930250000` in the 2026-09-27 merge-train update — it landed BEHIND a migration already on `origin/main`; see `CLAIMS.jsonl`]** re-creates `list_conversation_threads`
  with `p_withhold_house_letters boolean DEFAULT true`, applied inside
  `matched`. Counts, first and last times, search and paging then only see
  what the caller may see. The default fails closed: a caller that passes
  nothing gets the staff view. That caller is `reports.service.ts`
  `getReportCrossFile`, which passes nothing **[corrected in round 4: it now passes `true` explicitly]**, so its "conversation threads in
  this period" count now leaves out letters that were never sent. The old
  13-argument overload is dropped rather than kept beside the new one. A
  named call with only those 13 arguments would match both and fail as
  ambiguous.
- **`conversations.service.ts`:** `listConversationThreads` passes
  `!isOwnerOrManager(callerRole)` to the RPC. It also applies the two
  null-safe `.or()` filters to the thread's fetched messages, because a
  thread can hold a vendor reply next to a letter. `getThread` and
  `regenerateSummary` take `callerRole` and apply the same filters. A staff
  caller now gets a thread with the letter left out, and summarize answers
  404 on a letter, the same answer `getConversation` gives.
- **`conversations.controller.ts`:** the three routes read
  `@CurrentUser("role")` and pass it down. There is still no decorator-level
  `@Roles`, for the same reason as in round 1.

Proof. The SQL was run on a PGlite build of all 230 migrations (2026-09-27;
superuser, no Supabase platform). In the default and staff views, threads
holding only a letter disappear and a mixed thread counts 1 message, not 2. A
staff `p_search` for a draft's amount returns nothing. The owner and manager
view still shows all 4 threads. The `reports.service.ts`-style named call
resolves to exactly one overload. With the withholding clause removed, 4 of
the 7 checks fail. The HTTP proof is
`conversation-routes-belong-to-the-callers-house.spec.ts`, where staff,
owner and manager each call `/threads`, `/threads?search=`,
`/thread/:threadId` and `/:id/summarize`. Six mutations were run, each on its
own: the role dropped from either route, the RPC flag forced false, the
message filter removed, `getThread`'s filter removed, and summarize's filter
removed. Each one turns 1-2 tests red. The static pin is CLAIMS
`ADR-0167-CONVERSATION-THREADS-WITHHOLD-CREDIT-DRAFTS`.

**Checked in this round, and what was not.** Every other non-test gateway
file that runs `.from("procurement_conversations")` was read for this rule:

- `communications.controller.ts:1057` reads inbound messages only.
- `communications.controller.ts:1190` reads no `message_text`.
- `house-mail-archive.service.ts` reads mirrored inbound mail only.
- `whatsapp-book.service.ts` reads inbound WhatsApp only.
- `communications.service.ts` selects `id` only.
- `providers.service.ts` only inserts.

None of these returns a letter's text. The following were **not** checked in
this round:

- The Python agents in `services/agent-orchestrator`.
- The rest of `rabbitmq-bridge.service.ts`, `raw-mail-retention.service.ts`,
  `scheduled-tasks.service.ts`, `whatsapp-inbound.service.ts` and
  `whatsapp-send.service.ts`. These are background or send paths, not
  HTTP reads.
- Direct Supabase or RLS access.

## Reconciliation with ADR 0167, round 4 (2026-09-27, PR #476 audit at e2cd28578)

Round 3's migration dropped and re-created `list_conversation_threads` and
reissued no grant. A re-created function gets a fresh ACL, and PostgreSQL gives
EXECUTE on a new function to PUBLIC, which anon and authenticated belong to.
OD-72's `alter default privileges ... revoke all on functions from anon,
authenticated` (`20260825210000`) does not remove PUBLIC's built-in grant. The
archived original had revoked PUBLIC and anon
(`migrations_archive/20260728120000:89-95`). Round 3's "checked / not checked"
list did not mention function grants.

The withholding is `p_withhold_house_letters`, a flag the caller supplies. So
any client that can execute the RPC can pass false. The fix, at the end of
migration `20260929200000` **[renamed to `20260930250000`, 2026-09-27 merge-train update]**:

- `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and
  `GRANT EXECUTE ... TO service_role` only. Unlike the archived original,
  `authenticated` is **not** granted again. The only callers are the gateway's
  service-role client: `conversations.service.ts` `listConversationThreads`
  and `reports.service.ts` `getReportCrossFile`, both through
  `DatabaseService` (`SUPABASE_SERVICE_ROLE_KEY`). `git grep
  list_conversation_threads -- apps services packages` finds no web, mobile or
  Python caller.
- `reports.service.ts` now passes `p_withhold_house_letters: true`
  explicitly, and `reports.service.spec.ts` pins it. It no longer relies on
  the default without saying so.

Proof (PGlite build of all 230 migrations, 2026-09-27; runs as superuser, no
Supabase platform, not production). Fixed: `has_function_privilege` is false
for anon, authenticated and a fresh role with no grants (so PUBLIC is shut),
and true for service_role. A call as anon or authenticated is refused 42501,
and a call as service_role runs. Control, with round 3's file as it was at
`e2cd28578`: all four roles hold EXECUTE.

**What this bounds.** In the control, a call as authenticated was *still*
refused: 42501 "permission denied for table procurement_conversations". OD-72
revoked client table grants, and the function is SECURITY INVOKER. So in the
migration-built database the missing revoke re-opened the first of two layers,
not a readable path. The audit's staff-JWT bypass was not reachable there.
Production's live grants were **not** queried in this round. OD-72's own
measurement also records that the product does not use Supabase Auth
(`20260825210000`, "WHY REVOKE RATHER THAN WRITE POLICIES").

## Approve refuses every house letter (2026-09-27, PR #476 train 5 BLOCK and round 6)

`POST /conversations/:id/approve` publishes `conversation.approved`, and the
Python `provider_conversation_agent` sends the vendor message itself on that
event. A house letter never leaves that way. It leaves only through
house-letters' dispatcher, which reads `HOUSE_QUEUED` after the undo window.

- **Train 5 BLOCK:** approve checked neither status nor type, so an owner or
  manager could approve a `HOUSE_DRAFT` or `HOUSE_CANCELLED` credit letter.
  The first fix (`16d995c33`) refused those two statuses, and its comment said
  they were "the only statuses" a `HOUSE_LETTER` row carries. **[Corrected
  2026-09-27, round 6: false. `LETTER_STATUS` (`house-letters.service.ts`) also
  has `HOUSE_QUEUED`, `HOUSE_FAILED` and `SENT`, and `queue()` moves the same
  row to `HOUSE_QUEUED`. Approving a queued letter reached the agent, whose
  claim did not refuse `HOUSE_QUEUED`, so the letter could be sent twice,
  around the undo window.]**
- **Now, gateway:** `approveConversation` refuses, before any write or publish,
  a row whose `outbound_email_type` is `HOUSE_LETTER` **or** whose status is in
  `HOUSE_LETTER_STATUSES` (`HOUSE_DRAFT`, `HOUSE_QUEUED`, `HOUSE_CANCELLED`,
  `HOUSE_FAILED`). `SENT` is not in the status set, because AI-path rows use it
  too. A sent house letter is caught by its type.
- **Now, agent (backstop for any other publisher):** the send claim and the
  stale-approval return-to-manager update both filter on
  `_CLAIM_REFUSED_STATUSES = _SEND_TERMINAL_STATUSES + _HOUSE_LETTER_STATUSES`.
- **Drift:** `conversations.service.spec.ts` and
  `test_conversation_agent_send_gates.py` each read `LETTER_STATUS` from source.
  Each fails if a `HOUSE_*` word is added there and not refused. CLAIMS row
  `ADR-0230-APPROVE-REFUSES-EVERY-HOUSE-LETTER` pins both halves statically.

**Not changed here:** `rejectConversation` and `editMessage` still have no
status guard. That was true before this PR, and neither one sends. Reject
publishes `conversation.rejected`, whose handler writes metadata only (audit
at `16d995c33`). A guard on either one is a separate change.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-25 | founder (round 5, item 31) | Locked: draft on requested, never auto-send |
| 2026-09-25 | W3-credits-team lane | Built on PR #476 |
| 2026-09-26 | PR #476 audit fix (BLOCK at 37a89291e, round 1, R1) | `drafts`/`discard` gated owner-or-manager, reconciling with ADR 0167 (see above) |
| 2026-09-26 | PR #476 audit fix (BLOCK at 032e5a43e, round 2, R1b/R2b) | Conversation reads, `queue`/`cancel` on a credit-linked letter, the LLM transcript and the procurement history ledger all withhold a `HOUSE_DRAFT`/`HOUSE_CANCELLED` row from anyone who is not owner or manager (see round 2 reconciliation above) |
| 2026-09-27 | PR #476 audit fix (BLOCK at 9d04c0fb6) | `GET /conversations/threads`, `GET /conversations/thread/:threadId` and `POST /conversations/:id/summarize` withhold the same rows from staff. The `list_conversation_threads` RPC gains `p_withhold_house_letters` (default true, migration `20260929200000` **[renamed to `20260930250000`, 2026-09-27 merge-train update]**). Round 2's "every read route" is corrected in place (see round 3 above). |
| 2026-09-27 | PR #476 audit fix (BLOCK at e2cd28578) | Migration `20260929200000` **[renamed to `20260930250000`, 2026-09-27 merge-train update]** revokes `list_conversation_threads` from PUBLIC, anon and authenticated, and grants EXECUTE to service_role only. `reports.service.ts` passes `p_withhold_house_letters: true` explicitly (see round 4 above). |
| 2026-09-27 | merge-train update | Migration renamed `20260929200000` → `20260930250000`: it was BEHIND a migration (`20260930100100`) that landed on `origin/main` first, which `check_migration_order.py` flags to keep `supabase db reset` from replaying it out of order. Citations updated in `CLAIMS.jsonl`, the two conversations source files, and this record (bracketed, not rewritten). |
| 2026-09-27 | PR #476 audit fix (train 5 BLOCK) | `approveConversation` refuses `HOUSE_DRAFT`/`HOUSE_CANCELLED` (`16d995c33`); its completeness comment was wrong (see "Approve refuses every house letter") |
| 2026-09-27 | PR #476 audit fix (BLOCK at 16d995c33, round 6) | Approve refuses every house letter by type or by any of the four `HOUSE_*` words; the agent's send claim refuses the same four. CLAIMS `ADR-0230-APPROVE-REFUSES-EVERY-HOUSE-LETTER` |
