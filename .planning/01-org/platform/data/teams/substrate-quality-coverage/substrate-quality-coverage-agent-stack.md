---
type: agent-stack
division: platform
department: data
team: substrate-quality-coverage
status: designed
updated: 2026-08-27
metrics: [substrate.quarantine_rate, substrate.confidence_threshold_value, substrate.rows_without_source_guarantee, substrate.governance_tier_distribution]
links: ["[[substrate-quality-coverage-charter]]", "[[substrate-quality-coverage-schedule]]", "[[substrate-quality-coverage-loops]]", "[[substrate-quality-coverage-directive]]", "[[substrate-quality-coverage-premortem]]", "[[0034-agent-stack-artifact]]", "[[data-agent-stack]]", "[[decision-office-charter]]", "[[agent-evaluation-gates-charter]]", "[[skills-charter]]"]
---

# Substrate Quality & Coverage — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The only team in this department that ships nothing, and the card is built to keep it that
> way: it measures rows, it never fills a gap it found, and it may not move its own bar.
> Distinct from [[agent-evaluation-gates-charter]] on subject rather than method — they grade
> **agent tasks**, this unit grades **data rows** (`technology.md:862`).

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `substrate-auditor` | Score confidence, assign governance tier, quarantine what is under-identified, and publish every rate **beside the threshold value that produced it** — while producing nothing | PARTIAL `services/agent-orchestrator/services/governance.py:107,227` — the scoring and tiering functions exist; the audit role with a card does not |

## 2. Agent cards

```yaml
agent: substrate-auditor
unit: substrate-quality-coverage
triggers:
  - schedule: "daily — substrate progress report; quarantine rate beside its threshold, per category and tier"   # mirrored in [[substrate-quality-coverage-schedule]]
  - schedule: "weekly — provenance integrity audit; repair-class closure; wine_repair_log self-check"
  - schedule: "quarterly — gate-efficacy review (how many publishes did the gate actually block?)"
consumes:
  - "rows from all four producers — publishers: [[corpora-enrichment-agent-stack|enrichment-runner]], [[annotation-ground-truth-agent-stack|gold-set-steward]], [[synthetic-generation-simulation-agent-stack|synth-forge]], [[pos-operational-telemetry-ingest-agent-stack|pos-fitness-monitor]]"
  - "`governance.py:20` GovernanceTier and the Layer-1 identity field set at `:29-39`"
  - "the quarantine classification trigger — `…20260817030000_under_identified_quarantine.sql:34,46,66`"
  - "the repair ledger — `…20260813120000_wine_repair_log.sql`"
emits:
  - "quarantine decisions + `wine_repair_log` entries — consumer: [[corpora-enrichment-agent-stack|enrichment-runner]]'s repair loop (`enrichment-repair`)"
  - "threshold-change proposals — consumer: [[decision-office-charter]] (loop `threshold-change-review`, owner: them, not us)"
  - "the daily substrate report — consumer: [[data-agent-stack|data-l0-rollup]] and [[data-agenda-board]] (**two declared owners — see §5**)"
  - "`substrate.rows_without_source_guarantee` — consumer: [[data-charter]]; **source column not yet contracted (gap)**"
  - nf_a events (task_type: substrate_audit)
routing_class: mechanical        # apply a stated threshold, count, classify — deliberately not judgment
quality_bar: "reproducibility plus efficacy: a rerun on the same rows and the same threshold yields the same counts, AND the quarterly gate-efficacy number exists. The second half is NONE (gap) — no publish-block count has ever been measured"
autonomy:
  read: autonomous
  propose: autonomous            # findings, quarantines and threshold proposals land as PRs
  mutate_stock_money_outbound: confirm   # constant
memory: substrate-quality-coverage
escalates_to: "[[data-charter]]"
```

**The card's three hard rules**, each defending a named mechanism. (1) It **never changes a
threshold value** — a threshold is a decision, not config, and the auditor does not move its own
bar (M1). (2) It **never repairs** a row it quarantined; repair belongs to the producers, and an
auditor that repairs audits its own work (M3). (3) It **never publishes a rate without its
threshold on the same line** — a fall caused by better data and one caused by a knob must be
visually distinguishable.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `substrate-progress-report` | T2 | Daily, and **before any external claim about L0** | Three numbers (wine · dish · sales) with named denominators and tier mix; a single-scalar run fails | `datasets/OCR_CONFIDENCE_REPORT.md` — a substrate-quality report this team's own tooling actually produced and committed | NEW |
| `quarantine-triage` | T2 | Quarantine rate moves more than a set band week-on-week, or a new category arrives | Movement attributed to **data** or to **threshold**; if threshold, a decision record exists before the report ships | `…20260814000000_data_quality_rescale.sql:1-15` — a real recalibration, correctly argued: a rule written against a 195-row library flagged 104 rows at 2,443, almost all correct data (Domaine de la Romanée-Conti legitimately has eight wines under one producer) | NEW |

**Two proposals held back.** `provenance-audit` fails for a harder reason than missing history:
the `source_guarantee` intake contract does not exist ([[data-schedule]]), so the audit has no
column to count. `governance-tier-report` cites `governance.py:20-27,107,227` — tier *assignment*
runs in code, but no tier-mix figure has ever been published beside a coverage claim.

**Deliberately never proposed: `threshold-tune`** — making a threshold change one command cheaper
is making [[substrate-quality-coverage-premortem]] M1 one command cheaper, and threshold changes
must stay as expensive as decisions ([[substrate-quality-coverage-directive]] Gate 1). **And no
`repair-*` skill in any form** — that would close the author≠auditor split this team exists for.

Consumed, owned elsewhere: [[skills-charter]]; threshold *values* → [[decision-office-charter]];
doneability methodology → Research & Math.

## 4. Memory

- **Procedural** — the two §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: substrate_audit`. Needs `context.threshold_value` and
  `context.category` as jsonb keys, and the first is the whole point: a quarantine rate that can
  be stored **without** the knob that produced it is a schema that permits M1. The reporting rule
  belongs in the event shape, not only in the report.
- **Semantic** — `memory/` beside this file, `substrate-quality-coverage-MEMORY.md` as index.
  Founding facts: the 2026-08-14 rescale and its reasoning (so the third and fourth relaxation
  can be compared against the first), the Layer-1 field set per category, and each quarantine
  class with whether its repair produced a *rule* or a one-off. Provenance frontmatter; every
  write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the current threshold values.
  Migrations and row data are retrieval targets by `path:line` and by key, never preloaded.

**Consolidation** — monthly, mirrored in [[substrate-quality-coverage-schedule]]: read the audit
slice; **failures first**, with the specialisation this unit needs more than its siblings — every
threshold movement becomes a fact recording *what moved, by how much, and on whose decision*, so
the drift M1 describes reads as a series rather than a sequence of individually reasonable diffs.
Expire at 90 days; propose skill candidates. One PR; "no delta" stated when true — and here a run
that changes nothing is a finding, not a wasted cycle.

## 5. Async contract

Loops ([[substrate-quality-coverage-loops]]: `provenance-integrity-audit`,
`quarantine-rate-tracking`, `threshold-change-review` — owner [[decision-office-charter]], not
this team — `repair-class-closure`, `substrate-progress-report`, `gate-efficacy-review`), NF-A
events, vault PRs. Gap and seam rows:

| Gap / seam | Why it is a gap |
|---|---|
| `source_guarantee` has no intake contract | This unit holds the department's load-bearing invariant and cannot currently count it. `substrate.rows_without_source_guarantee` is declared with no source column |
| The daily substrate report has **two declared owners** | [[substrate-quality-coverage-loops]] loop 5 (owner: this team) and [[data-loops]] loop 1 (owner: the department) describe one report. Recorded here and in [[data-agent-stack]] §5; **neither card resolves it** |
| Nothing enforces that a quarantine actually blocks a publish | The charter's own reservation: this team's independence is worth its cost **only if its findings can stop a publish**. If the gate is advisory in practice, the honest output of `gate-efficacy-review` is a recommendation to merge this team back into the producers (M2) |
| Consumers above L0 can route around the gate | M5's mechanism; nothing in the substrate layer can see it, which is why the gate-efficacy review is exempt from the anti-sprawl downgrade rule |

## 6. Evidence today

- **EXISTS — the measuring apparatus.** `…20260813100000_library_data_quality_check.sql`,
  `…20260813130000_data_quality_confidence.sql` (`library_data_quality_issues` at `:40`),
  `…20260814000000_data_quality_rescale.sql`, `…20260817030000_under_identified_quarantine.sql`,
  `…20260813120000_wine_repair_log.sql`, `…20260807001552_distributor_data_quality.sql`,
  `governance.py:20,29,53,107,227`,
  `{quality_scorer,field_confidence,ontology_validation_service,ontology_normalization}.py`,
  `datasets/OCR_CONFIDENCE_REPORT.md`.
- **PARTIAL — the gate as a gate.** Everything needed to grade a row exists; nothing records
  whether a grade ever stopped anything.
- **NEW — the card, both skills, all four memory layers, and the publication of
  `substrate.confidence_threshold_value`**, which is designed as a first-class number and appears
  nowhere today.
