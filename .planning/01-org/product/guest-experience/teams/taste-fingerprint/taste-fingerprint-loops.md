---
type: loops
division: product
department: guest-experience
team: taste-fingerprint
status: provisional
metrics: [nf_b.event_completeness, nf_b.divergence_within_cohort, nf_b.tourist_delta_coverage, nf_b.exposure_prior_coverage, nf_b.novel_stimulus_hit_rate]
updated: 2026-08-24
links: ["[[taste-fingerprint-charter]]", "[[taste-fingerprint-directive]]", "[[taste-fingerprint-premortem]]", "[[guest-experience-loops]]", "[[guest-identity-consent-loops]]", "[[research-math-charter]]", "[[data-charter]]", "[[LOOP-MAP]]"]
---

# Taste Fingerprint (NF-B) — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**All four loops below are currently open at their input.** `nf_b.subject_coverage`
is structurally 0% and OD-11's column contract is unresolved, so no NF-B event can be
written. Documenting the loops before they can run is deliberate — the same reasoning
that put `guest_copresence_negatives` in the schema before there was data
(`20260819000000_guest_identity_minimal_slice.sql:513-518`): a measurement designed
after the thing it measures is a measurement designed to agree with it.

---

```yaml
type: loop
id: nf-b-event-completeness
owner: guest-experience
team: taste-fingerprint
measures: [nf_b.event_completeness, nf_b.events_missing_stimulus, nf_b.events_missing_context]
changes: [nf_b_event_contract, ingestion_validation, emitting_surface]
inputs_from: [guest-identity-consent, consumer-app-points-economy, data]
outputs_to: [guest-value-monetization, research-math]
close_time: weekly
status: proposed
```

**F1 — Is an event actually an event?** All four of `stimulus`, `choice`, `outcome`,
`context`, or it does not count. The breakdown by *which* field is missing is the
useful part: missing `stimulus` means the dish was not identified (the A15 problem
surfacing as a metric); missing `context` means the emitting surface dropped the
home-region baseline and the observation is uninterpretable.

Weekly, matched to ingestion — that is the shortest cadence at which a contract fix
can be written, shipped, and read back. The change lever is the **contract itself**:
persistently low completeness means the contract is wrong or the surface is emitting
garbage, and both are one-week fixes. Runs **wine-only** while A15 holds.

---

```yaml
type: loop
id: nf-b-cohort-divergence
owner: guest-experience
team: taste-fingerprint
measures: [nf_b.divergence_within_cohort, nf_b.regional_variance_share]
changes: [preference_model_priors, regularization_strategy, release_gate]
inputs_from: [research-math]
outputs_to: [consumer-app-points-economy, guest-value-monetization, product-vision]
close_time: per-model-version
status: proposed
```

**F2 — Personalization, or a regional average wearing its name?** The spread of
predicted preference among guests with **identical exposure history**. If it collapses
toward zero, region has explained the variance and the individual residual has been
regularized away — [[taste-fingerprint-premortem]] T4, which looks like success on
every conventional metric.

**Close-time is per-model-version, not calendar**, because the loop *is* the release
gate: a model that reduces within-cohort divergence relative to its predecessor does
not ship, even if accuracy improves ([[taste-fingerprint-directive]]). A monthly
cadence would let a regressing model live in production for weeks with better numbers,
and by the time the loop closed the argument would be about rolling back an
improvement.

`nf_b.regional_variance_share` is the diagnostic beside it: rising regional share with
falling divergence is the mechanism of the failure, not just its symptom.

---

```yaml
type: loop
id: nf-b-novel-stimulus
owner: guest-experience
team: taste-fingerprint
measures: [nf_b.novel_stimulus_hit_rate, nf_b.compound_overlap_coverage]
changes: [stimulus_representation, exposure_prior_shape]
inputs_from: [data, research-math]
outputs_to: [consumer-app-points-economy, guest-value-monetization]
close_time: monthly
status: proposed
```

**F3 — Mechanism or tag?** Prediction accuracy on stimuli the guest has **never**
encountered. This is the discriminator: a mechanism predicts an unseen dish through
compound overlap with the exposure history, and **a tag cannot score above chance**,
because there is nothing inside a label to generalise with.

`nf_b.compound_overlap_coverage` — the share of stimuli with a real compositional
representation rather than a category — is the input side of the same question. Wine
is where it can be high: grape, region, vintage, and producer style are genuinely
compositional, and two Barolos have a real overlap quantity rather than a
tag-similarity score.

Monthly, because it needs held-out novel stimuli to accumulate. **It must be wired
before the first model** — after a seen-item accuracy number exists, this metric only
ever looks like drag ([[taste-fingerprint-premortem]] T1).

---

```yaml
type: loop
id: nf-b-tourist-baseline
owner: guest-experience
team: taste-fingerprint
measures: [nf_b.tourist_delta_coverage, nf_b.baseline_capture_rate]
changes: [context_field_contract, capture_surface]
inputs_from: [consumer-app-points-economy, guest-identity-consent]
outputs_to: [guest-value-monetization]
close_time: monthly
status: proposed
```

**F4 — Can a visitor's choice be read at all?** The share of events whose `context`
carries a **home-region baseline**, not merely the current region. A guest from
Istanbul ordering lahmacun in Istanbul is close to a null observation; a guest from
Oslo ordering it is high-information. Same choice, opposite information content — and
without the baseline the event is **uninterpretable rather than weakly informative**,
which matters because uninterpretable observations averaged together produce exactly
the regional-average failure F2 measures.

The change lever is the `context` contract and the capture surface. The hard part is
capturing a home baseline **without a survey question**, which is why the loop
outputs to [[consumer-app-points-economy-charter]]: the baseline is a byproduct of
where a guest habitually eats, not a profile field. Monthly, matched to how slowly a
capture-surface change propagates.

---

## Loops this team depends on but does not own

- **`guest-subject-coverage`** ([[guest-identity-consent-loops]] G3) — the denominator
  for every loop above. **This team never proposes changing its merge rule**; the only
  escalation path for insufficient subjects is more capture channels
  ([[taste-fingerprint-directive]]).
- **OD-11 column contract** ([[data-charter]]) — not a loop yet, a blocker. It becomes
  a loop the day NF-B events can be written.
- **The operator preference loop.** `recommendation_actions` closes a real
  human-preference loop today (`apps/api-gateway/src/analytics/recommendation-actions.service.ts:12-44`)
  — a manager dismisses or rates a card, the engine's surfacing changes. From this
  team's angle it is the **only real human-preference training data currently
  available**, and it has no `subject_type` home. Not ours to own; named here because
  the modelling case for answering the question before OD-11 closes is this team's to
  make. See [[taste-fingerprint-agenda-full]] §Questions, item 2.
