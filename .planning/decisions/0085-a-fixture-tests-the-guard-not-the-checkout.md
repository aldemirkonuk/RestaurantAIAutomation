# 0085 — A fixture tests the guard, not the checkout; and a skipped gate is not a pass

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** check_adr_numbers_unique, self-test fixture, shallow clone, single-branch, workflow_run, skipped, Deploy to Production, absence reported as health, CANNOT-CHECK, CI
- **Links:** [[0074-a-read-names-columns-that-exist]] (the same fault in a guard, one layer down), [[0025-citations-must-disagree-loudly]], PR #192 (added this guard)

## Context

`scripts/check_adr_numbers_unique.py` has failed on **every push to `main` for 14
consecutive merges** (2026-09-02, 10:05Z–13:00Z), while **every pull request
stayed green**. The failing job is `An ADR number names one decision`, which
gates `CI Complete`.

The consequence is the part that matters, and it is not a red badge.
`Deploy to Production` triggers on `workflow_run` against the CI workflow, so a
red CI makes it **`skipped`, not failed** — verified `skipped` on all 14. That
workflow is the post-merge health audit that exists **because CI cannot see Nest
DI failures** ([[production-deploy-verification]] in session memory). It has not
run for any merge today, and **a `skipped` row reads as "not applicable" rather
than "the check that catches production crashes did not run."**

**The guard itself is correct.** In a real CI-shaped checkout it exits 2 with
`CANNOT CHECK: 210 branch(es) on origin have no local ref` — exactly right. Only
its **self-test fixture** was wrong.

`_shallow_clone_must_exit_2()` cloned the *enclosing checkout* and asserted the
child exited 2. But the child's `origin` is then the parent, and
`remote_heads()` asks `origin` what exists:

| enclosing checkout | origin advertises | child holds | child exits | fixture wants |
|---|---|---|---|---|
| `pull_request` (many refs) | many | 1 | **2** | 2 → green |
| `push` (single-branch) | **1** | 1 | **0**, correctly | 2 → **red** |

git also warns `--depth is ignored in local clones`, so the fixture was never
shallow either — it was single-branch by accident of the parent's shape.

**A fixture that depends on the shape of the enclosing checkout is testing the
environment, not the guard.** That is why PR-green and push-red coexisted for
fourteen commits, and why nothing in the PR flow could ever have surfaced it:
the only builds that could fail were the ones nobody opens a PR against.

## Options considered

**A. Point the child's `origin` at the real remote URL.** Origin would advertise
GitHub's ~211 heads while the child holds one, so the child exits 2. Rejected:
it puts a **network dependency inside a self-test** whose entire job is to prove
an offline property, and it would fail closed on any runner without egress —
turning this guard's own test into a new source of red main.

**B. Require the enclosing checkout to carry more refs** (e.g. `fetch-depth: 0`
on the job). Rejected: it fixes the symptom by constraining the caller, leaves
the fixture just as dependent on its environment, and the next workflow edit
silently reintroduces it.

**C. Build the condition from nothing, inside the fixture.** Chosen.

## Decision

**The fixture constructs its own remote, and asserts why the child failed.**

A scratch repo seeded with two real ADR files → a **bare** repo carrying **two**
branches → a shallow single-branch clone of it over **`file://`** (a bare path
silently ignores `--depth`). Origin then advertises 2 while the child holds 1 —
the real condition, owned entirely by the fixture, identical on `push`, on
`pull_request`, and on a laptop.

**And it asserts the reason, not just the exit code.** There are **six** distinct
`CannotCheck` raises in this file. An empty or malformed fixture trips a
different one — passing the test while proving nothing about the ref
completeness it claims to cover. The fixture now requires the child's output to
name `no local ref`, and refuses to run at all if it cannot seed two ADR files.
A green test that could be green for the wrong reason is the same fault this
whole file exists to prevent, one level up.

## Consequences

- **`main` goes green and the post-merge health audit starts running again.**
  That is the actual deliverable; the guard was never broken.
- **The guard's production behaviour is unchanged** — proven, not assumed: it
  still exits 2 in a real shallow single-branch checkout, before and after.
- **A skipped job is an unknown wearing the costume of a pass.** `failure` is
  loud, `success` is checked, `skipped` is read by nobody. Any gate that can
  skip needs someone asking whether it **ran**, not whether it failed. Nothing
  currently asks that of `Deploy to Production`, and this ADR does not add it —
  that is a workflow-graph decision and wants its own record.
- **Not fixed here, and named rather than left implicit:** there is no version
  or sha endpoint on the gateway, so *"is production running the code we just
  merged"* is unanswerable. `/api/v1/health/live` is dependency-free by design,
  so its 200 proves the process is up and nothing about whether the injector
  built; a guarded route returning 401 is the real evidence. Raised separately.

## Verification

| What | Result |
|---|---|
| `--self-test` in a **CI-shaped checkout** (`git clone --depth 1 --single-branch --branch main <url>`), **before** | **exit 1** — the live defect, reproduced |
| Same checkout, same command, **after** | **SELF-TEST OK** |
| The **guard's own** behaviour in that checkout, after | **exit 2**, `210 branch(es) on origin have no local ref` — unchanged |
| Fixture **still catches a weakened guard** — `if missing:` replaced with `if False:` | **FAILS**, as it must: *"a shallow single-branch clone exited 0, want 2"* |
| `--self-test` on a full local checkout | OK |
| All **46** script invocations extracted from `ci.yml` | every one exit 0 |
| Push CI on `main`, 14 runs 10:05Z–13:00Z | `failure` on all 14; `Deploy to Production` `skipped` on all 14 |

The pre-fix state was reproduced by cloning from the remote in CI shape, never by
`git stash`, which is repo-global across worktrees.

## Consequences for the register

No `OPEN-DECISIONS.md` row ([[0025-citations-must-disagree-loudly]]: a new row
re-anchors citations). One `CLAIMS.jsonl` entry.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created |
| 2026-09-02 | Peer session (payment-reminder) | Found the failure and its cause independently; handed the fixture over rather than patching it, and reviewed the `file://` approach as preferable to their own network-based suggestion |
