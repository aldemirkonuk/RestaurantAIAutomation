# 0171 — A conversation id opens only for the house that owns it

- **Status:** Proposed. **Locked in part.** The scope (every by-id conversations read and write answers only for the caller's house, a foreign id is a 404 and never a 403) and "plus the role the approval needs" were directed by the founder in the 2026-09-19 fix brief. **Not yet decided by him, and marked as assumptions below:** that edit and reject take the same role as approve, that the by-id read and summarize take no role, and that a session naming no house is a 403.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder) for the scope; the role extension awaits him.
- **Keywords:** conversations, approve, reject, edit message, summarize, pending/list, tenant scope, cross-tenant, 404 not 403, RolesGuard, manager_approved_message, procurement_conversations, one-tap, ADR 0112 seal, D4
- **Links:** [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] (the rule), [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]] (who may approve), [[0162-managers-grant-manager-or-staff-on-both-doors]] (the role is the role IN this house), `v3.0-TECH-DEBT.md` 44.1v, claim `ADR-0171-CONVERSATION-ROUTES-HOUSE-SCOPED`

**Number:** 0171, from `check_adr_numbers_unique.py` (swept 930 refs). Peer worktrees hold uncommitted 0161, 0164, 0166, 0167 and 0170.
**Index row:** not added to `decisions/README.md` here; that file is gate-owned (the ADR 0162 precedent).

## Context

Found 2026-09-19 by the one-tap notifications adversary pass (defect D4). On `origin/main` at `1fba79f57`, `ConversationsController` sat behind `@UseGuards(JwtAuthGuard)` alone (`conversations.controller.ts:48`), and six of its routes acted on a bare id or on every house:

| Route | Controller | Service (`conversations.service.ts`) | Shape |
|---|---|---|---|
| `POST :id/approve` | `:390` | `approveConversation :660`, update `:693-696` | writes status, `manager_approved_message` (client-supplied `modified_message`), publishes `conversation.approved` |
| `PUT :id/message` | `:444` | `editMessage :755`, update `:769-772` | rewrites `manager_approved_message` |
| `POST :id/reject` | `:494` | `rejectConversation :790`, update `:810-813` | writes status, publishes `conversation.rejected` |
| `POST :id/summarize` | `:291` | `regenerateSummary :468`, read `:471-475` | reads by id, publishes `email.summarize.requested` |
| `GET :id` | `:351` | `getConversation :581`, read `:604` | reads the whole vendor thread by id |
| `GET pending/list` | `:327` | `getPendingConversations :622`, filter `:636` `if (restaurantId)` | the controller passed no house, so it listed every house's |

Any signed-in user of any house who held a conversation id could read, rewrite, approve or reject another house's vendor message. `getConversation`'s not-found was also unreachable: `.single()` on no rows errors, so a missing id answered a 500 carrying database text.

**What was live and what was dormant.** `ConversationsService.publishEvent` posts to `/api/v1/events/publish`, a route the orchestrator does not serve, so in production every approve and reject already returned the dispatch failure and sent nothing. The write was not dormant. The rewrite of `manager_approved_message` and the status persisted, and `provider_conversation_agent.py:2813` sends `manager_approved_message or message_text` on any `conversation.approved` for that id. So a foreign rewrite is what a later legitimate approval by the owning house would send, and a real RabbitMQ publisher already exists (`OrchestratorService.publishEvent`, used by the non-production E2E route `communications.controller.ts:1008`). The edit route is the sharpest of the six.

`by-order` and `by-provider` have the same shape and are fixed separately on `fix/conversations-by-order-tenant-scope` (unmerged, another session). This ADR does not touch them.

## Options considered

1. **A check in the controller only** (load the row, compare its house, then call the unchanged service). Cheap, and it leaves the service callable unscoped by the next caller (the mobile feed already calls it directly). It also reads then writes by id alone, so the write is unguarded.
2. **The house as a required argument on every service method, applied to every read and write** *(chosen)*. Forgetting the house is a compile error, and the write is filtered too.
3. **Row-level security.** The gateway uses the service-role key, which bypasses RLS, so it protects nothing here.
4. **403 for a foreign id.** Tells a caller the id exists in some other house. Rejected: ADR 0147 already answers a row that is not the caller's with the same 404 as a missing one.

## Decision

1. **The token names the house and every by-id conversations method takes it as a required argument.** Reads filter `restaurant_id`; the one writer, `updateOwned`, filters `id` and `restaurant_id` and reads the affected row back, so zero rows is a 404 and never a quiet success. `getConversation` returns null for a missing or foreign row, and a failed read throws.
2. **A row in another house answers 404**, identical to a missing id (a malformed id too, without reaching Postgres). Database text no longer leaves in a 500 on these routes.
3. **`approve`, `edit` and `reject` require owner or manager**, through the existing class-level `RolesGuard`, which reads the role in the token's house (ADR 0162). This is the ADR 0116 rule (only a higher tier may approve) applied to the legacy conversation path.
4. **`pending/list` takes the house** and filters unconditionally.

**Assumptions I made and the founder has not decided:**

- Edit and reject share approve's gate. Edit is the same power as `modified_message`. Reject stops a manager's queued message, so staff could otherwise kill the approval queue.
- The by-id read, `pending/list` and `summarize` take **no role**, only the house, so staff keep reading their own house's vendor threads. Summarize spends a model call (ADR 0146); gating it is a separate call.
- A session that names no house is a **403**, not a 404, because the session is the fault and no id is involved.

## Named and not decided

- **Whether this legacy path must also require the ADR 0112 seal.** An open founder fork in the one-tap lane. Recorded, not decided, and this build does not touch it.
- `getPendingConversations` still turns a failed read into `[]` (its own `catch`). Same absence-as-health shape, separate from the scope fault, left alone here.
- `approve` does not check the conversation's current status, so a manager can approve a message already rejected. Not touched.
- The HTTP dispatch to `/api/v1/events/publish` is still dead. Whether to build the bus or retire these endpoints stays the open fork noted at `conversations.service.ts` `publishEvent`.

## Consequences

- A staff member who approved or rejected through `ConversationApprovalNotification.tsx` now gets a 403. That is the intent of decision 3, and the founder should confirm it.
- The one-tap lane can no longer treat this path as a cross-tenant hazard. It still needs its own answer on the seal.
- `getConversation`, `getPendingConversations`, `regenerateSummary`, `approveConversation`, `editMessage` and `rejectConversation` have new signatures. `MobileService.getFeed` already passed the house.
- Revisit if the founder answers the seal fork, or asks for staff to keep reject.

## Review trail

| Date | Who | What |
|---|---|---|
| 2026-09-19 | Aldemir (founder) | Directed the scope, the 404-not-403 answer and the role in the fix brief |
| 2026-09-19 | Claude | Built it. Spec `conversation-routes-belong-to-the-callers-house.spec.ts`: 23 of 29 tests fail against the unfixed controller and service, and 14 of 14 mutants (each house filter, the zero-row check, each `@Roles`, `RolesGuard`, `houseOf`, the 404 pass-through) are killed. The claim's static verify fails on `origin/main` and kills 11 of 11 mutants on scratch copies. |
