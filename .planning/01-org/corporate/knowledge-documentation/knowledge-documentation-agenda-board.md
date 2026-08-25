---
type: agenda-board
division: corporate
department: knowledge-documentation
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[knowledge-documentation-charter]]", "[[knowledge-documentation-agenda-full]]", "[[knowledge-documentation-loops]]", "[[knowledge-documentation-schedule]]", "[[corpus-archive-agenda-board]]", "[[graph-retrieval-agenda-board]]", "[[standards-verification-agenda-board]]"]
---

# Knowledge & Documentation — Board

> **PROVISIONAL — no work done yet.**

> ⚠️ **Every query on this page currently returns nothing.** No `.obsidian/` directory
> exists, so Dataview is not installed and these fences render as code. That is not a
> caveat — it is [[knowledge-documentation-premortem]] M2, already lit, and it is item 1
> in [[knowledge-documentation-agenda-full]] §Next steps. This department's board is the
> one place in the org where an inert board query is itself the headline finding.

## Every Knowledge & Documentation artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/knowledge-documentation"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/corporate/knowledge-documentation"
WHERE type = "charter"
SORT status ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/corporate/knowledge-documentation"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

Fires **2026-10-23** against all 21 provisional agendas in this department unless work
lands. That date is written down so the rule cannot be quietly ignored.

## Loops missing a close-time

```dataview
LIST
FROM "01-org/corporate/knowledge-documentation"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## The org-wide staleness sweep this department owns for everyone

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  division AS Division,
  default(department, "—") AS Department,
  updated AS "Last touched"
FROM "01-org" OR "02-advisory"
WHERE type = "agenda-full" OR type = "agenda-board"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Standing counters (hand-entered until the jobs exist)

- [ ] `corpus.duplicate_basename_count` — **38** (`md/` ∩ `md_files/`, recursive)
- [ ] `corpus.ambiguous_duplicate_count` — **3** diverged: `PROJECT_ANALYSIS_AND_CHAT_CONTEXT.md`, `README.md`, `RUN_MIGRATION_GUIDE.md`
- [ ] `corpus.top_level_planning_docs` — **28** (~1.2 MB); rule at `CLAUDE.md` §3 forbids more
- [ ] `graph.frontmatter_coverage_pct` — **4 of 45** spine docs ≈ **8.9%**; `ORG_STRUCTURE.md` is not one of the 4
- [ ] `graph.linked_file_ratio` — **40 of 1,118** ≈ 3.6%; was 10 of 1,082 ≈ 0.9%. **All 30 new links came from the org generation; zero legacy docs gained one.**
- [ ] `graph.ambiguous_basename_count` — **≥ 45** files named `README.md` under the vault root alone
- [ ] `graph.dataview_executable` — **false**; no `.obsidian/`
- [ ] `standards.stale_claim_rate` — **unmeasured**. Building the measurement is deliverable #1, not an excuse
- [ ] `standards.unpinned_claim_count` — **≥ 1 known**: insight types quoted as 375, 573, and 348
- [ ] `standards.stale_brand_doc_count` — **216** `.md` under `.planning/`, **75** under `md/`, contain "wineops" (case-insensitive, tree-wide; the founding figure of 28 was spine-scoped)
- [ ] `kd.docs_added_vs_retired_ratio` — **28 added / 0 retired** this month
