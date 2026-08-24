---
type: loops
division: corporate
department: knowledge-documentation
team: graph-retrieval
status: provisional
metrics: [graph.dataview_executable, graph.frontmatter_coverage_pct, graph.link_resolution_rate, graph.ambiguous_basename_count, graph.linked_file_ratio]
updated: 2026-08-24
links: ["[[graph-retrieval-charter]]", "[[graph-retrieval-premortem]]", "[[graph-retrieval-directive]]", "[[graph-retrieval-schedule]]", "[[knowledge-documentation-loops]]", "[[corpus-archive-loops]]", "[[LOOP-MAP]]"]
loop_count: 3
loop_count: 3
loop_ids: ["gr-frontmatter-coverage", "gr-link-ambiguity", "gr-retrieval-usefulness"]
loop_close_times: ["weekly", "weekly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed"]
---

# Graph & Retrieval — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-GR-1 — Frontmatter coverage

```yaml
type: loop
id: gr-frontmatter-coverage
owner: graph-retrieval
measures: [graph.frontmatter_coverage_pct, graph.loops_missing_close_time, standards.contract_self_compliance_pct]
changes: [ci.frontmatter_lint, graph.frontmatter_contract]
inputs_from: [platform, applied-ai, intelligence, product, commercial, corporate, architecture-review, red-team, decision-office]
outputs_to: [knowledge-documentation, decision-office]
close_time: weekly
status: proposed
```

Opening: **4 of 45** spine docs ≈ 8.9%.

Tracks `graph.loops_missing_close_time` alongside coverage because OD-12's resolution —
loops *"documented now, executable later"* — is worth exactly as much as the parseability of
the YAML blocks. A `loops.md` without a `close_time` is not a partially-compliant document;
it is a loop that has failed [[ORG_STRUCTURE]] §5's stated test.

`inputs_from` names every unit because the contract binds all of them. The loop **changes
the CI lint**, not the documents — this team's leverage is the gate, not the backfill.

---

## L-GR-2 — Link ambiguity

```yaml
type: loop
id: gr-link-ambiguity
owner: graph-retrieval
measures: [graph.ambiguous_basename_count, graph.ambiguous_links_in_use, graph.link_resolution_rate]
changes: [ci.link_lint, obsidian_vault.filename_rule]
inputs_from: [corpus-archive, platform, applied-ai, intelligence, product, commercial, corporate]
outputs_to: [corpus-archive, decision-office, red-team]
close_time: weekly
status: proposed
```

Counters [[graph-retrieval-premortem]] M3 — the failure that takes a year to become
visible, which is why its loop is weekly rather than monthly.

Two distinct numbers, and the distinction matters: `graph.ambiguous_basename_count` (≥ 45,
from `README.md` alone) is the **exposure**; `graph.ambiguous_links_in_use` (currently **1**
— `engineering-charter.md:106`) is the **incidence**. Exposure can be large and harmless in
`sketches/`; incidence is never harmless. Reporting only the first would overstate the
crisis, and only the second would understate the risk.

Outputs to [[corpus-archive-charter]] because the fix is a rename, and renames are a
placement act this team does not perform.

---

## L-GR-3 — Retrieval usefulness

```yaml
type: loop
id: gr-retrieval-usefulness
owner: graph-retrieval
measures: [graph.dataview_executable, graph.materialised_query_age_hours, graph.linked_file_ratio_new, graph.linked_file_ratio_legacy]
changes: [graph.index_moc_set, graph.materialisation_job, obsidian.plugin_set]
inputs_from: [graph-retrieval, corpus-archive, standards-verification]
outputs_to: [knowledge-documentation, corporate]
close_time: monthly
status: proposed
```

Counters [[graph-retrieval-premortem]] M1 and M5 — the two failures where the work is done
and nobody benefits.

`graph.dataview_executable` is a boolean in a metrics list, which is unusual and deliberate:
while it is **false** every other number in this team is either hand-entered or
unmeasurable, and a loop that averaged over it would report progress on an inert system.

`graph.materialised_query_age_hours` is the dual-audience check — how stale the plain-text
copies of the query results are for agent readers. If the materialisation job stops, this
number grows and the loop catches it; without it, the vault would look healthy to the one
human who opens Obsidian and be invisible to the twenty sessions a week that grep.

The linked-file ratio is split **new vs legacy** because a single number would rise on new
documents alone and read as progress on a legacy corpus that gained nothing. Opening
position: new corpus rising, legacy **0 of 1,082**.

---

## Close-time summary

| Loop | Close-time | Counters | Opening value |
|---|---|---|---|
| L-GR-1 frontmatter coverage | weekly | premortem M4 | 4 / 45 ≈ 8.9% |
| L-GR-2 link ambiguity | weekly | premortem M3 | exposure ≥ 45, incidence 1 |
| L-GR-3 retrieval usefulness | monthly | premortem M1, M5 | dataview: **false** |

**Deliberately not a loop:** the legacy link backfill. It is blocked by design until OD-01
closes ([[graph-retrieval-directive]] rule 4), and a loop reporting "still deferred" every
week is the diagram [[ORG_STRUCTURE]] §5 warns against. It re-enters as work, not as a
loop, when the fork resolves.
