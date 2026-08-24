---
type: scenario
id: S01
slug: guest-dines-and-rates
class: happy-path
actors: [guest, consumer-app, pos, identity-spine, nf-b-recorder]
modules: ["[[taste-fingerprint-charter|taste-fingerprint]]", "[[guest-identity-consent-charter|guest-identity-consent]]", "[[consumer-app-points-economy-charter|consumer-app-points-economy]]"]
signals: [verified-visit, rating-event, dish-photo, nf_b]
insights_class: [demand-segment, dish-popularity-by-cohort, par-promote-86]
tier: undecided
sim_harness: synthetic-engine
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[taste-fingerprint-charter]]", "[[guest-identity-consent-charter]]", "[[consumer-app-points-economy-charter]]"]
---

# S01 — Guest dines and rates

## 1. Trigger
A guest finishes a meal and rates a dish or the restaurant in the consumer app. Bounded:
from visit-verification (reservation / POS / QR check-in) through rating submission to
points credited and the NF-B event that should record it. **None of this chain is built:**
there is no ratings table, no points ledger (FUTURES §7 backlog 999.1), and the visit-link
table `guest_check_links` exists with zero application callers
(`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:206`). This scenario
is a target, and §3 says so honestly.

## 2. Actors
Guest (consumer profile, belongs to no restaurant org — FUTURES §7.1) · the consumer app /
points surface · POS (verifies the visit) · the identity spine ([[guest-identity-consent-charter|guest-identity-consent]])
· the NF-B recorder ([[taste-fingerprint-charter|taste-fingerprint]]). The owner is **not** in the room — guest signal
is demand-side input the backend consumes, not an operator alert.

## 3. Signals — **none captured today**
- Verified-visit signal (reservation / POS / QR check-in → base vs provisional points). No
  check-in surface writes `guest_check_links`; `nf_b.subject_coverage` is **0%, structural**.
- Rating event, quality-gated. **No ratings table exists** in the schema.
- Dish photo (optional, catalog enrichment with consent). No capture path.
- The NF-B tuple **stimulus → internal state → choice → outcome** (0006). **NF-B has never
  emitted an event**; its column contract is open (OD-11). Nothing is captured, so
  everything below §5 is, today, fiction — stated per contract Rule 1.

## 4. Queries the product must answer
- "Is this a verified visit or provisional?" — gates points value (FUTURES §7.2–7.3).
- "Does this rating pass the quality gate?" — empty spam ratings earn nothing.
- "Which dishes attract which cohort?" — demand-side read, k-anonymized (§7.3).
- "What does this choice say about this guest's exposure history?" — the NF-B question, only
  answerable once a dish has a referent (blocked, see [[taste-fingerprint-charter|taste-fingerprint]] / A15).

## 5. Outputs (in the moment) — all consumer-side
- Points-credited confirmation, labelled **provisional vs confirmed** (verification gates value).
- Rating captured; tier/badge progress (Beli-style, FUTURES §7.2).
- "Rate your dish" / "add a photo" prompt.
- The owner sees nothing in the moment — this is demand input, not a floor alert.

## 6. Insights the owner sees (the payoff)
- Demand-segment story: "which dishes attract which cohort," what to **par / promote / 86**.
- Dish popularity by k-anonymized segment — never raw guest identity without consent (§7.3).
- **Satisfiability check:** the analytics engine exists (`apps/api-gateway/src/analytics/`)
  but returns only **25.1%** of 573 insight types without POS, and guest signal is what would
  raise it ([[analytics-bi-charter]]:77,87). With zero guest events landing, **the owner sees
  none of these today.** The insight class is real; the substrate is empty.

## 7. Decisions
Guest: rate, share, consent. Owner: what to par / promote / 86 — human decides. System
**proposes** (ask→propose→confirm→execute) demand-driven par and promotion moves; it never
silently mutates a menu. **Points ledger is append-only, balance derived, every credit
idempotent** (FUTURES §7.3) — no path edits a balance.

## 8. Failure modes
- Rating with no identified dish → **not an NF-B event**; counting it as one is how the metric
  lies ([[taste-fingerprint-charter|taste-fingerprint]] §Metrics).
- Unverified check-in credited as verified → points farming (§7.3 abuse rule).
- No consent → cannot attribute → the guest is **not a subject** (correct refusal, not a bug).
- Non-idempotent credit → double points; ledger integrity broken.
- Exposure prior missing → recommendations collapse to a regional average.

## 9. Simulation & deploy gate
Synthetic engine generates guest cohorts, visits, and ratings; SimPOS
(`apps/api-gateway/src/simpos/`) verifies visits. Gate: the points ledger stays append-only
and idempotent under replay, and every NF-B event carries all four fields or is refused.
**Simulated before live — locked, no exception** (contract §5).

## 10. Tier cut (proposed — OD-48)
Core: capture visit + rating + points (operate). Plus: demand digest / segment scorecards
(understand). Pro: cross-entity demand → par/promote proposals + forecasting (optimize).
Price points open.

## 11. Evolution feedback
Which dishes guests rate and **repeat** teaches par and promotion; `divergence_within_cohort`
teaches whether the model personalizes or averages; what guests photograph enriches the
catalog. What the owner opens in the digest tells us which §6 story earns the subscription.

**Flex points:** verification channel (reservation vs POS vs QR), whether the restaurant funds
perks (opt-in, §7.4), rating granularity (per-dish vs per-visit), consent depth.
