---
type: premortem
division: product
department: design
team: exploration-studio
status: provisional
metrics: [design.resolved_question_rate, design.open_null_winner_count, design.sketch_index_completeness, design.winner_shipped_conversion]
updated: 2026-08-24
links: ["[[exploration-studio-charter]]", "[[exploration-studio-loops]]", "[[exploration-studio-directive]]", "[[design-premortem]]", "[[ux-path-burn-down-charter]]", "[[design-system-motion-substrate-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Exploration Studio — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

The department's premortem line: *it becomes a gallery. Sketch count climbs, `Winner: null`
climbs with it, and the burn-down team keeps designing in production because no decision
ever arrived.* Expanded into five mechanisms — and unlike most premortems in this vault,
**M1 is not a forecast. It is a description of the present.**

---

### M1 — It became a gallery (already 65% of the way there)

**28 of 43 manifest rows carry `Winner: null` today.** Two-thirds of the exploration in
this repository never converged. That is not a risk to be managed; it is a measurement
taken this session.

Extrapolate: sketching is the most enjoyable work in the department and the cheapest to
start. Nothing structurally stops a new sketch. In twelve months there are 80 directories,
55 nulls, and a corpus that is simultaneously the strongest evidence of the department's
diligence and the strongest evidence of its ineffectiveness. Every planning conversation
cites it; no shipped surface descends from it. Current conversion:
**2 of 53** (sketch 038 → `/inventory`, sketch 052 → the docgen template).

**Earliest observable signal.** A new sketch directory created in a close-time where
`design.resolved_question_rate` did not improve. **The first one**, not the fifth —
because the corpus is already at 28 nulls and any addition compounds a debt rather than
starting one.

**Counter-pressure.** Two mechanisms, both in [[exploration-studio-directive]]:
1. **A WIP limit.** No new sketch while more than N unresolved questions are open. N is set
   at the first close-time and published. Today's number would be 28, so the initial
   posture is a **freeze on new sketches until the backlog converges** — uncomfortable, and
   the correct starting position.
2. **Forced resolution.** A row null for two close-times resolves as **"no winner —
   question withdrawn"**, which counts as convergence. Withdrawing is a decision. Leaving
   it null is not, and 28 nulls are 28 decisions that were started and abandoned.

---

### M2 — The index drifted until it no longer described the corpus

Also already in progress, in **both directions**: 10 sketch directories are not in the
manifest (005, 011–015, 017–019, 049), and manifest row `039` points at a directory that
does not exist. Duplicate IDs `038` and `048` are each used twice on disk, and `048`
appears only once in the record.

The failure completes when the manifest stops being trustworthy. At that point the corpus
can only be searched by opening directories, the *"has this been explored?"* question
becomes unanswerable, and the same question gets re-explored — which is the most expensive
possible outcome for a team whose product is resolved questions.

**Earliest observable signal.** Any sketch directory created without a manifest row in the
same commit. The bidirectional check is cheap and has never been run.

**Counter-pressure.** A **biweekly manifest sweep** (`L-EXP-2`) reconciling directories to
rows in both directions, plus an ID-allocation rule that makes duplicates impossible — the
manifest issues the next ID, and a directory whose ID is already taken fails the sweep. The
10 unindexed directories and row `039` are resolved as the team's founding act, before any
new question is posed.

---

### M3 — The winners were resolved into a vacuum

Sketch 051 named a winner — *"B — first-visit overrides session cap"* — identifying that
the existing one-tour-per-session cap suppresses per-page first-run guidance. Sketch 050
named *"C — Hybrid"*. Sketch 042 chose the mobile stack. Sketch 048 scored a layout
9 × 9 = 81.

None of them shipped. A resolved question that reaches no queue is indistinguishable from
an unresolved one after six months, except that it cost more to produce. The studio
declares 100% resolution and the product is unchanged — the metric is green and the
mechanism is dead.

**Earliest observable signal.** A winner named more than two close-times ago that appears in
no [[ux-path-burn-down-charter]] queue and no
[[design-system-motion-substrate-charter]] backlog. Today's list is not empty: 050, 051,
048, 042, 033 are all decided and unqueued.

**Counter-pressure.** **A winner is not resolved until it is handed off.** The manifest row
carries the receiving team and the queue item, or the row is not closed. This makes
`design.winner_shipped_conversion` a real check rather than a vanity number — and it is
deliberately kept **secondary**, because promoting it to primary would recreate the exact
failure the team split was designed to prevent.

---

### M4 — Convergence pressure killed the exploration

The opposite failure, and the reason this premortem cannot only be about nulls. Under
pressure to resolve, the team stops posing questions it cannot answer inside one
close-time. Sketch batches shrink from six options to two. "Exploration" becomes
generating a defensible option and one strawman. `design.resolved_question_rate` hits 95%
and the studio is no longer divergent — it has become a slow version of the burn-down, and
the department has paid for two teams to do one job.

This is the failure the WIP limit *causes* if it is set too aggressively, so it must be
written next to it.

**Earliest observable signal.** Median options per sketch falling below three. Second
signal: sketches whose winner was the first option, several close-times in a row —
exploring three variations of a decision already made is not exploration.

**Counter-pressure.** `design.options_per_sketch_median` is tracked alongside the
resolution rate and **published on the same board**. The WIP limit constrains how many
questions are open, never how many options a question gets. And *"no winner — question
withdrawn"* exists precisely so a hard question can be closed honestly instead of being
answered badly to protect a number.

---

### M5 — The sketches became documentation

53 directories of throwaway HTML start being maintained. Someone links a sketch in an
onboarding doc. A sketch is updated to match what shipped. The corpus stops being a
graveyard of resolved arguments and becomes a second, unversioned, drifting description of
the product — one that no CI check covers and no owner reconciles.

The tell is already present in miniature: two sketches are marked IMPLEMENTED in the
manifest, which is correct as a *record*, and one lookup away from being read as
*documentation*.

**Earliest observable signal.** A commit that modifies a sketch whose question is already
resolved. There is no legitimate reason to edit a settled sketch.

**Counter-pressure.** A resolved sketch is **frozen**. The manifest row is the durable
artifact; the HTML is evidence for an argument that has ended. Documentation of what
shipped belongs to [[knowledge-documentation-charter]] and to the code, never to
`.planning/sketches/`. If a resolved sketch needs updating, the honest move is a **new
question**.

---

## Cross-cutting counter-pressure

- **M1 and M4 are opposite failures and both are live risks.** The board carries
  `design.resolved_question_rate` and `design.options_per_sketch_median` side by side.
  Optimizing either alone produces the other failure within two quarters.
- **The team starts in debt.** 28 nulls, 10 unindexed directories, 1 phantom row. Its first
  quarter is repair, not exploration, and a charter that pretended otherwise would be
  planning around a number it can see.
- **Withdrawal must stay socially cheap.** If *"no winner — question withdrawn"* is ever
  treated as failure, the nulls come straight back — they are what withdrawal looks like
  when withdrawal is not allowed.
- **[[red-team-charter]] should attack the WIP limit hardest.** It is the mechanism most
  likely to be quietly relaxed the first time someone has an idea worth sketching, and the
  relaxation will always be justified in the individual case.
