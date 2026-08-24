---
type: loops
division: applied-ai
department: ai-orchestration
team: action-safety-the-human-gate
status: partial
metrics: [safety.unconfirmed_mutation_count, safety.median_time_to_confirm, safety.rejection_rate]
updated: 2026-08-24
links: ["[[action-safety-the-human-gate-charter]]", "[[action-safety-the-human-gate-premortem]]", "[[action-safety-the-human-gate-directive]]", "[[action-safety-the-human-gate-schedule]]", "[[ai-orchestration-loops]]", "[[design-charter]]", "[[compliance-privacy-charter|compliance-and-privacy-charter]]", "[[red-team-charter]]", "[[LOOP-MAP]]"]
loop_count: 6
loop_count: 6
loop_count: 6
loop_ids: ["loop-unconfirmed-mutation", "loop-gate-integrity", "loop-attention-budget", "loop-action-schema-coverage", "loop-allowlist-drift", "loop-audit-reconstructability"]
loop_close_times: ["daily", "monthly", "monthly", "per-commit (CI gate), reviewed monthly", "quarterly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Action Safety & the Human Gate — Loops

Every loop names its close-time.

> **Two different kinds of loop live here, and conflating them is a mistake.**
> Loop 1 measures a **violation count** — it is a tripwire, and its correct value is
> always zero. Loops 2 and 3 measure **human behaviour** — they are trend lines, and
> they are the reason this is a team rather than a lint rule.

---

## 1. The tripwire

```yaml
type: loop
id: loop-unconfirmed-mutation
owner: ai-orchestration
team: action-safety-the-human-gate
measures: [safety.unconfirmed_mutation_count]
changes: [incident.raised, action.schema_coverage]
inputs_from: [engineering, harness-runtime, agent-fleet]
outputs_to: [decision-office, compliance-and-privacy, red-team]
close_time: daily
status: proposed
target: hard zero
rule: "Any non-zero value is a REPORTABLE INCIDENT, not a bug (technology.md:443-445). This is not a trend line and must never be plotted as one — a chart implies an acceptable range, and there isn't one."
scope: "Any agent-initiated write to stock, money, or an outbound channel with no recorded human confirmation."
anti_sprawl_exemption: "Zero findings is this loop's SUCCESS condition. Exempt from the 3-runs-no-action deletion rule (README §6). A safety scan deleted for finding nothing is the premortem writing itself."
```

## 2. Gate integrity — the loop that measures a habit

```yaml
type: loop
id: loop-gate-integrity
owner: ai-orchestration
team: action-safety-the-human-gate
measures: [safety.median_time_to_confirm, safety.time_to_confirm_distribution, safety.rejection_rate]
changes: [action.autonomy_tier, action.friction_floor, action.family_batching]
inputs_from: [design, product-and-vision]
outputs_to: [design, ai-orchestration, red-team]
close_time: monthly
status: proposed
blocked_by: nothing — one-tap-actions.service.ts:245-246 already writes executed_at; row creation is the other end. This is a QUERY, not a feature.
signal: "Watch the DISTRIBUTION, not the median. A healthy gate has a long tail: most confirmations fast, some slow, because some were actually thought about. A spike near zero with no tail is approval-as-reflex. Paired signal: rejection_rate approaching zero — a gate that never rejects anything is not gating."
urgency: "Instrument BEFORE the volume arrives. Retrofitting after the habit forms measures the habit, not the gate. Today's low volume is what makes today the only cheap time to set a baseline — premortem #1."
```

## 3. Attention budget

```yaml
type: loop
id: loop-attention-budget
owner: ai-orchestration
team: action-safety-the-human-gate
measures: [safety.confirmations_per_user_per_day, safety.confirmations_by_family]
changes: [action.autonomy_tier, action.batching, action.allowlist]
inputs_from: [product-and-vision, design]
outputs_to: [design, product-and-vision]
close_time: monthly
status: proposed
premise: "Fifty confirmations a day is the disease; five is a gate. Tiering is ATTENTION BUDGETING, not caution — navigation assist and calendar drafts must not compete for the same attention as a purchase order."
rule: "When confirmations-per-day rises, the response is to tier low-stakes families DOWN, never to lower friction on money and stock."
```

## 4. Schema coverage

```yaml
type: loop
id: loop-action-schema-coverage
owner: ai-orchestration
team: action-safety-the-human-gate
measures: [safety.schema_coverage, safety.mutation_paths_outside_schema]
changes: [action.schema, ci.gates]
inputs_from: [engineering, agent-fleet]
outputs_to: [engineering, ai-orchestration]
close_time: per-commit (CI gate), reviewed monthly
status: proposed
today: "Partial by construction — FOUR independent conventions, not one mechanism (technology.md:441): drift_agent.py:8-12, one-tap-actions/, vendor-reply never-auto-send, ux-optimizer never-auto-apply."
mechanism: "scripts/check_no_direct_stock_writes.sh:1-13 proves the CI-guard pattern works in this repo and is already wired into ci.yml. The new check asks a DIFFERENT question about the same code: not 'did this write go through apply_stock_movement' but 'is there a confirmation record upstream of this mutation'."
anti_sprawl_exemption: "A recurrence guard. Silence is success. Exempt."
```

## 5. Allowlist drift

```yaml
type: loop
id: loop-allowlist-drift
owner: ai-orchestration
team: action-safety-the-human-gate
measures: [safety.allowlist_additions, safety.allowlist_removals, safety.families_unused_90d]
changes: [action.allowlist, action.autonomy_tier]
inputs_from: [product-and-vision, compliance-and-privacy, legal]
outputs_to: [decision-office, product-and-vision]
close_time: quarterly
status: proposed
rule: "Every addition names what it would take to remove it. The five hard-gated families of FUTURES.md §8.2 — mass deletes, changing billing, granting permissions, sending email without draft review, guest PII exports — require an ADR to move at all."
signal: "A quarter with additions and zero removals. An allowlist that only grows is a feature list with a safety-sounding name — premortem #4. Same shape as skills.deletions_per_quarter."
also: "families_unused_90d — an allowlisted family nobody uses is pure risk with no benefit."
```

## 6. Audit reconstructability

```yaml
type: loop
id: loop-audit-reconstructability
owner: ai-orchestration
team: action-safety-the-human-gate
measures: [safety.confirmations_with_proposal_snapshot_pct]
changes: [audit.schema, action.confirmation_record]
inputs_from: [research-and-math]
outputs_to: [compliance-and-privacy, legal, red-team]
close_time: monthly
status: proposed
blocked_by: "NF-A schema — the snapshot is a neural-footprint record in all but name"
question_it_must_answer: "Not 'who clicked' — one-tap-actions.service.ts:245-246 already answers that — but 'WHAT WERE THEY SHOWN when they clicked': the rendered summary, the model and prompt version, the confidence, the facts retrieved."
existing_pattern: "drift_agent.py:17 — 'Every run and every finding writes a decision_log row.' The pattern exists in the repo; it just does not extend to the moment that matters most."
nf_link: "README §4.1 defines a neural footprint as 'enough signal to model WHY it chose what it chose, not merely what it chose.' A confirmation without its proposal context is a footprint with the reasoning cut out."
```

---

## What this team hands to other loops

| To | Signal | Close-time |
|---|---|---|
| [[design-charter]] | `time_to_confirm` distribution; confirmations per user per day | monthly — the surface and the friction floor are different decisions with different owners |
| [[compliance-privacy-charter|compliance-and-privacy-charter]] | Allowlist state; guest-PII family status; audit reconstructability | quarterly |
| [[red-team-charter]] | Everything in loops 2 and 6 — **the attack surface is the reflex, not the bypass** | on request |
| [[ai-orchestration-loops]] | `unconfirmed_mutation_count` for the department board | daily |
