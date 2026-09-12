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
| consecutive `deploy.yml` runs concluding `skipped` | **49**, unbroken — 2026-09-01T13:06:36Z → 2026-09-02T16:14:18Z, **44 distinct revisions**, over 27 hours in which the audit never ran once |
| `skipped` runs in the last 200, all of them since 2026-08-24 | **77** |
| what a skipped run reports over the API | `"conclusion": "skipped"` — never `failure` |
| audits that compared a deployed sha against a merged sha | **0** (the comparison did not exist) |
| routes proving the database is reachable | **0** |
| `/api/v1/health/live` on a booted app with an unreachable database | **200 `{"status":"ok"}`** |

The first row is the load-bearing one. Railway auto-deploys on push to `main`
regardless of CI, so across those 44 revisions production was repeatedly replaced
with a build that nothing verified, and the pipeline's own record said neither
"verified" nor "failed" — it said nothing at all, in a shape that reads as fine.

**A correction is on the record here.** This session first measured the fault as
*"12 of the last 30 runs skipped"*, and by the time the branch was pushed the same
query returned **11** — the window had slid as other sessions merged. A
last-N-runs count is not a claim; it is a reading that decays while you write it
down. Re-measured as an anchored fact — an unbroken run of 49, bounded by two
timestamps and a count of distinct revisions — it does not drift, and it is
considerably worse than the figure it replaces. Numbers get re-measured, never
copied forward (CLAUDE.md §5b); this one was caught by obeying that rule inside
the session that wrote it.

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
  including for the 44 revisions that merged unaudited before any of this existed,
  which (a) by construction cannot reach. It deliberately does **not** trust the
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

**Against REAL production**, not a local double — `SSL_CERT_FILE=/etc/ssl/cert.pem`
because this Mac's python.org interpreter has no root store (see below):

```
--expect <origin/main tip 92891200…>  ->  MATCH — running 928912003840bcb086cc1cf4f3642753aac47771   exit 0
--expect 0f157dea…  (a different sha) ->  MISMATCH — a DIFFERENT build is serving                    exit 1
GET /api/v1/health/ready              ->  HTTP 404 (correct — the route is on this branch, not main)
```

**A defect this found in itself.** Pointed at production, the first version
reported `CERTIFICATE_VERIFY_FAILED` as *"no response from …"* — i.e. it blamed
the gateway for a missing CA bundle on the machine running the check. The
transport error is now carried into the verdict line and the advice block names
the case. Found only by running it against something real; the localhost
self-test cannot reach it.

**Suites:** `check_deployed_sha.py --self-test` 8/8 including the mismatch;
`npx jest src/health` **18/18** across 4 suites; `npx tsc --noEmit -p
tsconfig.spec.json` clean; `scripts/check_gateway_boots.sh` PASS (the real
`AppModule` injector resolves with the new root controller).

## What this does NOT fix — named, not quietly left

**Added 2026-09-06.** This list was written before Stage 2's comparison was
known to be wrong, and a reader arriving here alone would conclude the check is
sound. It is not: the `running == expected` comparison this ADR's §3 introduced
gets **three** correct production states wrong. One (a Railway watch-path skip)
was fixed by PR #291 — see this file's `## Correction`. The other two — a later
merge superseding the audited one mid-poll, and a running build labelled with a
non-watched commit newer than the resolved one, the latter **confirmed live
against production** — are open, measured, and recorded as
[`v3.0-TECH-DEBT.md` 44.2d](../v3.0-TECH-DEBT.md). Absence of a caveat here was
being read as correctness, which is this ADR's own subject.

- **The Railway variable turned out to need no action — because it was measured,
  not assumed.** This ADR was drafted saying *"nothing in this repository can
  assert a platform setting, so until the founder sets `GIT_COMMIT_SHA`, Stage 2
  fails every merge"*. That was written without asking production. Asking it,
  2026-09-02T23:3xZ:

  ```
  GET https://wineopsapi-gateway-production.up.railway.app/api/v1/health/live
  {"status":"ok","commit":"928912003840bcb086cc1cf4f3642753aac47771","bootedAt":"2026-09-02T23:31:01.642Z"}
  ```

  That is a real 40-character revision, and it is `origin/main`'s tip
  (`92891200 fix(toast): close the mock-data escape in production (ADR 0020) (#223)`).
  So **`RAILWAY_GIT_COMMIT_SHA` is already in the service's runtime environment**
  and the audit will verify against it on the first merge after this lands. No
  founder action is required. The Dockerfile bake stays as the second, independent
  path — it survives a runner that does not set the runtime variable — but it is
  belt-and-braces, not a prerequisite.

  Recording the near-miss because it is the ADR's own subject one level up: an
  unverified "the founder must do X" is the same class of unfalsifiable claim as
  an unverified "the deploy is healthy". It cost one `curl` to settle.
- **The orchestrator has no provenance route.** Stage 1 still only proves *a*
  orchestrator is up and its agents are Active. The same fault, one service over.
- **Vercel is unverified.** Stage 3 builds the frontend in CI and curls the
  production URL; nothing compares the deployed frontend's revision to the merged
  one.
- **The 49 skipped audits are not retroactively performed.**
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

## Correction — 2026-09-03, found by PR #291's own compliance and correctness audits

This ADR's Decision section (and `CLAIMS.jsonl:154`, unchanged until this
correction) stated the invariant as "Stage 2 compares the deployed revision
against **the merged sha**." That stopped being literally true the moment PR
#291 landed, found and fixed the same day as ADR 0090's PR-audit-gate went
live (the two efforts are unrelated in cause, coincident in date): Railway's
`@wineops/api-gateway` only rebuilds when a push touches its own
`watchPatterns` (`apps/api-gateway/**`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `package.json`), so a merge that legitimately does not
touch those paths makes Railway correctly SKIP a rebuild — and comparing the
still-running (correct) build against the raw merged sha reported a false
MISMATCH. Confirmed live on two consecutive real merges: PR #284 and PR
#261 (ADR 0090's own introducing PR) both correctly skipped an api-gateway
rebuild and both then failed this exact check for it — the deploy audit this
ADR built, catching a defect in a system this ADR did not anticipate.

**The invariant is now:** Stage 2 compares the deployed revision against the
merged sha for an ordinary change, or — for a path-scoped service, when the
merge itself did not touch that service's watched paths — against the last
commit that did. `scripts/resolve_watched_commit.py` (new) resolves which
commit applies; `deploy.yml`'s Stage 2 passes that resolved commit to
`check_deployed_sha.py --expect`, not the raw merged sha directly.
`CLAIMS.jsonl:154` is marked superseded (kept, not deleted, per this file's
own append-only convention) and replaced with a claim whose `verify` asserts
the new comparison target by name, not by a substring that could survive the
target moving underneath it — the exact gap PR #291's compliance audit found:
the old `verify` command greps for `head_sha` anywhere in the job's run text,
which still passed after this PR because `head_sha` simply moved into the new
resolver step, so a claim that had gone false kept reporting as resolved.

**A second, more severe defect was found and fixed in the same PR, before it
ever merged:** the first version of `resolve_watched_commit.py` used plain
`git log <sha> -- <paths>`, which applies git's default history
simplification — at a real (non-squash) merge commit M that is TREESAME to
one parent for the watched paths, git silently follows only that parent and
never reports M itself. Reproduced against 4 of this repo's own real merge
commits and in a constructed case: the pre-fix function resolved a
side-branch commit that was never `main`'s pushed head and that Railway never
built from, flipping a correct MATCH into a false MISMATCH for an ordinary,
successful merge-commit deploy — a strict regression against the pre-PR-291
behaviour, not merely an incomplete fix. `git log --first-parent` closes it;
`resolve_watched_commit.py --self-test` now builds a real `git merge --no-ff`
commit and asserts against it, not only a linear history, so this class of
bug fails a committed test the next time rather than needing a second live
merge to notice it again.

**Left open, not defaulted:** the `--paths` list `deploy.yml` passes to the
resolver is a hand-typed mirror of Railway's dashboard `watchPatterns`
setting, with no guard against the two drifting apart — filed as
[OD-122](OPEN-DECISIONS.md) rather than decided here, since the fork (read
Railway's config live vs. keep the hand-mirror) is the founder's per
CLAUDE.md §0.1, and the concrete failure direction (a real failed deploy
certified MATCH against a stale, too-narrow mirror) is exactly this ADR's own
"never weaken anything to make this green" line, reached from a different
angle than the one this ADR's Decision section anticipated.
