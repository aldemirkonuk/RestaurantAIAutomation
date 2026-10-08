## A failed sender lookup filed a known vendor's reply as a prospect, or lost it — CLOSED — 2026-10-08

Filed and closed by `claude/laughing-hopper-ofbojk`. Decision: [ADR 0310](../decisions/0310-a-vendor-reply-whose-sender-cannot-be-read-is-parked.md). Claim: `../decisions/claims.d/claude-laughing-hopper-ofbojk.jsonl:1`.

**What was wrong at `be9a16c`.** `RabbitMqBridgeService.handleInboundEmail` step 1 (`apps/api-gateway/src/common/orchestrator/rabbitmq-bridge.service.ts:668-679`) built `providerQuery` and ran `const { data: providers } = await providerQuery.limit(1);`, discarding `error`. A failed read gave `provider === undefined`, and the cold-email branch (`:680-766`) filed the reply as a prospect (attachment or promotional) or logged `no provider found (not leaded)` and returned. Nothing redelivers it (ADR 0310, Context).

**Fixed.** Three attempts (`readProviderForSender`; a throw counts as a failed read), then `parkUnattributedInbound` writes `dead_letter_queue` and the handler returns. Gmail mail is parked as a pointer with no raw mail in it. Webhook mail is parked as its whole envelope. A failed park logs `NOT STORED` with the ids. Spec: `a-failed-sender-lookup-is-not-a-stranger.spec.ts`, 8 cases, 7 red on `be9a16c`. 13 of 13 source mutants were killed.

**Verification gap, stated.** registry.npmjs.org is blocked in the sandbox this was written in, so jest did not run there. The specs ran under a local ts-node harness: a jest-compatible subset with stubs for the missing packages, in the session scratchpad and not committed. The same harness ran 31 existing specs that touch the changed services, on this branch and on a clean `be9a16c` worktree. It found one regression (next entry), and the failing sets were otherwise identical. CI's jest run is the first real one.

## The read-error guard could not see a query held in a variable — CLOSED — 2026-10-08

Filed and closed by `claude/laughing-hopper-ofbojk`. Claim: `../decisions/claims.d/claude-laughing-hopper-ofbojk.jsonl:2`. [ADR 0067 amendment](../decisions/0067-a-failed-read-is-never-an-empty-one.md) of the same date.

`scripts/check_read_errors_not_swallowed.py` matched the supabase chain only inside the destructuring statement. It now follows a bare, uncalled identifier to its nearest enclosing declaration. On `be9a16c` that found 7 sites, none baselined, and all 7 are fixed here:

- `rabbitmq-bridge.service.ts` providers/providers: the entry above.
- `goals.service.ts` procurement_orders/data (`purchase_spend`, `:865-872` at `be9a16c`): a failed read summed to "bought nothing". It now throws `WholeReadError`, which `computeMetricWithSeries`'s catch passes through. Its read is still unranged (ADR 0292's half stays open).
- `prospects.service.ts` email_prospects/existing (`:178-185`): on a failed dedup read, the insert that `uq_prospect_domain` / `uq_prospect_triage_domain` refuses still returned `captured: true, isNew: true`, so the bridge announced a prospect that was never written. It now returns `captured: false` and writes nothing.
- `distributor-discovery.service.ts` restaurants/restaurant (`:99-104`, `:149`): a failed read read as "not geocoded". The response now carries `originUnreadable` (gateway and web type).
- `procurement.service.ts` procurement_conversations/data (`newerReplyStillAnalyzing`, `:9045-9055`): the send and deal-commit gate opened on a failed read. It now answers 503.
- `team.service.ts` team_certifications/data and time_off_requests/data (`listCertifications`, `listTimeOff`): a failed read listed nothing. Each now answers 500 in words.

Spec: `apps/api-gateway/src/common/a-query-held-in-a-variable-binds-its-error.spec.ts`, 11 cases, 7 red on `be9a16c`; 11 of 11 mutants killed. Baseline: 149 rows, 149 sites, 0 added, 0 allowlisted.

**A vacuous test the fix exposed.** In `team-pay-round4.spec.ts`, "the team views still leave them out: … the manager's leave list" seeded a `time_off_requests` row with no `created_at`. The stub answers `.order("created_at")` on such a table with 42703 (`team/testing/supabase-stub.ts:365-377`), and the swallowed error made the test pass on an unread table. The fixture now carries `created_at` (`NOT NULL` in production), so the test passes on the departure filter.

**Still invisible to the guard:** a builder passed as a parameter or held on `this`; a helper-returned builder or `{ data, error }` whose caller drops `error`, e.g. `communications.controller.ts:549-553` → `findProviderByEmail`; and a conditional await.

## A mirrored reply from a vendor-book contact address takes the cold-email path — OPEN — 2026-10-08

Filed by `claude/laughing-hopper-ofbojk` (found by the ADR 0310 adversarial pass, not fixed here). Claim: `../decisions/claims.d/claude-laughing-hopper-ofbojk.jsonl:3`.

The house inbox mirrors only senders in the vendor book (`house-inbox.service.ts:436-447`). The book is `providers.contact_email`, `providers.primary_contact.email` and `provider_contacts.email` (`house-letters.service.ts:485-541`). `handleInboundEmail` matches `contact_email` only (`rabbitmq-bridge.service.ts`, `readProviderForSender`). So a reply from a contact address in the book reads successfully as "no provider" and is filed as a prospect or dropped. No read failure is involved.

## handleInboundEmail still drops the mail when its own insert fails, and its dedupe read fails open into a duplicate — OPEN — 2026-10-08

Filed by `claude/laughing-hopper-ofbojk`. Claim: `../decisions/claims.d/claude-laughing-hopper-ofbojk.jsonl:4`.

- A failed `procurement_conversations` insert logs `DB insert failed` and returns (`rabbitmq-bridge.service.ts:873-878` at `be9a16c`). The mail is lost the same way a failed lookup lost it. `parkUnattributedInbound` could take it; that was left out to keep this branch to the lookup.
- The step-3 dedupe read (`:827-839`, baselined as `procurement_conversations::existing`) reads a failure as "not stored yet". No index makes `procurement_conversations.gmail_message_id` unique (no `UNIQUE` on it in `supabase/migrations/`), so a redelivered message (force-fetch overlap, or a re-publish) is then stored twice, and on an order the responder drafts twice.
- PR #661 owns the step-2 thread read (`::outbound`). This branch does not touch it.

## The bridge consumer acks before its handler settles, and nothing replays a parked mail — OPEN — 2026-10-08

Filed by `claude/laughing-hopper-ofbojk`. Claims: `../decisions/claims.d/claude-laughing-hopper-ofbojk.jsonl:5` and `:6`.

- `route.handler(body, …)` is not awaited, and the message is acked on the next line (`rabbitmq-bridge.service.ts:374-375` at `be9a16c`). So every failure inside a handler is final, and when the database refuses the park too, the mail is lost (ADR 0310, option 4).
- Nothing reads `dead_letter_queue` rows with `agent_name = 'api-gateway.rabbitmq-bridge'`. Recovery is manual, as described in ADR 0310's Consequences.
