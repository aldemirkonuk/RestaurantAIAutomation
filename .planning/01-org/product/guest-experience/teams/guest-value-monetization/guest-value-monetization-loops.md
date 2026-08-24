---
type: loops
division: product
department: guest-experience
team: guest-value-monetization
status: provisional
metrics: [nf_b.ops_conversion, nf_b.k_anonymity_pass_rate, nf_b.sub_k_render_attempts, nf_b.photo_consent_rate, nf_b.segment_to_decision_latency]
updated: 2026-08-24
links: ["[[guest-value-monetization-charter]]", "[[guest-value-monetization-directive]]", "[[guest-value-monetization-premortem]]", "[[guest-experience-loops]]", "[[taste-fingerprint-loops]]", "[[consumer-app-points-economy-loops]]", "[[compliance-privacy-charter]]", "[[legal-charter]]", "[[product-vision-charter]]", "[[LOOP-MAP]]"]
loop_count: 4
loop_count: 4
loop_count: 4
loop_ids: ["nf-b-k-anonymity-gate", "photo-consent-integrity", "nf-b-ops-conversion", "advertising-boundary-integrity"]
loop_close_times: ["per-render", "per-use", "quarterly", "per-placement"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Guest Value & Monetization — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**All four are dormant** — the team is unstaffed and has nothing to aggregate. Two of
them (M1, M2) are nonetheless the loops that must be **built before the team exists**,
because both are counter-pressures that only work in advance
([[guest-value-monetization-premortem]] V1).

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
close_time: per-render
status: proposed
```

**M1 — The gate that runs at render time.** Every restaurant-facing view of
guest-derived data passes the k-threshold before it renders; below k it shows *"not
enough data yet"*. `nf_b.k_anonymity_pass_rate` must be **100%** — no exceptions, no
admin path, no staging carve-out.

**Per-render, because a privacy gate that closes on a review cadence has already
leaked by the time it closes.** There is no version of this loop that closes weekly
and still prevents anything.

`nf_b.sub_k_render_attempts` is the loop's real intelligence. It rises when
restaurants have segments too small to show — which is exactly the pressure that
precedes someone proposing a lower threshold. **The number is visible before the
proposal exists**, and that ordering is the entire counter-pressure to V1. The change
lever is deliberately `empty_state_copy`, not the threshold: when sub-k attempts rise,
the correct response is a better empty state, because most of the pressure is the
pressure not to look broken.

---

```yaml
type: loop
id: photo-consent-integrity
owner: guest-experience
team: guest-value-monetization
measures: [nf_b.photo_consent_rate, photos_used_without_purpose_consent, revocations_propagated]
changes: [consent_contract, enrichment_pipeline_gate]
inputs_from: [consumer-app-points-economy, legal, compliance-privacy]
outputs_to: [legal, compliance-privacy, data]
close_time: per-use
status: proposed
```

**M2 — May we actually use this photo, for *this*?** The enrichment pipeline
**exists** ([[FUTURES]] §4) and the consent-to-reuse plumbing does **not**, which is
the dangerous ordering: a working capability with a missing gate.

`photos_used_without_purpose_consent` must be **0** and is enforced **at the pipeline,
not at the surface** — the pipeline is where a photo actually gets used; the surface is
where somebody remembers to check. Purpose-scoped, following
`consent_purpose` / `consent_notice_version`
(`20260819000000_guest_identity_minimal_slice.sql:54-64`): catalog enrichment,
restaurant promotion, and paid placement are three purposes, and one "yes" does not
transfer.

`revocations_propagated` is the hard measure and the one that will be uncomfortable: a
revocation is easy in software and hard in a printed menu or a placement that already
ran. [[legal-charter]] owns what must happen; this loop measures whether it did.

Per-use, for the same reason as M1.

---

```yaml
type: loop
id: nf-b-ops-conversion
owner: guest-experience
team: guest-value-monetization
measures: [nf_b.ops_conversion, nf_b.segment_to_decision_latency]
changes: [restaurant_digest_content, segment_definitions, sub_layer_scope]
inputs_from: [analytics-bi, taste-fingerprint, product-vision]
outputs_to: [product-vision, growth]
close_time: quarterly
status: proposed
```

**M3 — The loop that judges the sub-layer.** Restaurant decisions — par change,
promotion, menu experiment, 86 — **traceable to a named NF-B segment**. Zero means the
guest side is the standalone social network [[FUTURES]] §10 forbids.

It is only computable if the **traceability chain is designed into the first insight
surface**: every restaurant-facing recommendation carries the segment id that produced
it, and every acted-upon recommendation writes back. Cheap at surface one,
near-impossible at surface ten. Without it the metric is not zero — it is
*unmeasured*, which reads as neutral and is how [[guest-value-monetization-premortem]]
V3 survives four quarters.

Quarterly, deliberately slow: an operational decision takes a menu cycle to attribute,
and a monthly reading would invite counting intentions instead of decisions.

Note the third entry under `changes`: **`sub_layer_scope`**. Two consecutive quarters
at zero returns [[guest-experience-charter]] to [[product-vision-charter]] for a scope
decision. That is the loop closing on its owner, which is what distinguishes it from a
dashboard.

---

```yaml
type: loop
id: advertising-boundary-integrity
owner: guest-experience
team: guest-value-monetization
measures: [surfaces_carrying_ads, boundary_statement_current, promise_copy_consistency]
changes: [placement_rules, product_copy]
inputs_from: [compliance-privacy, legal, product-vision]
outputs_to: [product-vision, growth, legal]
close_time: per-placement
status: proposed
```

**M4 — Does what we ship still match what we promised?** The product already carries a
written promise about advertising:
`apps/web/src/components/settings/ServicesPermissions.tsx:41` lists *"Any advertising
or cross-site tracking"* under exclusions, and `:249` states *"WineOps sets no tracking
or advertising cookies."*

`promise_copy_consistency` is the loop's whole purpose: every surface carrying
advertising is checked against every surface promising none. `boundary_statement_current`
asserts a written boundary exists at all — **and until it does, this loop's verdict on
any ad placement is BLOCKED**, which is the correct default rather than a gap.

Per-placement, because the inconsistency is created one surface at a time and is only
noticed all at once, by someone outside the company, at the worst moment
([[guest-value-monetization-premortem]] V5).

**Not in this loop, deliberately: pricing.** Founder-deferred, Commercial's when it is
not, and no revenue quantity appears in any measure above.

---

## Loops this team depends on but does not own

- **`guest-subject-coverage`** and **`nf-b-event-completeness`** — no subjects and no
  events means no segments. This team has nothing to aggregate today, and that is a
  fact about its inputs, not about its ambition.
- **`nf-b-cohort-divergence`** ([[taste-fingerprint-loops]] F2) — with a real bearing
  here: a model that has collapsed into a regional average produces segments that look
  crisp and describe geography. A confident wrong segment is more dangerous to this
  team than a vague right one, because it converts more readily into an operational
  decision.
- **`points-abuse-posture`** ([[consumer-app-points-economy-loops]] P2) — advocacy
  signal feeding par and promotion suggestions (`NEW-882`, `NEW-883`) is only as
  trustworthy as the abuse defence upstream of it.
