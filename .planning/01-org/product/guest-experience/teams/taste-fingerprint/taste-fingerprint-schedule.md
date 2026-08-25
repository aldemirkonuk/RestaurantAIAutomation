---
type: schedule
division: product
department: guest-experience
team: taste-fingerprint
status: provisional
metrics: [nf_b.event_completeness, nf_b.divergence_within_cohort, nf_b.novel_stimulus_hit_rate]
updated: 2026-08-24
links: ["[[taste-fingerprint-charter]]", "[[taste-fingerprint-loops]]", "[[taste-fingerprint-directive]]", "[[guest-experience-schedule]]", "[[skills-charter]]", "[[research-math-charter]]", "[[data-charter]]", "[[DISH_IDENTITY_DESIGN]]"]
---

# Taste Fingerprint (NF-B) — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Weekly | `nf-b-completeness-sweep` — share of events missing any of `stimulus` / `choice` / `outcome` / `context`, **broken out by which field**, so the fix is directed rather than general | `nf_b.event_completeness` |
| Per-model-version | `divergence-gate` — `nf_b.divergence_within_cohort` vs the previous version. **Blocks release on a fall, even when accuracy improves** | `nf_b.divergence_within_cohort` · `nf_b.regional_variance_share` |
| Monthly | `novel-stimulus-eval` — hit rate on stimuli the guest has never encountered, on held-out data | `nf_b.novel_stimulus_hit_rate` · `nf_b.compound_overlap_coverage` |
| Monthly | `baseline-coverage-check` — share of events carrying a home-region baseline in `context` | `nf_b.tourist_delta_coverage` |
| Monthly | `modal-item-check` — does the top recommendation for most guests coincide with the corpus's modal item? Cheap, and nearly diagnostic on a thin corpus | Escalation, or silence |
| Quarterly | `corpus-honesty-restatement` — re-measure the corpus the way [[DISH_IDENTITY_DESIGN]] §1.1 did (checks, restaurants, date span, line items, distinct strings) and restate what is and is not modellable | The standing food statement |
| On trigger | `a15-watch` — surfaces the food-track entry trigger (A15 reversed **and** a dish-identity referent exists) whenever a food taste graph is requested | — |

**Anti-sprawl.** A job producing no action for 3 consecutive runs is downgraded or
deleted ([[README]] §6). Two notes rather than exemptions: `divergence-gate` is not a
periodic job at all — it runs when a model version exists, so a quarter with no model
is not three silent runs. `corpus-honesty-restatement` is expected to produce the
*same* output for several quarters; that is its value, not its staleness — the
restatement is what stops the corpus claim drifting upward through repetition.

## Skills owned

Skills live in `.claude/skills/`. **The directory does not exist yet**
([[skills-charter]]), so these are proposals. Each names trigger, doneability, and a
real past instance per [[README]] §3.3.

### `nf-b-event-contract-lint` (T2)

- **Trigger.** Any code path that emits an NF-B event.
- **Doneability.** Rejects an event missing any of the four fields and names **which**
  one; rejects an event whose `context` lacks a home-region baseline; rejects a rating
  with no identified `stimulus` referent.
- **Real past instance.** `nf_b.event_completeness` is defined in the team layer
  ([[product]] §2.2) with **no enforcement anywhere**. Without a lint it is
  self-reported, and a self-reported completeness metric measures the reporter.

### `mechanism-decomposition-check` (T2)

- **Trigger.** Any new or changed predicted-preference output — model, heuristic, or
  ranking — before it reaches a surface.
- **Doneability.** Confirms the prediction decomposes into all four parts (exposure
  prior · regional weight · baseline delta · per-person residual) and that the residual
  is non-degenerate. A prediction that cannot be decomposed is a tag, whatever it is
  called ([[taste-fingerprint-directive]]).
- **Real past instance.** The founder's explicit instruction — model flavour at
  mechanism level, like chemistry or immunology, not generic tagging — currently
  exists only as prose in [[0006-neural-footprint-architecture]] and this charter set.
  Prose instructions degrade into tags by default, because tags are what is cheap.
  This skill is the enforcement.

### `corpus-honesty-restatement` (T2)

- **Trigger.** Any request for a guest taste model, a personalization feature, or a
  segment built on food data.
- **Doneability.** Returns the current measured corpus and the one-paragraph statement
  of what is and is not modellable, with the A15 citation — so answering the question
  costs nothing on the tenth asking and the answer does not soften with repetition.
- **Real past instance.** [[DISH_IDENTITY_DESIGN]] §1.1 exists precisely because
  deferring needed a design behind it rather than *"a gap someone rediscovers in a
  year"* (§preamble). The restatement is what keeps that from happening.

**Not proposed, and the reason is [[README]] §3.3 rule 3, not caution:** a
`taste-model` or `guest-personalization` skill. There is no real past instance — 37
distinct item strings across one day, zero NF-B events emitted. It gets proposed once
the wine-only track has fired a model at least once.

## Review

All three are reviewed against the 30-day staleness rule from the day
`.claude/skills/` exists. `mechanism-decomposition-check` will look stale while there
is no model to check. That is the trigger not occurring, not the skill going stale —
and the distinction is the whole content of the staleness review.
