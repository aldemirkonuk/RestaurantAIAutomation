---
type: agenda-full
division: product
department: design
team: exploration-studio
status: provisional
metrics: [design.resolved_question_rate, design.open_null_winner_count, design.sketch_index_completeness, design.winner_shipped_conversion]
updated: 2026-08-24
links: ["[[exploration-studio-charter]]", "[[exploration-studio-premortem]]", "[[exploration-studio-agenda-board]]", "[[exploration-studio-directive]]", "[[exploration-studio-loops]]", "[[exploration-studio-schedule]]", "[[design-agenda-full]]", "[[ux-path-burn-down-charter]]", "[[design-system-motion-substrate-charter]]", "[[activation-in-product-guidance-charter]]", "[[decision-office-charter]]"]
---

# Exploration Studio — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Convert a stalled 53-directory corpus into a working question-resolution pipeline. The
team **starts in debt** and its first quarter is repair, not exploration:

| Debt | Size | State |
|---|---|---|
| Unresolved questions | **28 of 43** manifest rows carry `Winner: null` | Two-thirds of all exploration |
| Unindexed work | **10 directories** — 005, 011–015, 017–019, 049 | The record does not know it exists |
| Phantom record | Manifest row **039** (`MANIFEST.md:46`) | Points at no directory |
| Duplicate IDs | **038** and **048**, each used twice on disk | `048` appears once in the manifest |
| Decided-but-unqueued winners | 050, 051, 048, 042, 033 | Resolved, handed to nobody |

Only after those are addressed does the team pose a new question. That ordering is the
whole plan, and it will be unpopular in exactly the week it matters.

## How

### 1. Sweep the manifest — bidirectionally

Every directory gets a row; every row gets a directory. Resolve `038`/`048` duplicates by
issuing fresh IDs from the manifest (which becomes the ID authority, so duplicates stop
being possible). Restore or delete row `039`. Index 005, 011–015, 017–019, 049 — reading
each and recording the question it was actually asking, which may be *"unknown"*. An
honest "unknown" is a better record than an absence.

### 2. Drain the nulls, and let withdrawal count

28 rows, each resolved one of two ways:

- **Name a winner** — where the options exist and the argument is settleable now.
- **Withdraw the question** — recorded as *"no winner — question withdrawn"*, which
  **counts as convergence**.

Withdrawal must stay socially cheap. If it is ever treated as failure, the nulls come
straight back, because 28 nulls are what withdrawal looks like when withdrawal is not
allowed.

**Priority order within the 28** — highest downstream value first:

1. **043–046** (motion). Nine motions fully specified with trigger / motion / haptic /
   anti-gimmick clauses, stack already chosen at 042. The deepest design work in the repo,
   entirely unshippable for want of a decision.
   → [[design-system-motion-substrate-charter]]
2. **020–024, 028–032, 040, 041, 047** (storage, cellar, inventory). The largest coherent
   cluster, on surfaces staff touch during service.
   → [[ux-path-burn-down-charter]]
3. **006, 007, 016, 025, 026, 034–039** (settings, locations, comms, teams). Lower
   frequency; several may be honest withdrawals.

### 3. Queue the winners that already exist

050, 051, 048, 042 and 033 are decided and went nowhere. **A winner is not resolved until it
is handed off** — the manifest row must carry the receiving team and the queue item.
Sketch 051's winner (*first-visit overrides session cap*) is the clearest example: a known
defect, an identified fix, nobody holding it.

### 4. Then, and only then, a WIP limit and new questions

N unresolved questions maximum, published at the first close-time. With 28 open, the
opening posture is a **freeze on new sketches** until the backlog converges. Deliberately
uncomfortable, and the correct starting position for a team whose measured failure mode is
accumulation.

And the counterweight, tracked from day one: `design.options_per_sketch_median`. The WIP
limit constrains how many questions are open, **never** how many options a question gets
([[exploration-studio-premortem]] M4).

## Why now

- **The stall is measured, not suspected.** 28 of 43 is a count taken this session. There
  is no version of this that is fine.
- **The index is drifting in both directions**, which means the *"has this been explored?"*
  question is already unreliable — and the most expensive outcome for this team is
  re-exploring something it already settled.
- **[[ux-path-burn-down-charter]] is about to start.** Every row it hits that needs an
  unmade decision either waits or gets designed in production. Draining the nulls **before**
  the burn-down accelerates is worth more than draining them after.
- **The pipeline demonstrably works** — 038 → `/inventory`, 052 → the docgen template. Two
  of 53 is a low conversion rate and a real proof of concept. The mechanism is not in doubt;
  the maintenance is.
- **The motion work is perishable.** Sketch 042's stack choice ages out. Nine specified
  motions with anti-gimmick clauses is rare and currently worth nothing.

## Next steps

- [ ] Bidirectional manifest sweep: 10 unindexed directories in, row `039` resolved,
      duplicate `038`/`048` IDs reissued
- [ ] Make the manifest the **ID authority** so duplicates become impossible
- [ ] Publish the first `design.resolved_question_rate` and
      `design.options_per_sketch_median` readings together
- [ ] Resolve 043–046 first — winner or withdrawal — and hand the result to
      [[design-system-motion-substrate-charter]]
- [ ] Queue the five already-decided winners (050, 051, 048, 042, 033) with a named
      receiving team per row
- [ ] Add *receiving team* and *queue item* columns to `MANIFEST.md`; a row without them is
      not closed
- [ ] Set and publish the WIP limit; freeze new sketches until the null count falls
- [ ] Freeze resolved sketches — a settled sketch is evidence, not documentation
      (premortem M5)

## Questions for the founder

1. **Is "no winner — question withdrawn" acceptable as a resolution?** The whole
   convergence mechanism depends on it. If withdrawal is read as failure, the team will
   keep producing nulls, because that is what withdrawal looks like when it is not allowed.
2. **What is N?** The WIP limit is the team's only structural brake. Too high and the
   gallery grows (premortem M1); too low and exploration dies (M4). The charter proposes
   starting at a **freeze** given 28 open, which is aggressive and reversible.
3. **Do the motion sketches get decided or archived?** Nine specified motions, a chosen
   stack, zero winners. Archiving is legitimate and cheaper than pretending. Another year of
   null is not.
4. **Who breaks a tie the studio cannot settle?** Sketch 048 scored its winner
   (*purity 9 × effectiveness 9 = 81*), which is a scoring method, not an authority. When
   two options score equally and the team is split, the current answer is "it stays null" —
   and that is how the corpus got here.
5. **Do the 10 unindexed directories get read, or written off?** Reading them costs a
   session. Writing them off loses whatever they explored — and 049
   (`mobile-guidance-web-shell`) is directly relevant to
   [[activation-in-product-guidance-charter]]'s live work, so at least one of the ten is
   not disposable.
