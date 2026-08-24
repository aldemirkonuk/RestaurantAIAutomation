---
type: agenda-board
division: platform
department: data
team: substrate-quality-coverage
status: provisional
metrics: [substrate.quarantine_rate, substrate.confidence_threshold_value, substrate.rows_without_source_guarantee, substrate.governance_tier_distribution]
updated: 2026-08-24
links: ["[[substrate-quality-coverage-charter]]", "[[substrate-quality-coverage-premortem]]", "[[substrate-quality-coverage-agenda-full]]", "[[substrate-quality-coverage-loops]]", "[[substrate-quality-coverage-schedule]]", "[[data-agenda-board]]", "[[decision-office-charter]]"]
---

# Substrate Quality & Coverage — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Artifact, status AS Status, updated AS Updated
FROM "01-org"
WHERE team = this.team
SORT type ASC
```

## The four producers this team audits — author ≠ auditor

```dataview
TABLE WITHOUT ID
  file.link AS Producer, status AS Evidence, updated AS Updated
FROM "01-org"
WHERE department = this.department AND type = "charter" AND team != this.team AND team != null
SORT file.name ASC
```

## Every premortem in the department — this team reads all of them

```dataview
TABLE WITHOUT ID
  file.link AS Premortem, team AS Team, updated AS Updated
FROM "01-org"
WHERE department = this.department AND type = "premortem"
SORT team ASC
```

## Stale check — 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
```

## The dial and the knob — never shown apart

- [ ] `substrate.quarantine_rate` + trend — unpublished
- [ ] `substrate.confidence_threshold_value` — **not published as a first-class number**
- [ ] Threshold-change protocol (decision, owner, close-time) — **does not exist**
- [ ] Precedent on record: `…20260814000000_data_quality_rescale.sql:1-15` — correct, and instance #1

## The invariant this team holds

- [ ] `source_guarantee` in the intake contract — **not implemented**
- [ ] `substrate.rows_without_source_guarantee` — unmeasured; must be an **absolute count**
- [ ] Any non-zero value escalates same-day ([[data-directive]] trigger 2)

## Is the gate real?

- [ ] Quarantine blocks the publish state transition at **read** — not implemented
- [ ] Coverage reported by governance tier (`CANONICAL`/`AUTO_VALIDATED` vs `PROVISIONAL`/`UNRESOLVED`) — not implemented
- [ ] Count of publishes actually blocked to date: **0** ← if still 0 in two quarters, merge this team ([[substrate-quality-coverage-premortem]] M2)

## Scope of the definition

- [ ] Layer-1 field set is **wine's** (`governance.py:29-39`) and is not labelled as such
- [ ] Quarantine rate **per category** — not implemented; an ungated category looks clean (M4)
- [ ] Non-wine identification definitions — none written

## Independence self-checks

- [ ] `wine_repair_log` audited for this team's own name in the repairer column (M3)
- [ ] This team measured on producer milestones — **must never be**
- [ ] [[architecture-review-charter]] asked to look for private corpora above L0 (M5)

## Built and healthy

- [x] `governance.py:20,29,53,107,227` — tiers, Layer-1 cap, tier assignment, overall confidence
- [x] `…20260813130000_data_quality_confidence.sql` (`library_data_quality_issues` at `:40`)
- [x] `…20260817030000_under_identified_quarantine.sql` (`identity_status` constraint `:34`, trigger `:46,66`)
- [x] `…20260813120000_wine_repair_log.sql`, `…20260813100000_library_data_quality_check.sql`
- [x] `quality_scorer.py`, `field_confidence.py`, `ontology_validation_service.py`, `ontology_normalization.py`
- [x] `datasets/OCR_CONFIDENCE_REPORT.md`
