---
type: loops
division: applied-ai
department: ai-orchestration
team: agent-evaluation-gates
status: partial
metrics: [nf_a.doneability_verdict_coverage]
updated: 2026-08-24
links: ["[[agent-evaluation-gates-charter]]", "[[agent-evaluation-gates-premortem]]", "[[agent-evaluation-gates-directive]]", "[[agent-evaluation-gates-schedule]]", "[[ai-orchestration-loops]]", "[[agent-fleet-loops]]", "[[model-routing-inference-economics-loops]]", "[[research-math-charter|research-and-math-charter]]", "[[decision-office-charter]]", "[[LOOP-MAP]]"]
loop_count: 6
loop_count: 6
loop_count: 6
loop_ids: ["loop-merge-policy-gate", "loop-eval-coverage", "loop-judgment-rubric", "loop-gold-set-freshness", "loop-confidence-calibration", "loop-evaluation-seam"]
loop_close_times: ["per-commit", "weekly", "monthly", "monthly", "quarterly", "on second occurrence — not a cadence"]
loop_statuses: ["active", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Agent Evaluation & Gates — Loops

Every loop names its close-time.

> Loop 1 is the only **active** loop in the entire AI Orchestration department. It is
> also the template — a labelled set rebuilt from a committed corpus, a hard verdict,
> a per-commit close-time, and no hand-labelling. Every other loop here should be built
> in its shape rather than invented.

---

## 1. The merge-policy gate — active

```yaml
type: loop
id: loop-merge-policy-gate
owner: ai-orchestration
team: agent-evaluation-gates
measures: [identity.false_merge_count]
changes: [merge_policy, ci.gate_result]
inputs_from: [engineering, data]
outputs_to: [engineering, research-and-math]
close_time: per-commit
status: active
evidence: ".github/workflows/ci.yml:226-230 rebuilds the labelled set (scripts/build_merge_eval_set.py) then runs scripts/eval_merge_policies.py. schema-parity.yml:149 runs the guest variant."
verdict: "eval_merge_policies.py:9-16 — 'the false-merge count of the PROPOSED policy alone is the pass/fail signal… Exits 1 iff the proposed policy has any false merge.'"
self_growing: "'Every new menu added to datasets/menu_corpus/extracted strengthens this gate automatically; nobody hand-labels anything.' This is the property every other gate must declare at authoring time."
asymmetry: "False merges and false splits 'are not symmetric and must never be summed into one score.' The gate refuses to average two incommensurable errors — the same refusal the department applies to its metric set."
```

## 2. Coverage — the loop that must never aggregate

```yaml
type: loop
id: loop-eval-coverage
owner: ai-orchestration
team: agent-evaluation-gates
measures: [nf_a.doneability_verdict_coverage, eval.families_with_zero_coverage]
changes: [eval.gold_sets, eval.rubrics, ci.gates]
inputs_from: [research-and-math, agent-fleet]
outputs_to: [ai-orchestration, research-and-math, model-routing-inference-economics]
close_time: weekly
status: proposed
blocked_by: "NF-A not emitted for production task families"
rule: "PER TASK FAMILY, never as one number, with the zero rows NAMED on the board rather than omitted. An aggregate reads as a plausible percentage and hides exactly the families that matter — premortem #1."
today: "Five families at zero: vendor reply quality, negotiation stance, recommendation usefulness, invoice field accuracy in production, menu parse accuracy in production."
```

## 3. Judgment-task rubric — the hard one, started deliberately badly

```yaml
type: loop
id: loop-judgment-rubric
owner: ai-orchestration
team: agent-evaluation-gates
methodology_owner: research-and-math
measures: [eval.rubric_inter_rater_agreement, judgment.family_coverage]
changes: [eval.rubrics, agent.prompt]
inputs_from: [research-and-math, agent-fleet, product-and-vision]
outputs_to: [agent-fleet, ai-orchestration]
close_time: monthly
status: proposed
blocked_by: "methodology from research-and-math"
label_source: "Vendor-reply drafts are never auto-sent (project memory: autonomous-email-replies), so a human approves, edits, or discards EVERY draft today. Those decisions are labels and they are currently discarded. Capturing them is unblocked and is the precondition that decides whether the rubric takes a month or six."
rule: "Start at n≈30 with two raters and a measured disagreement rate. A rubric with 30 samples and known disagreement beats a 10,000-row metric of the wrong thing. Low n is acceptable; zero coverage is not."
```

## 4. Gold-set freshness

```yaml
type: loop
id: loop-gold-set-freshness
owner: ai-orchestration
team: agent-evaluation-gates
measures: [eval.gold_set_staleness, eval.sets_without_growth_mechanism]
changes: [eval.gold_sets, gate.status]
inputs_from: [data, engineering]
outputs_to: [agent-evaluation-gates]
close_time: monthly
status: proposed
blocked_by: nothing — staleness is computable from git history today
today: "services/active_learning_service.py:1-17 describes '200 gold-standard documents for regression testing'. datasets/ocr_benchmark_results.json is a single captured run. Neither declares a growth mechanism."
rule: "Every gate declares AT AUTHORING TIME how its set grows from production traffic. A set that cannot grow is a snapshot and must be labelled one, with a refresh owner and a date — premortem #4."
```

## 5. Confidence calibration

```yaml
type: loop
id: loop-confidence-calibration
owner: ai-orchestration
team: agent-evaluation-gates
measures: [confidence.calibration_error, confidence.thresholds_gating_autonomy]
changes: [confidence.thresholds, governance.tier_boundaries]
inputs_from: [research-and-math]
outputs_to: [action-safety-the-human-gate, agent-fleet]
close_time: quarterly
status: proposed
blocked_by: "NF-A paired confidence/outcome data"
scope: "services/quality_scorer.py, services/field_confidence.py, governance.py:227 compute_overall_confidence, governance.py:20 GovernanceTier (CANONICAL → UNRESOLVED)."
interim_rule: "An uncalibrated confidence score is a SORT KEY, not a threshold. It may order a review queue; it may not decide whether a human sees something. Same two-key discipline model-routing applies to cost: an unvalidated number may inform a decision, never make one."
```

## 6. The seam — a decision loop, deliberately the odd one out

```yaml
type: loop
id: loop-evaluation-seam
owner: ai-orchestration
team: agent-evaluation-gates
counterpart: research-and-math
measures: [seam.occurrences_of_this_team_defining, seam.duplicate_definitions]
changes: [org.team_existence]
inputs_from: [research-and-math]
outputs_to: [decision-office]
close_time: on second occurrence — not a cadence
status: proposed
threshold: "1 = coordination miss. 2 = the methodology/operations line has failed."
resolution: "Merge this team into research-and-math. NEVER build it in both places. technology.md:406, technology.md:845."
blocker: "⚠️ The fork has no usable ID. technology.md:845 numbers it OD-21; OPEN-DECISIONS.md:25 already spends OD-21 on the Obsidian structural workflow. A fork that cannot be cited cannot be closed."
```

---

## What this team hands to other loops

| To | Signal | Close-time |
|---|---|---|
| [[model-routing-inference-economics-loops]] | The pass verdict — key two of the two-key gate | per-PR |
| [[agent-fleet-loops]] | Task families that regressed; families with no coverage to gate a prompt change | weekly |
| [[research-math-charter|research-and-math-charter]] | Every place operations needed a definition that did not exist | weekly |
| [[ai-orchestration-loops]] | `doneability_verdict_coverage`, per family | weekly |
| [[decision-office-charter]] | Seam occurrence count | on event |
