---
type: loops
division: product
department: guest-experience
parent_department: product-vision
status: provisional
metrics: [nf_b.subject_coverage, nf_b.false_merge_count, nf_b.event_completeness, nf_b.divergence_within_cohort, nf_b.events_per_active_guest_month, nf_b.points_confirm_rate, nf_b.ops_conversion, nf_b.k_anonymity_pass_rate]
updated: 2026-08-24
links: ["[[guest-experience-charter]]", "[[guest-experience-directive]]", "[[guest-experience-premortem]]", "[[guest-identity-consent-loops]]", "[[taste-fingerprint-loops]]", "[[consumer-app-points-economy-loops]]", "[[guest-value-monetization-loops]]", "[[compliance-privacy-charter]]", "[[analytics-bi-charter]]", "[[data-charter]]", "[[product-vision-charter]]", "[[LOOP-MAP]]"]
loop_count: 7
loop_ids: ["nf-b-subject-coverage", "nf-b-false-merge-gate", "nf-b-event-completeness", "nf-b-cohort-divergence", "nf-b-signal-volume", "nf-b-ops-conversion", "nf-b-k-anonymity-gate"]
loop_close_times: ["weekly", "per-pr", "weekly", "monthly", "weekly", "quarterly", "per-event"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Guest Experience — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**The sub-layer's spine loop** is the one [[README]] §7 draws:
*guest behavior → NF-B → personalization → better recommendation → more guest
signal.* It does not close today, and the honest reason is that it is broken at the
**first arrow**: nothing writes the identity tables, so no guest behavior becomes an
NF-B event. L1 exists to repair that arrow before any loop downstream of it is
claimed to run.

---

```yaml
type: loop
id: nf-b-subject-coverage
owner: guest-experience
team: guest-identity-consent
measures: [nf_b.subject_coverage, nf_b.consented_link_rate]
changes: [consent_capture_channel, guest_link_write_path]
inputs_from: [product-vision, partnerships-integrations, compliance-privacy]
outputs_to: [taste-fingerprint, guest-value-monetization]
close_time: weekly
status: proposed
```

**L1 — Does anything become a guest?** % of `pos_checks` carrying a *consented*
`guest_check_links` row. Structurally **0%** today: grepped `apps/api-gateway/src`,
`apps/web/src`, `apps/mobile/src` — no application code touches
`guest_check_links`, `guest_link_identifier`, `guest_identifiers`, or `guests`.
The loop measures coverage and changes **which capture channel is live**, of the
four the schema already allows (`:61-62`: `reservation_form`, `in_venue_card`,
`staff_verbal`, `loyalty_signup`). Weekly, because a capture channel either works in
service or it does not, and a week of service is enough to know.
**This is the denominator of every loop below.** While it is 0, L3–L7 are undefined,
not bad — see [[guest-experience-charter]] §Metrics.

---

```yaml
type: loop
id: nf-b-false-merge-gate
owner: guest-experience
team: guest-identity-consent
measures: [nf_b.false_merge_count, nf_b.refusal_count, nf_b.copresence_negative_pairs]
changes: [merge_policy, ci_gate_status]
inputs_from: [security, red-team]
outputs_to: [compliance-privacy, product-vision]
close_time: per-pr
close_time_note: "per commit (CI)"
status: proposed
```

**L2 — The gate that must never fire.** `guest_copresence_negatives` (`:519-540`)
harvests free negatives — two guests on the same check are different people — and
`scripts/eval_guest_merge_policies.py` fails CI on a single false merge. Close-time
is **per-commit** because that is the only cadence at which an irreversible error is
preventable rather than reportable. The view ships **empty** on purpose (`:536-538`);
the gate must be wired into CI *now*, while it passes trivially, because a gate added
after the first violation is a gate someone will argue with.
The loop also measures **refusals**, which this sub-layer reports as output rather
than as friction — see [[guest-experience-directive]].

---

```yaml
type: loop
id: nf-b-event-completeness
owner: guest-experience
team: taste-fingerprint
measures: [nf_b.event_completeness, nf_b.events_missing_stimulus]
changes: [nf_b_event_contract, ingestion_validation]
inputs_from: [data, analytics-bi]
outputs_to: [guest-value-monetization, research-math]
close_time: weekly
status: proposed
```

**L3 — Is an event actually an event?** % of NF-B events carrying all four of
`stimulus`, `choice`, `outcome`, `context`. A rating with no identified dish has no
`stimulus`; counting it is how this metric lies. Weekly, matched to ingestion. The
change lever is the **event contract itself** — if completeness is low, the contract
is wrong or the surface is emitting garbage, and both are fixable in a week.
Blocked while dish identity is deferred (A15) on the food side; runs **wine-only**,
where identity is deterministic.

---

```yaml
type: loop
id: nf-b-cohort-divergence
owner: guest-experience
team: taste-fingerprint
measures: [nf_b.divergence_within_cohort, nf_b.tourist_delta_coverage]
changes: [preference_model_priors, personalization_ranking]
inputs_from: [research-math, data]
outputs_to: [consumer-app-points-economy, guest-value-monetization]
close_time: monthly
status: proposed
```

**L4 — Is this personalization, or regional averaging wearing its name?** Measures
the spread of predicted preference among guests with **identical exposure history**.
If it collapses toward zero, the model has learned a region and is reporting it as a
person — the failure the founder named explicitly: *siblings raised in the same house
diverge*. Also measures `nf_b.tourist_delta_coverage` — the share of events whose
`context` carries a **home-region baseline**, without which a visitor's choice is
uninterpretable (a Turk ordering lahmacun in Istanbul is a null observation; a
Norwegian ordering it is a high-information one). Monthly, because a model
re-fit is a monthly-scale act and a weekly reading would be noise.

---

```yaml
type: loop
id: nf-b-signal-volume
owner: guest-experience
team: consumer-app-points-economy
measures: [nf_b.events_per_active_guest_month, nf_b.points_confirm_rate]
changes: [earning_rules, verification_gate, app_surface]
inputs_from: [design, security]
outputs_to: [taste-fingerprint, guest-value-monetization]
close_time: weekly
status: proposed
```

**L5 — Volume, read against integrity.** The two measures are one loop deliberately.
Volume alone is farmable; `nf_b.points_confirm_rate` — % of points reaching
`confirmed` rather than expiring provisional ([[FUTURES]] §7.3) — is what makes
volume mean something. **High volume with a low confirm rate is farming, not
engagement**, and the loop's change lever is the verification gate, not the earning
rate. Weekly, because that is the cadence at which an abuse pattern is still cheap to
reverse. Gated on **OD-07**.

---

```yaml
type: loop
id: nf-b-ops-conversion
owner: guest-experience
team: guest-value-monetization
measures: [nf_b.ops_conversion, nf_b.segment_to_decision_latency]
changes: [restaurant_digest_content, segment_definitions, sub_layer_scope]
inputs_from: [analytics-bi, product-vision]
outputs_to: [product-vision, growth]
close_time: quarterly
status: proposed
```

**L6 — The loop that judges the sub-layer.** Count of restaurant decisions — par
change, promotion, menu experiment, 86 — **traceable to a named NF-B segment**. Zero
means the guest side is the standalone social network [[FUTURES]] §10 forbids.
Quarterly is deliberately slow: an operational decision takes a menu cycle to
attribute, and a monthly reading would invite counting intentions instead of
decisions. Note the third entry under `changes`: **`sub_layer_scope`**. Two
consecutive quarters at zero returns this charter to [[product-vision-charter]] for
a scope decision. That is the loop closing on its owner, which is what makes it a
loop rather than a dashboard.

---

```yaml
type: loop
id: nf-b-k-anonymity-gate
owner: guest-experience
team: guest-value-monetization
measures: [nf_b.k_anonymity_pass_rate, nf_b.sub_k_render_attempts]
changes: [render_gate, empty_state_copy]
inputs_from: [compliance-privacy]
outputs_to: [compliance-privacy, legal]
close_time: per-event
close_time_note: "per render"
status: proposed
```

**L7 — The gate that runs at render time.** Every restaurant-facing view of guest
data passes the k-threshold before it renders; below k it shows *"not enough data
yet"*. Close-time is **per-render** because a privacy gate that closes on a review
cadence has already leaked by the time it closes. The second measure —
`sub_k_render_attempts` — is the early-warning channel for
[[guest-experience-premortem]] M4: a rising count of blocked attempts is exactly the
pressure that precedes someone proposing a lower threshold, and it should be visible
*before* the proposal, not after.

---

## Loops this sub-layer deliberately does not own

- **NF-A harness improvement** — [[research-math-charter]]. Same event shape, different
  subject.
- **The operator preference loop.** Manager dismisses / snoozes / rates a
  recommendation → the engine learns. This is the strongest human-preference loop the
  company already runs (`recommendation_actions`,
  `apps/api-gateway/src/analytics/recommendation-actions.service.ts:12-44`) and it has
  **no `subject_type` home** in the NF schema, which fixes `subject_type` to
  `agent | guest | bio`. It is not ours — an operator is not a guest — but it is
  named here because it is the one live human-preference loop in the repo, and
  because **OD-11 will fix the partial-index strategy per `subject_type` and make
  adding a fourth value a migration rather than an edit.** See
  [[guest-experience-agenda-full]] §Questions, item 2.
