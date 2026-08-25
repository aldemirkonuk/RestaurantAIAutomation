---
type: loops
division: research-math
department: research-math
team: neural-footprint-instrumentation
status: provisional
metrics: [nf_a.event_completeness, nf.private_telemetry_tables, nf_b.identifier_coverage]
updated: 2026-08-24
links: ["[[neural-footprint-instrumentation-charter]]", "[[neural-footprint-instrumentation-directive]]", "[[neural-footprint-instrumentation-schedule]]", "[[research-math-loops]]", "[[harness-model-routing-loops]]", "[[evaluation-doneability-loops]]", "[[data-charter]]", "[[security-charter]]", "[[analytics-bi-charter]]", "[[guest-experience-charter]]", "[[decision-office-charter]]"]
loop_count: 7
loop_ids: ["nf-a-event-completeness", "nf-join-key", "private-telemetry-containment", "nf-schema-contract-od11", "spend-reconciliation", "unauthenticated-inference-spend-feed", "nf-b-contract-and-nf-c-gate"]
loop_close_times: ["weekly", "weekly", "weekly", "fortnightly", "monthly", "weekly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Neural Footprint Instrumentation (RM-3) — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop ([[ORG_STRUCTURE]] §5).

---

## NF-1 — Event completeness

```yaml
type: loop
id: nf-a-event-completeness
owner: research-math/neural-footprint-instrumentation
measures: [nf_a.event_completeness, callsites_emitting, suppressed_emissions]
changes: [nf.event_contract, nf.emission_points, spend_logger.signature]
inputs_from: [harness-model-routing, ai-orchestration, engineering]
outputs_to: [evaluation-doneability, harness-model-routing, security, analytics-bi]
close_time: weekly
status: proposed
baseline: "0% NestJS (0 grep hits for api_spend|cost_usd|input_tokens in apps/api-gateway/src); Python partial across 2 unjoined tables; max 4 of 8 fields on any row"
definition: "all eight NF-A fields on one joinable row, or the event is incomplete — six of eight is not 75%"
denominator: "model calls ATTEMPTED, known at the wrapper — never events written"
first_action: "SpendLogger.log() gains an `agent` parameter (spend_logger.py:41-48); api_spend gains the column"
```

**Trip condition.** Completeness rising while `internal_state` is null on every event →
the cheap fields are crowding out the expensive one
([[neural-footprint-instrumentation-premortem]] M3).

---

## NF-2 — The join key, ahead of the schema

Deliberately a separate loop from NF-1, because it must not wait on OD-11.

```yaml
type: loop
id: nf-join-key
owner: research-math/neural-footprint-instrumentation
measures: [joinable_row_pairs, tables_carrying_correlation_id]
changes: [api_spend.correlation_id, decision_log.linkage]
inputs_from: [ai-orchestration, data]
outputs_to: [evaluation-doneability, harness-model-routing, security]
close_time: weekly
close_time_note: "2 weeks one-shot, then verified weekly"
status: proposed
rationale: "correlation_id already exists at base_agent.py:743-784. Two tables that can be joined are one footprint with a bad shape; two that cannot are two footprints."
```

---

## NF-3 — Private-telemetry containment

The freeze-with-an-escape-hatch, expressed as a loop.

```yaml
type: loop
id: private-telemetry-containment
owner: research-math/neural-footprint-instrumentation
measures: [nf.private_telemetry_tables, undated_temporary_tables]
changes: [nf.event_contract, table.fold_in_dates]
inputs_from: [engineering, data, analytics-bi, ai-orchestration]
outputs_to: [decision-office, data]
close_time: weekly
status: proposed
baseline: "1 (api_spend). 2 is the alarm."
rule: "temporary is allowed; UNDATED temporary is not. No new telemetry table lands without a dated fold-in line here."
escalation: "a second table holding token counts → same-day escalation"
```

---

## NF-4 — The OD-11 contract (cross-boundary: Data)

```yaml
type: loop
id: nf-schema-contract-od11
owner: research-math/neural-footprint-instrumentation
measures: [contract_fields_agreed, both_owners_named, research_store_shipped]
changes: [nf.production_columns, nf.partial_indexes, nf.retention_policy, nf.subject_type_vocabulary]
inputs_from: [data, analytics-bi, security, guest-experience]
outputs_to: [data, engineering, decision-office]
close_time: fortnightly
close_time_note: "fortnightly until OD-11 closes"
status: proposed
blocks: [OD-11]
contract: "RM-3 owns the schema contract; Data owns the physical table and migration (intelligence.md:486). OD-11 must name both owners or it is implemented twice."
must_produce_two: "narrow polymorphic production store AND wide append-only research store — same change, even if month one they duplicate (0006-neural-footprint-architecture)"
carries: "fork INTEL-F3 — decided IN this session, not after it"
needs_from_founder: [retention_horizon, internal_state_required, f3_ruling]
```

**Trip condition.** A session output with a production column list and no research-log
shape → premortem M4, and the founder's compensation clause becomes rhetorical.

---

## NF-5 — Invoice reconciliation, the only external check

```yaml
type: loop
id: spend-reconciliation
owner: research-math/neural-footprint-instrumentation
measures: [provider_invoice_usd, summed_nf_event_cost_usd, reconciliation_delta_pct]
changes: [nf.emission_points, telemetry.failure_counters]
inputs_from: [finance-and-pricing, harness-model-routing]
outputs_to: [security, strategy-and-fundraising, decision-office]
close_time: monthly
status: proposed
rationale: "SpendLogger fails soft by design (spend_logger.py:83-86) and returns early when Supabase is unconfigured (:66-70). Every dropped event is a silent absence, and a metric computed from emitted events cannot see it. The invoice is a number this team cannot influence."
alarm: "delta > 5% in either direction"
```

---

## NF-6 — SEC-3's hard dependency

Recorded as a loop because it is a promise to another department with a date on it.

```yaml
type: loop
id: unauthenticated-inference-spend-feed
owner: research-math/neural-footprint-instrumentation
measures: [nf_a.unauthenticated_inference_spend, callsites_recording_subject]
changes: [nf.subject_attribution, callsite.instrumentation]
inputs_from: [security]
outputs_to: [security]
close_time: weekly
close_time_note: "first reading within 4 weeks, then weekly"
status: proposed
dependency: "SEC-3's primary metric is unmeasurable until NestJS model calls emit cost events — hard dependency, not a nice-to-have (intelligence.md:488)"
first_callsite: "apps/api-gateway/src/analytics/consultants.service.ts:28 — unguarded route (OD-20), Opus call"
rule: "'no authenticated subject' is recorded as a VALUE, never as a null — a null is indistinguishable from a bug"
```

---

## NF-7 — NF-B contract, and the NF-C gate

```yaml
type: loop
id: nf-b-contract-and-nf-c-gate
owner: research-math/neural-footprint-instrumentation
measures: [nf_b.identifier_coverage, nf_b.erasure_requests_honoured, nf_c.trigger_met]
changes: [nf.subject_vocabulary, nf_b.event_contract]
inputs_from: [guest-experience, compliance-and-privacy, data]
outputs_to: [guest-experience, analytics-bi, compliance-and-privacy]
close_time: monthly
close_time_note: "monthly for NF-B; quarterly trigger check for NF-C"
status: proposed
nf_b_substrate: "20260819000000_guest_identity_minimal_slice.sql — guests (:40), guest_identifiers with peppered channel_hash (:122,:195,:369), guest_check_links (:206), erased_at (:112), guest_copresence_negatives (:532)"
nf_c_trigger: "a funded study partner, or a consumer-grade biosignal device with an API — wording to be confirmed by the founder"
nf_c_cost_until_then: "zero — the subject_type slot reserves it and an append-only research log has no schema to break"
```

**Note on asymmetry, stated rather than smoothed over:** the guest track has privacy
mechanics (peppered hashes, erasure) before the agent track has cost mechanics. That is
the correct priority order for risk and an odd one for a department whose priority metric
is NF-A. Both are true.
