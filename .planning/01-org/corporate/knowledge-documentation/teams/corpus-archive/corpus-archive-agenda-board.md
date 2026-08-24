---
type: agenda-board
division: corporate
department: knowledge-documentation
team: corpus-archive
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[corpus-archive-charter]]", "[[corpus-archive-agenda-full]]", "[[corpus-archive-loops]]", "[[corpus-archive-schedule]]", "[[knowledge-documentation-agenda-board]]"]
---

# Corpus & Archive — Board

> **PROVISIONAL — no work done yet.**

> ⚠️ Dataview is not installed (no `.obsidian/`), so these queries return nothing today.
> Tracked as item 1 in [[knowledge-documentation-agenda-full]].

## Every Corpus & Archive artifact

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/knowledge-documentation/teams/corpus-archive"
SORT type ASC
```

## Stale — 60-day rule

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/corporate/knowledge-documentation/teams/corpus-archive"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Archived documents must declare themselves

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  status AS Status,
  default(superseded_by, "⚠️ none") AS "Superseded by"
FROM "archive"
WHERE status = "archived"
SORT file.name ASC
```

Counters [[corpus-archive-premortem]] M5. An archived document with no `superseded_by` is
indistinguishable from a live one, which is what `md_files/` already is.

## Standing counters (hand-entered until the census job exists)

- [ ] `corpus.duplicate_basename_count` — **38** → target **0**
- [ ] `corpus.ambiguous_duplicate_count` — **3** → needs a founder call each, not a script
- [ ] `corpus.top_level_planning_docs` — **28** → hold; `CLAUDE.md` §3 forbids growth
- [ ] `corpus.orphan_doc_count` — **not yet measurable**; blocked on [[graph-retrieval-charter]] link resolution
- [ ] `.planning` total `.md` — **1,118** (28 top-level, ~1.2 MB)
- [ ] `md/` — **113** `.md`, 115/120 files tracked · `md_files/` — **42** `.md`, 44/47 tracked

## The named work items, checkable

- [ ] Delete 35 byte-identical duplicates (one commit, manifest in body)
- [ ] Escalate `PROJECT_ANALYSIS_AND_CHAT_CONTEXT.md` — 27,185 B vs 26,351 B
- [ ] Escalate `README.md` — different categories, same basename; likely a rename not a delete
- [ ] Escalate `RUN_MIGRATION_GUIDE.md` — 18 bytes apart, the pair nobody will diff
- [ ] Remove 2 empty path-shaped directories named `CURSOR_CHAT_MAINOLD.md -> …`
- [ ] Decide 10.8 MB gitignored chat log (2 × 5,409,376 B) — archive out of tree, or keep
- [ ] Ship `scripts/check_no_new_toplevel_planning_docs.sh`
- [ ] Regenerate or retire `md/DOCUMENTATION_INDEX.md` — **7 months stale**, every category count wrong
- [ ] Place `.planning/library/` for OD-22
- [ ] Execute OD-01 — **blocked on founder**
