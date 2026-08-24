---
type: loops
division: platform
department: data
team: synthetic-generation-simulation
status: provisional
metrics: [synthetic.backtest_fidelity_gap, synthetic.degrade_profile_coverage, synthetic.namespace_leak_count, synthetic.archetype_representativeness]
updated: 2026-08-24
links: ["[[synthetic-generation-simulation-charter]]", "[[synthetic-generation-simulation-premortem]]", "[[synthetic-generation-simulation-directive]]", "[[synthetic-generation-simulation-schedule]]", "[[data-loops]]", "[[annotation-ground-truth-loops]]", "[[state-integrity-invariants-charter]]", "[[LOOP-MAP]]"]
---

# Synthetic Generation & Simulation — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop ([[ORG_STRUCTURE]] §5).

Every loop here has the same shape: **force a comparison against something this team does not
control.** A simulator left alone always agrees with itself.

---

## 1. Backtest fidelity — the primary loop

```yaml
type: loop
id: backtest-fidelity
owner: synthetic-generation-simulation
measures: [synthetic.backtest_fidelity_gap]
changes: [docgen.degrade_profiles, synthetic.archetype_mix, docgen.compose_templates]
inputs_from: [annotation-ground-truth, research-math]
outputs_to: [research-math, agent-evaluation-gates, data]
close_time: monthly
status: proposed
```

Runs `scripts/docgen/backtest.py`: model score on `datasets/sim/documents` versus model score
on the real annotated gold set. **Closes when** a widening gap re-weights the degrade mix or
the archetype mix — not when it is written down as a caveat.

**Blocked today, and stated as blocked:** no baseline has ever been taken, and the loop has a
hard dependency on a *fresh* gold set ([[annotation-ground-truth-loops]] loop 1). Computing
fidelity against a stale oracle produces a wrong number, not a weak one.

---

## 2. Degrade-catalogue loop — imagination corrected by intake

```yaml
type: loop
id: degrade-profile-catalogue
owner: synthetic-generation-simulation
measures: [synthetic.degrade_profile_coverage, synthetic.unmodelled_failure_classes]
changes: [docgen.degrade_profiles]
inputs_from: [annotation-ground-truth, pos-operational-telemetry-ingest]
outputs_to: [data, research-math]
close_time: weekly
status: proposed
```

Every real document arriving through `datasets/annotation_inbox/` is classified for its
failure mode. **The histogram of what actually arrives is the spec for `degrade.py`.**
Imagination may add profiles; it may never define the set
([[synthetic-generation-simulation-premortem]] M1). A failure class we cannot produce is a
finding at the next close-time.

---

## 3. Namespace integrity — audited from outside

```yaml
type: loop
id: sim-namespace-integrity
owner: state-integrity-invariants
measures: [synthetic.namespace_leak_count, synthetic.teardown_residue_rows]
changes: [synth.write_guards, synth.teardown_procedure]
inputs_from: [synthetic-generation-simulation]
outputs_to: [synthetic-generation-simulation, data, security]
close_time: daily
status: proposed
```

**Note the owner: it is not this team.** Decision C31's `sim-` prefix
(`agents/drift_agent.py:4-6`) is asserted by [[state-integrity-invariants-charter]], because
this is the one mechanism here with an external victim and self-audit is exactly the failure
the department is organised against. Daily, because fabricated rows in a customer account
compound. Any non-zero value escalates the same day
([[synthetic-generation-simulation-directive]] escalation 1).

---

## 4. Archetype re-fit — the simulator corrected by the market

```yaml
type: loop
id: archetype-refit
owner: synthetic-generation-simulation
measures: [synthetic.archetype_representativeness, synthetic.out_of_range_customers]
changes: [synth.recipes, datasets.sim_archetypes, datasets.sim_manifest_version]
inputs_from: [pos-operational-telemetry-ingest, corpora-enrichment, sales]
outputs_to: [data, product-vision]
close_time: quarterly
status: proposed
```

Compares the archetype mix in `datasets/sim/archetypes` against the real customer mix — menu
size, price distribution, category spread, check patterns. **A real customer outside the
generated range mints or amends an archetype**; it is not logged as an outlier
([[synthetic-generation-simulation-premortem]] M4). `manifest.json` is versioned and
sha256-pinned (`pack_version 1.0.0`), so each re-fit is an auditable pack bump.

Quarterly rather than monthly, deliberately: re-fitting to every new customer would make the
simulator chase noise, and archetypes that change monthly are not archetypes.

---

## 5. Answer-key integrity — the cheapest loop here

```yaml
type: loop
id: truth-change-audit
owner: synthetic-generation-simulation
measures: [synthetic.truth_changes_by_cause]
changes: [docgen.truth]
inputs_from: [annotation-ground-truth]
outputs_to: [red-team, data]
close_time: monthly
status: proposed
```

Every `truth.py` change is classified by its stated cause — *generator changed*, *convention
changed*, *truth-emission bug*. **"Model disagreed" is not a permitted cause**
([[synthetic-generation-simulation-directive]] Gate 1). The measurement is the histogram: a
rising share of changes traceable to model disagreement is M5 in progress, and it is visible
in commit messages long before it is visible in a metric.

---

## Dependency note

```
annotation gold set (fresh) ──> loop 1 fidelity ──> is our synthetic data honest?
real intake documents ────────> loop 2 degrade ───> do we model real failures?
real customer data ───────────> loop 4 archetypes > do we model real restaurants?
external auditor ─────────────> loop 3 namespace ─> are we contaminating production?
```

Loops 1, 2 and 4 are all blocked or degraded if their external input stops arriving. Loop 3
is the only one whose owner is another unit — and it is the only one whose failure hurts
somebody outside this company.
