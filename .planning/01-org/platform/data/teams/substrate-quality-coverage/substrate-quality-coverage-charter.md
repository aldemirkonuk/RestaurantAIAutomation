---
type: charter
division: platform
department: data
team: substrate-quality-coverage
status: exists
metrics: [substrate.quarantine_rate, substrate.confidence_threshold_value, substrate.rows_without_source_guarantee, substrate.governance_tier_distribution]
updated: 2026-08-24
links: ["[[substrate-quality-coverage-premortem]]", "[[substrate-quality-coverage-agenda-full]]", "[[substrate-quality-coverage-agenda-board]]", "[[substrate-quality-coverage-directive]]", "[[substrate-quality-coverage-loops]]", "[[substrate-quality-coverage-schedule]]", "[[data-charter]]", "[[corpora-enrichment-charter]]", "[[annotation-ground-truth-charter]]", "[[synthetic-generation-simulation-charter]]", "[[pos-operational-telemetry-ingest-charter]]", "[[agent-evaluation-gates-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[technology]]", "[[README]]"]
---

# Substrate Quality & Coverage — Charter

Parent: **Data** ([[data-charter]]), division **Platform**. Team §5.5 in
`.planning/foundation/teams/technology.md:679`.

## Mandate

This team's mandate is to **measure the substrate rather than produce it**: confidence
scoring, governance tiers, quarantine of under-identified rows, and the daily
data-substrate progress report (`technology.md:681-683`, [[README]] §6).

It is the only team in this department that ships nothing. That is not an accident of
scope — it is the entire design.

## Why it is distinct from its siblings

§§5.1–5.4 are **producers, and a producer that grades its own output is §0 test 3's
failure** (`technology.md:685-687`). This is the same argument [[ORG_STRUCTURE]] §3 uses to
place the advisory layer outside the line: an auditor that reports inside the thing it
audits is not an auditor.

**Distinct from [[agent-evaluation-gates-charter]] on subject, not on method**: that team
grades **agent tasks**, this one grades **data rows** (`technology.md:687-688`, seam
enumerated at `technology.md:862`). Task outcome and row fitness are different objects and
the overlap is smaller than it first appears — an agent can succeed perfectly at writing a
row that should never be published.

## Boundaries

Owns outright:

- **Confidence scoring and its scale** —
  `supabase/migrations/20260813130000_data_quality_confidence.sql`,
  `…20260814000000_data_quality_rescale.sql`;
  `services/agent-orchestrator/services/field_confidence.py`, `quality_scorer.py`.
- **Governance tiers** — `services/agent-orchestrator/services/governance.py:20`
  (`GovernanceTier`: `CANONICAL` 0, `AUTO_VALIDATED` 1, `WEB_ENRICHED` 2, `PROVISIONAL` 3,
  `UNRESOLVED` 4), `:53` `check_layer_1_cap`, `:107` `assign_governance_tier`, `:227`
  `compute_overall_confidence`. The Layer-1 identity field set — name, producer, vintage,
  country, region, grape variety, wine type (`governance.py:29-39`) — is this team's
  definition of what "identified" means.
- **Quarantine** — `…20260817030000_under_identified_quarantine.sql`, including the
  `identity_status ∈ {normal, under_identified}` constraint (`:34`), the classification
  trigger (`:46,66`), and the rule that a row whose `normalized_producer` equals its
  `normalized_name` is not identified (`:37`).
- **The repair ledger** — `…20260813120000_wine_repair_log.sql`.
- **Library quality checks** — `…20260813100000_library_data_quality_check.sql`;
  `…20260807001552_distributor_data_quality.sql`.
- **Ontology validation** — `services/agent-orchestrator/services/ontology_validation_service.py`,
  `ontology_normalization.py`.
- **The daily substrate report** ([[README]] §6) — including the **three-number rule** (wine ·
  dish · sales) and the **denominator rule**, both of which are department-level
  counter-pressures this team executes ([[data-premortem]] M1, M3).
- **The provenance invariant** — `source_guarantee` on every row, audited weekly as an
  absolute count ([[data-premortem]] M2). This is the department's load-bearing invariant and
  this team holds it.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Producing any data at all | The four producer teams | We measure; we do not fill gaps we find |
| Repairing a quarantined row | [[corpora-enrichment-charter]] | We quarantine and log; they repair and the *class* gets fixed |
| Grading **agent tasks** | [[agent-evaluation-gates-charter]] | Row fitness ≠ task outcome (`technology.md:862`) |
| Defining what "correct" means methodologically | Research & Math *(Intelligence)* | They define doneability; we operate the gate |
| Product identity and merge decisions | [[catalogue-identity-charter]] | We say a row is under-identified; they decide what is the same thing |
| The metrics narrative told outside the company | Analytics & BI *(Intelligence)* | We publish the substrate's true state; they own the story |
| Setting threshold **values** unilaterally | Department + [[decision-office-charter]] | We propose and measure; a threshold is a **decision**, not config |

**That last row is unusual and deliberate.** The auditor does not get to move its own bar.
Without it, [[substrate-quality-coverage-premortem]] M1 is unpreventable.

## Metrics it moves

**Primary: `substrate.quarantine_rate` and its trend** — rows too under-identified to
publish, as a share of intake. *Falling quarantine with rising volume is real progress;
falling quarantine because the threshold moved is not* (`technology.md:700-703`).

The reporting rule is inseparable from the metric: **the rate is always published beside the
threshold value that produced it.** A fall caused by better data and a fall caused by a knob
must be visually distinguishable on the same line.

Secondary:

- `substrate.confidence_threshold_value` — the knob, published as a first-class number.
- `substrate.rows_without_source_guarantee` — **absolute count, not a rate**. Rates hide
  small absolute numbers, and a few hundred contaminated gold rows is a catastrophe at any
  rate ([[data-premortem]] M2).
- `substrate.governance_tier_distribution` — how much of the library is `CANONICAL` versus
  `PROVISIONAL`/`UNRESOLVED` (`governance.py:20-27`). Coverage that is entirely tier 2–3 is
  a different asset from coverage that is tier 0–1.
- `substrate.repair_class_closure_rate` — quarantined rows whose repair produced a *rule*
  change rather than a one-off fix.

## Evidence today

**EXISTS** (`technology.md:690-698`), re-verified 2026-08-24. All cited files present.

- `supabase/migrations/20260813100000_library_data_quality_check.sql`
- `supabase/migrations/20260813130000_data_quality_confidence.sql`
  (`library_data_quality_issues` function at `:40`)
- `supabase/migrations/20260814000000_data_quality_rescale.sql`
- `supabase/migrations/20260817030000_under_identified_quarantine.sql`
- `supabase/migrations/20260813120000_wine_repair_log.sql`
- `supabase/migrations/20260807001552_distributor_data_quality.sql`
- `services/agent-orchestrator/services/governance.py:20,29,53,107,227`
- `services/agent-orchestrator/services/{quality_scorer,field_confidence,ontology_validation_service,ontology_normalization}.py`
- `datasets/OCR_CONFIDENCE_REPORT.md`

**One piece of evidence deserves to be read as a warning rather than a credential.**
`…20260814000000_data_quality_rescale.sql:1-15` documents a threshold being relaxed for an
excellent reason: a rule written against a 195-row library flagged 104 rows at 2,443, and
almost all of them were correct data — Domaine de la Romanée-Conti legitimately has eight
wines under one producer. The recalibration was right. **It is also a complete, in-repo
worked example of the exact move that becomes [[substrate-quality-coverage-premortem]] M1 the
third or fourth time it is made**, and it is why threshold changes are classified as decisions
on this charter rather than as maintenance.

## The reservation this team must carry about itself

[[data-charter]] records it and it belongs here too: **this team's independence is worth its
cost only if its findings can actually stop a publish.** If the quarantine gate is advisory
in practice — a dashboard the producers glance at — the team is overhead, and the honest move
is to merge it back into the producers and hand the audit role to an advisory function
instead ([[ORG_STRUCTURE]] §3).

Reviewed at the first close-time where a coverage milestone and a threshold change land
together. That co-occurrence is the test, and it is a matter of when, not whether.
