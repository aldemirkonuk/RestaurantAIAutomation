---
type: loops
division: corporate
department: people-agent-ops
team: roster-lifecycle
status: provisional
metrics: [roster.truth_pct, roster.unregistered_module_count, roster.silent_default_spec_count, roster.declared_stub_count, roster.maturity_level_evidenced_pct, roster.headcount_claim_variance, roster.retirement_count]
updated: 2026-08-24
links: ["[[roster-lifecycle-charter]]", "[[roster-lifecycle-premortem]]", "[[roster-lifecycle-directive]]", "[[people-agent-ops-loops]]", "[[performance-doneability-loops]]", "[[LOOP-MAP]]", "[[ai-orchestration-charter]]", "[[agent-fleet-charter]]", "[[harness-runtime-charter]]", "[[reliability-sre-charter]]", "[[decision-office-charter]]", "[[positioning-fundraise-readiness-charter]]"]
---

# Roster & Lifecycle — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Five loops. Close-times run from **per PR** to **quarterly**, and the spread is the
design: the fast loops catch a defect before it exists, the slow ones catch the
incentive failures that only become visible over quarters.

---

## L-RL-1 — Three-way census

```yaml
type: loop
id: rl-three-way-census
owner: roster-lifecycle
measures: [roster.unregistered_module_count, roster.silent_default_spec_count, roster.truth_pct, roster.headcount_claim_variance]
changes: [orchestrator.agent_classes, agent_registry.default_specs, roster.exclusion_register]
inputs_from: [ai-orchestration, agent-fleet, engineering]
outputs_to: [people-agent-ops, ai-orchestration, decision-office]
close_time: daily
status: proposed
```

Diffs the filesystem (`services/agent-orchestrator/agents/*.py`, 26) against the
orchestrator class map (`core/orchestrator.py:174-211`, 23) against `DEFAULT_AGENT_SPECS`
(`core/agent_registry.py`, 19). **Output is a 26-row table with a verdict per predicate**,
never a bare percentage (premortem M1). Passes are rows too — the five `IS_STUB` modules
are what correct looks like. Baseline: 3 unregistered, 4 silent-default, ≥7 defects.

---

## L-RL-2 — Onboarding gate (CI)

```yaml
type: loop
id: rl-onboarding-gate
owner: roster-lifecycle
measures: [roster.new_module_gate_pass_rate, roster.unregistered_module_count]
changes: [ci.agent_registration_check, roster.onboarding_checklist, roster.exclusion_register]
inputs_from: [engineering, ai-orchestration, agent-fleet]
outputs_to: [ai-orchestration, reliability-sre, decision-office]
close_time: per PR
status: proposed
```

A PR adding a file to `services/agent-orchestrator/agents/` must register it or add a
declared exclusion; a registered agent with no spec entry fails. The **only** loop here
that closes before the defect exists — everything else is detection. Counters premortem
M2, whose whole claim is that this never gets built once the backlog is empty. Therefore:
**ships in the same close-time as the first census fix, not after it.**

---

## L-RL-3 — Silent-default audit

```yaml
type: loop
id: rl-silent-default-audit
owner: roster-lifecycle
measures: [roster.silent_default_spec_count, roster.declared_stub_count, roster.empty_description_count]
changes: [agent_registry.register_from_defaults, agent_registry.default_specs]
inputs_from: [ai-orchestration, harness-runtime]
outputs_to: [ai-orchestration, decision-office]
close_time: weekly
status: proposed
```

Two checks that both target *indistinguishability*. (a) `DEFAULT_AGENT_SPECS.get(name, {})`
at `core/agent_registry.py:337` returns an empty dict silently for four registered agents
— the loop's real deliverable is making that **loud**, because fixing the four instances
without fixing the fallback fixes today only. (b) Every `IS_STUB = True` module is still
refused at boot (`core/orchestrator.py:245`) and every non-stub still implements
`process_message()`. Cheap proxy signal: any registry status whose `description` is `""`.
Counters premortem M3.

---

## L-RL-4 — Headcount reconciliation

```yaml
type: loop
id: rl-headcount-reconciliation
owner: roster-lifecycle
measures: [roster.headcount_claim_variance, roster.external_claim_corrections]
changes: [PROJECT.md, external.narrative_claims, roster.census_publication]
inputs_from: [roster-lifecycle, knowledge-documentation, strategy-fundraising]
outputs_to: [positioning-fundraise-readiness, standards-verification, decision-office]
close_time: monthly
status: proposed
```

Four numbers are live: **19** declared specs · **23** registered · **24**
([`.planning/PROJECT.md`](../../../../PROJECT.md):33, :121) · **26** on disk. The loop
tracks the *variance*, not one blessed figure, and it sweeps every artifact that quotes an
agent count. Escalates on the **first** disagreement that reaches external material
([[roster-lifecycle-directive]] rule 3), because
[[positioning-fundraise-readiness-charter]]'s primary metric is claim-to-evidence
coverage and a wrong headcount is a cheap claim to break.

---

## L-RL-5 — Fleet lifecycle review

```yaml
type: loop
id: rl-fleet-lifecycle-review
owner: roster-lifecycle
measures: [roster.maturity_level_evidenced_pct, roster.retirement_count, roster.unowned_module_count]
changes: [roster.maturity_levels, roster.retirements, roster.exclusion_register]
inputs_from: [performance-doneability, agent-fleet, ai-orchestration]
outputs_to: [people-agent-ops, ai-orchestration, decision-office]
close_time: quarterly
status: proposed
```

Re-evidences every agent's maturity level against its predicate, and asks the question no
other loop asks: **should this worker still exist?** `roster.retirement_count` is on this
loop deliberately — a year of zero retirements while registrations rise is premortem M5
made visible, and the loop is the only place that comparison is drawn. Quarterly, because
a level that changes monthly was not a level.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-RL-1 three-way census | daily | M1 — filename lists |
| L-RL-2 onboarding gate | per PR | M2 — the gate that never ships |
| L-RL-3 silent-default audit | weekly | M3 — registered-as-a-boolean |
| L-RL-4 headcount reconciliation | monthly | M1 — the number that leaves the building |
| L-RL-5 fleet lifecycle review | quarterly | M4, M5 — prose ladders, hiring over firing |

**One-way boundary, stated once.** [[ai-orchestration-charter]] and
[[harness-runtime-charter]] appear as `outputs_to` on the defect loops because we **file**
— they implement ports, harness changes and agent logic. They are `inputs_from` for the
facts. This team audits the record; it does not write the workers.
