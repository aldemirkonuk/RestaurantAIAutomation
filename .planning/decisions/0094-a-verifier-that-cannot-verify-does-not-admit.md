# 0094 — A verifier that cannot verify does not admit

- **Status:** Locked
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder), via coordinator — *invert it; missing config means refuse*
- **Keywords:** gmail, pub/sub, oidc, webhook, fail-closed, fail-open, absence-reported-as-health, staged rollout, feature flag, inbound email, GMAIL_PUBSUB_AUDIENCE, GMAIL_PUBSUB_SERVICE_ACCOUNT, GMAIL_PUBSUB_REQUIRE_AUTH, swagger
- **Links:** [[0019-p2-build-scope]] (§D3, which introduced this verifier), [[0084-the-communications-gateway-says-what-it-did]], `apps/api-gateway/src/communications/gmail-push-auth.service.ts`, `.planning/06-pages/communications.md`

## Context

`POST /communications/webhooks/gmail` is `@Public()`. It is the endpoint Google
Pub/Sub pushes to when mail arrives; a request to it makes the gateway fetch the
inbox and republish the contents onto `email.events`. ADR 0019 §D3 gave it a
verifier, `GmailPushAuthService`, so that only a Google-signed OIDC token from
our own push subscription could drive it.

**The verifier admitted everyone whenever it was not configured.**
`gmail-push-auth.service.ts:59-91` (pre-fix): with either `GMAIL_PUBSUB_AUDIENCE`
or `GMAIL_PUBSUB_SERVICE_ACCOUNT` unset it incremented a counter, logged an
error, and `return true`. Refusing required a *second* variable,
`GMAIL_PUBSUB_REQUIRE_AUTH=true`, to also have been remembered.

Four places in the repository asserted the opposite of what that code did:

| Where | What it said |
|---|---|
| `gmail-push-auth.service.ts:16-18` | "If either is missing we REJECT — fail closed" — twenty lines above the branch that returned `true` |
| `communications.controller.ts:61` | "(GmailPushAuthService, fail-closed)" |
| `communications.controller.ts:1113` | **Swagger**: "Fails closed when those are unset." — shipped to API consumers |
| `communications-security.spec.ts:151` | pinned the real behaviour as correct: *"accepts but counts an unverified push when config is unset"* |

The fourth is the worst of them. A test that pins a defect converts it into a
regression suite: any later attempt to close the hole would have shown up as a
broken build, correctly attributed to the person fixing it.

This is `absence-reported-as-health` in its purest form — a component reporting
on itself reported the absence of its own inputs as a healthy state. The
proximate cause was not carelessness. The staged-rollout comment
(`:60-74`) argued honestly: production was believed to be running a live Gmail
watch on unset config, so refusing would *close a door that is open and carrying
traffic*, silently stopping inbound email on the next deploy.

**That argument no longer survives contact with the repo, because the repo does
not know whether the vars are set.** Two documents disagree:

- `.planning/04-specs/REGISTER-AUDIT-2026-08-26.md:106-107` — production `.env`
  carries `GMAIL_PUBSUB_AUDIENCE` (89 chars), `GMAIL_PUBSUB_SERVICE_ACCOUNT`
  (62 chars) and `GMAIL_PUBSUB_REQUIRE_AUTH=true`.
- `.planning/STATE.md:82-84` (pre-fix) — they still need setting, "until then
  the gateway logs an error per unverified push and counts them".

Railway's environment is not readable from this repository, so neither can be
confirmed. A third document,
`.planning/decisions/OD-77-workspace-migration-runbook.md:165-166`, claims all
three vars "do not exist anywhere in the codebase", which was true when written
and is not now.

**The ambiguity is the argument FOR failing closed, not against it.** While the
code fails open, which document is right decides whether an unauthenticated
caller can drive the mailbox — a security question nobody can answer. Once the
code fails closed, the same ambiguity decides only whether inbound email is
currently flowing — a functional question, visible in a log line and a counter,
answerable by setting two variables.

## Options considered

1. **Leave the staged rollout in place.** Rejected. Its premise — that the door
   is open and carrying traffic — is exactly what cannot be established, and the
   cost of being wrong is an unauthenticated mail-ingestion webhook.
2. **Keep `GMAIL_PUBSUB_REQUIRE_AUTH` but default it to `true`.** Rejected. It
   inverts the default while leaving a flag whose only remaining power is to
   *weaken* the guard. A fail-closed posture that a single unset environment
   variable can reopen is not fail-closed, and the failure mode is silent.
3. **Refuse at boot instead of per request** — make the gateway decline to start
   when the vars are missing. Rejected: it converts a paused inbox into a dead
   gateway, taking down every unrelated route to protect one webhook. The
   blast radius is wrong, and `LivenessController` exists precisely so boot
   stays dependency-free.
4. **Invert the branch and delete the flag.** Chosen.

## Decision

**Missing configuration refuses.** `verifyPushRequest` returns `false` when
either `GMAIL_PUBSUB_AUDIENCE` or `GMAIL_PUBSUB_SERVICE_ACCOUNT` is unset,
blank, or whitespace. Half-configured is unconfigured: an audience alone proves
nothing about *who* sent a token, and a service account alone proves nothing
about who it was issued *for*.

**`GMAIL_PUBSUB_REQUIRE_AUTH` is deleted**, not defaulted. It no longer exists
in code; setting it has no effect.

**The counter is kept and re-pointed.** `unverifiedPushes` counted pushes
*accepted* while unconfigured — the size of an open hole. It is now
`refusedWhileUnconfigured` and counts the operational cost of the closed one: a
non-zero value means real inbound mail is being turned away and the two
variables still need setting. It deliberately does **not** count a push refused
for a bad token, so the number a human reads as "inbound email is paused" is not
inflated by ordinary rejections.

**The three prose assertions become true rather than being deleted**, and each
now records that it once described the reverse — including the Swagger
description, which additionally states the operational consequence for API
consumers.

## Consequences

🟢 **On the best evidence available, this does NOT stop inbound email — it is
most likely a no-op in production.** That is a correction to this ADR's own
first draft, which led with the opposite warning; the evidence was found while
reconciling OD-78, after the fix was written.

`OPEN-DECISIONS.md` OD-78 records a production probe run **twice, a day apart,
on 2026-08-26**: an unsigned `POST /api/v1/communications/webhooks/gmail`
returned **401**. Read against the pre-fix code, that result is decisive,
because the old `verifyPushRequest` could return `false` on only two paths:

| Live config on 2026-08-26 | Pre-fix answer to an unsigned push | Effect of ADR 0094 |
|---|---|---|
| Pair **set** | 401 — real OIDC verification | **No-op.** Verification already live; mail keeps flowing |
| Pair unset **+ `REQUIRE_AUTH=true`** | 401 — the flag's fail-closed branch | **No-op.** It was already refusing every push; inbound was already paused |
| Pair unset, flag unset | **200 — accepted unverified** | would newly refuse |

The observed 401 rules out the third row as of that date. So this change either
does nothing, or keeps doing what the flag was already doing — it cannot be the
thing that breaks a working inbox unless the Railway config was changed to the
third state after 2026-08-26, for which there is no evidence.

**What the founder must still do**, because the safe state and the *working*
state are not the same thing. On the api-gateway Railway service, confirm:

- `GMAIL_PUBSUB_AUDIENCE` — the OIDC audience configured on the Pub/Sub push
  subscription
- `GMAIL_PUBSUB_SERVICE_ACCOUNT` — the push subscription's service-account email

Both come from the Pub/Sub push subscription itself; neither can be invented
here, and a wrong guess fails exactly as badly as no guess. If they are set,
nothing changes. If they are not, inbound email is refused — and per the table
above it was already being refused, so this reveals a pause rather than causing
one. The refusal is countable and logged per push
(`GmailPushAuthService.refusedWhileUnconfigured`), which is how to tell the two
apart without Railway access.

`GMAIL_PUBSUB_REQUIRE_AUTH` should be **removed** from any environment that
carries it. It no longer exists in code and setting it does nothing.

A paused inbox is the correct trade against a webhook that ingests mail for
anyone who posts to it. Stated plainly here because it is the one consequence
that reaches a human.

**Tests.** `communications-security.spec.ts` went from **42 passed / 42 total**
at `origin/main` (`95d3c011`) to **43 passed / 43 total**. Five of the 43 fail
against the pre-fix service — measured, not asserted: the fixed spec was run
against `origin/main`'s `gmail-push-auth.service.ts` and produced
`5 failed, 38 passed, 43 total`. Both directions are covered: unset, half-set
and blank config are refused, **and** a correctly-signed push from the
configured service account is still accepted (`accepts the configured push
service account (case-insensitive)`, and the controller-level *"still processes
a verified push (legitimate inbound path intact)"*).

**What this does NOT fix, named rather than implied:**

- **Whether production has the vars set.** Not determinable from this repo.
  `REGISTER-AUDIT-2026-08-26.md` and `STATE.md` disagreed; `STATE.md` is updated
  to say the question is open rather than to pick a side.
- **`OD-77-workspace-migration-runbook.md:165-166`**, which still claims the
  three variables do not exist in the codebase. Stale, left alone: it is a
  historical runbook and not a live claim.
- **Retiring OD-78 formally.** Its stated retirement condition — *"the end
  state that retires this entry is not a config value but a deletion"* — is now
  met, and the row is annotated to say so, but only a founder call moves a row
  to the Resolved table. Its executable claims are reconciled: the one that
  pinned the staged-open branch as the desired state is **dropped** (it asserted
  a defect must persist), the one asserting the end state is flipped to
  `resolved`, and its env-template claim is re-homed onto this ADR and
  re-pointed at the pair, since `REQUIRE_AUTH` no longer exists.
- **The `email_composer_service.py` 401.** The orchestrator's vendor-email path
  has been refused since `fdaa7fa0` (2026-08-25) because it sends no
  `Authorization` header. Found during this work, dispatched separately, not
  touched here.
- **The other `@Public()` route on this controller.** `handleGmailWebhook` is
  the only intentional one and is now genuinely verified; the exposure question
  for the rest of the gateway is [[0096-a-route-declares-its-own-exposure]].

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Coordinator | Point 4 of the briefing asserted this verifier already failed closed; the agent measured otherwise and stopped rather than building on it. Coordinator confirmed the correction and directed the inversion. |
| 2026-09-02 | Aldemir | Pending — needs the two Railway variables set. |
