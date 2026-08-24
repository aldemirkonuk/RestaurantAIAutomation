---
type: premortem
division: platform
department: engineering
team: catalogue-identity
status: provisional
metrics: [identity.false_merge_count, identity.false_split_count]
updated: 2026-08-24
links: ["[[catalogue-identity-charter]]", "[[catalogue-identity-loops]]", "[[catalogue-identity-directive]]", "[[engineering-premortem]]", "[[red-team-charter]]", "[[annotation-ground-truth-charter|dat-annotation-ground-truth]]"]
---

# Catalogue & Identity — Premortem

> Written at founding, before success is assumed.

The seed (`.planning/foundation/teams/technology.md:96-98`): *someone ships a
fuzzy-threshold matcher because it improves an aggregate score, the aggregate hides a
handful of false merges, and by the time a sommelier notices, months of NF-B guest signal
is attributed to the wrong wine.* Expanded below into five mechanisms.

## It is 2027-08. This team has failed. What happened?

### M1 — The aggregate score won

A threshold change moved a combined match-quality number from 0.91 to 0.94. It did so by
merging aggressively: seven false merges bought two hundred correct ones. The PR was
reviewed on the aggregate. `scripts/eval_merge_policies.py:5-13` explicitly forbids this
— "These two errors are not symmetric and must never be summed into one score" — but the
file was a scoring script, not a gate, and nothing in CI read it.

**Earliest observable signal.** The first PR description or dashboard that reports **one**
identity quality number. Not a bad number — *any* single number. Also: a
`services/agent-orchestrator/services/wine_matcher.py` diff that changes a threshold
constant with no accompanying change to a labelled-set fixture.

**Counter-pressure.** `identity.false_merge_count` and `identity.false_split_count` are
published as two columns and never as a ratio, a mean, or an F-score. The merge-policy
evaluation runs in CI, not on request, and **fails** on any false-merge increase
regardless of split improvement. Any proposal justified by an aggregate is rejected at
team level per [[catalogue-identity-directive]] — it is not escalated, because there is
nothing to arbitrate.

---

### M2 — There was never a labelled set, so the target was rhetoric

"False-merge count against the labelled identity set — target zero" assumes a labelled
identity set. The charter's evidence section lists merge machinery in abundance and no
ground-truth corpus. Twelve months in, the team has excellent merge *tooling*, a stated
target of zero, and no way to know whether it is at zero. The number was never wrong
because it was never read.

**Earliest observable signal.** The second consecutive close-time in which
[[catalogue-identity-loops]] reports `identity.false_merge_count` as *unreadable*. One is
a start-up cost; two is a decision to not build it.

**Counter-pressure.** Building the labelled set is the team's **first** deliverable, ahead
of any matcher improvement — a matcher change with no ground truth is unfalsifiable.
[[annotation-ground-truth-charter|dat-annotation-ground-truth]] owns annotation methodology; this team owns the identity
set's contents and its asymmetric scoring rule. The loop records *unreadable* explicitly
rather than omitting the metric, because an omitted metric reads as green
([[engineering-loops]] L-ENG-1).

---

### M3 — Un-merge existed and did not restore anything

`supabase/migrations/20260817120000_nondestructive_merge.sql` and
`…20260818020000_merge_undo_honesty.sql` make un-merge possible at the row level. But the
signal accumulated *while merged* — guest preference, pour history, velocity, agent
inferences — was written against the surviving row. Un-merging splits the identity back
apart and leaves the derived data pointing at whichever half won. The team believes merges
are reversible; only the rows are.

**Earliest observable signal.** The first un-merge whose post-hoc check finds derived rows
(pours, guest signal, recommendations) that cannot be reassigned to a side. Measure it on
the *first* un-merge, not after a pattern forms — the file is literally named
`merge_undo_honesty`, so the honesty is the point.

**Counter-pressure.** Every un-merge is followed by a mandatory **downstream attribution
report**: what derived data existed during the merged window, and what happened to it.
If the answer is "it stayed with the survivor", that is recorded as data loss, not as a
successful undo. This is a standing item in [[engineering-loops]] L-ENG-4
(irreversible-class review), which reviews every instance rather than a sample.

---

### M4 — Producer normalization quietly became a merge

`producer_normalization.py` and `ontology_normalization.py` collapse variant spellings of
a producer into one canonical entity. That is the correct behaviour. It is also a merge
with none of the merge safety: no non-destructive path, no undo migration, no
labelled-set scoring — because it was classified as *normalization*, not *merging*. Two
genuinely different producers with similar names are unified, and every wine under both
inherits the wrong lineage.

**Earliest observable signal.** A producer entity whose wine set spans regions or
appellations that a real producer would not plausibly span. Cheaper tell: the
normalization step's collapse ratio (input variants ÷ output entities) moving without a
data-volume explanation.

**Counter-pressure.** Normalization is governed by the **same** asymmetric rule as
merging — it is in this team precisely so the rule follows it. Producer collapses enter
the labelled set as their own class, with their own false-merge count. The
producer-reputation corpus work already at 100% coverage on the menu corpus is the natural
fixture source.

---

### M5 — Guest identity crept past its minimal slice

`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql` is deliberately
minimal, and `scripts/check_no_guest_name_matching.sh` guards the line. The guard is a
shell script — the same grep-shaped guard class flagged in [[engineering-premortem]] M4.
A name-matching path written in SQL, or built from a concatenated column, or living in a
Postgres function, passes it. Guest records start merging on name similarity, and now the
unrecoverable-merge problem has a privacy incident attached.

**Earliest observable signal.** Any new code path that reads a guest name column into a
comparison — including inside a migration. Watch for the guard passing on a PR that also
touches guest tables; that combination, not the guard's failure, is the tell.

**Counter-pressure.** Pair the grep with an **outcome-side** check: sample guest identity
clusters and assert none were formed on name similarity. Route it through
[[engineering-loops]] L-ENG-3, which exists to catch exactly "green guard, wrong data".
Escalate any expansion of the guest identity slice to [[compliance-privacy-charter|compliance-charter]] before
implementation, not after — the merge is unrecoverable and so is the disclosure.

---

## What [[red-team-charter]] should attack first

M1 and M2 together. The team's entire safety story rests on a scoring rule
(`eval_merge_policies.py:5-13`) that is currently a script rather than a gate, scoring
against a set that does not yet exist. That is one unfalsifiable claim, not two.
