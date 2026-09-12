---
type: loops
division: corporate
department: knowledge-documentation
team: corpus-archive
status: provisional
metrics: [corpus.duplicate_basename_count, corpus.ambiguous_duplicate_count, corpus.top_level_planning_docs, corpus.orphan_doc_count]
updated: 2026-08-24
links: ["[[corpus-archive-charter]]", "[[corpus-archive-premortem]]", "[[corpus-archive-directive]]", "[[corpus-archive-schedule]]", "[[knowledge-documentation-loops]]", "[[graph-retrieval-loops]]", "[[LOOP-MAP]]"]
loop_count: 3
loop_ids: ["ca-duplicate-burndown", "ca-placement-drift", "ca-archive-integrity"]
loop_close_times: ["weekly", "weekly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed"]
---

# Corpus & Archive — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-CA-1 — Duplicate burn-down

```yaml
type: loop
id: ca-duplicate-burndown
owner: corpus-archive
measures: [corpus.duplicate_basename_count, corpus.ambiguous_duplicate_count, corpus.bytes_duplicated]
changes: [corpus.md_files_tree, corpus.md_tree, decisions.open_queue]
inputs_from: [corpus-archive]
outputs_to: [graph-retrieval, decision-office]
close_time: weekly
status: proposed
```

Opening: **38 / 3**. Target: **0 / 0**.

The loop reports **two** numbers and is forbidden from reporting a percentage, because
"92% resolved" would describe the state where every mechanical deletion is done and every
hard decision remains. It also watches commit *shape*: a change reducing the count by more
than 35 in one step means a tiebreak was scripted, which is
[[corpus-archive-premortem]] M2. That is an alarm, not a milestone.

Weekly rather than daily: the 35 are one session's work and the 3 are gated on a founder
call, so a daily cadence would report "unchanged, waiting" six times a week — the kind of
green-and-idle loop [[ORG_STRUCTURE]] §4's anti-sprawl rule is aimed at.

---

## L-CA-2 — Placement drift

```yaml
type: loop
id: ca-placement-drift
owner: corpus-archive
measures: [corpus.top_level_planning_docs, corpus.docs_created_outside_placement_rule]
changes: [ci.placement_guard, corpus.placement_rule]
inputs_from: [platform, applied-ai, intelligence, product, commercial, corporate, architecture-review, red-team, decision-office]
outputs_to: [knowledge-documentation, decision-office]
close_time: weekly
status: proposed
```

Counters [[corpus-archive-premortem]] M1 — the most likely way this team fails.

Baseline **28** top-level `.planning/*.md`. `inputs_from` lists every unit in the company
because *every* unit is a potential source of drift; this is the one loop in the department
whose input surface is the whole org.

A weekly close-time is deliberately faster than the drift: the failure is not one bad
document, it is forty sessions each adding one. Catching the first is cheap; catching the
fortieth is a second restructure.

The loop's output changes the **CI guard**, not a document. A rule enforced by reading has
already failed here once — `CLAUDE.md` §3 exists today and the count is 28.

---

## L-CA-3 — Archive integrity

```yaml
type: loop
id: ca-archive-integrity
owner: corpus-archive
measures: [corpus.archived_docs_without_superseded_by, corpus.archived_bytes, corpus.untracked_archive_manifest_gaps]
changes: [corpus.archive_policy, corpus.archive_manifest]
inputs_from: [corpus-archive, standards-verification]
outputs_to: [graph-retrieval, standards-verification, decision-office]
close_time: monthly
status: proposed
```

Counters [[corpus-archive-premortem]] M5 and M4 together, because both are about content
that has left the live corpus without leaving a record.

Two checks:

1. **Every archived document declares itself** — `status: archived` plus `superseded_by`.
   An archive entry without a superseder is indistinguishable from a live document.
   `.planning/archive/` held v2.0 phase documents with no such marker until it was
   deleted on 2026-08-24 ([[0032-vault-cleanup-cut-line]]) — the marker requirement now
   applies to whatever archive replaces it, before it accumulates.
2. **Every archived-out-of-tree artifact has a manifest row.** Applies to the gitignored
   content — 10.8 MB of chat log across two trees — where git provides no undo. A gap
   between what left and what the manifest records is unrecoverable data loss that nobody
   has noticed yet.

Monthly because archiving is episodic; a weekly loop here would report "no change" most
weeks and be downgraded under the three-empty-runs rule ([[README|foundation-README]] §6).

---

## Close-time summary

| Loop | Close-time | Counters | Opening value |
|---|---|---|---|
| L-CA-1 duplicate burn-down | weekly | premortem M2 | 38 / 3 |
| L-CA-2 placement drift | weekly | premortem M1 | 28 top-level docs |
| L-CA-3 archive integrity | monthly | premortem M4, M5 | 0 markers, 0 manifest rows |

**Not a loop, deliberately:** the OD-01 restructure. It is a one-time project blocked on a
founder decision, and dressing a blocked project as a loop would produce a diagram that
reports "waiting" indefinitely. Its only recurring component — the 90-day deferral
escalation — lives in [[corpus-archive-directive]] §Escalation trigger, item 4.
