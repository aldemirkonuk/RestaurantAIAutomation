---
type: loops
division: commercial
department: growth
team: editorial-gate
status: provisional
metrics: [editorial.claims_traceable_pct, editorial.rejection_rate, editorial.gate_bypass_count, editorial.overstated_claim_catches, editorial.claims_now_stale]
updated: 2026-08-24
links: ["[[editorial-gate-charter]]", "[[editorial-gate-premortem]]", "[[editorial-gate-directive]]", "[[editorial-gate-schedule]]", "[[growth-loops]]", "[[content-production-loops]]", "[[brand-identity-charter]]", "[[design-partner-operations-charter]]", "[[LOOP-MAP]]"]
---

# Editorial Gate — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-G3-1 — Verdict health

```yaml
type: loop
id: g3-verdict-health
owner: editorial-gate
measures: [editorial.rejection_rate, editorial.overstated_claim_catches, editorial.gate_bypass_count, editorial.verdicts_by_check]
changes: [editorial.banned_construction_list, demand.brief_format, content.template]
inputs_from: [content-production, brand-identity, search-demand-research]
outputs_to: [content-production, growth, red-team]
close_time: weekly
status: proposed
```

The gate reading **its own verdicts**, which is the only way M2 is detectable. Three
readings, all of them in the distribution rather than the total:

- **Rejection rate at 0% for two close-times** means the gate has stopped reading. Not clean
  input. This is the headline signal.
- **Verdicts concentrated in checks 3 and 4** — construction and voice — while check 1 has
  produced nothing means the gate has become a proofreader
  ([[editorial-gate-premortem]] M2).
- **Rejection rate climbing steeply** means the brief or the voice guide is wrong. The change
  goes upstream to [[content-production-loops]] or [[brand-identity-charter]], never to
  harsher editing.

`editorial.gate_bypass_count` is read here weekly because a bypass is **discovered**, not
reported: it is a published page with no committed verdict artifact, and the weekly diff is
what makes the absence visible.

---

## L-G3-2 — Rule amendment

```yaml
type: loop
id: g3-rule-amendment
owner: editorial-gate
measures: [editorial.cases_with_no_guide_clause, editorial.disputed_verdicts, editorial.banned_list_size]
changes: [editorial.banned_construction_list, brand.voice_guide]
inputs_from: [brand-identity, content-production]
outputs_to: [brand-identity, content-production, decision-office]
close_time: monthly
status: proposed
```

The mechanism that stops [[editorial-gate-premortem]] M3. Every verdict that could not cite a
clause is collected, and monthly those cases either become entries in the
banned-construction list (G3's document) or amendments to the voice guide
([[brand-identity-charter]]'s document). **The case becomes the rule; the arguer never
does.**

The loop also watches its own document for bloat: a banned-construction list that only grows
becomes unenforceable, and an entry that has not fired in two quarters is reviewed for
removal — the same anti-sprawl logic applied to skills and schedules
([[README]] §3.3, §6).

**Runnable today.** It needs verdicts to have content, but the amendment mechanism itself can
be defined now, and the "no guide" counter starts at whatever number M1's absence produces.

---

## L-G3-3 — Published-claim re-audit

```yaml
type: loop
id: g3-published-claim-reaudit
owner: editorial-gate
measures: [editorial.claims_traceable_pct, editorial.claims_now_stale, editorial.overstated_claim_catches]
changes: [content.published_corpus, editorial.provenance_record]
inputs_from: [design-partner-operations, narrative-collateral, content-production]
outputs_to: [content-production, growth, red-team, decision-office]
close_time: quarterly
status: proposed
```

G3's half of [[growth-loops]] L-GRO-5. A claim that was true at publication decays: a
recovery figure, a customer count, an integration list, a "used by" logo. Every published
claim is re-checked against its source.

**The standing obligation, named rather than implied:** if *dollars recovered* appears
anywhere in the corpus, this loop verifies quarterly that an 812 credit memo still backs it
([[YC_WEDGE_PLAN]]:31-33), sourced through [[design-partner-operations-charter]]. A claim
that has gone stale is **corrected on the page**, not quietly deleted — deletion leaves the
screenshot in circulation and removes the record that it was ever said.

Quarterly, and **complete rather than sampled**, while the corpus is small enough for that to
be possible. When it stops being possible the close-time changes and this loop says so rather
than silently switching to a sample.

**Partly runnable today**, uniquely among Growth's loops: the recovery claim exists in
[[YC_WEDGE_PLAN]] and in whatever the company says out loud, and it can be audited before a
single page is published.

---

## Close-time summary

| Loop | Close-time | Counters | Can it close today? |
|---|---|---|---|
| L-G3-1 verdict health | weekly | premortem M1, M2 | No — no verdicts yet |
| L-G3-2 rule amendment | monthly | premortem M3 | Partly — the mechanism and the "no guide" counter can start now |
| L-G3-3 published-claim re-audit | quarterly | premortem M4, M1 | Partly — the recovery claim is auditable before publication |

**G3 is the least blocked team in Growth.** None of its four founding artifacts — provenance
format, banned-construction list, verdict artifact, claim-strength rule — requires a
publishing target, a CMS, or a written word of content. That is the argument for doing this
work first ([[editorial-gate-agenda-full]]), and it is also the reason a delay here would be
a choice rather than a dependency.
