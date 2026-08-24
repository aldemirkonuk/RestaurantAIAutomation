---
type: loops
division: research-math
department: research-math
team: evaluation-doneability
status: provisional
metrics: [nf_a.verified_task_success_rate, nf_a.verdict_coverage, identity.false_merge_count]
updated: 2026-08-24
links: ["[[evaluation-doneability-charter]]", "[[evaluation-doneability-directive]]", "[[evaluation-doneability-schedule]]", "[[research-math-loops]]", "[[harness-model-routing-loops]]", "[[neural-footprint-instrumentation-loops]]", "[[aio-evaluation-gates]]", "[[security-charter]]", "[[skills-charter]]", "[[decision-office-charter]]"]
loop_count: 7
loop_count: 7
loop_ids: ["verified-vs-self-reported-gap", "golden-set-provenance", "weekly-ci-eval", "identity-false-merge-gate", "bakeoff-pass-conditions", "skill-health-antisprawl", "evaluation-seam-audit"]
loop_close_times: ["weekly", "per-set at creation, reviewed monthly", "weekly", "per-PR (CI), reviewed weekly", "before each bake-off; audited quarterly", "weekly", "monthly, terminating in a ruling"]
loop_statuses: ["proposed", "proposed", "proposed", "live", "proposed", "proposed", "proposed"]
---

# Evaluation & Doneability (RM-2) — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop ([[ORG_STRUCTURE]] §5).

---

## ED-1 — The honesty gap

The team's flagship loop. What it publishes is not a score; it is a **difference**.

```yaml
type: loop
id: verified-vs-self-reported-gap
owner: research-math/evaluation-doneability
measures: [nf_a.verified_task_success_rate, nf_a.self_reported_success_rate, nf_a.verdict_coverage]
changes: [eval.criteria, eval.golden_sets, agent.doneability_definition]
inputs_from: [neural-footprint-instrumentation, ai-orchestration, engineering]
outputs_to: [harness-model-routing, ai-orchestration, engineering, product-and-vision]
close_time: weekly
status: proposed
baseline: "verified: unmeasured · self-reported: computed at base_agent.py:144, where success means the handler did not raise · gap: never computed"
publishing_rule: "verified never publishes alone"
```

**Trip condition.** The gap narrows for two consecutive close-times with **no** change to
harness or criteria → the auditor is drifting toward the author
([[evaluation-doneability-premortem]] M1). Escalate rather than celebrate.

---

## ED-2 — Golden-set provenance

Not a metric loop — a **standards** loop. It is here because M1 and M4 both die on this
one field.

```yaml
type: loop
id: golden-set-provenance
owner: research-math/evaluation-doneability
measures: [golden_sets_with_free_negatives, golden_sets_imagination_only, share_of_model_spend_under_verdict]
changes: [eval.manifest_schema, eval.gate_authority]
inputs_from: [security, engineering, data]
outputs_to: [ai-orchestration, decision-office]
close_time: per-set at creation, reviewed monthly
status: proposed
rule: "provenance: free-negatives | imagination-only. Only free-negatives may block a merge."
exemplars:
  - "beverage identity — 732,874 free known-distinct pairs; killed 3 designs, one with 212 false merges (eval_guest_merge_policies.py:4-9)"
  - "guest identity — co-presence via guest_check_links / guest_copresence_negatives; pass condition exactly zero because a false merge is a disclosure (:28-32)"
coverage_metric: "share of production model SPEND under a verdict — not a count of suites"
```

**Trip condition.** A third set proposed and all three are extraction → M4. Coverage
measured in spend, not suites, is what makes that trip visible.

---

## ED-3 — The weekly CI eval, and its cost

```yaml
type: loop
id: weekly-ci-eval
owner: research-math/evaluation-doneability
measures: [eval_suite_cost_usd, regressions_caught, eval_runtime_minutes]
changes: [ci.gates, eval.tiering]
inputs_from: [harness-model-routing, ai-orchestration]
outputs_to: [engineering, ai-orchestration, decision-office]
close_time: weekly
status: proposed
spec: "v3.0-TECH-DEBT.md:326-330 (§44.11) — golden datasets + weekly CI evals with cost caps; depends only on Phase 37, satisfied, so plannable now"
reserved_slot: ".github/workflows/e2e-prod.yml:9 — a weekly AI eval workflow is reserved and unbuilt"
cost_cap: "UNNAMED — founder number required before the suite ships"
tiering: "cheap subset per-PR, full run weekly — cost pressure degrades coverage, it never switches the gate off"
escalation: "overrun escalates; it does not self-resolve into a disable"
```

**Trip condition.** Any month with cost above the cap, or any proposal to disable → founder
decision, recorded. A **catch log** runs alongside: each regression blocked, with the cost
of what it prevented, so renewal has two numbers instead of one.

---

## ED-4 — Hard identity gates (inherited, live today)

The only loop in this department that is already running in production.

```yaml
type: loop
id: identity-false-merge-gate
owner: research-math/evaluation-doneability
measures: [identity.false_merge_count, guest.false_merge_count]
changes: [identity.merge_policy, guest.merge_policy]
inputs_from: [engineering, data, guest-experience]
outputs_to: [engineering, security, compliance-and-privacy]
close_time: per-PR (CI), reviewed weekly
status: live
pass_condition: "exactly zero — never a threshold, never summed with false splits (eval_merge_policies.py:5-13)"
rationale: "a false bottle merge is a bounded data-quality error; a false guest merge is a DISCLOSURE and no un-merge reverses it (eval_guest_merge_policies.py:28-32)"
note: "the guest gate reports 0 pairs today because guest capture has not started — that is the gate working, not idle"
```

---

## ED-5 — Pass conditions for RM-1

The author≠auditor rule, expressed as a loop with an ordering constraint.

```yaml
type: loop
id: bakeoff-pass-conditions
owner: research-math/evaluation-doneability
measures: [pass_conditions_committed_before_results, pass_condition_edits_near_release]
changes: [eval.pass_conditions, bakeoff.admissibility]
inputs_from: [harness-model-routing]
outputs_to: [harness-model-routing, decision-office]
close_time: "before each bake-off; audited quarterly"
status: proposed
invariant: "pass_conditions_committed_before_results = always true; a violation invalidates the bake-off"
watch: "any pass-condition edit whose commit message names a date, a launch, or a release — escalate on the FIRST"
```

---

## ED-6 — Skill-layer anti-sprawl

```yaml
type: loop
id: skill-health-antisprawl
owner: research-math/evaluation-doneability
measures: [skills_registered, skills_unfired_30d, skills_overlapping]
changes: [skills.registry, skills.retirement]
inputs_from: [skills, ai-orchestration]
outputs_to: [skills, decision-office]
close_time: weekly
status: proposed
baseline: "1 project skill in the repo (.agents/skills/railway-config/SKILL.md)"
rule: "a skill unfired for 30 days is reviewed for deletion (README §3.3)"
activation_trigger: "~15 skills, or the first two skills found to overlap in production"
note: "runs weekly at near-zero cost before it is needed — same reasoning that shipped eval_guest_merge_policies.py before its data"
```

---

## ED-7 — Duplication audit vs [[aio-evaluation-gates]]

```yaml
type: loop
id: evaluation-seam-audit
owner: research-math/evaluation-doneability
measures: [duplicated_golden_sets, duplicated_thresholds]
changes: [team.boundaries, team.merge_proposals]
inputs_from: [ai-orchestration]
outputs_to: [decision-office, ai-orchestration]
close_time: monthly, terminating in a ruling
status: proposed
rule: "if either unit maintains an artifact the other also maintains, RM-2 files the merge proposal itself (technology.md:406)"
tell: "a threshold that exists in two places with two values"
```
