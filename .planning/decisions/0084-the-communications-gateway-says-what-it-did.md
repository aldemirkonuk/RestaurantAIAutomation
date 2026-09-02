# 0084 — The communications gateway says what it did, and the ledger sees its own rows

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** communications, open relay, SMS, Plivo, mock, procurement_conversations, getConversationHistory, PostgREST embed, inner join, allow-list, deny-list, absence-as-health, tenant isolation, websocket, inbound SMS
- **Links:** [[0065-a-conversation-log-names-real-columns-and-refuses-a-missing-body]] (the write half of the same phantom columns), [[0074-a-read-names-columns-that-exist]] (the guard that now covers the read half), [[0077-there-is-no-payment-due-reminder]] (fixed this ADR's C4 first — see Context), [[0020-no-fabricated-answers]], [[0051-rebuilt-pages-show-live-data-only]], [[0019-communications-controller-guards]], PR TBD

## Context

Six defects were filed against `apps/api-gateway/src/communications/**` and
`getConversationHistory`. Five are fixed here. One is **refused**, and the
refusal is the most important line in this document.

Every measurement below is against production `exzueerziesmczwlhomd`, 2026-09-02,
via `information_schema` and direct `select`, not inferred from migrations.

### The ledger, which is not what it was reported to be

`/communications` describes itself in `.planning/06-pages/communications.md` §12
as *the one place a manager sees every vendor conversation the system had on
their behalf*. `getConversationHistory` (`procurement.service.ts:~3598`) filtered
`status IN (AUTO_SENT, APPROVED, SENT, COMPLETED, CLOSED, SEND_UNCONFIRMED)`.

The brief said 15 of 27 conversations were invisible, because only `SENT` and
`APPROVED` overlap that list. **That is an understatement, and the reason it is
an understatement changes the fix.** Measured:

| | rows |
|---|---|
| `procurement_conversations`, all tenants | **27** |
| pass the status allow-list | 12 |
| survive `procurement_orders!inner` | **2** |
| **what the query actually returned** | **2** |

**25 of 27 rows carry `order_id IS NULL`.** The INNER embed dropped them before
the status filter was consulted, so the join — not the allow-list — was the
binding constraint. On the one real tenant it is **1 visible row out of 26**.

Widening the allow-list alone would have moved the count from **2 to 2** and
shipped as a fix, with a passing test, because a fixture of hand-made rows
cannot express a join it is not asked to model. That is [[absence-reported-as-health]]
aimed at the repair rather than the defect: the evidence would have come from a
source structurally incapable of producing the failing answer.

`draftContent: row.content` was the same shape one level down. **`content` is
NULL on all ten inbound rows in production** — their body is in `message_text`,
the `NOT NULL` column — so the page rendered *"No message body was recorded for
this exchange"* about ten messages whose bodies were recorded. The sibling
methods `getActiveConversations` and `getOrderConversations` have always read
`content ?? message_text`; this method was the odd one out.

An earlier report claimed inbound rows carry no status. They carry `DRAFT`: the
column's DEFAULT, which the inbound path never overwrites.

### Two open relays, of which only one could be closed

`POST /communications/email` (`:110`) and `POST /communications/sms` (`:137`)
each took `@Body()` and nothing else — no `@CurrentUser()`, no tenant, no
ownership check on the destination, and no record written. Any authenticated
user of any of the ten restaurants could send arbitrary content to any address
or number on earth from the platform's verified sender, leaving no trace. The
templated sibling route had `@Public()` removed under [[0019]] for exactly this
reason; the raw versions never did.

**`POST /communications/email` has a live caller.** Found by grep before the
deletion, not after:

```
services/agent-orchestrator/services/email_composer_service.py:354
  send_via_gateway() → POST {api_gateway_url}/communications/email
← agents/provider_conversation_agent.py:3074  (_send_message)
```

That is the path every approved vendor email travels. `POST /communications/sms`
has **no** caller anywhere — `apps/web`, `apps/mobile`, `packages`, `scripts`,
every `*.spec.ts`, and the Python orchestrator, which sends SMS through
`services/plivo_client.py` directly and has never used the route.

### An SMS nobody sent, reported as sent

`sms.service.ts:57` fell through to `mockSendSms` whenever `!isConfigured`, and
that method returned `{success: true, messageId: "mock_sms_…"}`. The daily
summary, low-stock alerts and order-approval requests therefore all reported a
successful delivery with a fabricated carrier id; `MultiChannelResultDto.success`
stayed true and `runPerTenant` counted the tenant succeeded.

Whether production has Plivo configured is **not known here** — Railway's
environment is separate and was not read. The fix is correct either way, which
is why it did not wait on the answer.

### Two fabrications, and a comment that reported a fix it did not contain

`scheduled-tasks.service.ts` returned `deliveriesToday: 0` with the comment
"Would need to query deliveries table", and `sms.service.ts:144` texted it to
the manager in a list beside two figures that *are* read from the database. A
reader cannot tell which of the three was measured.

`sms.service.ts:122` said *"Reply REORDER to auto-order"* and `:183` *"Reply YES
to approve or NO to decline."* **There is no inbound SMS handler in this
repository** — no Plivo message webhook, no route, no consumer. A manager who
replied YES believed they had approved a purchase, and got silence.

The doc-comment on `getDailySummaryData` (`:1009-1018`) claimed the method "now
throws, so the tenant is counted failed", and the body contains no `throw` — the
observation that produced this filing. **The comment is right and the reading of
it was wrong**, which is worth recording because the misreading was reasonable:
`DatabaseService.getLowStockItems` and `.getProcurementOrders` each end
`if (error) throw error`, so a failed read propagates out of the method. The
`|| 0`s are reached only on a *successful* read that found nothing.

### C4 was fixed by someone else while this was in flight

The weekly report's `getRecentConversationSummaries` selected `message_body,
subject` from `procurement_conversations`, which has neither — the same two
phantom names [[0065]] removed from the write side. That defect is **real and was
already repaired on `main`** by [[0077]] (#241), together with [[0074]]'s
`check_read_columns_exist.py`, between this branch's creation and its rebase.
What remains here is the part that fix did not cover, and it is small; see
Decision. Recording it as newly fixed would have been the easiest false claim in
this document to make.

## Options considered

### The ledger's filter

1. **Widen the status allow-list.** The obvious fix, and measurably worthless on
   its own: 2 rows before, 2 rows after. Rejected as *incomplete*, not wrong.
2. **Drop every filter and show all 27.** Rejected: `PENDING_APPROVAL` rows are
   live in the approval queue on `/orders` (`getActiveConversations` selects
   exactly that status), and an unsent draft appearing in two live places invites
   a second send of an email already awaiting approval.
3. **Keep an allow-list, but a longer one.** Rejected on the failure mode rather
   than the contents. `DISCARDED` and `CANCELLED` both post-date the original
   list and vanished without a word; the next status value will do the same. An
   allow-list makes invisibility the default for anything new, which is the
   fault this ADR is about, expressed in a vocabulary.
4. **Invert it: a deny-list naming what is live elsewhere.** Chosen.

### The embed

1. **Keep `!inner` and accept that unattached conversations are out of scope.**
   Rejected: it excludes every inbound vendor reply in production, and the page
   is defined as the place inbound replies are read.
2. **Make it `!left`.** Chosen. A conversation not attached to a purchase order
   is still a conversation. `orderNumber`, `quantity` and `wineName` become null
   on those rows, which the page already renders.

### The raw relay routes

1. **Delete both, as decided.** Not possible: `/communications/email` has a live
   caller and deleting it stops vendor mail.
2. **Delete `/sms`, keep `/email` with the hole recorded.** Chosen.
3. **Delete `/email` too and repoint the orchestrator at a new authenticated
   route.** Rejected *here*: giving the orchestrator a caller identity is a
   service-to-service authentication decision, not a repair, and it belongs to
   the founder. Filed.
4. **Guard `/email` with a tenant check instead.** Rejected: the orchestrator
   sends no `Authorization` header at all today, so any check tight enough to
   close the hole also breaks the caller. Same fork, dressed up.

### The unsent SMS

1. **Return `{success: false, error: "SMS not configured"}` and drop the log.**
   Rejected: the printed message is genuinely useful in development.
2. **Return failure, keep the log, drop the fabricated id.** Chosen.
3. **Keep `success: true` but add a `mocked: true` flag.** Rejected: every
   existing caller reads `success`, so the flag would be a second truth nobody
   consults — the shape [[0065]] rejected for `{data, error}`.

### `deliveriesToday`

1. **Query a deliveries table.** Rejected by the founder in favour of the
   subtraction. A shorter true message beats a longer one with an invented line.
2. **Send `—` or "unknown".** Rejected: 160 characters is not the place to
   explain an absence.
3. **Drop the line.** Chosen.

### The doc-comment vs the code

1. **Make the method `throw` explicitly so the comment becomes literally true.**
   Rejected: it would add a redundant throw to satisfy a sentence.
2. **Correct the comment to name where the throw comes from.** Chosen.

## Decision

**A send reports what happened; a ledger fails toward showing too much; and a
route with a live caller is not deleted because it is dangerous.**

Concretely:

1. **`POST /communications/sms` is deleted**, with `SendSmsDto`. Zero callers,
   verified across every surface before deletion.
2. **`POST /communications/email` is kept**, with the hole, the caller and the
   unmade decision written into the handler's doc-comment and pinned by a test
   so a later sweep cannot remove it without reading why.
3. **An unconfigured SMS provider returns `{success: false, error: "SMS not
   configured"}` and no `messageId`.** The developer log lines stay; a
   fabricated carrier id does not, because it is exactly the string a human
   would later hand the carrier.
4. **The low-stock alert's broadcast room is derived from the JWT.** A body
   `restaurantId` that disagrees is refused with 400, never silently rewritten.
5. **The weekly summary's descriptor falls back to a `message_text` preview**
   when a row has no `email_headers.subject`, and the genuinely-empty branch
   logs that the read *succeeded*.
6. **The conversation ledger left-joins `procurement_orders`, denies instead of
   allows, and reads `content ?? message_text`.**

The ledger's exclusions, in full:

| Withheld | Why |
|---|---|
| `status = PENDING_APPROVAL` | Live in the approval queue on `/orders` |
| `status = DRAFT` **and** `direction = outbound` | Our own unsent draft, same queue |

Nothing else. `DISCARDED` (3), `CANCELLED` (1) and `APPROVED` (2) are shown —
"we drafted this and killed it" is part of the record of what happened with a
vendor. `DRAFT` **inbound** is shown: those ten rows are received mail wearing a
column default that describes us, not them, and they were the single largest
thing missing from the page. A status this code has never seen is shown.

Both filters are written `status.is.null,<test>` because `neq` against a NULL
evaluates to NULL and *excludes* the row — backwards for a deny-list, where an
absent or unrecognised status is the case most worth seeing. `status` is
nullable, so this is reachable.

`direction` is added to the response payload. `/communications` is owned by a
concurrent change and was not touched; the field is additive, and the page's
`sendState` already maps `DRAFT` and `PENDING_APPROVAL`, so the widened set
renders without it. Labelling inbound rows as inbound is that change's to make.

**Not decided here, filed for the founder:** how the agent orchestrator
authenticates to the gateway. Until that exists, `/communications/email` stays
open to any authenticated user of any tenant and writes no record. This ADR
does not close that hole and does not claim to.

## Consequences

- The main tenant's ledger goes from **1 visible conversation to 25** (26 rows,
  less the one `PENDING_APPROVAL`). Every inbound vendor reply appears for the
  first time, with a body instead of "No message body was recorded".
- **Currently-green runs turn red**, by design: any code path that treated an
  unconfigured SMS as delivered now reports failure. `MultiChannelResultDto.success`
  goes false, and `runPerTenant` counts the tenant failed where it counted it
  succeeded.
- The daily-summary SMS loses a line and the API loses a required DTO field
  (`DailySummaryDto.deliveriesToday`). Removed rather than made optional: an
  accepted-and-ignored parameter is the next reader's false lead.
- **Given up:** `SmsService.sendDailySummary` and
  `CommunicationsService.sendDailySummary` change signature, so a caller written
  against the old one breaks at compile time. That is the intent.
- **A hole is now written down instead of merely present.** `/communications/email`
  is documented as unsafe in the code that serves it. That is worse than closed
  and better than silent.
- No debt entry is retired. [[0074]]'s `KNOWN_BAD_READ_COLUMNS` still holds 13,
  including `procurement_conversations.manager_approval_status` at
  `communications.controller.ts:881` — a route this change did not touch. The
  `message_body`/`subject` entries were already retired by [[0077]].
- **No migration.** Every column named here exists.
- **Revisit if** the orchestrator gains a caller identity — that is the signal
  that `/communications/email` can finally be deleted or properly guarded.

## Verification

| Claim | Evidence |
|---|---|
| 27 conversation rows; 12 pass the status filter; **2** survive the inner join; 2 is what the query returned | `select` against `exzueerziesmczwlhomd`, 2026-09-02 |
| 25 of 27 carry `order_id IS NULL`; the main tenant holds 26 rows and saw 1 | same, grouped by `restaurant_id` |
| `content` is NULL on all 10 inbound rows; `message_text` is populated on all 27 | same, `count(*) FILTER` census |
| 13 of 27 carry a non-empty `email_headers.subject` (10 inbound, 3 outbound) | same |
| **No conversation row is within the weekly report's 7-day window right now**, so this week's email will still omit the section — honestly | same, `created_at >= now() - interval '7 days'` = 0 for every group |
| `procurement_conversations` has no `message_body` and no `subject`; body is `message_text NOT NULL`; subject lives in `email_headers jsonb` | `information_schema`, and `20260805000000_baseline_from_production.sql` |
| `POST /communications/email` has a live caller | `email_composer_service.py:354` ← `provider_conversation_agent.py:3074` |
| `POST /communications/sms` has none | grep over `apps/`, `packages/`, `scripts/`, `services/`, all specs |
| No inbound SMS handler exists | route-shaped grep over `apps/` and `services/`, comment lines excluded — asserted as a **test**, so adding one turns it red |
| `assertTenantMatch` already refused a mismatched body `restaurantId` | `auth/guards/jwt-auth.guard.ts` → `common/tenant/assert-tenant-match.ts`; C3's fix is defence in depth and a pin, **not** a live hole closed |
| `getDailySummaryData` does propagate a read failure | `database.service.ts:61` and `:106`, both `if (error) throw error` |
| The tests fail against the pre-fix tree | 28 of 36 fail with the six files restored from `HEAD` in place (never `git stash`); headline `Expected length: 26 / Received length: 2` |
| [[0074]]'s guard covers the C4 defect and this tree satisfies it | `check_read_columns_exist.py` exit **0**; with `message_body, subject` restored in place, exit **1** naming `scheduled-tasks.service.ts:1289` twice |
| The guard's own self-test and Contract E still pass | `--self-test` exit 0; `check_order_capture_contract.py` exit 0 |
| Nothing else broke | `npx jest` over `apps/api-gateway`: **1740 passed / 0 failed / 14 skipped** across 138 suites, up from 1690 passed on the rebase base; `tsc --noEmit -p tsconfig.spec.json` exit 0 |
| Five of this ADR's eight CLAIMS rows discriminate | with `sms.service.ts`, `communication.dto.ts` and `procurement.service.ts` restored from the base in place, `check_decision_claims.sh` reports **REGRESSED (5)**; restored, 130 of 130 hold. The five are comment-blanked greps, because each fix's own comment quotes the string it removed |
| The ADR number is free | `check_adr_numbers_unique.py` across **501 refs**, run after a first attempt at **0082 collided** with `fix/communications-page` — swept again immediately before the push |

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created |
