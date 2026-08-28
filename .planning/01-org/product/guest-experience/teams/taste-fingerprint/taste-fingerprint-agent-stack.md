---
type: agent-stack
division: product
department: guest-experience
team: taste-fingerprint
status: designed
updated: 2026-08-27
metrics: [nf_b.event_completeness, nf_b.divergence_within_cohort, nf_b.tourist_delta_coverage, nf_b.exposure_prior_coverage]
links: ["[[taste-fingerprint-charter]]", "[[taste-fingerprint-schedule]]", "[[taste-fingerprint-loops]]", "[[taste-fingerprint-directive]]", "[[0034-agent-stack-artifact]]", "[[0029-p3-plan-of-record]]", "[[0006-neural-footprint-architecture]]", "[[0008-nf-column-contract]]", "[[guest-experience-agent-stack]]", "[[DISH_IDENTITY_DESIGN]]", "[[skills-charter]]"]
---

# Taste Fingerprint (NF-B) — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The food mandate is unbuildable by an explicit product-owner call (A15) over a corpus
> of **37 distinct item strings**, and the subject side is empty because **NF-B is HELD**
> ([[0029-p3-plan-of-record]] §3). So this is not a modelling agent. Its live job is to
> keep saying, accurately and cheaply, what cannot be modelled — and to refuse the two
> moves that would make the corpus look adequate: a taste graph over raw POS strings,
> and counting a rating with no identified `stimulus` as an NF-B event.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `taste-corpus-steward` | Re-measure the corpus on a fixed cadence and restate what is and is not modellable with its citation, lint any NF-B event that does get emitted, and refuse a prediction that cannot decompose into the four mechanisms | NEW |

## 2. Agent cards

```yaml
agent: taste-corpus-steward
unit: taste-fingerprint
triggers:
  - schedule: "weekly — nf-b-completeness-sweep"        # mirrored in [[taste-fingerprint-schedule]]
  - schedule: "quarterly — corpus-honesty-restatement"
  - topic: nf_b.event_emitted                            # publisher: NONE (gap — see §5)
  - topic: model.version_published                       # publisher: NONE (gap — no model exists; divergence-gate is inert until one does)
consumes:
  - "neural_footprint_event where subject_type = 'guest' (20260824141116_neural_footprint_event.sql:23-24, index :51-54) — zero rows"
  - "the corpus measurement method of [[DISH_IDENTITY_DESIGN]] §1.1 (47 pos_checks, 1 restaurant, one day, 82 line items, 37 distinct strings)"
  - "master_wine_library and the deterministic beverage key (0 false merges over 732,874 pairs, cited at 20260819000000_guest_identity_minimal_slice.sql:246-252)"
emits:
  - the standing food statement into [[taste-fingerprint-agenda-full]] and any session that asks for a taste model
  - "nf_b.event_completeness → [[guest-experience-agent-stack]]'s weekly rollup, as `undefined` until an event exists"
  - nf_a events (task_type: corpus_restatement, nf_b_event_lint)
routing_class: extraction
quality_bar: "the restatement is graded on whether it **re-measured** rather than re-quoted — a run that reproduces last quarter's numbers without touching the corpus is a failed run even when the numbers are right. For the lint: NONE (gap) — no NF-B event has ever been emitted, so the lint has never been exercised"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant
memory: taste-fingerprint
escalates_to: "[[guest-experience-charter]]"
```

**Three hard rules.** The steward never proposes a merge-rule change in any form — this
team is the *source* of the pressure named in [[guest-identity-consent-premortem]] F1,
and its own card saying so is part of the defence. It never builds a taste graph over
raw strings, because building around A15 is relitigating it. And it never writes an NF-B
caller while the hold stands. `routing_class` is `extraction` because the only available
work is measuring and restating; the card is **re-graded to `judgment` the day a model
version exists**, since grading the decomposition check now prices work nobody can do yet.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `nf-b-event-contract-lint` | T2 | Any code path that emits an NF-B event | Rejects an event missing any of the four fields and names **which**; rejects a `context` with no home-region baseline; rejects a rating with no identified `stimulus` referent | `nf_b.event_completeness` is defined with no enforcement anywhere, and the schema cannot supply it: `context` and `internal_state` are `not null default '{}'::jsonb` (`20260824141116_neural_footprint_event.sql:28-29`), so an empty-but-present jsonb satisfies the table. Completeness is therefore a lint property or a self-report | NEW |
| `mechanism-decomposition-check` | T2 | Any new or changed predicted-preference output — model, heuristic, or ranking — before it reaches a surface | Confirms the prediction decomposes into exposure prior · regional weight · baseline delta · per-person residual, and that the residual is non-degenerate. A prediction that cannot be decomposed is a tag, whatever it is called | The founder's mechanism-level instruction exists only as prose, in [[0006-neural-footprint-architecture]] and this charter set. Prose instructions degrade into tags by default, because tags are what is cheap ([[taste-fingerprint-directive]]) | NEW |
| `corpus-honesty-restatement` | T2 | Any request for a guest taste model, a personalization feature, or a segment built on food data | Returns the **currently measured** corpus and the one-paragraph statement of what is and is not modellable, with the A15 citation | [[DISH_IDENTITY_DESIGN]] §1.1 exists because deferring needed a design behind it rather than *"a gap someone rediscovers in a year"*. The restatement is what stops the corpus claim drifting upward through repetition | NEW |

**Not proposed, per README §3.3 rule 3 and not caution:** a `taste-model` or
`guest-personalization` skill. Zero NF-B events have been emitted; there is no past
instance to cite. It is proposed once the wine track has fired a model at least once.

Consumed, owned elsewhere: modelling technique and NF-A methodology
([[research-math-charter]]); the NF column contract ([[0008-nf-column-contract]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: corpus_restatement` and `nf_b_event_lint`, with
  `context.corpus_snapshot` carrying the five measured numbers so a quarter-on-quarter
  diff is a query rather than a re-read. NF-B contributes nothing here: the guest index
  has no writer, which is the team's condition, not a gap to route around.
- **Semantic** — `memory/` beside this file, one fact per file with `source` /
  `confidence` / `last_verified`; index `taste-fingerprint-MEMORY.md`. Founding facts:
  the measured corpus with its date; A15's wording and who called it; the wine key's
  0-false-merges-over-732,874-pairs result and where it is cited; and the **corrected**
  provenance of the "strongest data layer" claim ([[product]] §2.2 attributed it to
  `README.md:64`, which does not support it). Every write is a PR.
- **Working** — this card, the MEMORY index, charter §The mechanism model. The catalog
  and the wine library are `path:line` retrieval targets.

**Consolidation** — monthly: compare the current corpus snapshot against stored facts; a
corpus that grew without a dish referent becomes a fact saying exactly that, **failures
first**; expire facts unverified 90 days; propose skill candidates. One PR. "No delta"
is the expected output for several quarters, and the schedule already names why that is
value rather than staleness.

## 5. Async contract

Interaction is loops ([[taste-fingerprint-loops]]: `nf-b-event-completeness`,
`nf-b-cohort-divergence`, `nf-b-novel-stimulus`, `nf-b-tourist-baseline`), NF-A events,
and vault PRs. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `nf_b.event_emitted` has no publisher | The guest partial index exists and nothing writes it; only `subject_type='agent'` is emitted anywhere. Every metric on this card is `undefined`, not zero, and the distinction is load-bearing |
| `stimulus` has no referent for food | Dish identity is deferred (A15) and owned by [[data-charter]]; nobody is producing the referent this team consumes. The steward is the loudest consumer of a decision it does not own |
| The emitting surface does not exist | [[consumer-app-points-economy-charter]] is the publisher of the events this team would consume, and it is unstaffed and gated on OD-07. Two units on both sides of one seam, neither running |
| `model.version_published` has no publisher | `divergence-gate` is not periodic — it runs when a model version exists. Nothing announces one, so the gate is inert rather than silent |

## 6. Evidence today

- **NEW — the steward and all three skills.** Nothing lints, measures, or restates today.
- **EXISTS — the substrate, unwritten.** `neural_footprint_event` shipped 2026-08-24
  with the guest partial index (`:51-54`) and zero guest rows. `master_wine_library` and
  the deterministic beverage key are real and are the team's only opening.
- **⚠️ The charter's entry trigger reads as satisfied, and this doc does not act on it.**
  The wine-only track was to enter *"when OD-11's column contract closes"*; the register
  records OD-11 **closed 2026-08-24** — Path C, full ADR 0006 production shape, decided
  by the founder over Claude's recommendation ([[0008-nf-column-contract]]) — and the
  production table shipped the same day. Whether the track activates is
  [[guest-experience-charter]]'s call and the founder's, not this artifact's. Recorded
  here because three guest charters still read OD-11 as open.
- **⛔ NEW and blocked — the food track**, unchanged: A15 stands, and the corpus is
  what [[DISH_IDENTITY_DESIGN]] §1.1 measured.
