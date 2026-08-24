---
type: loops
division: corporate
department: strategy-fundraising
status: provisional
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
updated: 2026-08-24
links: ["[[strategy-fundraising-charter]]", "[[strategy-fundraising-premortem]]", "[[strategy-fundraising-directive]]", "[[strategy-fundraising-schedule]]", "[[positioning-fundraise-readiness-loops]]", "[[metric-contract-truth-assurance-charter]]", "[[design-partner-operations-charter]]", "[[narrative-collateral-charter]]", "[[editorial-gate-charter]]", "[[standards-verification-charter]]", "[[instruments-equity-charter]]", "[[finance-pricing-charter]]", "[[conversion-funnel-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[LOOP-MAP]]", "[[OPEN-DECISIONS]]"]
loop_count: 5
loop_count: 5
loop_count: 5
loop_ids: ["str-claim-verification", "str-verb-strength", "str-wedge-coherence", "str-open-target-hygiene", "str-team-shape-review"]
loop_close_times: ["per_send", "per_claim", "monthly", "monthly", "quarterly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Strategy & Fundraising — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**The five loops here are the ones that cross out of the department.** Strategy has one
team, so there is no cross-team traffic to coordinate — the department layer earns its
existence only by owning the boundaries. Every loop below has at least one `inputs_from` or
`outputs_to` outside `strategy-fundraising`. The internal working loops — register upkeep,
send checklist, drift sweep — live in [[positioning-fundraise-readiness-loops]] and are
deliberately not repeated here.

**On close-times.** Two loops are **event-closed**: they fire per claim and per send, and
are silent otherwise. That is correct for a department whose failure mode arrives at a
specific moment (a send) rather than accumulating over a period. The periodic ones are set
at the slowest cadence that still catches their failure. A quarter with nothing to report
is a valid recorded outcome — except for L-STR-4, where *"nothing changed"* is itself the
finding.

---

## L-STR-1 — Claim verification, per send

```yaml
type: loop
id: str-claim-verification
owner: strategy-fundraising
measures: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count]
changes: [strategy.claim_register, strategy.outward_artifact, growth.published_content, media.collateral]
inputs_from: [positioning-fundraise-readiness, metric-contract-truth-assurance, design-partner-operations, standards-verification]
outputs_to: [narrative-collateral, editorial-gate, design-partner-operations, decision-office]
close_time: per_send
status: proposed
```

Fires every time a claim leaves the company and closes **before** it leaves, not after.
Asserts three things per claim: it is in the register; its evidence is a query id, a
`path:line` + symbol, or a recorded demo (never a plan); and it was re-verified since the
last change to its source.

**Event-closed rather than periodic on purpose, and this is the department's central design
choice.** `YC_WEDGE_PLAN.md:404` carries the words *"all re-confirmed 2026-07-27"* against
a claim that has since inverted — `ux-optimizer.controller.ts:55` now has the guard the
document says is absent. A monthly sweep produced that line. A gate at the moment of
sending would not have. The distinction is the difference between a claim that was true and
a claim that is true.

Baseline: **no register exists**, and the only measurable input — the seven sources in
`YC_WEDGE_PLAN.md` §6 — shows **≥2 drifted or inverted**, ≈29%. The first firing of this
loop will fail, which is the correct and useful outcome.

Counters [[strategy-fundraising-premortem]] M1 and M2.

---

## L-STR-2 — Verb strength on the headline metric

```yaml
type: loop
id: str-verb-strength
owner: strategy-fundraising
measures: [strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation]
changes: [strategy.claim_register, strategy.headline_claim, growth.published_content, sales.pitch]
inputs_from: [metric-contract-truth-assurance, design-partner-operations, analytics-bi]
outputs_to: [narrative-collateral, editorial-gate, growth, sales, red-team]
close_time: per_claim
status: proposed
```

The truth constraint made mechanical. Every claim about money — recovered, saved, returned,
caught — stops until two questions are answered: **what does the metric mean** (owned by
[[metric-contract-truth-assurance-charter]]) and **what number does the evidence actually
support** (owned by [[design-partner-operations-charter]], which counts only credits watched
landing).

Strategy may **weaken** either answer and may never strengthen it. That asymmetry is the
loop.

**The contract it enforces.** `YC_WEDGE_PLAN.md:31-33` — *"dollars recovered"* means **we
asked** until an X12 812 credit memo lands on a later invoice. The same document grades the
metric *"half vanity and half unverifiable"* at `:369-373`, sizes real recoverable error at
**0.3–1.5% of beverage spend**, and recommends leading with **cost drift caught** instead.
Neither metric is instrumented today (`corporate.md:446-448`), so this loop's current
reading is **"slide, not query"** rather than a percentage — and it stays that way until
somebody writes the query.

It fires **in both directions**. If a definition changes upstream such that a previously
published claim is now stronger than its evidence, this loop reopens against **already-sent
material**. That direction is the one everyone forgets, and it is
[[strategy-fundraising-directive]]'s escalation trigger 6.

Counters [[strategy-fundraising-premortem]] M1.

---

## L-STR-3 — Wedge coherence

```yaml
type: loop
id: str-wedge-coherence
owner: strategy-fundraising
measures: [strategy.wedge_sentence_lead_rate, strategy.surface_area_flag_count]
changes: [strategy.wedge_sentence, media.collateral_structure, growth.content_brief]
inputs_from: [narrative-collateral, growth, product-vision]
outputs_to: [narrative-collateral, growth, product-vision, red-team]
close_time: monthly
status: proposed
```

Reads whether every outward artifact still reduces to one sentence
(`YC_WEDGE_PLAN.md:312`), and counts the ones that describe the company by its surface area
instead. `:323-324` names surface area as the repo's biggest risk — *"a YC partner reads
that as no wedge"* — and this loop is the only instrument that would notice the warning
being ignored.

Two readings are alarms rather than observations:

- **Lead rate falling while artifact count rises** → the company is producing more material
  and saying less. Growth's content engine makes this the default drift, not an unlikely one.
- **The wedge sentence appearing in fewer artifacts than the org chart does** →
  [[strategy-fundraising-premortem]] M4, visible as a ratio before it is visible as a lost
  meeting.

Monthly rather than weekly because artifact volume at v0 is zero and a weekly reading of
zero teaches nothing. Shares its subject with [[narrative-collateral-charter]] M2's *one
headline claim* metric: M2 measures execution (does each artifact lead with it), this loop
measures the constant (is it still one sentence, and is it still the right one). If both
were owned in one place, the sentence would be revised to fit the artifacts rather than the
artifacts to fit the sentence.

---

## L-STR-4 — Open-target hygiene

```yaml
type: loop
id: str-open-target-hygiene
owner: strategy-fundraising
measures: [strategy.unresolved_target_age_days, strategy.unattributed_target_citations]
changes: [strategy.agenda_board, decisions.open_queue]
inputs_from: [finance-pricing, conversion-funnel, growth, sales]
outputs_to: [decision-office, finance-pricing, growth, sales, product-vision]
close_time: monthly
status: proposed
```

The **anti-drift** loop, and the only one where *"nothing changed"* is the finding rather
than a null result.

**OD-23** ([[OPEN-DECISIONS]]:27) rates *$20k MRR in 30 days* at under 10% likely against
locked $20–50/mo pricing — 400 to 1,000 paying restaurants in thirty days, with no
self-serve funnel built. It is a founder call, and this department does not answer it. What
this loop asserts monthly is narrower and enforceable:

1. The target's **unresolved status is reported by name**, including *"still open, day N,
   nothing changed."*
2. **No Commercial or Product plan quotes a revenue figure without the fork id attached.**
   A number quoted without its open decision is the drift, mid-flight — the loop counts
   those as `strategy.unattributed_target_citations`, and the count is expected to be
   non-zero before it is zero.
3. Two consecutive months unresolved escalates to [[decision-office-charter]], whose
   chartered job is that decisions close rather than drift ([[ORG_STRUCTURE]] §3).

If OD-23 resolves toward *"count signed/committed deals rather than collected cash"*, this
loop hands the result straight to **L-STR-2**: a redefined metric is legitimate internally
and is an overstatement externally unless the redefinition travels with it. *"$20k MRR"*
would then require *"committed, not collected"* permanently attached — the same discipline
as *dollars recovered*, one level up.

Counters [[strategy-fundraising-premortem]] M5.

---

## L-STR-5 — Does this department still need one team?

```yaml
type: loop
id: str-team-shape-review
owner: strategy-fundraising
measures: [strategy.readiness_vs_claim_item_ratio, strategy.diligence_pack_completeness, strategy.claim_to_evidence_coverage, strategy.split_trigger_age_days]
changes: [strategy.team_structure, strategy.charter, decisions.open_queue]
inputs_from: [positioning-fundraise-readiness, instruments-equity]
outputs_to: [decision-office, red-team, legal]
close_time: quarterly
status: proposed
```

The department was deliberately left unsplit (`corporate.md:405-415`), so this loop watches
the decision in **both** directions rather than only waiting for permission to grow.

**Split condition.** The trigger is the **first live term-sheet conversation, or the first
instrument actually issued** (`corporate.md:457-458`). When it fires, Fundraise Readiness
earns a standing cadence — a data room with real counterparties, a diligence Q&A log, a
clock — and separates. OD-C3 closes at that moment.

**Not-needed condition, decided now rather than argued later.** If **twelve months** pass
with no term-sheet conversation and no instrument issued, the readiness half is recorded as
*not a deferred team but an unneeded one*, and [[strategy-fundraising-charter]] is rewritten
to say so. This org names split triggers everywhere (`corporate.md:126`, `:398`, `:457`) and
merge or dissolve triggers almost nowhere, so structures only ratchet up.
[[legal-charter]] carries the same reverse rule as L-LEG-5; this is its sibling.

**Drift condition — the one most likely to fire first.** In any quarter where
`strategy.diligence_pack_completeness` rises while `strategy.claim_to_evidence_coverage`
does not, the deferred second team is growing inside the first one without ever being
chartered. That is [[strategy-fundraising-premortem]] M3, and it is readable as two metrics
moving in opposite directions before it is readable as a missed claim.

The loop also reads `strategy.agenda_content_diff_days` from
[[strategy-fundraising-schedule]]'s quarterly sweep — a date-bumped agenda with no content
change counts as untouched, because for a department with no raise in flight that is the
most likely disguise for having stopped.

---

## Close-time summary

| Loop | Close-time | Crosses out to | Counters |
|---|---|---|---|
| L-STR-1 claim verification | **per send** | Media, Growth, Sales, Decision Office | M1, M2 — a stale citation reaching a reader |
| L-STR-2 verb strength | **per claim** | Analytics & BI, Sales, Growth, Red Team | M1 — *recovered* when the evidence says *asked* |
| L-STR-3 wedge coherence | monthly | Media, Growth, Product & Vision | M4 — surface area read as no wedge |
| L-STR-4 open-target hygiene | monthly | Decision Office, Finance & Pricing, Commercial | M5 — OD-23 resolved by silence |
| L-STR-5 team-shape review | quarterly | Decision Office, Legal, Red Team | M3 — a fundraising department with no raise |

**Two loops are deliberately absent.** There is **no weekly anything** — the register is
empty, no artifact is in flight, and a weekly reading of zero is the theatre
[[ORG_STRUCTURE]] §4's 60-day rule correctly marks as fiction. And there is **no
raise-readiness cadence** at all until L-STR-5's split condition fires; inventing one now
would produce exactly the *"wait for a raise"* agenda that
[[strategy-fundraising-charter]] declined to charter as a team.
