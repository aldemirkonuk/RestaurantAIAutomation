---
type: loops
division: product
department: product-vision
team: inbound-understanding
status: provisional
metrics: [inbound.proposal_accept_without_edit_rate, inbound.false_accept_count]
updated: 2026-08-24
links: ["[[inbound-understanding-charter]]", "[[inbound-understanding-directive]]", "[[inbound-understanding-premortem]]", "[[inbound-understanding-schedule]]", "[[product-vision-loops]]", "[[connector-platform-trust-charter]]", "[[ask-ai-loops]]"]
loop_count: 6
loop_count: 6
loop_ids: ["inbound-proposal-quality", "inbound-rubber-stamp-detection", "inbound-corpus-drift", "inbound-contract-conformance", "inbound-input-trust", "inbound-askai-confirm-parity"]
loop_close_times: ["weekly", "weekly", "monthly", "weekly", "weekly", "monthly"]
loop_statuses: ["blocked", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Inbound Understanding — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L1 — Proposal quality loop (the team's spine)

```yaml
type: loop
id: inbound-proposal-quality
owner: product-vision
team: inbound-understanding
measures: [inbound.proposal_accept_without_edit_rate, inbound.false_accept_count]
changes: [guardrail.confidence_threshold, guardrail.field_surfacing_order, guardrail.fast_path_eligibility]
inputs_from: [engineering, data, ai-orchestration]
outputs_to: [engineering, ai-orchestration, research-math]
close_time: weekly
status: blocked
blocked_on: "no correction path exists, so false_accept_count cannot be read; per the pairing rule neither number is published"
unblocked_by: "joining a downstream edit (quantity, SKU identity, total) back to the proposal that created it"
baseline: "both unmeasured, all three modules"
```

The loop is deliberately **blocked rather than half-run**. Publishing acceptance alone
would satisfy the cadence and destroy the metric ([[inbound-understanding-premortem]] M1).

---

## L2 — Rubber-stamp detection loop

```yaml
type: loop
id: inbound-rubber-stamp-detection
owner: product-vision
team: inbound-understanding
measures: [inbound.p50_time_to_approve_seconds, inbound.sampled_high_confidence_disagreement_rate, inbound.approval_rate_by_document_type]
changes: [guardrail.sampling_rate, guardrail.field_surfacing_order]
inputs_from: [design, engineering]
outputs_to: [design, product-vision]
close_time: weekly
status: proposed
baseline: "sampling not running; p50 approve time unmeasured"
```

This loop can run **before** L1 unblocks, and that is its point: deliberate sampling of
high-confidence proposals is the only honest read on false accepts while the correction
path is being built. Disagreement on the sample is the leading indicator; p50 approval
latency below plausible reading time is the alarm.

---

## L3 — Corpus-drift loop

```yaml
type: loop
id: inbound-corpus-drift
owner: product-vision
team: inbound-understanding
measures: [inbound.distinct_vendor_formats, inbound.held_out_set_accuracy, inbound.tuned_set_accuracy]
changes: [backtest.held_out_set, guardrail.confidence_threshold]
inputs_from: [data, supplier-distributor-network]
outputs_to: [engineering, research-math]
close_time: monthly
status: proposed
baseline: "invoice-match.backtest.spec.ts runs on the tuned corpus; held-out set does not exist"
```

The tell for M1 is **held-out accuracy diverging from tuned accuracy** while acceptance
stays flat or rises. Measuring only one of the two makes the divergence invisible, which is
exactly how a cost basis goes wrong quietly.

---

## L4 — Contract conformance loop

```yaml
type: loop
id: inbound-contract-conformance
owner: product-vision
team: inbound-understanding
measures: [inbound.threshold_constants_outside_contract, inbound.approval_primitives_in_use]
changes: [guardrail.contract_version, ci.inbound_gate_conformance]
inputs_from: [engineering]
outputs_to: [engineering, product-vision]
close_time: weekly
status: proposed
baseline: "constants: unknown (no check exists). approval primitives: target 1 — apps/api-gateway/src/one-tap-actions/"
```

A grep-shaped CI check, and honest about being one. It catches a second free-standing
threshold constant, which is M2's earliest signal. It does **not** catch a threshold
computed dynamically — so its outcome-side twin is L1's false-accept count, per the
house rule that a grep-guard is never the only thing
([[engineering-premortem]] M4).

---

## L5 — Input-trust escalation loop

```yaml
type: loop
id: inbound-input-trust
owner: product-vision
team: inbound-understanding
measures: [integration.verified_signature_coverage, inbound.unverified_proposal_share]
changes: [guardrail.unverified_marking_rule, escalation.od_19]
inputs_from: [connector-platform-trust, security]
outputs_to: [connector-platform-trust, security, decision-office]
close_time: weekly
status: proposed
baseline: "0 of 32 webhook routes verify signatures; 100% of inbound email proposals are unverified"
```

This team cannot close this loop — [[connector-platform-trust-charter]] and
[[security-charter]] own the fix. What this team owns is **keeping it loud**: the figure is
restated at every close-time and escalates when unchanged. A dependency nobody repeats
becomes an assumption nobody wrote down ([[inbound-understanding-premortem]] M4).

---

## L6 — Shared-primitive loop with Ask AI

```yaml
type: loop
id: inbound-askai-confirm-parity
owner: product-vision
team: inbound-understanding
measures: [product.confirm_primitives_in_use]
changes: [confirm.card_spec]
inputs_from: [ask-ai, design]
outputs_to: [ask-ai, design, engineering]
close_time: monthly
status: proposed
baseline: "1 primitive exists (one-tap-actions); ask-ai composer not built, so divergence has not happened yet"
```

Two teams inventing two confirm cards is how the product gets three approval UXs by a
different route than premortem M2 predicts. Cheapest to prevent now, while
[[ask-ai-charter]]'s composer is still a schema.
