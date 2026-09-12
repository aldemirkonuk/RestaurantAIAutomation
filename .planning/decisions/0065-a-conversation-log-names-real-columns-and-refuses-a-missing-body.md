# 0065 — A conversation log names real columns, and refuses a message with no body

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** procurement_conversations, email_headers, message_text, 42703, PGRST204, 23502, NOT NULL, conversation log, absence-as-health, communications.service
- **Links:** [[0056-order-paths-write-columns-that-exist]] (the guard this rides on, and the ADR that filed this defect as debt), [[0020-no-fabricated-answers]], [[0051-rebuilt-pages-show-live-data-only]], [[0057-receiving-write-path-integrity]], PR TBD

## Context

`CommunicationsService.storeOutboundConversation` (`apps/api-gateway/src/communications/communications.service.ts:452` on `origin/main` @ `1f4717cc`) inserted into `procurement_conversations` naming `sender_email`, `recipient_email`, `subject` and `message_body`.

**The table has none of the four.** Measured 2026-09-02 against production (`exzueerziesmczwlhomd`, `information_schema.columns`, not inferred from migrations): 36 columns, and the ones that matter here are `message_text text NOT NULL` and `email_headers jsonb DEFAULT '{}'`. So every call answered 42703/PGRST204 — and would have answered 23502 on the unwritten NOT NULL `message_text` even if the four names had been right.

A second NOT NULL was hiding behind the first. The payload wrote `provider_id: params.providerId || null`, and `provider_id` is `uuid NOT NULL`. The one call site passes `provider?.id` from `findProviderByEmail`, which returns `null` whenever the vendor address is not a known provider — the ordinary case for a first contact. That is a 23502 that would only have surfaced *after* the column names were fixed.

The only CHECK on the table is `chk_outbound_email_type` (an allow-list of ten values, NULL permitted). This write does not set `outbound_email_type`, so it is unaffected — but the constraint was enumerated rather than assumed, because [[procurement-conversations-schema-gotchas]] records it silently breaking a different write when code and constraint drifted.

**Production row count: 27** (17 `outbound`, 10 `inbound`, all `channel='email'`), and **not one of them came from this method.** Nothing is repairable, because nothing was written; this is class **O** in [[absence-reported-as-health]] — silent omission, where the damage cannot be enumerated and the only remedy is stopping the loss.

The silence had three layers, all of which reported health:

1. The service logged `logger.warn("Failed to store outbound conversation: ...")` and returned `{ data: null, error }`. A warn is a shrug.
2. The caller (`communications.controller.ts:492`, the `POST /test/scenario` endpoint) pushed `success: !convoError` into a `steps` array — technically honest, and read by nobody.
3. The handler then logged **"Messaging scenario completed successfully"** and returned `status: "scenario_executed"` unconditionally. The endpoint has never once had a successful step 2 and has always said it did.

The defect was already recorded as debt by [[0056-order-paths-write-columns-that-exist]], in `KNOWN_BAD_COLUMNS`. That entry names the method `logConversation`. **No method by that name has ever existed in this tree** — it comes from the guard's own self-test fixture (`scripts/check_order_capture_contract.py:940`), which invented the name. The real method is `storeOutboundConversation`. A debt entry that misnames its own site is a small instance of the same fault: the record was never checked against the thing it describes.

## Options considered

### The four fields

1. **Add the four columns in a migration.** Honest to the code as written, and wrong: `email_headers` already exists for exactly this, the inbound path already populates it, and two readers already thread on it. Adding `subject` would give the table two subjects that could disagree — `procurement.service.ts:2163` already reads `emailHeaders.subject || (conv as any).subject`, a phantom-column read that has always been `undefined`. Rejected: it widens a schema to accommodate a bug.
2. **Map onto `email_headers` with a new key convention** (`sender_email`/`recipient_email` inside the jsonb). Rejected: a second shape for one column is worse than the wrong shape, because both would be live.
3. **Map onto `email_headers` matching the live inbound path.** Chosen — see Decision.

### The NOT NULL body

1. **Store a placeholder** (`""`, `"(no body)"`, `"[empty]"`). Cheap, and it makes the row land. Rejected: a conversation body is rendered verbatim in `/communications` and summarised into the weekly manager email. A placeholder there is indistinguishable from a real short message, which is precisely the fabrication [[0020-no-fabricated-answers]] and [[0051-rebuilt-pages-show-live-data-only]] forbid — a value wearing the shape of a real one.
2. **Let the insert fail and report the 23502.** Honest, but it spends a round trip to learn something the process already knows, and the error text ("null value in column ... violates not-null constraint") is worse than one we can write ourselves.
3. **Refuse before the write, naming the field.** Chosen.

### The silence

1. **Throw.** Rejected: the email has already been sent by the time this runs. Failing the caller would report that the message did not go out, which is a *different* false statement, not a fix.
2. **Keep returning `{ data, error }` and log louder.** Better, and still weak: the existing call site proved a nullable `data` reads as uninteresting.
3. **Add an explicit `stored: boolean`, log at error level, and make the endpoint's own summary derive from its steps.** Chosen.

### Doing nothing

Costs the feature permanently. There is no accumulating corruption to argue urgency from — that is the point of class O, and the reason it is easy to defer forever.

## Decision

**The four phantom fields map onto the columns that exist, using the shape the live inbound path already writes; a NOT NULL column is never defaulted, only refused with a reason; and a failed log is loud without failing the send.**

Mapping:

| parameter | column |
|---|---|
| `body` (was `message_body`) | `message_text` — `text NOT NULL` |
| `subject` | `email_headers.subject` |
| `senderEmail` (was `sender_email`) | `email_headers.from` |
| `recipientEmail` (was `recipient_email`) | `email_headers.to` |

The shape is not invented. `rabbitmq-bridge.service.ts:756` (`handleInboundEmail`, the live inbound-email path) writes lowercase RFC-822 header names — `from`, `subject`, `message_id`, `in_reply_to`, `references` — alongside `gmail_thread_id` and `transport`. Production agrees: of the 27 rows, the 13 carrying `email_headers` use exactly that key set. `to` is the RFC name for the recipient and follows the same rule; inbound rows omit it only because the recipient there is us. Following the convention rather than inventing one also means these rows become readable by the threading code that already exists — `procurement.service.ts:2158/2738/2910/3330` and `apps/web/src/lib/conversationGrouping.ts` all key on `email_headers.subject`/`in_reply_to`/`references`.

The four snake_case parameter names are renamed to camelCase. They read like column names and were treated as such; the whole defect is that nobody looked past them. There is exactly one call site.

Refusal covers every NOT NULL column without a default that this write supplies: `restaurantId`, `providerId`, `direction`, `channel`, `body`. The method returns `{ stored: false, data: null, error: { message, code: "MISSING" } }` and attempts no insert, so the database never sees a row it would have to reject.

Loud vs quiet, deliberately:

- **Loud** — a DB error and a refusal both log at `error` with the table name, the PostgREST code, and the key set attempted; `stored` is `false`; the endpoint returns `status: "scenario_executed_with_failures"` with a `failedSteps` array and logs at error level.
- **Quiet** — the method still never throws, and the caller's other work is unaffected. A logging failure must not fail the operation it logs.

**No migration.** The columns exist; the code named the wrong ones.

## Consequences

- Outbound conversation rows can be written for the first time, and they thread with inbound rows because they share the header convention.
- A first-contact vendor (no `providers` row) is now refused with a named reason instead of a 23502. That is a *visible* limitation where there was an invisible one; whether such a conversation should be storable at all is a provider-model question, not a communications one.
- `KNOWN_BAD_COLUMNS` in `check_order_capture_contract.py` loses its four `procurement_conversations` entries, and the self-test fixture loses the `logConversation()` arm that existed only to satisfy them. The list is shrink-only in both directions, so leaving either would fail the guard.
- **Given up:** the four parameter names change, so any future caller written against the old signature breaks at compile time. That is the intent.
- **Not fixed, filed:** `procurement.service.ts:2163` reads `(conv as any).subject`, a column that has never existed — always `undefined`, harmless only because `emailHeaders.subject` precedes it in the `||` chain. Owned by a concurrent session.
- **Revisit if** an outbound path other than the test endpoint needs to log a conversation for an unknown provider. That is the signal that `provider_id NOT NULL` is the wrong constraint, not that the refusal is wrong.

## Verification

| Claim | Evidence |
|---|---|
| The four columns do not exist; `message_text` is NOT NULL; `email_headers` is jsonb | `information_schema.columns` on `exzueerziesmczwlhomd`, 2026-09-02 — 36 columns |
| The only CHECK is `chk_outbound_email_type` (10 values, NULL allowed) | `pg_constraint` on the same project, same day |
| 27 rows, none from this method | `select count(*)` + `jsonb_object_keys` census |
| Contract E already covers `procurement_conversations` — **agent A's generalisation is not required** | deleted the four entries against the *pre-fix* tree: exit 1, four findings, each naming `communications.service.ts:468` |
| The fix leaves the guard passing | `check_order_capture_contract.py` exit 0; `--self-test` exit 0 |
| The tests fail against the pre-fix tree | 13 of 14 fail with `origin/main`'s service restored in place; the 14th is the oracle-non-empty check, which must pass on both |

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created |
