# 0097 — The gateway says which build it is, and the audit proves presence rather than observing an absence of complaint

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — commissioned as "is production running what we merged?" being unanswerable
- **Keywords:** deploy, provenance, liveness, readiness, Railway, workflow_run, skipped-is-not-passed, absence-reported-as-health, NestJS DI, api-gateway
- **Links:** [[0092-parity-compares-against-what-was-merged]] (the same "a green check verified nothing" family, one system over), [[0086-a-count-confesses-what-it-could-not-count]], [[0085-a-fixture-tests-the-guard-not-the-checkout]], [[absence-reported-as-health]] (the memory this is an instance of), [[production-deploy-verification]]

## Context

Every deploy claim in this repository was unfalsifiable, in three separate ways
that compounded.

**1. A 200 does not name a build.** `/api/v1/health/live` is dependency-free by
design and, since PR #254, reports `commit` and `bootedAt`. `deploy.yml` polled
it and required a 200 — and stopped there. The **previous instance answers 200
perfectly**, so a green audit during a failed Railway deploy was byte-identical
to a green audit during a good one. The payload carried the answer and nothing
read it.

**2. Liveness answers 200 in states where nothing works.** It touches nothing on
purpose — that is what makes it safe as the platform's restart probe, and it is
also its ceiling. A process whose `DatabaseService.onModuleInit` never assigned a
client, or whose database is unreachable, returns `{"status":"ok"}` while every
data route 500s. Nothing in the audit asked a deeper question.

**3. A skipped gate reads as "not applicable".** `Deploy to Production` is
`workflow_run`-gated on CI. When CI is red on main the event still fires, every
job's `if` evaluates false, and GitHub records the workflow as **`skipped`** — a
grey dash, not a failure and not a warning.

### Measured, 2026-09-02 (re-measured in this session, not carried forward)

| fact | value |
|---|---|
| last 30 `deploy.yml` runs with conclusion `skipped` | **12** — a contiguous block covering every merge in that window |
| what a skipped run reports over the API | `"conclusion": "skipped"` — never `failure` |
| audits that compared a deployed sha against a merged sha | **0** (the comparison did not exist) |
| routes proving the database is reachable | **0** |
| `/api/v1/health/live` on a booted app with an unreachable database | **200 `{"status":"ok"}`** |

The third row is the load-bearing one. Railway auto-deploys on push to `main`
regardless of CI, so during that block of twelve, production was repeatedly
replaced with a build that nothing verified, and the pipeline's own record said
neither "verified" nor "failed" — it said nothing at all, in a shape that reads
as fine.

## Decision

**Three changes, each closing one of the three.**

### 1. The build provenance is injected by the build, and its absence is loud

`apps/api-gateway/src/health/build-provenance.ts` reads the revision once at
module load, from the first non-blank of `RAILWAY_GIT_COMMIT_SHA`,
`GIT_COMMIT_SHA`, `SOURCE_COMMIT`, `VERCEL_GIT_COMMIT_SHA`. Both health payloads
share it, so one process reports one boot time.

**How the value gets in — two independent paths, neither of them git at runtime:**

- **Baked at image build time.** `apps/api-gateway/Dockerfile` declares
  `ARG GIT_COMMIT_SHA=""` and freezes it into the runtime layer as
  `ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA`. Railway passes a service's variables to
  the Docker build as build args, so setting the service variable
  `GIT_COMMIT_SHA=${{RAILWAY_GIT_COMMIT_SHA}}` bakes the deployed revision into
  the artifact, where it cannot drift from it.
- **Supplied at runtime.** `RAILWAY_GIT_COMMIT_SHA`, which Railway sets for a
  service deployed from GitHub. Read first, because a runtime value belongs to
  the deployment actually running, and because it needs no Dockerfile change.

**Not `git rev-parse` at runtime**, which answers one of three ways, all wrong:
there is no `.git` in the image (only `apps/api-gateway` and `dist` are copied),
so it errors; or in a checkout-based runner it reports the working tree, which is
not what was built; or it reports a branch tip that has moved since.

**When neither path delivers, the payload says the literal `"unknown"`** — never
omitted, never a default that looks like an answer — and a production process
additionally prints a one-line warning at boot. A plausible value here would be
worse than no endpoint at all: the audit compares this string, so a fabricated
one is a check that certifies its own blindness.

### 2. `/api/v1/health/ready` — a second route that cannot lie about serving

`readiness.controller.ts`, 200 or **503**, unauthenticated, registered at the
root alongside liveness. It checks three things in order and names which failed:
`DatabaseService` was injectable; `onModuleInit` actually left a client behind;
and a bounded (4s) HEAD round trip to PostgREST for `restaurants` succeeded.

Unauthenticated because a token-gated readiness check runs only when
`E2E_TEST_TOKEN` happens to be set — a check that silently does not run, which is
the fault being fixed reappearing inside the fix. (The step it replaces had
exactly that shape.) Bounded accordingly: the probe is a HEAD request so no rows
can be returned; the answer is memoised for 5s so a flood costs one round trip
per window; failures use a fixed vocabulary, never the driver's message, which
can carry the project URL. `checkedAt` states the answer's age rather than asking
to be trusted.

**What it does NOT prove, stated because overclaiming is this ADR's own subject:**
it does not prove "the injector resolved" in general. Nest boots with
`abortOnError: true`, so a DI failure kills the process before any route serves,
including this one. From outside, a DI failure looks like *the previous instance
still answering 200 on both routes* — which no status code can distinguish. Only
the provenance can, which is why §3 exists and why readiness carries `commit` too.

### 3. The audit proves presence

- **`scripts/check_deployed_sha.py`** polls liveness until the reported `commit`
  **is** the merged sha, and reports `MATCH` (0) / `MISMATCH` (1) / `UNKNOWN` (1)
  / `MALFORMED` (2) / `UNREACHABLE` (2). It polls because Railway swaps the
  instance on its own schedule and "not yet" and "never" are identical at any
  instant; only a deadline separates them. It fails on `"unknown"` as loudly as
  on a mismatch. `--self-test` stands up a real HTTP server on localhost and
  drives the real polling path through all five outcomes.
- **`deploy.yml` Stage 2** runs it, and then requires `/health/ready` to answer
  200. The audit artifact gains `provenance_verified`, which distinguishes "we
  confirmed the right build is serving" from "nothing complained".

### Which of the two skipped-gate options was taken: **BOTH, and (a) is primary**

The brief allowed a fallback if a skipped `workflow_run` job could not be made to
fail. It can, so both shipped:

- **(a) The gate is red, not grey.** `ci-gate` no longer carries
  `if: workflow_run.conclusion == 'success'`. It always runs and **fails
  explicitly** when the triggering CI run did not succeed, naming the conclusion
  and the sha. Downstream stages still skip — correctly, there is nothing to
  verify — but they skip underneath a **failed** workflow. This covers every
  future run and is the primary mechanism.
- **(b) `scripts/check_deploy_audit_ran.sh <sha>`** answers *"is there a completed
  audit that actually checked the gateway for this revision?"* — retrospectively,
  including for the twelve shas that merged before any of this existed, which (a)
  by construction cannot reach. It deliberately does **not** trust the
  workflow-level conclusion: a workflow `success` is compatible with every real
  stage having been skipped, which is precisely how this failed before. It reads
  the **job** `Stage 2 — API Gateway`.

(b) is a query tool and is **not** wired in as a blocking CI job. That was
considered and rejected — see below.

## Rejected alternatives

**Read the sha with `git rev-parse` at runtime.** Cannot work in the image and
would answer *plausibly wrong* where it did run, which is worse than "unknown".

**Fall back to a package version, a build timestamp, or `bootedAt` alone when no
sha is injected.** Each is a value that looks like an answer. `bootedAt` in
particular is seductive — it does move on a successful redeploy — but it cannot
distinguish a redeploy of the *right* build from a crash-loop restart of the
*wrong* one, and an audit that accepts it would pass a failed deploy whose old
instance happened to restart.

**Let `commit: "unknown"` pass the audit with a warning.** This is the exact
shape of the fault being fixed: a check that reports success on a condition it
did not verify. It fails, and the failure text names the one variable to set.

**Fold readiness into liveness.** Then a database blip restarts a healthy process
— the classic mistake, and the reason liveness was written dependency-free.

**Gate readiness behind a JWT.** It would then run only when a token secret is
set, i.e. sometimes, i.e. absence reported as health.

**Make `check_deploy_audit_ran.sh` a required CI job asserting that
`origin/main`'s tip was audited.** Attractive: it would block merging onto an
unaudited main. Rejected on measurement — main is `strict: true` with three or
four sessions merging concurrently and CI around nine minutes, so a check that
depends on an external platform finishing a deploy would starve the queue and
train everyone to treat a red required check as noise. That is how a gate becomes
decorative. It stays a tool the founder and any session can run on demand, and
(a) carries the blocking duty.

**Weaken anything to make this green.** Explicitly not done. No check reports
success on a condition it did not verify, and branch protection is untouched.

## Verification — measured, not asserted

**A real process reporting a real sha** (built image, `node dist/main`, the
revision supplied only as a build variable):

```
GET /api/v1/health/live
{"status":"ok","commit":"77eb7888e201b8154f0aca02d292550319c6ab04","bootedAt":"2026-09-02T23:13:08.363Z"}   HTTP 200

GET /api/v1/health/ready          (same process, database unreachable)
{"commit":"77eb7888…","bootedAt":"…","checkedAt":"…","status":"not_ready",
 "checks":{"injector":"resolved","supabaseClient":"initialised","database":"unreachable"},
 "reason":"database probe rejected"}                                          HTTP 503
```

That pair is the whole argument for a second route: **200 and 503 from one booted
process**, in a state where the app cannot serve a single data request.

**The audit failing when the shas disagree** (same live process, a different sha
presented as "merged"):

```
MISMATCH — a DIFFERENT build is serving: running 77eb7888…, merged 0f157dea…   exit 1
```

**The audit refusing `"unknown"`** (a second process booted with no revision
variable):

```
{"status":"ok","commit":"unknown","bootedAt":"…"}
[build-provenance] No build revision injected — … the deploy audit cannot verify
                   which build is running. Set one of: RAILWAY_GIT_COMMIT_SHA, …
UNKNOWN — the gateway is up but cannot say which build it is                   exit 1
```

**The Dockerfile bake**, the two `ARG`/`ENV` lines lifted verbatim into a probe
image:

```
build --build-arg GIT_COMMIT_SHA=77eb7888…  ->  {"baked":"77eb7888e201b8154f0aca02d292550319c6ab04"}
build with no build arg                     ->  {"baked":""}          (never a default)
run  -e GIT_COMMIT_SHA=runtime-wins         ->  {"baked":"runtime-wins"}  (paths independent)
```

**`check_deploy_audit_ran.sh` against real GitHub history**, all three states:

```
8bacb131dc46bb…  run 33652544580 completed/skipped  -> NOT AUDITED (skipped)        exit 1
77eb7888e201b8…  Stage 2 — API Gateway -> success   -> AUDITED                      exit 0
0f157dea0000…    no run exists                      -> NOT AUDITED (never ran)      exit 1
```

**Suites:** `check_deployed_sha.py --self-test` 8/8 including the mismatch;
`npx jest src/health` **18/18** across 4 suites; `npx tsc --noEmit -p
tsconfig.spec.json` clean; `scripts/check_gateway_boots.sh` PASS (the real
`AppModule` injector resolves with the new root controller).

## What this does NOT fix — named, not quietly left

- **The Railway service variable is a settings change, not a code change.**
  Nothing in this repository can assert it is set. Until it is, the gateway
  reports `commit: "unknown"` and **Stage 2 fails on every merge** — deliberately
  and loudly, because the alternative is an audit that passes without checking.
  This is the one action required of the founder.
- **The orchestrator has no provenance route.** Stage 1 still only proves *a*
  orchestrator is up and its agents are Active. The same fault, one service over.
- **Vercel is unverified.** Stage 3 builds the frontend in CI and curls the
  production URL; nothing compares the deployed frontend's revision to the merged
  one.
- **The twelve skipped audits are not retroactively performed.**
  `check_deploy_audit_ran.sh` makes their absence *visible*; it cannot make them
  have happened.
- **`apps/api-gateway/openapi.json` is stale and stays stale.** It predates the
  liveness route from #254, so it lists neither `/health/live` nor `/health/ready`.
  No CI job checks it against the running app, which is why it drifted; regenerating
  it here would bury this change under an unrelated diff. Named so the next person
  does not read its absence as "these routes are undocumented".
- **`--build-arg` plumbing on Railway is documented, not executed.** The bake was
  proven with the real Dockerfile lines in a probe image; the full api-gateway
  image was not built locally, and Railway's build-arg passing is asserted from
  its documented behaviour, not measured against this project's service.
