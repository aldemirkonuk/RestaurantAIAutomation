---
type: schedule
division: platform
department: data
team: synthetic-generation-simulation
status: provisional
metrics: [synthetic.backtest_fidelity_gap, synthetic.degrade_profile_coverage, synthetic.namespace_leak_count]
updated: 2026-08-24
links: ["[[synthetic-generation-simulation-charter]]", "[[synthetic-generation-simulation-loops]]", "[[synthetic-generation-simulation-directive]]", "[[data-schedule]]", "[[state-integrity-invariants-charter]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[README]]"]
---

# Synthetic Generation & Simulation — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Daily | **Namespace leak assertion** — run by [[state-integrity-invariants-charter]], not by us | `synthetic.namespace_leak_count` (target zero) |
| Daily | Post-`teardown.py` residue check on any sim write set created that day | `synthetic.teardown_residue_rows` |
| Weekly | Degrade-catalogue pass — classify new `annotation_inbox` documents by failure mode | `synthetic.degrade_profile_coverage`; unmodelled-class findings |
| Weekly | E2E harness run (`scripts/e2e_crawl_harness.py`, `e2e_restaurants.json`) | Pass/fail per synthetic restaurant |
| Monthly | **Backtest fidelity** — `scripts/docgen/backtest.py` vs. the real annotated gold set | `synthetic.backtest_fidelity_gap` |
| Monthly | `truth.py` change audit by stated cause | `synthetic.truth_changes_by_cause` |
| Quarterly | Archetype re-fit against real customer data; bump `manifest.json` pack version | `synthetic.archetype_representativeness` |
| Quarterly | Sim pack integrity — verify sha256 pins in `datasets/sim/manifest.json` | Pack verification report |

**Anti-sprawl ([[README]] §6):** a job producing no action for 3 consecutive runs is
downgraded or deleted. Two candidates and their honest fates:

- **The daily leak assertion should never be downgraded even when it produces no action.**
  It is an invariant check, not a report — a green invariant *is* its action, and the rule
  exists to kill reports nobody reads, not assertions nobody trips. Recorded here so the
  anti-sprawl rule is not applied mechanically to the one check with an external victim.
- **The weekly E2E harness run** is the real downgrade candidate: if it passes for three
  months without ever catching a regression, it belongs in CI on-change rather than on a
  schedule.

## Skills owned

**None today.** `.claude/skills/` does not exist in this repo; the only project skill is
`.agents/skills/railway-config/SKILL.md` ([[README]] §3.1). Proposals below, against the
§3.3 protocol.

| Skill | Tier | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|---|
| `synth-restaurant-seed` | T1 Domain | A test, demo or eval run needs a populated restaurant | Restaurant created with `sim-` slug, write set recorded by `write_set.py`, teardown reference returned in the same call | `scripts/synth/{recipes,seed,write_set,teardown,ids}.py` — already used to build `datasets/sim/archetypes` and `e2e_restaurants.json` |
| `docgen-batch` | T1 Domain | A scanner needs regression or rare-case document volume | Documents emitted **with** their `truth.py` answer key and a degrade profile drawn from the real catalogue; `source_guarantee = synthetic` on every row | `scripts/docgen/{compose,degrade,truth,render,houses}.py`; `datasets/sim/documents` |
| `synthetic-backtest` | T3 Operational | Any model, prompt or generator change, before it is trusted | Fidelity gap published against the **real** gold set; a widened gap opens a degrade/archetype re-weight item, not a caveat | `scripts/docgen/backtest.py` — exists, has not yet been run to a published baseline |
| `sim-teardown-verify` | T3 Operational | Immediately after any `teardown.py` run | Created-row count asserted back to zero; residue published rather than discarded | `scripts/synth/teardown.py` + decision C31 (`agents/drift_agent.py:4-6`) |

**Ownership note on the fourth skill.** `sim-teardown-verify` is authored here but its
*assertion* is consumed by [[state-integrity-invariants-charter]]. This team writes the
check; another unit is accountable for the verdict. That split is deliberate and matches
[[synthetic-generation-simulation-loops]] loop 3.

**Not proposed, deliberately:** a `promote-synthetic-to-gold` convenience skill, in any form.
It would make [[annotation-ground-truth-premortem]] M5 a single keystroke, and the whole
department's provenance invariant depends on that path staying inconvenient.

**Anti-sprawl:** a skill unfired for 30 days is reviewed for deletion ([[README]] §3.3), by
[[skill-lifecycle-anti-sprawl-charter]] rather than by this team.
