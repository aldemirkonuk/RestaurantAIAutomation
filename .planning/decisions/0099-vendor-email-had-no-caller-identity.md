# 0099 — The vendor-email route had no caller identity, and no caller either

- **Status:** Locked — the last open fork (4xx classification, below) was
  answered by the founder, lane answers batch 4, 2026-09-19: "relay 4xx =
  split by code (400/403/422 final, 401 parks)". Narrowed 2026-09-21: the
  same founder corrected what "definite" means for 400/403/422 — CLOSE, not
  release for retry (see the bracket below and the review trail).
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** communications, vendor email, service-to-service auth, ADMIN_API_KEY, X-Admin-Key, JwtAuthGuard, forbidNonWhitelisted, SendEmailDto, threading, In-Reply-To, fail-closed, absence-as-health, blast radius
- **Links:** [[0084-the-communications-gateway-says-what-it-did]] (corrected here — its keep-the-route justification), [[0019-communications-controller-guards]] (the guard that broke the caller, and the @Public()+non-JWT pattern reused here), [[0020-no-fabricated-answers]], PR TBD

## Context

`POST /api/v1/communications/email` is the route the Python orchestrator uses to
send approved vendor email. Two faults sat on the same call.

### F1 — 401 since 2026-08-25

`fdaa7fa0` (**2026-08-25**, PR #60, OD-20) added a class-level
`@UseGuards(JwtAuthGuard)` to `CommunicationsController`. Confirmed, not
assumed:

```
git log -S '@UseGuards(JwtAuthGuard)' -- apps/api-gateway/src/communications/communications.controller.ts
  fdaa7fa0  fix(security): guard five controllers reachable without authentication (OD-20) (#60)
```

The only caller is `email_composer_service.py:332` (`send_via_gateway`), reached
from `provider_conversation_agent.py:3074` (`_send_message`). It sent **no**
`Authorization` header and no credential of any kind. From that commit onward
the call was refused before the handler ran.

It failed quietly for a second reason. A Nest error body carries `statusCode`
and `message`, never `error`, so `result.get("error", "Unknown error")` turned
every 401 into the literal string **"Unknown error"** — and `_send_message`'s
caller then classified that as *ambiguous* (`_is_definite_send_refusal` returns
`False` for anything unrecognised) and **parked** the conversation as
`SEND_UNCONFIRMED` rather than releasing it. The most diagnostic fact about the
failure was discarded by the code that had it.

### F2 — 400, even with a token

`main.ts:51-57` installs `ValidationPipe({ whitelist: true,
forbidNonWhitelisted: true, transform: true })`. `SendEmailDto` declared
`to, subject, bodyHtml, bodyText?, cc?, bcc?` and nothing else. The caller adds
four more when replying (`email_composer_service.py:345-352`): `replyTo`,
`threadId`, `inReplyTo`, `references`. Under `forbidNonWhitelisted` an
undeclared field is not stripped — it is a 400. So a threaded reply had a second
independent reason to fail.

**Was the caller inventing fields?** No, and this is settled from the code, not
from convenience. `EmailOptions` (`gmail.service.ts:36-48`) has always declared
`replyTo`, `threadId`, `inReplyTo`, `references`, `messageIdHeader`;
`createMimeMessage` (`:596-633`) has always emitted `Reply-To`, `In-Reply-To`
and `References`; `users.messages.send` has always been handed `threadId`
(`:181-184`). Every layer supported threading except the DTO. The contract was
narrower than the thing it fronted.

### F3 — found while fixing F2

The handler never forwarded those fields to `GmailService`, and never returned
`threadId`. `EmailResult.threadId` was populated (`gmail.service.ts:198`) and
dropped on the way out. The caller stores `send_result["thread_id"]` as
`gmail_thread_id` and feeds it back on the next reply
(`provider_conversation_agent.py:3090`), so even with F1 and F2 fixed, every
reply would have opened a fresh Gmail thread.

### Blast radius: ZERO messages lost, and that is the finding

The expectation going in was an accumulation of stalled outbound rows since
2026-08-25. **There is none.** Measured against production
`exzueerziesmczwlhomd` on 2026-09-02:

| | |
|---|---|
| `procurement_conversations` rows, all tenants | 27 |
| outbound rows | 17 |
| outbound rows created on/after 2026-08-25 | **0** |
| newest row of any direction | **2026-08-16 11:15:45+00** |
| outbound rows with `delivery_status` set | **0** |
| outbound rows with an RFC-5322 `message_id` | **0** |
| outbound rows whose `email_headers` carry `gmail_message_id` | **0** |
| distinct `email_headers` keys across all 17 | `subject`, `in_reply_to`, `references` |
| rows in `agent_activity_logs` | **0** |

The last two rows are the decisive ones. On success this Python path writes a
distinctive shape — `message_id` of the form `<wineops-…@wineops.ai>`,
`email_headers` containing `{message_id, gmail_message_id, gmail_thread_id,
in_reply_to, references}`, and `delivery_status='sent'`
(`provider_conversation_agent.py:3078-3098`). **Not one production row has it.**
All 17 carry the three-key shape written by
`procurement.service.ts:3469` / `:3898`, which calls `GmailService` **in
process** and never touches this HTTP route.

So: no vendor email was lost to the 401, because no vendor email has ever
travelled this route in production. Real vendor mail goes through the
gateway-native path. The orchestrator appears not to be running in production at
all (`agent_activity_logs` is empty). The faults are **latent, not active** —
they fire the first time the orchestrator is deployed.

### The correction this forces on [[0084]]

[[0084]] kept this route — over a documented preference to delete it as an open
relay — on the strength of one sentence: *"That is the path every approved
vendor email travels."* Both halves are wrong. It was not live (401 for eight
days by the time 0084 was written on 2026-09-02), and it is not the path vendor
email travels (0 of 17 rows). 0084's own Verification table lists the claim as
`POST /communications/email` has a live caller | `email_composer_service.py:354`
← `provider_conversation_agent.py:3074` — a **grep result**, presented as a
statement about runtime. The grep was correct; the inference was not.

This is the `absence-reported-as-health` shape one turn further out: a caller
that exists in source was read as a caller that works, because nothing asked the
database whether it had ever succeeded. 0084's decision is not reversed here —
the route is still kept — but it is now kept for a reason that was checked.

## Decision

**D1. The orchestrator authenticates with the service key both sides already
share.** `X-Admin-Key: $ADMIN_API_KEY`, verified by a new `ServiceKeyGuard`
(`apps/api-gateway/src/auth/guards/service-key.guard.ts`) applied to that one
route.

**D2. Both ends fail closed.** An unset or empty `ADMIN_API_KEY` **denies** at
the guard and **refuses to send** at the caller. No unauthenticated fallback.

**D3. The DTO widens to what `GmailService` already supports.** `replyTo`,
`threadId`, `inReplyTo`, `references` on `SendEmailDto`; `threadId` on
`CommunicationResultDto`; the handler forwards and returns them. Whitelisting is
**not** relaxed — a field outside the contract is still a 400.

**D4. A non-200 names its status.** `gateway refused the send: HTTP {status} —
{detail}` replaces `"Unknown error"`.

## Rationale, and what was rejected

**Why `@Public()` on a route we are securing.** Nest runs class guards before
method guards and requires *all* of them to pass, so a method-level guard can
only ADD to `JwtAuthGuard` — it can never stand in for it. `@Public()` is how
this controller already expresses "authenticated, but not by a user JWT":
`POST /webhooks/gmail` is `@Public()` and authenticated by a Google-signed OIDC
token ([[0019]] D3). Same shape, different credential. To keep that from
degrading into "`@Public()` means unguarded", `communications-security.spec.ts`
now asserts not just the allow-list of public handlers but that this one names
the guard that authenticates it.

**Rejected — mint a JWT for the orchestrator.** Correct in the long run and
strictly more expressive (a real principal, a tenant, an audit subject). It
needs a service user, and `auth.users` and `public.users` are disjoint here, so
that is a schema decision, not a repair. Deferred.

**Rejected — a new `ORCHESTRATOR_API_KEY`.** A second secret to provision,
rotate and forget. `api/auth.py:5-6` already says in as many words that the
orchestrator "deliberately does not introduce a second scheme". Neither should
the gateway.

**Rejected — drop the threading fields from the caller.** That would have made
the 400 go away by making every vendor reply start a new thread. The DTO was the
narrow layer, not the caller (see F2).

**Rejected — teach `_is_definite_send_refusal` that HTTP 4xx means refused.**
Tempting: a 401 or a 400 provably never became a message. But that function is
deliberately an allow-list ported line-for-line from
`ProcurementService.isDefiniteSendRefusal`, and widening it on one side only
would make the two runtimes classify the same failure differently — the exact
drift its docstring exists to prevent. Left alone; recorded below as not fixed.
[NARROWED, not reversed, 2026-09-19: what the founder decided (bracket below)
is not "HTTP 4xx means refused" — it is 400/403/422 refused, 401 still
ambiguous. Porting that split to `ProcurementService.isDefiniteSendRefusal`
would still be pointless drift-bait, because that classifier never sees an
HTTP status at all (its errors come from an in-process Gmail call, never this
route) — so there is no second runtime for this one to disagree with.]

## What this does NOT fix

- **The route still writes no `procurement_conversations` row of its own.** The
  caller does that, after the fact. [[0084]] named this and it remains true.
- **The route still carries no tenant.** `ServiceKeyGuard` authenticates a
  machine, not a principal — the key holder may still send to any address. The
  guard's own docstring says so, and forbids class-level or `APP_GUARD` use.
  [FIXED 2026-09-17, ADR 0149 #19: the route moved to
  `communications/relay/`; the key holder must now name the house, vendor and
  conversation or order, and may send only to that vendor's addresses in the
  house's book. Every send writes `system_audit_log` rows. The route still
  writes no `procurement_conversations` row — the caller still does.]
- **A gateway 401/400 is still classified `ambiguous` and parks the
  conversation.** Conservative direction (never a duplicate purchase order), but
  it is not correct. See the rejected alternative above.
  [STILL OPEN 2026-09-17: the relay now also answers 403 and 422 before any
  transport. Left unwidened on purpose — this record is Proposed, so its
  rejection is neither locked nor overturned. Separately fixed that day: a
  gateway HTTP 5xx was classified DEFINITE, because the composer's
  `"HTTP 503 — …"` matched the SMTP 5xx pattern; it is now ambiguous.]
  [DECIDED 2026-09-19, founder, lane answers batch 4 (feat/finish-relay) —
  his words: "relay 4xx = split by code (400/403/422 final, 401 parks)".
  `_is_definite_send_refusal` (provider_conversation_agent.py) now matches the
  composer's `"gateway refused the send: HTTP {code} — …"` string and returns
  **TRUE** for 400, 403 and 422 — the relay's own structural refusals (a
  malformed request, a door refusing what the request names, a guardrail),
  all decided before any transport is attempted, so they prove non-delivery
  and the claim is released for retry — and **FALSE** for 401, which is left
  ambiguous on purpose: it means the orchestrator's own service key is wrong,
  empty or missing at the gateway, a fixable config problem rather than a fact
  about the vendor, so it still parks the conversation as SEND_UNCONFIRMED for
  a person. 404 and 429 were not part of the founder's answer and are
  unchanged (still ambiguous) — a regression test pins that. Not ported to
  `ProcurementService.isDefiniteSendRefusal`: that classifier reads errors
  from the in-process Gmail path, which never produces this string, so there
  is no second runtime to keep in parity with here. Tests:
  `test_vendor_email_gateway_auth.py`
  (`test_a_relay_400_403_or_422_is_a_definite_refusal`,
  `test_a_relay_401_stays_ambiguous_and_parks_for_a_person`,
  `test_a_relay_404_or_429_is_unchanged_and_still_ambiguous`, and their
  `_end_to_end_` counterparts, plus the corrected
  `test_a_door_refusal_is_never_recorded_as_sent_and_its_sentence_is_logged`)
  and `test_cross_runtime_envelope_and_send_claim.py` (`TestDefiniteRefusalIsReleased`'s
  parametrize list and `AMBIGUOUS_FAILURES` extended with the gateway-shaped
  strings). Failing-before/passing-after measured directly: with the
  classification branch reverted to its pre-fix form, 10 of these tests
  failed (3 unit + 3 end-to-end for the 400/403/422 codes, 3 in the
  cross-runtime file, 1 for the corrected 403 end-to-end test); with it
  restored, the full `test_vendor_email_gateway_auth.py` +
  `test_cross_runtime_envelope_and_send_claim.py` pair is 70/70, and the
  orchestrator's full suite is 1388 passed / 54 skipped, unchanged from
  before this fix in everything but these two files.
  [CORRECTED 2026-09-21, founder, relay lane (`wt-r5-relay`) — this did NOT
  stay closed. The founder's answers as the lane brief relays them, verbatim.
  [VERIFY, 2026-09-21 last call: the quoted blocks below are the lane
  brief's words, not all his. His own words are the option he picked —
  option (b) of the round-6 relay question, whose label is "Close, no
  retry" and whose text is "a new terminal status holds the gateway's
  sentence, no error is raised so there is no retry; cost is a new status
  value (check the table's constraint and a migration), a UI state to show
  it, and one more lane session" — and the delegation quoted inside the
  first block. The rest is the brief's statement of what that answer
  requires. An earlier draft of this bracket called the whole block "the
  founder's own words", which it is not.]

  > a 400/403/422 relay refusal is FINAL = "Close, no retry" (he delegated:
  > "do the best option from UI and UX standpoint, if needed change your
  > decision and build again") — a new terminal draft status holds the
  > gateway's sentence on the draft, no error raised so the bus does not
  > retry, and the manager sees why on the draft (UI state on the draft
  > panels that show relay drafts); check the status column's CHECK
  > constraint and add a migration (20260921113000).

  and, on the same day, a related correction to the header-refusal gap ADR
  0172 left open on this route specifically:

  > a header refusal on the relay path answers a FINAL 422 (not 200
  > success:false), so both send paths behave alike and the draft closes
  > with the reason shown.

  So "the claim is released for retry" above is no longer what 400/403/422
  do — that was the 2026-09-19 answer, and this is the correction, not an
  addition alongside it. What changed, concretely:

  - **A new terminal status, `RELAY_REFUSED`, on `procurement_conversations`**
    (migration `20260921113000_a_relay_refusal_closes_the_draft_no_retry.sql`).
    `_release_send_claim` (which set the row back to `prior_status` — DRAFT
    or PENDING_APPROVAL — so a person or a bus replay could try again) is no
    longer reached for these three codes; `_close_relay_refused` is, and it
    does NOT hand the claim back. Added to `_SEND_TERMINAL_STATUSES`
    (`_claim_conversation_for_send`'s own block-list) for the same reason
    `SEND_UNCONFIRMED` is there — a closed row must never be re-claimable,
    proved by a dedicated replay test (below) and by a mutation that showed
    the pre-existing test harness would NOT have caught its own omission
    (see Evidence).
  - **The reason, verbatim, stored on the row.** `relay_refusal_reason TEXT`
    (same migration), scoped to `status = 'RELAY_REFUSED'` by a CHECK
    constraint. `procurement_conversations.status` itself still carries NO
    CHECK constraint of its own — confirmed again (the prior migration,
    `20260921110000`, already found and recorded this) — and closing that
    gap for the whole column is a cross-cutting change spanning 20+ call
    sites across two services, filed as an open item in the migration's own
    header rather than guessed at here.
  - **No raise.** The caller (`_handle_conversation_approved`) used to
    `raise RuntimeError(... "released for retry")` for every definite
    refusal, which is what makes `BaseAgent._process_with_retry` / the
    message bus retry the send. For a relay-final refusal it now returns
    quietly after closing — retrying the identical request would refuse it
    again, identically, so there is nothing a retry could fix.
  - **The draft panel.** `ProcurementService.getConversationHistory` now
    selects and maps `relay_refusal_reason`; `ProcurementHistoryItem`,
    `cm-format.ts`'s `sendState` (`RELAY_REFUSED` → `'failed'`) and
    `conversationGrouping.ts`'s `DRAFT_STATUS_LABEL` carry it through to
    CommunicationsNext, and `StateChip` shows the gateway's own sentence as
    a tooltip — "the manager sees why on the draft", per the founder's
    words above. **Not built in this pass:** the SAME treatment on
    `getOrderConversations` / the `/orders` approval-queue draft panel, a
    different read path this lane did not touch — named here as a residual,
    not decided away.
    [CORRECTED 2026-09-21, last call on this lane: that residual was the
    founder's answer not holding end to end, and it was also misdescribed.
    The `/orders` approval queue (`getActiveConversations`) selects only
    PENDING_APPROVAL, so a closed row simply leaves it; the panel that DOES
    show a relay draft after it closes is the order's thread drawer
    (`CommsThreadDrawer`, read through `getOrderConversations`), and there
    RELAY_REFUSED fell to the generic fallback — the raw token under a Clock
    icon, which reads as "still waiting". The legacy `/communications` page
    (`Communications.tsx`, what `PageGate` serves while the Mudavym design
    flag is off) printed the raw token too, with no reason. And on
    CommunicationsNext the reason was a `title` tooltip only, which a touch
    screen or a keyboard never shows. Built in the last call, all three:
    `getOrderConversations` selects and maps `relay_refusal_reason`; the
    drawer names the status ("Not sent · refused", red, no approve control)
    and prints the gateway's sentence on the card; the legacy page names it
    and prints the sentence in the opened row; CommunicationsNext prints it
    in the opened row as well as the chip's tooltip. The
    `conversationGrouping` label no longer says "edit and resend": the row is
    closed, and re-approving it cannot re-claim it (RELAY_REFUSED is in
    `_SEND_TERMINAL_STATUSES`, and `ConversationsService.approveConversation`
    does not look at status), so the only way the words go out is a new
    message.]
  - **The 422 header refusal.** `RelayEmailService.dispatch()`'s transport
    attempt (`sendThroughDeploymentMailbox` / `sendThroughHouseGrant`) can
    throw `MimeHeaderError` (ADR 0172) — the encoder refused to build the
    message, so nothing reached the provider — same footing as a door
    refusing before dispatch, but it used to land in the SAME generic catch
    as an ordinary transport failure and answer 200 with `success: false`,
    indistinguishable from a real provider outage. `dispatch()` now tags
    that specific case `refusedBeforeSend: true` (typed, `instanceof
    MimeHeaderError` — PR #405's rule: classify by fields, never by
    parsing `error`'s text) on both the audit row and the returned
    `RelayResult`; `sendAsOrchestrator` reads the flag and throws
    `UnprocessableEntityException` (422) instead of returning it as a 200.
    The orchestrator's `_relay_final_refusal_code` then reads that 422
    through the SAME `"gateway refused the send: HTTP {code}"` string the
    400/403/422 door refusals already produce — it cannot and need not tell
    a header refusal apart from a door refusal, and does not need to: both
    are decided before any transport reached the vendor, so both close.
  - **`_is_definite_send_refusal` itself is UNCHANGED.** It still classifies
    400/403/422 "definite" (proven non-delivery) — that fact did not
    change, only what the CALLER does with a definite refusal that is ALSO
    relay-final. A NEW, narrower classifier,
    `_relay_final_refusal_code(error) -> Optional[str]`, matches only these
    three codes and is checked FIRST, before `_is_definite_send_refusal`;
    every OTHER definite refusal (SMTP 5xx, bad credentials, "no
    transport attempted") still goes through the unchanged
    `_release_send_claim` + raise path — proved by
    `test_an_approved_conversation_whose_row_names_no_house_never_leaves`
    (unmodified) and `TestDefiniteRefusalIsReleased`'s remaining four cases.
    Not ported to `ProcurementService.isDefiniteSendRefusal`: same reasoning
    as before — that classifier never sees this string.
  - **What "both send paths behave alike" does and does not cover (last
    call, 2026-09-21).** Both paths now treat a header refusal as a
    DEFINITE refusal with the sentence named — before this, the relay path
    answered 200 `success:false` and the orchestrator parked it as
    ambiguous. They are NOT identical in shape: the gateway's in-process
    path (`ProcurementService`'s send, ADR 0172) answers **400**
    (`SendRefusedBeforeSendError extends BadRequestException`) and releases
    the draft back to PENDING_APPROVAL for the manager to fix and approve
    again; the relay path answers **422** and CLOSES the draft as
    RELAY_REFUSED. That difference is what the two answers say taken
    literally (the relay answer is "final"; the in-process path was not
    asked about), so nothing was changed to hide it — it is the lane's one
    founder question. [ANSWERED 2026-09-21, merge last call: the founder
    answered it the same day. The in-process path now closes too, and that
    is built in lane E (`r5/E`, worktree `wt-r5-E`). It was not on `main`
    when this lane merged `origin/main` at `34c33a76a`. Lane E closes the
    draft as `SEND_REFUSED` with `send_refusal_reason` (its migration
    `20260921114950`). Those are a different status and column from this
    lane's `RELAY_REFUSED` and `relay_refusal_reason`. Any panel that shows
    one must learn the other.]

  **Tests, all in `wt-r5-relay`:**
  `test_vendor_email_gateway_auth.py` — new
  `test_relay_final_refusal_code_matches_400_403_and_422`,
  `test_relay_final_refusal_code_is_none_for_every_other_code`,
  `test_relay_final_refusal_code_is_none_for_non_relay_shaped_errors`;
  `test_a_relay_400_403_or_422_end_to_end_is_released_for_retry` renamed and
  rewritten as `test_a_relay_400_403_or_422_end_to_end_closes_with_no_retry`
  (asserts `RELAY_REFUSED` + the stored reason, no raise);
  `test_a_door_refusal_is_never_recorded_as_sent_and_its_sentence_is_logged`
  corrected the same way. `test_cross_runtime_envelope_and_send_claim.py` —
  the three relay-4xx cases moved out of
  `TestDefiniteRefusalIsReleased.test_definite_refusal_releases_the_claim_and_raises`
  into a new `TestRelayFinalRefusalCloses` (four cases: the three codes plus
  a `relay-422-header-refusal-before-send` case with the 422-via-header
  sentence, and a replay guard mirroring
  `TestAmbiguousSendIsParkedNotRetried`'s own). Gateway:
  `relay-email.doors.spec.ts` — two new cases on the orchestrator's door,
  "is 422 — not 200 — for a header refusal inside dispatch" and its negative
  ("is 200 ... for an ordinary transport failure — 422 is not the default").

  **Measured, this pass, in `wt-r5-relay`.**
  `test_vendor_email_gateway_auth.py` + `test_cross_runtime_envelope_and_send_claim.py`:
  85/85 (up from 70/70 — 15 new tests, none removed). Orchestrator full
  suite: 1410 passed / 55 skipped (baseline drift from other merged work
  since 2026-09-19's 1388/54, not from this change — re-measured directly,
  never copied forward). `relay-email.doors.spec.ts`: 58/58 (up from 56).
  `ruff check` and `black --check` clean on all three touched Python files.
  Gateway: `gw_tsc`, `gw_tsc_spec`, `web_tsc`, the touched jest/vitest specs,
  `check_decision_claims.sh` (395/395 holding — [VERIFY, 2026-09-21] the
  builder's own note here undercounted by one; re-measured against the
  staged tree, including this pass's own new `ADR-0099-RELAY-CLOSE-NOT-RETRY`
  row), `check_gateway_boots.sh`,
  and the migration-prefix guard all green via `verify_index.sh` against the
  staged INDEX tree.

  **Mutation-tested, snapshot → mutate → run → restore → `cmp`, every
  restore byte-identical:**

  | Mutant | File | Result |
  |---|---|---|
  | M1: `_relay_final_refusal_code` always returns `None` | `provider_conversation_agent.py` | 12 red |
  | M2: `RELAY_REFUSED` dropped from `_SEND_TERMINAL_STATUSES` | `provider_conversation_agent.py` | 1 red (only after also fixing the test harness — see below) |
  | M3: caller raises after closing anyway | `provider_conversation_agent.py` | 9 red |
  | M4: `relay_refusal_reason` dropped from the close write | `provider_conversation_agent.py` | 8 red |
  | M5: `_RELAY_FINAL_CODES` widened to include 401 | `provider_conversation_agent.py` | 3 red |
  | T1: `sendAsOrchestrator` never checks `refusedBeforeSend` | `relay-email.service.ts` | 1 red |
  | T2: `dispatch()` never sets `refusedBeforeSend` from the caught error | `relay-email.service.ts` | 1 red |
  | T3: `sendThroughDeploymentMailbox` never re-throws `MimeHeaderError` | `relay-email.service.ts` | 1 red |
  | T4: `sendAsOrchestrator` throws 422 unconditionally on any failure | `relay-email.service.ts` | 3 red (the negative-case test) |

  **M2's own finding, worth stating plainly (checks cannot see their own
  removal).** The first M2 run was a FALSE PASS — 0 red — because
  `test_cross_runtime_envelope_and_send_claim.py`'s `_FakeQuery` blocked
  claims off its OWN hardcoded tuple (`_BLOCKED = (...)`), never off the
  actual `.or_()` filter string `_claim_conversation_for_send` builds from
  `_SEND_TERMINAL_STATUSES`. Mutating the real constant therefore had zero
  effect on the fake — a test mocking the unit under test, the exact shape
  the repo's own rule (`no-test-that-mocks-the-unit-under-test`) exists to
  catch. Fixed by making the fake PARSE the real filter string instead of
  mirroring a hand-kept list; re-run, M2 then killed the replay test as
  shown above.]
- **Nothing here makes the orchestrator run in production.** The measured blast
  radius of zero is because it does not. Whether it should is a separate
  decision.

## Verification

| Claim | Evidence |
|---|---|
| `fdaa7fa0` (2026-08-25) is when the class-level `JwtAuthGuard` landed | `git log -S '@UseGuards(JwtAuthGuard)' -- …/communications.controller.ts` returns exactly that commit; `git show --date=iso` gives 2026-08-25 14:34:42 +0300 |
| The caller sends no credential | `email_composer_service.py:357-361` on `origin/main` — `session.post(url, json=…, timeout=…)`, no `headers=` |
| `forbidNonWhitelisted: true` is live | `apps/api-gateway/src/main.ts:51-57` |
| `SendEmailDto` declared none of the four threading fields | `dto/communication.dto.ts:12-48` on `origin/main` |
| Threading is supported everywhere below the DTO | `gmail.service.ts:36-48` (`EmailOptions`), `:181-184` (`threadId`), `:596-613` (`In-Reply-To`, `References`, `Reply-To`) |
| 0 outbound rows since 2026-08-25; newest row 2026-08-16 | `select` against `exzueerziesmczwlhomd`, 2026-09-02 |
| 0 of 17 outbound rows carry the Python path's success shape | same — `count(*) FILTER` on `message_id`, `delivery_status`, and `jsonb_object_keys(email_headers)` = `{subject, in_reply_to, references}` on all 17 |
| `agent_activity_logs` is empty | same |
| Real vendor mail is written by the gateway-native path | `procurement.service.ts:3443-3477` inserts exactly the three-key `email_headers` shape; `:3102` calls `GmailService` in process |
| The tests fail against the pre-fix tree | with the three gateway files restored from `origin/main` in place (never `git stash`): **9 of 10 failed**; with `email_composer_service.py` restored: **5 of 6 failed**. Combined **14 of 16**. After: **0 of 16** |
| Fail-closed is asserted in both runtimes | `vendor-email-gateway-auth.spec.ts` "FAILS CLOSED: an unset ADMIN_API_KEY denies, it does not allow"; `test_vendor_email_gateway_auth.py::test_unset_admin_key_does_not_send_at_all` proves **no POST is made at all** |
| Nothing else broke | `npx jest` over `apps/api-gateway`: **1888 passed / 0 failed / 14 skipped**, 149 suites. `pytest services/agent-orchestrator`: **1179 passed / 54 skipped** |
| Typecheck and boot | `npx tsc --noEmit -p tsconfig.spec.json` exit 0; `scripts/check_gateway_boots.sh` PASS |
| Python style | `ruff check` clean; `black --check` clean |
| The ADR number | `check_adr_numbers_unique.py` reports next free **0099** across 603 refs. **A peer worktree (`agent-a772a8b225d1cc36a`, `fix/security-alerts-triaged-and-closed`) holds an UNCOMMITTED `0099-security-alerts-triaged-and-closed.md`** — invisible to the guard, which sees refs only. Flagged for the founder; whoever commits second renumbers |
| 2026-09-19: the 4xx split classifies 400/403/422 definite, 401 ambiguous | With the classifier's gateway-4xx branch reverted to its pre-2026-09-19 form in place (Edit tool, never `git stash`): **10 of the pair's 70 tests failed** (`test_vendor_email_gateway_auth.py` + `test_cross_runtime_envelope_and_send_claim.py`). Restored: **70/70**. Orchestrator full suite: **1388 passed / 54 skipped**, unchanged elsewhere. `ruff check` and `black --check` clean on all three touched files |

## Operator note

`ADMIN_API_KEY` must be set **and identical** in the Railway environments of
both `api-gateway` and `agent-orchestrator`. It already exists in both (the
gateway sends it to the orchestrator at `orchestrator.service.ts:72`), so no new
secret is provisioned. If it is unset, vendor email does not send — by design,
and it says so in the log rather than failing silently.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created |
| 2026-09-17 | ADR 0149 #19 relay lane | Tenant hole closed (see bracket above); the 4xx classification fork left open; the 5xx misclassification fixed |
| 2026-09-19 | feat/finish-relay lane | 4xx classification fork answered by the founder (lane answers batch 4) and implemented (see bracket above). Status moved Proposed → Locked — no fork in this record is still open. |
| 2026-09-21 | relay lane (`wt-r5-relay`) | Founder corrected the 2026-09-19 answer: 400/403/422 CLOSE (`RELAY_REFUSED`, no claim released, no raise) rather than release for retry, and a relay-path header refusal (ADR 0172) now answers 422 rather than 200 — both his words quoted verbatim in the bracket above. `_is_definite_send_refusal` unchanged; a new, narrower `_relay_final_refusal_code` is checked first. Migration `20260921113000` adds `procurement_conversations.relay_refusal_reason`, scoped to the new status by a CHECK constraint (the column's own status field remains unconstrained — confirmed again, filed as an open item, not touched). CommunicationsNext's draft panel now shows the gateway's sentence; `/orders`' own panel does not yet (named, not built). [CORRECTED same day, last call: built — see the next row.] 85/85 + 58/58 measured; 9 mutants, all killed, every restore `cmp`-identical (one — M2 — false-passed on first run because the test harness mocked the constant it was meant to verify; fixed to parse the real query instead). Status remains Locked. |
| 2026-09-21 | relay lane last call (`wt-r5-relay`) | Adversarial pass over the staged diff. The close path, the replay block and the 422 held (85/85 Python re-run; one extra mutant — the close call swapped for `_release_send_claim`, i.e. option (c) "release quietly" — killed 9 red, restore `cmp`-identical). Three gaps fixed: (1) "the manager sees why on the draft" did not hold end to end — the `/orders` thread drawer printed the raw `RELAY_REFUSED` token under a Clock icon, the legacy `/communications` page printed the raw token, and CommunicationsNext showed the reason only as a hover tooltip; all three now name the state and print the gateway's sentence (see the bracket in the draft-panel bullet), and `getOrderConversations` now reads `relay_refusal_reason`. (2) The 422 sentence always carried a doubled full stop (every `MimeHeaderError` message ends in one), stored and shown verbatim; trimmed. (3) This record called the lane brief's paraphrase "the founder's own words"; corrected in place. None of the "manager sees why" half had a single test before; added: 2 gateway (`conversation-ledger.spec.ts`, both reads, select pinned) and 3 web (drawer, legacy page, CommunicationsNext). Seven mutants against them (reason hidden in the drawer, drawer status entry removed, CommunicationsNext opened-row line removed, legacy label removed, `getOrderConversations` mapping nulled, its select column dropped, the full-stop trim removed): all 7 killed, every restore `cmp`-identical. Measured on the staged INDEX tree via `verify_index.sh`: `gw_tsc`, `gw_tsc_spec`, `web_tsc`, `gw_eslint` exit 0; jest 71/71 (`relay-email.doors.spec.ts` 58 + `conversation-ledger.spec.ts` 13); vitest 47/47 over the four touched web files; claims 395/395; boots and prefixes PASS; web eslint (via the p4-scratch plugin dir) exit 0 on the eight touched web files; the four git guards exit 0; the PGlite probe re-run, all held. Not done: no browser look at the three panels (tests render the DOM; no seeded RELAY_REFUSED row exists to view). One founder question left: the in-process path answers a header refusal 400 and releases the draft, the relay path 422 and closes it. Status remains Locked. |
| 2026-09-21 | relay lane, merge last call (`wt-r5-relay`) | Merged `origin/main` at `34c33a76a` (#391, #418, #421). Main's header encoder won in `createMimeMessage`, `sendThroughGrant` and CLAIMS. The relay's close with no retry, its 422, and its random MIME boundary were kept. Each of main's added lines in the 10 files both sides touched is present in the merged tree. A mutant that closed a send on ANY quoted 400/403/422 passed all 85 Python tests. That meant a 5xx or a 200 whose detail quoted a relay refusal would be marked "not sent" when the vendor may already have it. Two tests were added and they kill that mutant (87/87; restore `cmp`-identical). The migration header and two gateway comments had called the brief's paraphrase his words; they were corrected to match the bracket above. The in-process question is answered and built in lane E (bracket above). Status remains Locked. |
