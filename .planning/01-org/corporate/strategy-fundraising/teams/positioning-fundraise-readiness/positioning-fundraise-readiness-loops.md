---
type: loops
division: corporate
department: strategy-fundraising
team: positioning-fundraise-readiness
status: provisional
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
updated: 2026-08-24
links: ["[[positioning-fundraise-readiness-charter]]", "[[positioning-fundraise-readiness-premortem]]", "[[positioning-fundraise-readiness-directive]]", "[[positioning-fundraise-readiness-schedule]]", "[[strategy-fundraising-loops]]", "[[metric-contract-truth-assurance-charter]]", "[[design-partner-operations-charter]]", "[[narrative-collateral-charter]]", "[[standards-verification-charter]]", "[[instruments-equity-charter]]", "[[decision-office-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_ids: ["pfr-register-entry", "pfr-verb-strength", "pfr-citation-drift", "pfr-wedge-reduction", "pfr-readiness-balance"]
loop_close_times: ["per_claim", "per_claim", "monthly", "monthly", "quarterly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Positioning & Fundraise Readiness — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**These five loops stay inside the department.** The five in
[[strategy-fundraising-loops]] all cross out of it — to Analytics & BI, Media & Brand,
Sales, Growth, Legal, Decision Office. The division of labour is exact and is what stops
fourteen documents for a one-team department from being seven documents written twice: the
department layer holds boundaries, this layer holds the desk.

**On close-times.** Two are event-closed and fire per claim; two are monthly; one is
quarterly. None is weekly, for the same reason the department has no weekly job — there is
nothing yet whose failure accumulates in a week.

---

## L-PFR-1 — Register entry, per claim

```yaml
type: loop
id: pfr-register-entry
owner: positioning-fundraise-readiness
measures: [strategy.claim_to_evidence_coverage, strategy.registered_claim_count, strategy.rejected_claim_count]
changes: [strategy.claim_register]
inputs_from: [narrative-collateral, editorial-gate, design-partner-operations, growth, sales]
outputs_to: [positioning-fundraise-readiness, strategy-fundraising]
close_time: per_claim
status: proposed
```

Fires when any claim is proposed for outward use and closes before it is sent. Asserts the
four-column schema: the claim **verbatim** (paraphrase hides the verb, and the verb is what
is being checked), the audience and channel, evidence of an accepted type, and a
verification result.

**The rejection path is the load-bearing half.** A claim whose evidence is a plan —
*"this will be queryable after B5"* — is rejected, not deferred, and the rejection is
recorded. `strategy.rejected_claim_count` rising is a **healthy** reading; it means the gate
is meeting real pressure. A rejection count that stays at zero while claims are being sent
means the gate is not being run.

Baseline: **no register exists.** First firing establishes whether the schema survives
contact with a deadline — the only test that matters for
[[positioning-fundraise-readiness-premortem]] P1.

---

## L-PFR-2 — Verb-strength check, per claim

```yaml
type: loop
id: pfr-verb-strength
measures: [strategy.claim_overstatement_count, strategy.weakened_claim_count]
owner: positioning-fundraise-readiness
changes: [strategy.claim_register, strategy.claim_text]
inputs_from: [metric-contract-truth-assurance, design-partner-operations, analytics-bi]
outputs_to: [narrative-collateral, editorial-gate, strategy-fundraising]
close_time: per_claim
status: proposed
```

The operational half of [[strategy-fundraising-loops]] L-STR-2. Where L-STR-2 governs the
department's relationship with Analytics and Sales, this loop is the actual rewrite: given a
metric contract and a produced number, **what verb ships.**

Three canonical rewrites, fixed now so they are not re-argued per artifact:

| Wanted | Ships as | Because |
|---|---|---|
| *"$X recovered"* | *"$X in billing discrepancies identified"* — or *"$X recovered"* **only** for credits watched landing | `YC_WEDGE_PLAN.md:31-33` — until an 812 lands, it means *we asked* |
| *"Security complete"* | *"ux-optimizer secured"* | `:339` is accurate in its body; the track **label** overstates while 94 endpoints are unguarded by omission |
| *"$20k MRR"* — if OD-23 resolves to committed-not-collected | *"$20k MRR committed"*, permanently attached | A redefined metric is legitimate internally and an overstatement externally unless the redefinition travels with it |

`strategy.weakened_claim_count` is tracked alongside the overstatement count on purpose:
**weakening is the success state**, rejection is the fallback
([[positioning-fundraise-readiness-directive]] R7). A gate that mostly rejects gets routed
around by the second deadline; a gate that mostly rewrites gets used.

Counters [[strategy-fundraising-premortem]] M1.

---

## L-PFR-3 — Citation drift sweep

```yaml
type: loop
id: pfr-citation-drift
owner: positioning-fundraise-readiness
measures: [strategy.citation_drift_rate, strategy.unverified_citation_age_days]
changes: [strategy.claim_register, strategy.evidence_type_mix]
inputs_from: [standards-verification, engineering]
outputs_to: [strategy-fundraising, standards-verification, narrative-collateral]
close_time: monthly
status: proposed
```

Monthly, over every citation in the register and in `.planning/YC_WEDGE_PLAN.md` §6. Writes
a **result** per citation — `holds` · `drifted to :N` · `inverted` · `gone` — never a date
([[positioning-fundraise-readiness-directive]] R2).

**This loop is explicitly a backstop, not the primary control.** The primary control is the
per-send gate in L-PFR-1, because a monthly sweep is precisely what produced
`YC_WEDGE_PLAN.md:404`'s *"all re-confirmed 2026-07-27."* The sweep exists to catch drift in
material that is *not* currently being sent, and to keep the baseline honest between sends.
Confusing the two is [[positioning-fundraise-readiness-premortem]] P2.

**Baseline, measurable today:** ≥2 of 7 sources in §6 have drifted or inverted — ≈29%.
Two verified instances: `:401`'s `ReceivingWorkspace.tsx:233,265` → now `:401,440` (finding
holds, coordinates moved), and `:404`'s ux-optimizer guard claim, now inverted by
`ux-optimizer.controller.ts:55`.

**A zero-drift reading on a document older than a month is treated as a defect** until
proven otherwise. It more likely means the checker failed to resolve the paths than that
nothing moved.

Second measure, `strategy.unverified_citation_age_days`, tracks the **oldest** unverified
citation rather than the average — an average hides the one that will be checked.

Also reads the **evidence-type mix**. If `path:line` citations are growing as a share of the
register while demos are not, the drift rate is structurally destined to rise, and that is
visible a quarter before it happens.

---

## L-PFR-4 — Wedge reduction, per artifact batch

```yaml
type: loop
id: pfr-wedge-reduction
owner: positioning-fundraise-readiness
measures: [strategy.wedge_sentence_lead_rate, strategy.surface_area_flag_count]
changes: [strategy.claim_register, strategy.artifact_feedback]
inputs_from: [narrative-collateral, growth, sales]
outputs_to: [narrative-collateral, strategy-fundraising]
close_time: monthly
status: proposed
```

Reads whether each artifact sent that month reduced to the wedge sentence
(`YC_WEDGE_PLAN.md:312`) in its first paragraph, and counts the ones that described the
company by its surface area instead.

**This loop flags; it does not block** — [[positioning-fundraise-readiness-directive]]'s
graph sends anyway. The reason is a deliberate trade: wedge coherence is a judgment call,
and a gate that blocks on judgment gets routed around, taking the three non-judgment gates
(register, evidence type, verb) with it. Better a flag that is always counted than a block
that is sometimes bypassed.

`YC_WEDGE_PLAN.md:323-324`'s prescription is the standard applied: *"none of it needs
deleting — but one thing has to be the headline, and the rest becomes 'and it also does
X'."* **Explaining the surface area is the failure mode; subordinating it is the job.** An
artifact that argues why the sommelier AI, the calendar and the insight catalogue are
coherent is flagged even if every sentence in it is true.

Counters [[strategy-fundraising-premortem]] M4. Its sibling is
[[narrative-collateral-charter]] M2's *one headline claim* metric — M2 measures execution
per artifact, this loop measures the rate across the batch. Different owners on purpose: a
single owner would revise the sentence to fit the artifacts.

---

## L-PFR-5 — Readiness-vs-claim balance

```yaml
type: loop
id: pfr-readiness-balance
owner: positioning-fundraise-readiness
measures: [strategy.diligence_pack_completeness, strategy.claim_to_evidence_coverage, strategy.readiness_vs_claim_item_ratio, strategy.split_trigger_age_days]
changes: [strategy.work_allocation, strategy.diligence_index]
inputs_from: [instruments-equity, strategy-fundraising]
outputs_to: [strategy-fundraising, decision-office]
close_time: quarterly
status: proposed
```

The team-level early warning for the department's structural risk. It reads **two metrics
against each other** rather than either alone:

- `strategy.diligence_pack_completeness` **rising** while
  `strategy.claim_to_evidence_coverage` **does not** → the deferred second team is growing
  inside this one, un-chartered. [[positioning-fundraise-readiness-premortem]] P4.
- Any diligence artifact existing **before** the split trigger fires, beyond the one-page
  index → R4 breached. One instance is the signal.

It also enforces the **denominator**: completeness is measured against *questions a diligence
reader would ask*, each with a named answer location — never against a template's slots. A
pack answering 40% of real questions beats one filling 100% of a template, and the metric
must be able to express that. Where it cannot, the metric is rewritten before it is reported.

`strategy.split_trigger_age_days` is the counter that feeds
[[strategy-fundraising-loops]] L-STR-5's twelve-month not-needed condition. This team
measures it; the department decides what it means.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-PFR-1 register entry | **per claim** | P1 — a register that exists but is not run |
| L-PFR-2 verb strength | **per claim** | M1 — *recovered* when the evidence says *asked* |
| L-PFR-3 citation drift | monthly (backstop; the gate is per-send) | P2 — verification as a timestamp |
| L-PFR-4 wedge reduction | monthly, flag-only | M4 — surface area read as no wedge |
| L-PFR-5 readiness balance | quarterly | P4 — completeness by document count |

**No loop covers P3 or P5, and that is deliberate.** P3 (this team writes the deck) and P5
(truth enforced downward only) are **cultural** failures, not measurable ones — the signals
named in [[positioning-fundraise-readiness-premortem]] are structural checks
(author ≠ verifier; zero `channel: spoken` rows) rather than closing loops. Building a loop
around them would produce a metric that reports compliance while the practice erodes, which
is the failure itself wearing a dashboard. They are handled by
[[positioning-fundraise-readiness-directive]] R5/R6/R8 and by
[[red-team-charter]] as an external reader. Saying so here is more honest than inventing a
sixth loop.
