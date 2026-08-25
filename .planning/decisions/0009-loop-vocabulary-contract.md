---
type: adr
id: 0009
title: Loop vocabulary is read from §5.1 and enforced in CI
status: locked
updated: 2026-08-24
links: ["[[0002-documentation-first-operating-mode]]", "[[0007-org-structure]]"]
---

# 0009 — The loop vocabulary is read from §5.1 and enforced in CI

- **Status:** Locked
- **Date:** 2026-08-24
- **Decider:** Aldemir (founder)
- **Closes:** OD-47 (the normalisation itself), and the enforcement question it left open
- **Keywords:** loops, close_time, status, vocabulary, evidence, CI, OD-47, ORG_STRUCTURE, build_loop_index
- **Links:** [[0002-documentation-first-operating-mode]], [[0007-org-structure]], [ORG_STRUCTURE §5.1](../foundation/ORG_STRUCTURE.md), [[LOOP-MAP]], [[decision-office-loops]]

## Context

OD-47 closed `close_time` and `status` to fixed sets after 99 independent generators
produced **102 distinct `close_time` values across 482 loops**, 67 of them multi-word free
text. The normalisation landed: 9 values, 6 statuses, 112 `close_time_note` lines so no
nuance was lost.

It left the rule unenforced, and an unenforced rule is a convention. Three things followed
from that, all found while fixing something else:

| # | Finding | Evidence |
|---|---|---|
| F1 | The generator still described the *old* world — it named an `exists` status that was never in the vocabulary, and called close_time "a vocabulary problem worth normalising" after normalisation | `build_loop_index.py` before [`cfba657`](https://github.com/aldemirkonuk/RestaurantAIAutomation/commit/cfba657) |
| F2 | The vocabulary existed **twice** — as a table in §5.1 and as tuples in Python — with nothing keeping them equal | same |
| F3 | §5.1 requires `active`/`running` to cite evidence, and claimed "exactly 6 of 482 qualify". Only **2** carried an `evidence:` field. The count had never been checked against its own rule | `.planning/00-index/loops.json` |

F3 is the one that matters. The corpus cited "6 of 482" in ORG_STRUCTURE and in the
generated LOOP-MAP; it was the headline number for how much of this organisation actually
runs. Nobody had verified it, because nothing could.

## Options considered

**On enforcement:**

1. **Record only.** Write the ADR, change no code. Enforcement stays whenever someone
   happens to regenerate the index. Costs nothing and changes nothing.
2. **Soft report.** Fold the check into `loop-watcher.yml`, which reports to the job
   summary and never fails a PR. Consistent with that workflow's deliberate philosophy —
   but §5.1 classes a bad value as *a defect, not a variant*, and defects are not
   information.
3. **CI hard gate, hardcoded sets.** Smallest change that makes enforcement real. Leaves
   F2 — doc and code stay two sources of truth, free to drift.
4. **Doc-sourced + CI gate + evidence rule.** *(chosen)*

**On the evidence rule, which failed 4 of 6 live loops on the day it was written:**
strict-and-migrate *(chosen)*; warn until a dated cutoff; widen the rule to accept a
citation in the prose after a block; or enforce strictly and let CI stay red until owners
respond.

## Decision

**§5.1's table is the source of truth, and `build_loop_index.py --check` is a hard CI gate.**

The script reads the permitted values out of §5.1's own markdown table at startup rather
than declaring them. Editing that table changes what CI accepts, with no code change —
[ADR 0002](0002-documentation-first-operating-mode.md)'s documentation-first mode taken
literally: the document is not a description of the contract, it *is* the contract. If the
table cannot be read the script aborts, because a silent fallback to built-in values would
disable enforcement at exactly the moment the contract went missing.

`active`/`running` now require an `evidence:` field naming a `file:line`, workflow path, or
query. Applying it honestly cost the corpus its headline number:

| Loop | Was | Now | Why |
|---|---|---|---|
| `loop-eval-gate-ci` | active | active | already cited `ci.yml:226-230` |
| `loop-merge-policy-gate` | active | active | already cited |
| `guest-identity-ci-guards` (×2 files) | running | running | cited `schema-parity.yml:19-27` in prose; moved into the field |
| `identity-false-merge-gate` | active | active | cited `eval_merge_policies.py:5-13` in `pass_condition`; moved into the field |
| `decision-register-health` | running | **proposed** | cited nothing anywhere — a weekly digest no mechanism emits |

**6 of 482 → 5 of 482.** Every citation above was verified against the file it names
before being promoted into an enforced field; none was authored to satisfy the check.

## Consequences

- **Easier:** cadence is aggregatable and schedulable, and `active`/`running` mean
  something a reader can follow to a line of code. A bad value now fails in seconds, in
  the PR that introduced it, naming file, loop id, field and permitted set.
- **Easier:** the index cannot silently go stale — `--check` compares the generated output
  against what is committed, so editing a loop without regenerating fails the build.
- **Harder:** the script is coupled to §5.1's table *formatting*. Reformatting that table
  breaks the build. This is deliberate and loud rather than silent, and the failure message
  names the row to restore.
- **Given up:** the ability to mark a loop `active` because it feels active. That is the
  point, and it is what took the count from 6 to 5.
- **Revisit when:** a legitimate loop cannot express its cadence in the 9 values *and*
  `close_time_note` does not carry the loss — that is the signal the set is too small, and
  the fix is to amend §5.1's table, which is now a one-line change that CI picks up.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-24 | Aldemir (founder) | Enforcement scope chosen (option 4); evidence rule chosen as strict-and-migrate |
| 2026-08-24 | Claude | Proposed the options; found F1–F3; migrated 3 loops, demoted 1 |
