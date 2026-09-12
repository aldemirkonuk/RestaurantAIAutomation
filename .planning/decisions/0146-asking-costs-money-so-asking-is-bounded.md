# 0146 — Asking costs money, so asking is bounded

- **Status:** Locked
- **Date:** 2026-09-12
- **Decider:** Aldemir (founder) — "Fix all four now, before any /ask build", and the role call below
- **Keywords:** ask-ai, rate limit, spend ceiling, validation pipe, roles guard, gateFirstAttempt, AuthedRateLimitGuard
- **Links:** [[0145-mudavym-answers-out-of-a-reading]] (the `/ask` surface this protects), [[0090-pr-audit-gate-autonomous-merge]] (the gate that would have caught this class), `apps/api-gateway/src/ask-ai/`, PR to follow

## Context

[[0145-mudavym-answers-out-of-a-reading]] decided what `/ask` is. Before a line
of it gets built, the endpoint it would sit on was read line by line, because
0145's whole finding is that a hollow build renders identically to a working
one. Four faults were measured on `apps/api-gateway/src/ask-ai/`. Every one of
them was the same shape as the faults already on this estate's record: **the
defence looked present.**

**1. The bodies were never validated.** `main.ts:52` installs a global
`ValidationPipe` with `whitelist`, `forbidNonWhitelisted` and `transform` all
on. `ask-ai.controller.ts:44` declared its body as `@Body() body: { utterance?:
string }` — an inline TypeScript type, which erases at runtime. Nest hands the
pipe `Object` as the metatype, the pipe has no class to construct, and it
returns the body untouched. So an unbounded string went straight into a model
prompt and an arbitrary object went into the confirm path, on a controller
whose own header comment said "Every route is guarded."

**2. The rate limit could not see who was calling.** The first reading of this
said "zero rate limiting anywhere in the gateway" and **that was wrong** — the
grep was for `Throttl` and `throttler`, and the facility here is called
`RateLimit`. Corrected by measurement: `RateLimitGuard` exists at
`apps/api-gateway/src/common/rate-limit/rate-limit.guard.ts` and is registered
as an `APP_GUARD` at `app.module.ts:167`. But Nest runs global guards **before**
controller-level ones, `JwtAuthGuard` is controller-level everywhere in this
gateway, and so `request.user` is undefined every time that guard runs — on
every route. It keys on the IP. Its two authenticated branches were unreachable,
and one of them spelled the field `request.user?.id`, which no strategy in this
gateway sets (all three return `userId`), so it would not have fired even from a
call site that ran it after authentication.

Ask AI then matched none of the guard's path rules — `/ai/` does not occur in
`/api/v1/ask-ai/propose` — and fell through to the default bucket: **100
requests per minute**. A hundred model calls a minute is not a limit on a route
that calls the model on every request.

**3. The spend ceiling never saw a first call.** `retryAllowedBySpendCeiling`
appears at `model-client.service.ts:244` and `:288`, both inside the retry
branches, and its own header comment says why: gating every first call on a
ledger read would give the seven production paths that predate the client a
failure mode none of them was written to handle. Correct for those seven. It
means a caller who never retries was never metered.

**4. Any member could confirm any proposal.** The controller carried
`@UseGuards(JwtAuthGuard)` and nothing else. Confirming is the act that
**writes** — a purchase order, vendor email. Any member of a house could confirm
a proposal any other member had made.

Together: an authenticated member could loop `POST /api/v1/ask-ai/propose` at a
hundred a minute, unvalidated, unmetered, and then confirm someone else's
proposal into a real order.

## Options considered

1. **Turn the existing global `RateLimitGuard` into an authenticated one** — move
   it behind `JwtAuthGuard`, or resolve the user inside it. Appealing because it
   is one guard, not two. Rejected: the global guard is the ONLY layer that sees
   a caller with no token at all, and an IP is the only handle that exists at
   that point. Moving it behind authentication would delete unauthenticated
   coverage from every route in the gateway to fix one.

2. **Install `@nestjs/throttler`** — a maintained library instead of hand-rolled
   code. Rejected for now: it is a new dependency on a security path, it does
   not solve the guard-ordering problem (its global registration has the same
   property), and this repository already has two hand-rolled limiters with the
   same in-memory caveat. A third one that composes with them is a smaller change
   than a fourth mechanism that partly replaces them. Revisit when a shared cache
   exists — see the trigger below.

3. **Gate first attempts on the spend ceiling globally** — one line, and every
   model call in the gateway becomes metered. Rejected on the client's own
   recorded contract: seven production paths would each gain a new way to fail,
   on a ledger read, at a moment none of them handles. The opt-in gets the same
   protection where the risk actually is.

4. **Sign the confirmation instead of gating it** — record who confirmed and
   show it on the record, leaving the guard alone. Cheapest, and keeps every
   floor workflow working. Rejected by the founder: it is detection, not
   prevention, and it is the same "report it afterwards" shape as the faults
   already logged against this estate. The write still happens.

5. **Do nothing and build `/ask` first.** Rejected by the founder in the same
   breath as the question: "Fix all four now, before any /ask build."

## Decision

**All four are closed, and they are four separate defences on purpose.**

- **Validation.** `ProposeDto` and `ConfirmDto` are CLASSES
  (`ask-ai/dto/ask-ai.dto.ts`). `utterance` is a required string capped at 2000
  characters; `payload` is an optional object. Behaviour is preserved at the
  edges — the service already threw `BadRequestException` on an empty utterance,
  so an absent one still answers 400, just earlier.

- **Rate.** A second guard, `AuthedRateLimitGuard`, listed AFTER `JwtAuthGuard`
  on the controller, where `request.user` is real. `propose` carries ten per
  minute per PERSON and two hundred per hour per HOUSE. The per-house window is
  the one that matters against a patient caller and against several members each
  running at their own per-person limit. It **fails closed** with a 500 and a log
  line naming the controller if it ever runs without a user, so a future
  reordering surfaces as a refusal rather than as a silently absent limit.

- **Cost.** `ModelCallOptions.gateFirstAttempt`, off by default, set only by Ask
  AI's `propose`. It throws `ModelSpendCeilingError` **before** the API call and
  **before** any NF row is written — nothing was spent, so writing a zero-cost
  row would put a call in the ledger that never happened. The service answers
  **429 with the ceiling's own words**, not 503 "temporarily unavailable": a
  spend refusal is not an outage, and dressing it as one sends an operator
  looking for a fault that does not exist.

- **Who.** `@Roles("owner", "manager")` on `confirm`, with `RolesGuard`.
  Founder's call, over signing-instead-of-gating and over owner-only. Production
  has no `staff` role at all and six of ten houses are owner-only, so in practice
  this changes almost nothing today except closing the hole.

**None is sufficient alone, and the arrangement is deliberate.** Validation
bounds the REQUEST. The limit bounds the RATE, in one process. The ceiling bounds
the COST across the fleet, because it reads a shared ledger. The role bounds WHO.
When the ledger is unreadable the ceiling fails open — deliberately, because the
instrument must never break the thing it measures — and the arrangement degrades
to the rate limit rather than to nothing.

## Consequences

**Easier.** `/ask` can be built on this endpoint without the hollow-build
failure 0145 names, because a caller cannot drive it faster than a person
plausibly would, cannot exceed the house's allowance, and cannot send a body
nobody declared. `AuthedRateLimitGuard` is reusable: any authenticated route
that needs a per-person or per-house limit now declares one, which is the shape
the rest of the page wave will need.

**Harder / given up.**

- **The limits are in-memory and per-process.** Behind N gateway instances the
  effective ceiling is N times the configured one. This is the same caveat
  `PasswordResetThrottleGuard` and `RateLimitGuard` already carry, written down
  rather than discovered in an incident. It is precisely why the spend ceiling is
  a separate defence and not a nicety.
- **The ceiling reads a 60-second cache.** A burst inside one window sees stale
  spend, so the cap can be overshot by up to a minute's worth of calls. The rate
  limit bounds how much that can be.
- **The numbers are a starting position, not a measured optimum.** No ADR prices
  this surface (OD-23 — pricing is founder-deferred), so ten a minute and two
  hundred an hour are judgement, not arithmetic. They are deliberately generous
  against real use and tight against a loop.
- **A manager cannot confirm what only an owner may do, and neither can a member
  finish their own proposal without one of those roles.** On a floor where the
  person who asked has gone home, someone with standing has to finish it. That is
  the cost the founder accepted over signing-after-the-fact.
- **`discard` is NOT role-gated.** Any member may discard a proposal. Named here
  rather than defaulted silently: discarding executes nothing, so the blast
  radius is an annoyance, not a write. If it turns out that one member clearing
  another's queue is a real problem, it takes the same two lines.

**What would trigger revisiting.**

- A shared cache (Redis, or `CacheService` made reachable from a guard) landing
  in the gateway — at that point both in-memory limiters should move behind it,
  and `@nestjs/throttler` becomes worth reconsidering as the single mechanism.
- A real house hitting either `propose` limit. The log line names the rule and
  the key, so this is visible rather than inferred.
- Pricing being decided (OD-23), which replaces the placeholder allowances in
  `spend-tiers.ts` and therefore the meaning of the ceiling.
- The gateway running more than one instance in production. That is the moment
  the per-process caveat stops being theoretical.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-12 | 18-agent `/ask` research fan-out (2,981,593 subagent tokens) | Surfaced all four as blockers on any `/ask` build; each re-verified by hand at `file:line` before being reported, rather than taken on the research's word |
| 2026-09-12 | Aldemir (chat) | "Fix all four now, before any /ask build"; chose owner-or-manager for the confirm role over signing, over owner-only, and over proposer-plus-owner |
| 2026-09-12 | This session, correcting itself | The rate-limiting finding as first reported ("zero throttler anywhere in the gateway") was WRONG — the grep was for the wrong word and a real global limiter exists. Corrected in Context above with the measurement. The file was briefly overwritten before the mistake was caught and was restored byte-identical to `origin/main` |
