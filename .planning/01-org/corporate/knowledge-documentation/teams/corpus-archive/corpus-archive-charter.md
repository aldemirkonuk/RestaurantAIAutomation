---
type: charter
division: corporate
department: knowledge-documentation
team: corpus-archive
status: exists
metrics: [corpus.duplicate_basename_count, corpus.ambiguous_duplicate_count, corpus.top_level_planning_docs, corpus.orphan_doc_count]
updated: 2026-08-24
links: ["[[corpus-archive-premortem]]", "[[corpus-archive-agenda-full]]", "[[corpus-archive-agenda-board]]", "[[corpus-archive-directive]]", "[[corpus-archive-loops]]", "[[corpus-archive-schedule]]", "[[knowledge-documentation-charter]]", "[[graph-retrieval-charter]]", "[[standards-verification-charter]]", "[[OBSIDIAN_VAULT]]", "[[corporate]]"]
---

# Corpus & Archive — Charter

Parent: [[knowledge-documentation-charter]] (Corporate). Siblings:
[[graph-retrieval-charter]], [[standards-verification-charter]].

## Mandate

Corpus & Archive is accountable for **where a document lives** — and, equally, for whether
it should exist at all. It owns the OD-01 restructure of `.planning/`, the legacy `md/`
tree, the partially-duplicated `md_files/` tree, and the permanent tail that OD-01 does not
cover: placement rules for new documents, an archive policy for finished ones, and
enforcement of [`CLAUDE.md`](../../../../../CLAUDE.md) §3 — *"Do not create new top-level
`.planning/*.md`"*.

The mandate is deletion as much as arrangement. This is the only team in the department
whose primary metric has a real, reachable zero, and it should reach it.

## Why distinct from its siblings

De-duplicating files and making files findable are different skills with different
done-states, and today's corpus proves they are independent: it is **simultaneously heavily
duplicated and almost entirely unlinked**. Deleting 35 duplicate files moves
`graph.frontmatter_coverage_pct` by nothing. Backfilling frontmatter across 45 spine docs
moves `corpus.duplicate_basename_count` by nothing.

The sharper case is against [[standards-verification-charter]]: `md/DOCUMENTATION_INDEX.md`
is correctly placed, is not duplicated, and is not orphaned — and it is **wrong**. This
team's metric cannot see that, and should not try to.

## Boundaries

Owns outright:

- **`.planning/`** — 1,118 `.md`, of which **28 are top-level** (~1.2 MB). The restructure
  (OD-01) and the placement rule that keeps the result from decaying.
- **`md/`** — 113 `.md` across 10 category directories, 115 of 120 files git-tracked.
- **`md_files/`** — 42 `.md`, 44 of 47 files git-tracked; a partial, partly-diverged copy
  of `md/`.
- **The archive policy** — what "finished" means, where finished documents go, and whether
  they leave the working tree.
- **Placement of the OD-22 library** (`.planning/library/`, proposed) — see
  [[knowledge-documentation-schedule]].
- **Untracked and gitignored corpus residue** — invisible to review, present on disk.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Whether a doc is findable once placed | [[graph-retrieval-charter]] | We decide the path; they decide the graph |
| Whether a doc is still true | [[standards-verification-charter]] | A perfectly-placed lie is not our defect |
| Filename **uniqueness** as a link constraint | [[graph-retrieval-charter]] | We name for humans browsing a tree; they own `[[link]]` ambiguity. The 45 `README.md` case is theirs, though we surfaced it |
| Deciding OD-01's target shape | The founder | We execute the restructure; we do not pick it (`OPEN-DECISIONS.md:73`) |
| Code repositories, datasets, migrations | [[engineering-charter]] *(Platform)* | Documents only |

## Metrics it moves

- **`corpus.duplicate_basename_count`** — primary. Baseline **38** basenames appearing in
  both `md/` and `md_files/` (recursive). **35 byte-identical, 3 diverged.**
- **`corpus.ambiguous_duplicate_count`** — baseline **3**. The 35 identical pairs are
  mechanical deletions; these 3 are the actual decision, because "which is true?" has no
  mechanical answer. Tracked separately so a report of "35 of 38 resolved" cannot be read
  as 92% done when the remaining 8% is the entire difficulty.
- **`corpus.top_level_planning_docs`** — baseline **28**. Guards against
  [[corpus-archive-premortem]] M1.
- **`corpus.orphan_doc_count`** — documents in no index and referenced by nothing. Not yet
  measurable; depends on [[graph-retrieval-charter]] shipping link resolution first, and
  that dependency is stated rather than papered over.

## Evidence today

**EXISTS — measured, not estimated. Re-verified 2026-08-24 for this charter.**

**The 38 duplicates, and the 3 that matter:**

| Diverged pair | `md/` | `md_files/` | Why it is hard |
|---|---|---|---|
| `PROJECT_ANALYSIS_AND_CHAT_CONTEXT.md` | `md/` — 27,185 B | `md_files/` — 26,351 B | 834 bytes apart; both plausibly current |
| `README.md` | `md/09-communication/` — 1,157 B | `md_files/01-getting-started/` — 1,375 B | **Not the same document at all** — a basename collision across different categories. Merging them would be wrong; deleting either loses content |
| `RUN_MIGRATION_GUIDE.md` | `md/02-architecture/` — 3,610 B | `md_files/02-architecture/` — 3,628 B | **18 bytes apart** — the most dangerous shape, because nobody will diff a pair that looks identical |

**The stale index — a concrete, checkable defect:** `md/DOCUMENTATION_INDEX.md`, last
modified **2026-01-29**, still titled *"WineOps AI - Complete Documentation Index"*. Its
quick-navigation table asserts per-category counts that the tree contradicts in every row:

| Index claims | Actual `.md` |
|---|---|
| `01-getting-started` — 3 files | **4** |
| `02-architecture` — 3 files | **6** |
| `03-packages` — 4 files | **5** |
| `04-updates-builds` — 6 files | **48** |
| `05-guides-setup` — 3 files | **13** |
| `06-planning` — 2 files | **12** |
| `08-features` — 2 files | **5** |

It also omits `06-architecture` (1), `07-data` (3), and `09-communication` (2) entirely —
and `md/` contains **both** `06-architecture` and `06-planning`, a numeric-prefix collision
in the taxonomy itself. The index is not merely out of date; the scheme it indexes forked.

**Untracked residue, invisible to code review:**

- `md/Agent_Chat_History/` is gitignored at `.gitignore:92`. It contains
  `CURSOR_CHAT_MAINOLD.md` at **5,409,376 bytes** — byte-identical in both `md/` and
  `md_files/`, so **10.8 MB** of chat log on disk, ~29× the largest planning document.
- Both trees contain a **directory literally named `CURSOR_CHAT_MAINOLD.md -> `** whose
  children reconstruct the absolute path
  `/Users/aldemirkonuk/Desktop/UnicornProjects/Restaurant AI Automation/md/Agent_Chat_History/WINEOPS_AI_AGENT_CHAT_HISTORY/CURSOR_CHAT_MAINOLD.md`
  as nine levels of nested empty directories — a botched `ls -l` output turned into a
  `mkdir -p`. Present in two places, gitignored, so no reviewer has ever seen it.

**Largest planning documents** — the grep-target set named at
[`CLAUDE.md`](../../../../../CLAUDE.md) §2: `claude_full_architectural.md` (~186 KB),
`UX_PATHS_CATALOG.md` (~158 KB), `INVOICE_DOC_UX_RESEARCH.md` (~83 KB).

**Open fork:** OD-01 (`OPEN-DECISIONS.md:73`). Founder picks the target shape;
[[OBSIDIAN_VAULT]] §5 F2 has already fixed the direction — *corpus stays in place now,
clean slate is the end goal.* This team executes that, and the phrase "for now" is the part
worth holding: a decision to defer that never gets a date becomes a decision to never act.
