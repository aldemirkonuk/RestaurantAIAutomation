---
type: agenda-full
division: corporate
department: knowledge-documentation
status: provisional
metrics: [corpus.duplicate_basename_count, graph.frontmatter_coverage_pct, standards.stale_claim_rate, kd.docs_added_vs_retired_ratio]
updated: 2026-08-24
links: ["[[knowledge-documentation-charter]]", "[[knowledge-documentation-premortem]]", "[[knowledge-documentation-agenda-board]]", "[[knowledge-documentation-loops]]", "[[knowledge-documentation-schedule]]", "[[corpus-archive-agenda-full]]", "[[graph-retrieval-agenda-full]]", "[[standards-verification-agenda-full]]", "[[OBSIDIAN_VAULT]]", "[[decision-office-charter]]"]
---

# Knowledge & Documentation — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Three parallel tracks, one per team, plus one department-level constraint that binds them.

| Track | Owner | v0 state → target |
|---|---|---|
| **Place it** — OD-01 restructure, dedupe, archive policy | [[corpus-archive-charter]] | 38 duplicated basenames → 0; 28 top-level `.planning` docs → a policy that holds |
| **Find it** — vault mechanics, frontmatter, link graph | [[graph-retrieval-charter]] | no `.obsidian/` → Dataview executing; 8.9% frontmatter → 100% of spine |
| **Verify it** — claim pinning, staleness, brand drift | [[standards-verification-charter]] | `standards.stale_claim_rate` unmeasured → measured, then falling |
| **Don't grow** — retire-to-write | department | `kd.docs_added_vs_retired_ratio` = ∞ → ≤ 1 |

## How

**Ordering is not arbitrary, and one dependency is load-bearing.** Graph work must not
begin with a frontmatter backfill. It must begin with `.obsidian/` + Dataview, because
frontmatter with no query over it produces no observable change, and — per
[[knowledge-documentation-premortem]] M2 — unobservable work is the work that stops.

Sequence:

1. **Unblock observation** ([[graph-retrieval-charter]]). Commit `.obsidian/` with
   Dataview + Templater. Every `agenda-board.md` in the org becomes live on the same day.
   This is the cheapest high-leverage action available to the department and it unblocks
   the other 98 units, not just these three teams.
2. **Stop the bleeding** ([[corpus-archive-charter]]). Delete the 35 byte-identical
   duplicates. Escalate the 3 diverged ones — they need a human, and they are the only
   part of dedupe that does.
3. **Pin the claims** ([[standards-verification-charter]]). The insight-count case first,
   because it is the worked example and it sits in the YC narrative.
4. **Then** frontmatter backfill, link-lint, and the OD-01 restructure proper — all of
   which are large, and none of which should start before there is a query that can show
   whether they worked.

**Why not run OD-01 first, even though it is the biggest problem.** OD-01 is a founder
decision that has not been made (`OD-01, OPEN-DECISIONS.md:73`). Steps 1–3 are entirely
independent of which shape the founder picks and are not invalidated by any answer. Doing
them first buys measurement while waiting, rather than waiting idle.

## Why now

- **99 units × 7 artifacts = 693 documents are being written this week.** Every convention
  not enforced now gets backfilled across 693 files later. The filename-uniqueness rule and
  the frontmatter contract are cheap today and expensive in a month.
- **Two failures are already in progress** — no `.obsidian/` (so Dataview executes
  nowhere) and 45 files named `README.md` in the vault root (so `[[README]]` is already
  ambiguous, already used at `engineering-charter.md:106`).
- **The stale index is 7 months old and getting quoted.** `md/DOCUMENTATION_INDEX.md`
  (2026-01-29) claims `04-updates-builds` holds 6 files; it holds **48**.
- **[ADR 0002](../../decisions/0002-documentation-first-operating-mode.md) makes this
  non-optional.** Documentation-first means agents act on these files. Corpus defects are
  execution defects with a delay.

## Next steps

Ordered, each with an owner and an observable outcome. None is started.

| # | Step | Owner | Observable when done |
|---|---|---|---|
| 1 | Commit `.obsidian/` with Dataview + Templater enabled; verify one board query renders | [[graph-retrieval-charter]] | `ls -d .obsidian` succeeds; `knowledge-documentation-agenda-board` renders rows |
| 2 | Measure and publish the three baselines as a script, not by hand | [[graph-retrieval-charter]] | `scripts/corpus_metrics.py` prints all of `corpus.*`, `graph.*` |
| 3 | Delete the 35 byte-identical `md/`↔`md_files/` duplicates | [[corpus-archive-charter]] | `corpus.duplicate_basename_count` 38 → 3 |
| 4 | Escalate the 3 diverged pairs to the founder with a diff each | [[corpus-archive-charter]] | Entry in `OPEN-DECISIONS.md`; 3 → 0 after the call |
| 5 | Pin the insight-type count: assert an exact number in `insight-catalog.spec.ts`, then correct all quoting docs | [[standards-verification-charter]] | One number in the corpus, backed by a failing-on-change test |
| 6 | Link-lint: reject any `[[link]]` resolving to >1 file | [[graph-retrieval-charter]] | `graph.ambiguous_basename_count` measured; 45 `README.md` handled |
| 7 | Frontmatter backfill across the 45 spine docs, starting with `ORG_STRUCTURE.md` | [[graph-retrieval-charter]] | `graph.frontmatter_coverage_pct` 8.9% → 100% |
| 8 | Placement rule + `check_no_new_toplevel_planning_docs.sh` in CI | [[corpus-archive-charter]] | A PR adding a top-level `.planning/*.md` fails CI |
| 9 | OD-22 library — scope, home, and index shape | [[corpus-archive-charter]] + [[graph-retrieval-charter]] | `.planning/library/` exists with a Dataview index |
| 10 | OD-14 — retire or rewrite root `SKILLS.md` | [[standards-verification-charter]] | Founder call recorded; file retired or rewritten |

## Questions for the founder

1. **OD-01 target shape.** The corpus stays in place *for now* with clean slate as the
   stated end goal ([[OBSIDIAN_VAULT]] §5, F2). What is the end shape, and does `md/` +
   `md_files/` merge into `.planning/` or get archived out of the working tree entirely?
2. **The 3 diverged duplicates.** `PROJECT_ANALYSIS_AND_CHAT_CONTEXT.md`,
   `README.md`, `RUN_MIGRATION_GUIDE.md` — for each, which side is true? There is no
   mechanical answer; that is why it is here and not in a script.
3. **OD-21 is marked LOCKED in [[OBSIDIAN_VAULT]]:3 and Open in `OPEN-DECISIONS.md`.**
   Which is it? Per [`CLAUDE.md`](../../../CLAUDE.md) §0.1 the register wins, so we are
   treating vault mechanics as **open** — please confirm or close it.
4. **OD-14.** Retire root `SKILLS.md`, or rewrite it? It is a prose reasoning protocol
   named like a registry, last touched 2026-02-15, and its second line still says
   *"the WineOps AI project"*.
5. **OD-22 scope and home.** `.planning/library/` is the obvious home. Confirm, and confirm
   the founder still wants a dedicated session for it rather than incremental capture.
6. **CORP-F6 (new, raised here).** Should [[standards-verification-charter]] sit under
   [[decision-office-charter]] as an advisory function instead of inside this department?
   `corporate.md:512-515` raises it; this department cannot credibly answer it about
   itself. See [[knowledge-documentation-charter]] §Explicit non-goals for both arguments.
7. **`.claude/skills/` does not exist.** 99 `schedule.md` files assert that it does. Create
   it and migrate `.agents/skills/railway-config/`, or change the 99 assertions?

## Forks raised by this department

Staged here rather than written into `OPEN-DECISIONS.md` — sibling generator sessions are
appending to that table concurrently, and parallel edits to one table produce a merge
conflict, not a decision log.

| Proposed ID | Fork |
|---|---|
| CORP-F6 | Does [[standards-verification-charter]] belong to this department or to [[decision-office-charter]]? |
| CORP-F7 | Does `.claude/skills/` get created (and `.agents/skills/` migrated), or do the 99 `schedule.md` assertions get corrected? |
| CORP-F8 | Is the **retire-to-write** rule (this department only) or org-wide? An org-wide version caps 693 documents from growing; a department-only version caps only the auditor. |
