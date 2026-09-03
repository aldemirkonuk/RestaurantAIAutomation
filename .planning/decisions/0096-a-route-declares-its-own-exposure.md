# 0096 — A route declares its own exposure

- **Status:** Locked
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder), via coordinator — *make the guard force every route to say which it is*
- **Keywords:** routes, guards, @Public, JwtAuthGuard, TenantGuard, APP_GUARD, guard ordering, CI ratchet, declarative, OD-20, auth-by-omission, liveness
- **Links:** [[0019-p2-build-scope]] (§D2/D3, the guard sweep this generalises), [[0094-a-verifier-that-cannot-verify-does-not-admit]], `scripts/check_route_exposure.py`, `apps/api-gateway/src/common/tenant/tenant.guard.ts`

## Context

Nest applies authentication with decorators. A controller may carry
`@UseGuards(JwtAuthGuard)` at class level; a route may carry its own guard, or
`@Public()` to opt out. **On a controller with no class-level guard, a route
carrying `@Public()` and a route carrying nothing are runtime-identical** —
both are reachable without a token. The difference is legible only to a human
reading for intent, and only if they already know which controllers have class
guards.

`AuthController` is the exhibit: **29 routes, no class-level guard**, of which
**8 say `@Public()`**, 15 carry an auth guard, and **6 said nothing at all** —
`login` (`:52`), `register` (`:92`), `oauth/google` (`:107`),
`oauth/microsoft` (`:122`), `refresh` (`:137`), `verify-email` (`:421`).

**All six are legitimately unauthenticated.** They are the routes you use
before you hold a token, and `verify-email` authenticates with a one-time token
in its body. **None is a hole, and this ADR does not claim a vulnerability.**

That is the stronger argument, not the weaker one. The defect is
**declarative**: a reader cannot distinguish 8 deliberate decisions from 6
omissions, so route number 30 gets added silently public and nothing —
not a guard, not a test, not a review checklist — can see that it differs from
the 8. **OD-20 happened exactly this way**: five controllers were reachable
without authentication because no decorator said they should not be, and
`TenantGuard` waved them through because it fails open by design. The absence
of a decorator read as a decision.

Two things were found while building the check, both of which changed the
result:

1. **A seventh route**, missed by the hand count that preceded this work:
   `liveness.controller.ts:97` (`GET /health/live`). It must stay public —
   `deploy.yml:171` polls it unauthenticated, and a liveness probe that needs a
   token cannot answer *"did the process come up?"* when the thing that failed
   to come up is auth. It had no `@Public()` either.

2. **The first version of this guard was wrong, in the same shape it exists to
   catch.** It matched `@Public()` and `@UseGuards(...)` anywhere in the file,
   and the controllers here carry long class docstrings that *discuss those
   decorators by name* — `CommunicationsController`'s OD-20 header mentions
   `@Public()` seven times. Every one of its 17 routes was reported `public`,
   including the 16 that are JWT-guarded. A guard that reads prose as code
   answers confidently and wrongly, which is worse than not running. Comments
   are now stripped before matching, and that case is pinned in the guard's own
   `--self-test`.

**A correction to this session's own earlier report.** The hand count relayed to
the coordinator described AuthController as "23 deliberate `@Public()`
decisions versus 6 omissions". The real figure is **8**. The 23 came from
eyeballing a `grep` that mixed `@Public()` lines with `@UseGuards` lines. The
argument is unchanged — it is 8 declarations against 6 silences rather than 23
— but the number was wrong and is corrected here rather than quietly dropped.

## Options considered

1. **Do nothing.** Rejected. The six were not a hole *today*; the cost is
   entirely in the next route somebody adds.
2. **Add `@Public()` to the six and stop there.** Rejected as the whole answer:
   it fixes the instances and not the shape, and this repo's rule is that
   solving something once means adding the guard that keeps it solved.
3. **Promote `JwtAuthGuard` to an `APP_GUARD` and mark every public route
   `@Public()`.** This is the architecturally clean fix — it would make
   "declares nothing" mean *guarded*, the safe default, and would let
   `TenantGuard` refuse. Rejected **here** as out of scope and a founder
   decision: it changes the default for all 470 routes across 50 controllers at
   once, and a single missed `@Public()` takes a live route down. Recorded as
   the option, not dismissed.
4. **Make `TenantGuard` refuse instead of warning.** Rejected on measurement —
   see below.
5. **Declare the seven, and add a CI ratchet that fails on any route declaring
   neither.** Chosen.

## Decision

**`scripts/check_route_exposure.py` fails CI when any gateway route declares
neither an authentication guard nor `@Public()`.** It classifies every route
into one of four buckets and prints the counts:

| Bucket | Meaning |
|---|---|
| `auth-guarded` | an auth-shaped guard applies, at class or route level |
| `public` | `@Public()` — the intent is recorded |
| `guard-not-recognised` | guarded by something that does not authenticate (a throttle, a production kill-switch). Listed, not failed — the gap is made visible rather than assumed safe |
| `UNDECLARED` | neither. **Fails the build** |

It does **not** decide whether `@Public()` is the *right* answer for a route —
nothing mechanical can. It refuses to let a route decline to answer.

**The seven routes are declared**, each with a one-line reason next to it, which
is the actual deliverable: the intent is now written where the next reader is.

**It is never vacuous.** Exit 2 — not 0 — when it cannot do its job: no
controllers found, no routes parsed, or a controller whose class it cannot
locate. It carries a `--self-test` with six fixtures, including the
comment-as-code case that the first version got wrong.

## On `TenantGuard`: the fall-through is kept, and the argument is engaged

`tenant.guard.ts` returns `true` when `request.user` is absent, with only a
`logger.warn`. The obvious move is to refuse there. **It cannot be done at that
point, and the reason is ordering, not caution.**

Nest runs global guards before controller guards. `TenantGuard` is an
`APP_GUARD` (`app.module.ts:135`) and `JwtAuthGuard` is **not** — it is applied
per controller with `@UseGuards` (verified: no `useClass: JwtAuthGuard` appears
in `app.module.ts`). So on a correctly guarded, correctly authenticated route,
`request.user` is *also* undefined at that moment, because passport has not run
yet. The branch cannot tell *"route with no guard"* from *"route whose guard is
about to run and will pass"*. Refusing would 403 every authenticated route in
the gateway. This is the same ordering fact that
`common/tenant/assert-tenant-match.ts` was extracted to work around.

So the fall-through stays. **What was actually wrong is that the warning was
the only thing that would ever notice a guardless route**, and a warning in a
log nobody reads is not a control. That gap is closed *outside* the request
path, where the question is answerable — static analysis can see the decorators
that the guard, at that instant, cannot. The comment at the branch now says so
and names the script, so the next reader finds the compensating control instead
of an unexplained `return true`.

## Consequences

- **Exit codes, measured with the final script.** Against `origin/main`
  (`92891200`): **exit 1**, `470 routes across 50 controllers` —
  `auth-guarded 446`, `public 17`, `guard-not-recognised 0`, **`UNDECLARED 7`**.
  After the change: **exit 0** — `auth-guarded 446`, `public 24`,
  `guard-not-recognised 0`, `UNDECLARED 0`. `--self-test`: 6/6, exit 0.
- **`guard-not-recognised` is 0 today.** Every guarded route in the gateway is
  guarded by something auth-shaped. If that number ever rises it is printed,
  not hidden.
- **The seven `@Public()` additions are runtime no-ops.** Neither
  `AuthController` nor `LivenessController` has a class-level guard, so nothing
  was reading the metadata. They change what the code *says*, which is the
  point — and they become load-bearing the moment option 3 is ever taken.
- `npx tsc --noEmit -p tsconfig.spec.json` exits 0; `auth` + `health` suites:
  **107 passed / 107** across 15 suites.

**What this does NOT fix, named rather than implied:**

- **Whether each `@Public()` is correct.** The guard checks that a decision was
  recorded, not that it was right. The seven were each read and reasoned about;
  the other 17 were not re-litigated.
- **Guards it cannot see.** A guard applied via `APP_GUARD` in a module, or
  composed inside a custom decorator, is invisible to static analysis. Such
  routes surface as `guard-not-recognised` rather than passing silently, but a
  future global auth guard would need this script taught about it.
- **The `APP_GUARD` promotion (option 3).** The architecturally correct default
  is still not taken; this ratchet is the compensating control, not a
  replacement.
- **Controllers outside `apps/api-gateway/src`.** The orchestrator and other
  services are not scanned.
- **`TenantGuard`'s fall-through.** Kept deliberately, argued above, unchanged
  in behaviour.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Coordinator | Directed the ratchet, accepted the "six not five" correction, and asked that `TenantGuard`'s deliberate fall-through be *engaged* rather than overridden — explicitly allowing "the ordering makes it impossible, so CI is the whole control" as a legitimate outcome. That is the outcome. |
| 2026-09-02 | Aldemir | Pending. Option 3 (promote `JwtAuthGuard` to `APP_GUARD`) is the open follow-up. |
