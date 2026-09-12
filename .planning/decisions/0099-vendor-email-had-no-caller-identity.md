# 0099 — The vendor-email route had no caller identity, and no caller either

- **Status:** Proposed
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

## What this does NOT fix

- **The route still writes no `procurement_conversations` row of its own.** The
  caller does that, after the fact. [[0084]] named this and it remains true.
- **The route still carries no tenant.** `ServiceKeyGuard` authenticates a
  machine, not a principal — the key holder may still send to any address. The
  guard's own docstring says so, and forbids class-level or `APP_GUARD` use.
- **A gateway 401/400 is still classified `ambiguous` and parks the
  conversation.** Conservative direction (never a duplicate purchase order), but
  it is not correct. See the rejected alternative above.
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
