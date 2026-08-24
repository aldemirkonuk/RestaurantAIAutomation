---
type: charter
division: corporate
department: strategy-fundraising
status: new
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
updated: 2026-08-24
links: ["[[strategy-fundraising-premortem]]", "[[strategy-fundraising-agenda-full]]", "[[strategy-fundraising-agenda-board]]", "[[strategy-fundraising-directive]]", "[[strategy-fundraising-loops]]", "[[strategy-fundraising-schedule]]", "[[positioning-fundraise-readiness-charter]]", "[[ORG_STRUCTURE]]", "[[corporate]]", "[[README|foundation-README]]", "[[OPEN-DECISIONS]]", "[[legal-charter]]", "[[instruments-equity-charter]]", "[[media-brand-charter]]", "[[narrative-collateral-charter]]", "[[analytics-bi-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[sales-charter]]", "[[design-partner-operations-charter]]", "[[growth-charter]]", "[[editorial-gate-charter]]", "[[finance-pricing-charter]]", "[[standards-verification-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]"]
---

# Strategy & Fundraising — Charter

Parent division: **Corporate** ([[ORG_STRUCTURE]] §2). Siblings in-division: Legal,
Knowledge & Documentation, Compliance & Privacy, People & Agent Ops.

> **This department owns the claim, not the paper and not the craft.** It decides what
> the company says about itself to outsiders and whether that is true; [[legal-charter]]
> drafts the instruments; [[media-brand-charter]] builds the artifacts. If a file in this
> tree starts drafting a SAFE or laying out a deck, it has crossed a boundary this charter
> exists to hold.

## Mandate

Strategy & Fundraising is accountable for **the story the company tells outsiders, and for
that story being provable at the moment it is told.** Concretely: the wedge and the one
sentence; the competitive read; the investor narrative and materials; the YC path; the
diligence surface (data room, cap-table hygiene, metric provenance); and **sequencing
requests into [[instruments-equity-charter]]** for SAFE, board consent, stock purchase and
advisor agreements (`.planning/foundation/teams/corporate.md:417-422`).

It also carries one duty that points *upward* rather than outward: it is the last unit
between an internal number and an external audience, so it is the unit that must refuse a
claim the evidence does not support — including when the claim is the founder's own.

## Boundaries

Owns outright:

- **The wedge sentence** — what the company is, in one sentence, and whether it is still
  the right one. Today: *"Restaurants get overbilled by their distributors and never catch
  it. We catch it from a photo of the invoice."* (`.planning/YC_WEDGE_PLAN.md:312`).
- **The claim register** — every claim currently in force in outward material, its
  evidence (a query, a `path:line`, or a reproducible demo), and the date that evidence
  was last re-verified.
- **The verb-strength rule** — a published claim uses the weakest verb its evidence
  supports. This is where the truth constraint below is enforced.
- **The competitive read** — the honest MarginEdge comparison at `YC_WEDGE_PLAN.md:328`
  and whatever supersedes it.
- **Whether and when to raise**, and against what instrument class — prepared here,
  decided by the founder.
- **The diligence surface** — data-room index, metric provenance, and the answer to
  "where does this number come from?" before somebody outside asks it.
- **The YC path** — application timing, the sixty-second demo, and the surface-area
  discipline `YC_WEDGE_PLAN.md:323-324` demands.

Structured as **one team**:

| Team | What it owns |
|---|---|
| [[positioning-fundraise-readiness-charter]] | All of the above, as one cadence |

### One team — and this is a finding, not an oversight

`corporate.md:405-415` flags this as **the department that genuinely should not split**,
and this charter states the reasoning rather than inheriting it silently.

The brief that commissioned the team layer anticipated two units: a narrative function and
a fundraise-instrument function. **The second has no mandate of its own at v0.** Legal
drafts the paper (`corporate.md:67-70`), the founder decides the terms
(`corporate.md:505-506`), and what is left is diligence-pack assembly — a checklist, not a
standing unit. A second team here would have a weekly agenda reading *"wait for a raise"*,
and [[ORG_STRUCTURE]] §4's own anti-sprawl rule would mark it fiction inside 60 days.
That is org cosplay, and naming it early is cheaper than dissolving it later.

Both halves also answer the **same question** — *is the story we tell outsiders true and
provable?* Narrative failure is an unevidenced claim; diligence failure is an
**unevidence-able** one. Same discipline, same evidence base, one cadence
(`corporate.md:423-425`).

**The split trigger is the first term sheet.** Stated explicitly so the deferral has a
named end rather than becoming permanent by inertia: this department splits on **the first
live term-sheet conversation, or the first instrument actually issued**, whichever comes
first (`corporate.md:457-458`). At that point Fundraise Readiness earns a standing cadence
— a data room with real counterparties, a diligence Q&A log, and a clock — and separates.
[[strategy-fundraising-loops]] L-STR-5 watches for it in **both** directions: the trigger
firing is a split, and the trigger *not* firing for twelve months is evidence the second
half was never a team, which is also a finding worth recording.

Staged as **CORP-F3** for the founder: confirm the trigger, or split now (`corporate.md:496`).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| **Drafting instruments** — SAFE, board consent, stock purchase agreement, advisor agreement, IP assignment, founder agreement | [[instruments-equity-charter]] (Legal §1.1) | Legal drafts equity instruments; Strategy sequences and requests them; **the founder decides terms. No team decides its own terms** (`corporate.md:505-506`, `:421-422`). This department may say *"we should raise now, on a SAFE"*; it may never say what the cap is, and it never writes the document |
| **The company story told to customers** — the deck's craft, the case study, the demo script, the one-sentence pitch as a produced artifact | [[media-brand-charter]] → [[narrative-collateral-charter]] (M2) | Media & Brand owns the **craft of the artifact and the customer-facing story**; Strategy owns **the claim and the investor audience**. `commercial.md:513-514` states the same boundary from the other side: *"Corporate → Strategy & Fundraising owns the YC path and the process. This team owns the craft of the artifact, never the decision to apply."* Two units, one sentence, opposite responsibilities: M2 makes every artifact lead with it; Strategy decides what it says and whether it is true |
| **Defining "dollars recovered"** as a metric | [[metric-contract-truth-assurance-charter]] (Analytics & BI) | Analytics owns the **definition and the contract**; Strategy owns **not overstating it to investors**. See below — this is the department's inherited truth constraint |
| **Producing the recovery number** | [[design-partner-operations-charter]] (Sales S1) | S1 produces *verified* dollars recovered by watching credits land; Strategy publishes nothing stronger |
| **Pricing and the revenue model** | [[finance-pricing-charter]] | Strategy consumes the pricing lock as an input to OD-23; it does not set price |
| **Editorial approval of marketing content** | [[editorial-gate-charter]] (Growth G3) | Same verb-strength rule, different surface. Strategy sets the rule for the recovery claim; G3 enforces it on published content |
| **Doc-corpus verification generally** | [[standards-verification-charter]] (Knowledge & Doc 2.3) | 2.3 owns whether *any* document is still true; Strategy owns whether the **outward** ones are, at the moment of sending. Overlapping mechanism, non-overlapping blast radius |
| **Deciding to raise** | The **founder** | This department prepares the decision, states the consequence, and records it. It does not make it |

## The truth constraint this department inherits — and must enforce upward

`YC_WEDGE_PLAN.md:31-33` establishes, in the company's own words:

> Until an 812 lands on a later invoice, *"dollars recovered"* means *"we asked."*
> Verified recovery requires watching the credit arrive.

**Investor materials repeating the stronger claim would be false.** Not aggressive, not
optimistic — false. The same document says so twice: `:369-373` grades *"dollars
recovered"* as *"half vanity and half unverifiable"*, sizes genuinely recoverable billing
error at **0.3–1.5% of beverage spend ($150–800/month for a $1.2M bistro)**, and
recommends leading with **cost drift caught** instead.

The division of labour is exact and is worth repeating because it is easy to blur:

- [[metric-contract-truth-assurance-charter]] owns **the metric definition** — what
  `dollars_recovered` means in a query, and that the query cannot silently change meaning.
- **This department owns not overstating it to investors** — the verb, the audience, and
  the moment of sending.

A correct definition does not survive contact with a slide on its own. Analytics can make
`dollars_recovered` mean *requested* and a deck can still say *recovered*; that failure
happens here, not there, and no other unit sits close enough to the outward artifact to
catch it.

The claim is **upward-enforcing** as well as outward: if the founder's verbal pitch carries
the stronger claim, this department's job is to say so. [[strategy-fundraising-premortem]]
M5 and [[positioning-fundraise-readiness-premortem]] P5 both treat *"we policed Growth's
blog and not the pitch"* as a predicted failure rather than an unlucky one.

## Metrics it moves

| Metric | Definition | Baseline today |
|---|---|---|
| `strategy.claim_to_evidence_coverage` | % of claims in the current external narrative backed by a live citation — a query, a `path:line`, or a reproducible demo | **Unmeasured, and the one existing artifact already fails at three verified points** (see Evidence). No register exists to measure against (`corporate.md:449-452`) |
| `strategy.citation_drift_rate` | % of `path:line` citations in outward material that no longer resolve to the claimed content | **≥ 2 of the 7 sources in `YC_WEDGE_PLAN.md` §6 have drifted or inverted** — ≈29% on a sample of seven |
| `strategy.claim_overstatement_count` | Published claims using a stronger verb than the evidence supports. **Target 0, permanently** | **0 published** — because nothing has been published. This is an unread zero, not a good one |
| `strategy.wedge_metric_instrumentation` | Binary: is the headline metric a live query, or a slide? | **A slide.** *"Dollars recovered"* is named at `YC_WEDGE_PLAN.md:315` and is not instrumented as a company metric anywhere (`corporate.md:446-448`) |
| `strategy.diligence_pack_completeness` | % of a named diligence checklist that exists and is current | **0%.** No checklist, no data room, no cap table (`corporate.md:444`) |

**Neural-footprint tie.** None directly — this department's subject is claims, not agent
tasks or guest choices. The one indirect tie matters though: if `nf_a.*` numbers ever
appear in investor material ("our agents complete N% of tasks"), they arrive carrying
[[performance-doneability-charter]]'s open finding that today's `success_rate` means
*"`process_message()` did not raise"* (`corporate.md:383-385`), which is liveness, not
correctness. Publishing it as correctness would be the same class of error as *dollars
recovered*, one layer over. The claim register treats every `nf_a.*` figure as
overstatement-prone by default.

## Evidence today

**NEW.** Everything this department *owns* — the claim register, the verification gate,
the diligence pack, the data room, the cap table, the deck — does not exist.

### Why this charter says NEW where `corporate.md` says PARTIAL

`corporate.md:426` and `:476` grade team §5.1 **PARTIAL**, and that grade is correct at
team level: the narrative half is unusually well developed. This charter grades the
**department** NEW, and the reconciliation is worth stating rather than leaving as an
apparent inconsistency:

The entire PARTIAL grade rests on **one inherited document that this department did not
write** — `.planning/YC_WEDGE_PLAN.md`, 406 lines, produced by an engineering-planning
session in July. It is a *build plan* that contains a positioning section, not a positioning
artifact. And it is already stale at three independently verified points (below), which
means the department's founding evidence is simultaneously its first defect report. A
function whose only asset is a document it must audit is NEW.

### What exists — the one artifact, read honestly

`.planning/YC_WEDGE_PLAN.md` is genuinely opinionated rather than aspirational, and the
strong parts should be named before the stale ones:

- **The sentence** (`:312`) — the invoice wedge, in one line, customer-legible.
- **The metric** (`:315`) — *dollars recovered*, chosen explicitly over DAU, sessions and
  insights-generated as *"YC-legible, customer-legible, and unfakeable."*
- **The named risk** (`:323-324`) — *"This repo's biggest risk is not missing features, it
  is surface area"*, enumerated: a sommelier AI, a calendar, promotions, 573 insight types,
  an 860-path UX catalogue, a UX optimizer, a wine library. *"A YC partner reads that as no
  wedge."*
- **An honest competitive read** against MarginEdge (`:328`) that refuses the easy claim.
- **A §4 track table with real statuses** (`:336-348`) — A, B0, B0a, B0b, B0c, B1, B1a, B2,
  B3, B4, D marked ✅; **C cut**. Cut tracks recorded as cut is a good sign about the
  document's honesty.
- **A self-correcting metric section** (`:369-373`) that argues *against* its own headline
  metric.

Two further pieces of prior art:

- `.planning/AGENT_NATIVE_UI_DECISION.md:78` — *"Business review (YC-partner lens) —
  verdict: don't build."* Strategy review is an existing practice here, not a new habit.
- [ADR 0005](../../../decisions/0005-v3-to-v0-version-reset.md) — the deliberate v3→v0
  reset is a positioning decision already on the record.

### What is NEW

No cap table, no data room, no diligence checklist, no deck, no case study, no recorded
demo, no SAFE, no board consent (`corporate.md:444`). Verified independently for this
charter: a repo-wide filename sweep for `deck|data.room|cap.table|term.sheet` returns
**nothing** outside `node_modules`. `.claude/skills/` does not exist, so the department
owns no executable procedure either.

**And the gap between the two lists is the whole job** (`corporate.md:446-448`): the wedge
metric is named but not instrumented as a *company* metric, so *"dollars recovered"* is
currently a slide, not a query.

### The stale citation — a worked example, kept deliberately

This is recorded here rather than filed as a bug because it is the clearest available
argument for why this department must re-verify before **every** send, not on a schedule.

`YC_WEDGE_PLAN.md:401` cites
`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:233,265` for hand-typed
invoice quantity and unit-price inputs. **The finding holds** — both are still manual
`<input type="number">` elements. **The line numbers drifted**: they are now `:401` and
`:440`. The same source line also cites `:92` for `invoiceQty` defaulting to `stockedQty`;
that state now initialises to `null` at `:168`, with an in-file comment explaining that an
empty invoice quantity is a real and common state. So one citation has drifted, and a
second has been superseded by a deliberate product change.

Two further drift instances in the same seven-source section:

1. **A claim that has inverted.** `YC_WEDGE_PLAN.md:404` asserts
   `apps/api-gateway/src/ux-optimizer/` has **0 `@UseGuards`**, *"all re-confirmed
   2026-07-27."* It now carries `@UseGuards(JwtAuthGuard)` at
   `apps/api-gateway/src/ux-optimizer/ux-optimizer.controller.ts:55`, which
   [[README|foundation-README]] §2.3 records as resolved. The document **contradicts itself**:
   `:339` marks Track A ✅ *"secured"* while `:404` still reports it unguarded.
2. **A stale header.** `YC_WEDGE_PLAN.md:5` reads *"Status: REVISION 2 — in progress. Track
   A complete"* while the document's own §*"REVISION 3 — the document flow"* opens at `:9`.
   The status line was not updated when Revision 3 was written.

**None of these is a serious error in the document. All three would be serious in a deck.**
A partner who checks one `path:line` and finds it wrong discounts every other number on the
page — which is precisely [[strategy-fundraising-premortem]] M1's mechanism, arriving
through a mechanism nobody would have predicted. The counter-pressure is in
[[strategy-fundraising-directive]] R2 and [[strategy-fundraising-loops]] L-STR-1: **citation
re-verification is a gate on sending, not a periodic hygiene job**, because a periodic job
run last month is exactly the thing that produced `:404`.

### One more, inherited from a sibling

`corporate.md:206-213` records a live contradiction the corpus has with itself:
`LLM_INSTRUCTION_PROMPTS.md:166` says **375 insight types**; `YC_WEDGE_PLAN.md:324` and
`AGENT_NATIVE_UI_DECISION.md:100` both say **573**. One is wrong, both are quoted in
strategy documents, and **the 573 sits inside the YC narrative**. This department does not
own resolving it — [[standards-verification-charter]] does — but it owns not shipping
either number until it is resolved.

## Open forks touching this department

- **OD-23** — *$20k MRR in 30 days* against locked $20–50/mo self-serve pricing
  ([[OPEN-DECISIONS]]:27). **The central open question**, recorded and deliberately not
  resolved in [[strategy-fundraising-agenda-full]]. Founder call.
- **CORP-F3** — Strategy stays one team until a term sheet (`corporate.md:496`). Confirm the
  trigger, or split now.
- **CORP-F1 / OD-17** — does a *team* get the full 7-artifact anatomy? This department is the
  sharpest instance of that question: **one team, 14 documents, one inherited artifact**
  (`corporate.md:494`).
- **OD-14** — root `SKILLS.md` still branded WineOps ([[README|foundation-README]] §3.1). A
  stale-brand file at repo root is a diligence-surface item as much as a docs item.
- **The 375-vs-573 contradiction** — not yet staged as an OD; blocks publishing either.
