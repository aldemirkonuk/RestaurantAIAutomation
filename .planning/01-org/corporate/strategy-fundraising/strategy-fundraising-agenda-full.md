---
type: agenda-full
division: corporate
department: strategy-fundraising
status: provisional
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
updated: 2026-08-24
links: ["[[strategy-fundraising-charter]]", "[[strategy-fundraising-premortem]]", "[[strategy-fundraising-agenda-board]]", "[[strategy-fundraising-directive]]", "[[strategy-fundraising-loops]]", "[[strategy-fundraising-schedule]]", "[[positioning-fundraise-readiness-agenda-full]]", "[[OPEN-DECISIONS]]", "[[finance-pricing-charter]]", "[[sales-charter]]", "[[design-partner-operations-charter]]", "[[growth-charter]]", "[[conversion-funnel-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[narrative-collateral-charter]]", "[[instruments-equity-charter]]", "[[standards-verification-charter]]", "[[decision-office-charter]]", "[[README|foundation-README]]"]
---

# Strategy & Fundraising — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Three things, in priority order. The ordering is the agenda's main claim.

1. **A claim register that exists.** Every claim currently in force in outward material,
   its evidence, and the date that evidence was last re-verified. Today there is no
   register, no outward material, and the one inherited artifact fails its own bar at three
   verified points ([[strategy-fundraising-charter]] §Evidence). Everything else this
   department does is downstream of this.
2. **A decision, not a drift, on OD-23.** The central open question below. This department
   does not resolve it; it makes sure it is resolved rather than forgotten.
3. **A raise position stated out loud** — *raise, or not yet, and on what trigger* —
   restated quarterly. "Not yet" is a valid answer and must be an *answer*, not an absence.

Explicitly **not** in scope for the first quarter: a deck, a data room, a cap table, a
diligence pack. [[strategy-fundraising-premortem]] M3 is the reason, and
[[strategy-fundraising-directive]] R4 is the rule.

## How

**The claim register first, because it is the only artifact that is useful before a raise
and required during one.** It is also the cheapest: a table with four columns — claim,
audience, evidence (query id / `path:line` + symbol / recorded demo), last re-verified —
and one hard rule, that a claim with no evidence does not enter it.

Seeded from what already exists, in this order:

| Seed claim | Source | Evidence status |
|---|---|---|
| The wedge sentence | `YC_WEDGE_PLAN.md:312` | Sound. A positioning claim, not a factual one — no evidence required, but it is the constant everything else reduces to |
| *"Dollars recovered"* as a headline number | `YC_WEDGE_PLAN.md:315` | ⚠️ **Overstatement-prone.** `:31-33` — it means *we asked*. Enters the register in its weak form or not at all |
| Cost drift caught | `YC_WEDGE_PLAN.md:369-373` | Recommended by the source document as the stronger lead. **Not built** — `:361-364` says the operator's higher-value metrics are computable but not computed |
| Four-way match, credit ledger, X12 parsers, two-stage receiving | `YC_WEDGE_PLAN.md:339-348` ✅ rows | Strongest available claims. Need a **demo**, not a line number — see M2 |
| Competitive position vs MarginEdge | `YC_WEDGE_PLAN.md:328` | Sound and honest; re-verify before use, competitor facts age fastest |
| 573 insight types / 860-path UX catalogue | `YC_WEDGE_PLAN.md:324` | 🔴 **Blocked.** The corpus says both 375 and 573 (`corporate.md:206-213`). Neither ships until [[standards-verification-charter]] resolves it |
| Track A "Security" ✅ | `YC_WEDGE_PLAN.md:339` | ⚠️ **Label overstatement.** The row body is accurate (ux-optimizer specifically); the track *label* reads as the security work being done, while [[README|foundation-README]] §0 records 94 endpoints unguarded by omission and OD-20 open and urgent (`:344`). Publishable only with the scope restored |

**Then the verification mechanism, built as a gate rather than a review.** The distinction
is the entire lesson of `YC_WEDGE_PLAN.md:404` — a claim marked *"re-confirmed 2026-07-27"*
that had inverted by the time anyone read it. A periodic sweep would not have caught it;
a check at the moment of sending would.

**Then, and only then, readiness.** One page: where each diligence artifact would live and
who owns it. Not the artifacts. The split trigger (`corporate.md:457-458`) is what promotes
that page into a workstream.

## Why now

Three reasons, and one of them is time-sensitive.

1. **The claim surface is about to open.** [[growth-charter]] is chartering content
   production, [[sales-charter]] is chartering design-partner operations, and
   [[narrative-collateral-charter]] is chartering the deck. Four units are about to start
   producing outward claims. The register is far cheaper to establish **before** the first
   artifact than to retrofit across twenty.
2. **The evidence is at its freshest right now.** `YC_WEDGE_PLAN.md`'s §6 sources were
   verified 2026-07-27 and have already drifted at three points in under a month of
   commits. Every week the register does not exist, the re-verification cost of the
   existing corpus goes up.
3. **OD-23 is live and shaping other departments' plans.** It is cited in
   [[finance-pricing-charter]]:152 and in Design's fork list. A target that drives
   Commercial planning while formally unresolved is the exact condition
   [[strategy-fundraising-premortem]] M5 describes.

Against that: this department has **no raise in flight, no deadline, and no counterparty.**
The honest reading is that only item 1 is urgent, item 2 is other people's urgency routed
through here, and item 3 has no clock at all. An agenda that claimed all three were urgent
would be the first overstatement.

---

## The central open question — OD-23

> **Recorded, not resolved. This is a founder decision.**
> [[OPEN-DECISIONS]]:27 · carried over from `MASTER-PLAN-30-DAY-SPRINT-2026-08-24.md` §0.

**The question.** The Cowork master plan rates **$20k MRR in 30 days** at **under 10%
likely** against the locked **$20–50/mo self-serve pricing**.

**The arithmetic, which is the whole problem.** $20,000 ÷ $50/mo = **400 paying
restaurants**. $20,000 ÷ $20/mo = **1,000**. In thirty days. Against a product with **no
self-serve funnel built** — [[finance-pricing-charter]] records no billing code, no payment
processor among the runtime hosts, and no `/pricing` route among the 51 web pages. There is
no mechanism by which 400 restaurants could pay, independent of whether 400 restaurants
would want to.

**The two alternatives the master plan proposed:**

1. **Higher-ACV founder-led sales.** Fewer, larger accounts, sold by the founder, at a
   price point where $20k is tens of accounts rather than hundreds. Changes the pricing
   lock, the funnel assumption, and probably the product's first-run experience.
2. **Count signed/committed deals rather than collected cash.** Keeps the number and
   changes its definition — which makes it reachable and makes it **exactly the class of
   claim [[strategy-fundraising-charter]] exists to police**. A redefined metric is
   legitimate internally and is an overstatement externally unless the redefinition travels
   with it. If this path is chosen, *"$20k MRR"* must never appear outward without
   *"committed, not collected"* attached — the same discipline as *dollars recovered*,
   applied one level up.

**Why this department records it rather than answering it.** The target sets the shape of
every Commercial decision — pricing, funnel, sales motion, hiring — and it is a founder
call about ambition and risk appetite, not an analytical one. Two of the three candidate
answers are business-model changes; the third is a metric-definition change. None of them
is Strategy's to make. What Strategy owns is that **the question closes** rather than
fading, and that whichever answer is chosen is stated with the same verb strength outward
as inward.

**What Strategy will do with it, monthly, until it closes.** Report it by name in
[[strategy-fundraising-agenda-board]] — including *"still open, day N, nothing changed"* —
and flag any Commercial or Product plan that quotes a revenue figure without the fork
attached. See [[strategy-fundraising-loops]] L-STR-4.

**What would change the answer.** Any of: the first non-design-partner customer paying
anything; [[conversion-funnel-charter]] shipping a self-serve path; the founder
un-deferring pricing (`commercial.md:313-316`); or a term-sheet conversation, which reframes
the target as a fundraising input rather than a revenue one.

---

## Next steps

None of these is started. Each is scoped to be finishable, because an agenda of
unfinishable items is the first thing [[ORG_STRUCTURE]] §4's 60-day rule marks as fiction.

| # | Step | Done when | Depends on |
|---|---|---|---|
| 1 | Stand up the claim register with the seven seed claims above, each graded | Every seed claim carries evidence or an explicit `BLOCKED` reason | Nothing |
| 2 | Re-verify all seven `YC_WEDGE_PLAN.md` §6 sources; record the drift rate as the baseline | `strategy.citation_drift_rate` has a real first number (expected ≈29%) | Nothing |
| 3 | Write the verb-strength rule as a one-page gate the other four claim-producing units can apply | [[growth-charter]] G3, [[sales-charter]] and [[narrative-collateral-charter]] have all read it | Step 1 |
| 4 | Ask [[metric-contract-truth-assurance-charter]] for the `dollars_recovered` contract, and bind the register entry to it | The register cites a contract, not a sentence in a build plan | Analytics & BI unit existing |
| 5 | State the raise position in writing — *not yet, and here is the trigger* | One paragraph, dated, in [[strategy-fundraising-agenda-board]] | Founder input |
| 6 | One-page data-room index — where things **would** live, who owns each | One page exists. **Not the artifacts** — R4 | Step 5 |
| 7 | Record OD-23's status monthly until it closes | Three consecutive monthly entries exist | Nothing |

Deliberately **not** on this list: build a deck; build a data room; open a YC application;
draft anything for [[instruments-equity-charter]]. All four are triggered work, and
triggering them early is [[strategy-fundraising-premortem]] M3.

## Questions for the founder

1. **OD-23 — what is the target?** Hold $20k/30d, move to higher-ACV founder-led sales, or
   redefine the number as committed rather than collected? If the third: is *"committed,
   not collected"* acceptable as permanent attached language on every external use?
2. **OD-C3 — confirm the one-team decision and its trigger?** This charter defers the split
   to the first term sheet (`corporate.md:496`). Confirm, or split now.
3. **Is the raise position "not yet"?** The department currently assumes so — no raise in
   flight, no deadline, no counterparty. If that assumption is wrong, the ordering in this
   agenda inverts and readiness becomes urgent.
4. **When the founder's own pitch carries a stronger claim than the evidence, does this
   department get to say so?** [[strategy-fundraising-premortem]] M5 assumes yes. That
   assumption is worth confirming while it is cheap, because the day it matters is the day
   it is expensive.
5. **Cost drift caught, or dollars recovered, as the headline?** `YC_WEDGE_PLAN.md:369-373`
   argues for the former against its own §3. Neither is instrumented today, so the choice is
   still free.

Team-level working detail — the register's schema, the send checklist, the diligence
checklist — is in [[positioning-fundraise-readiness-agenda-full]]. This document holds the
department's boundary questions; that one holds the work.
