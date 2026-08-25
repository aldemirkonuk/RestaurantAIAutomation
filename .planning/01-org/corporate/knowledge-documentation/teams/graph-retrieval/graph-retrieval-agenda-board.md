---
type: agenda-board
division: corporate
department: knowledge-documentation
team: graph-retrieval
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[graph-retrieval-charter]]", "[[graph-retrieval-agenda-full]]", "[[graph-retrieval-loops]]", "[[graph-retrieval-schedule]]", "[[knowledge-documentation-agenda-board]]"]
---

# Graph & Retrieval — Board

> **PROVISIONAL — no work done yet.**

> ⚠️ **These queries do not run.** No `.obsidian/` exists, so Dataview is not installed.
> For this team specifically, that is not a rendering caveat — it is the team's headline
> metric (`graph.dataview_executable = false`) and its first deliverable. A board that
> cannot render is the most accurate possible statement of the current state.

## Every Graph & Retrieval artifact

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/knowledge-documentation/teams/graph-retrieval"
SORT type ASC
```

## Frontmatter compliance across the whole vault — the department's org-wide duty

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(type, "⚠️ missing") AS Type,
  default(division, "⚠️ missing") AS Division,
  default(updated, "⚠️ missing") AS Updated
FROM "01-org" OR "02-advisory" OR "foundation" OR "decisions"
WHERE !type OR !division OR !updated
SORT file.path ASC
```

Expected to return **41 of 45** spine documents on first run, including `ORG_STRUCTURE.md`
and `OBSIDIAN_VAULT.md` — the two documents that define the contract.

## Loops missing a close-time, org-wide

```dataview
LIST
FROM "01-org" OR "02-advisory"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Units with no charter yet — unresolved links mark docs worth writing

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  length(links) AS "Outbound links"
FROM "01-org" OR "02-advisory"
WHERE type = "charter"
SORT length(links) DESC
```

## Standing counters (hand-entered until `scripts/graph_metrics.py` exists)

- [ ] `graph.dataview_executable` — **false** · no `.obsidian/` in the repo
- [ ] `graph.frontmatter_coverage_pct` — **4 / 45** ≈ **8.9%** · the 4: `STATE.md`, `v1.0-MILESTONE-AUDIT.md`, `v2.0-MILESTONE-AUDIT.md`, `v3.0-TECH-DEBT.md`
- [ ] `graph.ambiguous_basename_count` — **≥ 45** files named `README.md` under the vault root
- [ ] `graph.link_resolution_rate` — **unmeasurable** until step 2
- [ ] `graph.linked_file_ratio` — **40 / 1,118** ≈ 3.6% · *legacy split:* **0 of 1,082 legacy docs gained a link**; all growth is new org documents
- [ ] Known ambiguous link in production — `engineering-charter.md:106` writes `[[README]]`, 45 candidates

## The named work items, checkable

- [ ] Commit `.obsidian/` with Dataview + Templater — **unblocks 99 board agendas org-wide**
- [ ] `scripts/graph_metrics.py`
- [ ] Link-lint in CI — ambiguous = **error**, unresolved = warning
- [ ] Rename ambiguous basenames in `01-org/`, `02-advisory/`, `foundation/`, `decisions/`
- [ ] Frontmatter on `ORG_STRUCTURE.md` — the document that mandates frontmatter
- [ ] Frontmatter on `OBSIDIAN_VAULT.md` — the document that defines the schema
- [ ] Backfill remaining 41 spine docs
- [ ] Frontmatter lint in CI, scoped by importance not by date
- [ ] Build `00-index/` MOCs as queries
- [ ] Materialise query output into board files for agent readers
- [ ] Legacy link backfill — **deliberately deferred until OD-01 closes**
