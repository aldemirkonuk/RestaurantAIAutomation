---
type: agenda-full
division: corporate
department: strategy-fundraising
team: positioning-fundraise-readiness
status: provisional
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
updated: 2026-08-24
links: ["[[positioning-fundraise-readiness-charter]]", "[[positioning-fundraise-readiness-premortem]]", "[[positioning-fundraise-readiness-agenda-board]]", "[[positioning-fundraise-readiness-directive]]", "[[positioning-fundraise-readiness-loops]]", "[[positioning-fundraise-readiness-schedule]]", "[[strategy-fundraising-agenda-full]]", "[[metric-contract-truth-assurance-charter]]", "[[design-partner-operations-charter]]", "[[narrative-collateral-charter]]", "[[editorial-gate-charter]]", "[[standards-verification-charter]]", "[[instruments-equity-charter]]", "[[OPEN-DECISIONS]]"]
---

# Positioning & Fundraise Readiness — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

The department agenda ([[strategy-fundraising-agenda-full]]) holds the boundary questions
and records **OD-23**, the central open question, unresolved. This document holds the work:
the register's schema, the send checklist, the seed backlog, and the diligence index. It
does not restate OD-23 — it names what changes if the founder answers it either way.

## What

**One artifact, built first, that everything else depends on: the claim register.**

Four columns and one hard rule. The rule is that a claim with no evidence does not enter,
and a claim not in the register does not get sent — however true it is.

| Column | Contents | Rejected values |
|---|---|---|
| `claim` | The sentence as it will appear, verbatim | Paraphrases. The verb is the thing being checked, so the verb must be the one that ships |
| `audience` | `investor` · `customer` · `press` · `partner`, and `channel: written \| spoken` | Blank. A claim with no audience has not been thought about |
| `evidence` | A **query id**, a **`path:line` + symbol**, or a **recorded demo path** | Prose. A roadmap item. Anything in the future tense |
| `verified` | Date **plus result**: `holds` · `drifted to :N` · `inverted` · `gone` | A bare date. [[positioning-fundraise-readiness-premortem]] P2 is a timestamp with no result behind it |

**The symbol requirement is deliberate and is worth defending here**, because it looks
fussy. `ReceivingWorkspace.tsx:233` is a falsehood the moment somebody adds twenty lines
above it. `ReceivingWorkspace.tsx → invoiceQty input` degrades into a search. The founding
artifact's `:401` citation drifted exactly this way — the finding held, the coordinates did
not — and a symbol would have made the drift harmless.

## How

### Step 1 — seed the register from what already exists

Seven claims are already in force in the company's own documents. They are seeded in this
order, worst-first, because the ones needing rejection teach the schema fastest.

| # | Claim | Source | Grade on entry |
|---|---|---|---|
| 1 | *"Dollars recovered"* as a headline number | `YC_WEDGE_PLAN.md:315` | ⚠️ **Enters in its weak form or not at all.** `:31-33` — it means *we asked* until an 812 lands. Bound to [[metric-contract-truth-assurance-charter]]'s contract and [[design-partner-operations-charter]]'s produced number |
| 2 | 573 insight types / 860-path UX catalogue | `YC_WEDGE_PLAN.md:324` | 🔴 **BLOCKED.** The corpus says both 375 (`LLM_INSTRUCTION_PROMPTS.md:166`) and 573 (`corporate.md:206-213`). Neither ships until [[standards-verification-charter]] resolves it |
| 3 | Track A "Security" ✅ | `YC_WEDGE_PLAN.md:339` | ⚠️ **Label overstatement.** Body accurate (ux-optimizer only); label reads as the security work being done, while 94 endpoints are unguarded by omission and OD-20 is open and urgent. Ships only with scope restored |
| 4 | Four-way match · credit ledger · X12 810/856/812 · two-stage receiving | `YC_WEDGE_PLAN.md:339-348` ✅ rows | ✅ **Strongest available.** Needs a **recorded demo**, not a line number — the evidence type that cannot drift |
| 5 | Competitive position vs MarginEdge | `YC_WEDGE_PLAN.md:328` | ✅ Sound and honest. Re-verify before every use; competitor facts age fastest of anything in the register |
| 6 | Cost drift caught | `YC_WEDGE_PLAN.md:369-373` | ⛔ **No evidence yet.** The source document recommends it as the stronger lead and `:361-364` confirms it is *computable but not computed*. Cannot enter until a query exists |
| 7 | The wedge sentence | `YC_WEDGE_PLAN.md:312` | ✅ A positioning claim, not a factual one. No evidence required — it is the **constant** everything else reduces to |

**Expected first reading: of seven seed claims, one is blocked, two need weakening, one
cannot enter, and three are clean.** That is the honest baseline, and stating it before
starting is what stops the first month's number from being read as a failure.

### Step 2 — the send checklist

Five questions, applied per artifact, in order. This is
[[positioning-fundraise-readiness-directive]] R1–R3 as something a person can run in five
minutes.

1. **Is every claim in the register?** If not, register it. No exceptions for "obvious".
2. **Is every citation re-verified since its source last changed?** Not since the last
   sweep — since the source changed. This is the gate `YC_WEDGE_PLAN.md:404` failed.
3. **Does every verb match its evidence?** *Recovered* needs a landed credit. *Instrumented*
   needs a query. *Complete* needs its scope attached.
4. **Does the artifact reduce to the wedge sentence in its first paragraph?** If not, flag
   and send — this is a signal, not a blocker.
5. **Who authored it?** If the answer is this team, stop —
   [[positioning-fundraise-readiness-premortem]] P3.

### Step 3 — the one-page diligence index, and nothing beyond it

Not the artifacts. One page listing the questions a diligence reader would ask, and for each
one the location and owner of the answer — most of which will read "does not exist yet," and
that is the useful part.

**Completeness is measured against questions, not slots** (P4). A pack that answers 40% of
real questions beats one that fills 100% of a template, and the metric's denominator is
built to be able to say so.

## Why now

**Because four units are about to start producing outward claims.**
[[narrative-collateral-charter]] is chartering the deck, [[editorial-gate-charter]] the
content gate, [[design-partner-operations-charter]] the recovery number, and Growth the
content engine. The register costs an afternoon before the first artifact and costs a
retrofit across twenty afterwards.

**Because the evidence is at its freshest right now.** `YC_WEDGE_PLAN.md` §6's sources were
verified 2026-07-27 and have already drifted at three points. Every week the register does
not exist, the re-verification debt on the existing corpus grows.

**And one honest counterweight:** there is no raise in flight, no deadline, and no
counterparty. Only Step 1 is genuinely urgent. Steps 2 and 3 are cheap-but-not-urgent, and
saying so is better than manufacturing urgency this team would then have to sustain.

## What changes if OD-23 resolves

Recorded here, not answered — the founder decides ([[strategy-fundraising-agenda-full]],
[[OPEN-DECISIONS]]:27).

| If the answer is | This team does |
|---|---|
| **Hold $20k/30d** | Register the target as a claim with its own evidence requirement, and expect the overstatement pressure to arrive within the month — the arithmetic is 400–1,000 restaurants in 30 days with no self-serve funnel built |
| **Higher-ACV founder-led sales** | Re-verify the whole competitive read: a different price point implies a different buyer and probably a different wedge audience. `YC_WEDGE_PLAN.md:328`'s MarginEdge comparison was written for the low-ACV case |
| **Count committed, not collected** | **This becomes the register's second canonical entry after *dollars recovered*.** *"$20k MRR"* may never appear outward without *"committed, not collected"* attached — the same discipline, one level up. Enforced by L-PFR-2 |

## Next steps

| # | Step | Done when | Depends on |
|---|---|---|---|
| 1 | Create the register with the four-column schema and the seven seed claims graded | All seven rows exist, including the blocked and the rejected ones | Nothing |
| 2 | Re-verify all seven `YC_WEDGE_PLAN.md` §6 sources; record the result per source | `strategy.citation_drift_rate` has a real first number (expected ≈29%) | Nothing |
| 3 | Write the send checklist as one page and hand it to the four claim-producing units | All four have read it and can run it without this team present | Step 1 |
| 4 | Request the `dollars_recovered` contract from [[metric-contract-truth-assurance-charter]]; bind row 1 to it | The register cites a contract, not a sentence in a build plan | Analytics & BI unit existing |
| 5 | Route the 375-vs-573 contradiction to [[standards-verification-charter]] with both citations | An owner has it; row 2 stays BLOCKED until they close it | Nothing |
| 6 | Record a demo for the four-way-match / credit-ledger claims | Row 4's evidence is a demo path, not a `path:line` | A working demo path |
| 7 | One-page diligence index — questions, locations, owners | One page. **Not the artifacts** — R4 | Nothing |

Deliberately **not** on this list: the deck, the data room, the cap table, a YC application,
any request into [[instruments-equity-charter]]. All five are triggered work.

## Questions for the founder

Department-level questions — OD-23, OD-C3, the raise position, the upward rule — are in
[[strategy-fundraising-agenda-full]]. Two are specific to the work:

1. **Which is the headline: *cost drift caught* or *dollars recovered*?**
   `YC_WEDGE_PLAN.md:369-373` argues for the former against its own §3, and neither is
   instrumented, so the choice is still free. It stops being free the moment one goes into
   an artifact.
2. **Is a recorded demo acceptable as primary evidence for investor material?** It is the
   only evidence type that cannot silently drift, and it is more work to produce than a
   citation. Answering yes changes what Step 6 is worth.
