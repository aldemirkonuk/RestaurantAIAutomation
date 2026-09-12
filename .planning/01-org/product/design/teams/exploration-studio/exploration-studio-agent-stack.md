---
type: agent-stack
division: product
department: design
team: exploration-studio
status: designed
updated: 2026-08-27
metrics: [design.resolved_question_rate, design.winner_shipped_conversion, design.sketch_index_completeness, design.open_null_winner_count]
links: ["[[exploration-studio-charter]]", "[[exploration-studio-schedule]]", "[[exploration-studio-loops]]", "[[exploration-studio-premortem]]", "[[0034-agent-stack-artifact]]", "[[design-agent-stack]]", "[[skills-charter]]", "[[ux-path-burn-down-agent-stack]]", "[[design-system-motion-substrate-agent-stack]]"]
---

# Exploration Studio — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The studio's missing half is **convergence, not generation** — 53 directories exist and 28
> of 43 indexed rows carry `Winner: null` ([[exploration-studio-charter]] §Evidence). So its
> agent keeps the index true and applies convergence *pressure*; it never names a winner.
> A winner is a design judgment with reasoning attached (*"C — Left rail (purity 9 ×
> effectiveness 9 = 81)"*, `MANIFEST.md`), and an agent that supplies one has replaced the
> decision it was meant to surface.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `sketch-manifest-steward` | Keep `MANIFEST.md` and `.planning/sketches/` in **bidirectional** agreement, issue IDs so collisions are impossible, and put every row that is null at its second close-time in front of a human for a winner or a withdrawal | NEW |

One row. Generation is already solved by user-level `gsd-sketch` tooling ([[README]] §3.1);
adding an agent that produces more sketches would deepen the exact imbalance the charter
names.

## 2. Agent cards

```yaml
agent: sketch-manifest-steward
unit: exploration-studio
triggers:
  - schedule: "biweekly — convergence review, manifest sweep, handoff review, motion drain"   # [[exploration-studio-schedule]]
  - schedule: "quarterly — freeze audit (commits modifying an already-resolved sketch)"
  - topic: sketch.directory_added     # publisher: NONE (gap — gsd-sketch generates directories, it does not announce them)
consumes:
  - ".planning/sketches/MANIFEST.md — 43 rows, each carrying a Design Question, a Winner and tags"
  - "the 53 sketch directories on disk (51 HTML sketches, 97 files, plus themes/default.css)"
  - "receiving-team queues, to tell a decided winner from a delivered one: [[ux-path-burn-down-agent-stack]] and [[design-system-motion-substrate-agent-stack]]"
emits:
  - "the bidirectional sweep diff — orphan directories, phantom rows, duplicate IDs — as a PR"
  - "the convergence list: every row null at its second close-time, with its options restated, addressed to a human"
  - "design.resolved_question_rate, design.open_null_winner_count, design.sketch_index_completeness, design.winner_shipped_conversion, design.handoff_age_days → [[design-agent-stack]] board rollup"
  - "handoff rows naming a receiving team → the two sibling stacks above"
  - nf_a events (task_type: sketch_sweep)
routing_class: mechanical      # set-diff directories against rows against IDs; the judgment is deliberately outside the card
quality_bar: "bidirectional closure — every directory has a row and every row a directory, or the exception is listed by name; no row silently carries null past two close-times. NONE (gap) — ADR 0017 has no verdict grader for an index sweep"
autonomy:
  read: autonomous
  propose: autonomous          # sweeps and ID allocations land as manifest PRs
  mutate_stock_money_outbound: confirm    # constant; this agent has no such surface
memory: exploration-studio
escalates_to: "[[design-charter]]"
```

**The card's own hard rule:** the steward never writes a value into `Winner`. It may record a
winner or a withdrawal that a human has stated, and *"no winner — question withdrawn"* is a
legitimate resolution it must offer as loudly as a winner ([[exploration-studio-charter]]) —
a studio that has never withdrawn a question is storing its indecision in a column.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `sketch-manifest-sweep` | T2 | Biweekly, and on any new sketch directory | Every directory has a row and every row a directory; duplicates impossible | **10 orphan directories** (005, 011–015, 017–019, 049) and **phantom row `039` `staff-performance-sidebar` (`MANIFEST.md:46`) with no directory on disk** — the index drifts in both directions | NEW |
| `sketch-converge` | T2 | Biweekly, on rows null at their second close-time | Each row resolves to a winner or an explicit withdrawal; no row carries null past two cycles | **28 of 43 rows null** (006, 007, 016, 020–026, 028–032, 034–041, 043–047) — two-thirds of all exploration in the repo, accumulated with nobody scheduled to notice | NEW |
| `sketch-handoff` | T2 | On a winner being named | The manifest row carries a receiving team and a queue item, or the question is not closed | **050, 051, 048, 042, 033** — decided, with reasoning recorded, and handed to nobody | NEW |
| `sketch-id-allocate` | T2 | On sketch creation, before the directory exists | The next ID is issued by the manifest; a collision is impossible by construction | **`038`** (`038-inventory-command`, `038-manager-shift-desk`) and **`048`** (`048-interactive-guidance`, `048-profile-page`) each used twice on disk; `048` appears once in the manifest, so one is silently unrecorded | NEW |

`sketch-freeze-check` is on [[exploration-studio-schedule]] but its instance column describes
a risk (*"two rows marked IMPLEMENTED are one lookup from being read as documentation"*)
rather than an occurrence — README §3.3 rule 3 keeps it a scheduled job, not a row here.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]). Generation
tooling (`gsd-sketch`) is user-level GSD, not a project skill ([[README]] §3.1) — and it
generates, it does not converge, which is exactly the wrong way round for a corpus at 28
nulls.

## 4. Memory

- **Procedural** — the four §3 skills; candidates via [[skill-harvesting-charter]]'s queue,
  still through the §3.3 gate.
- **Episodic** — nf_a `task_type: sketch_sweep`. Needs `context.sketch_id` and
  `context.close_times_null` as jsonb keys, so *"this row has been asked twice"* is a filter
  rather than a memory of the last meeting — the two-close-time rule is unenforceable without
  it.
- **Semantic** — `memory/` beside this file, `exploration-studio-MEMORY.md` as index, one fact
  per file with `source` / `confidence` / `last_verified`. Founding facts: the 10 orphan
  directories, phantom row `039`, the duplicate `038`/`048` pairs, and the conversion reading
  **2 of 53** (038 → `apps/web/src/pages/inventory/command/`, 052 →
  `scripts/docgen/templates/wineops_document.html`). Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the manifest row under
  review. Sketch HTML is a retrieval target, **never preloaded**: a sketch's value ends when
  its question resolves, and an agent that keeps them warm is how a corpus becomes a gallery.

**Consolidation** — monthly, one cycle behind the biweekly sweeps: read the month's sweep and
convergence events; **failures first** — a question that expired unanswered becomes a fact
naming the mechanism (*"a row can be null with no close-time attached to it"*), not the
sketch; every withdrawal is recorded as convergence, because a withdrawal remembered as a
failure teaches the studio to stop withdrawing; expire facts unverified 90 days; propose skill
candidates. One PR; "no delta" stated when true.

## 5. Async contract

Interaction is loops ([[exploration-studio-loops]]), NF-A events, and vault PRs. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `sketch.directory_added` has no publisher | `gsd-sketch` writes a directory and announces nothing; the biweekly sweep bounds the blind spot at 14 days, and the 10 orphan directories are what a longer lag produced |
| ID allocation has no publisher either | The manifest is not consulted at creation time, which is the entire mechanism behind the duplicate `038` and `048` — the fix is a row-before-directory order, not a firmer instruction |
| Handoffs arrive as manifest PRs, not events | Consumers are named ([[ux-path-burn-down-agent-stack]], [[design-system-motion-substrate-agent-stack]]) but nothing notifies them; `design.handoff_age_days` is published instead of assuming arrival |
| `design.winner_shipped_conversion` depends on evidence this team cannot see | Whether a winner acquired a shipped descendant is [[ux-path-burn-down-agent-stack]]'s reading; today it is **2 of 53**, and it stays a secondary on purpose — making it primary recreates the failure the team split prevents |

## 6. Evidence today

- **EXISTS — the corpus and the decision record.** 53 directories, 51 HTML sketches, 97 files;
  `MANIFEST.md` with 43 rows each carrying a Design Question, a Winner and tags; **15 winners
  named**, two of which converged all the way to code (038, 052). The workflow works and is
  recorded — [[exploration-studio-charter]] §Evidence.
- **EXISTS — the stall, and it is measurable.** 28 nulls, 10 unindexed directories, 1 phantom
  row, 2 duplicate IDs — every §3 past instance above is one of these, counted 2026-08-24.
- **PARTIAL — tooling.** Generation exists (`gsd-sketch`, user-level); convergence, index
  integrity and handoff have none.
- **NEW — the agent, all four skills, and every §4 layer** except the NF-A tables themselves
  (ADR 0006/0008).
