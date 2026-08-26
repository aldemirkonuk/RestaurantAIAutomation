---
type: adr
id: 0028
title: Planning documents have one home, and CI keeps them there
status: proposed
updated: 2026-08-26
links: ["[[0026-schema-has-one-home]]", "[[0002-documentation-first-operating-mode]]", "[[0003-session-output-discipline]]", "[[OPEN-DECISIONS]]"]
---

# 0028 — Planning documents have one home, and CI keeps them there

- **Status:** Proposed
- **Date:** 2026-08-26
- **Decider:** Aldemir (founder) — not yet locked
- **Keywords:** retire-to-write, archive, duplication, milestone close, gsd-complete-milestone, corpus, single home, guard, drift
- **Links:** `scripts/check_planning_single_home.py`,
  `.github/workflows/ci.yml` (`planning-single-home`),
  CLAUDE.md §4, [0026 — Schema has one home](0026-schema-has-one-home.md)

> **Number.** 0025 is held by an unmerged branch (`docs/od-citation-sweep`, PR #93)
> and 0027 by another (`fix/od-95-push-subscription-source`). Both were found by
> scanning every worktree and remote branch before choosing, which is the check
> ADR 0026 introduced after four numbering collisions in one day. This takes
> **0028** — a gap over a collision.

## Context

CLAUDE.md §4 adopted **retire-to-write** on 2026-08-24: adding a document means
naming one to retire, merge, or supersede. The rationale was that the corpus had
eleven documents naming *split* triggers and three naming *merge* triggers, so
structures only ever ratcheted upward.

Two days later the rule had been satisfied — and not once honoured. Closing a
milestone copied every finished phase into `.planning/archive/vN.0-phases/` and
**left the original in `.planning/phases/`**. Measured on `origin/main` at
`63c2bccd`:

| | |
|---|---|
| files under `.planning/archive/` | **522** |
| of those, byte-identical to a live file | **469 (89.8%)** |
| bytes so duplicated | **6,411,152 of 6,917,555 (92.7%)** |
| live files under `.planning/{phases,quick}/` | **470** |
| of those, belonging to a **closed** milestone | **468** |

`.planning/phases/` held phases 01–37. `archive/v1.0-phases/` holds 01–17,
`archive/v2.0-phases/` holds 18–37. The current milestone is **P2**
(`PROJECT.md:31`). So the live directory contained **zero** current-milestone
phases — it was, in its entirety, a second copy of two closed milestones, plus
two `.gitkeep` placeholders for work not yet started.

Nothing outside `.planning/` referenced either tree: no code, no script, no
workflow, no CLAUDE.md. Inside `.planning/`, five references to
`.planning/phases/…` exist, four of them from files that were themselves
duplicates.

### The part that makes this more than bloat

Eleven pairs had **drifted** — the live copy carrying later edits the archive
copy never received:

- `phases/30-calendar-operations-hub/30-HUMAN-UAT.md` — an 18-line note dated
  2026-07-31 recording that half the UAT was discharged by
  `apps/api-gateway/src/calendar/ical-feed.spec.ts`, and that writing those tests
  found a real `PRODID` defect (a doubled dash, rejected by strict iCal clients).
- `quick/260401-x24-…-SUMMARY.md` and six siblings — a `status: complete`
  backfill added 2026-07-31, the absence of which is *why the v2.0 audit could
  not tell a finished task from an abandoned one*.
- `phases/25-…/25-VALIDATION.md`, `phases/36-…/36-VALIDATION.md`.

In every one of the eleven, the live copy was a strict superset of the archive
copy. The obvious cleanup — "the archive is canonical, delete the live twins" —
would have silently destroyed all of it. That is the real cost of two homes: not
the 6.4 MB, but that the duplication had already begun diverging, and no reader
or tool had a rule for which side was current.

A further 17 files were archived **twice**, under both `v1.0-quick` and
`v2.0-quick`; and 8 live files (`18-VERIFICATION.md`, `19-`, `20-`, `22-`, `28-`,
`33-`, `35-VERIFICATION.md`, `24-03-SUMMARY.md`) had **never** been archived at
all. So the copying was not merely redundant — it was also incomplete, in both
directions.

## Options considered

1. **Delete the archive twins, keep `.planning/phases/`.** What PR #93 §8.3
   proposed, on the arithmetic that it retires 469 documents against 2 added.
   Rejected: it points the wrong way. 434 of the 457 live twins are under
   `.planning/phases/`, so deleting the archive copy keeps the *un-retired* one
   and retires nothing. It also discards the milestone scoping — `v1.0-` vs
   `v2.0-` — which is the only thing in either tree that records *when* a phase
   closed.

2. **Delete the live twins, keep the archive.** Correct in direction, fatal in
   execution if done naively: it destroys the eleven drifted revisions above.
   Viable only with per-file adjudication, which is what was actually done.

3. **Keep both, fix retire-to-write's wording instead.** Costs nothing today and
   concedes the rule. The corpus keeps doubling every milestone, and the drift
   already measured keeps widening. Rejected.

4. **Do nothing.** 6.4 MB is not a real cost and every byte is in git history.
   But §0.3's low-footprint rule is about what a session must *read*, not what
   the disk holds: a grep over `.planning/` returns each hit twice, and a reader
   who lands on the archive copy of `30-HUMAN-UAT.md` gets the pre-discharge
   version with nothing marking it stale. Rejected.

## Decision

**A planning document has exactly one home, and CI fails when it has two.**

```
.planning/archive/vN.0-{phases,quick}/   closed milestones — canonical
.planning/{phases,quick}/                current milestone only
```

The sweep, applied per file rather than per directory:

| Action | Files |
|---|---|
| live copy byte-identical to archive → delete the live copy | 452 |
| live copy **newer** → promote its content into the archive, then delete it | 8 |
| live copy never archived → **move** it into its milestone root | 8 |
| same document under two archive roots → keep the earliest, drop the rest | 17 |
| `.gitkeep` placeholders for unstarted phases → keep | 2 |

Net: 477 files removed from `.planning/`, 2,133 → 1,656. **Eight distinct blobs
stop being reachable from the tree, and all eight are the superseded older
revisions of the eight promoted files** — verified by set-differencing every blob
SHA before and after. No live content was lost; every superseded revision remains
in history.

`scripts/check_planning_single_home.py` enforces the rule, and the
`planning-single-home` job in `.github/workflows/ci.yml` blocks on it.

The guard is deliberately **never vacuous**. `check_decision_claims.sh:149` reads
any non-zero exit as "the claim correctly does not hold", so a renamed file there
is indistinguishable from a fixed bug — the defect PR #93 documents. This guard
asserts the shape it depends on *before* checking, and exits **2** when the
archive is missing, emptied, or relaid out. "Could not look" is a failure, not a
pass.

It is also verified against the defect it exists to catch: on `origin/main`
`63c2bccd` it reports exactly **477** violations, the same 477 the sweep removed
— two independent computations agreeing. On the swept tree it exits 0.

The job is **not** added to `ci-complete`'s `needs`. That matches `loop-contract`,
the existing corpus guard, and avoids coupling documentation hygiene to
`Deploy to Production`: a duplicated planning file should block a merge, not a
production deploy.

## Consequences

- **Easier.** One grep hit per document. A phase directory's presence in
  `.planning/phases/` now *means* something — it is current-milestone work.
  `gsd-complete-milestone` gains a post-condition CI will check for it.
- **Harder.** Closing a milestone must now **move** phases, not copy them. A
  session that copies will go red. The guard names the fix in its failure
  output, including the drift case where the live copy must win.
- **Given up.** Browsing a closed phase from `.planning/phases/` — that path is
  gone; use `.planning/archive/vN.0-phases/`. Since nothing outside `.planning/`
  ever referenced it, and only five references inside it did, this is close to
  free today. It would not have been in another two milestones.
- **Revisit when** a milestone legitimately needs a phase live *and* archived at
  once — e.g. a phase reopened after its milestone closed. Today there is no such
  case. The signal is a `DRIFTED` failure on a phase whose milestone is the
  current one; that means the model is wrong, not the file.
- **Companion to [[0026-schema-has-one-home]].** Same failure shape, different
  corpus: a thing that lives in two places drifts, and the copy nobody reads is
  the one that stays wrong. 0026 gave the schema one home; this gives the
  planning corpus one.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-26 | Claude (Opus 5) | Created — measured on `63c2bccd`, sweep applied on `chore/planning-archive-dedupe`, guard verified 477/477 against the pre-sweep tree and 0 after |
| 2026-08-26 | — | Awaiting founder lock |
