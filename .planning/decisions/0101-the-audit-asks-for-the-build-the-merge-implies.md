# 0101 — The deploy audit asks for the build the merge IMPLIES, not for the merged sha

- **Status:** Proposed
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — commissioned as "Stage 2 produces false failures, measured twice"
- **Keywords:** deploy, provenance, Railway, watchPatterns, false failure, decorative gate, absence-reported-as-health, api-gateway, ancestry
- **Links:** [[0097-the-gateway-says-which-build-it-is]] (this repairs its Stage 2), [[0020-no-fabricated-answers]], [[0092-parity-compares-against-what-was-merged]] (the same "compare against the right thing" family), [[absence-reported-as-health]] (this is that fault INVERTED), [[production-deploy-verification]], [[merge-races-need-sequencing]]

## Context

ADR 0097 closed a real hole: the deploy audit accepted a 200 from
`/api/v1/health/live` as proof of a deploy, and the *previous* instance answers
200 perfectly. It replaced that with `scripts/check_deployed_sha.py`, asserting
**`running == merged`**.

That assertion is wrong, and it was red by construction on ordinary merges.

**Railway rebuilds a service only when a push touches that service's
`watchPatterns`.** `.railway/railway.ts:98` declares, for `@wineops/api-gateway`:

```ts
watchPatterns: ["/apps/api-gateway/**", "/pnpm-lock.yaml", "/pnpm-workspace.yaml", "/package.json"]
```

So a merge that changes only `.planning/**` correctly does **not** rebuild the
gateway. The running build stays at the newest commit that *did* touch a watched
path — and the audit called that a MISMATCH while naming the correct build in
its own error message.

### Measured, 2026-09-03 — every merge since the comparison landed

`scripts/check_deployed_sha.py` entered `main` at `bc2f570e` (#269). Of the
**twelve** merges from that commit to `origin/main` at the time of writing:

| merge | touches a watched path? | `deploy.yml` |
|---|---|---|
| `47f971de` `cd21538c` `36a9b9d2` `0082cf82` `671c647d` `bc0b1498` `07698dee` `46d02cb0` `ca964189` | **yes** (9) | success ×9 |
| `3f796269` `01841db9` `e08a6aaa` | **no** (3) | **failure ×3** |

**Three of three.** The audit's verdict was a function of whether the merge
happened to touch `/apps/api-gateway/**`, not of whether the deploy landed. Not
one of the three was a real deploy failure.

Two distinct shapes produced it, and run `33704594104` (#235, merged
`01841db9`) contains **both**, in sequence across its 61 attempts:

```
attempts  1-16   running 07698dee   the newest WATCHED ANCESTOR of the merge
attempts 17-61   running bc0b1498   a LATER merge, which superseded it mid-poll
```

`07698dee` is `git rev-list --first-parent -1 01841db9 -- <watchPatterns>` — the
build Railway owed us. `bc0b1498` is a descendant of `01841db9` that merged ten
minutes into the poll (three or four sessions merge here concurrently; see
[[merge-races-need-sequencing]]). Run `33699054120` (`e08a6aaa`) failed the same
way an hour earlier, reporting `bc2f570e` then `ca964189`. Run `33706023515`
(#238, `3f796269`) reported `bc0b1498`, which is exactly its watched ancestor.

**The founder's brief attributed #235 to the supersession race alone. The log
says both mechanisms fired inside that one run**, and the first sixteen attempts
are the *unchanged* shape, not the race. Recorded because the difference changes
what the fix has to cover: fixing only the race would still have failed that run
for its first sixteen attempts and every docs-only merge afterwards.

### Why this matters more than a flaky check

Per [[production-deploy-verification]], `Deploy Audit Record` is *the* gate that
says which build is serving — the one thing CI structurally cannot see. ADR 0097
had just spent an entire ADR making it fail loudly instead of skipping. A gate
that is red on ordinary merges gets read as noise, and the fix people reach for
is to stop reading it. This is [[absence-reported-as-health]] **inverted**:
health reported as failure. The end state is identical — a gate nobody believes.

## Decision

**Stage 2 asks a different question. The answer is not weakened.**

Let `M` be the merged sha, `TIP` the current tip of `main`, and

```
FLOOR = the newest commit in M's first-parent history (M itself included)
        whose diff touches this service's watchPatterns
```

`FLOOR` is the build Railway owed us for `M`. The running build `R` is accepted
exactly when

```
FLOOR  ⪯  R  ⪯  TIP          (⪯ = "is an ancestor of, or is")
```

reported as three distinguishable passes and two failures:

| relation | verdict | exit |
|---|---|---|
| `R == M` | `MATCH` — the merged build is serving | 0 |
| `FLOOR ⪯ R ≺ M` | `UNCHANGED` — `M` touched nothing this service watches; `R` is the build it implies | 0 |
| `M ≺ R ⪯ TIP` | `SUPERSEDED` — a later merge landed mid-poll | 0 |
| `R ≺ FLOOR` | `MISMATCH` — the build for `FLOOR` never landed | 1 |
| `R` not an ancestor of `TIP` | `MISMATCH` — something not on main is serving | 1 |

**When `M` itself touches a watched path, `FLOOR == M` and the window collapses
to `R == M` or a descendant** — i.e. the original strict check, for exactly the
nine merges the original check was right about. The relaxation reaches only the
merges where the strict question had no correct answer.

**The failure this exists for is untouched.** A gateway change whose Railway
build fails leaves the previous build serving, which is `≺ FLOOR`, which is
`MISMATCH`. Replayed against the real commits below, not a fixture.

### The watch patterns are READ, never duplicated

`read_watch_patterns()` parses `.railway/railway.ts`. Copying the four patterns
into the workflow would create two records of one deploy trigger, and the copy in
CI would drift toward passing — which is the shape of every fault in this family.
A service name that is not declared, an empty `watchPatterns`, or a negated
pattern **raises**; none of them defaults.

### Everything that cannot be established is `exit 2`, not a pass

A new `INDETERMINATE` verdict covers: a shallow checkout (the first-parent walk
would be truncated), a reported sha this clone does not have, an unparseable
railway config, and no watched commit within the 500-commit walk. `deploy.yml`'s
Stage 2 checkout gains `fetch-depth: 0` so the question is answerable at all.
`commit: "unknown"` still exits 1. Nothing here reports success on a condition it
did not check.

### The audit record says WHICH pass

The script prints one machine-readable `VERDICT=<STATE>` line on **every** path,
failures included, and `deploy-audit.json` gains `provenance_verdict`. "The
merged sha is serving" and "this merge changed nothing this service builds from"
are different facts, and flattening them into one boolean is how this fault
stayed invisible for three merges.

## Rejected alternatives

**Skip the provenance check when the merge touches no watched path.** The
obvious fix, and it is [[absence-reported-as-health]] reintroduced verbatim: the
audit would report success having verified nothing, on precisely the merges where
it currently reports something. `UNCHANGED` is a *positive* assertion — the
running build is the specific commit `FLOOR`, and an older one still fails.

**Assert only `R ⪯ TIP` ("the running build is somewhere on main").** Passes a
gateway deploy that failed six merges ago. It is the lower bound `FLOOR` that
carries all the weight; the upper bound only excludes builds that were never
merged.

**Assert `bootedAt` moved instead.** Already rejected in ADR 0097 and still
wrong: a crash-loop restart of the wrong build moves it.

**Make Railway rebuild the gateway on every push** (widen `watchPatterns` to
`/**`). Makes the strict check true by making every merge rebuild and redeploy
production — including docs-only ones. Trading a real deploy risk for a green
check is the worst available trade, and it would slow every merge.

**Compare against `origin/main`'s tip instead of the merged sha.** Then a
genuinely failed deploy of the audited commit passes as soon as anything else
merges. The audited sha has to stay the anchor; `TIP` is only the ceiling.

**Have the workflow hold a copy of the watch patterns.** Two sources of truth for
one platform setting, drifting silently toward passing.

**Retry-until-green, or a longer deadline.** Neither shape is a timing condition.
`UNCHANGED` never becomes `MATCH` no matter how long it polls — the build that
would make it match is one Railway is correctly never going to produce.

## Verification — measured, not asserted

**The three real failures, replayed against the real commits that produced
them** (`--assume-running` classifies a sha with no network, so the historical
observations are re-checkable forever):

```
merged=3f796269 running=bc0b1498  exit 0  VERDICT=UNCHANGED    (run 33706023515)
merged=01841db9 running=07698dee  exit 0  VERDICT=UNCHANGED    (run 33704594104, attempts 1-16)
merged=01841db9 running=bc0b1498  exit 0  VERDICT=SUPERSEDED   (run 33704594104, attempts 17-61)
merged=e08a6aaa running=bc2f570e  exit 0  VERDICT=UNCHANGED    (run 33699054120, attempts 1-19)
merged=e08a6aaa running=ca964189  exit 0  VERDICT=SUPERSEDED   (run 33699054120, attempts 20-61)
```

**The failure that must survive the relaxation**, same real history — a merge
that DID touch the gateway, with the previous build still serving:

```
merged=bc0b1498 running=07698dee  exit 1
::error::MISMATCH — running 07698deebfc1, which is OLDER than bc0b14983d01 —
         the build for bc0b14983d01 (it changed apps/api-gateway/src/toast/
         orchestrator-routes.ts) never landed
```

**And the other two rejections, unchanged from ADR 0097:**

```
running="unknown"                          exit 1  VERDICT=UNKNOWN
running=<a sha this clone does not have>   exit 2  VERDICT=INDETERMINATE
running=<a commit on no merged branch>     exit 1  MISMATCH — NOT on origin/main
```

**All twelve merges since the check landed, each with `running == merged`:**
12/12 exit 0. The nine that were passing still pass, for the same reason.

**`--self-test`, 32 cases, all green.** It stands up a real localhost HTTP
server *and* builds a **real git repository on disk** — a watched commit, docs
commits after it, and a commit on a branch that was never merged — then drives
the real polling path through every verdict: floor computation, `UNCHANGED`,
`SUPERSEDED`, older-than-floor, off-main, unknown object, shallow clone,
`unknown`, malformed, 502. It also asserts the four patterns it reads out of the
**real** `.railway/railway.ts`, so a config reshape fails here rather than in
production.

**Six mutations, each turning a claim red** (restored tree: 208/208 holding):

| mutation | claims red |
|---|---|
| the `UNCHANGED` branch removed | 4 |
| older-than-floor softened to a pass | 2 |
| `EXIT_FOR[INDETERMINATE] = 0` | 2 |
| unknown service defaults instead of raising | 2 |
| Stage 2 stops passing `--service` | 1 |
| Stage 2's checkout back to depth 1 | 1 |

`.planning/decisions/CLAIMS.jsonl` gains **8** ADR-0101 rows, five of which
replay the historical runs against real commits. `ci.yml`'s `decision-claims`
job gains `fetch-depth: 0` so those history questions are answerable there.

## What this does NOT fix — named, not quietly left

- **`.railway/railway.ts` is this repository's RECORD of a platform setting, not
  the platform.** If the live Railway service's watch patterns differ from the
  file, the expectation is derived from the wrong thing. The error directions are
  asymmetric and the safe one is the likely one: a file **broader** than reality
  moves `FLOOR` forward and fails loudly; a file **narrower** than reality moves
  `FLOOR` back and could accept a build older than Railway actually owed. Nothing
  in this repo can read the live setting; only a deploy-log comparison would
  settle it, and that was not done.
- **A docs-only merge is verified more weakly than a code merge, by nature.**
  For such a merge Stage 2 confirms that the *existing* build is the right one
  and is live and ready. There is no new build to verify, because there should not
  be one. That is correct, and it is less than the check does for a code merge.
- **Railway deploys the head of a PUSH, not each commit.** A multi-commit push
  whose head touches nothing watched would run a build labelled with the head sha.
  The window accepts it (it is `⪰ FLOOR`), so this is handled — but `FLOOR` is
  computed per commit, which is a slightly different question from what the
  platform asks. `main` is squash-merged and branch-protected, so pushes are
  single commits today; if that changes, this is the seam.
- **The orchestrator and Vercel still have no provenance at all.** Stage 1 proves
  *an* orchestrator is up with Active agents; Stage 3 builds the frontend in CI
  and curls the production URL. Neither compares a deployed revision to anything.
  Unchanged from ADR 0097, and the same fault one and two services over.
- **The three false failures are not retroactively made green.** Their runs stay
  red in the Actions list. `scripts/check_deploy_audit_ran.sh` reads the job
  conclusion, so it still reports those three revisions as NOT AUDITED — which is
  now itself wrong, and is left alone rather than papered over: re-running the
  audit for a sha is `gh workflow run deploy.yml -f mode=deploy-audit`, and that
  audits `github.sha`, not an arbitrary past revision.
- **The rollback playbook still uses the strict comparison, deliberately.** After
  redeploying a target image the running build IS that target, so
  `--expect $TARGET` with no `--service` is the correct question there.
