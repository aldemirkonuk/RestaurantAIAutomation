---
type: loops
division: commercial
department: media-brand
team: narrative-collateral
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[narrative-collateral-charter]]"
  - "[[narrative-collateral-directive]]"
  - "[[media-brand-loops]]"
loop_count: 4
loop_count: 4
loop_count: 4
loop_ids: ["headline-claim-consistency-m2", "claim-substantiation", "narrative-freshness", "collateral-blocked-inputs"]
loop_close_times: ["monthly", "per-artifact", "quarterly", "weekly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Narrative & Collateral (M2) — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop.

---

## 1. Headline-claim consistency

```yaml
type: loop
id: headline-claim-consistency-m2
owner: narrative-collateral
measures: [collateral.artifacts_leading_with_sentence, collateral.distinct_headline_claims]
changes: [collateral.artifact_set]
inputs_from: [strategy-and-fundraising, design-partner-operations]
outputs_to: [media-brand, sales, growth]
close_time: monthly
status: proposed
```

**Two measures because one is a trap.** `artifacts_leading_with_sentence` can read 100%
while `distinct_headline_claims` is 3 — if three artifacts each lead consistently with their
own sentence. The second number is the one that catches proliferation, and it must be 1.

**Monthly**, matched to deadline cadence. Weekly would produce three empty runs and trip the
anti-sprawl rule.

---

## 2. Claim-substantiation

```yaml
type: loop
id: claim-substantiation
owner: narrative-collateral
measures: [collateral.numbers_with_source_line, collateral.numbers_total]
changes: [collateral.claims, collateral.artifact_set]
inputs_from: [editorial-gate, design-partner-operations]
outputs_to: [editorial-gate, strategy-and-fundraising]
close_time: per-artifact
status: proposed
```

**Closes inside a single artifact's production**, which is the fastest close-time available
here and the right one: a number without a source is caught before the artifact exists, not
audited after it ships.

**Target is equality, not a rate.** `numbers_with_source_line` must equal `numbers_total`.
A 90% substantiation rate on a five-number deck means one false claim in public.

**The standing case:** "dollars recovered" means *we asked* until an 812 credit memo lands
([YC_WEDGE_PLAN.md:31-33](../../../../YC_WEDGE_PLAN.md)). That single distinction is what
this loop exists to enforce.

---

## 3. Narrative freshness

```yaml
type: loop
id: narrative-freshness
owner: narrative-collateral
measures: [collateral.story_updated_at, wedge.argument_updated_at]
changes: [collateral.story, collateral.deck]
inputs_from: [strategy-and-fundraising, product-and-vision, design-partner-operations]
outputs_to: [media-brand]
close_time: quarterly
status: proposed
```

**A comparison loop, not a counter.** It closes by asking one question: has the underlying
argument moved since the story was last written? If
[YC_WEDGE_PLAN.md](../../../../YC_WEDGE_PLAN.md) or S1's recovery evidence is newer than the
story, the story is stale by definition and the loop produces work.

**Quarterly.** The argument does not move weekly, and a loop that asks a question with no
new input three times running gets deleted.

---

## 4. Blocked-input watch

```yaml
type: loop
id: collateral-blocked-inputs
owner: narrative-collateral
measures: [collateral.blocked_inputs_open, collateral.days_blocked]
changes: [collateral.production_order]
inputs_from: [design-partner-operations]
outputs_to: [media-brand]
close_time: weekly
status: proposed
```

**Small, and worth having, because the failure it prevents is silent.** Three inputs are
blocked at founding: the ElevenLabs visual reference (founder must supply — it is in a
personal Instagram account and nothing here can reach it), a verified recovery number (S1),
and `DEP-06` Toast credentials ([PROJECT.md:101](../../../../../PROJECT.md)).

`days_blocked` is the useful number. An input blocked for four weeks is either not actually
needed or not actually asked for, and both of those are actions.

**Weekly.** Fast enough that a blocked input becomes a conversation rather than a
justification.
