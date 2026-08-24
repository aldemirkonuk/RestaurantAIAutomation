---
type: agenda-full
division: corporate
department: knowledge-documentation
team: corpus-archive
status: provisional
metrics: [corpus.duplicate_basename_count, corpus.ambiguous_duplicate_count, corpus.top_level_planning_docs]
updated: 2026-08-24
links: ["[[corpus-archive-charter]]", "[[corpus-archive-premortem]]", "[[corpus-archive-agenda-board]]", "[[corpus-archive-loops]]", "[[corpus-archive-schedule]]", "[[knowledge-documentation-agenda-full]]", "[[graph-retrieval-charter]]", "[[OBSIDIAN_VAULT]]"]
---

# Corpus & Archive — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Take `corpus.duplicate_basename_count` from **38** to **0**, hold
`corpus.top_level_planning_docs` at **28**, and leave behind a placement rule and an archive
policy that survive the sessions that come after the cleanup.

Three bodies of work, in dependency order:

1. **Dedupe** — 35 mechanical deletions, 3 founder decisions. Independent of OD-01;
   can start immediately.
2. **Placement & archive policy** — the permanent tail. Also independent of OD-01, and the
   thing that decides whether the restructure gets paid for once or twice.
3. **The OD-01 restructure itself** — blocked on a founder call, and correctly so.

## How

**Dedupe splits cleanly and the split is the method.** Byte-identical pairs are a script's
decision; anything else is a human's. That line is drawn in [[corpus-archive-directive]]
and it is the direct counter to [[corpus-archive-premortem]] M2.

- **The 35** — verified with `cmp` over the `md/` ∩ `md_files/` intersection. Delete the
  `md_files/` side (it is the partial copy; `md/` is the fuller tree at 113 `.md` vs 42),
  in one commit, with the manifest in the commit body.
- **The 3** — one escalation per pair, each with a diff attached, into
  `OPEN-DECISIONS.md`. `README.md` is not actually a duplicate — the two files live in
  different categories and share only a basename — so its resolution is a **rename**, not
  a deletion, and it hands directly to [[graph-retrieval-charter]]'s ambiguity work.

**Placement rule before restructure, not after.** [[corpus-archive-premortem]] M1 is the
most likely failure and its counter is cheap: one grep-shaped CI check, in the same shape
as `scripts/check_schema_parity.sh`, which this repo already runs. Shipping it before the
restructure means the restructured tree is defended from its first day rather than
retroactively.

**The restructure waits, and the wait has a deadline.** [[OBSIDIAN_VAULT]] §5 F2 fixed the
direction — *corpus in place now, clean slate as the end goal.* "For now" without a date is
how a deferral becomes a permanent state, so this agenda asks the founder for one.

## Why now

- **38 duplicated basenames is a number with a reachable zero**, and 35 of them cost one
  session. Almost nothing else in this org has that ratio.
- **The stale index is being read.** `md/DOCUMENTATION_INDEX.md` (2026-01-29) tells a
  reader `04-updates-builds` holds 6 files. It holds **48**. Anyone navigating by it is
  navigating by fiction.
- **693 unit documents are landing this week.** A placement rule written after they land
  has to be enforced retroactively across all of them.
- **10.8 MB of gitignored chat log** sits in two copies with a corrupted directory beside
  it, invisible to review. Whatever the right answer is, "nobody has looked" is not it.

## Next steps

| # | Step | Blocked on | Observable when done |
|---|---|---|---|
| 1 | Publish the census as a script — `scripts/corpus_census.py` — emitting all `corpus.*` | — | Numbers reproducible by anyone, not just this charter |
| 2 | Delete the 35 byte-identical `md_files/` duplicates in one commit with a manifest | — | `corpus.duplicate_basename_count` 38 → 3 |
| 3 | Escalate the 3 diverged pairs, one entry each with a diff | Founder | 3 → 0 after the calls |
| 4 | Ship `scripts/check_no_new_toplevel_planning_docs.sh` in CI | — | A PR adding a top-level `.planning/*.md` fails |
| 5 | Remove the two empty path-shaped directories (`CURSOR_CHAT_MAINOLD.md -> …`) after verifying they are empty | — | `find md md_files -type d -name '*->*'` returns nothing |
| 6 | Decide the 10.8 MB chat-log question — archive out of tree, or keep | Founder | Recorded decision + manifest if moved |
| 7 | Write the archive policy: what "finished" means, where it goes, `status: archived` + superseded-by frontmatter | Needs [[graph-retrieval-charter]] frontmatter contract | `.planning/archive/` entries carry the marker |
| 8 | Regenerate or retire `md/DOCUMENTATION_INDEX.md` | Depends on OD-01 shape | Index counts match the tree, or the file is gone |
| 9 | Place the OD-22 library at `.planning/library/` | Founder confirms home | Directory exists with the entry contract |
| 10 | Execute the OD-01 restructure, link rewrites in the same commits | **Founder call on OD-01** | Target shape reached; no orphaned relative links |

Steps 1–5 are unblocked today. Steps 3, 6, 9, 10 need the founder. That ordering is
deliberate: the team should have moved four counters before it ever waits on a decision.

## Questions for the founder

1. **The three diverged pairs.** For each, which side is authoritative?
   - `PROJECT_ANALYSIS_AND_CHAT_CONTEXT.md` — `md/` (27,185 B) vs `md_files/` (26,351 B)
   - `README.md` — `md/09-communication/` (1,157 B) vs `md_files/01-getting-started/`
     (1,375 B) — **different documents sharing a name**; likely both are kept and one is
     renamed
   - `RUN_MIGRATION_GUIDE.md` — `md/02-architecture/` (3,610 B) vs `md_files/02-architecture/`
     (3,628 B) — 18 bytes apart
2. **OD-01 target shape**, and a **date** for "for now" ([[OBSIDIAN_VAULT]] §5 F2). Does
   `md/` merge into `.planning/`, or move out of the working tree entirely?
3. **The 10.8 MB of gitignored chat history.** It is unrecoverable by git if deleted.
   Archive it outside the repo with a manifest, or keep it in place?
4. **`.planning/library/`** as the OD-22 home — confirm.
5. **Does `md_files/` have any reason to exist?** It is a 42-file partial copy of a
   113-file tree with three divergences. The team's recommendation is that it does not, and
   that after step 2 it should be removed wholesale rather than maintained.
