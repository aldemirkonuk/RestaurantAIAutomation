---
type: agenda-board
division: product
department: guest-experience
team: taste-fingerprint
status: provisional
metrics: [nf_b.event_completeness, nf_b.divergence_within_cohort, nf_b.novel_stimulus_hit_rate]
updated: 2026-08-24
links: ["[[taste-fingerprint-charter]]", "[[taste-fingerprint-agenda-full]]", "[[taste-fingerprint-premortem]]", "[[taste-fingerprint-directive]]", "[[guest-experience-agenda-board]]", "[[DISH_IDENTITY_DESIGN]]"]
---

# Taste Fingerprint (NF-B) — Board

> **PROVISIONAL — no work done yet.**

**Personalization is per-person, not per-region-average.** Every item below exists to
make that enforceable.

## This team's artifacts

```dataview
TABLE type, status, updated
FROM "01-org/product/guest-experience/teams/taste-fingerprint"
WHERE type != "agenda-board"
SORT type ASC
```

## What blocks this team, and who owns it

```dataview
TABLE team, status, updated
FROM "01-org/product/guest-experience"
WHERE type = "charter" AND team != this.team AND team
SORT status ASC
```

## Status — **PARTIAL**, split across two tracks

- [x] Wine — **buildable**: deterministic identity, real corpus, enrichment in flight (`f7e0ea1`, `ef19b81` · 144/1,448)
- [ ] Food — ⛔ **unbuildable by decision**: A15 defers dish identity; `stimulus` has no referent
- [ ] Corpus: 47 checks · **1** restaurant · **one day** · 82 line items · **37 distinct strings** · no food/dish table
- [ ] Subject side: `nf_b.subject_coverage` **structurally 0%** — nobody to attribute a choice to
- [x] Storage architecture resolved — OD-11a, narrow production + wide append-only research log
- [ ] ⚠️ **OD-11 column contract open** — no NF-B event can be written until it closes

## The four mechanisms — not tags

- [ ] **Exposure = dose–response curve** · asymmetric decay · satiation inversion
- [ ] **Region = prior weight, never posterior** · the moment region determines output, it is a lookup table
- [ ] **Tourist = delta from a home baseline** · without it a visitor's choice is *uninterpretable*, not merely weak
- [ ] **Per-person residual** · the sibling constraint · **protected from regularization by design**

## Metrics

- [ ] `nf_b.event_completeness` — undefined · a rating with no identified dish is **not an event**
- [ ] `nf_b.divergence_within_cohort` — undefined · **gate, not observation**: a model that reduces it does not ship
- [ ] `nf_b.tourist_delta_coverage` — undefined
- [ ] `nf_b.exposure_prior_coverage` — undefined
- [ ] `nf_b.novel_stimulus_hit_rate` — undefined · **the tag/mechanism discriminator**; a tag cannot beat chance here

## Escalate on sight

- [ ] The words **category · label · tag** where *weight · exposure · baseline* belong
- [ ] `nf_b.divergence_within_cohort` falling while accuracy rises — the T4 tell
- [ ] Any NF-B claim rendered **without its n**
- [ ] A top recommendation that is also the corpus's modal item
- [ ] ⛔ Any artifact **from this team** naming the merge rule as a *cause* of low coverage — constraint yes, cause never

## Next three acts

- [ ] Write the wine-only NF-B event contract and submit it **into** OD-11, not after
- [ ] Instrument `novel_stimulus_hit_rate` + `divergence_within_cohort` **before the first model**
- [ ] Publish the standing food statement, once, as a link
