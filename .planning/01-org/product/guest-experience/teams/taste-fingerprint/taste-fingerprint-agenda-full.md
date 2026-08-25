---
type: agenda-full
division: product
department: guest-experience
team: taste-fingerprint
status: provisional
metrics: [nf_b.event_completeness, nf_b.divergence_within_cohort, nf_b.tourist_delta_coverage, nf_b.novel_stimulus_hit_rate]
updated: 2026-08-24
links: ["[[taste-fingerprint-charter]]", "[[taste-fingerprint-premortem]]", "[[taste-fingerprint-agenda-board]]", "[[taste-fingerprint-directive]]", "[[taste-fingerprint-loops]]", "[[taste-fingerprint-schedule]]", "[[guest-identity-consent-charter]]", "[[guest-value-monetization-charter]]", "[[consumer-app-points-economy-charter]]", "[[data-charter]]", "[[research-math-charter]]", "[[0006-neural-footprint-architecture]]", "[[DISH_IDENTITY_DESIGN]]", "[[OPEN-DECISIONS]]"]
---

# Taste Fingerprint (NF-B) — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Two tracks with very different statuses, and conflating them is the team's first
available mistake.

**Wine — buildable.** Deterministic identity (`master_wine_library`, producer + name
+ residual tokens, 0 false merges over 732,874 pairs), a real corpus, enrichment in
flight (`f7e0ea1`, `ef19b81` — 144/1,448), and a stimulus that is genuinely
**compositional**: grape, region, vintage, producer style. Compound overlap between
two Barolos is a real quantity, which is exactly what the dose–response mechanism
needs and exactly what a tag cannot supply.

**Food — unbuildable, by decision.** A15 defers dish identity
([[DISH_IDENTITY_DESIGN]]); dishes stay raw POS strings; `stimulus` has no referent.
The corpus is 47 checks, one restaurant, one day, 37 distinct item strings, no
food/dish/recipe table at all. This team's food output for now is **one honest
sentence, repeated as often as it is asked for.**

Underneath both, the same four mechanisms ([[taste-fingerprint-charter]]): exposure as
a dose–response curve, region as a **prior weight** and never a posterior, tourist
adaptation as a **delta from a home baseline**, and a per-person residual that
exposure cannot explain — the sibling constraint.

## How

**Build the two honesty metrics before the first model, not after it.**
`nf_b.novel_stimulus_hit_rate` and `nf_b.divergence_within_cohort` are the only two
numbers that distinguish a mechanism from a tag, and both are *uncomfortable*: one
measures performance on stimuli the model has never seen, the other **rewards
disagreement between similar people**. Neither will be built after a conventional
accuracy number exists, because by then accuracy is the number and these two only
ever look like drag. This is [[taste-fingerprint-premortem]] T1 and T4, and the
counter-pressure is entirely a matter of ordering.

**Treat `context` as the load-bearing field, not metadata.** The NF-B event has four
fields and the temptation is to spend all the design effort on `stimulus` and
`choice`. But the tourist mechanism lives or dies in `context`: without a
**home-region baseline** on the event, a visitor's choice is not weakly informative,
it is *uninterpretable*, and a pile of uninterpretable observations averaged together
is precisely the regional-average failure. `nf_b.tourist_delta_coverage` exists to
keep that field from silently degrading into `{region: current}`.

**Model in the research store; serve from the production store.**
[[0006-neural-footprint-architecture]] resolved this (OD-11a) and the split is what
makes mechanism-level work affordable: the research log is deliberately wide and never
migrated, so a new mechanism field is an addition rather than a migration, and old
rows keep their shape. Mechanism modelling means adding fields as understanding
improves — a narrow production-only schema would have made every mechanism refinement
a migration and every migration a reason not to refine.

**Refuse to count, loudly and often.** A rating with no identified dish has no
`stimulus` and is not an NF-B event. Holding that line is most of this team's early
value, because the alternative — counting it — produces a metric that rises while the
thing it measures does not exist.

## Why now

- **Wine is ready and food is not, and that is a genuine opening rather than a
  consolation.** The strongest data layer in the repo is the one where the mechanism
  model has the best possible substrate. Starting where the stimulus is compositional
  means the four mechanisms get built against data that can falsify them.
- **The event contract must be settled before OD-11 closes.** OD-11 fixes production
  columns and the partial-index strategy per `subject_type`. If NF-B's four fields are
  not specified when that closes, NF-B gets whatever shape NF-A needed — and the
  mechanism fields that make this team's work possible become a later migration.
- **The honesty metrics are cheap now and unbuildable later.** See above; it is an
  ordering problem, and the ordering window is open exactly once.

**And why *not* now, stated plainly:** the food mandate is blocked by a decision this
team does not own and must not relitigate by building around it. Nothing below assumes
A15 reverses.

## Next steps

| # | Step | Depends on | Done when |
|---|---|---|---|
| 1 | Write the **NF-B event contract, wine-only** — what fills `stimulus`, `internal_state`, `choice`, `outcome`, `context` for a bottle, and what disqualifies an event | [[0006-neural-footprint-architecture]] | A written contract exists and is submitted **into** OD-11 rather than after it |
| 2 | Specify **`context`'s home-region baseline** field and how it is captured without asking the guest a survey question | 1, [[consumer-app-points-economy-charter]] | `nf_b.tourist_delta_coverage` is measurable |
| 3 | Instrument `nf_b.novel_stimulus_hit_rate` and `nf_b.divergence_within_cohort` **before any model** | 1 | Both return a number on an empty corpus — degenerate, but wired |
| 4 | Define the **compound-overlap representation** for wine: grape, region, vintage, producer style as compositional weights, not categories | [[data-charter]] wine enrichment | Two bottles have a real overlap quantity, not a tag-similarity score |
| 5 | Build the **exposure prior** — dose–response with asymmetric decay and a satiation inversion | 4, non-zero `nf_b.subject_coverage` | The prior predicts the satiation inversion on held-out repeat behaviour |
| 6 | Add the **per-person residual**, explicitly protected from regularization | 5, [[research-math-charter]] review | `nf_b.divergence_within_cohort` is non-zero and does not fall between model versions |
| 7 | Publish the **standing food statement** — what cannot be modelled and why, in one paragraph, linkable | none | It exists as a link, so answering the question costs nothing each time |

**Not doing:** any food taste graph, any model over raw POS strings, any merge-rule
proposal, any segment definition, and any accuracy number reported before steps 3's
two metrics are live.

## Questions for the founder

1. **OD-11 — will the NF-B event contract be an input to it, or a consequence of it?**
   This is a sequencing question with a real cost. If OD-11's columns are fixed for
   NF-A first, the mechanism fields NF-B needs — exposure priors, home baseline,
   per-person residual — arrive as a later migration against live partial indexes.
   This team is asking to submit the wine-only contract **into** that session.

2. **⚠️ The `subject_type` gap, from this team's angle.** The strongest human
   preference signal the company already collects is an **operator** rejecting a
   recommendation — `recommendation_actions`
   (`supabase/migrations/20260805000000_baseline_from_production.sql:4908`;
   `apps/api-gateway/src/analytics/recommendation-actions.service.ts:12-44`), carrying
   dismiss / snooze / done / pin / `helpful` · `not_helpful`. It is richer today than
   anything NF-B will hold for months, and `subject_type` is fixed to
   `agent | guest | bio`. From a modelling standpoint this matters twice: it is the
   **only real human-preference training data currently available**, and folding it
   into NF-A would change the subject of the record from the person who chose to the
   system that proposed — which breaks the stimulus → internal state → choice →
   outcome shape that makes NF-A and NF-B the same object at all
   ([[0006-neural-footprint-architecture]]). This team does not propose an answer; it
   asks that the question be **answered before OD-11 closes**, because afterwards it
   is a migration.

3. **Is `nf_b.divergence_within_cohort` allowed to block a release?**
   [[taste-fingerprint-premortem]] T4 proposes that a model reducing within-cohort
   divergence does not ship *even if accuracy improves*. That is a real and
   uncomfortable gate — it means declining a model that is better by every
   conventional measure — and it should be endorsed now, while it is hypothetical,
   rather than argued about with a shipped improvement on the table.

4. **Does the food statement need to be public?** The honest answer to "what does the
   AI know about food preferences" is currently *nothing, by decision*. Whether that
   sentence appears in product surfaces or only internally is a positioning call, not
   a technical one.
