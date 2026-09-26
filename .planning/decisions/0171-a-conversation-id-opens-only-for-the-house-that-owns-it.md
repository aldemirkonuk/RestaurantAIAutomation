# 0171 — A conversation id opens only for the house that owns it

- **Status:** Proposed. **Locked in part.** The scope (the six routes named below answer only for the caller's house, a foreign id is a 404 and never a 403) and "plus the role the approval needs" were directed by the founder in the 2026-09-19 fix brief. **Not yet decided by him, and marked as assumptions below:** that edit and reject take the same role as approve, that the by-id read and summarize take no role, and that a session naming no house is a 403.
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

**What was live and what was dormant.** `ConversationsService.publishEvent` posts to `/api/v1/events/publish`, a route the orchestrator does not serve, so in production every approve and reject already returned the dispatch failure and sent nothing. The write was not dormant. The rewrite of `manager_approved_message` and the status persisted, and `provider_conversation_agent.py:2813` sends `manager_approved_message or message_text` on any `conversation.approved` for that id. So a foreign rewrite is what a later legitimate approval by the owning house would send, and a real RabbitMQ publisher already exists (`OrchestratorService.publishEvent`, used by the non-production E2E route `communications.controller.ts:1004-1014`). The edit route is the sharpest of the six.

`by-order` and `by-provider` have the same shape and are fixed separately on `fix/conversations-by-order-tenant-scope` (unmerged, another session). This ADR does not touch them. **[AMENDED 2026-09-25, branch `fix/conversations-house-scope-r2`: that branch was never committed; its work is superseded here — see "Amendment 2026-09-25" below.]**

## Options considered

1. **A check in the controller only** (load the row, compare its house, then call the unchanged service). Cheap, and it leaves the service callable unscoped by the next caller (the mobile feed already calls it directly). It also reads then writes by id alone, so the write is unguarded.
2. **The house as a required argument on every service method, applied to every read and write** *(chosen)*. Forgetting the house is a compile error, and the write is filtered too.
3. **Row-level security.** The gateway uses the service-role key, which bypasses RLS, so it protects nothing here.
4. **403 for a foreign id.** Tells a caller the id exists in some other house. Rejected: ADR 0147 already answers a row that is not the caller's with the same 404 as a missing one.

## Decision

1. **The token names the house and every by-id conversations method takes it as a required argument.** Reads filter `restaurant_id`; the one writer, `updateOwned`, filters `id` and `restaurant_id` and reads the affected row back, so zero rows is a 404 and never a quiet success. `getConversation` returns null for a missing or foreign row, and a failed read throws.
2. **A row in another house answers 404**, identical to a missing id (a malformed id too, without reaching Postgres). `GET :id` and the other 500s on these routes now answer a fixed sentence instead of database text. The write routes are not covered: see "Named and not decided".
3. **`approve`, `edit` and `reject` require owner or manager**, through the existing class-level `RolesGuard`, which reads the role in the token's house (ADR 0162). This is the ADR 0116 rule (only a higher tier may approve) applied to the legacy conversation path.
4. **`pending/list` takes the house** and filters unconditionally.

**Assumptions I made and the founder has not decided:**

- Edit and reject share approve's gate. Edit is the same power as `modified_message`. Reject stops a manager's queued message, so staff could otherwise kill the approval queue.
- The by-id read, `pending/list` and `summarize` take **no role**, only the house, so staff keep reading their own house's vendor threads. Summarize spends a model call (ADR 0146); gating it is a separate call.
- A session that names no house is a **403**, not a 404, because the session is the fault and no id is involved.

## Named and not decided

- **Whether this legacy path must also require the ADR 0112 seal.** An open founder fork in the one-tap lane. Recorded, not decided, and this build does not touch it. **[DECIDED 2026-09-19 by [[0175-one-tap-from-the-notification-is-staged]] decisions 9 and 10: yes. `POST /conversations/:id/approve` takes the seal, which binds the exact recipients, CC and text, and needs owner, manager or a grantee, the same rule as `approveOrder`. Not built.]**
- **The write routes still return a service error string as a 400**, so raw database text (`updateOwned`'s error, `approveConversation`'s catch) and the event-bus text can reach an owner or manager of the caller's own house, and a database outage reads as a 400, not a 500. Identical on `origin/main`, not a regression, not fixed here. The adversary and correctness reviewers both found it.
- **`listConversations` and `getStats` fail open for a session that names no house** (`if (options.restaurantId)` / `if (restaurantId)`), and the controller passes `user.restaurantId` unchecked. A member removed from a house has `users.restaurant_id` cleared (`members.service.ts`, `team.service.ts`, `auth.service.ts`), so their next login names no house and would read every house's list and stats. The peer branch `fix/conversations-by-order-tenant-scope` makes `listConversations` throw without a house; nothing yet covers `getStats`. Not run end to end, and not fixed here. **[FIXED 2026-09-25, branch `fix/conversations-house-scope-r2`: see "Amendment 2026-09-25".]**
- `getPendingConversations` still turns a failed read into `[]` (its own `catch`). Same absence-as-health shape, separate from the scope fault, left alone here.
- `approve` does not check the conversation's current status, so a manager can approve a message already rejected. Not touched.
- The HTTP dispatch to `/api/v1/events/publish` is still dead. Whether to build the bus or retire these endpoints stays the open fork noted at `conversations.service.ts` `publishEvent`.

## Amendment 2026-09-25 — the list routes take the house too

**What changed.** On `origin/main` at `e754b3a27`, `GET by-order/:orderId` and `GET by-provider/:providerId` took no `@CurrentUser` and called `listConversations` with no house, and the service filtered the house only `if (options.restaurantId)`, so any signed-in caller who knew an order or vendor id read that house's vendor messages. `GET /`, `GET threads`, `GET thread/:threadId` and `GET stats/overview` passed `user.restaurantId` unchecked, and `getStats` also filtered only `if (restaurantId)`, so a session naming no house listed and counted every house's.

1. **All twelve handlers take the house from `houseOf(user)`.** A session naming no house is a 403 on every route, before any read (this extends Decision 1's assumption, "no-house = 403", to the list routes; ADR 0147 already answers a session naming no house that way on provider intelligence, PR #416).
2. **`listConversations` and `getStats` require the house** (`requireHouse`) and filter on it unconditionally; `ListConversationsOptions.restaurantId` is no longer optional.
3. **by-order and by-provider check the id first.** `assertOrderInHouse` / `assertProviderInHouse` read the order or vendor by `id` AND `restaurant_id`. A missing, foreign or malformed id answers the same 404, so the answer cannot confirm an id; a failed read is a 500 with a fixed sentence, never an empty list. This is the PR #416 shape for vendors. **A vendor row with no house is a 404** here, as it is on the provider-intelligence routes (founder 2026-09-25: each house owns its vendor rows; houseless rows are left alone and reported). Such a house's messages with that vendor stay reachable through `GET /conversations?providerId=`, which is house-filtered.
4. **A missing order or vendor id is now a 404 where it was a 200 with an empty list.** No web or mobile screen calls either route (`grep` over `apps/web/src` and `apps/mobile`, 2026-09-25).

**Rejected:** filtering the list only and answering a foreign id with an empty 200. It leaks nothing (a missing id also answers empty), but it is not the shape ADR 0147 row 51 already uses for vendor ids, and it leaves the two routes as the only by-id reads here that cannot say "not yours".

**Evidence.** Spec `conversation-lists-belong-to-the-callers-house.spec.ts`: 20 tests, 17 fail against `e754b3a27`'s controller and service; 9 of 9 code mutants killed. Claim `ADR-0171-CONVERSATION-LISTS-HOUSE-SCOPED` (static, 12 of 12 mutants fail it). The abandoned branch's open tripwire `ADR-0147-CONVERSATIONS-ID-ROUTES-UNSCOPED` was never committed to `main`, so there is no row to strike.

**Still not fixed:** the write routes' 400s carrying service text; `getPendingConversations` turning a failed read into `[]`; approve not checking current status; the ADR 0112 seal on approve (decided in ADR 0175, not built).

## Consequences

- Decision 3 is API-only today: no web or mobile screen calls approve, edit or reject. `ConversationApprovalNotification.tsx` is the only web caller, has no importer, and posts with bare `axios` and no auth header, so it could never have succeeded. The one-tap lane will be the first real caller and must send an owner or manager token. The founder should still confirm the role.
- The one-tap lane can no longer treat the six by-id routes as a cross-tenant hazard. It still needs its own answer on the seal.
- `getConversation`, `getPendingConversations`, `regenerateSummary`, `approveConversation`, `editMessage` and `rejectConversation` have new signatures. `MobileService.getFeed` already passed the house.
- Revisit if the founder answers the seal fork, or asks for staff to keep reject.

## Review trail

| Date | Who | What |
|---|---|---|
| 2026-09-19 | Aldemir (founder) | Directed the scope, the 404-not-403 answer and the role in the fix brief |
| 2026-09-19 | Claude | Built it. Spec `conversation-routes-belong-to-the-callers-house.spec.ts`: 23 of 29 tests fail against the unfixed controller and service, and 14 of 14 mutants (each house filter, the zero-row check, each `@Roles`, `RolesGuard`, `houseOf`, the 404 pass-through) are killed. The claim's static verify fails on `origin/main`. |
| 2026-09-19 | pr-audit-gate (Opus planner, two Sonnet reviewers) | Both reviewers approved d4822c196 and found: raw database text still reaches the client as a 400 on the write routes; `listConversations` and `getStats` fail open for a no-house session; the staff-403 consequence named a component nothing imports; one wrong line cite; and a claim verify that did not pin the zero-row check, `houseOf`, `requireHouse` or the UUID guard. All corrected or named above, and the verify now pins them. |
| 2026-09-25 | Claude (lane W2-conversations) | Amendment 2026-09-25: the six list routes take the house; by-order and by-provider 404 another house's id. Branch `fix/conversations-house-scope-r2`. |
