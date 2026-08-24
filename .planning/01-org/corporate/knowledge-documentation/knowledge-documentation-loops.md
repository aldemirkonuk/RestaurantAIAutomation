---
type: loops
division: corporate
department: knowledge-documentation
status: provisional
metrics: [kd.docs_added_vs_retired_ratio, corpus.duplicate_basename_count, graph.frontmatter_coverage_pct, graph.link_resolution_rate, standards.stale_claim_rate]
updated: 2026-08-24
links: ["[[knowledge-documentation-charter]]", "[[knowledge-documentation-premortem]]", "[[knowledge-documentation-directive]]", "[[knowledge-documentation-schedule]]", "[[corpus-archive-loops]]", "[[graph-retrieval-loops]]", "[[standards-verification-loops]]", "[[LOOP-MAP]]", "[[decision-office-charter]]"]
---

# Knowledge & Documentation — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Four department loops. The teams carry their own; these four exist because they **cross**
teams, or because they measure the department against itself — which no team can do.

---

## L-KD-1 — Retire-to-write ledger

```yaml
type: loop
id: kd-retire-to-write
owner: knowledge-documentation
measures: [kd.docs_added_vs_retired_ratio, corpus.top_level_planning_docs, corpus.total_md_count]
changes: [knowledge-documentation.agenda_full, corpus.archive_policy]
inputs_from: [corpus-archive, graph-retrieval, standards-verification]
outputs_to: [decision-office, corporate]
close_time: monthly
status: proposed
```

Counters [[knowledge-documentation-premortem]] M1. Every document this department created
in the month, against every document it retired. A month with a ratio above 1 is not a
failure on its own; **two consecutive months above 1 with `corpus.duplicate_basename_count`
unmoved** is the alarm state, and the loop is required to say so out loud rather than
reporting the ratio and moving on.

Opening position: **28 added, 0 retired.** Recorded so the department cannot later claim it
started at parity.

---

## L-KD-2 — The three-number board

```yaml
type: loop
id: kd-three-number-board
owner: knowledge-documentation
measures: [corpus.duplicate_basename_count, graph.frontmatter_coverage_pct, standards.stale_claim_rate]
changes: [knowledge-documentation.team_allocation, knowledge-documentation.agenda_board]
inputs_from: [corpus-archive, graph-retrieval, standards-verification]
outputs_to: [corporate, decision-office]
close_time: weekly
status: proposed
```

Three numbers, never summed — a duplicate file and a stale claim are not commensurable
quantities and averaging them would hide whichever is worse. If a number is unreadable the
loop records **unreadable**, not blank: an omitted metric reads as green, which is the
`IS_STUB` lesson (`corporate.md:339-341`) applied to documentation.

`standards.stale_claim_rate` has no value at founding. It is listed anyway, as
`unmeasured`, for exactly that reason.

---

## L-KD-3 — Convention-violated-at-birth review

```yaml
type: loop
id: kd-convention-violated-at-birth
owner: knowledge-documentation
measures: [graph.ambiguous_basename_count, graph.frontmatter_coverage_pct, standards.contract_self_compliance_pct]
changes: [obsidian_vault.filename_rule, org_structure.frontmatter_rule, decisions.open_queue]
inputs_from: [graph-retrieval, standards-verification]
outputs_to: [decision-office, red-team, architecture-review]
close_time: monthly
status: proposed
```

Counters [[knowledge-documentation-premortem]] M5. For every convention asserted in a
locked foundation document, check whether it held **on the day it was written**. Two
failures already: [[ORG_STRUCTURE]] §5 mandates frontmatter and carries none; [[OBSIDIAN_VAULT]]
§3 mandates unique filenames against 45 existing `README.md` files in the vault root.

This loop's output is unusual — it does not fix documents, it **amends contracts**. A
convention that was false at birth is a drafting defect, and per
[[knowledge-documentation-directive]] escalation trigger 4 it routes to
[[red-team-charter]] as a decision defect, not to a doc cleanup queue.

`standards.contract_self_compliance_pct` = % of foundation documents that satisfy the rules
they themselves impose. Baseline: **0 of 2** measurable cases.

---

## L-KD-4 — Cross-division correction handoff

```yaml
type: loop
id: kd-cross-division-correction
owner: knowledge-documentation
measures: [standards.open_corrections_by_owning_unit, standards.correction_age_days]
changes: [decisions.open_queue, knowledge-documentation.agenda_full]
inputs_from: [standards-verification, platform, applied-ai, intelligence, product, commercial, corporate]
outputs_to: [decision-office, positioning-fundraise-readiness, media-and-brand]
close_time: weekly
status: proposed
```

[[standards-verification-charter]] reviews documents it does not write
(`corporate.md:512`), so every finding it produces is a **handoff**, and handoffs are where
findings die. This loop tracks age, not volume: a correction raised against another unit and
unacknowledged for 30 days is escalated to [[decision-office-charter]] regardless of
severity, because the failure being prevented is silence, not disagreement.

Two standing routes are pre-declared so the first instance does not have to be argued:
external-facing numbers → [[positioning-fundraise-readiness-charter]]; stale brand in
product surfaces (not documents) → [[media-brand-charter]].

---

## Close-time summary

| Loop | Close-time | Counters | Opening value |
|---|---|---|---|
| L-KD-1 retire-to-write ledger | monthly | premortem M1 | 28 added / 0 retired |
| L-KD-2 three-number board | weekly | metric drift, silent unreadability | 38 · 8.9% · unmeasured |
| L-KD-3 convention-violated-at-birth | monthly | premortem M5 | 0 of 2 contracts self-compliant |
| L-KD-4 cross-division correction handoff | weekly | findings dying in handoff | 0 raised |

**Team loops:** [[corpus-archive-loops]] (L-CA-1…3) · [[graph-retrieval-loops]]
(L-GR-1…3) · [[standards-verification-loops]] (L-SV-1…3).
