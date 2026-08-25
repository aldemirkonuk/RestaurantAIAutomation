---
type: agenda-full
division: corporate
department: knowledge-documentation
team: graph-retrieval
status: provisional
metrics: [graph.dataview_executable, graph.frontmatter_coverage_pct, graph.ambiguous_basename_count, graph.linked_file_ratio]
updated: 2026-08-24
links: ["[[graph-retrieval-charter]]", "[[graph-retrieval-premortem]]", "[[graph-retrieval-agenda-board]]", "[[graph-retrieval-loops]]", "[[graph-retrieval-schedule]]", "[[knowledge-documentation-agenda-full]]", "[[corpus-archive-charter]]", "[[OBSIDIAN_VAULT]]", "[[ORG_STRUCTURE]]"]
---

# Graph & Retrieval — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Make the vault graph **real rather than nominal**. Four numbers move:

| Metric | Today | Target |
|---|---|---|
| `graph.dataview_executable` | **false** | true |
| `graph.ambiguous_basename_count` | **≥ 45** (`README.md` alone) | 0 inside `01-org/`, `02-advisory/`, `foundation/`, `decisions/` |
| `graph.frontmatter_coverage_pct` | **4 / 45** ≈ 8.9% | 100% of spine + all unit docs |
| `graph.linked_file_ratio` | **40 / 1,118** ≈ 3.6% | new corpus 100%; legacy deferred until OD-01 closes |

## How

**The order is the strategy, and it is not the obvious one.** The obvious first move is a
frontmatter backfill — it is the biggest number and the most visible gap. It is the wrong
first move, for the reason in [[graph-retrieval-premortem]] M1: backfilled frontmatter with
no query over it produces no observable change, and unobservable work is the work that
stops.

1. **Install the tool.** Commit `.obsidian/` with Dataview and Templater enabled. One
   afternoon. It flips `graph.dataview_executable` to true and simultaneously brings **99
   dead board queries across the whole org** to life — the highest leverage-to-effort ratio
   available anywhere in this department, and it benefits 18 other departments.
2. **Measure ambiguity before creating any more links.** [[graph-retrieval-premortem]] M3
   is the failure that takes a year to see, so its check has to precede the campaign that
   causes it. Ship the link-lint: **unresolved = warning** (expected, per
   [ADR 0004](../../../../decisions/0004-obsidian-as-backlink-layer.md)), **ambiguous =
   error**.
3. **Fix ambiguity in the vault-critical directories.** 45 `README.md` files. Not all need
   renaming — `.planning/sketches/*/README.md` will never be wikilinked — so the scope is
   `01-org/`, `02-advisory/`, `foundation/`, `decisions/`. That is a handful of renames,
   not 45, and it hands to [[corpus-archive-charter]] because renaming is a placement act.
4. **Then backfill frontmatter**, scoped by importance rather than by date: the 45 spine
   documents, then all unit documents. Starting with `ORG_STRUCTURE.md`, which mandates the
   contract and does not meet it.
5. **Materialise query output.** A scheduled job writes the Dataview numbers into the board
   files as plain text, so an agent grepping the repo sees them without opening Obsidian
   ([[graph-retrieval-premortem]] M5).
6. **Legacy link backfill — deferred.** Not started until OD-01 closes.

## Why now

- **99 board agendas are dead queries today.** Every unit in the org has an anti-sprawl
  mechanism that does not run. This is one commit away from being fixed.
- **693 unit documents are being written this week.** Frontmatter and link conventions
  applied at write time cost nothing; applied afterwards they cost 693 edits.
- **The ambiguity is already in production.** `engineering-charter.md:106` contains
  `[[README]]` with 45 candidates. It is the first link of its kind and it is already
  wrong.
- **The mandate is being ignored by its own author.** [[ORG_STRUCTURE]] §5 requires
  frontmatter; `ORG_STRUCTURE.md` has none. Every session that reads it learns that the
  rule is optional.

## Next steps

| # | Step | Blocked on | Observable when done |
|---|---|---|---|
| 1 | Commit `.obsidian/` — Dataview + Templater, workspace state gitignored ([[OBSIDIAN_VAULT]] §1) | — | `ls -d .obsidian` succeeds; a board query renders rows |
| 2 | `scripts/graph_metrics.py` — frontmatter coverage, link resolution, ambiguity, linked-file ratio (split new/legacy) | — | Four numbers reproducible from the CLI |
| 3 | Link-lint in CI: ambiguous = error, unresolved = warning | 2 | A PR adding `[[README]]` fails |
| 4 | Resolve `graph.ambiguous_basename_count` in the four vault-critical directories | [[corpus-archive-charter]] does the renames | 0 ambiguous names in `01-org/`, `02-advisory/`, `foundation/`, `decisions/` |
| 5 | Frontmatter on `ORG_STRUCTURE.md` and `OBSIDIAN_VAULT.md` — the two standard-setters | — | The rule's authors comply with it |
| 6 | Frontmatter backfill: remaining 41 spine docs | 5 | `graph.frontmatter_coverage_pct` 8.9% → 100% of spine |
| 7 | Frontmatter lint in CI, scoped to spine + `01-org/` + `02-advisory/` | 6 | New unit docs cannot merge without it |
| 8 | Build `00-index/` MOCs as Dataview queries — `HOME`, `ORG-MAP`, `LOOP-MAP`, `DECISION-INDEX` | 1 | Navigable entry point; no hand-maintained lists |
| 9 | Materialise query output into board files on a schedule | 1, 2 | Board numbers greppable without Obsidian |
| 10 | Legacy corpus link backfill | **OD-01 closing** | `graph.linked_file_ratio` legacy split rises |

Steps 1–9 are unblocked by any founder decision. Only step 10 waits, and it waits
deliberately.

## Questions for the founder

1. **OD-21 is LOCKED in [[OBSIDIAN_VAULT]]:3 and Open in `OPEN-DECISIONS.md`.** We are
   proceeding on the specified layout because it is the only specification available, and
   recording that we are doing so against an open decision. Please close it or correct the
   document.
2. **Graphify.** [[OBSIDIAN_VAULT]] §4 lists it; it is a third-party plugin and the loop
   graph may be adequately served by Dataview over the `loops.md` YAML blocks. Adopt
   Graphify, or defer it until there are enough loops to need it?
3. **Do the 45 `README.md` files get renamed, or does the uniqueness rule get scoped?**
   The team recommends scoping the rule to vault-critical directories — renaming
   `.planning/sketches/*/README.md` is churn with no reader. That is an amendment to
   [[OBSIDIAN_VAULT]] §3, which is why it is a founder question and not a team decision.
4. **Is `.obsidian/` committed or gitignored?** [[OBSIDIAN_VAULT]] §1 says committed with
   workspace-local state ignored. Confirming, because it is the one irreversible-ish choice
   here — a committed vault config becomes everyone's config.
