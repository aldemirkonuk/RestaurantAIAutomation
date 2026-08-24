---
type: scenario
id: S12
slug: guest-builds-food-identity-over-visits
class: happy-path
actors: [guest, identity-spine, nf-b-recorder, pos, consumer-app]
modules: ["[[guest-identity-consent-charter|guest-identity-consent]]", "[[taste-fingerprint-charter|taste-fingerprint]]", "[[consumer-app-points-economy-charter|consumer-app-points-economy]]"]
signals: [consented-check-link, dish-choice-in-context, rating-event, nf_b]
insights_class: [demand-composition-with-divergence, novel-dish-fit, k-anon-segment-demand]
tier: undecided
sim_harness: synthetic-engine
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[0006-neural-footprint-architecture]]"]
---

# S12 — Guest builds food identity over visits

## 1. Trigger
Across repeated **consented** visits, a guest's choices accumulate into a food identity —
*exposure → choice → repeat → rating*, in context. Bounded: from the first consented
`guest_check_links` row to a recommendation that reflects a **mechanism, not a tag**
(vision §11). The identity spine exists as schema
(`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:40,122,206`) but has
**zero application callers** — so today no identity is ever built. Said plainly per contract
Rule 1.

## 2. Actors
Guest (multi-visit) · the identity spine ([[guest-identity-consent-charter|guest-identity-consent]] — *who*, consent-gated)
· the NF-B recorder ([[taste-fingerprint-charter|taste-fingerprint]] — *what they like*, at mechanism level) · POS
(the check) · the consumer app (produces the signal). The two identity teams are deliberately
split — opposite risk postures, one measured on refusing to guess, one on modelling.

## 3. Signals — **schema exists, no writer; food track blocked**
- **Consented check-link per visit** — `guest_check_links` (`:206`), the only legal subject
  source. `nf_b.subject_coverage` is **0%, structural** — nothing writes it.
- **Dish choice in context** — region, season, companions, and the **home-region baseline**
  the tourist mechanism needs. **Blocked at the referent:** dish identity is DEFERRED (register
  A15), the corpus is **37 distinct raw item strings**, and there is **no dish/recipe/ingredient
  table** — so `stimulus` has no referent and a food fingerprint **cannot exist**, not merely "is
  hard" ([[taste-fingerprint-charter|taste-fingerprint]] Evidence).
- **The NF-B tuple** stimulus→state→choice→outcome (0006) — **never emitted**, column contract
  open (OD-11).
- **Wine is the exception that opens the track:** `master_wine_library` gives a deterministic
  referent (producer + name + residual tokens), measured at **0 false merges over 732,874 pairs**
  (`scripts/check_no_guest_name_matching.sh:6-7`). Over wine the mechanism is buildable today;
  over food it is not.

## 4. Queries the product must answer
- "Is this the same consented guest?" — **exact verified key or refuse; no threshold** ([[guest-identity-consent-charter|guest-identity-consent]]).
- "What is this guest's exposure prior?" — the dose–response weight, not a label.
- "Is this choice a departure from *their* home-region baseline?" — the tourist delta; without
  the home baseline the observation is uninterpretable.
- "Do two guests with identical exposure histories diverge?" — the sibling / personalization test.
- "What does compound overlap predict for a dish nobody has eaten?" — the tag/mechanism discriminator.

## 5. Outputs (in the moment) — consumer-side
- A recommendation reflecting the mechanism: exposure as a **satiating** dose–response, region as
  a **prior not a verdict**, tourist choice as a trajectory, individual divergence preserved.
- A **consent prompt before any linkage** — no link without an exact verified key.

## 6. Insights the owner sees (the payoff)
- Demand composition by cohort **with divergence preserved** (not a regional average).
- What a **novel dish** would land with, by compound overlap.
- k-anonymized segment demand — never raw guest identity to the restaurant without consent (§7.3).
- **Satisfiability check:** unfed for food (no referent, no subject writer); **feasible wine-only**
  today. Guest signal is exactly what would lift analytics past its 25.1% floor
  ([[analytics-bi-charter]]:87), but that lift is gated on this signal existing.

## 7. Decisions
Guest **consents**, or the link is **refused** — exact key or nothing, no queue, no fuzzy
candidate. The model **proposes** recommendations (ask→propose→confirm→execute); it never
merges without an exact verified key and never sets the identity team's threshold. Human/guest
confirms; the system never silently mutates identity.

## 8. Failure modes
- **False guest merge = irreversible disclosure** — one person's history exposed to another;
  hard gate `nf_b.false_merge_count` = **0, permanently** ([[guest-identity-consent-charter|guest-identity-consent]]).
- Identical exposure → identical recommendation = **not personalizing** (regional averaging under
  another name); caught by `nf_b.divergence_within_cohort`.
- Rating with no dish referent → **not an NF-B event**.
- Tourist observation without a home baseline → uninterpretable; averaging it makes the system a
  regional average.
- Consent withdrawn but trace retained → erasure must be a `DELETE` with nothing left to shred.

## 9. Simulation & deploy gate
Synthetic engine generates: cohorts with **identical exposure histories** (divergence test),
tourists carrying **home-region baselines** (delta coverage), and wine choices (deterministic
identity). Gate: `divergence_within_cohort` > 0, `novel_stimulus_hit_rate` above chance, and
**zero false merges** under adversarial copresence replay. **Simulated before live — locked.**

## 10. Tier cut (proposed — OD-48)
Core: capture consented visits (operate). Plus: the guest's own taste profile surfaced to them
(understand). Pro: mechanism-level recommendation + demand proposals to the owner (optimize).
Price points open.

## 11. Evolution feedback
`divergence_within_cohort` teaches whether it personalizes or averages; `novel_stimulus_hit_rate`
discriminates mechanism from tag; where guests refuse consent teaches the consent UX and, honestly,
tells us the true addressable subject base.

**Flex points:** verification channel, **wine-only vs food** (gated by A15 reversal), consent
granularity, how the home-region baseline is captured.
