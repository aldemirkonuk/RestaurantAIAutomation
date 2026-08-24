---
type: loops
division: commercial
department: media-brand
team: customer-relationship-research
status: provisional
metrics: [nf_b.choice, nf_b.context]
updated: 2026-08-24
links:
  - "[[customer-relationship-research-charter]]"
  - "[[customer-relationship-research-directive]]"
  - "[[media-brand-loops]]"
  - "[[compliance-privacy-charter|compliance-charter]]"
loop_count: 4
loop_count: 4
loop_count: 4
loop_ids: ["research-consent-reconciliation", "research-withdrawal-propagation", "research-purpose-drift", "research-register-build"]
loop_close_times: ["weekly", "weekly", "monthly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Customer Relationship Research (M4) — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop.

**Three of the four loops here exist to catch a violation, not to improve a number.** That
is the right shape for this team: its primary metric is a hard zero, and a loop over a hard
zero is an alarm rather than a dial.

---

## 1. Consent-register reconciliation

```yaml
type: loop
id: research-consent-reconciliation
owner: customer-relationship-research
measures: [research.subjects_touched, research.subjects_approved, research.refusals_logged]
changes: [research.eligible_cohort]
inputs_from: [compliance-and-privacy]
outputs_to: [compliance-and-privacy, media-brand]
close_time: weekly
status: proposed
```

**Closes on an equality, not a target.** `subjects_touched` must equal `subjects_approved`.
Any gap is an incident, investigated the same week, not a trend line.

**`refusals_logged` is the health signal.** A gate with zero recorded refusals is either
never being asked or never saying no, and both need looking at. This mirrors the reasoning
G3 uses for rejection rate: a 0% rejection rate means the gate is not reading.

**Unrunnable today** — `subjects_approved` has no source, because the register does not
exist. Stated as blocked, never modelled as zero.

---

## 2. Withdrawal propagation

```yaml
type: loop
id: research-withdrawal-propagation
owner: customer-relationship-research
measures: [guests.consent_withdrawn_at, research.findings_pending_retraction]
changes: [research.findings, research.retraction_queue]
inputs_from: [guest-experience, compliance-and-privacy]
outputs_to: [compliance-and-privacy, media-brand, product-and-vision]
close_time: weekly
status: proposed
```

**The loop that makes withdrawal mean something outside the database.** The schema honours
withdrawal well — `consent_withdrawn_at` at
`…guest_identity_minimal_slice.sql:64`, erasure as a tombstone at `:79-81` and `:112-117`.
None of that reaches a document sitting in a folder.

**Depends entirely on findings carrying their subject ids.** Without that field the loop
cannot run at all, which is why it is a required field in
[[customer-relationship-research-directive]] rather than a convention.

**Weekly, not monthly.** Withdrawal is a right with a clock on it; a monthly sweep leaves a
withdrawn person inside live findings for up to a month after they asked not to be.

---

## 3. Purpose-drift watch

```yaml
type: loop
id: research-purpose-drift
owner: customer-relationship-research
measures: [research.findings_by_consent_purpose, research.findings_missing_purpose]
changes: [research.query_filters, research.findings_format]
inputs_from: [compliance-and-privacy]
outputs_to: [compliance-and-privacy, media-brand]
close_time: monthly
status: proposed
```

**Watches the single most likely quiet failure.** `consent_purpose` defaults to
`service_personalisation` (`:58`). A research query filtering on
`consent_captured_at is not null` and nothing else would sweep up every guest who consented
to personalisation and none of whom consented to research.

**`findings_missing_purpose` must be zero.** A finding that cannot state which purpose
permitted it is not evidence of a good result; it is evidence that nobody checked.

**Monthly.** Drift is cumulative rather than instantaneous, and the weekly reconciliation
already catches the acute case.

---

## 4. Register-build progress — **temporary**

```yaml
type: loop
id: research-register-build
owner: customer-relationship-research
measures: [research.register_exists, research.compliance_review_status]
changes: [research.gate_status]
inputs_from: [compliance-and-privacy]
outputs_to: [media-brand, compliance-and-privacy]
close_time: monthly
status: proposed
```

**Exists only until the register does, then it is deleted.** Its job is to keep a blocker
visible: a gate that stays unbuilt indefinitely eventually gets treated as an obstacle
rather than a prerequisite, and that is how the first exception happens.

**Two states and a date.** Does the register exist, and where is the Compliance & Privacy
review. If either is unchanged for three consecutive runs, that is not an anti-sprawl
deletion — it is an escalation, because the thing not moving is the gate.

---

## Loops this team consumes but does not own

| Loop | Owner | Why we care |
|---|---|---|
| NF-B emission | Product / Platform | NF-B is a priority track and emits nothing today ([README §1, §4.2](../../../../../foundation/README.md)); this team's guest-side questions have no data until it does |
| Consent capture in-product | Guest Experience | We read the record; they capture it |
