---
type: schedule
division: platform
department: data
team: substrate-quality-coverage
status: provisional
metrics: [substrate.quarantine_rate, substrate.confidence_threshold_value, substrate.rows_without_source_guarantee, substrate.governance_tier_distribution]
updated: 2026-08-24
links: ["[[substrate-quality-coverage-charter]]", "[[substrate-quality-coverage-loops]]", "[[substrate-quality-coverage-directive]]", "[[data-schedule]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[README]]"]
---

# Substrate Quality & Coverage — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Daily | **Substrate progress report** ([[README]] §6) — three L0 numbers, denominators named, tier mix stated | `nf_a.*`; [[data-agenda-board]] |
| Daily | Quarantine rate **beside** the threshold value that produced it, per category and tier | `substrate.quarantine_rate`, `substrate.confidence_threshold_value` |
| Weekly | **Provenance integrity audit** — absolute count of rows lacking `source_guarantee` | Same-day escalation on any non-zero value |
| Weekly | Repair-class closure — did last week's repairs produce rule changes or one-off fixes? | `substrate.repair_class_closure_rate` |
| Weekly | `wine_repair_log` self-check — does this team's name appear in the repairer column? | Finding against itself, if so |
| Monthly | Threshold-change review — run by [[decision-office-charter]], not by us | `substrate.threshold_milestone_cooccurrence` |
| Monthly | Ontology validation sweep (`ontology_validation_service.py`, `ontology_normalization.py`) | Normalization rule changes |
| Quarterly | **Gate-efficacy review** — how many publishes did the gate actually block? | Merge-or-keep recommendation for this team |
| Quarterly | Layer-1 definition review per category (`governance.py:29-39` is wine's field set) | Category identification definitions |

**Anti-sprawl ([[README]] §6):** a job producing no action for 3 consecutive runs is
downgraded or deleted.

**This team is the most exposed to that rule in the whole department, and it should be.** Its
entire output is measurement, and measurement that changes nothing is the definition of what
the rule exists to kill. Two specific honesty notes:

- **The daily substrate report is the prime downgrade candidate.** A daily report nobody acts
  on becomes wallpaper faster than any other artifact here. Downgrade path: daily → weekly →
  deleted, automatic, not discretionary.
- **The gate-efficacy review is exempt from downgrade and is the opposite kind of check** —
  its "no action" outcome is itself the most important finding this team can produce, because
  two quarters of zero blocked publishes means the team should recommend its own merger
  ([[substrate-quality-coverage-premortem]] M2).

## Skills owned

**None today.** `.claude/skills/` does not exist in this repo; the only project skill is
`.agents/skills/railway-config/SKILL.md` ([[README]] §3.1). Proposals below, against the
§3.3 protocol.

| Skill | Tier | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|---|
| `substrate-progress-report` | T2 Department | Daily, and **before any external claim about L0** | Three numbers emitted with named denominators and tier mix; a single-scalar run fails | The three-number rule exists because wine has ten services while dish identity was deferred (`b728d25`) and sales is PARTIAL — the exact asymmetry the report makes visible |
| `provenance-audit` | T2 Department | Weekly, and before any gold-set, benchmark or training-set change | Absolute count of rows lacking `source_guarantee` published; non-zero escalated same day | `active_learning_service.py:14-17`'s benchmark-validation loop is the precise place contamination enters ([[data-premortem]] M2) |
| `quarantine-triage` | T2 Department | Quarantine rate moves more than a set band week-on-week, or a new category arrives | Movement attributed to **data** or to **threshold**; if threshold, a decision record exists before the report ships | `…20260817030000_under_identified_quarantine.sql` + `…20260814000000_data_quality_rescale.sql:1-15` — a real recalibration, correctly argued, which is exactly the pattern needing a record next time |
| `governance-tier-report` | T3 Operational | Any coverage figure is about to be published | Figure carries its tier mix (`CANONICAL`/`AUTO_VALIDATED` vs `PROVISIONAL`/`UNRESOLVED`) or it does not publish | `governance.py:20-27,107,227`; prevents "900 enriched wines" being said without saying what kind |

**Not proposed, deliberately:** a `threshold-tune` skill. Making threshold changes one command
cheaper is making [[substrate-quality-coverage-premortem]] M1 one command cheaper. Threshold
changes are decisions and must stay as expensive as a decision
([[substrate-quality-coverage-directive]] Gate 1). Also not proposed: any `repair-*` skill —
repair belongs to the producers, and a repair skill owned here would close the author≠auditor
split that justifies this team's existence (M3).

**Anti-sprawl:** a skill unfired for 30 days is reviewed for deletion ([[README]] §3.3), by
[[skill-lifecycle-anti-sprawl-charter]]. This team does not review its own skills — the same
principle it applies to everyone else.
